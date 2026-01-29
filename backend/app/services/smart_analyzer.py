"""
智能一键成片 V2 - SmartAnalyzer 服务
一站式 LLM 智能分析：脚本对齐、废话识别、重复检测、风格分析

核心设计理念:
1. LLM 优先 - 一次调用完成所有分析任务
2. 用户感知度 - 清晰的阶段进度
3. 效率为王 - 推荐优先，一键接受
"""

import json
import logging
from enum import Enum
from typing import Optional, Callable, List, Dict, Any
from uuid import uuid4
from datetime import datetime
from pydantic import BaseModel, Field

from .llm import llm_service
from .supabase_client import supabase

logger = logging.getLogger(__name__)


# ============================================
# 数据模型
# ============================================

class ProcessingStage(str, Enum):
    """处理阶段枚举"""
    PENDING = "pending"
    UPLOADING = "uploading"
    TRANSCRIBING = "transcribing"
    ANALYZING = "analyzing"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"
    
    @property
    def message(self) -> str:
        """获取阶段描述"""
        messages = {
            "pending": "等待处理...",
            "uploading": "📤 上传中...",
            "transcribing": "🎤 语音转写中...",
            "analyzing": "🧠 AI 智能分析中...",
            "generating": "✨ 生成推荐方案...",
            "completed": "✅ 分析完成！",
            "failed": "❌ 处理失败"
        }
        return messages.get(self.value, "处理中...")
    
    @property
    def progress(self) -> int:
        """获取阶段对应的进度百分比"""
        progress_map = {
            "pending": 0,
            "uploading": 10,
            "transcribing": 30,
            "analyzing": 60,
            "generating": 85,
            "completed": 100,
            "failed": 0
        }
        return progress_map.get(self.value, 0)


class QualityScores(BaseModel):
    """片段质量评分"""
    clarity: float = Field(default=0.8, ge=0, le=1, description="清晰度")
    fluency: float = Field(default=0.8, ge=0, le=1, description="流畅度")
    emotion: float = Field(default=0.8, ge=0, le=1, description="情感表达")
    speed: float = Field(default=0.8, ge=0, le=1, description="语速适中程度")


# ============================================
# 分类映射（统一处理）
# ============================================

# 标准分类列表
STANDARD_CLASSIFICATIONS = {
    "breath", "filler", "noise", "repeat", "dead_air", "hesitation", "long_pause",
    "matched", "deviation", "improvisation", "valuable", "uncertain", "delete"
}

# 所有可能输入 -> 标准分类（统一映射表，大小写不敏感）
CLASSIFICATION_MAP: Dict[str, str] = {
    # === 标准分类（直接返回） ===
    "breath": "breath",
    "filler": "filler", 
    "noise": "noise",
    "repeat": "repeat",
    "dead_air": "dead_air",
    "hesitation": "hesitation",
    "long_pause": "long_pause",
    "matched": "matched",
    "deviation": "deviation",
    "improvisation": "improvisation",
    "valuable": "valuable",
    "uncertain": "uncertain",
    "delete": "delete",
    
    # === 英文变体 ===
    "empty": "dead_air",
    "silence": "dead_air",
    "pause": "long_pause",
    "stutter": "hesitation",
    "irrelevant": "deviation",
    
    # === Action 被误用为 classification ===
    "keep": "matched",
    "choose": "repeat",
    
    # === 中文分类 ===
    "废话": "filler",
    "口癖": "filler",
    "噪音": "noise",
    "静默": "dead_air",
    "重复": "repeat",
    "犹豫": "hesitation",
    "停顿": "long_pause",
    "换气": "breath",
    "匹配": "matched",
    "有效": "matched",
    "偏离": "deviation",
    "即兴": "improvisation",
    "有价值": "valuable",
    "待确认": "uncertain",
    "删除": "delete",
}

def normalize_classification(raw_classification: str) -> str:
    """将 LLM 返回的分类标准化"""
    if not raw_classification:
        return "matched"
    
    # 统一查表（先尝试原值，再尝试小写）
    key = raw_classification.strip()
    if key in CLASSIFICATION_MAP:
        return CLASSIFICATION_MAP[key]
    
    lower_key = key.lower()
    if lower_key in CLASSIFICATION_MAP:
        return CLASSIFICATION_MAP[lower_key]
    
    # 未知分类，记录警告
    logger.warning(f"未知的分类类型: '{raw_classification}'，已映射为 'matched'")
    return "matched"


