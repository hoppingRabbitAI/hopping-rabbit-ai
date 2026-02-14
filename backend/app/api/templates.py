"""
Templates API
Serve template metadata and Supabase public URLs.
"""
import asyncio
import logging
import os
import tempfile
import uuid
from typing import Optional, List, Dict, Any, Literal

from fastapi import APIRouter, Query, HTTPException, Depends, Body
from pydantic import BaseModel, Field

from app.services.supabase_client import supabase, get_file_url
from app.services.template_ingest_service import get_template_ingest_service
from app.services.template_render_service import get_template_render_service
from app.services.template_candidate_service import get_template_candidate_service
from app.api.auth import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/templates", tags=["Templates"])

TEMPLATE_BUCKET = "templates"
TEMPLATE_PREFIX = "visual-backgrounds/"


class TemplateIngestRequest(BaseModel):
    source_url: str = Field(..., description="爆款素材 URL")
    source_type: Literal["video", "image", "zip"] = Field("video", description="video|image|zip")
    extract_frames: int = Field(32, ge=1, le=64, description="自动分镜检测的最大模板数上限")
    clip_ranges: List[Dict[str, Any]] = Field(default_factory=list, description="可选片段范围")
    tags_hint: List[str] = Field(default_factory=list, description="可选标签提示")
    project_id: Optional[str] = Field(None, description="可选项目 ID")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="扩展参数")


class TemplateIngestResponse(BaseModel):
    job_id: str
    status: str
    estimated_time_sec: int = 30


class TemplateRenderRequest(BaseModel):
    prompt: Optional[str] = Field(None, description="用户提示词")
    negative_prompt: Optional[str] = Field(None, description="负向提示词")
    images: Optional[List[str]] = Field(None, description="多图生视频输入")
    video_url: Optional[str] = Field(None, description="动作控制参考视频")
    duration: Optional[str] = Field(None, description="视频时长")
    model_name: Optional[str] = Field(None, description="模型名称")
    cfg_scale: Optional[float] = Field(None, description="CFG scale")
    mode: Optional[str] = Field(None, description="生成模式")
    aspect_ratio: Optional[str] = Field(None, description="视频比例")
    character_orientation: Optional[str] = Field(None, description="人物朝向 image/video")
    from_template_id: Optional[str] = Field(None, description="转场 A 段模板 ID")
    to_template_id: Optional[str] = Field(None, description="转场 B 段模板 ID")
    boundary_ms: Optional[int] = Field(480, ge=200, le=2000, description="转场边界时长（毫秒）")
    quality_tier: Optional[Literal["style_match", "template_match", "pixel_match"]] = Field(
        "template_match", description="生成质量档位"
    )
    focus_modes: Optional[List[Literal["outfit_change", "subject_preserve", "scene_shift"]]] = Field(
        None, description="转场重点（多选）：换装/人物一致/场景切换"
    )
    # ── 向后兼容：旧客户端可能发送单值 focus_mode ──
    focus_mode: Optional[Literal["outfit_change", "subject_preserve", "scene_shift"]] = Field(
        None, description="(deprecated) 请使用 focus_modes"
    )
    golden_preset: Optional[Literal["spin_occlusion_outfit", "whip_pan_outfit", "space_warp_outfit"]] = Field(
        None, description="黄金转场模版：旋转遮挡/快甩变装/空间穿梭"
    )
    overrides: Optional[Dict[str, Any]] = Field(default_factory=dict, description="workflow 覆盖")
    project_id: Optional[str] = Field(None, description="项目 ID")
    clip_id: Optional[str] = Field(None, description="关联 clip ID")
    write_clip_metadata: bool = Field(True, description="是否将模板选择结果写入 clip metadata")


class TemplateCandidateRequest(TemplateRenderRequest):
    category: Optional[str] = Field(None, description="模板分类（ad/transition）")
    template_kind: Optional[str] = Field(None, description="模板类型（background/motion/transition）")
    scope: Optional[str] = Field(None, description="模板作用域过滤")
    pack_id: Optional[str] = Field(None, description="转场模板包 ID")
    limit: int = Field(3, ge=1, le=10, description="候选数量")
    auto_render: bool = Field(False, description="是否自动创建 Kling 任务")


class TransitionReplicaRequest(BaseModel):
    from_image_url: str = Field(..., description="首帧图片 URL")
    to_image_url: str = Field(..., description="尾帧图片 URL")
    prompt: Optional[str] = Field(None, description="可选补充提示词")
    negative_prompt: Optional[str] = Field(None, description="可选负向提示词")
    duration: Optional[str] = Field(None, description="视频时长")
    mode: Optional[str] = Field(None, description="生成模式")
    aspect_ratio: Optional[str] = Field(None, description="视频比例")
    boundary_ms: Optional[int] = Field(480, ge=200, le=2000, description="转场边界时长（毫秒）")
    quality_tier: Optional[Literal["style_match", "template_match", "pixel_match"]] = Field(
        "template_match", description="生成质量档位"
    )
    focus_modes: Optional[List[Literal["outfit_change", "subject_preserve", "scene_shift"]]] = Field(
        None, description="复刻重点（多选）：换装/人物一致/场景切换"
    )
    # ── 向后兼容：旧客户端可能发送单值 focus_mode ──
    focus_mode: Optional[Literal["outfit_change", "subject_preserve", "scene_shift"]] = Field(
        None, description="(deprecated) 请使用 focus_modes"
    )
    golden_preset: Optional[Literal["spin_occlusion_outfit", "whip_pan_outfit", "space_warp_outfit"]] = Field(
        "spin_occlusion_outfit", description="黄金转场模版"
    )
    apply_mode: Literal["insert_between", "merge_clips"] = Field(
        "insert_between", description="应用方式：在中间插入或合并两段"
    )
    variant_count: int = Field(1, ge=1, le=3, description="生成数量：1=单次, 2=精准vs创意对比, 3=全参数对比（不同 cfg_scale）")
    project_id: Optional[str] = Field(None, description="项目 ID")
    clip_id: Optional[str] = Field(None, description="关联 clip ID")
    overrides: Optional[Dict[str, Any]] = Field(default_factory=dict, description="workflow 覆盖")


class TransitionBoundaryFramesRequest(BaseModel):
    from_clip_id: str = Field(..., description="前一个 clip ID")
    to_clip_id: str = Field(..., description="后一个 clip ID")
    tail_offset_ms: int = Field(80, ge=0, le=2000, description="前 clip 尾帧偏移")
    head_offset_ms: int = Field(80, ge=0, le=2000, description="后 clip 首帧偏移")


