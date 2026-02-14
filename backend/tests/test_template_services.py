import importlib.util
import sys
import types
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _ensure_stubbed_imports() -> None:
    app_module = sys.modules.setdefault('app', types.ModuleType('app'))
    if not hasattr(app_module, '__path__'):
        app_module.__path__ = []  # type: ignore[attr-defined]

    services_module = sys.modules.setdefault('app.services', types.ModuleType('app.services'))
    if not hasattr(services_module, '__path__'):
        services_module.__path__ = []  # type: ignore[attr-defined]

    supabase_stub = types.ModuleType('app.services.supabase_client')
    supabase_stub.get_supabase = lambda: None  # type: ignore[attr-defined]
    sys.modules['app.services.supabase_client'] = supabase_stub

    config_stub = types.ModuleType('app.config')

    class _Settings:
        callback_base_url = ''

    config_stub.get_settings = lambda: _Settings()  # type: ignore[attr-defined]
    sys.modules['app.config'] = config_stub

    # Optional third-party stubs for lightweight module loading in local env
    if 'PIL' not in sys.modules:
        pil_mod = types.ModuleType('PIL')

        class _ImageStub:
            class Resampling:
                LANCZOS = 1

        pil_mod.Image = _ImageStub
        sys.modules['PIL'] = pil_mod

    if 'httpx' not in sys.modules:
        httpx_mod = types.ModuleType('httpx')

        class _AsyncClientStub:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        httpx_mod.AsyncClient = _AsyncClientStub
        sys.modules['httpx'] = httpx_mod

    class _TaskStub:
        @staticmethod
        def delay(*_args, **_kwargs):
            return None

    for mod_name, attr in (
        ('app.tasks.image_to_video', 'process_image_to_video'),
        ('app.tasks.multi_image_to_video', 'process_multi_image_to_video'),
        ('app.tasks.motion_control', 'process_motion_control'),
        ('app.tasks.text_to_video', 'process_text_to_video'),
    ):
        mod = types.ModuleType(mod_name)
        setattr(mod, attr, _TaskStub())
        sys.modules[mod_name] = mod


def _load_module(module_name: str, relative_path: str):
    _ensure_stubbed_imports()
    module_path = ROOT / relative_path
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Unable to load module: {module_path}')
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


template_ingest_module = _load_module(
    'template_ingest_service_under_test',
    'app/services/template_ingest_service.py',
)
template_render_module = _load_module(
    'template_render_service_under_test',
    'app/services/template_render_service.py',
)

TemplateIngestService = template_ingest_module.TemplateIngestService
TemplateRenderService = template_render_module.TemplateRenderService


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, name: str, db: dict):
        self._name = name
        self._db = db
        self._action = None
        self._payload = None
        self._filters = []
        self._single = False

    def select(self, _fields: str):
        self._action = 'select'
        return self

    def insert(self, payload):
        self._action = 'insert'
        self._payload = payload
        return self

    def update(self, payload):
        self._action = 'update'
        self._payload = payload
        return self

    def eq(self, field: str, value):
        self._filters.append((field, value))
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        rows = self._db.setdefault(self._name, [])

        def _matches(row):
            return all(row.get(k) == v for k, v in self._filters)

        if self._action == 'insert':
            row = deepcopy(self._payload)
            rows.append(row)
            return _FakeResult([row])

        if self._action == 'update':
            updated = []
            for row in rows:
                if _matches(row):
                    row.update(deepcopy(self._payload))
                    updated.append(deepcopy(row))
            return _FakeResult(updated)

        if self._action == 'select':
            filtered = [deepcopy(row) for row in rows if _matches(row)]
            if self._single:
                return _FakeResult(filtered[0] if filtered else None)
            return _FakeResult(filtered)

        raise RuntimeError(f'Unsupported action: {self._action}')


class _FakeSupabase:
    def __init__(self, db: dict):
        self._db = db

    def table(self, name: str):
        return _FakeTable(name, self._db)


def test_normalize_clip_ranges_supports_seconds_and_milliseconds():
    ranges = [
        {'start': 1, 'end': 3},
        {'start_sec': 5, 'end_sec': 7.5},
        {'start_ms': 9000, 'end_ms': 12000},
        {'start': -2, 'end': 2},
        {'start': 11, 'end': 12},  # out of range after clamp
        {'start': 3, 'end': 3},  # invalid
    ]

    normalized = TemplateIngestService._normalize_clip_ranges(ranges, total_duration_sec=10)

    assert normalized == [
        (0.0, 2.0),
        (1.0, 3.0),
        (5.0, 7.5),
        (9.0, 10.0),
    ]