class AnalyzedSegment(BaseModel):
    """分析后的片段"""
    id: str
    start: float
    end: float
    text: str
    
    # 分类 (LLM 输出)
    action: str = Field(description="keep | delete | choose")
    classification: str = Field(description="matched | deviation | filler | repeat | improvisation")
    confidence: float = Field(default=0.9, ge=0, le=1)
    
    # 关联信息
    repeat_group_id: Optional[str] = None
    script_match: Optional[str] = None
    is_recommended: bool = False
    asset_id: Optional[str] = None  # 来源素材 ID（多素材场景）
    
    # 废话词
    filler_words: List[str] = []
    reason: Optional[str] = None
    
    # 质量评分
    quality_score: float = Field(default=0.8, ge=0, le=1)
    quality_scores: Optional[QualityScores] = None
    quality_notes: Optional[str] = None


class RepeatGroup(BaseModel):
    """重复片段组"""
    id: str
    intent: str = Field(description="这组重复片段想表达的内容")
    script_match: Optional[str] = None
    segment_ids: List[str]
    recommended_id: str
    recommend_reason: str


class ZoomRecommendation(BaseModel):
    """缩放推荐"""
    rhythm: str = Field(description="punchy | smooth | minimal")
    scale_range: List[float] = Field(default=[1.0, 1.2])
    duration_ms: int = 500
    easing: str = "ease_in_out"
    triggers: List[str] = Field(default=["key_point", "new_topic"])


class StyleAnalysis(BaseModel):
    """风格分析结果"""
    detected_style: str = Field(description="energetic_vlog | tutorial | storytelling | news_commentary")
    confidence: float = Field(default=0.8, ge=0, le=1)
    reasoning: str
    zoom_recommendation: ZoomRecommendation


class AnalysisSummary(BaseModel):
    """分析统计摘要"""
    total_segments: int = 0
    keep_count: int = 0
    delete_count: int = 0
    choose_count: int = 0
    repeat_groups_count: int = 0
    estimated_duration_after: float = 0.0
    reduction_percent: float = 0.0
    script_coverage: Optional[float] = None


class AnalysisResult(BaseModel):
    """完整分析结果"""
    segments: List[AnalyzedSegment]
    repeat_groups: List[RepeatGroup] = []
    style_analysis: Optional[StyleAnalysis] = None
    summary: AnalysisSummary


# ============================================
# Super Prompt
# ============================================