async def _probe_duration_sec(video_url: str) -> Optional[float]:
    """探测视频时长。

    依次尝试:
    1. format=duration（容器级时长）
    2. stream=duration（流级时长，对某些 mp4/webm 更可靠）
    如果都拿不到有效数字，返回 None 而不是抛异常，让调用方用 clip 元数据兜底。
    """
    strategies = [
        ["format=duration"],
        ["stream=duration"],
    ]
    for entries in strategies:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", entries[0],
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_url,
        ]
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await process.communicate()
        raw = (stdout or b"").decode(errors="ignore").strip()
        # ffprobe 可能输出多行（多流），取第一个有效数字
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.upper() == "N/A":
                continue
            try:
                val = float(line)
                if val > 0:
                    return val
            except ValueError:
                continue
    # 所有策略均未拿到有效时长
    return None


async def _extract_frame_file(video_url: str, timestamp_sec: float, output_path: str) -> None:
    seek = max(float(timestamp_sec), 0.0)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-ss",
        f"{seek:.3f}",
        "-i",
        video_url,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        output_path,
    ]
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg extract failed: {(stderr or b'').decode(errors='ignore')[:240]}")


def _resolve_clip_video_context(clip_id: str) -> Dict[str, Any]:
    clip = (
        supabase.table("clips")
        .select("id,asset_id,cached_url,source_start,source_end,start_time,end_time")
        .eq("id", clip_id)
        .single()
        .execute()
        .data
    )
    if not clip:
        raise HTTPException(status_code=404, detail=f"Clip not found: {clip_id}")

    if clip.get("cached_url"):
        # ★ 图生视频 / AI 生成类 clip：cached_url 即为最终视频
        # 这类 clip 通常在创建时已写入 source_start/source_end/start_time/end_time
        # 把这些时长信息保留下来，供后续 _calc_timestamp 使用，避免完全依赖 ffprobe
        src_start_ms = clip.get("source_start") or 0
        src_end_ms = clip.get("source_end")
        st_ms = clip.get("start_time") or 0
        et_ms = clip.get("end_time") or st_ms
        clip_dur = max((et_ms - st_ms) / 1000.0, 0.0)

        source_start_sec = max(src_start_ms / 1000.0, 0.0)
        source_end_sec = src_end_ms / 1000.0 if src_end_ms is not None else None
        if source_end_sec is None and clip_dur > 0:
            source_end_sec = source_start_sec + clip_dur

        return {
            "video_url": clip.get("cached_url"),
            "source_start_sec": source_start_sec,
            "source_end_sec": source_end_sec,
            "clip_duration_sec": clip_dur if clip_dur > 0 else None,
        }

    asset_id = clip.get("asset_id")
    if not asset_id:
        raise HTTPException(status_code=400, detail=f"Clip {clip_id} 缺少可访问的视频 URL")

    asset = (
        supabase.table("assets")
        .select("storage_path")
        .eq("id", asset_id)
        .single()
        .execute()
        .data
    )
    if not asset or not asset.get("storage_path"):
        raise HTTPException(status_code=400, detail=f"Clip {clip_id} 无法解析 asset storage_path")

    video_url = get_file_url("clips", asset.get("storage_path"), expires_in=3600)

    source_start_ms = clip.get("source_start") or 0
    source_end_ms = clip.get("source_end")
    start_time_ms = clip.get("start_time") or 0
    end_time_ms = clip.get("end_time") or start_time_ms
    clip_duration_sec = max((end_time_ms - start_time_ms) / 1000.0, 0.0)

    source_start_sec = max(source_start_ms / 1000.0, 0.0)
    source_end_sec = source_end_ms / 1000.0 if source_end_ms is not None else None
    if source_end_sec is None and clip_duration_sec > 0:
        source_end_sec = source_start_sec + clip_duration_sec

    return {
        "video_url": video_url,
        "source_start_sec": source_start_sec,
        "source_end_sec": source_end_sec,
        "clip_duration_sec": clip_duration_sec,
    }


def _upload_transition_frame(file_path: str, role: str) -> str:
    frame_name = f"transition-inputs/{role}-{uuid.uuid4().hex[:12]}.jpg"
    with open(file_path, "rb") as f:
        payload = f.read()
    supabase.storage.from_(TEMPLATE_BUCKET).upload(
        frame_name,
        payload,
        {"content-type": "image/jpeg", "upsert": "true"},
    )
    return supabase.storage.from_(TEMPLATE_BUCKET).get_public_url(frame_name)


def _public_url(bucket: str, path: Optional[str]) -> str:
    if not path:
        return ""
    return supabase.storage.from_(bucket).get_public_url(path)