def test_allocate_frame_timestamps_matches_requested_count_and_range():
    ranges = [(0.0, 2.0), (4.0, 8.0)]
    timestamps = TemplateIngestService._allocate_frame_timestamps(ranges, extract_frames=7)

    assert len(timestamps) == 7
    assert all(0.0 < ts < 2.0 or 4.0 < ts < 8.0 for ts in timestamps)


def test_render_spec_prefers_explicit_params_over_workflow_defaults():
    service = TemplateRenderService()
    template_record = {
        'type': 'background',
        'url': 'https://example.com/template.jpg',
        'workflow': {
            'kling_endpoint': 'image_to_video',
            'duration': '10',
            'aspect_ratio': '16:9',
            'pacing': 'slow',
            'shot_type': 'wide',
            'camera_move': 'push',
            'prompt_seed': 'seed prompt',
        },
    }

    spec = service.build_render_spec(
        template_record=template_record,
        render_params={
            'prompt': 'user prompt',
            'duration': '5',
            'aspect_ratio': '9:16',
        },
    )

    assert spec['duration'] == '5'
    assert spec['aspect_ratio'] == '9:16'
    assert spec['images'] == ['https://example.com/template.jpg']


def test_render_spec_uses_mapping_fallback_when_workflow_missing_fields():
    service = TemplateRenderService()
    template_record = {
        'type': 'background',
        'url': 'https://example.com/template.jpg',
        'workflow': {
            'kling_endpoint': 'image_to_video',
            'pacing': 'slow',
            'shot_type': 'close',
            'camera_move': 'orbit',
            'prompt_seed': 'seed prompt',
        },
    }

    spec = service.build_render_spec(template_record=template_record, render_params={})

    assert spec['duration'] == '10'
    assert spec['aspect_ratio'] == '9:16'
    assert spec['camera_control']['type'] == 'simple'
    assert spec['camera_control']['config']['zoom'] >= 4


def test_create_task_persists_clip_and_template_fields_and_clip_metadata():
    db = {
        'tasks': [],
        'clips': [{'id': 'clip-1', 'metadata': {}}],
    }
    fake_supabase = _FakeSupabase(db)
    original_get_supabase = template_render_module.get_supabase
    template_render_module.get_supabase = lambda: fake_supabase

    try:
        service = TemplateRenderService()
        template_record = {
            'template_id': 'tpl-001',
            'name': '科技背景',
            'category': 'ad',
            'type': 'background',
            'url': 'https://example.com/template.jpg',
            'workflow': {
                'kling_endpoint': 'image_to_video',
                'pacing': 'medium',
                'shot_type': 'wide',
                'camera_move': 'push',
                'style': {'color': 'cool', 'light': 'soft'},
            },
        }

        result = service.create_task(
            template_record=template_record,
            render_params={
                'prompt': '产品镜头',
                'project_id': 'proj-1',
                'clip_id': 'clip-1',
                'write_clip_metadata': True,
            },
            user_id='user-1',
        )

        assert result['status'] == 'pending'
        assert result['endpoint'] == 'image_to_video'
        assert len(db['tasks']) == 1

        task = db['tasks'][0]
        assert task['clip_id'] == 'clip-1'
        assert task['project_id'] == 'proj-1'
        assert task['input_params']['template_id'] == 'tpl-001'
        assert task['input_params']['template_workflow']['kling_endpoint'] == 'image_to_video'

        clip_metadata = db['clips'][0]['metadata']['template_render']
        assert clip_metadata['template_id'] == 'tpl-001'
        assert clip_metadata['task_id'] == task['id']
        assert clip_metadata['workflow_summary']['shot_type'] == 'wide'
    finally:
        template_render_module.get_supabase = original_get_supabase