SUPER_ANALYSIS_PROMPT = """# 角色
你是专业的口播视频内容分析师。你需要一次性完成所有分析任务，输出结构化的分析结果。

# 输入数据

## ASR 转写结果 (带时间戳)
```json
{transcript_json}
```

## 用户脚本 (可选，如果用户提供了)
{script_or_none}

## 音频特征
- 视频时长: {duration}秒
- 平均语速: {speech_rate} 字/分钟
- 停顿分布: {pause_info}

# 你的任务 (一次性完成以下所有分析)

## 任务1: 片段分类
对输入中的**每一个** ASR 片段进行分类（必须包含所有片段 ID，不可遗漏）：
- `keep` - 有效内容，直接保留
- `delete` - 废话/口癖，建议删除
- `choose` - 需要用户选择（通常是重复片段）

## 任务2: 废话识别
识别以下类型的废话：
- 口癖词：嗯、啊、那个、就是说、对吧
- 无意义重复：同一个词连说两遍
- 中断重启：说到一半重新说
- 自我纠正：口误后的纠正（保留纠正后的版本）

## 任务3: 重复片段检测
识别用户对同一句话录了多遍的情况：
- 标记为同一个 repeat_group
- 推荐最佳版本（语速自然、无口误、情绪到位）
- 说明推荐理由

## 任务4: 脚本对齐 (如果有脚本)
- 找出转写内容与脚本的对应关系
- 标记：matched(匹配) / deviation(偏离) / improvisation(即兴)
- 计算脚本完成度

## 任务5: 风格分析与缩放推荐
判断视频风格并推荐缩放参数：
- energetic_vlog: 活力vlog，缩放快速有力 (300ms, 1.0-1.4x)
- tutorial: 教程讲解，缩放平滑稳定 (500ms, 1.0-1.2x)  
- storytelling: 故事叙述，缩放缓慢沉浸 (800ms, 1.0-1.15x)
- news_commentary: 新闻评论，缩放中等强调 (400ms, 1.0-1.25x)

# 输出格式 (严格JSON)
```json
{{
  "segments": [
    {{
      "id": "seg_001",
      "start": 0.0,
      "end": 3.2,
      "text": "大家好，我是xxx",
      "action": "keep",
      "classification": "matched",
      "confidence": 0.95,
      "script_match": "大家好，我是xxx",
      "repeat_group_id": null,
      "filler_words": [],
      "quality_score": 0.9
    }},
    {{
      "id": "seg_002",
      "start": 3.2,
      "end": 4.1,
      "text": "嗯那个",
      "action": "delete",
      "classification": "filler",
      "confidence": 0.98,
      "filler_words": ["嗯", "那个"],
      "reason": "纯口癖词，无实际内容"
    }},
    {{
      "id": "seg_003",
      "start": 4.1,
      "end": 8.5,
      "text": "今天给大家分享一个技巧",
      "action": "choose",
      "classification": "repeat",
      "confidence": 0.92,
      "repeat_group_id": "group_intro",
      "is_recommended": false,
      "quality_score": 0.75,
      "quality_notes": "语速偏快，有轻微口误"
    }}
  ],
  
  "repeat_groups": [
    {{
      "id": "group_intro",
      "intent": "开场介绍今天的主题",
      "script_match": "今天给大家分享一个技巧",
      "segment_ids": ["seg_003", "seg_006", "seg_009"],
      "recommended_id": "seg_006",
      "recommend_reason": "语速适中，表达流畅，情绪自然"
    }}
  ],
  
  "style_analysis": {{
    "detected_style": "tutorial",
    "confidence": 0.88,
    "reasoning": "语速180字/分钟适中，停顿规律，内容有逻辑结构",
    "zoom_recommendation": {{
      "rhythm": "smooth",
      "scale_range": [1.0, 1.2],
      "duration_ms": 500,
      "easing": "ease_in_out",
      "triggers": ["key_point", "new_topic"]
    }}
  }},
  
  "summary": {{
    "total_segments": 25,
    "keep_count": 18,
    "delete_count": 5,
    "choose_count": 2,
    "repeat_groups_count": 1,
    "script_coverage": 0.92,
    "estimated_duration_after": 180,
    "reduction_percent": 28
  }}
}}
```

只输出 JSON，不要其他解释。"""


# ============================================
# SmartAnalyzer 服务
# ============================================

