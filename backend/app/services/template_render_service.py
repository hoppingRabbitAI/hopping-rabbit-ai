"""
Template Render Service
将模板 workflow 映射为 Kling 任务
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Literal

from app.config import get_settings
from app.services.supabase_client import get_supabase
from app.services.video_generation.model_catalog import annotate_payload
from app.tasks.image_to_video import process_image_to_video
from app.tasks.multi_image_to_video import process_multi_image_to_video
from app.tasks.motion_control import process_motion_control
from app.tasks.text_to_video import process_text_to_video

logger = logging.getLogger(__name__)


# ── 中间帧约束：极简版，给 motion_prompt 留空间 ──
_IDENTITY_ANCHOR = (
    "maintain exact facial identity and appearance throughout, "
    "do NOT add or remove accessories/objects not in input frames"
)

# ── 极简 focus 标签 → 一句话后缀（不再是多段长话）──
# 当 motion_prompt 存在时，编舞脚本已涵盖所有细节，
# focus_suffix 只起「提醒」作用，不需要展开描述
TRANSITION_FOCUS_SUFFIX: Dict[str, str] = {
    "outfit_change": "focus: wardrobe transformation",
    "subject_preserve": "focus: subject identity continuity",
    "scene_shift": "focus: scene/background transition",
}

# 保留旧名称做兼容（外部可能引用）
TRANSITION_FOCUS_PROMPTS = TRANSITION_FOCUS_SUFFIX


# ── 参数变体：每个变体改变真实 Kling API 参数，而不是在 prompt 末尾加空话 ──
# cfg_scale 越低 → 越严格贴合首尾帧，越高 → AI 创意空间越大
TRANSITION_PARAM_VARIANTS: List[Dict[str, Any]] = [
    {
        "label": "精准",
        "label_en": "precise",
        "description": "严格贴合首尾帧，动作精准",
        "cfg_scale": 0.35,
    },
    {
        "label": "均衡",
        "label_en": "balanced",
        "description": "默认平衡模式",
        "cfg_scale": 0.50,
    },
    {
        "label": "创意",
        "label_en": "creative",
        "description": "允许 AI 更多创意发挥",
        "cfg_scale": 0.70,
    },
]

# 向后兼容：旧代码可能引用这个名称
TRANSITION_VARIANT_HINTS = TRANSITION_PARAM_VARIANTS


TRANSITION_GOLDEN_PRESETS: Dict[str, Dict[str, str]] = {
    "spin_occlusion_outfit": {
        "label": "旋转遮挡",
        "system_prompt": (
            "cinematic spin transition, subject performs a 300-360 degree turn, "
            "enforce center-point locking, during 30%-50% timeline use back-view occlusion "
            "as the outfit replacement buffer"
        ),
    },
    "whip_pan_outfit": {
        "label": "快甩变装",
        "system_prompt": (
            "whip pan transition with short directional motion blur and lens streak, "
            "switch outfit at the fastest pan phase while preserving face identity after pan"
        ),
    },
    "space_warp_outfit": {
        "label": "空间穿梭",
        "system_prompt": (
            "space warp portal transition, stretch background perspective first then recover, "
            "complete outfit morph near portal core with stable facial identity"
        ),
    },
}


def _get_callback_url() -> Optional[str]:
    settings = get_settings()
    if settings.callback_base_url:
        return f"{settings.callback_base_url.rstrip('/')}/api/callback/kling"
    return None


def _create_ai_task(
    user_id: str,
    task_type: str,
    input_params: Dict[str, Any],
    project_id: Optional[str],
    clip_id: Optional[str],
) -> str:
    supabase = get_supabase()
    ai_task_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    callback_url = _get_callback_url()

    logger.info(f"[TemplateRender] 创建 AI 任务: task_id={ai_task_id}, type={task_type}, user={user_id}")
    logger.info(f"[TemplateRender] 任务参数: template_id={input_params.get('template_id')}, template_name={input_params.get('template_name')}")
    logger.info(f"[TemplateRender] workflow: {input_params.get('template_workflow')}")

    task_data = {
        "id": ai_task_id,
        "user_id": user_id,
        "task_type": task_type,
        "provider": "kling",
        "status": "pending",
        "progress": 0,
        "status_message": "任务已创建，等待处理" + ("（回调模式）" if callback_url else "（轮询模式）"),
        "input_params": input_params,
        "created_at": now,
        "updated_at": now,
    }
    if project_id:
        task_data["project_id"] = project_id
    if clip_id:
        task_data["clip_id"] = clip_id

    supabase.table("tasks").insert(task_data).execute()
    return ai_task_id


class TemplateRenderService:
    @staticmethod
    def _workflow_duration_from_pacing(workflow: Dict[str, Any]) -> Optional[str]:
        pacing = str(workflow.get("pacing") or "").lower().strip()
        mapping = {
            "fast": "5",
            "medium": "5",
            "slow": "10",
        }
        return mapping.get(pacing)

    @staticmethod
    def _workflow_aspect_ratio_from_shot_type(workflow: Dict[str, Any]) -> Optional[str]:
        shot_type = str(workflow.get("shot_type") or "").lower().strip()
        mapping = {
            "wide": "16:9",
            "medium": "16:9",
            "close": "9:16",
            "macro": "9:16",
        }
        return mapping.get(shot_type)

    def _workflow_derived_defaults(self, workflow: Dict[str, Any]) -> Dict[str, Any]:
        defaults: Dict[str, Any] = {}
        duration = self._workflow_duration_from_pacing(workflow)
        if duration:
            defaults["duration"] = duration
        aspect_ratio = self._workflow_aspect_ratio_from_shot_type(workflow)
        if aspect_ratio:
            defaults["aspect_ratio"] = aspect_ratio
        return defaults

    # ── 转场时长智能推算 ──────────────────────────────────
    # Kling API 仅支持 "5" 或 "10"。
    # 规则：基于 transition_spec 的 duration_ms / family / camera_movement 判断。
    #   选 "10" 当：慢速转场 + 电影感运镜（需要更多时间做平滑运动）
    #   否则 "5"（快速转场、换装场景 — 5s 更干脆利落）

    _SLOW_FAMILIES = {"morph", "dolly_zoom", "luma_wipe"}
    _SLOW_CAMERAS = {"pull", "orbit", "dolly_zoom"}

    @staticmethod
    def _infer_transition_duration(template_record: Dict[str, Any]) -> str:
        """根据 transition_spec 特征推算最佳 Kling API duration ("5" 或 "10")"""
        metadata = template_record.get("metadata") or {}
        if isinstance(metadata, str):
            import json
            try:
                metadata = json.loads(metadata)
            except Exception:
                return "5"
        ts = metadata.get("transition_spec") or {}

        duration_ms = ts.get("duration_ms", 0)
        family = (ts.get("family") or "").lower()
        camera = (ts.get("camera_movement") or "").lower()
        pacing = (template_record.get("workflow") or {}).get("pacing", "")

        # 规则 1: pacing 直接标记 slow
        if str(pacing).lower() == "slow":
            return "10"

        # 规则 2: 慢速转场类型 + 长时长
        if family in TemplateRenderService._SLOW_FAMILIES and duration_ms >= 1000:
            return "10"

        # 规则 3: 慢运镜 + 中等以上时长
        if camera in TemplateRenderService._SLOW_CAMERAS and duration_ms >= 800:
            return "10"

        # 规则 4: 超长转场窗口
        if duration_ms >= 1500:
            return "10"

        return "5"

    def build_render_spec(
        self,
        template_record: Dict[str, Any],
        render_params: Dict[str, Any],
    ) -> Dict[str, Any]:
        workflow = template_record.get("workflow") or {}
        overrides = render_params.get("overrides") or {}
        workflow = {**workflow, **overrides}
        workflow_defaults = self._workflow_derived_defaults(workflow)

        template_type = template_record.get("type", "background")
        endpoint = workflow.get("kling_endpoint") or self._default_endpoint(template_type)

        transition_inputs_raw = render_params.get("transition_inputs") or {}
        transition_inputs: Dict[str, Any] = transition_inputs_raw if isinstance(transition_inputs_raw, dict) else {}
        has_transition_pair = bool(
            transition_inputs.get("from_template_id") and transition_inputs.get("to_template_id")
        )

        boundary_raw = (
            render_params.get("boundary_ms")
            or transition_inputs.get("boundary_ms")
            or 480
        )
        try:
            boundary_ms = int(boundary_raw)
        except (TypeError, ValueError):
            boundary_ms = 480
        boundary_ms = max(200, min(boundary_ms, 2000))

        quality_tier = (
            render_params.get("quality_tier")
            or transition_inputs.get("quality_tier")
            or "template_match"
        )

        # ── focus_modes ──
        focus_modes_raw = (
            render_params.get("focus_modes")
            or transition_inputs.get("focus_modes")
        )
        # ── fallback: 如果都没设，用 LLM 分析推荐的 focus_modes ──
        if not focus_modes_raw and has_transition_pair:
            metadata_raw_fm = template_record.get("metadata") or {}
            ts_fm = (metadata_raw_fm if isinstance(metadata_raw_fm, dict) else {}).get("transition_spec") or {}
            llm_focus = ts_fm.get("recommended_focus_modes") or []
            if llm_focus:
                focus_modes_raw = llm_focus
        focus_modes: Optional[List[Literal["outfit_change", "subject_preserve", "scene_shift"]]] = None
        golden_preset: Optional[Literal["spin_occlusion_outfit", "whip_pan_outfit", "space_warp_outfit"]] = None
        if has_transition_pair:
            focus_modes = self._normalize_transition_focus_modes(focus_modes_raw)
            transition_inputs["focus_modes"] = focus_modes

            preset_raw = render_params.get("golden_preset") or transition_inputs.get("golden_preset")
            # ── fallback: 从 LLM 分析的 family + category 智能推导 preset ──
            if not preset_raw and has_transition_pair:
                metadata_raw_gp = template_record.get("metadata") or {}
                ts_gp = (metadata_raw_gp if isinstance(metadata_raw_gp, dict) else {}).get("transition_spec") or {}
                family_gp = (ts_gp.get("family") or "").lower()
                category_gp = (ts_gp.get("transition_category") or "").lower()
                if family_gp in ("spin", "occlusion") or "spin" in (ts_gp.get("motion_pattern") or "").lower():
                    preset_raw = "spin_occlusion_outfit"
                elif family_gp in ("whip_pan", "flash_cut"):
                    preset_raw = "whip_pan_outfit"
                elif family_gp in ("morph", "dolly_zoom", "zoom_blur") or category_gp == "morphing":
                    preset_raw = "space_warp_outfit"
            golden_preset = self._normalize_transition_golden_preset(str(preset_raw) if preset_raw else None)
            transition_inputs["golden_preset"] = golden_preset

        prompt_seed = self._resolve_prompt_seed(template_record, workflow)
        if has_transition_pair:
            # ── focus_suffix: 极简标签（不再是多段长话）──
            focus_tags = [TRANSITION_FOCUS_SUFFIX[m] for m in (focus_modes or []) if m in TRANSITION_FOCUS_SUFFIX]
            focus_suffix = ", ".join(focus_tags) if focus_tags else ""

            preset_config = TRANSITION_GOLDEN_PRESETS.get(golden_preset or "")
            preset_clause = (preset_config or {}).get("system_prompt", "")

            # ── 提取 motion_prompt（编舞脚本 = prompt 的主体） ──
            metadata_raw = template_record.get("metadata") or {}
            transition_spec = metadata_raw.get("transition_spec") or {}
            motion_prompt = str(transition_spec.get("motion_prompt") or "").strip()
            analyzed_prompt = str(transition_spec.get("recommended_prompt") or "").strip()
            analyzed_motion = str(transition_spec.get("motion_pattern") or "").strip()
            analyzed_camera = str(transition_spec.get("camera_movement") or "").strip()
            # ── 新增：多层运动字段（视频理解增强） ──
            camera_compound = str(transition_spec.get("camera_compound") or "").strip()
            background_motion = str(transition_spec.get("background_motion") or "").strip()
            subject_motion = str(transition_spec.get("subject_motion") or "").strip()

            # 优先级：motion_prompt（编舞脚本）> preset_clause（金牌预设）> 多层字段拼接 > 单字段拼接
            # ⚠️ 不再用 recommended_prompt 做 fallback（它含具体人物/场景，会污染 prompt）
            if motion_prompt and len(motion_prompt) > 20:
                choreography = motion_prompt
            elif preset_clause:
                choreography = preset_clause
            else:
                # 降级：用多层运动字段拼接（如果有），否则用单字段
                fallback_parts = []
                if subject_motion and subject_motion.lower() not in ("", "static"):
                    fallback_parts.append(f"subject: {subject_motion}")
                if background_motion and background_motion.lower() not in ("", "static"):
                    fallback_parts.append(f"background: {background_motion}")
                if camera_compound and camera_compound.lower() not in ("", "static"):
                    fallback_parts.append(f"camera: {camera_compound}")
                elif analyzed_camera and analyzed_camera.lower() not in ("", "static"):
                    fallback_parts.append(f"camera: {analyzed_camera}")
                if not fallback_parts:
                    fallback_parts = [
                        f"motion: {analyzed_motion}" if analyzed_motion else "",
                        f"camera: {analyzed_camera}" if analyzed_camera and analyzed_camera != "static" else "",
                    ]
                choreography = ", ".join(p for p in fallback_parts if p)

            # ── 组装最终 prompt：编舞脚本做主体，身份约束做后缀 ──
            # 结构：[编舞脚本]; [身份约束]; [focus标签]
            # image_to_video + image_tail 已通过首尾帧锁定 A/B 画面，
            # prompt 只需描述「怎么从 A 过渡到 B」+ 极简身份提醒。
            prompt_parts = [p for p in [choreography, _IDENTITY_ANCHOR, focus_suffix] if p]
            prompt_seed = "; ".join(prompt_parts) if prompt_parts else ""

        user_prompt = render_params.get("prompt") or ""
        if has_transition_pair:
            # ── 转场对 prompt 架构 ──
            # prompt_seed（编舞蓝图）是唯一核心，user_prompt 仅作可选增强。
            # 防泄漏：如果 user_prompt 就是模板的 recommended_prompt（用户没改），
            # 直接丢弃 —— 那是模板源视频的内容描述，不是用户自己的。
            template_recommended = str(
                (metadata_raw.get("transition_spec") or {}).get("recommended_prompt") or ""
            ).strip()
            if user_prompt.strip() == template_recommended and template_recommended:
                user_prompt = ""  # 用户没主动输入，丢弃模板内容
            # 编舞脚本做主体；用户描述（如有）做后缀增强
            if user_prompt.strip():
                prompt = f"{prompt_seed}, {user_prompt.strip()}"
            else:
                prompt = prompt_seed
        else:
            prompt = self._compose_prompt(user_prompt, workflow, seed_override=prompt_seed)
        negative_prompt = render_params.get("negative_prompt") or workflow.get("negative_prompt", "")

        # ── 转场对：补充 negative_prompt 防止中间帧幻觉 ──
        if has_transition_pair:
            hallucination_neg = (
                "extra accessories, hat appearing, glasses appearing, "
                "new objects not in input images, changing hair color, "
                "extra limbs, deformed face, blurry, watermark"
            )
            if negative_prompt:
                negative_prompt = f"{negative_prompt}, {hallucination_neg}"
            else:
                negative_prompt = hallucination_neg

        model_name = render_params.get("model_name") or workflow.get("model_name", "kling-v2-6")
        duration = (
            render_params.get("duration")
            or workflow.get("duration")
            or workflow_defaults.get("duration")
        )
        # Phase 5a: 记录参数决策来源
        _decision: Dict[str, str] = {}
        if render_params.get("duration"):
            _decision["duration"] = "user_param"
        elif workflow.get("duration"):
            _decision["duration"] = "workflow"
        elif workflow_defaults.get("duration"):
            _decision["duration"] = "workflow_defaults"
        # ── 转场对：基于 transition_spec 自动推算最佳时长 ──
        if not duration and has_transition_pair:
            duration = self._infer_transition_duration(template_record)
            _decision["duration"] = f"inferred:{duration}"
        if not duration:
            duration = "5"
            _decision.setdefault("duration", "fallback")
        cfg_scale = (
            render_params.get("cfg_scale")
            if render_params.get("cfg_scale") is not None
            else workflow.get("cfg_scale", 0.5)
        )
        _decision["cfg_scale"] = "user_param" if render_params.get("cfg_scale") is not None else "workflow"
        mode = render_params.get("mode") or workflow.get("mode", "std")
        _decision["mode"] = "user_param" if render_params.get("mode") else "workflow"
        if has_transition_pair:
            _decision["focus_modes"] = "user_param" if render_params.get("focus_modes") else "default"
            _decision["golden_preset"] = "user_param" if render_params.get("golden_preset") else "default"
            has_motion_prompt = bool((metadata_raw.get("transition_spec") or {}).get("motion_prompt"))
            _decision["prompt"] = (
                "motion_prompt" if has_motion_prompt
                else "golden_preset" if preset_clause
                else "fallback_composed"
            )
            # 记录分析方式（视频理解 vs 静态帧）
            _decision["analysis_method"] = str(transition_spec.get("_analysis_method") or "unknown")
            # 透明化：golden_preset 仅在 motion_prompt 缺失时才被使用
            if has_motion_prompt:
                _decision["golden_preset_effective"] = False
            # 预告：image_tail 模式会强制覆盖 mode 和 cfg_scale
            _decision["image_tail_overrides"] = {
                "mode": "pro (locked)",
                "cfg_scale": "0.3-0.5 (clamped)",
                "camera_control": "disabled",
            }

        raw_camera_control = workflow.get("camera_control")
        if isinstance(raw_camera_control, dict) and "type" in raw_camera_control:
            camera_control = raw_camera_control
        else:
            camera_control = self._derive_camera_control(workflow)

        # ── 转场对：从 LLM 分析的 camera_movement 补充 camera_control ──
        if has_transition_pair and not camera_control:
            metadata_raw = template_record.get("metadata") or {}
            ts = metadata_raw.get("transition_spec") or {}
            analyzed_cam = str(ts.get("camera_movement") or "").strip().lower()
            analyzed_motion = str(ts.get("motion_pattern") or "").strip().lower()
            if analyzed_cam and analyzed_cam != "static":
                # 构造一个 synthetic workflow 来驱动 _derive_camera_control
                synthetic_wf: Dict[str, Any] = {
                    "camera_move": analyzed_cam,
                    "transition": analyzed_motion,
                    "pacing": "fast",
                }
                camera_control = self._derive_camera_control(synthetic_wf)

        aspect_ratio = (
            render_params.get("aspect_ratio")
            or workflow.get("aspect_ratio")
            or workflow_defaults.get("aspect_ratio")
        )

        images = render_params.get("images") or []
        template_url = template_record.get("url")
        if not template_url and template_record.get("storage_path"):
            bucket = template_record.get("bucket") or "templates"
            template_url = get_supabase().storage.from_(bucket).get_public_url(
                template_record["storage_path"]
            )
        if template_url and not images:
            images = [template_url]

        # ── 转场对使用 image_to_video + image_tail（首尾帧模式）──
        # multi_image_to_video 无法保证终帧匹配 B 图且不支持 cfg_scale/camera_control；
        # image_to_video + image_tail 让 Kling 强制首帧=A图、尾帧=B图，
        # 同时可用 cfg_scale 控制 prompt 贴合度、camera_control 复刻运镜。
        image_tail: Optional[str] = None
        if has_transition_pair and len(images) >= 2:
            endpoint = "image_to_video"
            image_tail = images[1]   # B 图 → 尾帧
            images = [images[0]]     # A 图 → 首帧
            # image_tail 模式：使用最新模型
            model_name = "kling-v2-6"
            # image_tail 在 std/5 组合下不可用，必须用 pro 模式
            mode = "pro"
            _decision["mode"] = "image_tail_locked:pro"
            # ⚠️ API 互斥约束: image+image_tail / camera_control / dynamic_masks+static_mask 三选一
            # 使用 image_tail 时必须清除 camera_control，否则 API 会报错
            camera_control = None
            # cfg_scale 控制 prompt 贴合度 vs 图片忠实度，
            # 降低以减少中间帧幻觉（如凭空出现配饰/物品）
            cfg_scale = float(cfg_scale) if cfg_scale is not None else 0.5
            cfg_scale = max(min(cfg_scale, 0.5), 0.3)
            _decision["cfg_scale"] = f"image_tail_clamped:{cfg_scale}"

        if endpoint == "multi_image_to_video" and len(images) < 2 and not has_transition_pair:
            # 回退兼容旧入口：仅单图输入时继续走 image_to_video
            endpoint = "image_to_video"

        video_url = render_params.get("video_url") or workflow.get("video_url")

        resolved_transition_inputs: Optional[Dict[str, Any]] = None
        if has_transition_pair:
            resolved_transition_inputs = {
                **transition_inputs,
                "boundary_ms": boundary_ms,
                "quality_tier": quality_tier,
            }

        return {
            "endpoint": endpoint,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "model_name": model_name,
            "duration": duration,
            "cfg_scale": cfg_scale,
            "mode": mode,
            "camera_control": camera_control,
            "aspect_ratio": aspect_ratio,
            "images": images,
            "image_tail": image_tail,
            "video_url": video_url,
            "workflow": workflow,
            "transition_inputs": resolved_transition_inputs,
            "_decision_chain": _decision,
        }

    @staticmethod
    def _workflow_summary(workflow: Dict[str, Any]) -> Dict[str, Any]:
        summary: Dict[str, Any] = {}
        for key in ("kling_endpoint", "shot_type", "camera_move", "transition", "pacing"):
            value = workflow.get(key)
            if value:
                summary[key] = value

        style = workflow.get("style")
        if isinstance(style, dict):
            summary["style"] = {
                k: v for k, v in style.items() if v
            }
        elif style:
            summary["style"] = style

        return summary

    def _persist_template_to_clip_metadata(
        self,
        clip_id: str,
        template_record: Dict[str, Any],
        task_id: str,
        endpoint: str,
        workflow: Dict[str, Any],
    ) -> None:
        supabase = get_supabase()
        clip_resp = supabase.table("clips").select("id,metadata").eq("id", clip_id).single().execute()
        clip = clip_resp.data
        if not clip:
            logger.warning("[TemplateRender] clip 不存在，跳过 metadata 回写: clip_id=%s", clip_id)
            return

        metadata = clip.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}

        metadata["template_render"] = {
            "template_id": template_record.get("template_id"),
            "template_name": template_record.get("name"),
            "template_category": template_record.get("category"),
            "template_type": template_record.get("type"),
            "task_id": task_id,
            "endpoint": endpoint,
            "selected_at": datetime.utcnow().isoformat(),
            "workflow_summary": self._workflow_summary(workflow),
        }

        supabase.table("clips").update({
            "metadata": metadata,
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", clip_id).execute()

    def create_task(
        self,
        template_record: Dict[str, Any],
        render_params: Dict[str, Any],
        user_id: str,
    ) -> Dict[str, Any]:
        logger.info(f"[TemplateRender] ========== 开始创建渲染任务 ==========")
        logger.info(f"[TemplateRender] 模板: id={template_record.get('template_id')}, name={template_record.get('name')}, type={template_record.get('type')}")
        logger.info(f"[TemplateRender] 渲染参数: {render_params}")
        
        spec = self.build_render_spec(template_record, render_params)
        workflow = spec["workflow"]
        endpoint = spec["endpoint"]
        prompt = spec["prompt"]
        negative_prompt = spec["negative_prompt"]
        model_name = spec["model_name"]
        duration = spec["duration"]
        cfg_scale = spec["cfg_scale"]
        mode = spec["mode"]
        camera_control = spec["camera_control"]
        aspect_ratio = spec["aspect_ratio"]
        images = spec["images"]
        image_tail = spec.get("image_tail")
        video_url = spec["video_url"]
        transition_inputs = spec.get("transition_inputs") or {}
        decision_chain = spec.get("_decision_chain") or {}

        # ── 带注释的 API payload 日志（每个参数附说明 + 锁定状态）──
        api_payload_for_log = {
            "prompt": prompt[:120] + "..." if prompt and len(prompt) > 120 else prompt,
            "negative_prompt": negative_prompt[:80] + "..." if negative_prompt and len(negative_prompt) > 80 else negative_prompt,
            "model_name": model_name,
            "duration": duration,
            "mode": mode,
            "cfg_scale": cfg_scale,
            "aspect_ratio": aspect_ratio,
            "image_tail": image_tail[:60] + "..." if image_tail and len(image_tail) > 60 else image_tail,
            "camera_control": camera_control,
        }
        annotations = annotate_payload("kling", endpoint, api_payload_for_log)
        logger.info(f"[TemplateRender] ── API Payload ({endpoint}) ──")
        for param_name, note in annotations.items():
            logger.info(f"[TemplateRender]   {param_name:20s} {note}")
        if transition_inputs:
            logger.info(f"[TemplateRender]   transition_inputs  ← {transition_inputs}")
        logger.info(f"[TemplateRender]   _decision_chain    ← {decision_chain}")
        logger.info(f"[TemplateRender]   images             ← {[img[:50] + '...' if img and len(img) > 50 else img for img in images] if images else 'N/A'}")

        input_params = {
            "template_id": template_record.get("template_id"),
            "template_name": template_record.get("name"),
            "template_workflow": workflow,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "model_name": model_name,
            "duration": duration,
            "cfg_scale": cfg_scale,
            "mode": mode,
            "aspect_ratio": aspect_ratio,
            "images": images,
            "image_tail": image_tail,
            "video_url": video_url,
            "transition_inputs": transition_inputs,
            "boundary_ms": render_params.get("boundary_ms") or transition_inputs.get("boundary_ms"),
            "quality_tier": render_params.get("quality_tier") or transition_inputs.get("quality_tier"),
            "_decision_chain": decision_chain,
        }

        project_id = render_params.get("project_id")
        clip_id = render_params.get("clip_id")
        write_clip_metadata = bool(render_params.get("write_clip_metadata", True))

        def _finalize(task_id: str) -> Dict[str, Any]:
            if clip_id and write_clip_metadata:
                try:
                    self._persist_template_to_clip_metadata(
                        clip_id=clip_id,
                        template_record=template_record,
                        task_id=task_id,
                        endpoint=endpoint,
                        workflow=workflow,
                    )
                except Exception as exc:
                    logger.warning(
                        "[TemplateRender] 写入 clip metadata 失败，继续返回任务: clip_id=%s task_id=%s err=%s",
                        clip_id,
                        task_id,
                        exc,
                    )
            return {
                "task_id": task_id,
                "status": "pending",
                "endpoint": endpoint,
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "transition_inputs": transition_inputs,
            }

        if endpoint == "text_to_video":
            task_id = _create_ai_task(user_id, "text_to_video", input_params, project_id, clip_id)
            logger.info(f"[TemplateRender] 派发 text_to_video 任务: task_id={task_id}")
            process_text_to_video.delay(
                task_id=task_id,
                user_id=user_id,
                prompt=prompt,
                options={
                    "negative_prompt": negative_prompt,
                    "model_name": model_name,
                    "duration": duration,
                    "cfg_scale": cfg_scale,
                    "aspect_ratio": aspect_ratio,
                },
            )
            return _finalize(task_id)

        if endpoint == "multi_image_to_video":
            if len(images) < 2:
                raise ValueError("转场复刻需要 A/B 两段输入（至少 2 张图）")
            task_id = _create_ai_task(user_id, "multi_image_to_video", input_params, project_id, clip_id)
            logger.info(f"[TemplateRender] 派发 multi_image_to_video 任务: task_id={task_id}, image_count={len(images)}")
            # multi_image_to_video 模型
            multi_image_model = "kling-v2-6"
            process_multi_image_to_video.delay(
                task_id=task_id,
                user_id=user_id,
                image_list=images,
                prompt=prompt,
                options={
                    "negative_prompt": negative_prompt,
                    "model_name": multi_image_model,
                    "duration": duration,
                },
            )
            return _finalize(task_id)

        if endpoint == "motion_control":
            if not video_url:
                raise ValueError("motion_control 需要 video_url")
            if not images:
                raise ValueError("motion_control 需要 image 输入")
            task_id = _create_ai_task(user_id, "motion_control", input_params, project_id, clip_id)
            logger.info(f"[TemplateRender] 派发 motion_control 任务: task_id={task_id}")
            process_motion_control.delay(
                task_id=task_id,
                user_id=user_id,
                image_url=images[0],
                video_url=video_url,
                character_orientation=render_params.get("character_orientation", "image"),
                mode=mode,
                options={
                    "prompt": prompt,
                    "duration": duration,
                },
            )
            return _finalize(task_id)

        # 默认 image_to_video
        if not images:
            raise ValueError("image_to_video 需要 image 输入")
        task_id = _create_ai_task(user_id, "image_to_video", input_params, project_id, clip_id)
        logger.info(f"[TemplateRender] 派发 image_to_video 任务: task_id={task_id}")
        logger.info(f"[TemplateRender] image_to_video 参数: image={images[0][:80]}..., prompt={prompt[:50] if prompt else 'N/A'}..., model={model_name}")
        i2v_options: Dict[str, Any] = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "model_name": model_name,
            "duration": duration,
            "mode": mode,
            "cfg_scale": cfg_scale,
        }
        if image_tail:
            # ⚠️ API 互斥: image_tail 与 camera_control 不能同时使用
            i2v_options["image_tail"] = image_tail
        elif camera_control:
            i2v_options["camera_control"] = camera_control
        process_image_to_video.delay(
            task_id=task_id,
            user_id=user_id,
            image_url=images[0],
            options=i2v_options,
        )
        return _finalize(task_id)

    @staticmethod
    def _normalize_transition_focus_mode(value: Optional[str]) -> Literal["outfit_change", "subject_preserve", "scene_shift"]:
        """归一化单个 focus_mode 值。"""
        normalized = str(value or "outfit_change").strip().lower()
        if normalized in {"outfit", "outfit_change", "wardrobe", "wardrobe_change"}:
            return "outfit_change"
        if normalized in {"subject", "subject_preserve", "identity"}:
            return "subject_preserve"
        if normalized in {"scene", "scene_shift", "background"}:
            return "scene_shift"
        return "outfit_change"

    @classmethod
    def _normalize_transition_focus_modes(cls, value) -> List[Literal["outfit_change", "subject_preserve", "scene_shift"]]:
        """归一化 focus_modes：支持 list / 单字符串 / None，去重保序，至少一个。"""
        if isinstance(value, list):
            raw_list = value
        elif isinstance(value, str):
            raw_list = [value]
        else:
            raw_list = ["outfit_change"]
        seen = set()
        result = []
        for v in raw_list:
            normalized = cls._normalize_transition_focus_mode(v)
            if normalized not in seen:
                seen.add(normalized)
                result.append(normalized)
        return result or ["outfit_change"]

    @staticmethod
    def _normalize_transition_golden_preset(value: Optional[str]) -> Literal[
        "spin_occlusion_outfit", "whip_pan_outfit", "space_warp_outfit"
    ]:
        normalized = str(value or "spin_occlusion_outfit").strip().lower()
        aliases = {
            "spin": "spin_occlusion_outfit",
            "spin_occlusion": "spin_occlusion_outfit",
            "rotation_occlusion": "spin_occlusion_outfit",
            "whip": "whip_pan_outfit",
            "whip_pan": "whip_pan_outfit",
            "space": "space_warp_outfit",
            "space_warp": "space_warp_outfit",
            "portal": "space_warp_outfit",
        }
        mapped = aliases.get(normalized, normalized)
        if mapped in TRANSITION_GOLDEN_PRESETS:
            return mapped  # type: ignore[return-value]
        return "spin_occlusion_outfit"

    def _build_transition_param_variants(
        self,
        base_prompt: str,
        focus_modes: List[str],
        variant_count: int,
    ) -> List[Dict[str, Any]]:
        """生成参数变体列表。

        每个变体使用相同的 prompt（编舞脚本），但改变真实 Kling API 参数
        （cfg_scale），让用户对比不同参数下的生成效果。

        variant_count=1 → 只取「均衡」(index 1)
        variant_count=2 → 取「精准」+「创意」(index 0, 2)
        variant_count=3 → 取全部三个
        """
        modes = self._normalize_transition_focus_modes(focus_modes)
        prompt = base_prompt.strip()
        count = max(1, min(int(variant_count or 1), len(TRANSITION_PARAM_VARIANTS)))

        if count == 1:
            # 单变体：使用均衡（index 1）
            pick_indices = [1]
        elif count == 2:
            # 双变体：精准 vs 创意（跳过均衡，差异最大化）
            pick_indices = [0, 2]
        else:
            # 全部
            pick_indices = list(range(count))

        variants: List[Dict[str, Any]] = []
        for idx in pick_indices:
            pv = TRANSITION_PARAM_VARIANTS[idx]
            variants.append(
                {
                    "prompt": prompt,
                    "label": pv["label"],
                    "label_en": pv["label_en"],
                    "description": pv["description"],
                    "cfg_scale": pv["cfg_scale"],
                    "focus_modes": modes,
                }
            )
        return variants

    # 向后兼容旧名
    _build_transition_prompt_variants = _build_transition_param_variants

    def create_transition_replica_batch(
        self,
        template_record: Dict[str, Any],
        render_params: Dict[str, Any],
        user_id: str,
        from_image_url: str,
        to_image_url: str,
        focus_modes: Optional[List[str]] = None,
        golden_preset: str = "spin_occlusion_outfit",
        apply_mode: str = "insert_between",
        variant_count: int = 1,
    ) -> Dict[str, Any]:
        """Create transition tasks for A/B two-image replication.

        variant_count=1: 单次生成（默认，省 credits）
        variant_count=2/3: 多变体对比（不同 cfg_scale）
        """
        if not from_image_url or not to_image_url:
            raise ValueError("from_image_url 和 to_image_url 均不能为空")

        effective_params = dict(render_params or {})
        effective_params["images"] = [from_image_url, to_image_url]

        normalized_preset = self._normalize_transition_golden_preset(
            effective_params.get("golden_preset") or golden_preset
        )

        transition_inputs = dict(effective_params.get("transition_inputs") or {})
        transition_inputs.setdefault("from_template_id", "user-input-a")
        transition_inputs.setdefault("to_template_id", "user-input-b")
        transition_inputs.setdefault("from_template_name", "from_image")
        transition_inputs.setdefault("to_template_name", "to_image")
        transition_inputs.setdefault("boundary_ms", effective_params.get("boundary_ms") or 480)
        transition_inputs.setdefault("quality_tier", effective_params.get("quality_tier") or "template_match")
        effective_focus_modes = self._normalize_transition_focus_modes(focus_modes)
        transition_inputs.setdefault("focus_modes", effective_focus_modes)
        transition_inputs.setdefault("golden_preset", normalized_preset)
        effective_params["transition_inputs"] = transition_inputs
        effective_params["golden_preset"] = normalized_preset

        overrides = dict(effective_params.get("overrides") or {})
        overrides["kling_endpoint"] = "image_to_video"
        effective_params["overrides"] = overrides

        apply_mode_normalized = str(apply_mode or "insert_between").strip().lower()
        if apply_mode_normalized not in {"insert_between", "merge_clips"}:
            apply_mode_normalized = "insert_between"

        spec = self.build_render_spec(template_record=template_record, render_params=effective_params)
        images = spec.get("images") or []
        image_tail = spec.get("image_tail")
        if not images or not image_tail:
            raise ValueError("转场复刻需要首尾两张图片（image + image_tail）")

        project_id = effective_params.get("project_id")
        clip_id = effective_params.get("clip_id")
        negative_prompt = spec.get("negative_prompt") or ""
        duration = spec.get("duration") or "5"
        mode = spec.get("mode") or "std"
        aspect_ratio = spec.get("aspect_ratio")
        cfg_scale = spec.get("cfg_scale") or 0.5
        camera_control = spec.get("camera_control")
        model_name = "kling-v2-6"

        variants = self._build_transition_param_variants(
            base_prompt=spec.get("prompt") or "",
            focus_modes=effective_focus_modes,
            variant_count=variant_count,
        )
        replica_group_id = f"replica-{uuid.uuid4().hex[:10]}"

        created_tasks: List[Dict[str, Any]] = []
        for index, variant in enumerate(variants):
            prompt = variant["prompt"]
            # 每个变体使用自己的 cfg_scale（参数级差异，不是 prompt 空话）
            variant_cfg = variant.get("cfg_scale", cfg_scale)
            input_params = {
                "template_id": template_record.get("template_id"),
                "template_name": template_record.get("name"),
                "template_workflow": spec.get("workflow") or {},
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "model_name": model_name,
                "duration": duration,
                "mode": mode,
                "aspect_ratio": aspect_ratio,
                "images": images,
                "transition_inputs": spec.get("transition_inputs") or {},
                "replica": {
                    "group_id": replica_group_id,
                    "focus_modes": variant["focus_modes"],
                    "golden_preset": normalized_preset,
                    "variant_index": index,
                    "variant_label": variant["label"],
                    "variant_label_en": variant.get("label_en", ""),
                    "variant_cfg_scale": variant_cfg,
                    "variant_count": len(variants),
                    "apply_mode": apply_mode_normalized,
                },
            }

            task_id = _create_ai_task(
                user_id=user_id,
                task_type="image_to_video",
                input_params=input_params,
                project_id=project_id,
                clip_id=clip_id,
            )

            option_payload: Dict[str, Any] = {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "model_name": model_name,
                "duration": duration,
                "cfg_scale": variant_cfg,
                "aspect_ratio": aspect_ratio,
                "mode": mode,
                "image_tail": image_tail,
            }
            # ⚠️ API 互斥: image_tail 与 camera_control 不能同时使用
            if camera_control and not image_tail:
                option_payload["camera_control"] = camera_control
            option_payload = {k: v for k, v in option_payload.items() if v is not None}

            process_image_to_video.delay(
                task_id=task_id,
                user_id=user_id,
                image_url=images[0],
                options=option_payload,
            )

            created_tasks.append(
                {
                    "task_id": task_id,
                    "status": "pending",
                    "attempt_index": index,
                    "variant_label": variant["label"],
                    "prompt": prompt,
                }
            )

        return {
            "endpoint": "image_to_video",
            "replica_group_id": replica_group_id,
            "focus_modes": effective_focus_modes,
            "golden_preset": normalized_preset,
            "apply_mode": apply_mode_normalized,
            "task_count": len(created_tasks),
            "tasks": created_tasks,
        }

    @staticmethod
    def _default_endpoint(template_type: str) -> str:
        if template_type == "transition":
            return "multi_image_to_video"
        return "image_to_video"

    @staticmethod
    def _is_meaningful_prompt_seed(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        text = value.strip()
        if len(text) < 6:
            return False
        has_letters = any(('a' <= ch.lower() <= 'z') for ch in text)
        has_cjk = any('一' <= ch <= '鿿' for ch in text)
        if not (has_letters or has_cjk):
            return False
        digit_ratio = sum(ch.isdigit() for ch in text) / max(len(text), 1)
        return digit_ratio < 0.5

    def _resolve_prompt_seed(self, template_record: Dict[str, Any], workflow: Dict[str, Any]) -> str:
        raw_seed = workflow.get("prompt_seed")
        if self._is_meaningful_prompt_seed(raw_seed):
            return str(raw_seed).strip()

        metadata_raw = template_record.get("metadata") or {}
        metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
        for key in ("scene_description", "visual_description", "analysis_description"):
            candidate = metadata.get(key) or workflow.get(key)
            if self._is_meaningful_prompt_seed(candidate):
                return str(candidate).strip()

        tags = template_record.get("tags") or []
        tag_text = ", ".join(str(tag).strip() for tag in tags if str(tag).strip())
        category = str(template_record.get("category") or "").strip()
        template_type = str(template_record.get("type") or "").strip()
        shot_type = str(workflow.get("shot_type") or "").strip()
        camera_move = str(workflow.get("camera_move") or "").strip()
        style = workflow.get("style")

        style_text = ""
        if isinstance(style, dict):
            style_text = ", ".join(str(v).strip() for v in style.values() if str(v).strip())
        elif style:
            style_text = str(style).strip()

        fallback_parts = [
            "cinematic video style",
            category,
            template_type,
            tag_text,
            shot_type,
            camera_move,
            style_text,
        ]
        return ", ".join(part for part in fallback_parts if part)

    @staticmethod
    def _compose_prompt(
        user_prompt: str,
        workflow: Dict[str, Any],
        seed_override: Optional[str] = None,
    ) -> str:
        seed = seed_override if seed_override is not None else workflow.get("prompt_seed", "")

        ignored_values = {"none", "null", "static"}
        extras: List[str] = []
        for key in ("shot_type", "camera_move", "transition", "pacing"):
            value = workflow.get(key)
            if not value:
                continue
            text = str(value).strip()
            if not text or text.lower() in ignored_values:
                continue
            extras.append(text)

        style = workflow.get("style")
        if isinstance(style, dict):
            for val in style.values():
                if not val:
                    continue
                text = str(val).strip()
                if text:
                    extras.append(text)
        elif style:
            text = str(style).strip()
            if text:
                extras.append(text)

        # 去重并保持顺序
        deduped_extras: List[str] = []
        for item in extras:
            if item not in deduped_extras:
                deduped_extras.append(item)

        prompt_parts = [p for p in [user_prompt, seed, ", ".join(deduped_extras) if deduped_extras else ""] if p]
        return ", ".join(prompt_parts)

    @staticmethod
    def _derive_camera_control(workflow: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        move = (workflow.get("camera_move") or "").lower()
        transition = (workflow.get("transition") or "").lower()
        pacing = (workflow.get("pacing") or "medium").lower()
        shot_type = (workflow.get("shot_type") or "medium").lower()

        speed_factor = 1.0
        if pacing == "fast":
            speed_factor = 1.3
        elif pacing == "slow":
            speed_factor = 0.7

        config = {
            "horizontal": 0,
            "vertical": 0,
            "pan": 0,
            "tilt": 0,
            "roll": 0,
            "zoom": 0,
        }

        shot_zoom_hint = {
            "macro": 8,
            "close": 5,
            "medium": 2,
            "wide": 0,
        }
        config["zoom"] = shot_zoom_hint.get(shot_type, 0)

        move_signal = move or transition
        if "push" in move_signal or "zoom_in" in move_signal:
            config["zoom"] += 5
        elif "pull" in move_signal or "zoom_out" in move_signal:
            config["zoom"] -= 5
        elif "pan_left" in move_signal or ("left" in move_signal and "tilt" not in move_signal):
            config["pan"] = -6
        elif "pan_right" in move_signal or ("right" in move_signal and "tilt" not in move_signal):
            config["pan"] = 6
        elif "tilt_up" in move_signal or "up" in move_signal:
            config["tilt"] = 5
        elif "tilt_down" in move_signal or "down" in move_signal:
            config["tilt"] = -5
        elif "orbit" in move_signal:
            config["pan"] = 4
            config["roll"] = 2
        elif "whip_pan" in transition:
            config["pan"] = 8
            config["zoom"] += 2
        elif "flash" in transition:
            config["zoom"] += 1

        for key in ("pan", "tilt", "roll", "zoom"):
            config[key] = int(round(config[key] * speed_factor))

        if not any(config.values()):
            return None

        return {"type": "simple", "config": config}


_template_render_service: Optional[TemplateRenderService] = None


def get_template_render_service() -> TemplateRenderService:
    global _template_render_service
    if _template_render_service is None:
        _template_render_service = TemplateRenderService()
    return _template_render_service
