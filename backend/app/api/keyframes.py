"""
关键帧 API
提供关键帧的 CRUD 操作
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Union, Dict
from app.api.auth import get_current_user_id
from app.services.supabase_client import get_supabase

router = APIRouter(prefix="/keyframes", tags=["keyframes"])


# ========== Schemas ==========

# 复合值类型（用于 position 和 scale）
class CompoundValue(BaseModel):
    x: float
    y: float

# 关键帧值可以是数字或复合值
KeyframeValue = Union[float, CompoundValue, Dict[str, float]]


class KeyframeCreate(BaseModel):
    clip_id: str
    property: str  # position, scale, rotation, opacity, volume, pan, blur
    offset: float  # 归一化时间偏移 (0-1)，0=clip起点，1=clip终点
    value: KeyframeValue  # 复合属性使用 {x, y}，简单属性使用 float
    easing: str = "linear"  # linear, ease_in, ease_out, ease_in_out, hold, bezier
    bezier_control: Optional[dict] = None


class KeyframeUpdate(BaseModel):
    value: Optional[KeyframeValue] = None
    offset: Optional[float] = None
    easing: Optional[str] = None
    bezier_control: Optional[dict] = None


class KeyframeBatchCreate(BaseModel):
    keyframes: List[KeyframeCreate]


class KeyframeBatchDelete(BaseModel):
    keyframe_ids: List[str]


# ========== 权限校验 ==========

async def verify_clip_access(clip_id: str, user_id: str):
    """验证用户对 clip 的访问权限（通过 clip -> track -> project）"""
    supabase = get_supabase()
    
    # 第一步：查询 clip 获取 track_id
    clip_result = supabase.from_("clips").select("id, track_id").eq("id", clip_id).execute()
    
    if not clip_result.data:
        raise HTTPException(status_code=404, detail="片段不存在")
    
    clip = clip_result.data[0]
    track_id = clip.get('track_id')
    if not track_id:
        raise HTTPException(status_code=404, detail="片段未关联轨道")
    
    # 第二步：查询 track 获取 project_id
    track_result = supabase.from_("tracks").select("id, project_id").eq("id", track_id).execute()
    
    if not track_result.data:
        raise HTTPException(status_code=404, detail="轨道不存在")
    
    project_id = track_result.data[0].get('project_id')
    if not project_id:
        raise HTTPException(status_code=404, detail="轨道未关联项目")
    
    # 第三步：查询 project 验证 user_id
    project_result = supabase.from_("projects").select("id, user_id").eq("id", project_id).execute()
    
    if not project_result.data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    if project_result.data[0].get('user_id') != user_id:
        raise HTTPException(status_code=403, detail="无权访问此片段")


async def verify_clips_access_batch(clip_ids: list, user_id: str):
    """批量验证用户对多个 clips 的访问权限"""
    if not clip_ids:
        return
    
    supabase = get_supabase()
    
    # 第一步：查询所有 clips 获取 track_ids
    clips_result = supabase.from_("clips").select("id, track_id").in_("id", clip_ids).execute()
    
    if not clips_result.data or len(clips_result.data) != len(clip_ids):
        raise HTTPException(status_code=404, detail="部分片段不存在")
    
    track_ids = list(set(c.get('track_id') for c in clips_result.data if c.get('track_id')))
    if not track_ids:
        raise HTTPException(status_code=404, detail="片段未关联轨道")
    
    # 第二步：查询 tracks 获取 project_ids
    tracks_result = supabase.from_("tracks").select("id, project_id").in_("id", track_ids).execute()
    
    if not tracks_result.data:
        raise HTTPException(status_code=404, detail="轨道不存在")
    
    project_ids = list(set(t.get('project_id') for t in tracks_result.data if t.get('project_id')))
    if not project_ids:
        raise HTTPException(status_code=404, detail="轨道未关联项目")
    
    # 第三步：查询 projects 验证 user_id
    projects_result = supabase.from_("projects").select("id, user_id").in_("id", project_ids).execute()
    
    if not projects_result.data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    for project in projects_result.data:
        if project.get('user_id') != user_id:
            raise HTTPException(status_code=403, detail="无权访问部分片段")


async def verify_keyframe_access(keyframe_id: str, user_id: str):
    """验证用户对关键帧的访问权限"""
    supabase = get_supabase()
    
    # 第一步：查询 keyframe 获取 clip_id
    kf_result = supabase.from_("keyframes").select("id, clip_id").eq("id", keyframe_id).execute()
    
    if not kf_result.data:
        raise HTTPException(status_code=404, detail="关键帧不存在")
    
    clip_id = kf_result.data[0].get('clip_id')
    if not clip_id:
        raise HTTPException(status_code=404, detail="关键帧未关联片段")
    
    # 复用 clip 验证逻辑
    await verify_clip_access(clip_id, user_id)


async def verify_keyframes_access_batch(keyframe_ids: list, user_id: str):
    """批量验证用户对多个关键帧的访问权限"""
    if not keyframe_ids:
        return
    
    supabase = get_supabase()
    
    # 第一步：查询所有 keyframes 获取 clip_ids
    kf_result = supabase.from_("keyframes").select("id, clip_id").in_("id", keyframe_ids).execute()
    
    if not kf_result.data or len(kf_result.data) != len(keyframe_ids):
        raise HTTPException(status_code=404, detail="部分关键帧不存在")
    
    clip_ids = list(set(kf.get('clip_id') for kf in kf_result.data if kf.get('clip_id')))
    if not clip_ids:
        raise HTTPException(status_code=404, detail="关键帧未关联片段")
    
    # 复用批量 clip 验证逻辑
    await verify_clips_access_batch(clip_ids, user_id)


# ========== 端点 ==========

@router.get("/project/{project_id}")
async def get_project_keyframes(
    project_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    获取项目的所有关键帧
    用于添加素材后刷新关键帧数据
    """
    supabase = get_supabase()
    
    # 验证项目所有权
    project_result = supabase.from_("projects").select("id, user_id").eq("id", project_id).execute()
    if not project_result.data:
        raise HTTPException(status_code=404, detail="项目不存在")
    if project_result.data[0].get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权访问此项目")
    
    # 获取项目的所有 tracks
    tracks_result = supabase.from_("tracks").select("id").eq("project_id", project_id).execute()
    if not tracks_result.data:
        return {"keyframes": []}
    
    track_ids = [t["id"] for t in tracks_result.data]
    
    # 获取所有 clips
    clips_result = supabase.from_("clips").select("id").in_("track_id", track_ids).execute()
    if not clips_result.data:
        return {"keyframes": []}
    
    clip_ids = [c["id"] for c in clips_result.data]
    
    # 获取所有关键帧
    keyframes_result = supabase.from_("keyframes").select("*").in_("clip_id", clip_ids).execute()
    
    # 转换格式（与 loadProject 保持一致）
    keyframes = []
    for kf in (keyframes_result.data or []):
        keyframes.append({
            "id": kf.get("id"),
            "clipId": kf.get("clip_id"),
            "property": kf.get("property"),
            "offset": kf.get("offset"),
            "value": kf.get("value"),
            "easing": kf.get("easing"),
        })
    
    return {"keyframes": keyframes}