class SmartAnalyzer:
    """一站式智能分析器 - LLM 优先"""
    
    def __init__(self):
        pass
    
    async def analyze(
        self,
        transcript_segments: List[Dict[str, Any]],
        script: Optional[str] = None,
        audio_features: Optional[Dict[str, Any]] = None,
        video_duration: float = 0
    ) -> AnalysisResult:
        """
        一次 LLM 调用完成所有分析
        
        Args:
            transcript_segments: ASR 转写结果
            script: 用户脚本（可选）
            audio_features: 音频特征（可选）
            video_duration: 视频时长
            
        Returns:
            AnalysisResult: 完整分析结果
        """
        logger.info(f"🧠 SmartAnalyzer: 开始分析 {len(transcript_segments)} 个片段")
        
        # 检查 LLM 配置
        if not is_llm_configured():
            logger.warning("⚠️ LLM 未配置，返回默认分析结果")
            return self._generate_fallback_result(transcript_segments)
        
        # 构建输入
        # 注意：ASR segments 时间是毫秒，但 LLM prompt 示例使用秒
        # 为了与示例保持一致，转换为秒传给 LLM
        transcript_json = json.dumps([{
            "id": f"seg_{i:03d}",
            "start": round(seg.get("start", 0) / 1000, 3),  # 毫秒 -> 秒
            "end": round(seg.get("end", 0) / 1000, 3),      # 毫秒 -> 秒
            "text": seg.get("text", "")
        } for i, seg in enumerate(transcript_segments)], ensure_ascii=False, indent=2)
        
        script_or_none = f'"""\n{script}\n"""' if script else "无（用户未提供脚本）"
        
        speech_rate = audio_features.get("speech_rate", "未知") if audio_features else "未知"
        pause_info = audio_features.get("pause_summary", "未知") if audio_features else "未知"
        
        # 构建 Prompt
        prompt = SUPER_ANALYSIS_PROMPT.format(
            transcript_json=transcript_json,
            script_or_none=script_or_none,
            duration=video_duration,
            speech_rate=speech_rate,
            pause_info=pause_info
        )
        
        logger.info(f"📝 Prompt 长度: {len(prompt)} 字符")
        
        # 检查 LLM 是否配置
        if not llm_service.is_configured():
            logger.warning("⚠️ LLM 未配置，返回默认结果")
            return self._generate_fallback_result(transcript_segments)
        
        # 一次 LLM 调用
        response = await llm_service.call(
            prompt=prompt,
            system_prompt="你是专业的口播视频内容分析师，擅长识别废话、重复片段和分析视频风格。请严格按照 JSON 格式输出。",
        )
        
        if not response:
            logger.error("❌ LLM 调用失败，返回默认结果")
            return self._generate_fallback_result(transcript_segments)
        
        # 解析结果
        return self._parse_result(response, transcript_segments)
    
    def _parse_result(
        self, 
        response: str, 
        original_segments: List[Dict]
    ) -> AnalysisResult:
        """解析 LLM 响应"""
        try:
            # 提取 JSON
            json_str = response
            if "```json" in response:
                json_str = response.split("```json")[1].split("```")[0]
            elif "```" in response:
                json_str = response.split("```")[1].split("```")[0]
            
            data = json.loads(json_str.strip())
            
            # 解析片段 - 确保以原始片段为基准，防止 LLM 遗漏
            llm_segments_map = {s.get("id"): s for s in data.get("segments", []) if s.get("id")}
            segments = []
            
            for i, original_seg in enumerate(original_segments):
                seg_id = f"seg_{i:03d}"
                
                # 默认值（从原始片段获取）
                text = original_seg.get("text", "")
                # 转换为秒（ASR 返回的 start/end 是毫秒）
                start = round(original_seg.get("start", 0) / 1000, 3)
                end = round(original_seg.get("end", 0) / 1000, 3)
                # 获取来源素材 ID（多素材场景）
                asset_id = original_seg.get("_asset_id")
                
                # 尝试获取 LLM 分析结果
                llm_data = llm_segments_map.get(seg_id)
                
                # 默认值
                action = "keep"
                classification = "matched"
                confidence = 0.9
                repeat_group_id = None
                script_match = None
                is_recommended = False
                filler_words = []
                reason = None
                quality_score = 0.8
                quality_notes = None
                
                if llm_data:
                    # 使用 LLM 数据覆盖
                    action = llm_data.get("action", "keep")
                    # ★ 关键：标准化分类（中文 -> 英文）
                    raw_classification = llm_data.get("classification", "matched")
                    classification = normalize_classification(raw_classification)
                    confidence = llm_data.get("confidence", 0.9)
                    repeat_group_id = llm_data.get("repeat_group_id")
                    script_match = llm_data.get("script_match")
                    is_recommended = llm_data.get("is_recommended", False)
                    filler_words = llm_data.get("filler_words", [])
                    reason = llm_data.get("reason")
                    quality_score = llm_data.get("quality_score", 0.8)
                    quality_notes = llm_data.get("quality_notes")
                
                try:
                    seg = AnalyzedSegment(
                        id=seg_id,
                        start=start,
                        end=end,
                        text=text,
                        action=action,
                        classification=classification,
                        confidence=confidence,
                        repeat_group_id=repeat_group_id,
                        script_match=script_match,
                        is_recommended=is_recommended,
                        asset_id=asset_id,
                        filler_words=filler_words,
                        reason=reason,
                        quality_score=quality_score,
                        quality_notes=quality_notes
                    )
                    segments.append(seg)
                except Exception as e:
                    logger.warning(f"构建片段失败: {e}, ID: {seg_id}")
            
            # 解析重复组
            repeat_groups = []
            for group_data in data.get("repeat_groups", []):
                try:
                    group = RepeatGroup(
                        id=group_data.get("id", f"group_{len(repeat_groups):03d}"),
                        intent=group_data.get("intent", ""),
                        script_match=group_data.get("script_match"),
                        segment_ids=group_data.get("segment_ids", []),
                        recommended_id=group_data.get("recommended_id", ""),
                        recommend_reason=group_data.get("recommend_reason", "")
                    )
                    repeat_groups.append(group)
                except Exception as e:
                    logger.warning(f"解析重复组失败: {e}")
            
            # 解析风格分析
            style_analysis = None
            style_data = data.get("style_analysis")
            if style_data and isinstance(style_data, dict):
                try:
                    zoom_data = style_data.get("zoom_recommendation") or {}
                    zoom_rec = ZoomRecommendation(
                        rhythm=zoom_data.get("rhythm") or "smooth",
                        scale_range=zoom_data.get("scale_range") or [1.0, 1.2],
                        duration_ms=zoom_data.get("duration_ms") or 500,
                        easing=zoom_data.get("easing") or "ease_in_out",
                        triggers=zoom_data.get("triggers") or ["key_point"]
                    )
                    style_analysis = StyleAnalysis(
                        detected_style=style_data.get("detected_style") or "tutorial",
                        confidence=style_data.get("confidence") or 0.8,
                        reasoning=style_data.get("reasoning") or "",
                        zoom_recommendation=zoom_rec
                    )
                except Exception as e:
                    logger.warning(f"解析风格分析失败: {e}")
            
            # 解析摘要 - 确保数值字段不为 None
            summary_data = data.get("summary") or {}
            summary = AnalysisSummary(
                total_segments=summary_data.get("total_segments") or len(segments),
                keep_count=summary_data.get("keep_count") or 0,
                delete_count=summary_data.get("delete_count") or 0,
                choose_count=summary_data.get("choose_count") or 0,
                repeat_groups_count=summary_data.get("repeat_groups_count") or len(repeat_groups),
                estimated_duration_after=float(summary_data.get("estimated_duration_after") or 0.0),
                reduction_percent=float(summary_data.get("reduction_percent") or 0.0),
                script_coverage=summary_data.get("script_coverage")
            )
            
            logger.info(f"✅ 分析完成: {len(segments)} 片段, {len(repeat_groups)} 重复组")
            
            return AnalysisResult(
                segments=segments,
                repeat_groups=repeat_groups,
                style_analysis=style_analysis,
                summary=summary
            )
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON 解析失败: {e}")
            logger.error(f"原始响应: {response[:500]}...")
            return self._generate_fallback_result(original_segments)
        except Exception as e:
            logger.error(f"❌ 解析结果失败: {e}")
            return self._generate_fallback_result(original_segments)
    
    def _generate_fallback_result(
        self, 
        transcript_segments: List[Dict]
    ) -> AnalysisResult:
        """生成降级结果（LLM 不可用时）"""
        segments = []
        for i, seg in enumerate(transcript_segments):
            text = seg.get("text", "")
            
            # 简单规则识别废话
            filler_words = []
            is_filler = False
            for word in ["嗯", "啊", "那个", "就是", "对吧", "然后"]:
                if word in text:
                    filler_words.append(word)
            
            # 如果整句都是语气词
            if len(text) < 5 and filler_words:
                is_filler = True
            
            segments.append(AnalyzedSegment(
                id=f"seg_{i:03d}",
                start=round(seg.get("start", 0) / 1000, 3),  # 毫秒 -> 秒
                end=round(seg.get("end", 0) / 1000, 3),      # 毫秒 -> 秒
                text=text,
                action="delete" if is_filler else "keep",
                classification="filler" if is_filler else "matched",
                confidence=0.7 if is_filler else 0.9,
                filler_words=filler_words,
                asset_id=seg.get("_asset_id")  # 传递来源素材 ID
            ))
        
        keep_count = len([s for s in segments if s.action == "keep"])
        delete_count = len([s for s in segments if s.action == "delete"])
        
        # 计算保留时长
        kept_duration = sum(s.end - s.start for s in segments if s.action == "keep")
        total_duration = sum(s.end - s.start for s in segments)
        reduction_percent = ((total_duration - kept_duration) / total_duration * 100) if total_duration > 0 else 0.0
        
        return AnalysisResult(
            segments=segments,
            repeat_groups=[],
            style_analysis=None,
            summary=AnalysisSummary(
                total_segments=len(segments),
                keep_count=keep_count,
                delete_count=delete_count,
                choose_count=0,
                repeat_groups_count=0,
                estimated_duration_after=kept_duration,
                reduction_percent=reduction_percent
            )
        )


