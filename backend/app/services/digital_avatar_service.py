"""
Digital Avatar Template Service

管理数字人形象模板 CRUD + 使用统计 + 生成任务编排

System C — 独立于 video templates (System A) 和 trend templates (System B)

链路:
  用户选形象 → 输入脚本/音频 → 智能播报生成口播视频 → (可选)换脸 → 最终视频
"""

import logging
from typing import Optional, Dict, Any, List
from uuid import uuid4
from datetime import datetime, timezone

from .supabase_client import get_supabase

logger = logging.getLogger(__name__)


class DigitalAvatarService:
    """数字人形象模板服务"""

    TABLE = "digital_avatar_templates"
    GEN_TABLE = "digital_avatar_generations"

    # ==========================================
    # CRUD — 模板管理
    # ==========================================

    async def list_avatars(
        self,
        status: Optional[str] = None,
        gender: Optional[str] = None,
        style: Optional[str] = None,
        search: Optional[str] = None,
        is_featured: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """列出数字人形象模板"""
        supabase = get_supabase()
        query = supabase.table(self.TABLE).select("*")

        if status:
            query = query.eq("status", status)
        if gender:
            query = query.eq("gender", gender)
        if style:
            query = query.eq("style", style)
        if is_featured is not None:
            query = query.eq("is_featured", is_featured)
        if search:
            query = query.or_(
                f"name.ilike.%{search}%,description.ilike.%{search}%"
            )

        query = (
            query
            .order("trending_score", desc=True)
            .order("usage_count", desc=True)
            .range(offset, offset + limit - 1)
        )

        result = query.execute()
        avatars = result.data or []

        return {
            "avatars": avatars,
            "total": len(avatars),
            "offset": offset,
            "limit": limit,
        }

    async def get_by_id(self, avatar_id: str) -> Optional[Dict[str, Any]]:
        """获取单个形象详情"""
        supabase = get_supabase()
        result = (
            supabase.table(self.TABLE)
            .select("*")
            .eq("id", avatar_id)
            .single()
            .execute()
        )
        return result.data

    async def create_avatar(self, data: Dict[str, Any], user_id: str) -> Dict[str, Any]:
        """创建数字人形象模板"""
        supabase = get_supabase()
        row = {
            "name": data["name"],
            "description": data.get("description"),
            "portrait_url": data["portrait_url"],
            "portrait_prompt": data.get("portrait_prompt"),
            "reference_images": data.get("reference_images", []),
            "thumbnail_url": data.get("thumbnail_url") or data["portrait_url"],
            "demo_video_url": data.get("demo_video_url"),
            "default_voice_id": data.get("default_voice_id", "zh_female_gentle"),
            "default_voice_name": data.get("default_voice_name"),
            "voice_sample_url": data.get("voice_sample_url"),
            "gender": data.get("gender"),
            "age_range": data.get("age_range"),
            "ethnicity": data.get("ethnicity"),
            "style": data.get("style"),
            "tags": data.get("tags", []),
            "generation_config": data.get("generation_config", {}),
            "status": "draft",
            "created_by": user_id,
        }

        result = supabase.table(self.TABLE).insert(row).execute()
        return result.data[0]

    async def update_avatar(self, avatar_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """更新形象模板"""
        supabase = get_supabase()
        # 只允许更新特定字段
        allowed = {
            "name", "description", "portrait_url", "portrait_prompt",
            "reference_images", "thumbnail_url", "demo_video_url",
            "default_voice_id", "default_voice_name", "voice_sample_url",
            "gender", "age_range", "ethnicity", "style", "tags",
            "generation_config", "trending_score", "is_featured",
        }
        updates = {k: v for k, v in data.items() if k in allowed}

        result = (
            supabase.table(self.TABLE)
            .update(updates)
            .eq("id", avatar_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    async def publish_avatar(self, avatar_id: str) -> Dict[str, Any]:
        """发布形象"""
        supabase = get_supabase()
        result = (
            supabase.table(self.TABLE)
            .update({
                "status": "published",
                "published_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", avatar_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    async def unpublish_avatar(self, avatar_id: str) -> Dict[str, Any]:
        """取消发布"""
        supabase = get_supabase()
        result = (
            supabase.table(self.TABLE)
            .update({"status": "draft", "published_at": None})
            .eq("id", avatar_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    async def delete_avatar(self, avatar_id: str) -> bool:
        """删除形象"""
        supabase = get_supabase()
        supabase.table(self.TABLE).delete().eq("id", avatar_id).execute()
        return True

    # ==========================================
    # 用户消费 — 使用形象生成口播视频
    # ==========================================

    async def create_generation(
        self,
        avatar_id: str,
        user_id: str,
        input_type: str,
        script: Optional[str] = None,
        audio_url: Optional[str] = None,
        voice_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        创建数字人生成任务记录
        
        这只是记录层，实际的 AI 任务由 API 路由层编排：
        1. 调用 smart-broadcast → broadcast_task_id
        2. (可选) 调用 face-swap → face_swap_task_id
        """
        supabase = get_supabase()

        # 递增使用次数
        supabase.rpc(
            "increment_avatar_usage_count",
            {"p_avatar_id": avatar_id}
        ).execute()

        row = {
            "id": str(uuid4()),
            "user_id": user_id,
            "avatar_id": avatar_id,
            "input_type": input_type,
            "script": script,
            "audio_url": audio_url,
            "voice_id": voice_id,
            "status": "pending",
        }

        result = supabase.table(self.GEN_TABLE).insert(row).execute()
        return result.data[0]

    async def update_generation(self, gen_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """更新生成任务状态"""
        supabase = get_supabase()
        result = (
            supabase.table(self.GEN_TABLE)
            .update(updates)
            .eq("id", gen_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    async def get_generation(self, gen_id: str) -> Optional[Dict[str, Any]]:
        """获取生成记录"""
        supabase = get_supabase()
        result = (
            supabase.table(self.GEN_TABLE)
            .select("*, digital_avatar_templates(*)")
            .eq("id", gen_id)
            .single()
            .execute()
        )
        return result.data

    async def list_user_generations(
        self, user_id: str, limit: int = 20, offset: int = 0
    ) -> Dict[str, Any]:
        """列出用户的生成历史"""
        supabase = get_supabase()
        result = (
            supabase.table(self.GEN_TABLE)
            .select("*, digital_avatar_templates(id, name, portrait_url, thumbnail_url)")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return {
            "generations": result.data or [],
            "total": len(result.data or []),
        }


# 单例
_instance: Optional[DigitalAvatarService] = None


def get_digital_avatar_service() -> DigitalAvatarService:
    global _instance
    if _instance is None:
        _instance = DigitalAvatarService()
    return _instance