def test_create_task_skips_clip_metadata_when_disabled():
    db = {
        'tasks': [],
        'clips': [{'id': 'clip-2', 'metadata': {}}],
    }
    fake_supabase = _FakeSupabase(db)
    original_get_supabase = template_render_module.get_supabase
    template_render_module.get_supabase = lambda: fake_supabase

    try:
        service = TemplateRenderService()
        template_record = {
            'template_id': 'tpl-002',
            'name': '过渡模板',
            'category': 'transition',
            'type': 'background',
            'url': 'https://example.com/template.jpg',
            'workflow': {
                'kling_endpoint': 'image_to_video',
            },
        }

        service.create_task(
            template_record=template_record,
            render_params={
                'clip_id': 'clip-2',
                'write_clip_metadata': False,
            },
            user_id='user-2',
        )

        assert len(db['tasks']) == 1
        assert 'template_render' not in db['clips'][0]['metadata']
    finally:
        template_render_module.get_supabase = original_get_supabase


def test_parse_transition_duration_ms_clamps_and_defaults():
    assert TemplateIngestService._parse_transition_duration_ms({'params': {'metadata': {'transition_duration_ms': 720}}}) == 720
    assert TemplateIngestService._parse_transition_duration_ms({'params': {'metadata': {'transition_duration_ms': 20}}}) == 200
    assert TemplateIngestService._parse_transition_duration_ms({'params': {'metadata': {'transition_duration_ms': 9999}}}) == 2000
    assert TemplateIngestService._parse_transition_duration_ms({'params': {}}) == 1200


def test_extract_scene_events_parses_time_and_score_pairs():
    scene_output = """
[Parsed_metadata_1 @ 0x0] frame:6    pts:520     pts_time:0.866667
[Parsed_metadata_1 @ 0x0] lavfi.scene_score=0.329104
[Parsed_metadata_1 @ 0x0] frame:22   pts:2180    pts_time:3.63333
[Parsed_metadata_1 @ 0x0] lavfi.scene_score=0.171068
"""

    events = TemplateIngestService._extract_scene_events(scene_output, total_duration_sec=5.466)

    assert len(events) == 2
    assert events[0][0] == 0.867
    assert round(events[0][1], 4) == 0.3291
    assert events[1][0] == 3.633
    assert round(events[1][1], 4) == 0.1711


def test_select_scene_peaks_captures_multi_transition_video_clusters():
    scene_events = [
        (0.833, 0.1168),
        (0.867, 0.3291),
        (1.000, 0.1236),
        (3.133, 0.1113),
        (3.633, 0.1711),
        (3.900, 0.1622),
        (3.933, 0.1204),
    ]

    peaks, threshold, spacing = TemplateIngestService._select_scene_peaks(
        scene_events=scene_events,
        total_duration_sec=5.466,
        max_ranges=8,
    )

    assert len(peaks) >= 2
    assert peaks[0][0] == 0.867
    assert peaks[1][0] == 3.633
    assert threshold >= 0.12
    assert spacing >= 0.35


def test_cluster_into_transition_zones_splits_by_gap():
    """动态区域聚类：两组间隔 >0.45s 的事件应形成两个独立转场区域"""
    events = [
        # 转场1: 0.3~0.7s 区域
        (0.30, 0.08),
        (0.40, 0.15),
        (0.50, 0.25),
        (0.60, 0.12),
        (0.70, 0.06),
        # gap ~0.6s
        # 转场2: 1.3~1.5s 区域
        (1.30, 0.10),
        (1.40, 0.30),
        (1.50, 0.09),
    ]
    zones = TemplateIngestService._cluster_into_transition_zones(
        scene_events=events, total_duration_sec=5.0,
    )
    assert len(zones) == 2
    # 第一个区域
    assert zones[0]["start"] <= 0.31
    assert zones[0]["end"] >= 0.69
    assert zones[0]["peak_score"] == 0.25
    # 第二个区域
    assert zones[1]["start"] <= 1.31
    assert zones[1]["end"] >= 1.49
    assert zones[1]["peak_score"] == 0.30


def test_cluster_merges_close_events_into_single_zone():
    """间隔 <0.45s 的事件应合并为单个区域"""
    events = [(0.5, 0.10), (0.7, 0.20), (0.9, 0.15)]
    zones = TemplateIngestService._cluster_into_transition_zones(
        scene_events=events, total_duration_sec=5.0,
    )
    assert len(zones) == 1
    assert zones[0]["peak_score"] == 0.20


