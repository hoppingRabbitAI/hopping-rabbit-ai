"""
HoppingRabbit AI - 说话人分离任务
使用 pyannote.audio 实现说话人识别
支持：
- 自动检测说话人数量
- 指定说话人数量
- 与转写结果对齐
"""
import os
import tempfile
import logging
from typing import Optional
from datetime import datetime
import httpx

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================
# 配置
# ============================================

# HuggingFace Token（pyannote 模型需要认证）
HF_TOKEN = os.getenv("HF_TOKEN")

# 模型配置
DEFAULT_MODEL = "pyannote/speaker-diarization-3.1"

# 单例模型缓存
_pipeline_cache = {}


def get_pipeline():
    """获取或加载 pipeline（单例模式）"""
    global _pipeline_cache
    
    if DEFAULT_MODEL not in _pipeline_cache:
        try:
            from pyannote.audio import Pipeline
            
            if not HF_TOKEN:
                raise ValueError("需要设置 HF_TOKEN 环境变量以使用 pyannote 模型")
            
            logger.info(f"加载说话人分离模型: {DEFAULT_MODEL}")
            
            pipeline = Pipeline.from_pretrained(
                DEFAULT_MODEL,
                use_auth_token=HF_TOKEN
            )
            
            # 移动到 GPU（如果可用）
            import torch
            if torch.cuda.is_available():
                pipeline.to(torch.device("cuda"))
            
            _pipeline_cache[DEFAULT_MODEL] = pipeline
            logger.info("说话人分离模型加载完成")
            
        except Exception as e:
            logger.error(f"模型加载失败: {e}")
            raise
    
    return _pipeline_cache[DEFAULT_MODEL]


# ============================================
# 核心分离函数
# ============================================

async def diarize_audio(
    audio_url: str,
    num_speakers: int = None,
    min_speakers: int = 1,
    max_speakers: int = 10,
    on_progress: Optional[callable] = None
) -> dict:
    """
    说话人分离
    
    Args:
        audio_url: 音频文件 URL
        num_speakers: 指定说话人数量（None 为自动检测）
        min_speakers: 最小说话人数量
        max_speakers: 最大说话人数量
        on_progress: 进度回调函数
    
    Returns:
        dict: 包含 speakers 列表和检测到的说话人数量
    """
    
    # 1. 下载音频文件
    if on_progress:
        on_progress(5, "下载音频文件")
    
    audio_path = await download_audio(audio_url)
    
    try:
        # 2. 加载 pipeline
        if on_progress:
            on_progress(15, "加载说话人分离模型")
        
        pipeline = get_pipeline()
        
        # 3. 执行说话人分离
        if on_progress:
            on_progress(30, "分析说话人")
        
        # 构建参数
        diarization_params = {}
        if num_speakers is not None:
            diarization_params["num_speakers"] = num_speakers
        else:
            diarization_params["min_speakers"] = min_speakers
            diarization_params["max_speakers"] = max_speakers
        
        diarization = pipeline(audio_path, **diarization_params)
        
        # 4. 处理结果
        if on_progress:
            on_progress(80, "处理分离结果")
        
        speakers = {}
        
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            if speaker not in speakers:
                speakers[speaker] = {
                    "speaker_id": speaker,
                    "segments": [],
                    "total_speaking_time": 0
                }
            
            segment = {
                "start": round(turn.start, 3),
                "end": round(turn.end, 3)
            }
            
            speakers[speaker]["segments"].append(segment)
            speakers[speaker]["total_speaking_time"] += (turn.end - turn.start)
        
        # 转换为列表并排序
        speaker_list = list(speakers.values())
        for speaker in speaker_list:
            speaker["total_speaking_time"] = round(speaker["total_speaking_time"], 3)
            # 按时间排序片段
            speaker["segments"].sort(key=lambda x: x["start"])
        
        # 按说话时间排序（主要说话人在前）
        speaker_list.sort(key=lambda x: x["total_speaking_time"], reverse=True)
        
        # 重新编号说话人 ID
        for i, speaker in enumerate(speaker_list):
            speaker["speaker_id"] = f"SPEAKER_{i:02d}"
        
        if on_progress:
            on_progress(100, "说话人分离完成")
        
        return {
            "speakers": speaker_list,
            "num_speakers_detected": len(speaker_list)
        }
        
    finally:
        # 清理临时文件
        if os.path.exists(audio_path):
            os.remove(audio_path)


async def align_diarization_with_segments(
    diarization_result: dict,
    segments: list[dict]
) -> list[dict]:
    """
    将说话人分离结果与转写片段对齐
    
    Args:
        diarization_result: 说话人分离结果
        segments: 转写片段列表
    
    Returns:
        list: 更新了 speaker 字段的转写片段列表
    """
    speakers = diarization_result.get("speakers", [])
    
    # 构建时间轴索引
    timeline = []
    for speaker in speakers:
        speaker_id = speaker["speaker_id"]
        for seg in speaker["segments"]:
            timeline.append({
                "start": seg["start"],
                "end": seg["end"],
                "speaker": speaker_id
            })
    
    # 按开始时间排序
    timeline.sort(key=lambda x: x["start"])
    
    # 为每个转写片段分配说话人
    for segment in segments:
        seg_mid = (segment["start"] + segment["end"]) / 2
        
        # 找到包含该时间点的说话人片段
        assigned_speaker = None
        max_overlap = 0
        
        for turn in timeline:
            # 计算重叠
            overlap_start = max(segment["start"], turn["start"])
            overlap_end = min(segment["end"], turn["end"])
            overlap = max(0, overlap_end - overlap_start)
            
            if overlap > max_overlap:
                max_overlap = overlap
                assigned_speaker = turn["speaker"]
        
        segment["speaker"] = assigned_speaker
    
    return segments


async def download_audio(url: str) -> str:
    """下载音频文件到临时目录"""
    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        
        # 创建临时文件
        suffix = ".mp3" if "mp3" in url.lower() else ".wav"
        fd, path = tempfile.mkstemp(suffix=suffix)
        
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(response.content)
        except:
            os.close(fd)
            raise
        
        return path


# ============================================
# Celery 任务（可选）
# ============================================

try:
    from ..celery_config import celery_app, update_task_progress, update_task_status
    
    @celery_app.task(bind=True, queue="gpu_medium")
    def diarization_task(
        self,
        task_id: str,
        audio_url: str,
        num_speakers: int = None,
        min_speakers: int = 1,
        max_speakers: int = 10
    ):
        """Celery 说话人分离任务"""
        import asyncio
        
        def on_progress(progress: int, step: str):
            update_task_progress(task_id, progress, step)
        
        try:
            update_task_status(task_id, "processing")
            
            result = asyncio.run(diarize_audio(
                audio_url=audio_url,
                num_speakers=num_speakers,
                min_speakers=min_speakers,
                max_speakers=max_speakers,
                on_progress=on_progress
            ))
            
            update_task_status(task_id, "completed", result=result)
            return result
            
        except Exception as e:
            logger.error(f"说话人分离任务失败: {e}")
            update_task_status(task_id, "failed", error=str(e))
            raise

except ImportError:
    logger.info("Celery 未配置，使用同步模式")


# ============================================
# 工具函数
# ============================================

def estimate_diarization_time(duration_seconds: float) -> float:
    """估计分离时间（秒）"""
    # 大约 1:1 到 1:2 的比例
    return duration_seconds * 1.5
