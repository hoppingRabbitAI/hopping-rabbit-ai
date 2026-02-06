"""
标杆视频 RAG 数据管道

完整的视频分析 → RAG 种子数据的自动化流程:
1. 视频分析 (benchmark_analyzer)
2. 分析结果持久化 (JSON)
3. 转换为 BenchmarkSegment
4. 写入向量库

使用方法:
    from app.services.remotion_agent.rag.pipeline import RAGDataPipeline
    
    pipeline = RAGDataPipeline()
    
    # 分析并导入单个视频
    await pipeline.process_video("/path/to/video.mp4", video_id="001")
    
    # 批量处理
    await pipeline.process_batch(["/path/001.mp4", "/path/002.mp4"])
    
    # 从已有分析结果导入
    pipeline.import_from_analysis("analysis_results.json")
"""

import json
import logging
import asyncio
import re
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime

from .schema import (
    BenchmarkSegment,
    BenchmarkSource,
    VisualConfigSnippet,
    ContentType,
    LayoutMode,
    BrollTriggerType,
    CanvasType,
    KeywordCardVariant,
)
from .vectorstore import RAGVectorStore

logger = logging.getLogger(__name__)

# 数据存储路径
DATA_DIR = Path(__file__).parent / "data"
ANALYSIS_FILE = DATA_DIR / "video_analysis.json"
SEGMENTS_FILE = DATA_DIR / "benchmark_segments.json"