def test_build_transition_range_reflects_transition_duration():
    short_range = TemplateIngestService._build_transition_range(
        center_ts=2.0,
        total_duration_sec=10.0,
        transition_duration_ms=400,
    )
    long_range = TemplateIngestService._build_transition_range(
        center_ts=2.0,
        total_duration_sec=10.0,
        transition_duration_ms=1000,
    )

    assert short_range == (1.8, 2.2)
    assert long_range == (1.5, 2.5)


def test_transition_range_dedupe_removes_heavy_overlap():
    ranges = [
        (1.0, 1.5),
        (1.05, 1.55),  # overlap heavy with first
        (2.0, 2.4),
        (2.41, 2.8),
    ]
    deduped = TemplateIngestService._dedupe_transition_ranges(ranges)
    assert len(deduped) == 3
    assert deduped[0] == (1.0, 1.5)


def test_build_transition_spec_outputs_valid_duration_and_family():
    service = TemplateIngestService()
    spec = service._build_transition_spec(
        start_sec=1.0,
        end_sec=1.7,
        index=0,
        job={'tags_hint': ['flash', '快节奏']},
        analysis={
            'transition_category': 'cinematic',
            'transition_type': 'flash_cut',
            'transition_description': 'quick flash cut transition',
        },
    )

    assert spec['version'] == 'v2'
    assert spec['family'] == 'flash_cut'
    assert 200 <= spec['duration_ms'] <= 2000
    assert spec['quality_tier'] == 'template_match'
    assert spec['transition_category'] == 'cinematic'


def test_transition_render_spec_uses_image_to_video_with_image_tail():
    service = TemplateRenderService()
    template_record = {
        'type': 'transition',
        'url': 'https://example.com/transition-style.jpg',
        'workflow': {
            'kling_endpoint': 'motion_control',
            'prompt_seed': 'flash cut transition',
        },
    }

    spec = service.build_render_spec(
        template_record=template_record,
        render_params={
            'images': ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
            'transition_inputs': {
                'from_template_id': 'from-1',
                'to_template_id': 'to-1',
                'from_template_name': 'A',
                'to_template_name': 'B',
                'from_scene_hint': 'woman in white hoodie by a calm lake',
                'to_scene_hint': 'same woman in black blazer at night city street',
                'focus_modes': ['outfit_change'],
                'golden_preset': 'spin_occlusion_outfit',
            },
            'boundary_ms': 480,
            'quality_tier': 'template_match',
        },
    )

    # 转场对现在用 image_to_video + image_tail（首尾帧模式）
    assert spec['endpoint'] == 'image_to_video'
    assert spec['images'] == ['https://example.com/a.jpg']
    assert spec['image_tail'] == 'https://example.com/b.jpg'
    # image_tail 模式使用最新模型
    assert spec['model_name'] == 'kling-v2-6'
    # image_tail 在 std/5 下不可用，必须 pro 模式
    assert spec['mode'] == 'pro'
    # API 互斥: image_tail 与 camera_control 不能同时使用
    assert spec['camera_control'] is None
    # cfg_scale 降低以减少中间帧幻觉（如凭空出现配饰）
    assert spec['cfg_scale'] <= 0.5
    assert spec['transition_inputs']['boundary_ms'] == 480
    assert spec['transition_inputs']['quality_tier'] == 'template_match'
    assert spec['transition_inputs']['focus_modes'] == ['outfit_change']
    assert spec['transition_inputs']['golden_preset'] == 'spin_occlusion_outfit'
    # prompt 只包含运动指令，不包含场景描述/元数据
    assert 'wardrobe/outfit transformation' in spec['prompt']
    assert 'cinematic spin transition' in spec['prompt']
    assert 'start scene:' not in spec['prompt']
    assert 'end scene:' not in spec['prompt']
    assert 'Scene A' not in spec['prompt']
    assert 'template_match' not in spec['prompt']


def test_transition_default_endpoint_is_multi_image_to_video():
    # _default_endpoint 返回 multi_image_to_video，但 build_render_spec 会在
    # has_transition_pair=True 时重写为 image_to_video + image_tail
    assert TemplateRenderService._default_endpoint('transition') == 'multi_image_to_video'


