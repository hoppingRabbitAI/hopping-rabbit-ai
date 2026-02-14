"""
Clip 智能拆镜头服务 v3 — 关键帧提取

基于豆包 VLM（视频理解）检测场景切换 → 提取每个场景的关键帧 → 创建 image 节点
原视频节点保留，image 节点排列在其右侧

核心流程：
1. 获取视频 URL → 下载到本地
2. 上传到火山方舟 File API
3. 调 Responses API 让 VLM 分析场景切换点
4. 对每个场景，提取最稳定帧（中间帧）
5. 上传关键帧到 Supabase storage
6. 创建 media_type='image' 的 canvas_nodes
"""

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)


# ==========================================
# 数据模型
# ==========================================

@dataclass
class SceneCut:
    """场景切换点"""
    time_sec: float
    description: str = ""


@dataclass
class SceneSegment:
    """拆分后的场景片段"""
    index: int
    start_sec: float
    end_sec: float
    description: str = ""

    @property
    def duration_sec(self) -> float:
        return self.end_sec - self.start_sec


@dataclass
class SplitResult:
    """拆分结果"""
    success: bool
    reason: str
    segments: List[SceneSegment]


# ==========================================
# 配置
# ==========================================

MIN_SCENE_DURATION_SEC = 1.0   # 最小场景时长
MIN_CLIP_DURATION_SEC = 2.0    # 可拆最短 clip
MAX_SEGMENTS = 20              # 单次拆分最多片段数


# ==========================================
# VLM 场景检测 Prompt
# ==========================================

SCENE_DETECTION_PROMPT = """请仔细分析这段视频的镜头切换。

你需要找出所有明显的镜头切换点（场景变化、画面跳切、转场效果的位置）。

请严格按以下 JSON 格式输出：

```json
{
  "total_duration_sec": 视频总时长(秒，小数),
  "scene_count": 场景数量,
  "cuts": [
    {
      "time_sec": 切换发生的时间点(秒，小数点后保留2位),
      "description": "简要描述切换前后的画面变化"
    }
  ],
  "scenes": [
    {
      "index": 0,
      "start_sec": 0.0,
      "end_sec": 切换点时间,
      "description": "这个场景的简要描述"
    }
  ]
}
```

注意：
1. 即使是很短的转场（如淡入淡出、硬切）也要检测到
2. cuts 数组列出所有切换点的时间（不含 0 和结尾）
3. scenes 数组列出所有连续场景（从 0 开始到视频结尾）
4. 如果视频只有一个连续场景没有任何切换，scene_count 为 1，cuts 为空数组
5. 时间精度保留到小数点后 2 位"""


# ==========================================
# 内部工具函数
# ==========================================

async def _download_video(video_url: str, temp_dir: str) -> Optional[str]:
    """下载视频到本地（支持 HLS / Cloudflare Stream / 直链）"""
    if not video_url:
        return None

    local_path = os.path.join(temp_dir, "source.mp4")

    # HLS / Cloudflare Stream → ffmpeg 转 mp4
    if "videodelivery.net" in video_url or "m3u8" in video_url:
        # 确保 URL 包含 manifest 路径
        hls_url = video_url
        if "videodelivery.net" in video_url and "/manifest/" not in video_url:
            # Cloudflare Stream: https://videodelivery.net/{uid}/manifest/video.m3u8
            uid = video_url.rstrip("/").split("/")[-1]
            hls_url = f"https://videodelivery.net/{uid}/manifest/video.m3u8"

        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-i", hls_url,
            "-c", "copy",
            "-movflags", "+faststart",
            local_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        except asyncio.TimeoutError:
            proc.kill()
            logger.error("[SceneSplit] HLS 下载超时 (5min)")
            return None

        if proc.returncode != 0 or not os.path.exists(local_path):
            logger.error(f"[SceneSplit] HLS 下载失败: {stderr.decode()[:300]}")
            return None
        return local_path

    # 直链 → httpx 下载
    if video_url.startswith("http"):
        try:
            async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                resp = await client.get(video_url)
                resp.raise_for_status()
                with open(local_path, "wb") as f:
                    f.write(resp.content)
            if os.path.getsize(local_path) < 1000:
                logger.error("[SceneSplit] 下载文件太小，可能不是有效视频")
                return None
            return local_path
        except Exception as e:
            logger.error(f"[SceneSplit] 直链下载失败: {e}")
            return None

    # 本地路径
    if os.path.exists(video_url):
        return video_url

    return None


