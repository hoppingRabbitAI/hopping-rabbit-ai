"""
Lepus AI - 多模型参数目录（Single Source of Truth）

所有 provider × endpoint × param 的完整定义。
前端通过 /models/catalog API 消费此数据，动态渲染参数表单。
后端 Adapter 读此数据做校验 + 注释化日志。

新增模型步骤：
  1. 在 PROVIDER_CATALOG 里加一个 provider 条目
  2. 填写 endpoints → params
  3. 在 registry.py 注册 generator
  4. 前端自动感知——不需要改前端代码
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Literal, Optional

logger = logging.getLogger(__name__)


# ────────────────────────────────────────────
# 1. ParamSpec：单个参数的完整描述
# ────────────────────────────────────────────

@dataclass
class ParamSpec:
    """
    一个 API 参数的完整规格。

    前端拿到后直接渲染对应 UI 控件：
        slider  → min/max/step
        select  → options
        text    → 单行输入
        textarea→ 多行（prompt 用）
        toggle  → 布尔开关
        hidden  → 不展示，静默传值
    """
    name: str                                       # 参数名，如 "cfg_scale"
    type: Literal["string", "float", "int",
                  "bool", "select", "json"]  = "string"
    required: bool                                  = False
    default: Any                                    = None
    options: Optional[List[Any]]                    = None  # select 时的可选值
    constraints: Dict[str, Any]                     = field(default_factory=dict)
    ui_hint: Literal["slider", "select", "text",
                     "textarea", "toggle", "hidden"] = "text"
    label_zh: str                                   = ""
    label_en: str                                   = ""
    desc_zh: str                                    = ""
    desc_en: str                                    = ""
    group: Literal["core", "quality", "advanced"]   = "core"
    locked_when: Optional[List[str]]                = None  # 满足条件时自动锁定

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


# ────────────────────────────────────────────
# 2. EndpointSpec：一个 API 端点（如 image_to_video）
# ────────────────────────────────────────────

@dataclass
class EndpointSpec:
    """一个 API 端点的描述。"""
    name: str                                   # 如 "image_to_video"
    display_name_zh: str                        = ""
    display_name_en: str                        = ""
    capabilities: List[str]                     = field(default_factory=list)
    models: List[str]                           = field(default_factory=list)
    params: List[ParamSpec]                     = field(default_factory=list)
    notes_zh: str                               = ""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["params"] = [p.to_dict() for p in self.params]
        return d


# ────────────────────────────────────────────
# 3. ProviderSpec：一个供应商的完整描述
# ────────────────────────────────────────────

@dataclass
class ProviderSpec:
    """一个视频生成供应商的完整描述。"""
    provider: str                               # 如 "kling"
    display_name: str                           = ""
    status: Literal["active", "beta", "planned"] = "active"
    api_doc_url: str                            = ""
    endpoints: List[EndpointSpec]               = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["endpoints"] = [e.to_dict() for e in self.endpoints]
        return d


# ════════════════════════════════════════════
# 4. PROVIDER CATALOG — 唯一真相源
# ════════════════════════════════════════════

# ── 共享参数模板 ──

def _prompt_param(required: bool = False) -> ParamSpec:
    return ParamSpec(
        name="prompt", type="string", required=required,
        ui_hint="textarea", label_zh="提示词", label_en="Prompt",
        desc_zh="描述视频内容、运镜、风格。对转场模板会由 focus_modes + golden_preset 自动合成",
        desc_en="Describe video content, camera movement, style",
        group="core", constraints={"maxLength": 2500},
    )

def _negative_prompt_param() -> ParamSpec:
    return ParamSpec(
        name="negative_prompt", type="string",
        default="blurry, distorted, low quality, watermark, text overlay, "
                "extra limbs, deformed face, artifacts, flickering",
        ui_hint="textarea", label_zh="反向提示词", label_en="Negative Prompt",
        desc_zh="排除不需要的内容，减少幻觉",
        desc_en="Exclude unwanted content to reduce hallucination",
        group="quality", constraints={"maxLength": 2500},
    )


# ────────────────────────────────────────────
# Kling AI
# ────────────────────────────────────────────

_KLING_IMAGE_TO_VIDEO = EndpointSpec(
    name="image_to_video",
    display_name_zh="图生视频",
    display_name_en="Image to Video",
    capabilities=["single_image", "image_tail"],
    models=["kling-v2-6", "kling-v2-5-turbo", "kling-v2-1-master"],
    notes_zh="支持 image_tail 首尾帧模式（转场对）。image_tail 启用时 mode 锁定 pro，cfg_scale 钳位 0.3-0.5，camera_control 禁用。",
    params=[
        _prompt_param(),
        _negative_prompt_param(),
        ParamSpec(
            name="model_name", type="select", required=True,
            default="kling-v2-6",
            options=["kling-v2-6", "kling-v2-5-turbo", "kling-v2-1-master"],
            ui_hint="select", label_zh="模型版本", label_en="Model",
            desc_zh="kling-v2-6 最新（支持声音）| v2-5-turbo 快速 | v2-1-master 高品质",
            desc_en="Model version",
            group="core",
        ),
        ParamSpec(
            name="duration", type="select", required=True,
            default="5",
            options=["5", "10"],
            ui_hint="select", label_zh="时长（秒）", label_en="Duration",
            desc_zh="5 或 10 秒。image_tail 模式推荐 5 秒",
            desc_en="Video duration in seconds",
            group="core",
        ),
        ParamSpec(
            name="mode", type="select",
            default="pro",
            options=["std", "pro"],
            ui_hint="select", label_zh="生成模式", label_en="Mode",
            desc_zh="std 标准（快）| pro 高品质（慢）。image_tail 时自动锁定 pro",
            desc_en="std=fast, pro=high quality. Locked to pro when image_tail is used",
            group="quality",
            locked_when=["image_tail"],
        ),
        ParamSpec(
            name="cfg_scale", type="float",
            default=0.5,
            constraints={"min": 0, "max": 1, "step": 0.05,
                         "image_tail_clamp": [0.3, 0.5]},
            ui_hint="slider", label_zh="Prompt 贴合度", label_en="CFG Scale",
            desc_zh="越高越贴合 prompt，越低越贴合输入图片。image_tail 时钳位到 0.3-0.5 以减少幻觉",
            desc_en="Higher = follow prompt more, lower = follow image more",
            group="quality",
            locked_when=["image_tail"],
        ),
        ParamSpec(
            name="aspect_ratio", type="select",
            default="16:9",
            options=["16:9", "9:16", "1:1"],
            ui_hint="select", label_zh="宽高比", label_en="Aspect Ratio",
            desc_zh="横屏 16:9 | 竖屏 9:16 | 方形 1:1",
            desc_en="Video aspect ratio",
            group="core",
        ),
        ParamSpec(
            name="camera_control", type="json",
            default=None,
            ui_hint="hidden", label_zh="运镜控制", label_en="Camera Control",
            desc_zh="高级运镜配置 {type, config}。image_tail 时自动禁用（API 互斥）",
            desc_en="Camera control config. Disabled when image_tail is active (API mutex)",
            group="advanced",
            locked_when=["image_tail"],
        ),
    ],
)

_KLING_TEXT_TO_VIDEO = EndpointSpec(
    name="text_to_video",
    display_name_zh="文生视频",
    display_name_en="Text to Video",
    capabilities=["text_only"],
    models=["kling-v2-6", "kling-v2-1-master", "kling-video-o1"],
    notes_zh="纯文本输入，无需图片。适合生成 B-roll 素材、背景视频。",
    params=[
        _prompt_param(required=True),
        _negative_prompt_param(),
        ParamSpec(
            name="model_name", type="select", required=True,
            default="kling-v2-6",
            options=["kling-v2-6", "kling-v2-1-master", "kling-video-o1"],
            ui_hint="select", label_zh="模型版本", label_en="Model",
            desc_zh="v2-6 最新推荐 | v2-1-master 经典 | video-o1 最高品质（慢）",
            desc_en="Model version",
            group="core",
        ),
        ParamSpec(
            name="duration", type="select", required=True,
            default="5",
            options=["5", "10"],
            ui_hint="select", label_zh="时长（秒）", label_en="Duration",
            desc_zh="5 或 10 秒",
            desc_en="Video duration in seconds",
            group="core",
        ),
        ParamSpec(
            name="mode", type="select",
            default="std",
            options=["std", "pro"],
            ui_hint="select", label_zh="生成模式", label_en="Mode",
            desc_zh="std 标准（快）| pro 高品质（慢）",
            desc_en="std=fast, pro=high quality",
            group="quality",
        ),
        ParamSpec(
            name="cfg_scale", type="float",
            default=0.5,
            constraints={"min": 0, "max": 1, "step": 0.05},
            ui_hint="slider", label_zh="Prompt 贴合度", label_en="CFG Scale",
            desc_zh="越高越贴合 prompt 文字描述",
            desc_en="Higher = follow prompt more closely",
            group="quality",
        ),
        ParamSpec(
            name="aspect_ratio", type="select",
            default="16:9",
            options=["16:9", "9:16", "1:1"],
            ui_hint="select", label_zh="宽高比", label_en="Aspect Ratio",
            desc_zh="横屏 16:9 | 竖屏 9:16 | 方形 1:1",
            desc_en="Video aspect ratio",
            group="core",
        ),
        ParamSpec(
            name="camera_control", type="json",
            default=None,
            ui_hint="hidden", label_zh="运镜控制", label_en="Camera Control",
            desc_zh="高级运镜配置 {type, config}",
            desc_en="Camera control configuration",
            group="advanced",
        ),
    ],
)

_KLING_MULTI_IMAGE_TO_VIDEO = EndpointSpec(
    name="multi_image_to_video",
    display_name_zh="多图生视频",
    display_name_en="Multi-Image to Video",
    capabilities=["multi_image"],
    models=["kling-v2-6", "kling-v2-5-turbo"],
    notes_zh="2-4 张图片参考生成视频。不支持 cfg_scale / camera_control。",
    params=[
        _prompt_param(required=True),
        _negative_prompt_param(),
        ParamSpec(
            name="model_name", type="select", required=True,
            default="kling-v2-6",
            options=["kling-v2-6", "kling-v2-5-turbo"],
            ui_hint="select", label_zh="模型版本", label_en="Model",
            desc_zh="v2-6 最新 | v2-5-turbo 快速",
            desc_en="Model version",
            group="core",
        ),
        ParamSpec(
            name="duration", type="select", required=True,
            default="5",
            options=["5", "10"],
            ui_hint="select", label_zh="时长（秒）", label_en="Duration",
            desc_zh="5 或 10 秒",
            desc_en="Video duration in seconds",
            group="core",
        ),
    ],
)

_KLING_MOTION_CONTROL = EndpointSpec(
    name="motion_control",
    display_name_zh="动作控制",
    display_name_en="Motion Control",
    capabilities=["motion_reference"],
    models=["kling-v1-6"],
    notes_zh="用参考视频的动作驱动图片人物。需要 video_url + image。",
    params=[
        _prompt_param(),
        ParamSpec(
            name="mode", type="select", required=True,
            default="pro",
            options=["std", "pro"],
            ui_hint="select", label_zh="生成模式", label_en="Mode",
            desc_zh="std 标准 | pro 高品质",
            desc_en="Generation mode",
            group="quality",
        ),
        ParamSpec(
            name="character_orientation", type="select",
            default="image",
            options=["image", "video"],
            ui_hint="select", label_zh="人物朝向", label_en="Character Orientation",
            desc_zh="image: 与图片一致(≤10s) | video: 与视频一致(≤30s)",
            desc_en="Character orientation reference",
            group="core",
        ),
        ParamSpec(
            name="duration", type="select",
            default="5",
            options=["5", "10"],
            ui_hint="select", label_zh="时长（秒）", label_en="Duration",
            desc_zh="5 或 10 秒",
            desc_en="Video duration",
            group="core",
        ),
    ],
)

KLING_PROVIDER = ProviderSpec(
    provider="kling",
    display_name="可灵 AI (Kling)",
    status="active",
    api_doc_url="https://app.klingai.com/cn/dev/document-api",
    endpoints=[
        _KLING_IMAGE_TO_VIDEO,
        _KLING_TEXT_TO_VIDEO,
        _KLING_MULTI_IMAGE_TO_VIDEO,
        _KLING_MOTION_CONTROL,
    ],
)


# ────────────────────────────────────────────
# Google Veo 3.1（骨架 — 待 API 正式发布后补全）
# ────────────────────────────────────────────

_VEO_IMAGE_TO_VIDEO = EndpointSpec(
    name="image_to_video",
    display_name_zh="图生视频",
    display_name_en="Image to Video",
    capabilities=["single_image"],          # 注意：Veo 不支持 image_tail
    models=["veo-3.1"],
    notes_zh="Veo 3.1 图生视频。不支持 image_tail 首尾帧模式——有此需求的模板会灰掉 Veo。",
    params=[
        _prompt_param(),
        ParamSpec(
            name="model_name", type="select", required=True,
            default="veo-3.1",
            options=["veo-3.1"],
            ui_hint="select", label_zh="模型版本", label_en="Model",
            desc_zh="Veo 3.1（预览版）",
            desc_en="Veo 3.1 (preview)",
            group="core",
        ),
        ParamSpec(
            name="duration", type="int",
            default=5,
            constraints={"min": 1, "max": 16, "step": 1},
            ui_hint="slider", label_zh="时长（秒）", label_en="Duration",
            desc_zh="1-16 秒（Veo 支持更长视频）",
            desc_en="1-16 seconds",
            group="core",
        ),
        ParamSpec(
            name="aspect_ratio", type="select",
            default="16:9",
            options=["16:9", "9:16", "1:1"],
            ui_hint="select", label_zh="宽高比", label_en="Aspect Ratio",
            desc_zh="横屏 16:9 | 竖屏 9:16 | 方形 1:1",
            desc_en="Video aspect ratio",
            group="core",
        ),
        ParamSpec(
            name="generate_audio", type="bool",
            default=True,
            ui_hint="toggle", label_zh="生成音频", label_en="Generate Audio",
            desc_zh="Veo 3.1 支持同步生成音频",
            desc_en="Generate audio alongside video",
            group="quality",
        ),
        ParamSpec(
            name="person_generation", type="select",
            default="allow_adult",
            options=["allow_adult", "dont_allow"],
            ui_hint="select", label_zh="人物生成策略", label_en="Person Generation",
            desc_zh="allow_adult 允许成人 | dont_allow 不允许人物",
            desc_en="Whether to allow person generation",
            group="advanced",
        ),
    ],
)

_VEO_TEXT_TO_VIDEO = EndpointSpec(
    name="text_to_video",
    display_name_zh="文生视频",
    display_name_en="Text to Video",
    capabilities=["text_only"],
    models=["veo-3.1"],
    notes_zh="Veo 3.1 文生视频，支持自动音频生成。",
    params=[
        _prompt_param(required=True),
        ParamSpec(
            name="model_name", type="select", required=True,
            default="veo-3.1",
            options=["veo-3.1"],
            ui_hint="select", label_zh="模型版本", label_en="Model",
            desc_zh="Veo 3.1（预览版）",
            desc_en="Veo 3.1 (preview)",
            group="core",
        ),
        ParamSpec(
            name="duration", type="int",
            default=5,
            constraints={"min": 1, "max": 16, "step": 1},
            ui_hint="slider", label_zh="时长（秒）", label_en="Duration",
            desc_zh="1-16 秒",
            desc_en="1-16 seconds",
            group="core",
        ),
        ParamSpec(
            name="aspect_ratio", type="select",
            default="16:9",
            options=["16:9", "9:16", "1:1"],
            ui_hint="select", label_zh="宽高比", label_en="Aspect Ratio",
            desc_zh="横屏 16:9 | 竖屏 9:16 | 方形 1:1",
            desc_en="Video aspect ratio",
            group="core",
        ),
        ParamSpec(
            name="generate_audio", type="bool",
            default=True,
            ui_hint="toggle", label_zh="生成音频", label_en="Generate Audio",
            desc_zh="Veo 3.1 支持同步生成音频",
            desc_en="Generate audio alongside video",
            group="quality",
        ),
    ],
)

VEO_PROVIDER = ProviderSpec(
    provider="veo",
    display_name="Google Veo 3.1",
    status="beta",
    api_doc_url="https://cloud.google.com/vertex-ai/generative-ai/docs/video/overview",
    endpoints=[
        _VEO_IMAGE_TO_VIDEO,
        _VEO_TEXT_TO_VIDEO,
    ],
)


# ────────────────────────────────────────────
# SeedDance（骨架 — 待对接）
# ────────────────────────────────────────────

_SEEDDANCE_IMAGE_TO_VIDEO = EndpointSpec(
    name="image_to_video",
    display_name_zh="图生视频",
    display_name_en="Image to Video",
    capabilities=["single_image", "image_tail"],   # SeedDance 支持首尾帧
    models=["seeddance-1.0"],
    notes_zh="字节 SeedDance 图生视频，支持首尾帧模式。",
    params=[
        _prompt_param(),
        ParamSpec(
            name="model_name", type="select", required=True,
            default="seeddance-1.0",
            options=["seeddance-1.0"],
            ui_hint="select", label_zh="模型版本", label_en="Model",
            desc_zh="SeedDance 1.0",
            desc_en="SeedDance 1.0",
            group="core",
        ),
        ParamSpec(
            name="duration", type="int",
            default=5,
            constraints={"min": 1, "max": 10, "step": 1},
            ui_hint="slider", label_zh="时长（秒）", label_en="Duration",
            desc_zh="1-10 秒",
            desc_en="1-10 seconds",
            group="core",
        ),
        ParamSpec(
            name="guidance_scale", type="float",
            default=7.5,
            constraints={"min": 1, "max": 20, "step": 0.5},
            ui_hint="slider", label_zh="引导强度", label_en="Guidance Scale",
            desc_zh="越高越贴合 prompt。注意：与 Kling 的 cfg_scale (0-1) 范围不同",
            desc_en="Higher = follow prompt more. Note: different range from Kling cfg_scale",
            group="quality",
        ),
        ParamSpec(
            name="num_inference_steps", type="int",
            default=50,
            constraints={"min": 20, "max": 100, "step": 5},
            ui_hint="slider", label_zh="推理步数", label_en="Inference Steps",
            desc_zh="步数越多品质越高、速度越慢",
            desc_en="More steps = higher quality, slower generation",
            group="advanced",
        ),
    ],
)

SEEDDANCE_PROVIDER = ProviderSpec(
    provider="seeddance",
    display_name="SeedDance (字节跳动)",
    status="planned",
    api_doc_url="",
    endpoints=[
        _SEEDDANCE_IMAGE_TO_VIDEO,
    ],
)


# ════════════════════════════════════════════
# 5. 全局查询 API
# ════════════════════════════════════════════

# 所有已注册的供应商
PROVIDER_CATALOG: Dict[str, ProviderSpec] = {
    "kling": KLING_PROVIDER,
    "veo": VEO_PROVIDER,
    "seeddance": SEEDDANCE_PROVIDER,
}


def get_catalog_dict() -> Dict[str, Any]:
    """返回完整目录的 JSON-safe dict，供 API 输出。"""
    return {
        provider: spec.to_dict()
        for provider, spec in PROVIDER_CATALOG.items()
    }


def get_provider_catalog(provider: str) -> Optional[Dict[str, Any]]:
    """返回单个供应商的目录。"""
    spec = PROVIDER_CATALOG.get(provider)
    return spec.to_dict() if spec else None


def get_endpoint_spec(provider: str, endpoint: str) -> Optional[EndpointSpec]:
    """获取某 provider 某 endpoint 的 spec。"""
    prov = PROVIDER_CATALOG.get(provider)
    if not prov:
        return None
    for ep in prov.endpoints:
        if ep.name == endpoint:
            return ep
    return None


def get_param_defaults(provider: str, endpoint: str) -> Dict[str, Any]:
    """获取某端点所有参数的默认值 dict。"""
    ep = get_endpoint_spec(provider, endpoint)
    if not ep:
        return {}
    return {
        p.name: p.default
        for p in ep.params
        if p.default is not None
    }


def check_compatibility(
    required_capabilities: List[str],
) -> List[Dict[str, Any]]:
    """
    给定模板需要的能力列表，返回所有兼容的 provider×endpoint×model 组合。

    Args:
        required_capabilities: 如 ["image_tail"] 或 ["single_image"]

    Returns:
        [
            {
                "provider": "kling",
                "endpoint": "image_to_video",
                "models": ["kling-v2-6", ...],
                "compatible": True,
                "status": "active",
            },
            {
                "provider": "veo",
                "endpoint": "image_to_video",
                "models": ["veo-3.1"],
                "compatible": False,   # 不支持 image_tail
                "missing": ["image_tail"],
                "status": "beta",
            },
        ]
    """
    results = []
    required_set = set(required_capabilities)

    for provider, spec in PROVIDER_CATALOG.items():
        for ep in spec.endpoints:
            ep_caps = set(ep.capabilities)
            missing = required_set - ep_caps
            results.append({
                "provider": provider,
                "provider_display": spec.display_name,
                "endpoint": ep.name,
                "endpoint_display": ep.display_name_zh,
                "models": ep.models,
                "compatible": len(missing) == 0,
                "missing_capabilities": list(missing) if missing else [],
                "status": spec.status,
            })

    return results


def annotate_payload(
    provider: str,
    endpoint: str,
    payload: Dict[str, Any],
) -> Dict[str, str]:
    """
    给定实际要发送的 payload，返回每个参数的人类可读注释。
    用于 render 日志——就是你说的 "调用接口时的注释和说明"。

    Returns:
        {
            "prompt": "← focus_modes + golden_preset 合成的文本",
            "model_name": "← kling-v2-6 (可灵 V2.6，支持生成声音)",
            "mode": "← pro (image_tail_locked: image_tail 在 std/5 组合下不可用)",
            ...
        }
    """
    ep = get_endpoint_spec(provider, endpoint)
    if not ep:
        return {k: f"← {v}" for k, v in payload.items()}

    param_map = {p.name: p for p in ep.params}
    annotations: Dict[str, str] = {}

    for key, value in payload.items():
        spec = param_map.get(key)
        if spec:
            note = f"← {value}"
            if spec.desc_zh:
                note += f"  ({spec.desc_zh})"
            if spec.locked_when:
                # 检查是否有锁定条件被触发
                triggered = [c for c in spec.locked_when if c in payload and payload[c] is not None]
                if triggered:
                    note += f"  [🔒 locked by: {', '.join(triggered)}]"
            annotations[key] = note
        else:
            # payload 里有但 catalog 里没定义的参数
            annotations[key] = f"← {value}  (⚠️ 未在目录中定义)"

    return annotations
