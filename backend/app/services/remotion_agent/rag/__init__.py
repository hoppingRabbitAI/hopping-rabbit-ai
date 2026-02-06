"""
Remotion Agent RAG 知识库模块

提供标杆视频片段的存储和检索功能
"""

from .schema import (
    BenchmarkSegment,
    BenchmarkSource,
    VisualConfigSnippet,
    ContentType,
    LayoutMode,
    BrollTriggerType,
    CanvasType,
    KeywordCardVariant,
    PipPosition,
    RAGQueryInput,
    RAGQueryResult,
    ValidationError,
    ValidationResult,
    BrollTrigger,
)
from .vectorstore import (
    RAGVectorStore,
    get_vector_store,
    init_with_seed_data,
)
from .retriever import (
    BenchmarkRetriever,
    get_retriever,
    format_fewshot_examples,
)
from .seed_data import (
    get_seed_data,
    get_seed_count,
)
from .pipeline import (
    RAGDataPipeline,
    VideoAnalysisConverter,
    get_pipeline,
    process_benchmark_video,
    process_benchmark_videos,
)


__all__ = [
    # Schema
    "BenchmarkSegment",
    "BenchmarkSource",
    "VisualConfigSnippet",
    "ContentType",
    "LayoutMode",
    "BrollTriggerType",
    "CanvasType",
    "KeywordCardVariant",
    "PipPosition",
    "RAGQueryInput",
    "RAGQueryResult",
    "ValidationError",
    "ValidationResult",
    "BrollTrigger",
    # Vector Store
    "RAGVectorStore",
    "get_vector_store",
    "init_with_seed_data",
    # Retriever
    "BenchmarkRetriever",
    "get_retriever",
    "format_fewshot_examples",
    # Seed Data
    "get_seed_data",
    "get_seed_count",
    # Pipeline
    "RAGDataPipeline",
    "VideoAnalysisConverter",
    "get_pipeline",
    "process_benchmark_video",
    "process_benchmark_videos",
]
