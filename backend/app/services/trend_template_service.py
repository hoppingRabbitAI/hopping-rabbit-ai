"""
Trend Template Service (PRD v1.1)

管理热门模板 CRUD + 分类查询 + 热度排序

对应前端 API: /api/v2/templates/*
"""

import logging
from typing import Optional, List, Dict, Any
from uuid import uuid4

from .supabase_client import get_supabase

logger = logging.getLogger(__name__)


class TrendTemplateService:
    """热门模板服务"""

    def __init__(self):
        self.table = "trend_templates"

    async def list_trending(
        self,
        category: Optional[str] = None,
        search: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: int = 20,
    ) -> Dict[str, Any]:
        """
        获取热门模板列表

        Args:
            category: 分类过滤 (hair, outfit, background, etc.)
            search: 搜索关键词
            cursor: 分页游标 (模板 ID)
            limit: 每页数量
        
        Returns:
            { templates: [...], next_cursor: str | None, total: int }
        """
        supabase = get_supabase()

        query = supabase.table(self.table).select("*").eq("status", "published")

        if category:
            query = query.eq("category", category)

        if search:
            # Supabase textSearch 需要配合 to_tsvector
            query = query.or_(
                f"name.ilike.%{search}%,description.ilike.%{search}%"
            )

        # 排序: 热度优先，更新时间次之
        query = query.order("trending_score", desc=True).order("updated_at", desc=True)

        # 游标分页
        if cursor:
            query = query.lt("id", cursor)

        query = query.limit(limit + 1)  # 多取一条判断是否有下一页

        result = query.execute()
        templates = result.data or []

        next_cursor = None
        if len(templates) > limit:
            templates = templates[:limit]
            next_cursor = templates[-1]["id"]

        return {
            "templates": templates,
            "next_cursor": next_cursor,
            "total": len(templates),
        }

    async def get_by_id(self, template_id: str) -> Optional[Dict[str, Any]]:
        """获取单个模板详情"""
        supabase = get_supabase()
        result = (
            supabase.table(self.table)
            .select("*")
            .eq("id", template_id)
            .single()
            .execute()
        )
        return result.data

    async def use_template(
        self, template_id: str, user_id: str, reference_upload_id: str
    ) -> Dict[str, Any]:
        """
        使用模板：递增 usage_count + 创建 canvas session

        Returns:
            { session_id: str }
        """
        supabase = get_supabase()

        # 递增使用次数
        supabase.rpc(
            "increment_usage_count",
            {"p_template_id": template_id}
        ).execute()

        # 获取模板详情（用于预填 route_result）
        template = await self.get_by_id(template_id)

        # 创建 canvas session
        session_id = str(uuid4())
        session_data = {
            "id": session_id,
            "user_id": user_id,
            "template_id": template_id,
            "status": "draft",
            "state": {"reference_upload_id": reference_upload_id},
        }

        # 如果模板有 route，预填到 session
        if template and template.get("route"):
            session_data["route_result"] = {
                "route": template["route"],
                "overall_description": template.get("description", ""),
                "suggested_golden_preset": None,
                "total_estimated_credits": 0,
                "confidence": 1.0,
            }

        supabase.table("canvas_sessions").insert(session_data).execute()

        return {"session_id": session_id}

    async def get_category_stats(self) -> Dict[str, int]:
        """获取各分类的模板数量统计"""
        supabase = get_supabase()
        result = (
            supabase.table(self.table)
            .select("category")
            .eq("status", "published")
            .execute()
        )
        stats: Dict[str, int] = {}
        for row in result.data or []:
            cat = row["category"]
            stats[cat] = stats.get(cat, 0) + 1
        return stats


# 单例
_instance: Optional[TrendTemplateService] = None


def get_trend_template_service() -> TrendTemplateService:
    global _instance
    if _instance is None:
        _instance = TrendTemplateService()
    return _instance