async def _upload_to_ark(video_path: str, api_key: str) -> str:
    """上传视频到火山方舟 File API，返回 file_id"""
    base_url = "https://ark.cn-beijing.volces.com/api/v3"

    file_size = os.path.getsize(video_path)
    logger.info(f"[SceneSplit] 上传视频到 Ark: {file_size} bytes")

    async with httpx.AsyncClient(timeout=120.0) as client:
        with open(video_path, "rb") as f:
            resp = await client.post(
                f"{base_url}/files",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": ("video.mp4", f, "video/mp4")},
                data={"purpose": "user_data"},
            )

        if resp.status_code != 200:
            raise RuntimeError(f"Ark 上传失败 (HTTP {resp.status_code}): {resp.text[:300]}")

        file_data = resp.json()
        file_id = file_data.get("id")
        status = file_data.get("status", "processing")

        if not file_id:
            raise RuntimeError(f"Ark 未返回 file_id: {file_data}")

        # 等待处理完成
        for attempt in range(20):
            if status != "processing":
                break
            await asyncio.sleep(2)
            resp = await client.get(
                f"{base_url}/files/{file_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            status = resp.json().get("status", "processing")
            logger.debug(f"[SceneSplit] Ark 处理中: attempt={attempt + 1}")

        if status == "processing":
            raise RuntimeError(f"Ark 处理超时: file_id={file_id}")
        if status == "error":
            raise RuntimeError(f"Ark 处理失败: file_id={file_id}")

        logger.info(f"[SceneSplit] 上传完成: file_id={file_id}")
        return file_id


async def _call_vlm(file_id: str, api_key: str, model: str) -> Dict[str, Any]:
    """调用 Doubao VLM Responses API 进行场景分析"""
    base_url = "https://ark.cn-beijing.volces.com/api/v3"

    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_video", "file_id": file_id},
                    {"type": "input_text", "text": SCENE_DETECTION_PROMPT},
                ],
            }
        ],
    }

    logger.info(f"[SceneSplit] 调用 VLM: model={model}, file_id={file_id}")

    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(
            f"{base_url}/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

        if resp.status_code != 200:
            raise RuntimeError(
                f"Ark Responses API 失败 (HTTP {resp.status_code}): {resp.text[:500]}"
            )

        data = resp.json()

    # 提取输出文本（Responses API 格式）
    raw_text = ""
    for output_item in data.get("output", []):
        if output_item.get("type") == "message":
            for content_item in output_item.get("content", []):
                if content_item.get("type") == "output_text":
                    raw_text = content_item.get("text", "")
                    break
            if raw_text:
                break

    # 兼容 choices 格式
    if not raw_text:
        choices = data.get("choices", [])
        if choices:
            raw_text = choices[0].get("message", {}).get("content", "")

    if not raw_text:
        raise RuntimeError(f"VLM 无有效输出: {str(data)[:300]}")

    logger.info(f"[SceneSplit] VLM 返回 {len(raw_text)} chars")

    # 解析 JSON（容错）
    parsed = _parse_json_response(raw_text)
    if parsed is None:
        raise RuntimeError(f"无法解析 VLM 返回的 JSON: {raw_text[:300]}")

    return parsed


async def _delete_ark_file(file_id: str, api_key: str):
    """清理 Ark 文件（最佳努力）"""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.delete(
                f"https://ark.cn-beijing.volces.com/api/v3/files/{file_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
    except Exception:
        pass


def _parse_json_response(text: str) -> Optional[Dict[str, Any]]:
    """从 VLM 返回文本中提取 JSON"""
    # 直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 从 ```json ... ``` 中提取
    m = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 从 { ... } 中提取
    m = re.search(r'\{[\s\S]*\}', text)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return None


def _build_segments_from_vlm(
    vlm_result: Dict[str, Any],
    total_duration: float,
) -> List[SceneSegment]:
    """从 VLM 结果构建场景片段列表"""

    # 优先用 VLM 返回的 scenes
    scenes = vlm_result.get("scenes", [])
    if scenes and len(scenes) > 1:
        segments = []
        for s in scenes:
            seg = SceneSegment(
                index=s.get("index", len(segments)),
                start_sec=float(s.get("start_sec", 0)),
                end_sec=float(s.get("end_sec", total_duration)),
                description=s.get("description", ""),
            )
            segments.append(seg)

        # 修正边界
        segments[0].start_sec = 0.0
        segments[-1].end_sec = total_duration

        # 过滤掉太短的
        segments = _merge_short_segments(segments)
        return segments

    # fallback: 从 cuts 构建
    cuts = vlm_result.get("cuts", [])
    if not cuts:
        return []

    boundaries = sorted(set([0.0] + [float(c.get("time_sec", 0)) for c in cuts] + [total_duration]))
    raw = []
    for i in range(len(boundaries) - 1):
        raw.append(SceneSegment(
            index=i,
            start_sec=boundaries[i],
            end_sec=boundaries[i + 1],
        ))

    return _merge_short_segments(raw)


def _merge_short_segments(segments: List[SceneSegment]) -> List[SceneSegment]:
    """合并过短片段"""
    if len(segments) <= 1:
        return segments

    merged = [segments[0]]
    for seg in segments[1:]:
        if merged[-1].duration_sec < MIN_SCENE_DURATION_SEC:
            # 向后合并
            merged[-1] = SceneSegment(
                index=merged[-1].index,
                start_sec=merged[-1].start_sec,
                end_sec=seg.end_sec,
                description=merged[-1].description or seg.description,
            )
        else:
            merged.append(seg)

    # 最后一个太短 → 并入前一个
    if len(merged) > 1 and merged[-1].duration_sec < MIN_SCENE_DURATION_SEC:
        merged[-2] = SceneSegment(
            index=merged[-2].index,
            start_sec=merged[-2].start_sec,
            end_sec=merged[-1].end_sec,
            description=merged[-2].description,
        )
        merged.pop()

    # 重编号
    for i, seg in enumerate(merged):
        seg.index = i

    # 限制最大数量
    while len(merged) > MAX_SEGMENTS:
        min_idx = min(range(len(merged)), key=lambda k: merged[k].duration_sec)
        if min_idx > 0:
            merged[min_idx - 1] = SceneSegment(
                index=0, start_sec=merged[min_idx - 1].start_sec,
                end_sec=merged[min_idx].end_sec,
            )
            merged.pop(min_idx)
        else:
            merged[0] = SceneSegment(
                index=0, start_sec=merged[0].start_sec,
                end_sec=merged[1].end_sec,
            )
            merged.pop(1)
        for i, seg in enumerate(merged):
            seg.index = i

    return merged


async def _probe_duration(video_path: str) -> float:
    """用 ffprobe 获取视频时长"""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        video_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
    try:
        return float(stdout.decode().strip())
    except (ValueError, AttributeError):
        return 0.0


async def _capture_thumbnail(video_path: str, time_sec: float, output_path: str) -> bool:
    """截取单帧缩略图（低分辨率，用于预览）"""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-ss", str(time_sec),
        "-i", video_path,
        "-vframes", "1",
        "-vf", "scale=320:-2",
        "-q:v", "2",
        output_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await asyncio.wait_for(proc.communicate(), timeout=30)
    except asyncio.TimeoutError:
        proc.kill()
        return False
    return proc.returncode == 0 and os.path.exists(output_path)


async def _extract_keyframe(video_path: str, time_sec: float, output_path: str) -> bool:
    """提取全分辨率关键帧（高画质，作为 image node 的主内容）"""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y",
        "-ss", str(time_sec),
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "1",
        output_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        await asyncio.wait_for(proc.communicate(), timeout=30)
    except asyncio.TimeoutError:
        proc.kill()
        return False
    return proc.returncode == 0 and os.path.exists(output_path)


# ==========================================
# 公开 API
# ==========================================

async def analyze_and_split(
    clip_id: str,
    supabase_client,
    threshold: float = 0.3,  # 保留参数签名兼容，VLM 不需要
) -> SplitResult:
    """
    VLM 驱动的镜头拆分 — 提取关键帧 image 节点

    1. 查 canvas_nodes 获取视频信息
    2. 下载视频 → 上传到 Ark
    3. Doubao VLM 分析场景切换
    4. 每个场景提取最稳定关键帧 → 上传 storage
    5. 创建 media_type='image' 的 canvas_nodes（保留原视频节点）
    """
    from app.config import get_settings
    settings = get_settings()

    api_key = settings.volcengine_ark_api_key
    model = settings.doubao_seed_1_8_endpoint

    if not api_key:
        return SplitResult(success=False, reason="VLM API 未配置", segments=[])

    # --- 1. 查 canvas_nodes（Visual Editor 唯一数据源） ---
    node = None
    try:
        res = supabase_client.table("canvas_nodes").select("*").eq("id", clip_id).single().execute()
        node = res.data
    except Exception:
        pass

    if not node:
        return SplitResult(
            success=False,
            reason="节点数据未持久化，请刷新页面后重试",
            segments=[],
        )

    if node.get("media_type") != "video":
        return SplitResult(success=False, reason="仅支持视频节点拆分", segments=[])

    # 获取视频 URL
    video_url = node.get("video_url")
    if not video_url:
        asset_id = node.get("asset_id")
        if asset_id:
            try:
                asset_res = supabase_client.table("assets").select(
                    "cf_stream_url, storage_url, cached_url"
                ).eq("id", asset_id).single().execute()
                if asset_res.data:
                    a = asset_res.data
                    video_url = (
                        a.get("cf_stream_url")
                        or a.get("storage_url")
                        or a.get("cached_url")
                    )
            except Exception:
                pass

    if not video_url:
        return SplitResult(success=False, reason="找不到视频源", segments=[])

    # --- 2. 下载视频 ---
    temp_dir = tempfile.mkdtemp(prefix="scene_split_")
    file_id = None

    try:
        video_path = await _download_video(video_url, temp_dir)
        if not video_path:
            return SplitResult(success=False, reason="视频下载失败", segments=[])

        total_duration = await _probe_duration(video_path)
        node_duration = node.get("duration") or (
            node.get("end_time", 0) - node.get("start_time", 0)
        )
        if total_duration <= 0:
            total_duration = node_duration
        if total_duration < MIN_CLIP_DURATION_SEC:
            return SplitResult(
                success=False,
                reason=f"视频太短（{total_duration:.1f}秒），至少需要 {MIN_CLIP_DURATION_SEC:.0f} 秒",
                segments=[],
            )

        # --- 3. 上传到 Ark + VLM 分析 ---
        file_id = await _upload_to_ark(video_path, api_key)
        vlm_result = await _call_vlm(file_id, api_key, model)

        logger.info(
            f"[SceneSplit] VLM 检测到 {vlm_result.get('scene_count', '?')} 个场景, "
            f"cuts={len(vlm_result.get('cuts', []))}"
        )

        # --- 4. 构建场景片段 ---
        vlm_duration = vlm_result.get("total_duration_sec")
        if vlm_duration and vlm_duration > 0:
            # VLM 可能更准确
            if abs(vlm_duration - total_duration) < total_duration * 0.3:
                total_duration = vlm_duration

        segments = _build_segments_from_vlm(vlm_result, total_duration)

        if len(segments) <= 1:
            return SplitResult(
                success=False,
                reason="VLM 未检测到镜头切换，视频可能是单一场景",
                segments=[],
            )

        logger.info(f"[SceneSplit] 最终 {len(segments)} 个场景片段")

        # --- 5. 为每个场景提取关键帧 → 创建 image canvas_nodes ---
        now = datetime.utcnow().isoformat()
        project_id = node.get("project_id")
        node_asset_id = node.get("asset_id")
        orig_meta = node.get("metadata") or {}
        orig_pos = node.get("canvas_position") or {"x": 200, "y": 200}
        BUCKET = "ai-creations"

        new_nodes: List[dict] = []
        for seg in segments:
            # 取场景中间帧作为最稳定的关键帧
            mid_time = (seg.start_sec + seg.end_sec) / 2
            frame_id = str(uuid4())
            frame_name = f"keyframe_{frame_id[:12]}.jpg"
            local_path = os.path.join(temp_dir, frame_name)

            ok = await _extract_keyframe(video_path, mid_time, local_path)
            if not ok:
                logger.warning(
                    f"[SceneSplit] 场景 {seg.index} 关键帧提取失败 "
                    f"(t={mid_time:.2f}s)，跳过"
                )
                continue

            # 上传关键帧到 Supabase storage
            storage_path = f"shot_thumbnails/{project_id}/{frame_name}"
            with open(local_path, "rb") as f:
                file_bytes = f.read()

            try:
                supabase_client.storage.from_(BUCKET).remove([storage_path])
            except Exception:
                pass

            supabase_client.storage.from_(BUCKET).upload(
                storage_path, file_bytes, {"content-type": "image/jpeg"}
            )
            public_url = supabase_client.storage.from_(BUCKET).get_public_url(
                storage_path
            )

            new_nodes.append({
                "id": frame_id,
                "project_id": project_id,
                "asset_id": node_asset_id,
                "node_type": node.get("node_type", "sequence"),
                "media_type": "image",
                "order_index": seg.index,
                "start_time": 0,
                "end_time": 0,
                "duration": 0,
                "source_start": 0,
                "source_end": 0,
                "video_url": None,
                "thumbnail_url": public_url,
                "canvas_position": {
                    "x": orig_pos.get("x", 200) + (seg.index + 1) * 340,
                    "y": orig_pos.get("y", 200),
                },
                "metadata": {
                    "split_index": seg.index,
                    "split_from": clip_id,
                    "aspect_ratio": orig_meta.get("aspect_ratio"),
                    "scene_start": round(seg.start_sec, 3),
                    "scene_end": round(seg.end_sec, 3),
                    "scene_description": seg.description,
                },
                "created_at": now,
                "updated_at": now,
            })

            # 清理本地帧文件
            try:
                os.remove(local_path)
            except Exception:
                pass

        if not new_nodes:
            return SplitResult(
                success=False,
                reason="关键帧提取全部失败",
                segments=[],
            )

        supabase_client.table("canvas_nodes").insert(new_nodes).execute()
        # ★ 保留原视频节点 — 关键帧 image 节点排列在其右侧
        logger.info(
            f"[SceneSplit] 拆镜头完成: {clip_id[:8]} → "
            f"{len(new_nodes)} 个关键帧 image 节点"
        )

        return SplitResult(
            success=True,
            reason=f"成功提取 {len(new_nodes)} 个场景关键帧",
            segments=segments,
        )

    finally:
        # 清理 Ark 文件
        if file_id:
            asyncio.create_task(_delete_ark_file(file_id, api_key))
        shutil.rmtree(temp_dir, ignore_errors=True)