class VideoAnalysisConverter:
    """
    视频分析结果 → BenchmarkSegment 转换器
    
    将 benchmark_analyzer 的输出转换为 RAG 可用的结构化数据
    """
    
    # 内容类型映射
    CONTENT_TYPE_MAP = {
        "hook": ContentType.OPENER,
        "开场": ContentType.OPENER,
        "引入": ContentType.PROBLEM_SETUP,
        "问题": ContentType.PROBLEM_SETUP,
        "概念": ContentType.CONCEPT,
        "解释": ContentType.CONCEPT,
        "定义": ContentType.CONCEPT,
        "例子": ContentType.EXAMPLE,
        "案例": ContentType.EXAMPLE,
        "比如": ContentType.EXAMPLE,
        "数据": ContentType.DATA,
        "数字": ContentType.DATA,
        "统计": ContentType.DATA,
        "对比": ContentType.COMPARISON,
        "比较": ContentType.COMPARISON,
        "vs": ContentType.COMPARISON,
        "引用": ContentType.QUOTE,
        "金句": ContentType.QUOTE,
        "名言": ContentType.QUOTE,
        "过渡": ContentType.TRANSITION,
        "总结": ContentType.SUMMARY,
        "结尾": ContentType.CTA,
        "行动": ContentType.CTA,
        "关注": ContentType.CTA,
    }
    
    # 模板类型映射 (统一使用 talking-head)
    TEMPLATE_MAP = {
        "mixed-media": "talking-head",
        "talking-head": "talking-head",
        "whiteboard": "whiteboard",
        "screencast": "screencast",
        "videographic": "videographic",
    }
    
    # 布局模式检测关键词
    LAYOUT_KEYWORDS = {
        LayoutMode.MODE_A: ["人物全屏", "口播为主", "talking head", "人物居中"],
        LayoutMode.MODE_B: ["素材全屏", "人物画中画", "产品展示", "演示为主"],
        LayoutMode.MODE_C: ["纯素材", "无人物", "白板", "PPT", "图文为主"],
        LayoutMode.MODE_D: ["灵活切换", "混合", "动态"],
    }
    
    def __init__(self):
        self.segment_counter = {}
    
    def _get_next_id(self, video_id: str, content_type: str) -> str:
        """生成唯一ID"""
        key = f"{video_id}-{content_type}"
        if key not in self.segment_counter:
            self.segment_counter[key] = 0
        self.segment_counter[key] += 1
        return f"{video_id}-{content_type}-{self.segment_counter[key]:02d}"
    
    def _detect_content_type(self, text: str, context: str = "") -> ContentType:
        """检测内容类型"""
        combined = f"{text} {context}".lower()
        
        # 按优先级检测
        if any(kw in combined for kw in ["数据", "数字", "%", "亿", "万", "增长", "下降"]):
            return ContentType.DATA
        if any(kw in combined for kw in ["比如", "例如", "举例", "案例"]):
            return ContentType.EXAMPLE
        if any(kw in combined for kw in ["对比", "相比", "vs", "比较", "相较"]):
            return ContentType.COMPARISON
        if any(kw in combined for kw in ["第一", "第二", "首先", "然后", "最后", "步骤"]):
            return ContentType.CONCEPT
        if any(kw in combined for kw in ["总结", "综上", "因此", "所以"]):
            return ContentType.SUMMARY
        if any(kw in combined for kw in ["关注", "点赞", "订阅", "留言"]):
            return ContentType.CTA
        
        # 默认
        return ContentType.CONCEPT
    
    def _detect_layout_mode(self, visual_style: Dict) -> LayoutMode:
        """检测布局模式"""
        main_visual = visual_style.get("main_visual", "").lower()
        broll_usage = visual_style.get("broll_usage", "").lower()
        
        for mode, keywords in self.LAYOUT_KEYWORDS.items():
            if any(kw.lower() in main_visual or kw.lower() in broll_usage for kw in keywords):
                return mode
        
        # 默认 MODE_A
        return LayoutMode.MODE_A
    
    def _detect_broll_trigger(self, text: str) -> Optional[BrollTriggerType]:
        """检测 B-Roll 触发类型"""
        # 数据引用
        if re.search(r'\d+[%％亿万]|\d+\.\d+', text):
            return BrollTriggerType.DATA_CITE
        
        # 举例
        if re.search(r'比如|例如|举例|举个例子', text):
            return BrollTriggerType.EXAMPLE_MENTION
        
        # 对比
        if re.search(r'相比|对比|比较|vs|相较|胜过', text):
            return BrollTriggerType.COMPARISON
        
        # 产品/品牌
        if re.search(r'iPhone|Android|Tesla|ChatGPT|GPT|OpenAI|Google|Apple|微软|阿里|腾讯|华为', text, re.IGNORECASE):
            return BrollTriggerType.PRODUCT_MENTION
        
        # 流程描述
        if re.search(r'首先|第一步|然后|接下来|最后|步骤', text):
            return BrollTriggerType.PROCESS_DESC
        
        # 概念可视化
        if re.search(r'是什么|概念|原理|本质|机制|是指', text):
            return BrollTriggerType.CONCEPT_VISUAL
        
        return None
    
    def _extract_keywords(self, text: str) -> List[str]:
        """提取关键词"""
        keywords = []
        
        # 提取数字
        numbers = re.findall(r'\d+[%％亿万美元]|\d+\.\d+', text)
        keywords.extend(numbers)
        
        # 提取引号内容
        quoted = re.findall(r'[「『"]([^」』"]+)[」』"]', text)
        keywords.extend(quoted)
        
        # 提取英文专有名词
        english = re.findall(r'[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*', text)
        keywords.extend(english[:3])
        
        return keywords[:5]  # 最多5个
    
    def _generate_reasoning(self, content_type: ContentType, has_broll: bool, 
                           broll_trigger: Optional[BrollTriggerType],
                           layout_mode: LayoutMode) -> str:
        """生成推理说明"""
        parts = []
        
        # 内容类型说明
        type_reasons = {
            ContentType.OPENER: "开场hook吸引注意力",
            ContentType.PROBLEM_SETUP: "问题引入激发好奇心",
            ContentType.CONCEPT: "概念解释清晰易懂",
            ContentType.EXAMPLE: "举例说明增强理解",
            ContentType.DATA: "数据展示增加可信度",
            ContentType.COMPARISON: "对比分析突出差异",
            ContentType.QUOTE: "引用金句增加说服力",
            ContentType.SUMMARY: "总结回顾加深印象",
            ContentType.CTA: "行动号召引导转化",
        }
        parts.append(type_reasons.get(content_type, ""))
        
        # B-Roll 说明
        if has_broll and broll_trigger:
            trigger_reasons = {
                BrollTriggerType.DATA_CITE: "数据引用触发B-Roll增强视觉冲击",
                BrollTriggerType.EXAMPLE_MENTION: "举例触发B-Roll具象化说明",
                BrollTriggerType.COMPARISON: "对比触发B-Roll直观展示差异",
                BrollTriggerType.PRODUCT_MENTION: "产品提及触发B-Roll展示实物",
                BrollTriggerType.PROCESS_DESC: "流程描述触发B-Roll可视化步骤",
                BrollTriggerType.CONCEPT_VISUAL: "抽象概念触发B-Roll可视化表达",
            }
            parts.append(trigger_reasons.get(broll_trigger, ""))
        
        # 布局说明
        layout_reasons = {
            LayoutMode.MODE_A: "人物全屏建立信任感",
            LayoutMode.MODE_B: "素材全屏突出内容主体",
            LayoutMode.MODE_C: "纯素材聚焦信息传递",
            LayoutMode.MODE_D: "灵活切换保持视觉新鲜感",
        }
        parts.append(layout_reasons.get(layout_mode, ""))
        
        return "。".join(filter(None, parts)) + "。"
    
    def convert(self, video_id: str, analysis: Dict) -> List[BenchmarkSegment]:
        """
        将单个视频的分析结果转换为 BenchmarkSegment 列表
        
        Args:
            video_id: 视频ID (如 "001")
            analysis: quick_analyze_video 的输出
            
        Returns:
            BenchmarkSegment 列表
        """
        segments = []
        
        # 基本信息
        template_type = analysis.get("template_type", "mixed-media")
        template_id = self.TEMPLATE_MAP.get(template_type, "talking-head")
        structure = analysis.get("structure", {})
        visual_style = analysis.get("visual_style", {})
        key_timestamps = analysis.get("key_timestamps", [])
        pacing = analysis.get("pacing", {})
        
        # 检测主布局模式
        main_layout = self._detect_layout_mode(visual_style)
        
        # 判断是否频繁使用 B-Roll
        broll_usage = visual_style.get("broll_usage", "")
        has_frequent_broll = any(kw in broll_usage for kw in ["频繁", "大量", "丰富", "多次"])
        
        # 视频标题（从结构推断）
        video_title = structure.get("hook", "")[:50] if structure.get("hook") else f"标杆视频{video_id}"
        
        # 1. 处理开场 Hook
        hook = structure.get("hook", "")
        if hook:
            content_type = ContentType.OPENER
            broll_trigger = self._detect_broll_trigger(hook)
            keywords = self._extract_keywords(hook)
            
            segments.append(BenchmarkSegment(
                id=self._get_next_id(video_id, "opener"),
                source=BenchmarkSource(
                    video_id=video_id,
                    video_title=video_title,
                    timestamp_start=0.0,
                    timestamp_end=10.0,
                ),
                input_text=hook,
                input_text_clean=" ".join(keywords) if keywords else hook[:50],
                content_type=content_type,
                template_id=template_id,
                broll_trigger_type=broll_trigger,
                broll_trigger_pattern=keywords[0] if keywords else None,
                visual_config=VisualConfigSnippet(
                    layout_mode=main_layout,
                    keyword_card={
                        "variant": KeywordCardVariant.DARK_SOLID.value,
                        "text": keywords[0] if keywords else "",
                        "position": "bottom-center",
                    } if keywords else None,
                    has_broll=broll_trigger is not None,
                    broll_description=broll_usage[:100] if broll_trigger else None,
                ),
                reasoning=self._generate_reasoning(content_type, broll_trigger is not None, broll_trigger, main_layout),
                quality_score=0.9,
                tags=["opener", "hook", video_id],
            ))
        
        # 2. 处理主要观点
        main_points = structure.get("main_points", [])
        for i, point in enumerate(main_points, 1):
            if not point or len(point) < 5:
                continue
                
            content_type = self._detect_content_type(point)
            broll_trigger = self._detect_broll_trigger(point)
            keywords = self._extract_keywords(point)
            
            # 时间估算
            start_time = 10.0 + (i - 1) * 20.0
            end_time = start_time + 20.0
            
            # 构建视觉配置
            visual_config = VisualConfigSnippet(
                layout_mode=main_layout,
                has_broll=broll_trigger is not None or has_frequent_broll,
            )
            
            # 根据内容类型添加画布
            if content_type == ContentType.DATA and keywords:
                visual_config.keyword_card = {
                    "variant": KeywordCardVariant.GRADIENT.value,
                    "text": keywords[0],
                    "position": "center",
                    "style": "data-highlight",
                }
            elif content_type == ContentType.COMPARISON:
                visual_config.canvas_type = CanvasType.COMPARISON
            elif "第" in point or "首先" in point:
                visual_config.canvas_type = CanvasType.POINT_LIST
            
            if broll_trigger:
                visual_config.broll_description = f"与'{keywords[0] if keywords else point[:20]}'相关的素材"
            
            segments.append(BenchmarkSegment(
                id=self._get_next_id(video_id, content_type.value),
                source=BenchmarkSource(
                    video_id=video_id,
                    video_title=video_title,
                    timestamp_start=start_time,
                    timestamp_end=end_time,
                ),
                input_text=point,
                input_text_clean=" ".join(keywords) if keywords else point[:50],
                content_type=content_type,
                template_id=template_id,
                broll_trigger_type=broll_trigger,
                broll_trigger_pattern=keywords[0] if keywords and broll_trigger else None,
                visual_config=visual_config,
                reasoning=self._generate_reasoning(content_type, visual_config.has_broll, broll_trigger, main_layout),
                quality_score=0.85,
                tags=[content_type.value, video_id, f"point-{i}"],
            ))
        
        # 3. 处理关键时间戳中的特殊片段
        for ts in key_timestamps:
            event = ts.get("event", "")
            time_str = ts.get("time", "00:00:00")
            
            if not event or len(event) < 10:
                continue
            
            # 跳过普通描述
            if any(kw in event for kw in ["开场", "结尾", "口播"]) and "B-Roll" not in event:
                continue
            
            content_type = self._detect_content_type(event)
            broll_trigger = self._detect_broll_trigger(event)
            
            # 特别处理 B-Roll 相关
            if "B-Roll" in event or "素材" in event or "画面" in event:
                visual_config = VisualConfigSnippet(
                    layout_mode=LayoutMode.MODE_B,
                    has_broll=True,
                    broll_description=event,
                    pip_config={
                        "type": "person",
                        "position": "bottom-right",
                        "size": "small",
                    },
                )
            else:
                visual_config = VisualConfigSnippet(
                    layout_mode=main_layout,
                    has_broll=broll_trigger is not None,
                )
            
            # 解析时间
            try:
                parts = time_str.split(":")
                start_time = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            except:
                start_time = 0.0
            
            segments.append(BenchmarkSegment(
                id=self._get_next_id(video_id, "event"),
                source=BenchmarkSource(
                    video_id=video_id,
                    video_title=video_title,
                    timestamp_start=float(start_time),
                    timestamp_end=float(start_time + 10),
                ),
                input_text=event,
                input_text_clean=event[:50],
                content_type=content_type,
                template_id=template_id,
                broll_trigger_type=broll_trigger or BrollTriggerType.CONCEPT_VISUAL,
                visual_config=visual_config,
                reasoning=f"关键时刻 {time_str}: {self._generate_reasoning(content_type, visual_config.has_broll, broll_trigger, visual_config.layout_mode)}",
                quality_score=0.8,
                tags=["timestamp", video_id, time_str.replace(":", "-")],
            ))
        
        # 4. 处理结尾 CTA
        ending = structure.get("ending", "")
        if ending:
            segments.append(BenchmarkSegment(
                id=self._get_next_id(video_id, "cta"),
                source=BenchmarkSource(
                    video_id=video_id,
                    video_title=video_title,
                    timestamp_start=0.0,  # 结尾时间不确定
                    timestamp_end=0.0,
                ),
                input_text=ending,
                input_text_clean=ending[:50],
                content_type=ContentType.CTA,
                template_id=template_id,
                visual_config=VisualConfigSnippet(
                    layout_mode=LayoutMode.MODE_A,
                    has_broll=False,
                ),
                reasoning="结尾行动号召，保持人物全屏增强亲和力和可信度。",
                quality_score=0.8,
                tags=["cta", "ending", video_id],
            ))
        
        logger.info(f"[Converter] 视频 {video_id} 转换完成: {len(segments)} 个片段")
        return segments


