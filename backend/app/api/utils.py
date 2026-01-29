"""
HoppingRabbit AI - API 共享工具函数
"""
from datetime import datetime
from uuid import uuid4
from typing import Optional, Dict, Any, List

from ..services.supabase_client import supabase


async def apply_operations(segments: List[Dict[str, Any]], operations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    应用操作列表到 segments
    支持的操作类型：
    - delete_range: 删除时间范围
    - modify_text: 修改字幕文本
    - split_segment: 分割片段
    - merge_segments: 合并片段
    """
    result = segments.copy()
    
    for op in operations:
        op_type = op.get("type")
        
        if op_type == "delete_range":
            start_time = op.get("start_time", 0)
            end_time = op.get("end_time", 0)
            
            new_segments = []
            for seg in result:
                seg_start = seg.get("start", 0)
                seg_end = seg.get("end", 0)
                
                # 完全在删除范围外
                if seg_end <= start_time or seg_start >= end_time:
                    new_segments.append(seg)
                # 部分在删除范围内 - 需要裁剪
                elif seg_start < start_time and seg_end > end_time:
                    # 片段被删除范围分割成两部分
                    new_segments.append({**seg, "end": start_time})
                    new_segments.append({**seg, "start": end_time})
                elif seg_start < start_time:
                    new_segments.append({**seg, "end": start_time})
                elif seg_end > end_time:
                    new_segments.append({**seg, "start": end_time})
                # 完全在删除范围内 - 跳过
            
            result = new_segments
            
        elif op_type == "modify_text":
            segment_id = op.get("segment_id")
            new_text = op.get("text", "")
            
            for seg in result:
                if seg.get("id") == segment_id:
                    seg["text"] = new_text
                    break
                    
        elif op_type == "split_segment":
            segment_id = op.get("segment_id")
            split_time = op.get("split_time")
            
            new_segments = []
            for seg in result:
                if seg.get("id") == segment_id:
                    # 分割成两个新片段
                    new_segments.append({
                        **seg,
                        "id": str(uuid4()),
                        "end": split_time
                    })
                    new_segments.append({
                        **seg,
                        "id": str(uuid4()),
                        "start": split_time
                    })
                else:
                    new_segments.append(seg)
            
            result = new_segments
            
        elif op_type == "merge_segments":
            segment_ids = op.get("segment_ids", [])
            if len(segment_ids) >= 2:
                to_merge = [s for s in result if s.get("id") in segment_ids]
                others = [s for s in result if s.get("id") not in segment_ids]
                
                if to_merge:
                    merged = {
                        "id": str(uuid4()),
                        "start": min(s.get("start", 0) for s in to_merge),
                        "end": max(s.get("end", 0) for s in to_merge),
                        "text": " ".join(s.get("text", "") for s in to_merge),
                        "speaker": to_merge[0].get("speaker")
                    }
                    others.append(merged)
                    others.sort(key=lambda x: x.get("start", 0))
                
                result = others
    
    return result


async def maybe_create_snapshot(
    project_id: str, 
    current_state: Dict[str, Any], 
    action_type: str = "auto"
) -> Optional[str]:
    """
    根据策略决定是否创建快照
    返回快照 ID 或 None
    """
    # 检查最近的快照
    recent = supabase.table("project_history").select("created_at").eq(
        "project_id", project_id
    ).order("created_at", desc=True).limit(1).execute()
    
    should_create = False
    
    if not recent.data:
        # 没有快照，创建第一个
        should_create = True
    else:
        last_time = datetime.fromisoformat(recent.data[0]["created_at"].replace("Z", "+00:00"))
        now = datetime.utcnow().replace(tzinfo=last_time.tzinfo)
        time_diff = (now - last_time).total_seconds()
        
        # 超过5分钟或者是重要操作
        important_actions = ["delete_range", "merge_segments", "split_segment", "apply_ai_suggestions"]
        if time_diff > 300 or action_type in important_actions:
            should_create = True
    
    if should_create:
        snapshot_id = str(uuid4())
        supabase.table("project_history").insert({
            "id": snapshot_id,
            "project_id": project_id,
            "state": current_state,
            "action_type": action_type,
            "created_at": datetime.utcnow().isoformat()
        }).execute()
        return snapshot_id
    
    return None


async def get_asset_download_url(asset_id: str) -> Optional[str]:
    """获取资源的下载 URL"""
    result = supabase.table("assets").select("storage_path").eq("id", asset_id).single().execute()
    
    if not result.data:
        return None
    
    storage_path = result.data.get("storage_path")
    if not storage_path:
        return None
    
    # ★ Cloudflare 视频：返回 HLS URL（FFmpeg 可直接读取）
    if storage_path.startswith("cloudflare:"):
        video_uid = storage_path.replace("cloudflare:", "")
        return f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"
    
    # Supabase 存储：生成签名 URL
    url_result = supabase.storage.from_("clips").create_signed_url(storage_path, 3600)
    return url_result.get("signedURL")


def calculate_duration(segments: List[Dict[str, Any]]) -> float:
    """计算片段总时长"""
    if not segments:
        return 0.0
    
    return max(s.get("end", 0) for s in segments) - min(s.get("start", 0) for s in segments)


def validate_timeline(timeline: Dict[str, Any]) -> List[str]:
    """
    验证时间轴数据结构
    返回错误列表
    """
    errors = []
    
    if not timeline:
        errors.append("时间轴数据为空")
        return errors
    
    tracks = timeline.get("tracks", [])
    if not tracks:
        errors.append("没有轨道数据")
        return errors
    
    for i, track in enumerate(tracks):
        if "type" not in track:
            errors.append(f"轨道 {i} 缺少类型")
        
        clips = track.get("clips", [])
        for j, clip in enumerate(clips):
            if "start" not in clip or "end" not in clip:
                errors.append(f"轨道 {i} 的片段 {j} 缺少时间信息")
            elif clip.get("start", 0) >= clip.get("end", 0):
                errors.append(f"轨道 {i} 的片段 {j} 时间无效")
    
    return errors


def format_time(seconds: float) -> str:
    """格式化时间为 HH:MM:SS.mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"


def parse_time(time_str: str) -> float:
    """解析时间字符串为秒数"""
    parts = time_str.replace(",", ".").split(":")
    if len(parts) == 3:
        hours, minutes, secs = parts
        return int(hours) * 3600 + int(minutes) * 60 + float(secs)
    elif len(parts) == 2:
        minutes, secs = parts
        return int(minutes) * 60 + float(secs)
    else:
        return float(time_str)
