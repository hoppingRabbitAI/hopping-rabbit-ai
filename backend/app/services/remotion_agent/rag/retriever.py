"""
RAG 检索接口

提供标杆片段检索功能，用于 Few-shot 提示构建
"""

from typing import Optional, List
from .schema import (
    BenchmarkSegment,
    RAGQueryResult,
    ContentType,
    BrollTriggerType,
)
from .vectorstore import get_vector_store


class BenchmarkRetriever:
    """标杆片段检索器"""
    
    def __init__(self):
        self.store = get_vector_store()
    
    def search(
        self,
        query_text: str,
        template_id: Optional[str] = None,
        content_type: Optional[ContentType] = None,
        broll_trigger_type: Optional[BrollTriggerType] = None,
        top_k: int = 3
    ) -> RAGQueryResult:
        """
        搜索相似的标杆片段
        
        Args:
            query_text: 查询文本 (通常是口播内容)
            template_id: 模版ID过滤
            content_type: 内容类型过滤
            broll_trigger_type: B-Roll触发类型过滤
            top_k: 返回结果数量
            
        Returns:
            RAGQueryResult 包含匹配的片段和相似度分数
        """
        content_type_str = content_type.value if content_type else None
        trigger_type_str = broll_trigger_type.value if broll_trigger_type else None
        
        return self.store.search(
            query_text=query_text,
            top_k=top_k,
            template_id=template_id,
            content_type=content_type_str,
            broll_trigger_type=trigger_type_str
        )
    
    def search_for_fewshot(
        self,
        query_text: str,
        template_id: str,
        content_type: Optional[ContentType] = None,
        top_k: int = 2
    ) -> List[dict]:
        """
        搜索用于构建 Few-shot prompt 的示例
        
        返回格式化的示例，可直接用于 LLM prompt
        """
        result = self.search(
            query_text=query_text,
            template_id=template_id,
            content_type=content_type,
            top_k=top_k
        )
        
        examples = []
        for segment, score in zip(result.segments, result.scores):
            example = {
                "input": segment.input_text,
                "content_type": segment.content_type,
                "layout_mode": segment.visual_config.layout_mode,
                "has_broll": segment.visual_config.has_broll,
                "reasoning": segment.reasoning,
                "similarity_score": score
            }
            
            # 添加画布配置
            if segment.visual_config.canvas_type:
                example["canvas_type"] = segment.visual_config.canvas_type
                example["canvas_config"] = segment.visual_config.canvas_config
            
            # 添加关键词卡片
            if segment.visual_config.keyword_card:
                example["keyword_card"] = segment.visual_config.keyword_card
            
            # 添加 B-Roll 信息
            if segment.visual_config.has_broll:
                example["broll_description"] = segment.visual_config.broll_description
                example["broll_trigger_type"] = segment.broll_trigger_type
            
            # 添加 PiP 配置
            if segment.visual_config.pip_config:
                example["pip_config"] = segment.visual_config.pip_config
            
            examples.append(example)
        
        return examples
    
    def get_examples_by_content_type(
        self,
        content_type: ContentType,
        top_k: int = 3
    ) -> List[BenchmarkSegment]:
        """按内容类型获取示例"""
        result = self.store.search(
            query_text=f"{content_type.value} 示例",
            content_type=content_type.value,
            top_k=top_k
        )
        return result.segments
    
    def get_examples_by_trigger(
        self,
        trigger_type: BrollTriggerType,
        top_k: int = 3
    ) -> List[BenchmarkSegment]:
        """按 B-Roll 触发类型获取示例"""
        result = self.store.search(
            query_text=f"{trigger_type.value} B-Roll 触发",
            broll_trigger_type=trigger_type.value,
            top_k=top_k
        )
        return result.segments


def format_fewshot_examples(examples: List[dict]) -> str:
    """
    格式化 Few-shot 示例为 prompt 字符串
    
    用于插入到 LLM prompt 中
    """
    if not examples:
        return "暂无相关示例。"
    
    formatted = []
    for i, ex in enumerate(examples, 1):
        lines = [
            f"### 示例 {i}",
            f"**输入文本**: {ex['input']}",
            f"**内容类型**: {ex['content_type']}",
            f"**布局模式**: {ex['layout_mode']}",
        ]
        
        if ex.get("canvas_type"):
            lines.append(f"**画布类型**: {ex['canvas_type']}")
        
        if ex.get("keyword_card"):
            card = ex['keyword_card']
            lines.append(f"**关键词卡片**: 变体={card.get('variant')}, 文字=\"{card.get('text')}\"")
        
        if ex.get("has_broll"):
            lines.append(f"**B-Roll**: 是, 触发类型={ex.get('broll_trigger_type')}")
            lines.append(f"**B-Roll描述**: {ex.get('broll_description', 'N/A')}")
        
        if ex.get("pip_config"):
            pip = ex['pip_config']
            lines.append(f"**画中画**: 类型={pip.get('type')}, 位置={pip.get('position')}")
        
        lines.append(f"**推理**: {ex['reasoning']}")
        lines.append("")
        
        formatted.append("\n".join(lines))
    
    return "\n".join(formatted)


# 全局检索器实例
_retriever: Optional[BenchmarkRetriever] = None


def get_retriever() -> BenchmarkRetriever:
    """获取检索器单例"""
    global _retriever
    if _retriever is None:
        _retriever = BenchmarkRetriever()
    return _retriever
