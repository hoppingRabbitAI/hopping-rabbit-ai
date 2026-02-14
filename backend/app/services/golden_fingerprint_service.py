"""
Golden Template Fingerprint Service
====================================
Phase 4a: 基于现有 transition_spec LLM 分析结果，提取模板指纹 → 匹配 Golden Profile → 自动预填 publish_config。

指纹来源：transition_spec 中 LLM 已分析的字段（zero extra cost）
    - transition_category  (occlusion / cinematic / regional / morphing)
    - family               (whip_pan / spin / zoom_blur / flash_cut / glitch / luma_wipe / dolly_zoom / morph / occlusion)
    - motion_pattern       (subject_spin_360 / whip_pan_left / ...)
    - camera_movement      (push / pull / pan_left / orbit / dolly_zoom / handheld / static)
    - duration_ms          (200-2000)

Golden Profile: 手动定义 + 数据驱动重建
    - match_criteria: 各字段的匹配条件
    - recommended_config:  对应的最佳 publish_config
    - 权重打分算法计算匹配度 (0-1)
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.services.supabase_client import supabase

logger = logging.getLogger(__name__)

# ============================================================
# 指纹字段权重（用于匹配打分）
# ============================================================

FINGERPRINT_WEIGHTS = {
    "transition_category": 0.25,  # 大类：遮挡 / 电影感 / 区域 / 变形
    "family":              0.20,  # 转场类型：spin / whip_pan / ...
    "camera_movement":     0.15,  # 运镜方向
    "motion_pattern":      0.15,  # 运动模式（模糊匹配）
    "duration_range":      0.10,  # 时长范围
    "dimension_match":     0.15,  # LLM 多维度评分与 profile 的吻合度
}


# ============================================================
# Golden Profiles（手动定义 Phase 4a，Phase 4b 可数据驱动重建）
# ============================================================

GOLDEN_PROFILES: Dict[str, Dict[str, Any]] = {
    "spin_occlusion_outfit": {
        "name": "旋转遮挡换装",
        "description": "通过人物旋转产生遮挡，在背面完成换装",
        "match_criteria": {
            "transition_category": ["occlusion"],
            "family": ["spin", "occlusion"],
            "camera_movement": ["orbit", "static", "pan_left", "pan_right"],
            "motion_pattern_keywords": ["spin", "rotate", "turn", "360"],
            "duration_range": [300, 800],
            "recommended_for": ["outfit_change"],
        },
        "recommended_config": {
            "default_focus_modes": ["outfit_change"],
            "default_golden_preset": "spin_occlusion_outfit",
            "default_duration": "5",
            "default_mode": "pro",
            "default_cfg_scale": 0.5,
            "default_boundary_ms": 480,
            "default_variant_count": 3,
        },
    },
    "whip_pan_outfit": {
        "name": "快甩变装",
        "description": "利用快速甩镜头 + 运动模糊实现换装",
        "match_criteria": {
            "transition_category": ["cinematic", "occlusion"],
            "family": ["whip_pan", "flash_cut"],
            "camera_movement": ["pan_left", "pan_right", "push", "handheld"],
            "motion_pattern_keywords": ["whip", "pan", "swipe", "flash"],
            "duration_range": [200, 600],
            "recommended_for": ["outfit_change"],
        },
        "recommended_config": {
            "default_focus_modes": ["outfit_change"],
            "default_golden_preset": "whip_pan_outfit",
            "default_duration": "5",
            "default_mode": "pro",
            "default_cfg_scale": 0.45,
            "default_boundary_ms": 400,
            "default_variant_count": 3,
        },
    },
    "space_warp_outfit": {
        "name": "空间扭曲换装",
        "description": "空间扭曲传送门效果 + 换装",
        "match_criteria": {
            "transition_category": ["morphing", "cinematic"],
            "family": ["morph", "dolly_zoom", "zoom_blur"],
            "camera_movement": ["push", "pull", "dolly_zoom"],
            "motion_pattern_keywords": ["warp", "zoom", "morph", "dolly", "portal"],
            "duration_range": [400, 1000],
            "recommended_for": ["outfit_change"],
        },
        "recommended_config": {
            "default_focus_modes": ["outfit_change"],
            "default_golden_preset": "space_warp_outfit",
            "default_duration": "10",
            "default_mode": "pro",
            "default_cfg_scale": 0.5,
            "default_boundary_ms": 600,
            "default_variant_count": 3,
        },
    },
    "scene_shift_cinematic": {
        "name": "电影感场景切换",
        "description": "适合场景变化为主的转场，保持人物连贯",
        "match_criteria": {
            "transition_category": ["cinematic", "regional"],
            "family": ["luma_wipe", "dolly_zoom", "flash_cut"],
            "camera_movement": ["push", "pull", "pan_left", "pan_right", "orbit"],
            "motion_pattern_keywords": ["scene", "wipe", "luma", "cinematic"],
            "duration_range": [400, 1200],
            "recommended_for": ["scene_shift", "subject_preserve"],
        },
        "recommended_config": {
            "default_focus_modes": ["scene_shift", "subject_preserve"],
            "default_golden_preset": "scene_shift_cinematic",
            "default_duration": "10",
            "default_mode": "pro",
            "default_cfg_scale": 0.5,
            "default_boundary_ms": 600,
            "default_variant_count": 3,
        },
    },
}


# ============================================================
# GoldenFingerprintService
# ============================================================

class GoldenFingerprintService:
    """模板指纹提取 + Golden Profile 匹配 + 自动预填 publish_config"""

    def __init__(self) -> None:
        self._profiles = dict(GOLDEN_PROFILES)

    # ─── 指纹提取 ───────────────────────────────────────────

    def extract_fingerprint(self, template_record: Dict[str, Any]) -> Dict[str, Any]:
        """
        从 template_record 的 metadata.transition_spec 中提取指纹。
        不需要额外 LLM 调用——直接复用 Ingest 时已分析的字段。
        """
        metadata = template_record.get("metadata") or {}
        if isinstance(metadata, str):
            import json
            try:
                metadata = json.loads(metadata)
            except Exception:
                metadata = {}

        transition_spec = metadata.get("transition_spec") or {}

        fingerprint: Dict[str, Any] = {
            "version": "v1",
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            "source": "transition_spec",
            # ── 核心维度（直接来自 LLM 分析）──
            "transition_category": transition_spec.get("transition_category", "unknown"),
            "family": transition_spec.get("family", "unknown"),
            "motion_pattern": transition_spec.get("motion_pattern", ""),
            "camera_movement": transition_spec.get("camera_movement", "static"),
            "duration_ms": transition_spec.get("duration_ms", 500),
            # ── 辅助信息 ──
            "transition_description": transition_spec.get("transition_description", ""),
            "scene_a_description": transition_spec.get("scene_a_description", ""),
            "scene_b_description": transition_spec.get("scene_b_description", ""),
            "recommended_prompt": transition_spec.get("recommended_prompt", ""),
            # ── 多维度评分（LLM 视觉分析得出）──
            "dimension_scores": transition_spec.get("dimension_scores", {
                "outfit_change": 0.0,
                "subject_preserve": 0.0,
                "scene_shift": 0.0,
            }),
            "recommended_focus_modes": transition_spec.get("recommended_focus_modes", []),
        }

        return fingerprint

    # ─── Profile 匹配 ──────────────────────────────────────

    def match_profile(
        self, fingerprint: Dict[str, Any]
    ) -> Tuple[Optional[str], float, Optional[Dict[str, Any]]]:
        """
        将指纹与所有 Golden Profile 进行匹配。
        返回: (profile_name, best_score, recommended_config) 或 (None, 0, None)
        """
        best_name: Optional[str] = None
        best_score = 0.0
        best_config: Optional[Dict[str, Any]] = None

        for profile_name, profile in self._profiles.items():
            score = self._compute_match_score(fingerprint, profile.get("match_criteria", {}))
            if score > best_score:
                best_score = score
                best_name = profile_name
                best_config = profile.get("recommended_config")

        return (best_name, round(best_score, 3), best_config)

    def match_all_profiles(
        self, fingerprint: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """返回所有 profile 的匹配详情（降序排列）"""
        results = []
        for profile_name, profile in self._profiles.items():
            score = self._compute_match_score(fingerprint, profile.get("match_criteria", {}))
            results.append({
                "profile_name": profile_name,
                "display_name": profile.get("name", profile_name),
                "description": profile.get("description", ""),
                "score": round(score, 3),
                "match_level": (
                    "high" if score >= 0.8 else
                    "medium" if score >= 0.5 else
                    "low"
                ),
                "recommended_config": profile.get("recommended_config"),
            })
        results.sort(key=lambda x: x["score"], reverse=True)
        return results

    def _compute_match_score(
        self, fingerprint: Dict[str, Any], criteria: Dict[str, Any]
    ) -> float:
        """基于加权多维度打分"""
        score = 0.0

        # 1) transition_category
        fp_category = fingerprint.get("transition_category", "")
        allowed_categories = criteria.get("transition_category", [])
        if allowed_categories and fp_category in allowed_categories:
            score += FINGERPRINT_WEIGHTS["transition_category"]

        # 2) family
        fp_family = fingerprint.get("family", "")
        allowed_families = criteria.get("family", [])
        if allowed_families and fp_family in allowed_families:
            score += FINGERPRINT_WEIGHTS["family"]

        # 3) camera_movement
        fp_camera = fingerprint.get("camera_movement", "")
        allowed_cameras = criteria.get("camera_movement", [])
        if allowed_cameras and fp_camera in allowed_cameras:
            score += FINGERPRINT_WEIGHTS["camera_movement"]

        # 4) motion_pattern (关键词模糊匹配)
        fp_motion = (fingerprint.get("motion_pattern", "") or "").lower()
        keywords = criteria.get("motion_pattern_keywords", [])
        if keywords and fp_motion:
            matched_keywords = sum(1 for kw in keywords if kw.lower() in fp_motion)
            if matched_keywords > 0:
                keyword_ratio = min(matched_keywords / len(keywords), 1.0)
                score += FINGERPRINT_WEIGHTS["motion_pattern"] * keyword_ratio

        # 5) duration_range
        fp_duration = fingerprint.get("duration_ms", 0)
        duration_range = criteria.get("duration_range", [])
        if len(duration_range) == 2 and fp_duration:
            min_dur, max_dur = duration_range
            if min_dur <= fp_duration <= max_dur:
                score += FINGERPRINT_WEIGHTS["duration_range"]
            else:
                # 部分分：距离越近扣分越少
                if fp_duration < min_dur:
                    distance_ratio = max(0, 1 - (min_dur - fp_duration) / 500)
                else:
                    distance_ratio = max(0, 1 - (fp_duration - max_dur) / 500)
                score += FINGERPRINT_WEIGHTS["duration_range"] * distance_ratio * 0.5

        # 6) dimension_match: LLM 多维度评分与 profile.recommended_for 的吻合度
        fp_dim_scores = fingerprint.get("dimension_scores") or {}
        recommended_for = criteria.get("recommended_for", [])
        if recommended_for and fp_dim_scores:
            # 计算 profile 关心的维度的平均得分
            relevant_scores = [fp_dim_scores.get(dim, 0.0) for dim in recommended_for]
            if relevant_scores:
                avg_relevance = sum(relevant_scores) / len(relevant_scores)
                score += FINGERPRINT_WEIGHTS["dimension_match"] * avg_relevance

        return score

    # ─── 自动预填 ──────────────────────────────────────────

    def auto_fill_publish_config(
        self,
        template_id: str,
        fingerprint: Dict[str, Any],
        threshold: float = 0.5,
    ) -> Dict[str, Any]:
        """
        根据指纹匹配结果自动预填 publish_config。
        仅在匹配度 >= threshold 时才预填，不覆盖已有配置。
        返回: { matched, profile_name, score, match_level, config_applied }
        """
        profile_name, score, recommended_config = self.match_profile(fingerprint)

        result: Dict[str, Any] = {
            "matched": False,
            "profile_name": profile_name,
            "score": score,
            "match_level": (
                "high" if score >= 0.8 else
                "medium" if score >= 0.5 else
                "low"
            ),
            "config_applied": False,
        }

        if score < threshold or not recommended_config:
            return result

        result["matched"] = True

        # 读取现有 publish_config
        try:
            record_result = (
                supabase.table("template_records")
                .select("publish_config")
                .eq("template_id", template_id)
                .single()
                .execute()
            )
            existing_config = (record_result.data or {}).get("publish_config") or {}
        except Exception:
            existing_config = {}

        if not isinstance(existing_config, dict):
            existing_config = {}

        # Phase 5c: 优先使用 LLM 多维度分析得出的 focus_modes（而非 profile 硬编码）
        llm_focus_modes = fingerprint.get("recommended_focus_modes") or []
        if llm_focus_modes:
            recommended_config = {**recommended_config, "default_focus_modes": llm_focus_modes}

        # 合并：不覆盖已有值，同时记录来源
        new_config = {**existing_config}
        auto_filled_keys: list[str] = []
        for key, value in recommended_config.items():
            if key not in new_config or new_config[key] is None:
                new_config[key] = value
                auto_filled_keys.append(key)

        # Phase 5a: 记录参数溯源
        from datetime import datetime as _dt
        provenance = new_config.get("_provenance") or {}
        if not isinstance(provenance, dict):
            provenance = {}
        provenance["auto_filled_at"] = _dt.utcnow().isoformat()
        provenance["source_profile"] = profile_name
        provenance["match_score"] = round(score, 4)
        provenance["auto_filled_keys"] = auto_filled_keys
        # Phase 5c: 记录 LLM 多维度评分来源
        if llm_focus_modes:
            provenance["focus_modes_source"] = "llm_dimension_analysis"
        else:
            provenance["focus_modes_source"] = "profile_default"
        provenance["dimension_scores"] = fingerprint.get("dimension_scores", {})
        # 记录哪些字段被管理员手动覆盖过
        admin_overrides = [
            k for k in recommended_config
            if k in existing_config and existing_config[k] is not None and k not in auto_filled_keys
        ]
        provenance["admin_overrides"] = admin_overrides
        new_config["_provenance"] = provenance

        # 写入 DB
        try:
            update_data: Dict[str, Any] = {"publish_config": new_config}

            # 高匹配度时自动预标注质量标签
            if score >= 0.8:
                update_data["quality_label"] = "good"  # 预标注，管理员可修改

            supabase.table("template_records").update(update_data).eq(
                "template_id", template_id
            ).execute()
            result["config_applied"] = True
        except Exception as exc:
            logger.warning("[GoldenFingerprint] 写入 publish_config 失败: %s", exc)

        return result

    # ─── 指纹存储 ──────────────────────────────────────────

    def save_fingerprint(
        self, template_id: str, fingerprint: Dict[str, Any],
        match_result: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """将 golden_fingerprint + golden_match 存入 template_records.metadata"""
        try:
            record_result = (
                supabase.table("template_records")
                .select("metadata")
                .eq("template_id", template_id)
                .single()
                .execute()
            )
            metadata = (record_result.data or {}).get("metadata") or {}
            if not isinstance(metadata, dict):
                metadata = {}

            metadata["golden_fingerprint"] = fingerprint

            # Phase 5a: 持久化匹配结果，溯源可查
            if match_result:
                metadata["golden_match"] = match_result

            supabase.table("template_records").update(
                {"metadata": metadata}
            ).eq("template_id", template_id).execute()
            return True
        except Exception as exc:
            logger.error("[GoldenFingerprint] 保存指纹失败 %s: %s", template_id, exc)
            return False

    # ─── 一站式：提取 + 匹配 + 预填 ─────────────────────────

    def process_template(
        self, template_record: Dict[str, Any], auto_fill: bool = True
    ) -> Dict[str, Any]:
        """
        完整流程：提取指纹 → 保存 → 匹配 profile → 自动预填。
        Ingest 完成后自动调用此方法。
        """
        template_id = template_record.get("template_id", "")

        # 1. 提取指纹
        fingerprint = self.extract_fingerprint(template_record)

        # 2. 匹配 profile（先匹配，再保存，这样可以一次性写入 fingerprint + match）
        profile_name, score, recommended_config = self.match_profile(fingerprint)

        # Phase 5a: 构建匹配溯源记录
        from datetime import datetime as _dt
        match_level = (
            "high" if score >= 0.8 else
            "medium" if score >= 0.5 else
            "low"
        )
        golden_match: Dict[str, Any] = {
            "profile_name": profile_name,
            "score": round(score, 4),
            "match_level": match_level,
            "matched_at": _dt.utcnow().isoformat(),
        }

        # 3. 保存指纹 + 匹配结果到 metadata
        saved = self.save_fingerprint(template_id, fingerprint, match_result=golden_match)

        # 4. 自动预填 publish_config
        fill_result: Dict[str, Any] = {"config_applied": False}
        if auto_fill and score >= 0.5:
            fill_result = self.auto_fill_publish_config(template_id, fingerprint)

        logger.info(
            "[GoldenFingerprint] template=%s → profile=%s score=%.3f level=%s config_applied=%s",
            template_id,
            profile_name or "none",
            score,
            "high" if score >= 0.8 else "medium" if score >= 0.5 else "low",
            fill_result.get("config_applied", False),
        )

        return {
            "template_id": template_id,
            "fingerprint": fingerprint,
            "fingerprint_saved": saved,
            "best_match": {
                "profile_name": profile_name,
                "score": score,
                "match_level": (
                    "high" if score >= 0.8 else
                    "medium" if score >= 0.5 else
                    "low"
                ),
                "recommended_config": recommended_config,
            },
            "auto_fill": fill_result,
        }

    # ─── Phase 4b：从历史数据重建 Profile ──────────────────

    def rebuild_profiles(self) -> Dict[str, Any]:
        """
        从已标注 golden/good 的已发布模板中重建 Golden Profile。
        统计各指纹维度的分布 + 高评分渲染的参数众数。
        """
        try:
            result = (
                supabase.table("template_records")
                .select("template_id,metadata,quality_label,publish_config")
                .in_("quality_label", ["golden", "good"])
                .eq("status", "published")
                .execute()
            )
        except Exception as exc:
            return {"success": False, "error": str(exc), "sample_count": 0}

        records = result.data or []
        if len(records) < 5:
            return {
                "success": False,
                "error": f"标注数据不足（需要至少 5 个 golden/good 模板，当前 {len(records)} 个）",
                "sample_count": len(records),
            }

        # 按 family 分组统计
        family_groups: Dict[str, List[Dict]] = {}
        for record in records:
            metadata = record.get("metadata") or {}
            if not isinstance(metadata, dict):
                continue
            fp = metadata.get("golden_fingerprint") or {}
            ts = metadata.get("transition_spec") or {}
            family = fp.get("family") or ts.get("family") or "unknown"
            if family == "unknown":
                continue
            family_groups.setdefault(family, []).append({
                "fingerprint": fp or self.extract_fingerprint(record),
                "publish_config": record.get("publish_config") or {},
                "quality_label": record.get("quality_label"),
            })

        rebuilt_profiles: Dict[str, Dict] = {}
        for family, group in family_groups.items():
            if len(group) < 2:
                continue

            # 统计 transition_category 众数
            categories = [g["fingerprint"].get("transition_category") for g in group if g["fingerprint"].get("transition_category")]
            category_set = list(set(categories)) if categories else []

            # 统计 camera_movement 众数
            cameras = [g["fingerprint"].get("camera_movement") for g in group if g["fingerprint"].get("camera_movement")]
            camera_set = list(set(cameras)) if cameras else []

            # motion_pattern 关键词提取
            motion_words: List[str] = []
            for g in group:
                mp = (g["fingerprint"].get("motion_pattern") or "").lower()
                for word in mp.replace("_", " ").split():
                    if len(word) > 2 and word not in motion_words:
                        motion_words.append(word)

            # duration 范围
            durations = [g["fingerprint"].get("duration_ms", 500) for g in group]
            min_dur = max(200, min(durations) - 100)
            max_dur = min(2000, max(durations) + 100)

            # publish_config 众数
            config_sample = {}
            for g in group:
                pc = g["publish_config"]
                if pc and isinstance(pc, dict):
                    for key, val in pc.items():
                        if key.startswith("default_") and val is not None:
                            config_sample.setdefault(key, []).append(val)

            recommended_config: Dict[str, Any] = {}
            for key, values in config_sample.items():
                if isinstance(values[0], (int, float)):
                    # 取中位数
                    sorted_vals = sorted(values)
                    recommended_config[key] = sorted_vals[len(sorted_vals) // 2]
                elif isinstance(values[0], list):
                    # 取并集
                    merged = []
                    for v in values:
                        for item in v:
                            if item not in merged:
                                merged.append(item)
                    recommended_config[key] = merged
                else:
                    # 取众数
                    from collections import Counter
                    recommended_config[key] = Counter(values).most_common(1)[0][0]

            profile_key = f"{family}_rebuilt"
            rebuilt_profiles[profile_key] = {
                "name": f"{family} (数据驱动)",
                "description": f"从 {len(group)} 个标注模板自动重建",
                "match_criteria": {
                    "transition_category": category_set,
                    "family": [family],
                    "camera_movement": camera_set[:6],
                    "motion_pattern_keywords": motion_words[:8],
                    "duration_range": [min_dur, max_dur],
                },
                "recommended_config": recommended_config,
                "sample_count": len(group),
                "source": "data_driven",
            }

        # 合并：数据驱动 profile 补充手动 profile（不覆盖）
        merged = dict(self._profiles)
        for key, profile in rebuilt_profiles.items():
            if key not in merged:
                merged[key] = profile

        self._profiles = merged

        return {
            "success": True,
            "sample_count": len(records),
            "family_groups": {k: len(v) for k, v in family_groups.items()},
            "rebuilt_count": len(rebuilt_profiles),
            "total_profiles": len(self._profiles),
            "profile_names": list(self._profiles.keys()),
        }

    # ─── 查看 profiles ─────────────────────────────────────

    def get_profiles(self) -> List[Dict[str, Any]]:
        """返回所有 Golden Profile（含手动 + 数据驱动）"""
        profiles = []
        for name, profile in self._profiles.items():
            profiles.append({
                "name": name,
                "display_name": profile.get("name", name),
                "description": profile.get("description", ""),
                "match_criteria": profile.get("match_criteria", {}),
                "recommended_config": profile.get("recommended_config", {}),
                "sample_count": profile.get("sample_count"),
                "source": profile.get("source", "manual"),
            })
        return profiles


# ============================================================
# Singleton
# ============================================================

_service_instance: Optional[GoldenFingerprintService] = None


def get_golden_fingerprint_service() -> GoldenFingerprintService:
    global _service_instance
    if _service_instance is None:
        _service_instance = GoldenFingerprintService()
    return _service_instance
