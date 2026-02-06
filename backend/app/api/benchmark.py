"""
标杆视频分析 API 路由

提供视频拆解、结构分析、B-Roll 识别等接口
"""

import os
import shutil
import uuid
from typing import Optional, List
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel, Field

from app.services.benchmark_analyzer import (
    get_benchmark_analyzer, 
    quick_analyze_video,
    detailed_visual_analyze,
    full_benchmark_analyze,
    BenchmarkAnalysis
)

router = APIRouter(prefix="/benchmark", tags=["Benchmark Video Analysis"])

# 临时文件存储目录
TEMP_VIDEO_DIR = Path("/tmp/benchmark_videos")
TEMP_VIDEO_DIR.mkdir(parents=True, exist_ok=True)


# ============================================
# 请求/响应模型
# ============================================

class AnalyzeVideoRequest(BaseModel):
    """视频分析请求 (使用本地路径)"""
    video_path: str = Field(..., description="本地视频文件路径")
    video_id: Optional[str] = Field(None, description="视频ID (用于标识)")
    creator_name: Optional[str] = Field(None, description="创作者名称")
    fps: float = Field(0.5, description="采样帧率 (每秒抽取帧数)", ge=0.1, le=2.0)
    quick_mode: bool = Field(False, description="快速模式 (单次分析，成本更低)")


class QuickAnalyzeRequest(BaseModel):
    """快速分析请求"""
    video_path: str = Field(..., description="本地视频文件路径")


class SegmentInfo(BaseModel):
    """片段信息"""
    segment_id: int
    start_time: str
    end_time: str
    duration_seconds: int
    content_type: str
    spoken_text: Optional[str] = None
    key_points: List[str] = []
    main_visual: str
    has_broll: bool
    broll_description: Optional[str] = None


class BRollScene(BaseModel):
    """B-Roll 场景"""
    start_time: str
    end_time: str
    description: str
    related_speech: Optional[str] = None


class AnalysisResponse(BaseModel):
    """分析结果响应"""
    video_id: str
    video_path: str
    total_duration: str
    template_type: str
    overall_style: str
    target_audience: str
    structure_summary: str
    segments: List[dict]
    broll_percentage: float
    broll_scenes: List[dict]
    visual_element_stats: dict
    average_shot_duration: float
    total_cuts: int
    pacing_analysis: str


class BatchAnalyzeRequest(BaseModel):
    """批量分析请求"""
    video_paths: List[str] = Field(..., description="视频文件路径列表")
    fps: float = Field(0.5, description="采样帧率")
    quick_mode: bool = Field(True, description="使用快速模式")


class BatchAnalyzeResponse(BaseModel):
    """批量分析响应"""
    total: int
    success: int
    failed: int
    results: List[dict]
    errors: List[dict]


# ============================================
# API 端点
# ============================================

