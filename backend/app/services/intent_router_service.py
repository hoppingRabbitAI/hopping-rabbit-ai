"""
Intent Router Service (PRD v1.1 §4)

AI 意图路由器 — analyze_and_route 完整流程:
1. _analyze_image_features: 分析用户照片 + 参考图的视觉特征
2. _detect_differences: 对比两图差异 → 提取变换意图
3. _generate_route: 根据差异 → 生成能力链路 RouteStep[]
4. _suggest_golden_preset: 如果命中模板黄金链路 → 推荐 preset

核心流程:
  (用户照片, 参考图/文字) → 分析差异 → 意图分类 → 生成 Route → 返回 RouteResult
"""

import logging
from typing import Optional, Dict, Any, List
from uuid import uuid4
from enum import Enum

logger = logging.getLogger(__name__)


class IntentCategory(str, Enum):
    """意图大类"""
    APPEARANCE = "appearance"       # 外观变身 (发色/穿搭)
    ENVIRONMENT = "environment"     # 环境改变 (背景/光影)
    ARTISTIC = "artistic"           # 艺术风格 (风格迁移/动作)
    ENHANCEMENT = "enhancement"     # 增强优化 (画质/超分)
    GENERATION = "generation"       # 生成创作 (图生视频)
    COMPOSITE = "composite"         # 综合变身 (多能力组合)


# 能力 → 默认 Credits
CAPABILITY_CREDITS = {
    "hair_color": 2,
    "outfit": 3,
    "background": 2,
    "lighting": 1,
    "style_transfer": 3,
    "action_transfer": 4,
    "angle": 2,
    "enhance": 1,
    "image_to_video": 5,
}

# 黄金预设 → 固定链路
GOLDEN_PRESETS = {
    "spin_occlusion_outfit": ["outfit", "lighting", "image_to_video"],
    "whip_pan_outfit": ["outfit", "background", "image_to_video"],
    "space_warp_outfit": ["outfit", "style_transfer", "image_to_video"],
}