# ============================================
# 进度管理
# ============================================

async def update_analysis_progress(
    analysis_id: str,
    stage: ProcessingStage,
    message: Optional[str] = None
) -> None:
    """更新分析进度"""
    try:
        update_data = {
            "processing_stage": stage.value,
            "processing_progress": stage.progress,
            "processing_message": message or stage.message,
            "updated_at": datetime.utcnow().isoformat()
        }
        
        if stage == ProcessingStage.COMPLETED:
            update_data["status"] = "completed"
            update_data["completed_at"] = datetime.utcnow().isoformat()
        elif stage == ProcessingStage.FAILED:
            update_data["status"] = "failed"
        elif stage != ProcessingStage.PENDING:
            update_data["status"] = "processing"
        
        supabase.table("content_analyses").update(update_data).eq("id", analysis_id).execute()
        
        logger.info(f"📊 进度更新: {stage.value} ({stage.progress}%) - {message or stage.message}")
        
    except Exception as e:
        logger.error(f"❌ 更新进度失败: {e}")


async def get_analysis_progress(analysis_id: str, user_id: str = None) -> Optional[Dict]:
    """获取分析进度"""
    try:
        query = supabase.table("content_analyses").select(
            "id, processing_stage, processing_progress, processing_message, status"
        ).eq("id", analysis_id)
        
        # 如果提供了 user_id，添加权限过滤
        if user_id:
            query = query.eq("user_id", user_id)
        
        result = query.single().execute()
        
        if result.data:
            return {
                "id": result.data["id"],
                "stage": result.data["processing_stage"],
                "progress": result.data["processing_progress"],
                "message": result.data["processing_message"],
                "status": result.data["status"]
            }
        return None
    except Exception as e:
        logger.error(f"❌ 获取进度失败: {e}")
        return None