@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_video(request: AnalyzeVideoRequest):
    """
    完整分析一个标杆视频
    
    返回:
    - 视频整体风格和模版类型
    - 详细分段结构
    - B-Roll 出现时机和内容
    - 视觉元素统计
    - 剪辑节奏分析
    
    注意: 完整分析会进行3次 API 调用，成本较高。
    如果只需要概览，请使用 quick_mode=true 或 /quick-analyze 端点
    """
    # 验证文件存在
    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=404, 
            detail=f"视频文件不存在: {request.video_path}"
        )
    
    if request.quick_mode:
        # 快速模式
        result = await quick_analyze_video(request.video_path)
        # 转换为标准响应格式
        return AnalysisResponse(
            video_id=request.video_id or Path(request.video_path).stem,
            video_path=request.video_path,
            total_duration=result.get("total_duration", "00:00"),
            template_type=result.get("template_type", "unknown"),
            overall_style=result.get("visual_style", {}).get("main_visual", ""),
            target_audience="",
            structure_summary=str(result.get("structure", {})),
            segments=[],
            broll_percentage=0,
            broll_scenes=[],
            visual_element_stats={},
            average_shot_duration=result.get("pacing", {}).get("avg_shot_seconds", 0),
            total_cuts=0,
            pacing_analysis=result.get("pacing", {}).get("overall", "")
        )
    
    # 完整分析
    analyzer = get_benchmark_analyzer()
    
    try:
        analysis = await analyzer.analyze_benchmark_video(
            video_path=request.video_path,
            video_id=request.video_id,
            creator_name=request.creator_name,
            fps=request.fps
        )
        
        return AnalysisResponse(
            video_id=analysis.video_id,
            video_path=analysis.video_path,
            total_duration=analysis.total_duration,
            template_type=analysis.template_type,
            overall_style=analysis.overall_style,
            target_audience=analysis.target_audience,
            structure_summary=analysis.structure_summary,
            segments=analysis.segments,
            broll_percentage=analysis.broll_percentage,
            broll_scenes=analysis.broll_scenes,
            visual_element_stats=analysis.visual_element_stats,
            average_shot_duration=analysis.average_shot_duration,
            total_cuts=analysis.total_cuts,
            pacing_analysis=analysis.pacing_analysis
        )
    
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.post("/quick-analyze")
async def quick_analyze(request: QuickAnalyzeRequest):
    """
    快速分析视频 (单次 API 调用)
    
    返回视频概况，包括:
    - 模版类型
    - 结构概述
    - 视觉风格
    - 节奏分析
    - 关键时间戳
    
    成本较低，适合快速了解视频
    """
    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=404,
            detail=f"视频文件不存在: {request.video_path}"
        )
    
    try:
        result = await quick_analyze_video(request.video_path)
        return {
            "status": "success",
            "video_path": request.video_path,
            "analysis": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.post("/detailed-visual-analyze")
async def detailed_visual_analysis(request: QuickAnalyzeRequest):
    """
    精细视觉样式分析
    
    返回详细的画面布局信息，包括:
    - 人物位置和占比 (全屏/左下/右下/画中画)
    - 字幕样式和位置
    - 关键词卡片样式
    - B-Roll 插入方式
    - 分段视觉详情
    - 整体视觉风格
    
    适合深度分析视频视觉模版
    """
    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=404,
            detail=f"视频文件不存在: {request.video_path}"
        )
    
    try:
        result = await detailed_visual_analyze(request.video_path)
        return {
            "status": "success",
            "video_path": request.video_path,
            "visual_analysis": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.post("/full-analyze")
async def full_analysis(request: QuickAnalyzeRequest):
    """
    综合分析 - 一次调用获取全部信息 ⭐推荐使用
    
    合并内容分析和视觉分析，只需上传一次视频，返回:
    
    1. content_analysis (内容结构):
       - 视频时长和模版类型
       - 开场/要点/结尾结构
       - B-Roll 时间线（触发时机、内容、类型）
       - 节奏分析
    
    2. visual_analysis (视觉样式):
       - 人物位置和占比 (全屏70%/画中画30%等)
       - 字幕样式和位置
       - 关键词卡片样式
       - B-Roll 插入方式 (画中画/全屏替换)
       - 分段视觉详情
    
    一次调用完成完整分析，适合标杆视频深度拆解
    """
    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=404,
            detail=f"视频文件不存在: {request.video_path}"
        )
    
    try:
        result = await full_benchmark_analyze(request.video_path)
        return {
            "status": "success",
            **result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.post("/upload-and-analyze")
async def upload_and_analyze(
    video: UploadFile = File(..., description="上传的视频文件"),
    video_id: Optional[str] = Form(None, description="视频ID"),
    quick_mode: bool = Form(True, description="快速模式"),
    fps: float = Form(0.5, description="采样帧率"),
    background_tasks: BackgroundTasks = None
):
    """
    上传视频并分析
    
    支持通过文件上传的方式分析视频
    分析完成后会自动清理临时文件
    """
    # 检查文件类型
    if not video.content_type or not video.content_type.startswith("video/"):
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {video.content_type}"
        )
    
    # 保存到临时目录
    temp_id = str(uuid.uuid4())
    suffix = Path(video.filename).suffix if video.filename else ".mp4"
    temp_path = TEMP_VIDEO_DIR / f"{temp_id}{suffix}"
    
    try:
        # 保存上传的文件
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(video.file, f)
        
        # 执行分析
        if quick_mode:
            result = await quick_analyze_video(str(temp_path))
            return {
                "status": "success",
                "video_id": video_id or temp_id,
                "filename": video.filename,
                "analysis": result
            }
        else:
            analyzer = get_benchmark_analyzer()
            analysis = await analyzer.analyze_benchmark_video(
                video_path=str(temp_path),
                video_id=video_id or temp_id,
                fps=fps
            )
            return {
                "status": "success",
                "video_id": analysis.video_id,
                "filename": video.filename,
                "analysis": {
                    "total_duration": analysis.total_duration,
                    "template_type": analysis.template_type,
                    "overall_style": analysis.overall_style,
                    "structure_summary": analysis.structure_summary,
                    "segments": analysis.segments,
                    "broll_percentage": analysis.broll_percentage,
                    "broll_scenes": analysis.broll_scenes,
                    "visual_element_stats": analysis.visual_element_stats,
                    "pacing_analysis": analysis.pacing_analysis
                }
            }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")
    
    finally:
        # 清理临时文件
        if temp_path.exists():
            temp_path.unlink()