class RAGDataPipeline:
    """
    RAG 数据管道
    
    完整的视频分析 → RAG 种子数据的自动化流程
    """
    
    def __init__(self):
        self.converter = VideoAnalysisConverter()
        self.vectorstore = RAGVectorStore()
        
        # 确保数据目录存在
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        
        # 加载已有数据
        self.analysis_cache = self._load_analysis_cache()
        self.segments_cache = self._load_segments_cache()
    
    def _load_analysis_cache(self) -> Dict[str, Dict]:
        """加载分析缓存"""
        if ANALYSIS_FILE.exists():
            try:
                with open(ANALYSIS_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def _save_analysis_cache(self):
        """保存分析缓存"""
        with open(ANALYSIS_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.analysis_cache, f, ensure_ascii=False, indent=2)
    
    def _load_segments_cache(self) -> Dict[str, List[Dict]]:
        """加载片段缓存"""
        if SEGMENTS_FILE.exists():
            try:
                with open(SEGMENTS_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                return {}
        return {}
    
    def _save_segments_cache(self):
        """保存片段缓存"""
        # 转换为可序列化格式
        serializable = {}
        for video_id, segments in self.segments_cache.items():
            serializable[video_id] = [
                seg.model_dump() if hasattr(seg, 'model_dump') else seg 
                for seg in segments
            ]
        
        with open(SEGMENTS_FILE, 'w', encoding='utf-8') as f:
            json.dump(serializable, f, ensure_ascii=False, indent=2, default=str)
    
    async def analyze_video(self, video_path: str, video_id: Optional[str] = None, 
                           force: bool = False) -> Dict:
        """
        分析视频并缓存结果
        
        Args:
            video_path: 视频文件路径
            video_id: 视频ID (默认从文件名提取)
            force: 是否强制重新分析
            
        Returns:
            分析结果字典
        """
        from app.services.benchmark_analyzer import quick_analyze_video
        
        if video_id is None:
            video_id = Path(video_path).stem
        
        # 检查缓存
        if not force and video_id in self.analysis_cache:
            logger.info(f"[Pipeline] 使用缓存的分析结果: {video_id}")
            return self.analysis_cache[video_id]
        
        # 执行分析
        logger.info(f"[Pipeline] 开始分析视频: {video_path}")
        result = await quick_analyze_video(video_path)
        
        # 添加元数据
        result["_meta"] = {
            "video_id": video_id,
            "video_path": str(video_path),
            "analyzed_at": datetime.now().isoformat(),
        }
        
        # 缓存结果
        self.analysis_cache[video_id] = result
        self._save_analysis_cache()
        
        logger.info(f"[Pipeline] 分析完成并缓存: {video_id}")
        return result
    
    def convert_to_segments(self, video_id: str, analysis: Optional[Dict] = None) -> List[BenchmarkSegment]:
        """
        将分析结果转换为 BenchmarkSegment
        
        Args:
            video_id: 视频ID
            analysis: 分析结果 (默认从缓存读取)
            
        Returns:
            BenchmarkSegment 列表
        """
        if analysis is None:
            analysis = self.analysis_cache.get(video_id)
            if analysis is None:
                raise ValueError(f"找不到视频 {video_id} 的分析结果")
        
        segments = self.converter.convert(video_id, analysis)
        
        # 缓存片段
        self.segments_cache[video_id] = segments
        self._save_segments_cache()
        
        return segments
    
    def import_to_vectorstore(self, video_id: Optional[str] = None, clear: bool = False):
        """
        将片段导入向量库
        
        Args:
            video_id: 指定视频ID (None 表示全部)
            clear: 是否清空现有数据
        """
        if clear:
            logger.info("[Pipeline] 清空向量库...")
            self.vectorstore.clear()
        
        segments_to_import = []
        
        if video_id:
            if video_id in self.segments_cache:
                segments_to_import = self.segments_cache[video_id]
            else:
                raise ValueError(f"找不到视频 {video_id} 的片段数据")
        else:
            for segs in self.segments_cache.values():
                # 处理可能是 dict 的情况
                for seg in segs:
                    if isinstance(seg, dict):
                        segments_to_import.append(BenchmarkSegment(**seg))
                    else:
                        segments_to_import.append(seg)
        
        if not segments_to_import:
            logger.warning("[Pipeline] 没有片段可导入")
            return
        
        # 确保都是 BenchmarkSegment 对象
        for seg in segments_to_import:
            if isinstance(seg, dict):
                seg = BenchmarkSegment(**seg)
            self.vectorstore.add_segment(seg)
        
        logger.info(f"[Pipeline] 已导入 {len(segments_to_import)} 个片段到向量库")
    
    async def process_video(self, video_path: str, video_id: Optional[str] = None,
                           force: bool = False, import_to_vs: bool = True) -> List[BenchmarkSegment]:
        """
        完整处理单个视频: 分析 → 转换 → 导入
        
        Args:
            video_path: 视频文件路径
            video_id: 视频ID
            force: 是否强制重新分析
            import_to_vs: 是否导入向量库
            
        Returns:
            BenchmarkSegment 列表
        """
        if video_id is None:
            video_id = Path(video_path).stem
        
        # 1. 分析
        analysis = await self.analyze_video(video_path, video_id, force)
        
        # 2. 转换
        segments = self.convert_to_segments(video_id, analysis)
        
        # 3. 导入
        if import_to_vs:
            self.import_to_vectorstore(video_id)
        
        return segments
    
    async def process_batch(self, video_paths: List[str], force: bool = False,
                           clear_vs: bool = True) -> Dict[str, List[BenchmarkSegment]]:
        """
        批量处理多个视频
        
        Args:
            video_paths: 视频文件路径列表
            force: 是否强制重新分析
            clear_vs: 是否清空向量库后重新导入
            
        Returns:
            {video_id: segments} 字典
        """
        results = {}
        
        for video_path in video_paths:
            video_id = Path(video_path).stem
            try:
                segments = await self.process_video(
                    video_path, video_id, force, 
                    import_to_vs=False  # 批量处理时最后统一导入
                )
                results[video_id] = segments
                logger.info(f"[Pipeline] ✅ {video_id}: {len(segments)} 个片段")
            except Exception as e:
                logger.error(f"[Pipeline] ❌ {video_id} 处理失败: {e}")
                results[video_id] = []
        
        # 统一导入向量库
        self.import_to_vectorstore(clear=clear_vs)
        
        return results
    
    def get_stats(self) -> Dict:
        """获取统计信息"""
        total_segments = sum(len(segs) for segs in self.segments_cache.values())
        
        # 统计各类型数量
        type_counts = {}
        broll_count = 0
        
        for segs in self.segments_cache.values():
            for seg in segs:
                if isinstance(seg, dict):
                    ct = seg.get("content_type", "unknown")
                    has_broll = seg.get("visual_config", {}).get("has_broll", False)
                else:
                    ct = seg.content_type.value if hasattr(seg.content_type, 'value') else seg.content_type
                    has_broll = seg.visual_config.has_broll
                
                type_counts[ct] = type_counts.get(ct, 0) + 1
                if has_broll:
                    broll_count += 1
        
        return {
            "videos_analyzed": len(self.analysis_cache),
            "videos_converted": len(self.segments_cache),
            "total_segments": total_segments,
            "segments_with_broll": broll_count,
            "content_type_distribution": type_counts,
            "vectorstore_count": self.vectorstore.count() if hasattr(self.vectorstore, 'count') else "N/A",
        }


# 便捷函数
_pipeline_instance = None

def get_pipeline() -> RAGDataPipeline:
    """获取管道单例"""
    global _pipeline_instance
    if _pipeline_instance is None:
        _pipeline_instance = RAGDataPipeline()
    return _pipeline_instance


async def process_benchmark_video(video_path: str, video_id: Optional[str] = None) -> List[BenchmarkSegment]:
    """便捷函数: 处理单个标杆视频"""
    pipeline = get_pipeline()
    return await pipeline.process_video(video_path, video_id)


async def process_benchmark_videos(video_dir: str, pattern: str = "*.mp4") -> Dict[str, List[BenchmarkSegment]]:
    """便捷函数: 批量处理目录下的视频"""
    video_dir = Path(video_dir)
    video_paths = sorted(video_dir.glob(pattern))
    
    pipeline = get_pipeline()
    return await pipeline.process_batch([str(p) for p in video_paths])
