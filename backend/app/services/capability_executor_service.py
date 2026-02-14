"""
Capability Executor Service (PRD v1.1 §5)

AI 能力执行器：
1. 查询能力注册表
2. 执行 AI 能力（调用底层 AI 服务）
3. 管理执行记录和状态

Phase 0: 骨架 + 能力注册表查询
Phase 1: 接入 Kling AI / 自研模型 实际执行
"""

import logging
from typing import Optional, Dict, Any, List
from uuid import uuid4
from datetime import datetime

from .supabase_client import get_supabase

logger = logging.getLogger(__name__)


# PRD §5.1 — 能力注册表（硬编码，不依赖数据库）
CAPABILITY_REGISTRY: List[Dict[str, Any]] = [
    {
        "type": "hair_color",
        "name": "换发色",
        "description": "通过局部重绘改变发色，保持发型和光泽",
        "icon": "💇",
        "requires_face": True,
        "estimated_time": 15,
        "credit_cost": 2,
        "param_schema": {
            "target_color": {"type": "color", "label": "目标发色", "default": "#8B7355"},
            "intensity": {"type": "slider", "label": "强度", "min": 0.1, "max": 1.0, "default": 0.5},
        },
        "sort_order": 1,
        "enabled": True,
    },
    {
        "type": "outfit",
        "name": "换穿搭",
        "description": "替换衣物区域，生成新穿搭",
        "icon": "👗",
        "requires_face": False,
        "estimated_time": 20,
        "credit_cost": 2,
        "param_schema": {
            "reference_image": {"type": "image", "label": "参考穿搭图"},
            "description": {"type": "text", "label": "穿搭描述"},
        },
        "sort_order": 2,
        "enabled": True,
    },
    {
        "type": "background",
        "name": "换场景",
        "description": "分离前景人物，替换背景场景",
        "icon": "🏙️",
        "requires_face": False,
        "estimated_time": 25,
        "credit_cost": 3,
        "param_schema": {
            "scene": {"type": "text", "label": "场景描述"},
            "reference_image": {"type": "image", "label": "参考场景图"},
        },
        "sort_order": 3,
        "enabled": True,
    },
    {
        "type": "lighting",
        "name": "换打光",
        "description": "调整全图光照方向和氛围",
        "icon": "💡",
        "requires_face": False,
        "estimated_time": 15,
        "credit_cost": 2,
        "param_schema": {
            "direction": {"type": "select", "label": "光源方向", "options": [
                {"label": "正面", "value": "front"},
                {"label": "45°侧光", "value": "side_45"},
                {"label": "逆光", "value": "back"},
                {"label": "顶光", "value": "top"},
            ]},
            "intensity": {"type": "slider", "label": "强度", "min": 0.1, "max": 1.0, "default": 0.5},
        },
        "sort_order": 4,
        "enabled": True,
    },
    {
        "type": "style_transfer",
        "name": "风格变换",
        "description": "全图风格迁移（如日系、赛博朋克、油画）",
        "icon": "🎨",
        "requires_face": False,
        "estimated_time": 20,
        "credit_cost": 2,
        "param_schema": {
            "style": {"type": "text", "label": "目标风格"},
            "reference_image": {"type": "image", "label": "风格参考图"},
        },
        "sort_order": 5,
        "enabled": True,
    },
    {
        "type": "action_transfer",
        "name": "动作迁移",
        "description": "将参考图/视频的动作应用到用户人物",
        "icon": "🏃",
        "requires_face": True,
        "estimated_time": 30,
        "credit_cost": 3,
        "param_schema": {
            "reference_video": {"type": "image", "label": "参考动作"},
        },
        "sort_order": 6,
        "enabled": True,
    },
    {
        "type": "angle",
        "name": "角度变换",
        "description": "生成不同拍摄角度的人物图",
        "icon": "📐",
        "requires_face": True,
        "estimated_time": 15,
        "credit_cost": 2,
        "param_schema": {
            "angle": {"type": "select", "label": "角度", "options": [
                {"label": "正面", "value": "front"},
                {"label": "侧面", "value": "side"},
                {"label": "3/4侧", "value": "three_quarter"},
                {"label": "背面", "value": "back"},
            ]},
        },
        "sort_order": 7,
        "enabled": True,
    },
    {
        "type": "enhance",
        "name": "质感增强",
        "description": "超分辨率、皮肤质感优化、清晰度提升",
        "icon": "✨",
        "requires_face": False,
        "estimated_time": 10,
        "credit_cost": 1,
        "param_schema": {
            "level": {"type": "select", "label": "增强等级", "options": [
                {"label": "轻度", "value": "light"},
                {"label": "标准", "value": "standard"},
                {"label": "强力", "value": "heavy"},
            ]},
        },
        "sort_order": 8,
        "enabled": True,
    },
    {
        "type": "image_to_video",
        "name": "图转视频",
        "description": "将静态图生成带运镜过渡的视频，支持 Golden Preset",
        "icon": "📹",
        "requires_face": False,
        "estimated_time": 45,
        "credit_cost": 5,
        "param_schema": {
            "duration": {"type": "slider", "label": "时长(秒)", "min": 3, "max": 15, "default": 8},
            "golden_preset": {"type": "select", "label": "过渡效果", "options": [
                {"label": "自动", "value": "auto"},
                {"label": "旋转遮挡", "value": "spin_occlusion_outfit"},
                {"label": "快速横移", "value": "whip_pan_outfit"},
                {"label": "空间穿越", "value": "space_warp_outfit"},
            ]},
            "cfg_scale": {"type": "slider", "label": "创意度", "min": 0.3, "max": 0.7, "default": 0.5},
        },
        "sort_order": 9,
        "enabled": True,
    },
]