@router.post("/batch-analyze", response_model=BatchAnalyzeResponse)
async def batch_analyze(request: BatchAnalyzeRequest):
    """
    批量分析多个视频
    
    适用于一次性分析多个标杆视频，构建知识库
    建议使用 quick_mode=true 降低成本
    """
    results = []
    errors = []
    success_count = 0
    
    for video_path in request.video_paths:
        try:
            if not os.path.exists(video_path):
                errors.append({
                    "video_path": video_path,
                    "error": "文件不存在"
                })
                continue
            
            if request.quick_mode:
                result = await quick_analyze_video(video_path)
            else:
                analyzer = get_benchmark_analyzer()
                analysis = await analyzer.analyze_benchmark_video(
                    video_path=video_path,
                    fps=request.fps
                )
                result = {
                    "video_id": analysis.video_id,
                    "template_type": analysis.template_type,
                    "structure_summary": analysis.structure_summary,
                    "broll_percentage": analysis.broll_percentage,
                    "total_cuts": analysis.total_cuts
                }
            
            results.append({
                "video_path": video_path,
                "analysis": result
            })
            success_count += 1
            
        except Exception as e:
            errors.append({
                "video_path": video_path,
                "error": str(e)
            })
    
    return BatchAnalyzeResponse(
        total=len(request.video_paths),
        success=success_count,
        failed=len(errors),
        results=results,
        errors=errors
    )


@router.get("/supported-formats")
async def get_supported_formats():
    """获取支持的视频格式"""
    return {
        "supported_formats": ["mp4", "mov", "avi", "mkv", "webm"],
        "recommended_format": "mp4",
        "max_duration_seconds": 600,  # 建议10分钟以内
        "max_file_size_mb": 500,
        "recommended_fps": 0.5,
        "notes": [
            "建议使用 MP4 格式，H.264 编码",
            "视频时长建议在10分钟以内，以获得最佳分析效果",
            "fps 参数控制采样密度，0.5 表示每2秒抽取1帧",
            "较长视频建议降低 fps 以减少 API 成本"
        ]
    }


@router.get("/analysis-types")
async def get_analysis_types():
    """获取分析类型说明"""
    return {
        "template_types": {
            "mixed-media": "混合媒体 - 口播 + B-Roll + 图形结合",
            "talking-head": "口播主导 - 以人物口播为主",
            "whiteboard": "白板讲解 - 手绘或白板动画",
            "screencast": "屏幕录制 - 软件操作演示",
            "videographic": "数据可视化 - 以数据图表为主",
            "slideshow": "幻灯片 - PPT/Keynote 风格"
        },
        "content_types": {
            "hook": "开场钩子 - 吸引注意力",
            "point": "核心要点 - 主要论点",
            "data": "数据展示 - 数字/统计",
            "story": "故事案例 - 案例分享",
            "comparison": "对比分析 - A vs B",
            "concept": "概念解释 - 定义说明",
            "transition": "过渡 - 承上启下",
            "summary": "总结 - 要点回顾",
            "cta": "行动号召 - 引导行动"
        },
        "visual_elements": {
            "talking_head": "口播画面",
            "broll": "B-Roll 素材",
            "screen_record": "屏幕录制",
            "data_chart": "数据图表",
            "keyword_card": "关键词卡片",
            "process_flow": "流程图",
            "comparison": "对比表格",
            "quote_block": "引用块",
            "title_card": "标题卡",
            "lower_third": "下方字幕条",
            "animation": "动画",
            "image": "静态图片"
        }
    }