@router.get("/clip/{clip_id}")
async def get_clip_keyframes(
    clip_id: str,
    property: Optional[str] = None,
    user_id: str = Depends(get_current_user_id)
):
    """获取 clip 的所有关键帧"""
    await verify_clip_access(clip_id, user_id)
    
    supabase = get_supabase()
    query = supabase.from_("keyframes").select("*").eq("clip_id", clip_id)
    
    if property:
        query = query.eq("property", property)
    
    result = query.order("property").order("offset").execute()
    return {"keyframes": result.data}


@router.post("")
async def create_keyframe(
    data: KeyframeCreate,
    user_id: str = Depends(get_current_user_id)
):
    """创建关键帧（如果同位置已存在则更新）"""
    await verify_clip_access(data.clip_id, user_id)
    
    supabase = get_supabase()
    
    # 处理 value：如果是 Pydantic 模型，转换为 dict
    value_for_db = data.value
    if hasattr(data.value, 'model_dump'):
        value_for_db = data.value.model_dump()
    elif hasattr(data.value, 'dict'):
        value_for_db = data.value.dict()
    
    # 检查是否已存在相同位置的关键帧
    existing = supabase.from_("keyframes").select("id").eq(
        "clip_id", data.clip_id
    ).eq("property", data.property).eq("offset", data.offset).execute()
    
    if existing.data:
        # 更新现有关键帧
        result = supabase.from_("keyframes").update({
            "value": value_for_db,
            "easing": data.easing,
            "bezier_control": data.bezier_control,
            "updated_at": "now()",
        }).eq("id", existing.data[0]["id"]).execute()
    else:
        # 创建新关键帧
        result = supabase.from_("keyframes").insert({
            "clip_id": data.clip_id,
            "property": data.property,
            "offset": data.offset,
            "value": value_for_db,
            "easing": data.easing,
            "bezier_control": data.bezier_control,
        }).execute()
    
    return {"keyframe": result.data[0]}