class CapabilityExecutorService:
    """AI 能力执行服务"""

    # ---- 能力注册表 ----

    async def get_registry(self) -> List[Dict[str, Any]]:
        """获取完整能力注册表（硬编码，前端渲染用）"""
        return CAPABILITY_REGISTRY

    async def list_capabilities(self) -> List[Dict[str, Any]]:
        """获取所有可用 AI 能力（优先 DB，fallback 硬编码）"""
        try:
            supabase = get_supabase()
            result = (
                supabase.table("capability_registry")
                .select("*")
                .eq("enabled", True)
                .order("sort_order")
                .execute()
            )
            if result.data:
                return result.data
        except Exception:
            logger.warning("capability_registry table not available, using hardcoded registry")
        return [c for c in CAPABILITY_REGISTRY if c.get("enabled")]

    async def get_capability(self, cap_type: str) -> Optional[Dict[str, Any]]:
        """获取单个能力定义"""
        supabase = get_supabase()
        result = (
            supabase.table("capability_registry")
            .select("*")
            .eq("type", cap_type)
            .single()
            .execute()
        )
        return result.data

    # ---- 能力执行 ----

    async def execute(
        self,
        session_id: str,
        user_id: str,
        capability: str,
        input_urls: List[str],
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        执行 AI 能力

        Args:
            session_id: 画布 session ID
            user_id: 用户 ID
            capability: 能力类型
            input_urls: 输入图 URL 列表
            params: 用户设置的参数

        Returns:
            { execution_id, status, result_url?, error? }
        """
        supabase = get_supabase()

        # 获取能力定义
        cap_def = await self.get_capability(capability)
        if not cap_def:
            raise ValueError(f"Unknown capability: {capability}")

        if not cap_def.get("enabled"):
            raise ValueError(f"Capability '{capability}' is not enabled")

        # 创建执行记录
        execution_id = str(uuid4())
        supabase.table("capability_executions").insert({
            "id": execution_id,
            "session_id": session_id,
            "user_id": user_id,
            "capability_type": capability,
            "input_urls": input_urls,
            "params": params,
            "status": "queued",
            "credits_used": cap_def.get("credit_cost", 1),
        }).execute()

        # Phase 0: 标记为 queued，后续由 Celery worker 异步处理
        # Phase 1: 实际调用 AI 服务
        # TODO: 发送 Celery 任务
        # from app.tasks import execute_capability_task
        # execute_capability_task.delay(execution_id)

        logger.info(
            f"Capability execution queued: {execution_id} "
            f"(cap={capability}, session={session_id})"
        )

        return {
            "execution_id": execution_id,
            "status": "queued",
        }

    async def get_execution_status(self, execution_id: str) -> Optional[Dict[str, Any]]:
        """查询执行状态"""
        supabase = get_supabase()
        result = (
            supabase.table("capability_executions")
            .select("*")
            .eq("id", execution_id)
            .single()
            .execute()
        )
        return result.data


# 单例
_instance: Optional[CapabilityExecutorService] = None


def get_capability_executor_service() -> CapabilityExecutorService:
    global _instance
    if _instance is None:
        _instance = CapabilityExecutorService()
    return _instance
