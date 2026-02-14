"""
Template Ingest Service
负责将爆款视频/图片拆解为模板并写入数据库
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union

import httpx
from PIL import Image

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

TEMPLATE_BUCKET = "templates"
TEMPLATE_PREFIX = "visual-backgrounds/"
DEFAULT_THUMB_MAX = 512


@dataclass
class TemplateAsset:
    template_id: str
    name: str
    category: str
    type: str
    storage_path: str
    thumbnail_path: Optional[str]
    url: str
    thumbnail_url: str


class TemplateIngestService:
    def __init__(self) -> None:
        self._tasks: Dict[str, asyncio.Task] = {}

    def enqueue(self, job_id: str) -> None:
        """异步处理模板采集任务"""
        if job_id in self._tasks and not self._tasks[job_id].done():
            return
        self._tasks[job_id] = asyncio.create_task(self._process_job(job_id))

    async def _process_job(self, job_id: str) -> None:
        supabase = get_supabase()
        now = datetime.utcnow().isoformat()
        supabase.table("template_ingest_jobs").update({
            "status": "processing",
            "progress": 0.05,
            "started_at": now,
            "updated_at": now,
        }).eq("id", job_id).execute()

        try:
            job = supabase.table("template_ingest_jobs").select("*").eq("id", job_id).single().execute().data
            if not job:
                raise RuntimeError("Ingest job not found")

            source_type = job.get("source_type", "video")
            ingest_output: Union[List[TemplateAsset], Tuple[List[TemplateAsset], Dict[str, Any]]]

            if source_type == "image":
                ingest_output = await self._ingest_image(job)
            elif source_type == "zip":
                ingest_output = await self._ingest_zip(job)
            else:
                ingest_output = await self._ingest_video(job)

            pack_summary: Optional[Dict[str, Any]] = None
            if isinstance(ingest_output, tuple):
                templates, pack_summary = ingest_output
            else:
                templates = ingest_output

            result_payload: Dict[str, Any] = {
                "templates": [
                    {
                        "template_id": t.template_id,
                        "name": t.name,
                        "category": t.category,
                        "type": t.type,
                        "storage_path": t.storage_path,
                        "thumbnail_path": t.thumbnail_path,
                        "url": t.url,
                        "thumbnail_url": t.thumbnail_url,
                    }
                    for t in templates
                ]
            }
            if pack_summary:
                result_payload.update(pack_summary)

            supabase.table("template_ingest_jobs").update({
                "status": "succeeded",
                "progress": 1,
                "result": result_payload,
                "completed_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", job_id).execute()
        except Exception as exc:
            logger.error("[TemplateIngest] 处理失败: %s", exc, exc_info=True)
            supabase.table("template_ingest_jobs").update({
                "status": "failed",
                "progress": 1,
                "error_code": "INGEST_FAILED",
                "error_message": str(exc),
                "completed_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", job_id).execute()

    async def _ingest_image(self, job: Dict[str, Any]) -> List[TemplateAsset]:
        image_bytes = await self._download_bytes(job["source_url"])
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return [await self._create_template_from_image(image, job, index=0)]

    async def _ingest_zip(self, job: Dict[str, Any]) -> List[TemplateAsset]:
        import zipfile

        data = await self._download_bytes(job["source_url"])
        templates: List[TemplateAsset] = []

        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            image_files = [f for f in archive.namelist() if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
            for idx, file_name in enumerate(image_files):
                with archive.open(file_name) as file_obj:
                    image = Image.open(file_obj).convert("RGB")
                templates.append(await self._create_template_from_image(image, job, index=idx))

        if not templates:
            raise RuntimeError("Zip 中未找到图片文件")
        return templates

    async def _ingest_video(
        self,
        job: Dict[str, Any],
    ) -> Union[List[TemplateAsset], Tuple[List[TemplateAsset], Dict[str, Any]]]:
        """统一走自动分镜检测管线，不再区分 ad/transition"""
        job_id = job.get("id", "unknown")
        source_url = job.get("source_url", "")
        logger.info(f"[TemplateIngest] === 开始视频入库（自动分镜） === job_id={job_id}, url={source_url[:100]}...")
        return await self._ingest_transition_video(job)

    async def _ingest_transition_video(self, job: Dict[str, Any]) -> Tuple[List[TemplateAsset], Dict[str, Any]]:
        job_id = job.get("id", "unknown")
        # 转场模式：不用 extract_frames 硬编码数量，由 scene detection 自动决定
        # extract_frames 仅作为安全上限（防止生成过多模板）
        max_cap = max(1, min(int(job.get("extract_frames") or 32), 64))
        transition_duration_ms = self._parse_transition_duration_ms(job)
        clip_ranges = job.get("clip_ranges") or []
        video_url = str(job.get("source_url") or "")
        if not video_url:
            raise RuntimeError("缺少 source_url")
        
        logger.info(f"[TemplateIngest] === 开始转场视频入库(智能检测) === job_id={job_id}, max_cap={max_cap}, duration_ms={transition_duration_ms}")
        logger.info(f"[TemplateIngest] 转场视频URL: {video_url}")

        pack_id = f"pack-{uuid.uuid4().hex[:10]}"
        # 用一个大上限让 scene detection 充分检测所有转场
        detected_ranges, detection_debug = await self._detect_transition_ranges(
            video_url=video_url,
            max_ranges=max_cap,
            clip_ranges=clip_ranges,
            transition_duration_ms=transition_duration_ms,
        )
        detected_segments = len(detected_ranges)
        logger.info(f"[TemplateIngest] 检测到 {detected_segments} 个转场范围: {detected_ranges[:5]}...")

        deduped_ranges = self._dedupe_transition_ranges(detected_ranges)
        deduped_templates = max(detected_segments - len(deduped_ranges), 0)
        # 不再硬截断到 extract_frames，而是取去重后的全部有效转场（最多 max_cap 个）
        selected_ranges = deduped_ranges[:max_cap] if len(deduped_ranges) > max_cap else deduped_ranges
        auto_detected_count = len(selected_ranges)
        logger.info(f"[TemplateIngest] 智能检测: 去重后 {len(deduped_ranges)} 个转场，选取 {auto_detected_count} 个")
        detection_debug["deduped_range_count"] = len(deduped_ranges)
        detection_debug["auto_detected_count"] = auto_detected_count
        detection_debug["published_ranges"] = [
            {"start": round(start, 3), "end": round(end, 3)} for start, end in selected_ranges
        ]

        # 动态计算每个转场的 A/B 帧偏移量：
        #   A帧: 转场区域前的清晰静态帧（偏移量根据到前一个转场的间距动态计算）
        #   Mid帧: 转场中心（仅用于 LLM 分析，不用于展示）
        #   B帧: 转场区域后的清晰静态帧
        total_dur = detection_debug.get("duration_sec", 999)
        all_timestamps: List[float] = []
        for i, (start, end) in enumerate(selected_ranges):
            # 计算到前后邻居转场的间距
            gap_before = start if i == 0 else start - selected_ranges[i - 1][1]
            gap_after = (total_dur - end) if i == len(selected_ranges) - 1 else selected_ranges[i + 1][0] - end
            # A/B 偏移: 取间距的40%，限制在 [0.2s, 1.5s]
            offset_a = max(0.2, min(1.5, gap_before * 0.4))
            offset_b = max(0.2, min(1.5, gap_after * 0.4))
            ts_a = max(0.0, start - offset_a)
            ts_mid = (start + end) / 2.0
            ts_b = min(total_dur, end + offset_b)
            all_timestamps.extend([ts_a, ts_mid, ts_b])
        logger.info(f"[TemplateIngest] 提取帧时间戳 (A/Mid/B x{len(selected_ranges)}): {[round(t,3) for t in all_timestamps]}")
        all_frames = await self._extract_frames_at_timestamps(video_url=video_url, timestamps=all_timestamps)
        logger.info(f"[TemplateIngest] 成功提取 {len(all_frames)} 帧")

        # ---------- 准备每个转场的帧数据 ----------
        transition_items: List[Dict[str, Any]] = []
        for idx, (start, end) in enumerate(selected_ranges):
            base = idx * 3
            frame_a = all_frames[base] if base < len(all_frames) else None
            frame_mid = all_frames[base + 1] if base + 1 < len(all_frames) else None
            frame_b = all_frames[base + 2] if base + 2 < len(all_frames) else None

            # 展示帧用清晰的 A 帧（转场前），不用模糊的 Mid 帧
            display_frame = frame_a or frame_b or frame_mid
            if display_frame is None:
                logger.warning(f"[TemplateIngest] 转场 {idx} 无法提取帧，跳过")
                continue
            transition_items.append({
                "idx": idx, "start": start, "end": end,
                "frame_a": frame_a, "frame_mid": frame_mid, "frame_b": frame_b,
                "display_frame": display_frame,
            })

        # ---------- 并发视频理解分析（不降级） ----------
        import asyncio
        logger.info(f"[TemplateIngest] 启动 {len(transition_items)} 个转场的并发视频理解分析...")
        analysis_tasks = [
            self._analyze_transition_frames(
                frame_a=item["frame_a"],
                frame_mid=item["frame_mid"],
                frame_b=item["frame_b"],
                index=item["idx"],
                video_url=video_url,
                start_sec=item["start"],
                end_sec=item["end"],
            )
            for item in transition_items
        ]
        analysis_results = await asyncio.gather(*analysis_tasks, return_exceptions=True)

        # ---------- 检查分析错误（不再静默降级） ----------
        for item, analysis in zip(transition_items, analysis_results):
            if isinstance(analysis, Exception):
                idx = item["idx"]
                raise RuntimeError(
                    f"转场 {idx} 视频分析失败: {analysis}"
                ) from analysis

        # ---------- 组装模板 ----------
        templates: List[TemplateAsset] = []
        for item, analysis in zip(transition_items, analysis_results):
            idx = item["idx"]
            logger.info(f"[TemplateIngest] 转场 {idx} 分析结果: {analysis}")
            transition_spec = self._build_transition_spec(
                start_sec=item["start"],
                end_sec=item["end"],
                index=idx,
                job=job,
                analysis=analysis,
            )
            metadata_extra = {
                "transition_spec": transition_spec,
                "transition_pack": {
                    "pack_id": pack_id,
                    "source_video_url": video_url,
                    "detected_segments": detected_segments,
                    "cluster_method": "range_overlap_v1",
                },
            }
            source_timecode = f"{item['start']:.3f}-{item['end']:.3f}"
            templates.append(
                await self._create_template_from_image(
                    item["display_frame"],
                    job,
                    index=idx,
                    source_timecode=source_timecode,
                    metadata_extra=metadata_extra,
                )
            )

        if not templates:
            raise RuntimeError("转场视频未提取到有效模板")

        published_templates = len(templates)
        summary = {
            "pack_id": pack_id,
            "detected_segments": detected_segments,
            "auto_detected_count": auto_detected_count,
            "published_templates": published_templates,
            "deduped_templates": deduped_templates,
            "detection_debug": detection_debug,
        }
        return templates, summary

    @staticmethod
    def _parse_transition_duration_ms(job: Dict[str, Any]) -> int:
        params = job.get("params") or {}
        metadata = params.get("metadata") if isinstance(params, dict) else {}
        duration_raw = None
        if isinstance(metadata, dict):
            duration_raw = metadata.get("transition_duration_ms")
        try:
            duration_ms = int(duration_raw) if duration_raw is not None else 1200
        except (TypeError, ValueError):
            duration_ms = 1200
        return max(200, min(duration_ms, 2000))

    async def _detect_transition_ranges(
        self,
        video_url: str,
        max_ranges: int,
        clip_ranges: List[Dict[str, Any]],
        transition_duration_ms: int,
    ) -> Tuple[List[Tuple[float, float]], Dict[str, Any]]:
        tmp_path = await self._ensure_local_video(video_url)
        total_duration_sec = await self._probe_video_duration(tmp_path)
        logger.info(f"[TemplateIngest] 视频总时长: {total_duration_sec}s")

        detection_debug: Dict[str, Any] = {
            "duration_sec": round(total_duration_sec, 3),
            "transition_duration_ms": transition_duration_ms,
        }

        normalized_clip_ranges = self._normalize_clip_ranges(clip_ranges, total_duration_sec)
        if normalized_clip_ranges:
            selected_ranges = self._select_evenly_spaced_ranges(normalized_clip_ranges, max_ranges)
            logger.info(f"[TemplateIngest] 使用用户指定的 clip_ranges: {selected_ranges}")
            detection_debug.update({
                "ranges_source": "clip_ranges",
                "scene_event_count": 0,
                "selected_peak_count": 0,
                "selected_ranges": [
                    {"start": round(start, 3), "end": round(end, 3)} for start, end in selected_ranges
                ],
            })
            return selected_ranges, detection_debug

        # 极低阈值收集所有场景变化，让后续聚类来分离噪声
        detect_cmd = [
            "ffmpeg",
            "-hide_banner",
            "-i",
            tmp_path,
            "-filter_complex",
            "select=gt(scene\,0.02),metadata=print",
            "-an",
            "-f",
            "null",
            "-",
        ]
        process = await asyncio.create_subprocess_exec(
            *detect_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            logger.warning("[TemplateIngest] 场景检测命令执行失败，返回码=%s", process.returncode)

        scene_output = (stdout or b"").decode(errors="ignore") + "\n" + (stderr or b"").decode(errors="ignore")
        scene_events = self._extract_scene_events(scene_output, total_duration_sec)
        detection_debug["scene_event_count"] = len(scene_events)
        detection_debug["top_scene_events"] = [
            {"ts": round(ts, 3), "score": round(score, 4)}
            for ts, score in sorted(scene_events, key=lambda item: item[1], reverse=True)[:20]
        ]

        # ========== 动态转场区域检测（替代固定窗口） ==========
        min_zone_width = max(0.1, float(transition_duration_ms) / 4000.0)  # 最小区域宽度
        zones = self._cluster_into_transition_zones(
            scene_events=scene_events,
            total_duration_sec=total_duration_sec,
            min_zone_width_sec=min_zone_width,
        )
        logger.info("[TemplateIngest] 动态检测到 %s 个转场区域: %s", len(zones), zones[:8])

        # 仅过滤极弱的噪声区域（peak_score < 0.03），不再用中位数过滤
        # 治本：让所有真实转场都有机会保留，由 max_cap 控制上限
        if zones:
            before_count = len(zones)
            zones = [z for z in zones if z["peak_score"] >= 0.03]
            logger.info("[TemplateIngest] 噪声过滤: %s -> %s 个区域", before_count, len(zones))

        # 将区域转为 ranges
        ranges: List[Tuple[float, float]] = [(z["start"], z["end"]) for z in zones]

        detection_debug.update({
            "ranges_source": "dynamic_zones" if ranges else "uniform_fallback",
            "zone_count": len(zones),
            "zones": zones[:16],
        })

        if not ranges:
            logger.info("[TemplateIngest] 场景检测无有效区域，使用均匀分布")
            ranges = self._build_uniform_transition_ranges(total_duration_sec, max_ranges, transition_duration_ms)
            detection_debug["ranges_source"] = "uniform_fallback"

        # 如果区域太多，按 peak_score 留前 max_ranges 个
        if len(ranges) > max_ranges:
            scored = sorted(zip(zones, ranges), key=lambda x: x[0]["peak_score"], reverse=True)
            ranges = sorted([r for _, r in scored[:max_ranges]], key=lambda x: x[0])

        detection_debug["selected_ranges"] = [
            {"start": round(start, 3), "end": round(end, 3)} for start, end in ranges
        ]
        logger.info(f"[TemplateIngest] 最终转场范围: {ranges}")

        return ranges, detection_debug

    @staticmethod
    def _cluster_into_transition_zones(
        scene_events: List[Tuple[float, float]],
        total_duration_sec: float,
        gap_threshold_sec: float = 0.45,
        min_zone_width_sec: float = 0.12,
    ) -> List[Dict[str, Any]]:
        """
        将连续的 scene events 按时间间隔聚类为转场区域。
        每个区域有自然的起止时间，而不是固定宽度窗口。

        原理：一个转场会在短时间内产生一串连续的高 scene score 事件，
        事件之间的时间间隔很小（<gap_threshold_sec），
        而两个不同转场之间的间隔则较大。

        返回:
            [{"start": 0.3, "end": 0.7, "peak_ts": 0.5, "peak_score": 0.22, "event_count": 5}, ...]
        """
        if not scene_events:
            return []

        sorted_events = sorted(scene_events, key=lambda x: x[0])

        zones: List[Dict[str, Any]] = []
        cluster: List[Tuple[float, float]] = [sorted_events[0]]

        for event in sorted_events[1:]:
            if event[0] - cluster[-1][0] <= gap_threshold_sec:
                cluster.append(event)
            else:
                zones.append(TemplateIngestService._finalize_transition_zone(
                    cluster, total_duration_sec, min_zone_width_sec,
                ))
                cluster = [event]

        if cluster:
            zones.append(TemplateIngestService._finalize_transition_zone(
                cluster, total_duration_sec, min_zone_width_sec,
            ))

        return zones

    @staticmethod
    def _finalize_transition_zone(
        cluster: List[Tuple[float, float]],
        total_duration_sec: float,
        min_zone_width_sec: float,
    ) -> Dict[str, Any]:
        """ 将一类事件聚合为一个转场区域，确保最小宽度 """
        peak = max(cluster, key=lambda x: x[1])
        start = cluster[0][0]
        end = cluster[-1][0]
        if end - start < min_zone_width_sec:
            center = (start + end) / 2.0
            start = max(0.0, center - min_zone_width_sec / 2.0)
            end = min(total_duration_sec, center + min_zone_width_sec / 2.0)
        return {
            "start": round(start, 3),
            "end": round(end, 3),
            "peak_ts": round(peak[0], 3),
            "peak_score": round(peak[1], 4),
            "event_count": len(cluster),
        }

    @staticmethod
    def _extract_scene_events(
        scene_output: str,
        total_duration_sec: float,
    ) -> List[Tuple[float, float]]:
        events: List[Tuple[float, float]] = []
        pending_ts: Optional[float] = None

        for line in scene_output.splitlines():
            ts_match = re.search(r"pts_time:([0-9]+(?:\.[0-9]+)?)", line)
            if ts_match:
                try:
                    pending_ts = float(ts_match.group(1))
                except (TypeError, ValueError):
                    pending_ts = None
                continue

            score_match = re.search(r"lavfi\.scene_score=([0-9]+(?:\.[0-9]+)?)", line)
            if score_match and pending_ts is not None:
                try:
                    score = float(score_match.group(1))
                except (TypeError, ValueError):
                    pending_ts = None
                    continue
                if 0 < pending_ts <= total_duration_sec:
                    events.append((round(pending_ts, 3), score))
                pending_ts = None

        if not events:
            for match in re.finditer(r"pts_time:([0-9]+(?:\.[0-9]+)?)", scene_output):
                try:
                    ts = float(match.group(1))
                except (TypeError, ValueError):
                    continue
                if 0 < ts <= total_duration_sec:
                    events.append((round(ts, 3), 0.0))

        if not events:
            return []

        score_by_ts: Dict[float, float] = {}
        for ts, score in events:
            score_by_ts[ts] = max(score_by_ts.get(ts, 0.0), score)
        return sorted(score_by_ts.items(), key=lambda item: item[0])

    @staticmethod
    def _select_scene_peaks(
        scene_events: List[Tuple[float, float]],
        total_duration_sec: float,
        max_ranges: int,
    ) -> Tuple[List[Tuple[float, float]], float, float]:
        if not scene_events:
            return [], 0.0, 0.4

        min_peak_spacing_sec = max(0.35, min(0.75, total_duration_sec / 12.0))
        score_levels = [0.22, 0.16, 0.12, 0.08, 0.05, 0.0]
        target_min_peaks = 2 if total_duration_sec >= 3.0 else 1
        peak_cap = max(1, min(max_ranges * 2 if max_ranges > 0 else 32, 64))

        fallback_peaks: List[Tuple[float, float]] = []
        fallback_level = 0.0

        for level in score_levels:
            candidates = [item for item in scene_events if item[1] >= level]
            if not candidates:
                continue

            peaks = TemplateIngestService._collapse_scene_events(candidates, min_peak_spacing_sec)
            if len(peaks) > peak_cap:
                peaks = sorted(peaks, key=lambda item: item[1], reverse=True)[:peak_cap]
                peaks = sorted(peaks, key=lambda item: item[0])

            if len(peaks) > len(fallback_peaks):
                fallback_peaks = peaks
                fallback_level = level

            if len(peaks) >= target_min_peaks:
                return peaks, level, min_peak_spacing_sec

        return fallback_peaks, fallback_level, min_peak_spacing_sec

    @staticmethod
    def _collapse_scene_events(
        scene_events: List[Tuple[float, float]],
        min_spacing_sec: float,
    ) -> List[Tuple[float, float]]:
        if not scene_events:
            return []

        sorted_events = sorted(scene_events, key=lambda item: item[0])
        peaks: List[Tuple[float, float]] = []
        cluster: List[Tuple[float, float]] = [sorted_events[0]]

        for event in sorted_events[1:]:
            prev_ts = cluster[-1][0]
            if event[0] - prev_ts <= min_spacing_sec:
                cluster.append(event)
                continue

            peaks.append(max(cluster, key=lambda item: item[1]))
            cluster = [event]

        if cluster:
            peaks.append(max(cluster, key=lambda item: item[1]))

        return sorted(peaks, key=lambda item: item[0])

    @staticmethod
    def _build_ranges_from_peaks(
        peaks: List[Tuple[float, float]],
        total_duration_sec: float,
        transition_duration_ms: int,
    ) -> List[Tuple[float, float]]:
        ranges: List[Tuple[float, float]] = []
        for ts, _score in peaks:
            transition_range = TemplateIngestService._build_transition_range(
                center_ts=ts,
                total_duration_sec=total_duration_sec,
                transition_duration_ms=transition_duration_ms,
            )
            if transition_range is not None:
                ranges.append(transition_range)
        return ranges

    @staticmethod
    def _build_transition_range(
        center_ts: float,
        total_duration_sec: float,
        transition_duration_ms: int,
    ) -> Optional[Tuple[float, float]]:
        half_window = max(0.1, min(float(transition_duration_ms) / 2000.0, 1.0))
        start = max(0.0, center_ts - half_window)
        end = min(total_duration_sec, center_ts + half_window)
        if end - start < 0.2:
            return None
        return (start, end)

    @staticmethod
    def _build_uniform_transition_ranges(
        duration_sec: float,
        max_ranges: int,
        transition_duration_ms: int,
    ) -> List[Tuple[float, float]]:
        if duration_sec <= 0:
            return []
        count = max(1, min(max_ranges, 8))
        half_window = max(0.1, min(float(transition_duration_ms) / 2000.0, 1.0))
        ranges: List[Tuple[float, float]] = []
        step = duration_sec / (count + 1)
        for i in range(count):
            center = step * (i + 1)
            start = max(0.0, center - half_window)
            end = min(duration_sec, center + half_window)
            if end - start >= 0.2:
                ranges.append((start, end))
        return ranges

    @staticmethod
    def _dedupe_transition_ranges(ranges: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        if not ranges:
            return []
        sorted_ranges = sorted(ranges, key=lambda item: item[0])
        kept: List[Tuple[float, float]] = []
        for current_start, current_end in sorted_ranges:
            if current_end <= current_start:
                continue
            if not kept:
                kept.append((current_start, current_end))
                continue

            prev_start, prev_end = kept[-1]
            overlap = min(prev_end, current_end) - max(prev_start, current_start)
            if overlap <= 0:
                kept.append((current_start, current_end))
                continue

            prev_span = prev_end - prev_start
            curr_span = current_end - current_start
            ratio = overlap / max(min(prev_span, curr_span), 1e-6)
            center_gap = abs(((prev_start + prev_end) / 2) - ((current_start + current_end) / 2))

            # 明显重复的转场窗口直接跳过
            if ratio >= 0.5 or center_gap <= 0.08:
                continue
            kept.append((current_start, current_end))

        return kept

    @staticmethod
    def _select_evenly_spaced_ranges(
        ranges: List[Tuple[float, float]],
        limit: int,
    ) -> List[Tuple[float, float]]:
        if limit <= 0 or not ranges:
            return []
        if len(ranges) <= limit:
            return sorted(ranges, key=lambda item: item[0])

        ordered = sorted(ranges, key=lambda item: item[0])
        selected: List[Tuple[float, float]] = []
        total = len(ordered)
        for i in range(limit):
            idx = int(round((total - 1) * (i / max(limit - 1, 1))))
            selected.append(ordered[idx])
        return selected

    def _build_transition_spec(
        self,
        start_sec: float,
        end_sec: float,
        index: int,
        job: Dict[str, Any],
        analysis: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        duration_ms = int(round(max(200.0, min((end_sec - start_sec) * 1000.0, 2000.0))))

        # ── 从 LLM 分析结果中提取分类 ──
        analysis = analysis or {}
        family = str(analysis.get("transition_type") or "whip_pan").strip().lower()
        valid_families = {"whip_pan", "zoom_blur", "flash_cut", "glitch", "spin",
                         "luma_wipe", "dolly_zoom", "morph", "occlusion"}
        if family not in valid_families:
            family = "whip_pan"

        # 允许 tag 覆盖（向后兼容）
        tags = [str(tag).lower() for tag in (job.get("tags_hint") or [])]
        if any("闪" in tag or "flash" in tag for tag in tags):
            family = "flash_cut"
        elif any("glitch" in tag or "故障" in tag for tag in tags):
            family = "glitch"
        elif any("缩放" in tag or "zoom" in tag for tag in tags):
            family = "zoom_blur"

        return {
            "version": "v2",
            "family": family,
            "duration_ms": duration_ms,
            "fps": 30,
            # ── LLM 分析结果（核心新增） ──
            "transition_category": analysis.get("transition_category") or "unknown",
            "transition_description": analysis.get("transition_description") or "",
            "motion_pattern": analysis.get("motion_pattern") or "",
            "camera_movement": analysis.get("camera_movement") or "",
            "scene_a_description": analysis.get("scene_a_description") or "",
            "scene_b_description": analysis.get("scene_b_description") or "",
            "recommended_prompt": analysis.get("recommended_prompt") or "",
            "motion_prompt": analysis.get("motion_prompt") or "",
            # ── 多层运动分析（视频理解增强） ──
            "camera_compound": analysis.get("camera_compound") or "",
            "background_motion": analysis.get("background_motion") or "",
            "subject_motion": analysis.get("subject_motion") or "",
            "transition_duration_sec": analysis.get("transition_duration_sec") or 0.0,
            "_analysis_method": analysis.get("_analysis_method") or "unknown",
            # ── 多维度评分 ──
            "dimension_scores": analysis.get("dimension_scores") or {
                "outfit_change": 0.0, "subject_preserve": 0.0, "scene_shift": 0.0,
            },
            "recommended_focus_modes": analysis.get("recommended_focus_modes") or [],
            # ── 5维技术解剖（v3: 解剖驱动分类） ──
            "technical_dissection": analysis.get("technical_dissection") or {},
            # ── 模型自报的转场精确时间窗口 ──
            "transition_window": analysis.get("transition_window") or {},
            "quality_tier": "template_match",
        }

    async def _analyze_transition_frames(
        self,
        frame_a: Optional[Image.Image],
        frame_mid: Optional[Image.Image],
        frame_b: Optional[Image.Image],
        index: int,
        video_url: Optional[str] = None,
        start_sec: Optional[float] = None,
        end_sec: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        用 LLM 视觉分析转场类型（仅视频理解，无帧分析降级）。
        流程：提取转场视频片段 → 上传 Ark → Responses API 视频理解
        任何步骤失败直接抛异常，暴露错误以便修复。
        """
        default_result: Dict[str, Any] = {
            "transition_category": "unknown",
            "transition_type": "whip_pan",
            "transition_description": "",
            "motion_pattern": "",
            "camera_movement": "static",
            "scene_a_description": "",
            "scene_b_description": "",
            "recommended_prompt": "",
            "motion_prompt": "",
            # ── 多维度评分：每个转场同时涉及的维度 (0.0-1.0) ──
            "dimension_scores": {
                "outfit_change": 0.0,
                "subject_preserve": 0.0,
                "scene_shift": 0.0,
            },
            "recommended_focus_modes": [],
            # ── 多层运动分析（视频理解增强） ──
            "background_motion": "",
            "subject_motion": "",
            "camera_compound": "",
            "transition_duration_sec": 0.0,
        }

        # 计算转场时长（用于 prompt 和 fps 决策）
        transition_duration = 0.0
        if start_sec is not None and end_sec is not None:
            transition_duration = round(end_sec - start_sec, 3)
            default_result["transition_duration_sec"] = transition_duration

        frames_for_analysis = [f for f in [frame_a, frame_mid, frame_b] if f is not None]
        if not frames_for_analysis:
            return default_result

        from app.utils.image_utils import pil_image_to_base64

        # ── 准备 A/B 边界帧的 base64 ──
        boundary_images_b64 = []
        if frame_a is not None:
            boundary_images_b64.append(pil_image_to_base64(frame_a, format="JPEG"))
        if frame_b is not None:
            boundary_images_b64.append(pil_image_to_base64(frame_b, format="JPEG"))

        # ════════════════════════════════════════════════════════════
        #  视频片段理解（不降级到帧分析，暴露错误以便修复）
        # ════════════════════════════════════════════════════════════
        if not video_url or start_sec is None or end_sec is None:
            raise RuntimeError(
                f"转场 {index}: 视频模板分析必须提供 video_url/start_sec/end_sec，"
                "不再支持帧分析降级"
            )

        # ── 慷慨 padding：不猜阈值，给模型足够上下文让它自己判断 ──
        # 固定 2s padding：确保任何类型的转场（瞬切/甩镜/希区柯克变焦/螺旋）
        # 的建立→高潮→消散过程都被完整捕获。模型会在输出中自行报告精确边界。
        CLIP_PADDING = 2.0
        logger.info(
            "[TemplateIngest] 转场 %d: 视频理解 (zone=%.2fs-%.2fs, duration=%.2fs, padding=%.1fs)",
            index, start_sec, end_sec, transition_duration, CLIP_PADDING,
        )
        clip_path = await self._extract_transition_clip(
            video_url=video_url,
            start_sec=start_sec,
            end_sec=end_sec,
            padding=CLIP_PADDING,
        )
        try:
            file_id = await self._upload_clip_to_ark(clip_path)

            # ════════════════════════════════════════════════════════
            #  两阶段分析：把「看」和「判断」拆开
            #  Stage 1: 视频 → 纯观察笔记（只描述看到了什么，不分类）
            #  Stage 2: 观察笔记 → 分类 + motion_prompt（纯文本推理）
            # ════════════════════════════════════════════════════════

            # ── Stage 1: 纯视觉观察 ──
            stage1_system = self._build_stage1_observation_prompt()
            boundary_desc = ""
            if frame_a is not None and frame_b is not None:
                boundary_desc = "同时提供了转场前（A帧）和转场后（B帧）的清晰静态截图作为参考。"
            elif frame_a is not None:
                boundary_desc = "同时提供了转场前（A帧）的清晰静态截图作为参考。"
            elif frame_b is not None:
                boundary_desc = "同时提供了转场后（B帧）的清晰静态截图作为参考。"

            stage1_user = (
                "这是一段包含转场特效的视频片段，前后各有约2秒静态上下文。"
                f"{boundary_desc}\n"
                "请按5个维度（Subject Anchoring / Trigger Mechanism / "
                "Spatial Perspective / Asset Replacement / Motion Dynamics）"
                "逐一观察，记录你看到的物理现象。\n"
                "⚠️ 只描述你看到了什么，不要给出任何分类名称。"
            )

            logger.info(
                "[TemplateIngest] 转场 %d: 🔬 阶段一（纯观察）开始",
                index,
            )
            stage1_result = await self._call_llm_with_video(
                file_id=file_id,
                system_prompt=stage1_system,
                user_prompt=stage1_user,
                boundary_images_b64=boundary_images_b64 if boundary_images_b64 else None,
            )

            # 提取观察文本 — 兼容 dict 和 str
            import json as _json
            if isinstance(stage1_result, dict):
                observation = stage1_result.get("observation", {})
                observation_text = _json.dumps(stage1_result, ensure_ascii=False, indent=2)
            else:
                observation = {}
                observation_text = str(stage1_result)

            logger.info(
                "[TemplateIngest] 转场 %d: 🔬 阶段一完成 | 观察摘要: %s",
                index, observation_text[:300],
            )

            # ── 阶段间冷却：避免连续请求触发 Ark 429 限流 ──
            await asyncio.sleep(3)

            # ── Stage 2: 纯文本推理（不再发送视频） ──
            stage2_system = self._build_stage2_reasoning_prompt()

            # 把 stage1 的场景描述也传给 stage2
            scene_a = stage1_result.get("scene_a_description", "") if isinstance(stage1_result, dict) else ""
            scene_b = stage1_result.get("scene_b_description", "") if isinstance(stage1_result, dict) else ""
            tw_stage1 = stage1_result.get("transition_window", {}) if isinstance(stage1_result, dict) else {}

            stage2_user = (
                "以下是另一位分析师观看视频后写下的纯客观观察记录。\n"
                "请 100%% 基于这些观察来推导分类和编舞蓝图。\n\n"
                f"## 观察记录\n{observation_text}\n\n"
                f"## 场景信息\n"
                f"- 转场前 (Scene A): {scene_a}\n"
                f"- 转场后 (Scene B): {scene_b}\n\n"
                f"## 转场窗口\n"
                f"- effect_start_sec: {tw_stage1.get('effect_start_sec', '未知')}\n"
                f"- effect_end_sec: {tw_stage1.get('effect_end_sec', '未知')}\n"
                f"- effect_duration_sec: {tw_stage1.get('effect_duration_sec', '未知')}\n\n"
                "请输出完整 JSON。"
            )

            logger.info(
                "[TemplateIngest] 转场 %d: 🧠 阶段二（文本推理）开始",
                index,
            )
            video_result = await self._call_llm_text_only(
                system_prompt=stage2_system,
                user_prompt=stage2_user,
            )

            logger.info(
                "[TemplateIngest] 转场 %d: 🧠 阶段二完成 | type=%s",
                index,
                video_result.get("transition_type", "?") if isinstance(video_result, dict) else "?",
            )

            # 合并 Stage 1 的信息到最终结果
            if isinstance(video_result, dict):
                # scene descriptions 优先用 Stage 1 的（直接看视频的更准）
                if scene_a and not video_result.get("scene_a_description"):
                    video_result["scene_a_description"] = scene_a
                if scene_b and not video_result.get("scene_b_description"):
                    video_result["scene_b_description"] = scene_b
                # transition_window 优先用 Stage 1 的（直接看视频的更准）
                if tw_stage1 and not video_result.get("transition_window"):
                    video_result["transition_window"] = tw_stage1
                # 保存原始观察记录用于调试
                video_result["_stage1_observation"] = observation

            # 异步清理上传的文件
            asyncio.create_task(self._cleanup_ark_file(file_id))
        finally:
            # 无论成功失败都清理本地临时片段
            try:
                os.remove(clip_path)
            except Exception:
                pass

        if not isinstance(video_result, dict):
            raise RuntimeError(
                f"转场 {index}: 视频理解 LLM 返回非 dict 结果: {type(video_result)}"
            )

        video_result["_analysis_method"] = "video_clip"
        video_result["transition_duration_sec"] = transition_duration

        # ── 后处理：清洗 motion_prompt 中的内容泄漏 ──
        video_result = self._sanitize_analysis_content_leak(video_result)

        for key in default_result:
            if key not in video_result or not video_result[key]:
                video_result[key] = default_result[key]

        # 记录模型自报的转场窗口（核心 debug 信息）
        tw = video_result.get("transition_window") or {}
        logger.info(
            "[TemplateIngest] 转场 %d: ✅ 视频理解成功 | type=%s | camera=%s | "
            "model_window=[%.2fs-%.2fs](%.2fs, conf=%.2f)",
            index,
            video_result.get("transition_type", "?"),
            video_result.get("camera_movement", "?"),
            float(tw.get("effect_start_sec", 0)),
            float(tw.get("effect_end_sec", 0)),
            float(tw.get("effect_duration_sec", 0)),
            float(tw.get("confidence", 0)),
        )
        return video_result

    # ── 后处理：清洗内容泄漏 ──

    @staticmethod
    def _sanitize_analysis_content_leak(result: Dict[str, Any]) -> Dict[str, Any]:
        """清洗 LLM 分析结果中的内容泄漏。

        motion_prompt / background_motion / subject_motion 是纯机械蓝图，
        不应包含具体场景/服装/人物描述词汇。
        用泛化替换词替代，保留力学描述。
        """
        import re

        # 需要清洗的字段（纯力学，不应有内容词汇）
        fields_to_sanitize = ["motion_prompt", "background_motion", "subject_motion"]

        # 替换规则：(pattern, replacement)
        # 顺序很重要：先替换多词短语，再替换单词
        replacements = [
            # 场景类型 → the background / the scene
            # 先匹配长短语，后匹配单词
            (r'\bopen\s+outdoor\s+space\b', 'the new background'),
            (r'\bstatic\s+indoor\s+scene\b', 'static initial background'),
            (r'\bindoor\s+scene\b', 'initial background'),
            (r'\boutdoor\s+scene\b', 'new background'),
            (r'\bindoor\s+(?:space|room|environment|setting)\b', 'initial background'),
            (r'\boutdoor\s+(?:space|area|environment|setting)\b', 'new background'),
            (r'\bfrom\s+indoor\s+to\s+outdoor\b', 'from initial scene to new scene'),
            (r'\bfrom\s+outdoor\s+to\s+indoor\b', 'from initial scene to new scene'),
            (r'\bindoor\b', 'initial'),
            (r'\boutdoor\b', 'new'),
            (r'\b(?:living\s+)?room\b', 'background'),
            (r'\bpark\b', 'background'),
            (r'\bstreet\b', 'background'),
            (r'\boffice\b', 'background'),
            (r'\bbedroom\b', 'background'),
            (r'\bkitchen\b', 'background'),
            # 人物描述 → the subject
            (r'\b(?:girl|woman|man|boy|lady|guy|person)\b', 'the subject'),
            # 服装具体描述 → outfit
            (r'\b(?:black|white|red|blue|green|pink|yellow)\s+(?:coat|dress|shirt|jacket|top|pants|skirt)\b', 'outfit'),
            (r'\b(?:coat|dress|shirt|jacket|sweater|hoodie|blouse)\b(?!\s+(?:transformation|swap|change|replacement))', 'outfit'),
        ]

        for field in fields_to_sanitize:
            val = result.get(field)
            if not val or not isinstance(val, str):
                continue
            original = val
            for pattern, repl in replacements:
                val = re.sub(pattern, repl, val, flags=re.IGNORECASE)
            if val != original:
                result[field] = val
                logger.info(
                    "[TemplateIngest] 🧹 内容泄漏清洗 [%s]: '%s' → '%s'",
                    field, original[:80], val[:80],
                )

        return result

    # ── 系统 Prompt 构建：两阶段（观察 + 推理） ──

    @staticmethod
    def _build_stage1_observation_prompt() -> str:
        """阶段一：纯视觉观察 prompt。

        设计原则：
        - 只做「看到了什么」的客观描述，**绝对不做分类/命名/判断**
        - 5 个技术维度逐帧观察，输出结构化的观察笔记
        - 模型被迫先写下具体观察（如"主体大小不变、背景纵深拉伸"），
          这些观察一旦写下就成为"已承诺事实"，后续推理阶段无法推翻
        """
        return (
            "你是一个精密的视频分析仪器。你的唯一任务是**逐帧观察并记录事实**。\n\n"

            "## 绝对禁止\n"
            "❌ 不要给出任何分类名称（如 whip_pan、dolly_zoom、spin 等）\n"
            "❌ 不要做任何判断或推理\n"
            "❌ 不要写 motion_prompt\n"
            "❌ 不要写 recommended_prompt\n"
            "你只是一台摄像机回放分析仪，只输出你**看到的物理现象**。\n\n"

            "## 视频上下文\n"
            "视频片段在转场前后各留了约 2 秒静态画面。\n"
            "请判断转场特效的精确起止秒数。\n\n"

            "## 观察维度（逐一填写，每个维度 2-4 句英文）\n\n"

            "### 1. Subject Anchoring（主体锚定）\n"
            "观察并记录：\n"
            "- 转场前主体（人物头部/五官）在画面中的位置坐标（如：中心偏左、占画面 40%%）\n"
            "- 转场后主体的位置坐标和占画面比例\n"
            "- 主体位置/比例是否发生了变化？变化了多少？\n"
            "- 主体是否始终保持清晰？还是有一段模糊期？\n\n"

            "### 2. Trigger Mechanism（触发机制）\n"
            "观察并记录：\n"
            "- 转场开始时画面发生了什么物理变化？（如：画面开始模糊、有物体从左侧划入、闪白）\n"
            "- 是否有任何物体/手/头发等遮挡了画面？遮挡了百分之几？\n"
            "- 场景 A 到场景 B 的切换是在哪个时刻完成的？\n"
            "- 切换是瞬间完成还是有过渡期？过渡期多长？\n\n"

            "### 3. Spatial Perspective（空间透视）\n"
            "这是最关键的维度，请特别仔细观察：\n"
            "- 转场前背景的纵深感如何？（如：背景较近/背景有纵深走廊感/背景模糊）\n"
            "- 转场后背景的纵深感如何？\n"
            "- 背景在转场过程中是否出现了**拉伸或压缩**效果？\n"
            "  （即背景物体之间的距离感是否在变化？）\n"
            "- 主体大小不变但背景纵深剧变？还是全画面一起缩放？还是全画面一起平移？\n"
            "- 背景灭点（消失点）是否发生了位移？向哪个方向？\n\n"

            "### 4. Asset Replacement（资产替换）\n"
            "观察并记录：\n"
            "- 转场前后光线有什么变化？（色温、亮度、方向）\n"
            "- 转场前后服装/材质是否不同？\n"
            "- 替换发生在哪一帧？是硬切还是融合？\n"
            "- 转场前后环境/背景是否不同？\n\n"

            "### 5. Motion Dynamics（运动力学）\n"
            "观察并记录：\n"
            "- 画面中运动模糊的方向：水平向左/右？从中心向外辐射？旋转？无统一方向？\n"
            "- 前景（主体）和背景的运动是否一致？\n"
            "  · 如果一致：全画面一起向某方向运动\n"
            "  · 如果不一致：具体描述各自怎么动（如 '主体不动，背景向后拉伸'）\n"
            "- 运动速度曲线：匀速？先慢后快？先快后慢？突然加速？\n"
            "- 模糊峰值出现在转场的大约百分之几处？\n\n"

            "## 输出 JSON（严格，不加任何解释文字）\n"
            "{\n"
            '  "observation": {\n'
            '    "subject_anchoring": "2-4 sentences in English, pure observation, NO classification terms",\n'
            '    "trigger_mechanism": "2-4 sentences in English, pure observation",\n'
            '    "spatial_perspective": "3-5 sentences in English, VERY detailed, this is the most important dimension",\n'
            '    "asset_replacement": "2-4 sentences in English, pure observation",\n'
            '    "motion_dynamics": "3-5 sentences in English, describe blur direction/distribution, foreground vs background motion difference"\n'
            '  },\n'
            '  "scene_a_description": "转场前画面的具体内容（中文，客观描述你看到的）",\n'
            '  "scene_b_description": "转场后画面的具体内容（中文，客观描述你看到的）",\n'
            '  "transition_window": {\n'
            '    "effect_start_sec": 0.0,\n'
            '    "effect_end_sec": 0.0,\n'
            '    "effect_duration_sec": 0.0,\n'
            '    "confidence": 0.0\n'
            '  }\n'
            "}\n"
        )

    @staticmethod
    def _build_stage2_reasoning_prompt() -> str:
        """阶段二：基于观察文本的纯推理 prompt。

        输入：阶段一的结构化观察笔记（纯文本，无视频）
        输出：分类 + motion_prompt + 完整 JSON
        """
        return (
            "你是视频转场特效的分类和编舞专家。\n\n"

            "## 你的任务\n"
            "根据提供的**视觉观察记录**，完成两件事：\n"
            "1. 推导出转场特效的类型分类\n"
            "2. 输出可复用的编舞蓝图（motion_prompt）\n\n"

            "⚠️ 你没有看过视频。你收到的是另一个分析师写下的纯客观观察笔记。\n"
            "你必须 100%% 基于这些观察来推理，不要添加任何观察中没有的细节。\n\n"

            "## 分类推理规则\n"
            "请按以下逻辑，从观察记录中推导 transition_type：\n\n"
            "| 观察特征组合 | → 分类 |\n"
            "|---|---|\n"
            "| 主体位置/比例不变 + 背景纵深剧烈拉伸或压缩 + 前景背景运动不一致 | → **dolly_zoom** |\n"
            "| 全画面均匀向同一方向运动模糊 + 主体也跟着一起模糊移动 | → **whip_pan** |\n"
            "| 从中心向外辐射状模糊 + 主体也在缩放 | → **zoom_blur** |\n"
            "| 有物体/手/头发遮挡画面超过 50%% 的瞬间 | → **occlusion** |\n"
            "| 旋转方向的运动模糊 | → **spin** |\n"
            "| 瞬间白闪或黑闪 | → **flash_cut** |\n"
            "| 像素级渐变融合，无明显运动 | → **morph** |\n"
            "| 不完全符合以上 → 选最接近的，在 description 中说明 |\n\n"

            "⚠️ **关键区分：dolly_zoom vs whip_pan**\n"
            "- dolly_zoom 的标志：前景（主体）不动或变化很小，背景产生纵深拉伸/压缩\n"
            "- whip_pan 的标志：整个画面（包括主体）都在同一方向上均匀快速移动\n"
            "- 如果观察记录说「主体保持稳定/位置不变」+「背景纵深变化」→ 这是 dolly_zoom，\n"
            "  即使有运动模糊也不是 whip_pan\n\n"

            "## motion_prompt 输出标准\n"
            "**motion_prompt 是最核心的输出。** 它决定了用户最终看到的视频效果。\n"
            "这份蓝图会被直接发送给 Kling 视频生成模型，驱动任意用户照片的转场渲染。\n\n"
            "好坏标准：\n"
            "1. **精准还原** — 看完蓝图，不看原视频也能脑补出完全一致的运动轨迹\n"
            "2. **分层清晰** — foreground / background / camera 三层各自怎么动\n"
            "3. **量化具体** — 角度、模糊峰值百分比、缩放比例、速度曲线\n"
            "4. **零内容泄漏** — 没有任何服装/场景/人物描述\n\n"

            "## 内容与特效分离（铁律）\n"
            "motion_prompt / background_motion / subject_motion / technical_dissection 中：\n"
            "- 主体 → 一律写 the subject\n"
            "- 场景 → 一律写 the scene / the background\n"
            "- 服装变化 → wardrobe/outfit transformation\n"
            "- 场景切换 → background replacement / scene swap\n"
            "- ❌ 禁止词：indoor, outdoor, room, park, street, black coat, red dress, girl, woman\n"
            "- scene_a/b_description 不受此限制\n\n"

            "## 换装机制（反幻觉规则）\n"
            "- 只在观察记录中**明确提到主体有旋转运动**时才写旋转角度\n"
            "- 不要为了「解释」换装而虚构旋转\n"
            "- 多数换装是通过运动模糊/闪切瞬间完成资产替换\n\n"

            "## 输出 JSON（严格，不加任何解释文字）\n"
            "{\n"
            '  "technical_dissection": {\n'
            '    "subject_anchoring": "从观察记录提炼的结论（英文）",\n'
            '    "trigger_mechanism": "从观察记录提炼的结论（英文）",\n'
            '    "spatial_perspective_shift": "从观察记录提炼的结论（英文）",\n'
            '    "asset_replacement": "从观察记录提炼的结论（英文）",\n'
            '    "motion_dynamics": "从观察记录提炼的结论（英文）"\n'
            '  },\n'
            '  "transition_category": "occlusion | cinematic | regional | morphing",\n'
            '  "transition_type": "dolly_zoom | whip_pan | spin | flash_cut | zoom_blur | occlusion | morph | ...",\n'
            '  "transition_description": "一句话中文，描述特效机制（不描述内容）",\n'
            '  "motion_pattern": "运动模式标签，如 dolly_zoom_with_outfit_swap, subject_spin_360",\n'
            '  "camera_movement": "主镜头运动，如 dolly_zoom, push, pull, pan_left, orbit, static",\n'
            '  "camera_compound": "复合运动（单一运动填同 camera_movement）",\n'
            '  "background_motion": "背景层运动（英文，纯力学）",\n'
            '  "subject_motion": "主体层运动（英文，纯力学）",\n'
            '  "motion_prompt": "英文编舞蓝图：Phase 1/2/3 + 百分比时间线 + foreground/background/camera 分层 + 量化参数",\n'
            '  "recommended_prompt": "含具体内容的完整 prompt（仅存档，不用于渲染）",\n'
            '  "dimension_scores": {"outfit_change": 0-1, "subject_preserve": 0-1, "scene_shift": 0-1},\n'
            '  "recommended_focus_modes": ["得分≥0.5的维度"]\n'
            "}\n"
        )

    @staticmethod
    def _build_frame_analysis_prompt(transition_duration: float = 0.0) -> str:
        """构建帧分析版系统 prompt（A/Mid/B 静态帧降级路径）。

        与视频版共享同一设计原则：motion_prompt 是纯机械蓝图，
        完全剥离具体内容（服装/场景/人物）。
        """
        duration_context = ""
        if transition_duration > 0:
            duration_context = (
                f"\n⏱️ 这段转场持续约 {transition_duration:.2f} 秒，请据此推断运动速度和节奏。\n"
            )

        return (
            "你是**视频转场特效工程师**。给你一组来自同一个视频转场的关键帧，"
            "请逆向工程出转场特效的**可复用机械蓝图**。\n\n"

            "══════════════════════════════════════\n"
            "🚨 第一铁律：内容与特效完全分离\n"
            "══════════════════════════════════════\n"
            "帧里穿什么衣服、在什么场景、是男是女 —— 全部与你无关。\n"
            "你只提取「特效怎么动」的机械蓝图，不描述「画面里有什么」。\n"
            "你的蓝图会被复用于 100 个完全不同的人——必须通用。\n"
            f"{duration_context}\n"

            "📐 严格输出 JSON，不要解释。字段：\n"
            "{\n"
            '  "transition_category": "occlusion|cinematic|regional|morphing",\n'
            '  "transition_type": "spin|whip_pan|dolly_zoom|flash_cut|zoom_blur|glitch|morph|luma_wipe|occlusion",\n'
            '  "transition_description": "一句话中文描述特效机制（不含具体内容）",\n'
            '  "motion_pattern": "subject_spin_360|whip_pan_left|zoom_push|static_morph|...",\n'
            '  "camera_movement": "push|pull|pan_left|pan_right|orbit|dolly_zoom|handheld|static",\n'
            '  "camera_compound": "复合镜头运动（英文，多层同时运动时描述）",\n'
            '  "background_motion": "背景层独立运动（英文，纯力学，禁止描述场景内容），无则填 static",\n'
            '  "subject_motion": "主体层独立运动（英文，纯力学，禁止描述人物特征），无则填 static",\n'
            '  "scene_a_description": "转场前画面的具体内容（此字段允许具体内容，仅存档用）",\n'
            '  "scene_b_description": "转场后画面的具体内容（此字段允许具体内容，仅存档用）",\n'
            '  "motion_prompt": "⭐⭐⭐ 特效编舞蓝图 — 英文按时间线。\\n'
            '要求：Phase 1/2/3 + 百分比时间线；分层 foreground/background/camera layer；'
            '量化旋转角度/模糊程度；the subject 代替人物；the scene 代替场景。\\n'
            '🚫 绝对禁止：服装描述/配饰/场景名称/人物特征/具体表情动作",\n'
            '  "recommended_prompt": "含具体内容的完整 prompt（仅存档，不用于渲染）",\n'
            '  "dimension_scores": {"outfit_change": 0.0-1.0, "subject_preserve": 0.0-1.0, "scene_shift": 0.0-1.0},\n'
            '  "recommended_focus_modes": ["得分>=0.5的维度"]\n'
            "}\n\n"
            "transition_category 分类：\n"
            "- occlusion: 遮挡切换（转身/手遮/物体划过）\n"
            "- cinematic: 镜头运动转场（变焦/快甩/螺旋）\n"
            "- regional: 局部区域变化\n"
            "- morphing: 溶解/形变过渡\n\n"

            "🚫 motion_prompt 禁止词汇（出现即失败）：\n"
            "- 任何颜色+衣物：❌ black coat, red dress → ✅ outfit/wardrobe\n"
            "- 任何配饰：❌ hat, beret, glasses → 直接省略\n"
            "- 任何场所：❌ indoor, outdoor lounge → ✅ the scene/the background\n"
            "- 任何人物特征：❌ girl, woman, man → ✅ the subject\n"
            "- 任何表情动作：❌ wink, smile → 直接省略（内容不是特效）\n\n"

            "🔍 输出前自检：逐词扫描 motion_prompt，"
            "发现任何颜色+衣物/场所名/人物特征 → 修正后再输出。\n"
        )

    async def _call_llm_with_multi_images(
        self,
        llm_service: Any,
        images_b64: List[str],
        user_prompt: str,
        system_prompt: str,
    ) -> Dict[str, Any]:
        """调用多模态 LLM，发送多张图片 + 文字 prompt，返回 JSON。"""
        import json as _json

        api_key = None
        model = None
        try:
            from app.config import get_settings
            _settings = get_settings()
            api_key = _settings.volcengine_ark_api_key
            model = _settings.doubao_seed_1_8_endpoint
        except Exception:
            pass

        if not api_key or not model:
            raise RuntimeError("多模态 LLM 未配置")

        base_url = "https://ark.cn-beijing.volces.com/api/v3"

        content: List[Dict[str, Any]] = []
        for idx, img_b64 in enumerate(images_b64):
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"},
            })
        content.append({"type": "text", "text": user_prompt})

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ]

        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 1500,
        }

        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        raw = data["choices"][0]["message"]["content"]
        logger.info(f"[TemplateIngest] 多帧分析 LLM 返回: {raw[:200]}...")

        # 解析 JSON
        try:
            return _json.loads(raw)
        except _json.JSONDecodeError:
            pass
        import re as _re
        match = _re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw)
        if match:
            try:
                return _json.loads(match.group(1))
            except _json.JSONDecodeError:
                pass
        match = _re.search(r'\{[\s\S]*\}', raw)
        if match:
            return _json.loads(match.group(0))
        raise ValueError(f"无法解析转场分析 JSON: {raw[:100]}")

    async def _call_llm_text_only(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> Dict[str, Any]:
        """纯文本 LLM 调用（阶段二推理专用，无视频/图片）。

        通过 Ark Chat Completions API，只传文本消息。
        用于两阶段分析的第二阶段：从已有观察文本推导分类和 motion_prompt。
        """
        import json as _json

        try:
            from app.config import get_settings
            _settings = get_settings()
            api_key = _settings.volcengine_ark_api_key
            model = _settings.doubao_seed_1_8_endpoint
        except Exception:
            raise RuntimeError("Ark API 未配置")

        if not api_key or not model:
            raise RuntimeError("Ark API Key 或模型未配置")

        base_url = "https://ark.cn-beijing.volces.com/api/v3"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.1,   # 推理阶段用更低温度，追求确定性
            "max_tokens": 2000,
        }

        logger.info(
            "[TemplateIngest] 🧠 阶段二推理请求: model=%s, system_len=%d, user_len=%d",
            model, len(system_prompt), len(user_prompt),
        )

        max_retries = 3
        data = None
        for attempt in range(1, max_retries + 1):
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(
                    f"{base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            if response.status_code == 429:
                wait = 3 * attempt  # 3s, 6s, 9s
                logger.warning(
                    "[TemplateIngest] 🧠 阶段二遇到 429 限流，第 %d/%d 次重试，等待 %ds",
                    attempt, max_retries, wait,
                )
                if attempt < max_retries:
                    await asyncio.sleep(wait)
                    continue
                # 最后一次仍然 429，抛出
                response.raise_for_status()
            response.raise_for_status()
            data = response.json()
            break

        raw = data["choices"][0]["message"]["content"]
        logger.info(
            "[TemplateIngest] 🧠 阶段二推理返回 (%d chars): %s",
            len(raw), raw[:500],
        )

        # 解析 JSON（同样的容错逻辑）
        try:
            return _json.loads(raw)
        except _json.JSONDecodeError:
            pass
        import re as _re
        match = _re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw)
        if match:
            try:
                return _json.loads(match.group(1))
            except _json.JSONDecodeError:
                pass
        match = _re.search(r'\{[\s\S]*\}', raw)
        if match:
            return _json.loads(match.group(0))
        raise ValueError(f"无法解析阶段二推理 JSON: {raw[:200]}")

    # ────────────────────────────────────────────────────────────
    #  视频片段理解：提取转场视频 → 上传 Ark File API → Responses API
    # ────────────────────────────────────────────────────────────

    async def _extract_transition_clip(
        self,
        video_url: str,
        start_sec: float,
        end_sec: float,
        padding: float = 0.15,
    ) -> str:
        """用 ffmpeg 提取转场所在的短视频片段。失败时抛出异常。

        padding 动态计算：调用方根据转场类型传入智能 padding，
        确保连续运镜（如 dolly zoom）的完整建立/消散过程被捕获。
        """
        tmp_path = await self._ensure_local_video(video_url)

        clip_start = max(0.0, start_sec - padding)
        clip_end = end_sec + padding
        clip_duration = clip_end - clip_start

        logger.info(
            "[TemplateIngest] 📎 片段提取计划: zone=[%.3f-%.3f](%.3fs), "
            "padding=%.2fs → clip=[%.3f-%.3f](%.3fs)",
            start_sec, end_sec, end_sec - start_sec,
            padding, clip_start, clip_end, clip_duration,
        )

        clip_path = os.path.join(
            tempfile.gettempdir(),
            f"transition_clip_{uuid.uuid4().hex[:8]}.mp4",
        )
        extract_cmd = [
            "ffmpeg", "-y",
            "-ss", str(clip_start),
            "-i", tmp_path,
            "-t", str(clip_duration),
            "-c:v", "libx264",
            "-crf", "23",
            "-preset", "ultrafast",
            "-an",  # 不需要音频
            "-movflags", "+faststart",
            clip_path,
        ]
        process = await asyncio.create_subprocess_exec(
            *extract_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate()

        if process.returncode != 0 or not os.path.exists(clip_path):
            err_msg = stderr.decode()[:500] if stderr else "unknown"
            raise RuntimeError(
                f"转场视频片段提取失败 (ffmpeg rc={process.returncode}): {err_msg}"
            )

        file_size = os.path.getsize(clip_path)
        logger.info(
            "[TemplateIngest] ✅ 片段提取成功: [%.3f-%.3f](%.3fs), size=%d bytes, path=%s",
            clip_start, clip_end, clip_duration, file_size, clip_path,
        )
        return clip_path

    async def _upload_clip_to_ark(self, clip_path: str) -> str:
        """上传视频片段到火山方舟 File API，返回 file_id。

        不指定 fps 采样参数，让 Ark 自行决定最佳采样策略。
        我们只负责给够上下文（慷慨 padding），模型负责理解。
        """
        from app.config import get_settings
        settings = get_settings()
        api_key = settings.volcengine_ark_api_key

        if not api_key:
            raise RuntimeError("Ark API Key 未配置，无法上传视频")

        file_size = os.path.getsize(clip_path)
        logger.info(
            "[TemplateIngest] 准备上传视频到 Ark: size=%d bytes",
            file_size,
        )

        base_url = "https://ark.cn-beijing.volces.com/api/v3"
        async with httpx.AsyncClient(timeout=60.0) as client:
            with open(clip_path, "rb") as f:
                resp = await client.post(
                    f"{base_url}/files",
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={"file": ("transition.mp4", f, "video/mp4")},
                    data={"purpose": "user_data"},
                )
                if resp.status_code != 200:
                    body = resp.text[:500]
                    raise RuntimeError(
                        f"Ark 文件上传失败 (HTTP {resp.status_code}): {body}"
                    )
                file_data = resp.json()

            file_id = file_data.get("id")
            status = file_data.get("status", "processing")
            if not file_id:
                raise RuntimeError(
                    f"Ark 视频上传未返回 file_id: {file_data}"
                )

            # ② 等待处理完成（短片段通常 2-6 秒）
            for attempt in range(15):
                if status != "processing":
                    break
                await asyncio.sleep(2)
                resp = await client.get(
                    f"{base_url}/files/{file_id}",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                resp.raise_for_status()
                status = resp.json().get("status", "processing")
                logger.debug("[TemplateIngest] 视频处理中: file_id=%s, attempt=%d", file_id, attempt + 1)

            if status == "processing":
                raise RuntimeError(
                    f"Ark 视频处理超时: file_id={file_id}，等待 30 秒仍为 processing"
                )

            logger.info("[TemplateIngest] 视频上传成功: file_id=%s, status=%s", file_id, status)
            return file_id

    async def _call_llm_with_video(
        self,
        file_id: str,
        system_prompt: str,
        user_prompt: str,
        boundary_images_b64: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        通过火山方舟 Responses API 调用视频理解。
        file_id: 已上传的视频 file_id
        boundary_images_b64: 可选的 A/B 边界帧（转场前后的清晰帧）
        """
        import json as _json

        try:
            from app.config import get_settings
            settings = get_settings()
            api_key = settings.volcengine_ark_api_key
            model = settings.doubao_seed_1_8_endpoint
        except Exception:
            raise RuntimeError("Ark API 未配置")

        if not api_key or not model:
            raise RuntimeError("Ark API Key 或模型未配置")

        base_url = "https://ark.cn-beijing.volces.com/api/v3"

        # 构造 content: 系统指令 + 视频 + 可选边界帧 + 文字
        # Ark Responses API 不支持 instructions 字段，将系统 prompt 作为 developer 消息
        user_content: List[Dict[str, Any]] = [
            {"type": "input_video", "file_id": file_id},
        ]
        # 添加 A/B 边界帧（如果有）
        if boundary_images_b64:
            for img_b64 in boundary_images_b64:
                user_content.append({
                    "type": "input_image",
                    "image_url": f"data:image/jpeg;base64,{img_b64}",
                })
        user_content.append({"type": "input_text", "text": user_prompt})

        payload: Dict[str, Any] = {
            "model": model,
            "input": [
                {
                    "role": "developer",
                    "content": [{"type": "input_text", "text": system_prompt}],
                },
                {"role": "user", "content": user_content},
            ],
        }

        logger.info(
            "[TemplateIngest] 🎬 Responses API 请求: model=%s, file_id=%s, "
            "boundary_frames=%d, system_prompt_len=%d, user_prompt='%s'",
            model, file_id,
            len(boundary_images_b64) if boundary_images_b64 else 0,
            len(system_prompt),
            user_prompt[:200],
        )

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{base_url}/responses",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if resp.status_code != 200:
                body = resp.text[:1000]
                raise RuntimeError(
                    f"Ark Responses API 失败 (HTTP {resp.status_code}): {body}"
                )
            data = resp.json()

        # 解析 Responses API 格式
        # {"output": [{"type": "message", "content": [{"type": "output_text", "text": "..."}]}]}
        raw_text = ""
        for output_item in data.get("output", []):
            if output_item.get("type") == "message":
                for content_item in output_item.get("content", []):
                    if content_item.get("type") == "output_text":
                        raw_text = content_item.get("text", "")
                        break
                if raw_text:
                    break

        if not raw_text:
            raise ValueError(f"Responses API 无有效输出: {str(data)[:300]}")

        logger.info("[TemplateIngest] 🤖 视频分析 LLM 原始返回 (%d chars): %s", len(raw_text), raw_text[:500])

        # 解析 JSON（复用同样的容错逻辑）
        parsed = None
        try:
            parsed = _json.loads(raw_text)
        except _json.JSONDecodeError:
            pass
        if parsed is None:
            import re as _re
            match = _re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text)
            if match:
                try:
                    parsed = _json.loads(match.group(1))
                except _json.JSONDecodeError:
                    pass
        if parsed is None:
            import re as _re
            match = _re.search(r'\{[\s\S]*\}', raw_text)
            if match:
                try:
                    parsed = _json.loads(match.group(0))
                except _json.JSONDecodeError:
                    pass
        if parsed is None:
            raise ValueError(f"无法解析视频分析 JSON: {raw_text[:200]}")

        # 记录关键分析结果摘要
        logger.info(
            "[TemplateIngest] 📊 分析摘要: category=%s, type=%s, camera=%s, "
            "motion_pattern=%s, description=%s",
            parsed.get("transition_category", "?"),
            parsed.get("transition_type", "?"),
            parsed.get("camera_movement", "?"),
            parsed.get("motion_pattern", "?"),
            str(parsed.get("transition_description", "?"))[:100],
        )
        return parsed

    async def _cleanup_ark_file(self, file_id: str) -> None:
        """清理已上传的 Ark 文件（最佳努力，不阻塞主流程）。"""
        try:
            from app.config import get_settings
            api_key = get_settings().volcengine_ark_api_key
            if not api_key:
                return
            base_url = "https://ark.cn-beijing.volces.com/api/v3"
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.delete(
                    f"{base_url}/files/{file_id}",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                logger.debug("[TemplateIngest] 已清理 Ark 文件: %s", file_id)
        except Exception:
            pass  # 最佳努力，不影响主流程

    async def _download_bytes(self, url: str) -> bytes:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.content

    def _ensure_bucket(self) -> None:
        supabase = get_supabase()
        buckets = supabase.storage.list_buckets()
        bucket_names = [b.name for b in buckets]
        if TEMPLATE_BUCKET not in bucket_names:
            supabase.storage.create_bucket(TEMPLATE_BUCKET, options={"public": True})

    def _build_template_metadata(self, job: Dict[str, Any]) -> Dict[str, Any]:
        params = job.get("params") or {}
        metadata_raw = params.get("metadata") if isinstance(params, dict) else {}
        metadata: Dict[str, Any] = dict(metadata_raw or {})
        scopes = metadata.get("scopes")
        if not scopes:
            metadata["scopes"] = ["visual-studio"]
        return metadata

    @staticmethod
    def _generate_smart_name(
        template_type: str,
        index: int,
        workflow: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> str:
        """
        生成有辨识度的模板名称。
        转场: "旋转换装-街景" / "快甩-室内"
        广告: "城市街拍-柔光" / "产品特写-暖调"
        """
        parts: List[str] = []
        try:
            if template_type == "transition":
                spec = metadata.get("transition_spec") or {}
                # 优先用 transition_description 的前半段
                desc = str(spec.get("transition_description") or "").strip()
                if desc:
                    # 取逗号/句号前的第一小句，限20字
                    short = desc.split("，")[0].split("。")[0].split(",")[0][:20]
                    parts.append(short)
                else:
                    # fallback: transition_type
                    t_type = spec.get("transition_type") or "transition"
                    type_labels = {
                        "spin": "旋转", "whip_pan": "快甩", "dolly_zoom": "推拉",
                        "flash_cut": "闪切", "zoom_blur": "变焦", "glitch": "故障",
                        "morph": "形变", "luma_wipe": "亮度擦除", "occlusion": "遮挡",
                    }
                    parts.append(type_labels.get(t_type, t_type))
                # 场景关键词
                scene_a = str(spec.get("scene_a_description") or "")[:10]
                if scene_a:
                    parts.append(scene_a.split("，")[0].split(",")[0][:8])
            else:
                # 广告模板：用 scene_description
                scene_desc = str(workflow.get("scene_description") or "").strip()
                if scene_desc:
                    short = scene_desc.split("，")[0].split("。")[0].split(",")[0][:20]
                    parts.append(short)
                else:
                    prompt_seed = str(workflow.get("prompt_seed") or "").strip()
                    if prompt_seed and len(prompt_seed) > 4:
                        parts.append(prompt_seed[:20])
                # 风格
                style = workflow.get("style") or {}
                color_label = {"cool": "冷调", "warm": "暖调", "neutral": ""}.get(str(style.get("color", "")), "")
                light_label = {"soft": "柔光", "hard": "硬光", "neon": "霓虹"}.get(str(style.get("light", "")), "")
                accent = color_label or light_label
                if accent:
                    parts.append(accent)
        except Exception:
            pass

        if not parts:
            parts.append(template_type)
        # 加序号避免重名
        base_name = "-".join(parts)
        return f"{base_name}-{index + 1}"

    async def _create_template_from_image(
        self,
        image: Image.Image,
        job: Dict[str, Any],
        index: int,
        source_timecode: Optional[str] = None,
        metadata_extra: Optional[Dict[str, Any]] = None,
    ) -> TemplateAsset:
        supabase = get_supabase()

        template_type = job.get("template_type", "ad")
        template_id = f"{template_type}-{uuid.uuid4().hex[:8]}-{index + 1}"
        category = template_type
        template_kind = "transition" if template_type == "transition" else "background"
        metadata = self._build_template_metadata(job)
        if metadata_extra:
            metadata.update(metadata_extra)

        storage_path = f"{TEMPLATE_PREFIX}{template_id}.jpg"
        thumb_path = f"{TEMPLATE_PREFIX}{template_id}-thumb.jpg"

        full_bytes = self._encode_jpeg(image, quality=92)
        thumb_bytes = self._encode_jpeg(self._build_thumbnail(image), quality=85)

        self._ensure_bucket()

        supabase.storage.from_(TEMPLATE_BUCKET).upload(
            storage_path, full_bytes, {"content-type": "image/jpeg"}
        )
        supabase.storage.from_(TEMPLATE_BUCKET).upload(
            thumb_path, thumb_bytes, {"content-type": "image/jpeg"}
        )

        url = supabase.storage.from_(TEMPLATE_BUCKET).get_public_url(storage_path)
        thumb_url = supabase.storage.from_(TEMPLATE_BUCKET).get_public_url(thumb_path)

        # DEBUG: 打印图片信息用于追踪
        logger.info(f"[TemplateIngest] 开始生成 workflow: template_id={template_id}, image_size={image.size}, url={url[:80]}...")
        workflow = await self._generate_workflow(image, job)
        logger.info(f"[TemplateIngest] workflow 生成完成: template_id={template_id}, prompt_seed={workflow.get('prompt_seed', '')[:50]}...")

        # 智能命名：基于 workflow 分析结果和 transition 分析数据
        name = self._generate_smart_name(template_type, index, workflow, metadata)
        logger.info(f"[TemplateIngest] 模板命名: {name}")

        record = {
            "template_id": template_id,
            "name": name,
            "type": template_kind,
            "category": category,
            "tags": job.get("tags_hint") or [],
            "bucket": TEMPLATE_BUCKET,
            "storage_path": storage_path,
            "thumbnail_path": thumb_path,
            "url": url,
            "thumbnail_url": thumb_url,
            "workflow": workflow,
            "source_origin": "ingest",
            "source_url": job.get("source_url"),
            "source_timecode": source_timecode,
            "metadata": metadata,
            "status": "draft",
        }
        supabase.table("template_records").insert(record).execute()

        # ── Phase 4a: Golden Fingerprint 自动提取 + 匹配 + 预填 ──
        try:
            from app.services.golden_fingerprint_service import get_golden_fingerprint_service
            gf_service = get_golden_fingerprint_service()
            fp_result = gf_service.process_template(record, auto_fill=True)
            logger.info(
                "[TemplateIngest] 指纹匹配: template=%s profile=%s score=%.3f",
                template_id,
                fp_result.get("best_match", {}).get("profile_name", "none"),
                fp_result.get("best_match", {}).get("score", 0),
            )
        except Exception as exc:
            logger.warning("[TemplateIngest] Golden Fingerprint 处理失败(非致命): %s", exc)

        return TemplateAsset(
            template_id=template_id,
            name=name,
            category=category,
            type=template_kind,
            storage_path=storage_path,
            thumbnail_path=thumb_path,
            url=url,
            thumbnail_url=thumb_url,
        )

    async def _generate_workflow(self, image: Image.Image, job: Dict[str, Any]) -> Dict[str, Any]:
        default_workflow = self._build_default_workflow(job)
        enable_llm = os.getenv("ENABLE_TEMPLATE_WORKFLOW_LLM", "true").lower() in ("1", "true", "yes")
        if not enable_llm:
            return default_workflow

        try:
            from app.services.llm.service import LLMService
            from app.utils.image_utils import pil_image_to_base64
        except Exception as exc:
            logger.warning("[TemplateIngest] LLM 依赖不可用: %s", exc)
            return default_workflow

        llm_service = LLMService()

        tags = job.get("tags_hint") or []
        template_type = job.get("template_type", "ad")
        description = ""
        try:
            image_base64 = pil_image_to_base64(image, format="PNG")
            # DEBUG: 打印图片的一些特征用于验证
            logger.info(f"[TemplateIngest] 准备分析图片: size={image.size}, mode={image.mode}, base64_len={len(image_base64)}")
            
            # 🔍 DEBUG: 保存发送给 LLM 的图片副本到临时目录
            debug_save_path = f"/tmp/debug_llm_image_{uuid.uuid4().hex[:8]}.png"
            image.save(debug_save_path, format="PNG")
            logger.info(f"[TemplateIngest] 🔍 DEBUG: 图片已保存到 {debug_save_path} 供验证")
            
            # 计算图片的像素统计，帮助判断是否是黑色图片
            import numpy as np
            img_array = np.array(image)
            mean_brightness = img_array.mean()
            logger.info(f"[TemplateIngest] 🔍 DEBUG: 图片平均亮度={mean_brightness:.2f} (0=纯黑, 255=纯白)")
            
            description = await llm_service.analyze_image(
                image_base64=image_base64,
                prompt="请用一句话描述画面风格、光线、色调、运镜趋势。",
            )
            logger.info(f"[TemplateIngest] 图片分析结果: {description[:100]}...")
        except Exception as exc:
            logger.info("[TemplateIngest] 跳过图片分析: %s", exc)

        system_prompt = (
            "你是视频制作专家，请根据输入生成模板 workflow 配置。"
            "严格输出 JSON，不要解释。"
            "字段: "
            "{"
            "\"kling_endpoint\": \"image_to_video|text_to_video|multi_image_to_video|motion_control\","
            "\"prompt_seed\": \"...\","
            "\"negative_prompt\": \"...\","
            "\"duration\": \"5|10\","
            "\"model_name\": \"kling-v2-6\","
            "\"cfg_scale\": 0.5,"
            "\"mode\": \"std|pro\","
            "\"shot_type\": \"wide|medium|close|macro\","
            "\"camera_move\": \"push|pull|orbit|handheld|static|none\","
            "\"transition\": \"match_cut|whip_pan|flash|none\","
            "\"pacing\": \"fast|medium|slow\","
            "\"style\": {\"color\": \"cool|warm|neutral\", \"light\": \"soft|hard|neon\"}"
            "}"
            "\n注意：不要输出 camera_control 字段，系统会根据 camera_move 自动推导。"
            "\n如果视频没有运镜（如静态背景、特效叠加），camera_move 设为 static。"
        )
        user_prompt = (
            f"模板类型: {template_type}\n"
            f"标签: {', '.join(tags) if tags else '无'}\n"
            f"画面描述: {description or '无'}\n"
            "请给出适配该模板的 kling workflow 配置。"
        )
        try:
            workflow = await llm_service.generate_json(
                user_prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.2,
            )
            if isinstance(workflow, dict):
                merged = {**default_workflow, **workflow}
                if description:
                    merged["scene_description"] = description

                # 转场模板强制 duration=5（Kling 转场模式不需要 10s）
                if job.get("template_type") == "transition":
                    merged["duration"] = "5"

                fallback_seed = description or default_workflow.get("prompt_seed", "")
                if not self._is_meaningful_prompt_seed(merged.get("prompt_seed")):
                    if fallback_seed:
                        merged["prompt_seed"] = fallback_seed
                    else:
                        merged["prompt_seed"] = default_workflow.get("prompt_seed", "")
                return merged
        except Exception as exc:
            logger.info("[TemplateIngest] workflow 生成失败，使用默认配置: %s", exc)
        return default_workflow

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
        # 排除纯数字/符号式占位
        digit_ratio = sum(ch.isdigit() for ch in text) / max(len(text), 1)
        return digit_ratio < 0.5

    @staticmethod
    def _build_default_workflow(job: Dict[str, Any]) -> Dict[str, Any]:
        template_type = job.get("template_type", "ad")
        if template_type == "transition":
            return {
                "kling_endpoint": "motion_control",
                "prompt_seed": "转场模板，节奏紧凑，动感强",
                "negative_prompt": "low quality, blurry, watermark",
                "duration": "5",
                "model_name": "kling-v2-6",
                "cfg_scale": 0.5,
                "mode": "std",
                "shot_type": "wide",
                "camera_move": "whip_pan",
                "transition": "whip_pan",
                "pacing": "fast",
                "style": {"color": "neutral", "light": "hard"},
            }
        return {
            "kling_endpoint": "image_to_video",
            "prompt_seed": "广告模板，产品质感清晰，光线高级",
            "negative_prompt": "low quality, blurry, watermark",
            "duration": "5",
            "model_name": "kling-v2-6",
            "cfg_scale": 0.5,
            "mode": "std",
            "shot_type": "medium",
            "camera_move": "push",
            "transition": "none",
            "pacing": "medium",
            "style": {"color": "cool", "light": "soft"},
        }

    @staticmethod
    def _encode_jpeg(image: Image.Image, quality: int = 90) -> bytes:
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality)
        return buffer.getvalue()

    @staticmethod
    def _build_thumbnail(image: Image.Image) -> Image.Image:
        thumb = image.copy()
        thumb.thumbnail((DEFAULT_THUMB_MAX, DEFAULT_THUMB_MAX), Image.Resampling.LANCZOS)
        return thumb

    @staticmethod
    def _normalize_clip_ranges(
        clip_ranges: List[Dict[str, Any]],
        total_duration_sec: float,
    ) -> List[Tuple[float, float]]:
        normalized: List[Tuple[float, float]] = []
        for raw in clip_ranges:
            if not isinstance(raw, dict):
                continue

            # 兼容秒级字段与毫秒字段
            start = raw.get("start")
            end = raw.get("end")
            if start is None:
                start = raw.get("start_sec")
            if end is None:
                end = raw.get("end_sec")

            start_ms = raw.get("start_ms")
            end_ms = raw.get("end_ms")
            if start_ms is not None:
                start = float(start_ms) / 1000
            if end_ms is not None:
                end = float(end_ms) / 1000

            try:
                start_sec = float(start)
                end_sec = float(end)
            except (TypeError, ValueError):
                continue

            start_sec = max(0.0, min(start_sec, total_duration_sec))
            end_sec = max(0.0, min(end_sec, total_duration_sec))
            if end_sec <= start_sec:
                continue

            normalized.append((start_sec, end_sec))

        normalized.sort(key=lambda item: item[0])
        return normalized

    @staticmethod
    def _allocate_frame_timestamps(
        ranges: List[Tuple[float, float]],
        extract_frames: int,
    ) -> List[float]:
        if extract_frames <= 0 or not ranges:
            return []

        durations = [max(0.0, end - start) for start, end in ranges]
        total = sum(durations)
        if total <= 0:
            return []

        exact_allocations = [(duration / total) * extract_frames for duration in durations]
        allocations = [int(value) for value in exact_allocations]
        remaining = extract_frames - sum(allocations)

        if remaining > 0:
            # 最大余数法，保证总数精确对齐 extract_frames
            remainders = sorted(
                [(idx, exact_allocations[idx] - allocations[idx]) for idx in range(len(ranges))],
                key=lambda item: item[1],
                reverse=True,
            )
            for step in range(remaining):
                idx = remainders[step % len(remainders)][0]
                allocations[idx] += 1

        timestamps: List[float] = []
        for (start, end), frame_count in zip(ranges, allocations):
            if frame_count <= 0:
                continue
            span = end - start
            for i in range(frame_count):
                ts = start + span * ((i + 1) / (frame_count + 1))
                timestamps.append(ts)

        return timestamps

    async def _ensure_local_video(self, video_url: str) -> str:
        import hashlib

        url_hash = hashlib.md5(video_url.encode()).hexdigest()[:12]
        temp_dir = tempfile.gettempdir()
        tmp_path = os.path.join(temp_dir, f"tmpl_ingest_{url_hash}.mp4")

        # 🔧 关键修复: 每次都重新下载视频，不使用缓存（避免分析到旧视频）
        # 因为不同的任务可能复用同一个临时文件名（如果 URL 哈希冲突）
        logger.info(f"[TemplateIngest] 下载视频: url_hash={url_hash}, tmp_path={tmp_path}, url={video_url[:80]}...")
        
        # 删除旧缓存（如果存在）
        if os.path.exists(tmp_path):
            logger.info(f"[TemplateIngest] 删除旧缓存文件: {tmp_path}")
            os.remove(tmp_path)
        
        download_process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-i", video_url,
            "-c", "copy",
            "-movflags", "+faststart",
            tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await download_process.communicate()
        if download_process.returncode != 0:
            error_msg = stderr.decode()[:300] if stderr else "Unknown error"
            raise RuntimeError(f"视频下载失败: {error_msg}")
        
        # 验证下载的文件
        file_size = os.path.getsize(tmp_path) if os.path.exists(tmp_path) else 0
        logger.info(f"[TemplateIngest] 视频下载完成: file_size={file_size} bytes")
        
        return tmp_path

    async def _probe_video_duration(self, video_path: str) -> float:
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1",
            video_path,
        ]
        probe_process = await asyncio.create_subprocess_exec(
            *probe_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        probe_stdout, _ = await probe_process.communicate()
        duration = float((probe_stdout.decode() or "0").strip() or 0)
        if duration <= 0:
            raise RuntimeError("无法解析视频时长")
        return duration

    async def _extract_frames_at_timestamps(
        self,
        video_url: str,
        timestamps: List[float],
    ) -> List[Image.Image]:
        logger.info(f"[TemplateIngest] 转场模板提取帧: timestamps={timestamps}")
        tmp_path = await self._ensure_local_video(video_url)
        if not timestamps:
            return []

        frames: List[Image.Image] = []
        frames_dir = tempfile.mkdtemp(prefix="tmpl_ingest_frames_at_ts_")
        try:
            for idx, ts in enumerate(timestamps):
                frame_path = os.path.join(frames_dir, f"frame_{idx:03d}.jpg")
                extract_cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(max(0.0, ts)),
                    "-i", tmp_path,
                    "-vframes", "1",
                    "-q:v", "2",
                    frame_path,
                ]
                extract_process = await asyncio.create_subprocess_exec(
                    *extract_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await extract_process.communicate()
                if os.path.exists(frame_path):
                    frame_img = Image.open(frame_path).convert("RGB")
                    logger.info(f"[TemplateIngest] 转场帧 {idx}: ts={ts}s, size={frame_img.size}")
                    frames.append(frame_img)
                else:
                    logger.warning(f"[TemplateIngest] ⚠️ 转场帧 {idx} 提取失败")
        finally:
            try:
                import shutil
                shutil.rmtree(frames_dir)
            except Exception:
                pass
        return frames

    async def _extract_frames(
        self,
        video_url: str,
        extract_frames: int,
        clip_ranges: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Image.Image]:
        logger.info(f"[TemplateIngest] 开始提取帧: url={video_url[:80]}..., extract_frames={extract_frames}")
        tmp_path = await self._ensure_local_video(video_url)
        duration = await self._probe_video_duration(tmp_path)
        logger.info(f"[TemplateIngest] 视频时长: {duration}s, 本地路径: {tmp_path}")

        normalized_ranges = self._normalize_clip_ranges(clip_ranges or [], duration)
        timestamps = self._allocate_frame_timestamps(normalized_ranges, extract_frames)
        if not timestamps:
            interval = duration / (extract_frames + 1)
            timestamps = [interval * (i + 1) for i in range(extract_frames)]
        logger.info(f"[TemplateIngest] 提取时间戳: {timestamps}")

        frames: List[Image.Image] = []

        frames_dir = tempfile.mkdtemp(prefix="tmpl_ingest_frames_")
        try:
            for idx, ts in enumerate(timestamps):
                frame_path = os.path.join(frames_dir, f"frame_{idx:03d}.jpg")
                extract_cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(ts),
                    "-i", tmp_path,
                    "-vframes", "1",
                    "-q:v", "2",
                    frame_path,
                ]
                extract_process = await asyncio.create_subprocess_exec(
                    *extract_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await extract_process.communicate()
                if os.path.exists(frame_path):
                    frame_img = Image.open(frame_path).convert("RGB")
                    logger.info(f"[TemplateIngest] 提取帧 {idx}: ts={ts}s, size={frame_img.size}")
                    frames.append(frame_img)
        finally:
            try:
                import shutil
                shutil.rmtree(frames_dir)
            except Exception:
                pass

        return frames


_template_ingest_service: Optional[TemplateIngestService] = None


def get_template_ingest_service() -> TemplateIngestService:
    global _template_ingest_service
    if _template_ingest_service is None:
        _template_ingest_service = TemplateIngestService()
    return _template_ingest_service