@router.post("/batch")
async def create_keyframes_batch(
    data: KeyframeBatchCreate,
    user_id: str = Depends(get_current_user_id)
):
    """批量创建关键帧"""
    # 验证所有 clip 的访问权限（优化：一次查询所有）
    clip_ids = list(set(kf.clip_id for kf in data.keyframes))
    await verify_clips_access_batch(clip_ids, user_id)
    
    supabase = get_supabase()
    
    def convert_value(value):
        """将 Pydantic 模型转换为 dict"""
        if hasattr(value, 'model_dump'):
            return value.model_dump()
        elif hasattr(value, 'dict'):
            return value.dict()
        return value
    
    keyframes_data = [
        {
            "clip_id": kf.clip_id,
            "property": kf.property,
            "offset": kf.offset,
            "value": convert_value(kf.value),
            "easing": kf.easing,
            "bezier_control": kf.bezier_control,
        }
        for kf in data.keyframes
    ]
    
    # 使用 upsert 避免重复
    result = supabase.from_("keyframes").upsert(
        keyframes_data,
        on_conflict="clip_id,property,offset"
    ).execute()
    
    return {"keyframes": result.data, "count": len(result.data)}


@router.patch("/{keyframe_id}")
async def update_keyframe(
    keyframe_id: str,
    data: KeyframeUpdate,
    user_id: str = Depends(get_current_user_id)
):
    """更新关键帧"""
    await verify_keyframe_access(keyframe_id, user_id)
    
    supabase = get_supabase()
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    if not update_data:
        raise HTTPException(status_code=400, detail="没有要更新的字段")
    
    update_data["updated_at"] = "now()"
    
    result = supabase.from_("keyframes").update(update_data).eq("id", keyframe_id).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="关键帧不存在")
    
    return {"keyframe": result.data[0]}