class IntentRouterService:
    """AI 意图路由服务"""

    # ================================================================
    # 核心入口: analyze_and_route (PRD §4.1)
    # ================================================================

    async def analyze_and_route(
        self,
        subject_url: Optional[str] = None,
        reference_url: Optional[str] = None,
        text: Optional[str] = None,
        template_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        完整分析 + 路由

        Returns:
            RouteResult: {
                route: [{ capability, params, prompt_template, reason, estimated_credits }],
                overall_description: str,
                suggested_golden_preset: str | None,
                suggested_output_duration: float,
                total_estimated_credits: int,
                confidence: float,
            }
        """
        # 1. 分析图像特征
        subject_features = await self._analyze_image_features(subject_url) if subject_url else {}
        reference_features = await self._analyze_image_features(reference_url) if reference_url else {}

        # 2. 检测差异
        differences = await self._detect_differences(subject_features, reference_features, text)

        # 3. 生成 Route
        route = await self._generate_route(differences, text, template_id)

        # 4. 尝试匹配黄金预设
        golden_preset = self._suggest_golden_preset(route)

        # 5. 汇总
        total_credits = sum(step.get("estimated_credits", 0) for step in route)
        has_video = any(s["capability"] == "image_to_video" for s in route)
        suggested_duration = 5.0 if has_video else 0.0

        return {
            "route": route,
            "overall_description": self._generate_description(route, differences),
            "suggested_golden_preset": golden_preset,
            "suggested_output_duration": suggested_duration,
            "total_estimated_credits": total_credits,
            "confidence": 0.85 if reference_url else 0.65,
        }

    # ================================================================
    # 子流程方法
    # ================================================================

    async def _analyze_image_features(self, image_url: Optional[str]) -> Dict[str, Any]:
        """
        分析单张图片的视觉特征

        Phase 0: 返回占位特征
        Phase 1+: 调用 CLIP / 视觉 LLM 提取:
          - has_face, face_region, hair_color, skin_tone
          - clothing_type, clothing_color, clothing_style
          - background_type, background_dominant_color
          - lighting_direction, lighting_warmth
          - artistic_style, color_palette
        """
        if not image_url:
            return {}

        # Phase 0: 模拟特征
        return {
            "has_face": True,
            "hair_color": "black",
            "clothing_type": "casual",
            "background_type": "indoor",
            "lighting_warmth": "neutral",
            "overall_style": "natural",
        }

    async def _detect_differences(
        self,
        subject_features: Dict[str, Any],
        reference_features: Dict[str, Any],
        text: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        对比主体图与参考图的差异

        Returns:
            [{
                aspect: str,        # hair_color | outfit | background | ...
                from_value: Any,
                to_value: Any,
                significance: float,  # 0-1
            }]
        """
        differences = []

        if not subject_features or not reference_features:
            # 没有图片对比时，从文字描述推断
            if text:
                return await self._infer_differences_from_text(text)
            return differences

        # Phase 0: 简单键值对比
        comparison_keys = [
            ("hair_color", "hair_color"),
            ("clothing_type", "outfit"),
            ("background_type", "background"),
            ("lighting_warmth", "lighting"),
            ("overall_style", "style_transfer"),
        ]

        for feature_key, aspect in comparison_keys:
            s_val = subject_features.get(feature_key)
            r_val = reference_features.get(feature_key)
            if s_val and r_val and s_val != r_val:
                differences.append({
                    "aspect": aspect,
                    "from_value": s_val,
                    "to_value": r_val,
                    "significance": 0.8,
                })

        return differences

    async def _infer_differences_from_text(self, text: str) -> List[Dict[str, Any]]:
        """从文字描述推断差异"""
        differences = []
        text_lower = text.lower()

        keyword_map = {
            "hair_color": ["发色", "头发", "发型", "染发", "粉发", "银发", "金发", "棕发"],
            "outfit": ["穿搭", "换装", "衣服", "服装", "制服", "汉服", "西装", "裙子"],
            "background": ["背景", "场景", "环境", "街头", "海滩", "雪山", "星空"],
            "lighting": ["光影", "光线", "氛围", "色调", "暖色", "冷色", "黄昏", "日系"],
            "style_transfer": ["风格", "水彩", "油画", "动漫", "赛博", "复古", "杂志"],
            "action_transfer": ["动作", "姿势", "舞蹈", "芭蕾", "瑜伽"],
            "enhance": ["增强", "高清", "修复", "超清", "4K", "清晰"],
            "image_to_video": ["视频", "动起来", "动画", "动态"],
        }

        for aspect, keywords in keyword_map.items():
            matched = [kw for kw in keywords if kw in text_lower]
            if matched:
                differences.append({
                    "aspect": aspect,
                    "from_value": "original",
                    "to_value": text,
                    "significance": min(0.5 + len(matched) * 0.15, 1.0),
                })

        return differences

    async def _generate_route(
        self,
        differences: List[Dict[str, Any]],
        text: Optional[str] = None,
        template_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        根据差异列表生成能力链路

        返回 RouteStep[]，按执行顺序排列
        """
        if template_id:
            # TODO: 从 DB 加载模板的预设路由
            return await self._load_template_route(template_id)

        # 按重要性排序差异
        sorted_diffs = sorted(differences, key=lambda d: d.get("significance", 0), reverse=True)

        route = []
        for i, diff in enumerate(sorted_diffs):
            cap = diff["aspect"]
            if cap not in CAPABILITY_CREDITS:
                continue

            route.append({
                "capability": cap,
                "params": {},
                "prompt_template": f"将 {diff.get('from_value', '原始')} 变为 {diff.get('to_value', '目标')}",
                "reason": f"检测到 {cap} 需要从 {diff.get('from_value')} 变化为 {diff.get('to_value')}",
                "estimated_credits": CAPABILITY_CREDITS.get(cap, 2),
            })

        # 如果没有检测到差异，默认推荐 style_transfer
        if not route:
            route.append({
                "capability": "style_transfer",
                "params": {},
                "prompt_template": text or "AI 风格变换",
                "reason": "未检测到明确差异，推荐风格迁移",
                "estimated_credits": 3,
            })

        return route

    async def _load_template_route(self, template_id: str) -> List[Dict[str, Any]]:
        """从数据库加载模板预设路由"""
        # TODO: Phase 1 从 trend_templates 表读取 route JSON
        return [{
            "capability": "style_transfer",
            "params": {},
            "prompt_template": "应用模板效果",
            "reason": f"使用模板 {template_id} 的预设链路",
            "estimated_credits": 3,
        }]

    def _suggest_golden_preset(self, route: List[Dict[str, Any]]) -> Optional[str]:
        """检查当前链路是否匹配黄金预设"""
        cap_chain = [step["capability"] for step in route]

        for preset_name, preset_chain in GOLDEN_PRESETS.items():
            if cap_chain == preset_chain:
                return preset_name

        return None

    def _generate_description(
        self,
        route: List[Dict[str, Any]],
        differences: List[Dict[str, Any]],
    ) -> str:
        """生成链路说明"""
        cap_names = {
            "hair_color": "发色变换",
            "outfit": "穿搭换装",
            "background": "背景替换",
            "lighting": "光影调整",
            "style_transfer": "风格迁移",
            "action_transfer": "动作迁移",
            "angle": "角度调整",
            "enhance": "画质增强",
            "image_to_video": "图生视频",
        }

        if not route:
            return "未识别到明确变换意图"

        names = [cap_names.get(s["capability"], s["capability"]) for s in route]

        if len(names) == 1:
            return f"AI 将为你执行「{names[0]}」"
        return f"AI 将依次执行：{'→'.join(names)}，共 {len(route)} 个步骤"

    # ================================================================
    # 旧兼容接口 (parse_intent / confirm_intent)
    # ================================================================

    async def parse_intent(
        self,
        text: Optional[str] = None,
        reference_url: Optional[str] = None,
        subject_url: Optional[str] = None,
        template_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """兼容旧 parse 接口 → 内部调用 analyze_and_route"""
        result = await self.analyze_and_route(
            subject_url=subject_url,
            reference_url=reference_url,
            text=text,
            template_id=template_id,
        )

        # 转换为旧格式
        capabilities = []
        for i, step in enumerate(result["route"]):
            capabilities.append({
                "capability": step["capability"],
                "suggested_params": step.get("params", {}),
                "importance": 0.8,
                "order": i + 1,
            })

        return {
            "intent_id": str(uuid4()),
            "capabilities": capabilities,
            "confidence": result["confidence"],
            "explanation": result["overall_description"],
            # 新增字段（前端可选使用）
            "route_result": result,
        }

    async def confirm_intent(self, intent_id: str) -> Dict[str, Any]:
        """确认意图 → 生成执行 Pipeline"""
        session_id = str(uuid4())
        return {
            "session_id": session_id,
            "pipeline": [],
        }


# 单例
_instance: Optional[IntentRouterService] = None


def get_intent_router_service() -> IntentRouterService:
    global _instance
    if _instance is None:
        _instance = IntentRouterService()
    return _instance