def _load_template_record(template_id: str) -> Optional[Dict[str, Any]]:
    try:
        return (
            supabase.table("template_records")
            .select("*")
            .eq("template_id", template_id)
            .single()
            .execute()
            .data
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load template: {exc}")


def _resolve_template_url(record: Dict[str, Any]) -> str:
    storage_path = record.get("storage_path")
    bucket = record.get("bucket") or TEMPLATE_BUCKET
    return record.get("url") or _public_url(bucket, storage_path)


def _extract_template_scene_hint(record: Dict[str, Any]) -> str:
    workflow_raw = record.get("workflow") or {}
    workflow = workflow_raw if isinstance(workflow_raw, dict) else {}
    metadata_raw = record.get("metadata") or {}
    metadata = metadata_raw if isinstance(metadata_raw, dict) else {}

    for key in ("prompt_seed", "scene_description", "visual_description", "analysis_description"):
        candidate = workflow.get(key) or metadata.get(key)
        if isinstance(candidate, str):
            value = candidate.strip()
            if len(value) >= 4:
                return value[:220]

    tags = record.get("tags") or []
    tag_text = ", ".join(str(tag).strip() for tag in tags if str(tag).strip())
    if tag_text:
        return tag_text[:180]

    name = str(record.get("name") or "").strip()
    return name[:120]


def _normalize_text(value: Any) -> Optional[str]:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None


def _resolve_prompt_by_policy(
    publish_config: Dict[str, Any],
    incoming_prompt: Optional[str],
) -> Optional[str]:
    policy = str(publish_config.get("prompt_policy") or "auto_plus_default_plus_user")
    default_prompt = _normalize_text(publish_config.get("default_prompt"))
    incoming = _normalize_text(incoming_prompt)
    allow_override_raw = publish_config.get("allow_prompt_override")
    allow_override = True if allow_override_raw is None else bool(allow_override_raw)

    if policy == "auto_only":
        return None
    if policy == "auto_plus_default":
        return default_prompt
    if not allow_override:
        return default_prompt
    return incoming or default_prompt


def _resolve_negative_prompt(
    publish_config: Dict[str, Any],
    incoming_negative_prompt: Optional[str],
) -> Optional[str]:
    default_negative = _normalize_text(publish_config.get("default_negative_prompt"))
    incoming = _normalize_text(incoming_negative_prompt)
    allow_override_raw = publish_config.get("allow_prompt_override")
    allow_override = True if allow_override_raw is None else bool(allow_override_raw)

    if not allow_override:
        return default_negative
    return incoming or default_negative


@router.get("")
def list_templates(
    category: Optional[str] = None,
    template_type: Optional[str] = Query(None, alias="type"),
    scope: Optional[str] = None,
    pack_id: Optional[str] = Query(None, description="转场模板包 ID 过滤"),
    include_workflow: bool = Query(False, description="是否返回 workflow 配置"),
    status: Optional[str] = Query(None, description="发布状态过滤: draft/published/archived，默认仅返回 published"),
) -> Dict[str, Any]:
    try:
        query = supabase.table("template_records").select(
            "template_id,name,category,type,tags,bucket,storage_path,thumbnail_path,url,thumbnail_url,workflow,metadata,status,quality_label,published_at,publish_config,preview_video_url,created_at"
        )
        if category:
            query = query.eq("category", category)
        if template_type:
            query = query.eq("type", template_type)
        # 状态过滤：指定 status 时精确匹配，'all' 不过滤，默认只返回 published
        if status and status != "all":
            query = query.eq("status", status)
        elif not status:
            query = query.eq("status", "published")
        result = query.order("created_at", desc=True).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load templates: {e}")

    records = result.data or []
    items: List[Dict[str, Any]] = []

    for record in records:
        metadata_raw = record.get("metadata") or {}
        metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
        scopes = metadata.get("scopes") or []
        if scope and scopes and scope not in scopes:
            continue

        if pack_id:
            transition_pack = metadata.get("transition_pack") or {}
            if transition_pack.get("pack_id") != pack_id:
                continue

        bucket = record.get("bucket") or TEMPLATE_BUCKET
        storage_path = record.get("storage_path") or ""
        thumbnail_path = record.get("thumbnail_path")
        url = record.get("url") or _public_url(bucket, storage_path)
        thumbnail_url = record.get("thumbnail_url") or _public_url(
            bucket, thumbnail_path or storage_path
        )

        item = {
            "id": record.get("template_id"),
            "name": record.get("name"),
            "category": record.get("category", "all"),
            "type": record.get("type", "background"),
            "url": url,
            "thumbnail_url": thumbnail_url,
            "storage_path": storage_path,
            "thumbnail_storage_path": thumbnail_path,
            "scopes": scopes,
            "tags": record.get("tags") or [],
            "status": record.get("status", "published"),
            "quality_label": record.get("quality_label"),
            "publish_config": record.get("publish_config") or {},
            "preview_video_url": record.get("preview_video_url"),
        }
        transition_spec = metadata.get("transition_spec") or {}
        if transition_spec:
            item["transition_spec"] = {
                "version": transition_spec.get("version"),
                "family": transition_spec.get("family"),
                "duration_ms": transition_spec.get("duration_ms"),
                "quality_tier": transition_spec.get("quality_tier"),
                "transition_category": transition_spec.get("transition_category"),
                "transition_description": transition_spec.get("transition_description"),
                "motion_pattern": transition_spec.get("motion_pattern"),
                "camera_movement": transition_spec.get("camera_movement"),
                "scene_a_description": transition_spec.get("scene_a_description"),
                "scene_b_description": transition_spec.get("scene_b_description"),
                "recommended_prompt": transition_spec.get("recommended_prompt"),
                "motion_prompt": transition_spec.get("motion_prompt"),
                "camera_compound": transition_spec.get("camera_compound"),
                "background_motion": transition_spec.get("background_motion"),
                "subject_motion": transition_spec.get("subject_motion"),
                "_analysis_method": transition_spec.get("_analysis_method"),
                "transition_window": transition_spec.get("transition_window"),
                "technical_dissection": transition_spec.get("technical_dissection"),
            }
        transition_pack = metadata.get("transition_pack") or {}
        if transition_pack.get("pack_id"):
            item["pack_id"] = transition_pack.get("pack_id")

        # ── Phase 5b: recipe_digest — 让模板卡片直接展示配方摘要 ──
        golden_match = metadata.get("golden_match")
        golden_fingerprint = metadata.get("golden_fingerprint")
        pc = record.get("publish_config") or {}
        provenance_raw = pc.get("_provenance") or {} if isinstance(pc, dict) else {}
        has_analysis = bool(transition_spec.get("family"))
        has_match = bool(golden_match and golden_match.get("profile_name"))
        has_config = bool(pc and any(k.startswith("default_") for k in (pc if isinstance(pc, dict) else {})))
        recipe_digest: Dict[str, Any] = {
            "has_analysis": has_analysis,
            "has_match": has_match,
            "has_config": has_config,
            "readiness": "ready" if (has_analysis and has_config) else "partial" if has_analysis else "pending",
        }
        if has_analysis:
            recipe_digest["analysis_summary"] = {
                "family": transition_spec.get("family"),
                "transition_category": transition_spec.get("transition_category"),
                "camera_movement": transition_spec.get("camera_movement"),
                "duration_ms": transition_spec.get("duration_ms"),
                "motion_pattern": transition_spec.get("motion_pattern"),
            }
            # 多维度评分（LLM 视觉分析得出）
            dim_scores = transition_spec.get("dimension_scores")
            if dim_scores and isinstance(dim_scores, dict):
                recipe_digest["dimension_scores"] = dim_scores
                recipe_digest["recommended_focus_modes"] = transition_spec.get("recommended_focus_modes", [])
        if has_match:
            recipe_digest["golden_match"] = {
                "profile_name": golden_match.get("profile_name"),
                "score": golden_match.get("score", 0),
                "match_level": golden_match.get("match_level", "low"),
            }
        if provenance_raw:
            recipe_digest["provenance"] = {
                "source_profile": provenance_raw.get("source_profile"),
                "auto_filled_keys": provenance_raw.get("auto_filled_keys", []),
                "admin_overrides": provenance_raw.get("admin_overrides", []),
                "focus_modes_source": provenance_raw.get("focus_modes_source"),
            }
        item["recipe_digest"] = recipe_digest

        if include_workflow:
            item["workflow"] = record.get("workflow") or {}
        items.append(item)

    return {
        "bucket": TEMPLATE_BUCKET,
        "prefix": TEMPLATE_PREFIX,
        "items": items,
    }


@router.post("/ingest", response_model=TemplateIngestResponse)
async def create_ingest_job(payload: TemplateIngestRequest) -> TemplateIngestResponse:
    metadata = dict(payload.metadata or {})

    job_data = {
        "status": "queued",
        "progress": 0,
        "source_url": payload.source_url,
        "source_type": payload.source_type,
        "template_type": "transition",  # 统一走自动分镜检测管线
        "extract_frames": payload.extract_frames,
        "clip_ranges": payload.clip_ranges,
        "tags_hint": payload.tags_hint,
        "params": {
            "project_id": payload.project_id,
            "metadata": metadata,
        },
    }

    try:
        result = supabase.table("template_ingest_jobs").insert(job_data).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create ingest job: {e}")

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create ingest job")

    job = result.data[0]
    get_template_ingest_service().enqueue(job["id"])
    return TemplateIngestResponse(job_id=job["id"], status=job["status"])


@router.get("/ingest/{job_id}")
def get_ingest_job(job_id: str) -> Dict[str, Any]:
    try:
        result = supabase.table("template_ingest_jobs").select("*").eq("id", job_id).single().execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load ingest job: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Ingest job not found")

    return result.data


@router.post("/transition/clip-boundary-frames")
async def extract_transition_clip_boundary_frames(
    payload: TransitionBoundaryFramesRequest,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    _ = user_id  # 当前版本仅用于鉴权入口，权限校验沿用 clip 查询链路

    from_ctx = _resolve_clip_video_context(payload.from_clip_id)
    to_ctx = _resolve_clip_video_context(payload.to_clip_id)

    # ★ 探测视频时长；若 ffprobe 无法获取（外部 CDN / 图生视频），用 clip 元数据兜底
    from_duration = await _probe_duration_sec(from_ctx["video_url"])
    to_duration = await _probe_duration_sec(to_ctx["video_url"])

    def _resolve_effective_duration(ctx: Dict[str, Any], probed: Optional[float]) -> float:
        """综合 ffprobe 结果与 clip 元数据，返回最终可用时长（秒）。"""
        if probed and probed > 0:
            return probed
        # ffprobe 拿不到 → 用 clip 自身的 source_end / clip_duration 推算
        se = ctx.get("source_end_sec")
        if se and se > 0:
            return float(se)
        cd = ctx.get("clip_duration_sec")
        if cd and cd > 0:
            return float(ctx.get("source_start_sec") or 0) + float(cd)
        raise HTTPException(
            status_code=400,
            detail="无法确定分镜时长：ffprobe 与 clip 元数据均无有效时长信息",
        )

    from_duration_eff = _resolve_effective_duration(from_ctx, from_duration)
    to_duration_eff = _resolve_effective_duration(to_ctx, to_duration)

    def _calc_timestamp(context: Dict[str, Any], *, is_tail: bool, offset_ms: int, duration_sec: float) -> float:
        start_sec = float(context.get("source_start_sec") or 0.0)
        end_sec = context.get("source_end_sec")
        if end_sec is None:
            clip_duration = context.get("clip_duration_sec")
            if clip_duration:
                end_sec = start_sec + float(clip_duration)
            else:
                end_sec = duration_sec

        end_sec = min(float(end_sec), duration_sec) if duration_sec > 0 else float(end_sec)
        end_sec = max(end_sec, start_sec)
        offset_sec = max(float(offset_ms) / 1000.0, 0.0)

        if is_tail:
            target = end_sec - offset_sec
            if end_sec - start_sec > 0.04:
                target = min(target, end_sec - 0.02)
            return max(start_sec, target)

        target = start_sec + offset_sec
        if end_sec - start_sec > 0.04:
            target = min(target, end_sec - 0.02)
        return max(start_sec, min(target, end_sec))

    from_ts = _calc_timestamp(from_ctx, is_tail=True, offset_ms=payload.tail_offset_ms, duration_sec=from_duration_eff)
    to_ts = _calc_timestamp(to_ctx, is_tail=False, offset_ms=payload.head_offset_ms, duration_sec=to_duration_eff)

    try:
        with tempfile.TemporaryDirectory(prefix="transition-frames-") as tmp_dir:
            from_frame = os.path.join(tmp_dir, "from_tail.jpg")
            to_frame = os.path.join(tmp_dir, "to_head.jpg")

            await _extract_frame_file(from_ctx["video_url"], from_ts, from_frame)
            await _extract_frame_file(to_ctx["video_url"], to_ts, to_frame)

            from_url = _upload_transition_frame(from_frame, "from")
            to_url = _upload_transition_frame(to_frame, "to")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"提取转场边界帧失败: {exc}")

    return {
        "success": True,
        "from_clip_id": payload.from_clip_id,
        "to_clip_id": payload.to_clip_id,
        "from_image_url": from_url,
        "to_image_url": to_url,
        "from_timestamp_sec": round(from_ts, 3),
        "to_timestamp_sec": round(to_ts, 3),
    }


@router.post("/{template_id}/render")
def render_template(
    template_id: str,
    payload: TemplateRenderRequest,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    logger.info("[TemplateRender API] 收到渲染请求 template_id=%s user_id=%s", template_id, user_id)

    record = _load_template_record(template_id)
    if not record:
        raise HTTPException(status_code=404, detail="Template not found")

    render_params = payload.model_dump()

    # Phase 3: 合并 publish_config 默认值（用户传入的参数优先）
    publish_config = record.get("publish_config") or {}
    if publish_config:
        _config_field_map = {
            "default_focus_modes": "focus_modes",
            "default_golden_preset": "golden_preset",
            "default_duration": "duration",
            "default_mode": "mode",
            "default_cfg_scale": "cfg_scale",
            "default_boundary_ms": "boundary_ms",
            "default_prompt": "prompt",
            "default_negative_prompt": "negative_prompt",
        }
        for config_key, param_key in _config_field_map.items():
            if render_params.get(param_key) is None and publish_config.get(config_key) is not None:
                render_params[param_key] = publish_config[config_key]

        render_params["prompt"] = _resolve_prompt_by_policy(
            publish_config,
            render_params.get("prompt"),
        )
        render_params["negative_prompt"] = _resolve_negative_prompt(
            publish_config,
            render_params.get("negative_prompt"),
        )

    from_template_id = render_params.get("from_template_id")
    to_template_id = render_params.get("to_template_id")

    if from_template_id or to_template_id:
        if not (from_template_id and to_template_id):
            raise HTTPException(status_code=400, detail="from_template_id 和 to_template_id 需同时提供")

        from_record = _load_template_record(str(from_template_id))
        to_record = _load_template_record(str(to_template_id))
        if not from_record:
            raise HTTPException(status_code=404, detail=f"From template not found: {from_template_id}")
        if not to_record:
            raise HTTPException(status_code=404, detail=f"To template not found: {to_template_id}")

        from_url = _resolve_template_url(from_record)
        to_url = _resolve_template_url(to_record)
        if not from_url or not to_url:
            raise HTTPException(status_code=400, detail="无法解析转场输入模板素材 URL")

        render_params["images"] = [from_url, to_url]
        render_params["transition_inputs"] = {
            "from_template_id": from_template_id,
            "to_template_id": to_template_id,
            "from_template_name": from_record.get("name"),
            "to_template_name": to_record.get("name"),
            "from_scene_hint": _extract_template_scene_hint(from_record),
            "to_scene_hint": _extract_template_scene_hint(to_record),
            "focus_modes": render_params.get("focus_modes") or ([render_params["focus_mode"]] if render_params.get("focus_mode") else None),
            "golden_preset": render_params.get("golden_preset"),
            "boundary_ms": render_params.get("boundary_ms") or 480,
            "quality_tier": render_params.get("quality_tier") or "template_match",
        }

        overrides = dict(render_params.get("overrides") or {})
        overrides.setdefault("kling_endpoint", "multi_image_to_video")
        render_params["overrides"] = overrides

    try:
        result = get_template_render_service().create_task(
            template_record=record,
            render_params=render_params,
            user_id=user_id,
        )
        return {"success": True, **result}
    except Exception as exc:
        logger.error("[TemplateRender API] 创建任务失败: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{template_id}/replicate")
def replicate_transition_template(
    template_id: str,
    payload: TransitionReplicaRequest,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """两图复刻转场：针对换装等场景一次创建多条候选任务。"""
    logger.info("[TemplateReplica API] 收到复刻请求 template_id=%s user_id=%s", template_id, user_id)

    record = _load_template_record(template_id)
    if not record:
        raise HTTPException(status_code=404, detail="Template not found")

    if str(record.get("type") or "").lower() != "transition":
        raise HTTPException(status_code=400, detail="replicate 仅支持 transition 模板")

    render_params = {
        "prompt": payload.prompt,
        "negative_prompt": payload.negative_prompt,
        "duration": payload.duration,
        "mode": payload.mode,
        "aspect_ratio": payload.aspect_ratio,
        "boundary_ms": payload.boundary_ms,
        "quality_tier": payload.quality_tier,
        "golden_preset": payload.golden_preset,
        "project_id": payload.project_id,
        "clip_id": payload.clip_id,
        "overrides": payload.overrides,
    }

    # Phase 3: 合并 publish_config 默认值（用户传入的参数优先）
    publish_config = record.get("publish_config") or {}
    if publish_config:
        _config_defaults = {
            "default_duration": "duration",
            "default_mode": "mode",
            "default_cfg_scale": "cfg_scale",
            "default_boundary_ms": "boundary_ms",
            "default_golden_preset": "golden_preset",
            "default_prompt": "prompt",
            "default_negative_prompt": "negative_prompt",
        }
        for config_key, param_key in _config_defaults.items():
            if render_params.get(param_key) is None and publish_config.get(config_key) is not None:
                render_params[param_key] = publish_config[config_key]

        render_params["prompt"] = _resolve_prompt_by_policy(
            publish_config,
            render_params.get("prompt"),
        )
        render_params["negative_prompt"] = _resolve_negative_prompt(
            publish_config,
            render_params.get("negative_prompt"),
        )

    # 解析 effective focus_modes：优先 payload → publish_config → 默认值
    effective_focus_modes = payload.focus_modes or ([payload.focus_mode] if payload.focus_mode else None)
    if not effective_focus_modes and publish_config.get("default_focus_modes"):
        effective_focus_modes = publish_config["default_focus_modes"]
    if not effective_focus_modes:
        effective_focus_modes = ["outfit_change"]

    try:
        result = get_template_render_service().create_transition_replica_batch(
            template_record=record,
            render_params=render_params,
            user_id=user_id,
            from_image_url=payload.from_image_url,
            to_image_url=payload.to_image_url,
            focus_modes=effective_focus_modes,
            golden_preset=payload.golden_preset,
            apply_mode=payload.apply_mode,
            variant_count=payload.variant_count,
        )
    except Exception as exc:
        logger.error("[TemplateReplica API] 创建复刻任务失败: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "success": True,
        "template_id": template_id,
        **result,
    }


@router.post("/candidates")
async def list_candidates(
    payload: TemplateCandidateRequest,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    service = get_template_candidate_service()
    templates = await service.get_candidates(
        category=payload.category,
        template_kind=payload.template_kind,
        scope=payload.scope,
        prompt=payload.prompt,
        limit=payload.limit,
        pack_id=payload.pack_id,
    )
    render_params = payload.model_dump(exclude={"category", "template_kind", "scope", "pack_id", "limit", "auto_render"})
    candidates = service.build_render_specs(templates, render_params)

    if payload.auto_render:
        render_service = get_template_render_service()
        rendered = []
        for candidate in candidates:
            template_id = candidate["template_id"]
            record = next((t for t in templates if t.get("template_id") == template_id), None)
            if not record:
                continue
            try:
                task = render_service.create_task(record, render_params, user_id)
            except Exception as exc:
                task = {"error": str(exc)}
            rendered.append({**candidate, "task": task})
        return {"candidates": rendered, "auto_render": True}

    return {"candidates": candidates, "auto_render": False}


@router.post("/{template_id}/publish")
def publish_template(
    template_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """将模板从 draft 发布为 published"""
    record = _load_template_record(template_id)
    if not record:
        raise HTTPException(status_code=404, detail="Template not found")

    current_status = record.get("status", "draft")
    if current_status == "published":
        return {"success": True, "template_id": template_id, "status": "published", "message": "已是发布状态"}

    try:
        from datetime import datetime, timezone
        supabase.table("template_records").update({
            "status": "published",
            "published_at": datetime.now(timezone.utc).isoformat(),
        }).eq("template_id", template_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"发布失败: {exc}")

    logger.info("[TemplatePublish] 模板已发布: %s by user %s", template_id, user_id)
    return {"success": True, "template_id": template_id, "status": "published"}


@router.post("/{template_id}/unpublish")
def unpublish_template(
    template_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """将模板从 published 下架为 draft"""
    record = _load_template_record(template_id)
    if not record:
        raise HTTPException(status_code=404, detail="Template not found")

    current_status = record.get("status", "draft")
    if current_status == "draft":
        return {"success": True, "template_id": template_id, "status": "draft", "message": "已是草稿状态"}

    try:
        supabase.table("template_records").update({
            "status": "draft",
        }).eq("template_id", template_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"下架失败: {exc}")

    logger.info("[TemplateUnpublish] 模板已下架: %s by user %s", template_id, user_id)
    return {"success": True, "template_id": template_id, "status": "draft"}


@router.post("/batch-publish")
def batch_publish_templates(
    template_ids: List[str] = Body(..., embed=True),
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """批量发布模板"""
    if not template_ids:
        raise HTTPException(status_code=400, detail="template_ids is required")

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    published = []
    failed = []

    for tid in template_ids:
        try:
            supabase.table("template_records").update({
                "status": "published",
                "published_at": now,
            }).eq("template_id", tid).execute()
            published.append(tid)
        except Exception as exc:
            failed.append({"template_id": tid, "error": str(exc)})

    logger.info("[TemplateBatchPublish] 批量发布 %d 个模板 by user %s", len(published), user_id)
    return {
        "success": True,
        "published": published,
        "published_count": len(published),
        "failed": failed,
        "failed_count": len(failed),
    }


# ============================================
# Phase 2：试渲染 + 参数调优 + 质量标注
# ============================================

class PreviewRenderRequest(BaseModel):
    from_image_url: str = Field(..., description="首帧图片 URL")
    to_image_url: str = Field(..., description="尾帧图片 URL")
    prompt: Optional[str] = Field(None, description="可选补充提示词")
    negative_prompt: Optional[str] = Field(None, description="可选负向提示词")
    focus_modes: Optional[List[Literal["outfit_change", "subject_preserve", "scene_shift"]]] = Field(
        None, description="复刻重点"
    )
    golden_preset: Optional[Literal["spin_occlusion_outfit", "whip_pan_outfit", "space_warp_outfit"]] = Field(
        "spin_occlusion_outfit", description="黄金转场模版"
    )
    duration: Optional[str] = Field(None, description="视频时长")
    mode: Optional[str] = Field(None, description="生成模式")
    cfg_scale: Optional[float] = Field(None, description="CFG scale")
    boundary_ms: Optional[int] = Field(480, ge=200, le=2000, description="转场边界时长")
    variant_count: int = Field(1, ge=1, le=3, description="生成数量：1=单次, 2=精准vs创意对比, 3=全参数对比")


class PublishConfigUpdateRequest(BaseModel):
    default_focus_modes: Optional[List[str]] = None
    default_golden_preset: Optional[str] = None
    default_duration: Optional[str] = None
    default_mode: Optional[str] = None
    default_cfg_scale: Optional[float] = None
    default_boundary_ms: Optional[int] = None
    default_variant_count: Optional[int] = None
    default_prompt: Optional[str] = None
    default_negative_prompt: Optional[str] = None
    prompt_policy: Optional[Literal["auto_only", "auto_plus_default", "auto_plus_default_plus_user"]] = None
    allow_prompt_override: Optional[bool] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    best_for: Optional[List[str]] = None


class QualityLabelRequest(BaseModel):
    quality_label: Literal["golden", "good", "average", "poor"]
    admin_notes: Optional[str] = None


class PreviewRenderRatingRequest(BaseModel):
    admin_rating: Optional[int] = Field(None, ge=1, le=5, description="1-5 评分")
    admin_comment: Optional[str] = None
    is_featured: Optional[bool] = None


@router.post("/{template_id}/preview-render")
def create_preview_render(
    template_id: str,
    payload: PreviewRenderRequest,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """管理员试渲染：复用 transition replica 逻辑，结果记录到 preview_renders 表"""
    record = _load_template_record(template_id)
    if not record:
        raise HTTPException(status_code=404, detail="Template not found")

    focus_modes = payload.focus_modes or ["outfit_change"]
    golden_preset = payload.golden_preset or "spin_occlusion_outfit"

    render_params = {
        "prompt": payload.prompt,
        "negative_prompt": payload.negative_prompt,
        "duration": payload.duration,
        "mode": payload.mode,
        "cfg_scale": payload.cfg_scale,
        "boundary_ms": payload.boundary_ms,
        "golden_preset": golden_preset,
    }

    try:
        result = get_template_render_service().create_transition_replica_batch(
            template_record=record,
            render_params=render_params,
            user_id=user_id,
            from_image_url=payload.from_image_url,
            to_image_url=payload.to_image_url,
            focus_modes=focus_modes,
            golden_preset=golden_preset,
            apply_mode="insert_between",
            variant_count=payload.variant_count,
        )
    except Exception as exc:
        logger.error("[PreviewRender] 创建试渲染失败: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))

    # 将每个 task 写入 preview_renders 表
    preview_renders = []
    render_params_snapshot = {
        "focus_modes": focus_modes,
        "golden_preset": golden_preset,
        "duration": payload.duration,
        "mode": payload.mode,
        "cfg_scale": payload.cfg_scale,
        "boundary_ms": payload.boundary_ms,
        "variant_count": payload.variant_count,
        "from_image_url": payload.from_image_url,
        "to_image_url": payload.to_image_url,
        "prompt": payload.prompt,
        "negative_prompt": payload.negative_prompt,
    }

    for task in result.get("tasks", []):
        task_id = task.get("task_id")
        if not task_id:
            continue
        render_record = {
            "template_id": template_id,
            "task_id": task_id,
            "status": "pending",
            "render_params": {
                **render_params_snapshot,
                "variant_label": task.get("variant_label"),
                "prompt": task.get("prompt"),
            },
        }
        try:
            insert_result = supabase.table("template_preview_renders").insert(render_record).execute()
            if insert_result.data:
                preview_renders.append(insert_result.data[0])
        except Exception as exc:
            logger.warning("[PreviewRender] 写入 preview_renders 失败: %s", exc)

    logger.info("[PreviewRender] 创建 %d 个试渲染任务 for template %s", len(preview_renders), template_id)

    return {
        "success": True,
        "template_id": template_id,
        "replica_group_id": result.get("replica_group_id"),
        "task_count": result.get("task_count", 0),
        "tasks": result.get("tasks", []),
        "preview_render_ids": [r.get("id") for r in preview_renders],
    }


@router.get("/{template_id}/preview-renders")
def list_preview_renders(
    template_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """获取模板的试渲染列表（含视频 URL + 评分）"""
    try:
        result = (
            supabase.table("template_preview_renders")
            .select("*")
            .eq("template_id", template_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"查询失败: {exc}")

    renders = result.data or []

    # 联查 tasks 表获取最新状态和视频 URL
    for render in renders:
        task_id = render.get("task_id")
        if not task_id:
            continue

        # 如果 preview_renders 中还没有 video_url 且状态不是 completed，查询 tasks 表同步
        if render.get("status") not in ("completed", "failed"):
            try:
                task_result = (
                    supabase.table("tasks")
                    .select("status,output_url,result")
                    .eq("id", task_id)
                    .single()
                    .execute()
                )
                task = task_result.data
                if task:
                    task_status = task.get("status", "pending")
                    output_url_col = task.get("output_url")
                    result_data = task.get("result") or {}

                    new_status = render.get("status")
                    video_url = render.get("video_url")

                    if task_status == "completed":
                        new_status = "completed"
                        # 优先用 output_url 列，其次从 result JSON 中提取
                        video_url = (
                            output_url_col
                            or (result_data.get("video_url") if isinstance(result_data, dict) else None)
                            or (result_data.get("works", [{}])[0].get("resource", {}).get("resource") if isinstance(result_data, dict) else None)
                        )
                    elif task_status == "failed":
                        new_status = "failed"
                    elif task_status in ("processing", "submitted"):
                        new_status = "processing"

                    # 同步更新 preview_renders
                    if new_status != render.get("status") or (video_url and not render.get("video_url")):
                        update_data: Dict[str, Any] = {"status": new_status}
                        if video_url:
                            update_data["video_url"] = video_url
                        supabase.table("template_preview_renders").update(update_data).eq("id", render["id"]).execute()
                        render["status"] = new_status
                        if video_url:
                            render["video_url"] = video_url
            except Exception:
                pass  # 单条查询失败不阻断

    return {
        "template_id": template_id,
        "renders": renders,
        "total": len(renders),
    }


@router.patch("/{template_id}/preview-renders/{render_id}")
def update_preview_render(
    template_id: str,
    render_id: str,
    payload: PreviewRenderRatingRequest,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """更新试渲染记录：评分/评语/设为主预览"""
    update_data: Dict[str, Any] = {}
    if payload.admin_rating is not None:
        update_data["admin_rating"] = payload.admin_rating
    if payload.admin_comment is not None:
        update_data["admin_comment"] = payload.admin_comment
    if payload.is_featured is not None:
        update_data["is_featured"] = payload.is_featured

    if not update_data:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")

    # 如果设为 featured，先取消同模板其他 featured
    if payload.is_featured:
        try:
            supabase.table("template_preview_renders").update(
                {"is_featured": False}
            ).eq("template_id", template_id).neq("id", render_id).execute()
        except Exception:
            pass

        # 同时更新模板的 preview_video_url
        try:
            render_result = (
                supabase.table("template_preview_renders")
                .select("video_url")
                .eq("id", render_id)
                .single()
                .execute()
            )
            if render_result.data and render_result.data.get("video_url"):
                supabase.table("template_records").update(
                    {"preview_video_url": render_result.data["video_url"]}
                ).eq("template_id", template_id).execute()
        except Exception:
            pass

    try:
        supabase.table("template_preview_renders").update(update_data).eq("id", render_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"更新失败: {exc}")

    return {"success": True, "render_id": render_id, "updated": update_data}


@router.put("/{template_id}/quality-label")
def update_quality_label(
    template_id: str,
    payload: QualityLabelRequest,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """设置模板质量标签"""
    update_data: Dict[str, Any] = {"quality_label": payload.quality_label}
    if payload.admin_notes is not None:
        update_data["admin_notes"] = payload.admin_notes

    try:
        supabase.table("template_records").update(update_data).eq("template_id", template_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"更新失败: {exc}")

    logger.info("[QualityLabel] %s → %s by user %s", template_id, payload.quality_label, user_id)
    return {"success": True, "template_id": template_id, "quality_label": payload.quality_label}


@router.put("/{template_id}/publish-config")
def update_publish_config(
    template_id: str,
    payload: PublishConfigUpdateRequest,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """更新发布配置（管理员定义的默认参数）"""
    record = _load_template_record(template_id)
    if not record:
        raise HTTPException(status_code=404, detail="Template not found")

    existing_config = record.get("publish_config") or {}
    if not isinstance(existing_config, dict):
        existing_config = {}

    new_config = {**existing_config}
    update_fields = payload.model_dump(exclude_none=True)
    new_config.update(update_fields)

    try:
        supabase.table("template_records").update(
            {"publish_config": new_config}
        ).eq("template_id", template_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"更新失败: {exc}")

    logger.info("[PublishConfig] 更新 %s by user %s", template_id, user_id)
    return {"success": True, "template_id": template_id, "publish_config": new_config}


@router.delete("/batch")
def batch_delete_templates(
    template_ids: List[str] = Body(..., embed=True),
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """批量删除模板（平台素材）—— 批量查询 + 批量删 Storage + 批量删 DB"""
    if not template_ids:
        raise HTTPException(status_code=400, detail="template_ids is required")

    # ---------- 1. 一次批量查询所有记录 ----------
    try:
        result = (
            supabase.table("template_records")
            .select("template_id, bucket, storage_path, thumbnail_path")
            .in_("template_id", template_ids)
            .execute()
        )
        records = result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询失败: {e}")

    found_ids = {r["template_id"] for r in records}
    not_found = [tid for tid in template_ids if tid not in found_ids]
    failed = [{"template_id": tid, "error": "Not found"} for tid in not_found]

    if not records:
        return {
            "success": True,
            "deleted": [],
            "deleted_count": 0,
            "failed": failed,
            "failed_count": len(failed),
        }

    # ---------- 2. 按 bucket 分组，批量删除 Storage 文件 ----------
    from collections import defaultdict
    bucket_paths: dict[str, list[str]] = defaultdict(list)
    for r in records:
        bucket = r.get("bucket") or TEMPLATE_BUCKET
        for key in ("storage_path", "thumbnail_path"):
            path = r.get(key)
            if path:
                bucket_paths[bucket].append(path)

    for bucket, paths in bucket_paths.items():
        try:
            supabase.storage.from_(bucket).remove(paths)
        except Exception:
            pass  # Storage 删除失败不阻断流程

    # ---------- 3. 一次批量删除 DB 记录 ----------
    deleted_ids = list(found_ids)
    try:
        supabase.table("template_records").delete().in_("template_id", deleted_ids).execute()
    except Exception as e:
        # 如果批量删失败，降级到逐条删
        deleted_ids = []
        for tid in found_ids:
            try:
                supabase.table("template_records").delete().eq("template_id", tid).execute()
                deleted_ids.append(tid)
            except Exception as inner_e:
                failed.append({"template_id": tid, "error": str(inner_e)})

    return {
        "success": True,
        "deleted": deleted_ids,
        "deleted_count": len(deleted_ids),
        "failed": failed,
        "failed_count": len(failed),
    }


@router.delete("/{template_id}")
def delete_template(
    template_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """删除模板（平台素材）"""
    try:
        # 查找模板记录
        result = (
            supabase.table("template_records")
            .select("id, bucket, storage_path, thumbnail_path")
            .eq("template_id", template_id)
            .single()
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to find template: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Template not found")

    record = result.data
    bucket = record.get("bucket") or TEMPLATE_BUCKET
    storage_path = record.get("storage_path")
    thumbnail_path = record.get("thumbnail_path")

    # 删除 Storage 中的文件
    try:
        if storage_path:
            supabase.storage.from_(bucket).remove([storage_path])
        if thumbnail_path:
            supabase.storage.from_(bucket).remove([thumbnail_path])
    except Exception as e:
        # Storage 删除失败不阻断流程，只记录日志
        pass

    # 删除数据库记录
    try:
        supabase.table("template_records").delete().eq("template_id", template_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete template: {e}")

    return {"success": True, "template_id": template_id}


# ============================================================
# Phase 4a: Golden Fingerprint API
# ============================================================

@router.get("/golden-profiles")
def list_golden_profiles(
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """获取所有 Golden Profile（手动 + 数据驱动）"""
    from app.services.golden_fingerprint_service import get_golden_fingerprint_service
    service = get_golden_fingerprint_service()
    profiles = service.get_profiles()
    return {"profiles": profiles, "count": len(profiles)}


@router.post("/golden-profiles/rebuild")
def rebuild_golden_profiles(
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """从历史标注数据重建 Golden Profile（Phase 4b）"""
    from app.services.golden_fingerprint_service import get_golden_fingerprint_service
    service = get_golden_fingerprint_service()
    result = service.rebuild_profiles()
    return result


@router.post("/{template_id}/extract-fingerprint")
def extract_template_fingerprint(
    template_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """
    手动触发指纹提取（Ingest 时自动执行，此端点用于补提取/重新提取）。
    """
    from app.services.golden_fingerprint_service import get_golden_fingerprint_service

    try:
        result = (
            supabase.table("template_records")
            .select("*")
            .eq("template_id", template_id)
            .single()
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询失败: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="模板不存在")

    service = get_golden_fingerprint_service()
    fp_result = service.process_template(result.data, auto_fill=True)
    return fp_result


@router.get("/{template_id}/fingerprint-match")
def get_fingerprint_match(
    template_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """
    获取模板的指纹匹配结果（所有 Profile 的匹配详情）。
    """
    from app.services.golden_fingerprint_service import get_golden_fingerprint_service

    try:
        result = (
            supabase.table("template_records")
            .select("metadata")
            .eq("template_id", template_id)
            .single()
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询失败: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="模板不存在")

    metadata = result.data.get("metadata") or {}
    if isinstance(metadata, str):
        import json
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}

    fingerprint = metadata.get("golden_fingerprint")
    if not fingerprint:
        raise HTTPException(status_code=404, detail="该模板尚无指纹数据，请先触发提取")

    service = get_golden_fingerprint_service()
    matches = service.match_all_profiles(fingerprint)

    return {
        "template_id": template_id,
        "fingerprint": fingerprint,
        "matches": matches,
    }


# ─── Phase 5a: 配方溯源 API ─────────────────────────────

@router.get("/{template_id}/recipe")
def get_template_recipe(
    template_id: str,
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """
    获取模板完整配方卡 — 聚合 transition_spec + golden_match + provenance + 使用统计。
    前端可据此展示「为什么推荐这些参数」的完整溯源链。
    """
    record = _load_template_record(template_id)
    if not record:
        raise HTTPException(status_code=404, detail="模板不存在")

    metadata = record.get("metadata") or {}
    if isinstance(metadata, str):
        import json
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}

    workflow = record.get("workflow") or {}
    publish_config = record.get("publish_config") or {}
    if not isinstance(publish_config, dict):
        publish_config = {}

    transition_spec = metadata.get("transition_spec") or {}
    golden_fingerprint = metadata.get("golden_fingerprint")
    golden_match = metadata.get("golden_match")
    provenance = publish_config.get("_provenance") or {}

    # ── 使用统计：从 tasks 表聚合渲染记录 ──
    usage_stats: Dict[str, Any] = {"total_renders": 0, "succeeded": 0, "failed": 0}
    try:
        tasks_resp = (
            supabase.table("tasks")
            .select("status")
            .eq("input_params->>template_id", template_id)
            .execute()
        )
        tasks_data = tasks_resp.data or []
        usage_stats["total_renders"] = len(tasks_data)
        usage_stats["succeeded"] = sum(1 for t in tasks_data if t.get("status") == "succeeded")
        usage_stats["failed"] = sum(1 for t in tasks_data if t.get("status") == "failed")
        if usage_stats["total_renders"] > 0:
            usage_stats["success_rate"] = round(
                usage_stats["succeeded"] / usage_stats["total_renders"] * 100, 1
            )
    except Exception:
        pass  # 统计失败不影响配方返回

    # ── 试渲染记录 ──
    preview_count = 0
    try:
        preview_resp = (
            supabase.table("template_preview_renders")
            .select("id", count="exact")
            .eq("template_id", template_id)
            .execute()
        )
        preview_count = preview_resp.count or 0
    except Exception:
        pass

    # ── 组装配方卡 ──
    recipe: Dict[str, Any] = {
        "template_id": template_id,
        "template_name": record.get("name"),
        "template_type": record.get("type"),
        "category": record.get("category"),
        "status": record.get("status"),
        "quality_label": record.get("quality_label"),

        # 来源分析
        "analysis": {
            "transition_category": transition_spec.get("transition_category"),
            "family": transition_spec.get("family"),
            "camera_movement": transition_spec.get("camera_movement"),
            "motion_pattern": transition_spec.get("motion_pattern"),
            "duration_ms": transition_spec.get("duration_ms"),
            "recommended_prompt": transition_spec.get("recommended_prompt"),
            "transition_description": transition_spec.get("transition_description"),
            "scene_description": metadata.get("scene_description"),
            "motion_prompt": transition_spec.get("motion_prompt"),
            "camera_compound": transition_spec.get("camera_compound"),
            "background_motion": transition_spec.get("background_motion"),
            "subject_motion": transition_spec.get("subject_motion"),
            "_analysis_method": transition_spec.get("_analysis_method"),
            "transition_window": transition_spec.get("transition_window"),
            "technical_dissection": transition_spec.get("technical_dissection"),
        },

        # 指纹 + 匹配
        "fingerprint": golden_fingerprint,
        "golden_match": golden_match,

        # 当前参数配置 + 溯源
        "publish_config": {
            k: v for k, v in publish_config.items() if k != "_provenance"
        },
        "provenance": provenance,

        # 使用统计
        "usage": {
            **usage_stats,
            "preview_renders": preview_count,
        },

        # 关键 workflow 参数（来自入库 LLM 分析）
        "workflow_summary": {
            "kling_endpoint": workflow.get("kling_endpoint"),
            "shot_type": workflow.get("shot_type"),
            "camera_move": workflow.get("camera_move"),
            "transition": workflow.get("transition"),
            "pacing": workflow.get("pacing"),
        },
    }

    return recipe