@router.delete("/{keyframe_id}")
async def delete_keyframe(
    keyframe_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除关键帧"""
    await verify_keyframe_access(keyframe_id, user_id)
    
    supabase = get_supabase()
    supabase.from_("keyframes").delete().eq("id", keyframe_id).execute()
    
    return {"success": True}


@router.delete("/batch")
async def delete_keyframes_batch(
    data: KeyframeBatchDelete,
    user_id: str = Depends(get_current_user_id)
):
    """批量删除关键帧"""
    if not data.keyframe_ids:
        return {"success": True, "deleted_count": 0}
    
    # 批量验证关键帧的访问权限
    await verify_keyframes_access_batch(data.keyframe_ids, user_id)
    
    supabase = get_supabase()
    supabase.from_("keyframes").delete().in_("id", data.keyframe_ids).execute()
    
    return {"success": True, "deleted_count": len(data.keyframe_ids)}


@router.delete("/clip/{clip_id}/property/{property}")
async def delete_property_keyframes(
    clip_id: str,
    property: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除 clip 某个属性的所有关键帧"""
    await verify_clip_access(clip_id, user_id)
    
    supabase = get_supabase()
    result = supabase.from_("keyframes").delete().eq(
        "clip_id", clip_id
    ).eq("property", property).execute()
    
    return {"success": True, "deleted_count": len(result.data) if result.data else 0}


@router.delete("/clip/{clip_id}")
async def delete_all_clip_keyframes(
    clip_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """删除 clip 的所有关键帧"""
    await verify_clip_access(clip_id, user_id)
    
    supabase = get_supabase()
    result = supabase.from_("keyframes").delete().eq("clip_id", clip_id).execute()
    
    return {"success": True, "deleted_count": len(result.data) if result.data else 0}


# ========== 智能运镜 ==========

class SmartGenerateRequest(BaseModel):
    """智能运镜请求 - 支持单个或多个 clips"""
    clip_ids: List[str]  # 1个或多个 clip ID
    emotion: str = "neutral"  # neutral, excited, serious, happy, sad
    importance: str = "medium"  # low, medium, high


class SmartGenerateResult(BaseModel):
    """单个 clip 的智能运镜结果"""
    clip_id: str
    success: bool
    keyframes_count: int = 0
    rule_applied: Optional[str] = None
    error: Optional[str] = None


class SmartGenerateResponse(BaseModel):
    """智能运镜响应"""
    results: List[SmartGenerateResult]
    total_clips: int
    success_count: int
    failed_count: int


@router.post("/smart-generate", response_model=SmartGenerateResponse)
async def smart_generate_keyframes(
    data: SmartGenerateRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    智能运镜 - 为 1-N 个 clips 生成运镜关键帧
    
    流程：
    1. 获取所有 clip 的视频信息
    2. 批量视觉分析（人脸检测）
    3. 使用序列感知批量规则生成运镜参数（整体策略）
    4. 保存关键帧到数据库
    
    关键改进：使用 generate_transforms_batch 进行序列感知处理，
    确保连续片段的运镜效果多样化，而不是每个 clip 独立处理。
    
    同步处理，直接返回结果
    """
    import logging
    logger = logging.getLogger(__name__)
    
    if not data.clip_ids:
        raise HTTPException(status_code=400, detail="clip_ids 不能为空")
    
    # 批量验证权限
    await verify_clips_access_batch(data.clip_ids, user_id)
    
    supabase = get_supabase()
    results: List[SmartGenerateResult] = []
    
    # 导入运镜生成相关类（使用新 API）
    from app.services.transform_rules import (
        transform_engine, sequence_processor, SegmentContext, 
        EmotionType, ImportanceLevel
    )
    from app.services.supabase_client import get_file_url
    
    # 批量获取所有 clips 信息，按 start_time 排序以保持时间顺序
    clips_result = supabase.from_("clips").select(
        "id, track_id, asset_id, start_time, end_time, source_start, source_end, clip_type"
    ).in_("id", data.clip_ids).order("start_time").execute()
    
    # 保持时间顺序的 clip 列表
    ordered_clips = clips_result.data or []
    clips_map = {c["id"]: c for c in ordered_clips}
    
    # 获取所有相关的 assets
    asset_ids = list(set(c.get("asset_id") for c in clips_map.values() if c.get("asset_id")))
    assets_map = {}
    if asset_ids:
        assets_result = supabase.from_("assets").select(
            "id, storage_path, duration"
        ).in_("id", asset_ids).execute()
        assets_map = {a["id"]: a for a in (assets_result.data or [])}
    
    # ========== 阶段1：收集所有 clip 的分析数据 ==========
    segments_to_process = []  # 需要处理的片段信息
    error_results = []  # 验证失败的结果
    
    for clip_data in ordered_clips:
        clip_id = clip_data["id"]
        
        # 只处理 video 类型
        if clip_data.get("clip_type") != "video":
            error_results.append(SmartGenerateResult(
                clip_id=clip_id,
                success=False,
                error="只支持视频类型的 clip"
            ))
            continue
        
        # 获取 asset
        asset_id = clip_data.get("asset_id")
        if not asset_id or asset_id not in assets_map:
            error_results.append(SmartGenerateResult(
                clip_id=clip_id,
                success=False,
                error="Clip 没有关联的 asset"
            ))
            continue
        
        asset_data = assets_map[asset_id]
        
        # 计算时长
        clip_start_time = clip_data.get("start_time", 0)
        clip_end_time = clip_data.get("end_time", 0)
        source_start = clip_data.get("source_start", 0)
        source_end = clip_data.get("source_end") or (clip_end_time - clip_start_time + source_start)
        duration_ms = source_end - source_start
        
        if duration_ms <= 0:
            error_results.append(SmartGenerateResult(
                clip_id=clip_id,
                success=False,
                error=f"无效的 clip 时长: {duration_ms}ms"
            ))
            continue
        
        # 视觉分析（人脸检测）
        has_face = False
        face_center_x = 0.5
        face_center_y = 0.5
        face_ratio = 0.0
        
        try:
            video_url = get_file_url(asset_data["storage_path"])
            mid_time = source_start + duration_ms / 2
            
            from app.features.vision import vision_service
            analysis = await vision_service.analyze_video_frame(
                video_url=video_url,
                time_ms=mid_time
            )
            
            if analysis and analysis.get("faces"):
                face = analysis["faces"][0]
                has_face = True
                face_center_x = face.get("center_x", 0.5)
                face_center_y = face.get("center_y", 0.5)
                face_ratio = face.get("ratio", 0.0)
        except Exception as e:
            logger.warning(f"[SmartGenerate] clip {clip_id} 视觉分析失败: {e}")
        
        # 收集片段信息
        segments_to_process.append({
            "segment_id": clip_id,
            "duration_ms": duration_ms,
            "has_face": has_face,
            "face_center_x": face_center_x,
            "face_center_y": face_center_y,
            "face_ratio": face_ratio,
            "emotion": data.emotion,
            "importance": data.importance,
        })
    
    # ========== 阶段2：批量生成运镜参数（序列感知）==========
    if segments_to_process:
        logger.info(f"[SmartGenerate] 批量处理 {len(segments_to_process)} 个片段，启用序列感知")
        
        # 构建上下文列表
        contexts = []
        for seg in segments_to_process:
            try:
                emotion = EmotionType(seg.get("emotion", "neutral"))
            except ValueError:
                emotion = EmotionType.NEUTRAL
            try:
                importance = ImportanceLevel(seg.get("importance", "medium"))
            except ValueError:
                importance = ImportanceLevel.MEDIUM
            
            context = SegmentContext(
                segment_id=seg.get("segment_id", ""),
                duration_ms=seg.get("duration_ms", 0),
                has_face=seg.get("has_face", False),
                face_center_x=seg.get("face_center_x", 0.5),
                face_center_y=seg.get("face_center_y", 0.5),
                face_ratio=seg.get("face_ratio", 0.0),
                emotion=emotion,
                importance=importance,
            )
            contexts.append(context)
        
        # 规则引擎处理
        params_list = [transform_engine.process(ctx) for ctx in contexts]
        
        # 序列感知后处理
        params_contexts = list(zip(params_list, contexts))
        processed_params = sequence_processor.process_batch(params_contexts)
        
        # ========== 阶段3：保存关键帧到数据库 ==========
        for segment, ctx, params in zip(segments_to_process, contexts, processed_params):
            clip_id = segment["segment_id"]
            
            try:
                # 获取元信息
                meta = params.get_meta()
                rule_applied = meta.get("_rule_applied", "unknown")
                
                # 获取关键帧记录
                keyframes_records = params.get_keyframes_for_db(clip_id, ctx.duration_ms)
                
                # 先删除该 clip 的已有运镜关键帧
                supabase.from_("keyframes").delete().eq("clip_id", clip_id).in_(
                    "property", ["scale", "position", "rotation"]
                ).execute()
                
                # 批量插入新关键帧
                if keyframes_records:
                    supabase.from_("keyframes").insert(keyframes_records).execute()
                
                results.append(SmartGenerateResult(
                    clip_id=clip_id,
                    success=True,
                    keyframes_count=len(keyframes_records),
                    rule_applied=rule_applied,
                ))
                
            except Exception as e:
                logger.error(f"[SmartGenerate] clip {clip_id} 保存关键帧失败: {e}")
                results.append(SmartGenerateResult(
                    clip_id=clip_id,
                    success=False,
                    error=str(e)
                ))
    
    # 合并错误结果
    results.extend(error_results)
    
    success_count = sum(1 for r in results if r.success)
    failed_count = len(results) - success_count
    
    return SmartGenerateResponse(
        results=results,
        total_clips=len(data.clip_ids),
        success_count=success_count,
        failed_count=failed_count,
    )
