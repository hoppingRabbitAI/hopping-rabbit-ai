"""
Canvas Session Service (PRD v1.1)

画布会话管理：CRUD + 素材上传 + 状态保存
"""

import logging
from typing import Optional, Dict, Any, List
from uuid import uuid4

from .supabase_client import get_supabase

logger = logging.getLogger(__name__)


class CanvasSessionService:
    """画布会话服务"""

    async def create_session(
        self,
        user_id: str,
        template_id: Optional[str] = None,
        subject_url: Optional[str] = None,
        reference_url: Optional[str] = None,
        text_input: Optional[str] = None,
    ) -> Dict[str, Any]:
        """创建新画布会话"""
        supabase = get_supabase()
        session_id = str(uuid4())

        data = {
            "id": session_id,
            "user_id": user_id,
            "template_id": template_id,
            "status": "draft",
            "state": {},
        }

        # 可选字段
        if subject_url:
            data["subject_url"] = subject_url
        if reference_url:
            data["reference_url"] = reference_url
        if text_input:
            data["text_input"] = text_input

        supabase.table("canvas_sessions").insert(data).execute()
        return data

    async def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """获取会话详情"""
        supabase = get_supabase()
        result = (
            supabase.table("canvas_sessions")
            .select("*")
            .eq("id", session_id)
            .single()
            .execute()
        )
        return result.data

    async def save_state(self, session_id: str, state: Dict[str, Any]) -> None:
        """保存画布状态"""
        supabase = get_supabase()
        supabase.table("canvas_sessions").update({
            "state": state,
        }).eq("id", session_id).execute()

    async def save_route_result(
        self, session_id: str, route_result: Dict[str, Any]
    ) -> None:
        """保存 IntentRouter 分析结果"""
        supabase = get_supabase()
        supabase.table("canvas_sessions").update({
            "route_result": route_result,
        }).eq("id", session_id).execute()

    async def list_user_sessions(
        self, user_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """获取用户的会话列表"""
        supabase = get_supabase()
        result = (
            supabase.table("canvas_sessions")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    async def delete_session(self, session_id: str, user_id: str) -> bool:
        """删除会话（验证所有权）"""
        supabase = get_supabase()
        result = (
            supabase.table("canvas_sessions")
            .delete()
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )
        return len(result.data or []) > 0

    # ---- 素材上传 ----

    async def upload_reference(
        self,
        session_id: str,
        user_id: str,
        file_path: str,
        filename: str,
        mime_type: str,
        file_size: int,
        role: str = "subject",
    ) -> Dict[str, Any]:
        """
        记录上传的参考图

        Returns:
            { upload_id, url }
        """
        supabase = get_supabase()
        upload_id = str(uuid4())

        # 构建存储路径
        storage_path = f"references/{user_id}/{session_id}/{upload_id}"

        # TODO: 实际上传到 Supabase Storage
        # 这里先记录元数据
        url = f"https://placeholder.supabase.co/storage/v1/object/public/{storage_path}"

        supabase.table("user_references").insert({
            "id": upload_id,
            "user_id": user_id,
            "session_id": session_id,
            "role": role,
            "storage_path": storage_path,
            "url": url,
            "filename": filename,
            "file_size": file_size,
            "mime_type": mime_type,
        }).execute()

        return {"upload_id": upload_id, "url": url}


# 单例
_instance: Optional[CanvasSessionService] = None


def get_canvas_session_service() -> CanvasSessionService:
    global _instance
    if _instance is None:
        _instance = CanvasSessionService()
    return _instance