def test_prompt_seed_falls_back_when_invalid_placeholder_seed():
    service = TemplateRenderService()
    template_record = {
        'type': 'background',
        'category': 'ad',
        'tags': ['smoke', 'cinematic'],
        'url': 'https://example.com/template.jpg',
        'workflow': {
            'prompt_seed': '1234',
            'shot_type': 'wide',
            'camera_move': 'push',
            'transition': 'none',
            'pacing': 'fast',
            'style': {'color': 'cool', 'light': 'soft'},
        },
    }

    spec = service.build_render_spec(template_record=template_record, render_params={})

    assert '1234' not in spec['prompt']
    assert 'none' not in spec['prompt'].lower()
    assert 'smoke' in spec['prompt']


def test_create_transition_replica_batch_creates_multi_attempt_tasks():
    db = {
        'tasks': [],
    }
    fake_supabase = _FakeSupabase(db)
    original_get_supabase = template_render_module.get_supabase
    original_process_i2v = template_render_module.process_image_to_video
    dispatched = []

    class _CaptureTask:
        @staticmethod
        def delay(**kwargs):
            dispatched.append(kwargs)
            return None

    template_render_module.get_supabase = lambda: fake_supabase
    template_render_module.process_image_to_video = _CaptureTask()

    try:
        service = TemplateRenderService()
        template_record = {
            'template_id': 'tpl-transition-1',
            'name': 'outfit transition template',
            'category': 'transition',
            'type': 'transition',
            'workflow': {
                'kling_endpoint': 'image_to_video',
                'prompt_seed': 'fashion transition style',
                'duration': '5',
            },
        }

        result = service.create_transition_replica_batch(
            template_record=template_record,
            render_params={
                'project_id': 'proj-2',
                'quality_tier': 'template_match',
            },
            user_id='user-3',
            from_image_url='https://example.com/from.jpg',
            to_image_url='https://example.com/to.jpg',
            focus_modes=['outfit_change'],
            apply_mode='merge_clips',
            variant_count=3,
        )

        assert result['endpoint'] == 'image_to_video'
        assert result['task_count'] == 3
        assert len(result['tasks']) == 3
        assert len(db['tasks']) == 3
        assert len(dispatched) == 3
        assert result['replica_group_id'].startswith('replica-')
        assert result['apply_mode'] == 'merge_clips'
        assert result['golden_preset'] == 'spin_occlusion_outfit'

        created_task = db['tasks'][0]
        assert created_task['project_id'] == 'proj-2'
        # images 现在只有 A 图（首帧）
        assert created_task['input_params']['images'] == ['https://example.com/from.jpg']
        assert created_task['input_params']['replica']['focus_modes'] == ['outfit_change']
        assert created_task['input_params']['replica']['golden_preset'] == 'spin_occlusion_outfit'
        assert created_task['input_params']['replica']['apply_mode'] == 'merge_clips'
        assert created_task['input_params']['transition_inputs']['golden_preset'] == 'spin_occlusion_outfit'
        assert 'outfit' in created_task['input_params']['prompt'].lower()

        dispatched_payload = dispatched[0]
        # 验证 image_to_video + image_tail 模式
        assert dispatched_payload['image_url'] == 'https://example.com/from.jpg'
        assert dispatched_payload['options']['image_tail'] == 'https://example.com/to.jpg'
        assert dispatched_payload['options']['model_name'] == 'kling-v2-6'
    finally:
        template_render_module.get_supabase = original_get_supabase
        template_render_module.process_image_to_video = original_process_i2v


if __name__ == '__main__':
    test_normalize_clip_ranges_supports_seconds_and_milliseconds()
    test_allocate_frame_timestamps_matches_requested_count_and_range()
    test_render_spec_prefers_explicit_params_over_workflow_defaults()
    test_render_spec_uses_mapping_fallback_when_workflow_missing_fields()
    test_create_task_persists_clip_and_template_fields_and_clip_metadata()
    test_create_task_skips_clip_metadata_when_disabled()
    test_parse_transition_duration_ms_clamps_and_defaults()
    test_extract_scene_events_parses_time_and_score_pairs()
    test_select_scene_peaks_captures_multi_transition_video_clusters()
    test_build_transition_range_reflects_transition_duration()
    test_transition_range_dedupe_removes_heavy_overlap()
    test_build_transition_spec_outputs_valid_duration_and_family()
    test_transition_render_spec_uses_image_to_video_with_image_tail()
    test_transition_default_endpoint_is_multi_image_to_video()
    test_prompt_seed_falls_back_when_invalid_placeholder_seed()
    test_create_transition_replica_batch_creates_multi_attempt_tasks()
    print('template service checks passed')
