"""
HoppingRabbit AI - 音频分离任务
使用 Demucs 实现人声分离
支持：
- 人声/伴奏分离 (2 stems)
- 四轨分离 (drums, bass, vocals, other)
- 进度回调
"""
import os
import tempfile
import shutil
import logging
from typing import Optional
from uuid import uuid4
from datetime import datetime
import httpx

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================
# 模型配置
# ============================================

# 默认模型
DEFAULT_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs")

# 支持的模型
SUPPORTED_MODELS = {
    "htdemucs": {
        "stems": ["drums", "bass", "other", "vocals"],
        "description": "高质量四轨分离"
    },
    "htdemucs_ft": {
        "stems": ["drums", "bass", "other", "vocals"],
        "description": "微调版四轨分离"
    },
    "htdemucs_6s": {
        "stems": ["drums", "bass", "guitar", "piano", "other", "vocals"],
        "description": "六轨分离"
    },
    "mdx_extra": {
        "stems": ["drums", "bass", "other", "vocals"],
        "description": "MDX-Net 高质量"
    }
}

# 输出配置
OUTPUT_FORMAT = os.getenv("DEMUCS_OUTPUT_FORMAT", "wav")
OUTPUT_SAMPLE_RATE = int(os.getenv("DEMUCS_SAMPLE_RATE", "44100"))


# ============================================
# 核心分离函数
# ============================================

async def separate_stems(
    audio_url: str,
    model_name: str = DEFAULT_MODEL,
    stems: list[str] = None,
    on_progress: Optional[callable] = None
) -> dict:
    """
    分离音频轨道
    
    Args:
        audio_url: 音频文件 URL
        model_name: Demucs 模型名称
        stems: 需要的轨道列表，默认 ["vocals", "accompaniment"]
        on_progress: 进度回调函数 (progress: int, step: str)
    
    Returns:
        dict: 包含 stems 列表，每个包含 type, url, duration
    """
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    import torch
    import torchaudio
    
    # 默认分离人声和伴奏
    if stems is None:
        stems = ["vocals", "accompaniment"]
    
    # 1. 下载音频文件
    if on_progress:
        on_progress(5, "下载音频文件")
    
    audio_path = await download_audio(audio_url)
    
    # 创建输出目录
    output_dir = tempfile.mkdtemp()
    
    try:
        # 2. 加载模型
        if on_progress:
            on_progress(15, f"加载 {model_name} 模型")
        
        model = get_model(model_name)
        model.eval()
        
        # 移动到 GPU（如果可用）
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model.to(device)
        
        # 3. 加载音频
        if on_progress:
            on_progress(25, "加载音频")
        
        wav, sr = torchaudio.load(audio_path)
        
        # 重采样（如果需要）
        if sr != model.samplerate:
            wav = torchaudio.transforms.Resample(sr, model.samplerate)(wav)
        
        # 确保是立体声
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        elif wav.shape[0] > 2:
            wav = wav[:2]
        
        # 添加 batch 维度
        wav = wav.unsqueeze(0).to(device)
        
        # 4. 执行分离
        if on_progress:
            on_progress(35, "分离音轨中")
        
        with torch.no_grad():
            sources = apply_model(model, wav, progress=True)
        
        # sources shape: (batch, num_sources, channels, samples)
        sources = sources[0]  # 移除 batch 维度
        
        # 5. 保存输出
        if on_progress:
            on_progress(75, "保存音轨")
        
        result_stems = []
        source_names = model.sources
        
        for i, source_name in enumerate(source_names):
            # 检查是否需要这个轨道
            if source_name not in stems and f"stem_{source_name}" not in stems:
                # 检查 accompaniment 特殊处理
                if "accompaniment" in stems and source_name != "vocals":
                    continue
                continue
            
            source_audio = sources[i].cpu()
            output_path = os.path.join(output_dir, f"{source_name}.{OUTPUT_FORMAT}")
            
            torchaudio.save(
                output_path,
                source_audio,
                model.samplerate,
                format=OUTPUT_FORMAT
            )
            
            # 计算时长
            duration = source_audio.shape[-1] / model.samplerate
            
            result_stems.append({
                "type": source_name,
                "local_path": output_path,
                "duration": round(duration, 3),
                "sample_rate": model.samplerate
            })
        
        # 特殊处理：合成伴奏（除人声外的所有轨道）
        if "accompaniment" in stems:
            if on_progress:
                on_progress(85, "合成伴奏")
            
            # 找到 vocals 以外的所有轨道
            vocals_idx = source_names.index("vocals") if "vocals" in source_names else -1
            accompaniment = None
            
            for i, source_name in enumerate(source_names):
                if i != vocals_idx:
                    if accompaniment is None:
                        accompaniment = sources[i].cpu()
                    else:
                        accompaniment = accompaniment + sources[i].cpu()
            
            if accompaniment is not None:
                output_path = os.path.join(output_dir, f"accompaniment.{OUTPUT_FORMAT}")
                torchaudio.save(
                    output_path,
                    accompaniment,
                    model.samplerate,
                    format=OUTPUT_FORMAT
                )
                
                duration = accompaniment.shape[-1] / model.samplerate
                result_stems.append({
                    "type": "accompaniment",
                    "local_path": output_path,
                    "duration": round(duration, 3),
                    "sample_rate": model.samplerate
                })
        
        # 6. 上传到存储
        if on_progress:
            on_progress(90, "上传分离结果")
        
        # TODO: 上传到 Supabase Storage
        # 这里返回本地路径，实际部署时需要替换为存储 URL
        
        if on_progress:
            on_progress(100, "分离完成")
        
        return {
            "stems": result_stems,
            "model": model_name,
            "original_duration": wav.shape[-1] / model.samplerate
        }
        
    finally:
        # 清理临时文件
        if os.path.exists(audio_path):
            os.remove(audio_path)
        # 注意：output_dir 中的文件需要在上传后清理
        # shutil.rmtree(output_dir)


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
    
    @celery_app.task(bind=True, queue="gpu_high")
    def stem_separation_task(
        self,
        task_id: str,
        audio_url: str,
        model_name: str = DEFAULT_MODEL,
        stems: list[str] = None
    ):
        """Celery 音频分离任务"""
        import asyncio
        
        def on_progress(progress: int, step: str):
            update_task_progress(task_id, progress, step)
        
        try:
            update_task_status(task_id, "processing")
            
            result = asyncio.run(separate_stems(
                audio_url=audio_url,
                model_name=model_name,
                stems=stems,
                on_progress=on_progress
            ))
            
            update_task_status(task_id, "completed", result=result)
            return result
            
        except Exception as e:
            logger.error(f"音频分离任务失败: {e}")
            update_task_status(task_id, "failed", error=str(e))
            raise

except ImportError:
    logger.info("Celery 未配置，使用同步模式")


# ============================================
# 工具函数
# ============================================

def get_available_models() -> dict:
    """获取可用的模型列表"""
    return SUPPORTED_MODELS


def estimate_separation_time(duration_seconds: float, model_name: str = DEFAULT_MODEL) -> float:
    """估计分离时间（秒）"""
    # 大约 1:3 到 1:5 的比例（取决于模型和硬件）
    model_factors = {
        "htdemucs": 3.0,
        "htdemucs_ft": 3.5,
        "htdemucs_6s": 4.0,
        "mdx_extra": 2.5,
    }
    
    factor = model_factors.get(model_name, 3.0)
    return duration_seconds * factor
