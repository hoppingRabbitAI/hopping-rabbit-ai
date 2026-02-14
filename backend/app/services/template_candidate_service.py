"""
Template Candidate Service
从模板库中选择候选并生成 RenderSpec
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

from app.services.supabase_client import get_supabase
from app.services.llm.service import LLMService
from app.services.template_render_service import TemplateRenderService

logger = logging.getLogger(__name__)


class TemplateCandidateService:
    def __init__(self) -> None:
        self._render_service = TemplateRenderService()

    async def get_candidates(
        self,
        category: Optional[str],
        template_kind: Optional[str],
        scope: Optional[str],
        prompt: Optional[str],
        limit: int,
        pack_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        templates = self._load_templates(category, template_kind, scope, pack_id)
        if not templates:
            return []

        scored = self._score_templates(templates, prompt or "")
        scored.sort(key=lambda item: item[1], reverse=True)
        top = scored[: max(limit * 3, limit)]

        ranked_templates = await self._rank_with_llm(top, prompt, limit)
        return ranked_templates

    def build_render_specs(
        self,
        templates: List[Dict[str, Any]],
        render_params: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        specs: List[Dict[str, Any]] = []
        for template in templates:
            try:
                spec = self._render_service.build_render_spec(template, render_params)
            except Exception as exc:
                logger.info("[TemplateCandidate] 跳过模板 %s: %s", template.get("template_id"), exc)
                continue
            metadata_raw = template.get("metadata") or {}
            metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
            transition_spec = metadata.get("transition_spec") or {}
            pc = template.get("publish_config") or {}
            if not isinstance(pc, dict):
                pc = {}
            specs.append({
                "template_id": template.get("template_id"),
                "name": template.get("name"),
                "category": template.get("category"),
                "type": template.get("type"),
                "tags": template.get("tags") or [],
                "thumbnail_url": template.get("thumbnail_url"),
                "preview_video_url": template.get("preview_video_url"),
                "quality_label": template.get("quality_label"),
                "transition_spec": transition_spec or None,
                "publish_config": pc or None,
                "pack_id": (metadata.get("transition_pack") or {}).get("pack_id"),
                "render_spec": spec,
            })
        return specs

    def _load_templates(
        self,
        category: Optional[str],
        template_kind: Optional[str],
        scope: Optional[str],
        pack_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        supabase = get_supabase()
        query = supabase.table("template_records").select(
            "template_id,name,category,type,tags,workflow,metadata,url,thumbnail_url,storage_path,bucket,publish_config,preview_video_url,quality_label,created_at"
        )
        # 只查询已发布的模板
        query = query.eq("status", "published")
        if category:
            query = query.eq("category", category)
        if template_kind:
            query = query.eq("type", template_kind)
        result = query.order("created_at", desc=True).execute()
        templates = result.data or []

        if scope or pack_id:
            filtered = []
            for item in templates:
                metadata_raw = item.get("metadata") or {}
                metadata = metadata_raw if isinstance(metadata_raw, dict) else {}
                scopes = metadata.get("scopes") or []
                if scope and scopes and scope not in scopes:
                    continue
                if pack_id:
                    template_pack_id = ((metadata.get("transition_pack") or {}).get("pack_id"))
                    if template_pack_id != pack_id:
                        continue
                filtered.append(item)
            return filtered
        return templates

    def _score_templates(self, templates: List[Dict[str, Any]], prompt: str) -> List[Tuple[Dict[str, Any], float]]:
        prompt_lower = prompt.lower()
        scored: List[Tuple[Dict[str, Any], float]] = []
        for template in templates:
            score = 0.0
            tags = template.get("tags") or []
            for tag in tags:
                if not tag:
                    continue
                tag_lower = str(tag).lower()
                if tag_lower in prompt_lower:
                    score += 2.0
                elif prompt and tag in prompt:
                    score += 2.0
            name = template.get("name") or ""
            if name and name.lower() in prompt_lower:
                score += 1.0
            workflow = template.get("workflow") or {}
            pacing = workflow.get("pacing")
            if pacing and str(pacing).lower() in prompt_lower:
                score += 0.5
            scored.append((template, score))
        return scored

    async def _rank_with_llm(
        self,
        scored: List[Tuple[Dict[str, Any], float]],
        prompt: Optional[str],
        limit: int,
    ) -> List[Dict[str, Any]]:
        if not scored:
            return []

        enable_llm = os.getenv("ENABLE_TEMPLATE_RANKING_LLM", "false").lower() in ("1", "true", "yes")
        if not enable_llm:
            return [item[0] for item in scored[:limit]]

        candidates = scored[: min(len(scored), 10)]
        list_payload = []
        for template, score in candidates:
            list_payload.append({
                "template_id": template.get("template_id"),
                "name": template.get("name"),
                "category": template.get("category"),
                "type": template.get("type"),
                "tags": template.get("tags") or [],
                "score_hint": score,
            })

        system_prompt = (
            "你是模板选择助手，请根据用户需求对候选模板排序。"
            "只输出 JSON：{\"ordered_ids\": [\"id1\", \"id2\"]}"
        )
        user_prompt = (
            f"用户需求: {prompt or '无'}\n"
            f"候选模板: {list_payload}\n"
            "请排序后输出 ordered_ids"
        )

        try:
            llm_service = LLMService()
            result = await llm_service.generate_json(
                user_prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.2,
            )
            ordered_ids = result.get("ordered_ids") if isinstance(result, dict) else None
            if not ordered_ids:
                return [item[0] for item in candidates[:limit]]
            id_to_template = {item[0]["template_id"]: item[0] for item in candidates}
            ordered = [id_to_template[i] for i in ordered_ids if i in id_to_template]
            if len(ordered) < limit:
                for template, _ in candidates:
                    if template not in ordered:
                        ordered.append(template)
                    if len(ordered) >= limit:
                        break
            return ordered[:limit]
        except Exception as exc:
            logger.info("[TemplateCandidate] LLM 排序失败，回退默认: %s", exc)
            return [item[0] for item in candidates[:limit]]


_template_candidate_service: Optional[TemplateCandidateService] = None


def get_template_candidate_service() -> TemplateCandidateService:
    global _template_candidate_service
    if _template_candidate_service is None:
        _template_candidate_service = TemplateCandidateService()
    return _template_candidate_service