# ============================================
# 创建分析任务
# ============================================

async def create_content_analysis(
    project_id: str,
    user_id: str,
    script: Optional[str] = None
) -> str:
    """创建内容分析记录"""
    analysis_id = str(uuid4())
    
    data = {
        "id": analysis_id,
        "project_id": project_id,
        "user_id": user_id,
        "mode": "with_script" if script else "without_script",
        "status": "pending",
        "processing_stage": ProcessingStage.PENDING.value,
        "processing_progress": 0,
        "processing_message": ProcessingStage.PENDING.message,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    supabase.table("content_analyses").insert(data).execute()
    
    logger.info(f"✅ 创建分析任务: {analysis_id}")
    
    return analysis_id


async def save_analysis_result(
    analysis_id: str,
    result: AnalysisResult
) -> None:
    """保存分析结果"""
    try:
        update_data = {
            "segments": [seg.model_dump() for seg in result.segments],
            "repeat_groups": [g.model_dump() for g in result.repeat_groups],
            "style_analysis": result.style_analysis.model_dump() if result.style_analysis else None,
            "summary": result.summary.model_dump(),
            "status": "completed",
            "processing_stage": ProcessingStage.COMPLETED.value,
            "processing_progress": 100,
            "processing_message": ProcessingStage.COMPLETED.message,
            "completed_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        supabase.table("content_analyses").update(update_data).eq("id", analysis_id).execute()
        
        logger.info(f"✅ 保存分析结果: {analysis_id}")
        
    except Exception as e:
        logger.error(f"❌ 保存分析结果失败: {e}")
        raise


# 导出
smart_analyzer = SmartAnalyzer()

__all__ = [
    "SmartAnalyzer",
    "smart_analyzer",
    "ProcessingStage",
    "AnalysisResult",
    "AnalyzedSegment",
    "RepeatGroup",
    "StyleAnalysis",
    "AnalysisSummary",
    "update_analysis_progress",
    "get_analysis_progress",
    "create_content_analysis",
    "save_analysis_result",
    # 分类映射
    "normalize_classification",
    "CLASSIFICATION_MAP",
    "STANDARD_CLASSIFICATIONS",
]
