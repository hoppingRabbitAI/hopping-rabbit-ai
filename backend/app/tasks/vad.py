"""
HoppingRabbit AI - 语音活动检测 (VAD)
自动识别视频中的静音片段
"""
import os
import subprocess
import tempfile
import json
import logging
import numpy as np
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class SilenceSegment:
    """静音片段"""
    start: float  # 开始时间 (秒)
    end: float    # 结束时间 (秒)
    duration: float  # 持续时间
    
    def to_dict(self) -> dict:
        return {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "duration": round(self.duration, 3),
            "type": "silence"
        }


@dataclass
class SpeechSegment:
    """语音片段"""
    start: float
    end: float
    duration: float
    
    def to_dict(self) -> dict:
        return {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "duration": round(self.duration, 3),
            "type": "speech"
        }


# ============================================
# VAD 检测实现
# ============================================

class VADDetector:
    """
    语音活动检测器
    
    支持多种检测方法:
    1. 基于能量阈值 (简单快速)
    2. 基于 WebRTC VAD (精度较高)
    3. 基于 Silero VAD (深度学习，最准确)
    """
    
    def __init__(
        self,
        method: str = "energy",
        silence_threshold_db: float = -35,
        min_silence_duration: float = 0.5,
        min_speech_duration: float = 0.3,
        padding: float = 0.1,
        sample_rate: int = 16000
    ):
        """
        Args:
            method: 检测方法 ("energy", "webrtc", "silero")
            silence_threshold_db: 静音阈值 (dB)
            min_silence_duration: 最小静音时长 (秒)
            min_speech_duration: 最小语音时长 (秒)
            padding: 静音片段首尾保护区间 (秒)
            sample_rate: 采样率
        """
        self.method = method
        self.silence_threshold_db = silence_threshold_db
        self.min_silence_duration = min_silence_duration
        self.min_speech_duration = min_speech_duration
        self.padding = padding
        self.sample_rate = sample_rate
        
        self._silero_model = None
        self._webrtc_vad = None
    
    def detect(self, audio_path: str) -> Dict:
        """
        检测音频中的静音和语音片段
        
        Returns:
            {
                "silences": [...],
                "speeches": [...],
                "total_duration": float,
                "silence_ratio": float,
                "stats": {...}
            }
        """
        if self.method == "silero":
            return self._detect_silero(audio_path)
        elif self.method == "webrtc":
            return self._detect_webrtc(audio_path)
        else:
            return self._detect_energy(audio_path)
    
    def _detect_energy(self, audio_path: str) -> Dict:
        """基于能量阈值的静音检测"""
        import soundfile as sf
        
        # 读取音频
        audio, sr = sf.read(audio_path)
        
        # 转为单声道
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)
        
        # 重采样到目标采样率
        if sr != self.sample_rate:
            from scipy import signal
            audio = signal.resample(
                audio, 
                int(len(audio) * self.sample_rate / sr)
            )
            sr = self.sample_rate
        
        total_duration = len(audio) / sr
        
        # 计算帧能量 (20ms 帧)
        frame_length = int(sr * 0.02)
        hop_length = int(sr * 0.01)
        
        frames = []
        for i in range(0, len(audio) - frame_length, hop_length):
            frame = audio[i:i + frame_length]
            # 计算 RMS 能量
            rms = np.sqrt(np.mean(frame ** 2))
            # 转换为 dB
            db = 20 * np.log10(rms + 1e-10)
            frames.append(db)
        
        frames = np.array(frames)
        
        # 判断每帧是否为静音
        is_silence = frames < self.silence_threshold_db
        
        # 合并相邻的静音/语音帧
        silences = []
        speeches = []
        
        current_type = "silence" if is_silence[0] else "speech"
        current_start = 0
        
        for i, silent in enumerate(is_silence):
            frame_time = i * hop_length / sr
            frame_type = "silence" if silent else "speech"
            
            if frame_type != current_type:
                # 状态切换
                duration = frame_time - current_start
                
                if current_type == "silence":
                    if duration >= self.min_silence_duration:
                        silences.append(SilenceSegment(
                            start=current_start + self.padding,
                            end=frame_time - self.padding,
                            duration=duration - 2 * self.padding
                        ))
                else:
                    if duration >= self.min_speech_duration:
                        speeches.append(SpeechSegment(
                            start=current_start,
                            end=frame_time,
                            duration=duration
                        ))
                
                current_type = frame_type
                current_start = frame_time
        
        # 处理最后一段
        final_time = len(audio) / sr
        duration = final_time - current_start
        
        if current_type == "silence" and duration >= self.min_silence_duration:
            silences.append(SilenceSegment(
                start=current_start + self.padding,
                end=final_time - self.padding,
                duration=duration - 2 * self.padding
            ))
        elif current_type == "speech" and duration >= self.min_speech_duration:
            speeches.append(SpeechSegment(
                start=current_start,
                end=final_time,
                duration=duration
            ))
        
        # 过滤无效片段
        silences = [s for s in silences if s.duration > 0]
        
        total_silence = sum(s.duration for s in silences)
        
        return {
            "silences": [s.to_dict() for s in silences],
            "speeches": [s.to_dict() for s in speeches],
            "total_duration": round(total_duration, 3),
            "silence_ratio": round(total_silence / total_duration, 3) if total_duration > 0 else 0,
            "stats": {
                "silence_count": len(silences),
                "speech_count": len(speeches),
                "total_silence_duration": round(total_silence, 3),
                "avg_silence_duration": round(total_silence / len(silences), 3) if silences else 0,
                "threshold_db": self.silence_threshold_db,
                "method": "energy"
            }
        }
    
    def _detect_silero(self, audio_path: str) -> Dict:
        """基于 Silero VAD 的检测 (最准确)"""
        import torch
        import soundfile as sf
        
        # 加载模型 (懒加载)
        if self._silero_model is None:
            self._silero_model, utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                trust_repo=True
            )
            self._get_speech_timestamps = utils[0]
        
        # 读取音频
        audio, sr = sf.read(audio_path)
        
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)
        
        # Silero 需要 16kHz
        if sr != 16000:
            from scipy import signal
            audio = signal.resample(audio, int(len(audio) * 16000 / sr))
            sr = 16000
        
        total_duration = len(audio) / sr
        
        # 转换为 tensor
        audio_tensor = torch.from_numpy(audio).float()
        
        # 获取语音时间戳
        speech_timestamps = self._get_speech_timestamps(
            audio_tensor,
            self._silero_model,
            sampling_rate=sr,
            min_silence_duration_ms=int(self.min_silence_duration * 1000),
            min_speech_duration_ms=int(self.min_speech_duration * 1000),
            threshold=0.5
        )
        
        # 转换为片段
        speeches = []
        silences = []
        
        prev_end = 0
        for ts in speech_timestamps:
            start = ts['start'] / sr
            end = ts['end'] / sr
            
            # 添加语音片段
            speeches.append(SpeechSegment(
                start=start,
                end=end,
                duration=end - start
            ))
            
            # 添加静音片段 (前一段语音结束到当前语音开始)
            if start - prev_end >= self.min_silence_duration:
                silences.append(SilenceSegment(
                    start=prev_end + self.padding,
                    end=start - self.padding,
                    duration=start - prev_end - 2 * self.padding
                ))
            
            prev_end = end
        
        # 最后一段静音
        if total_duration - prev_end >= self.min_silence_duration:
            silences.append(SilenceSegment(
                start=prev_end + self.padding,
                end=total_duration - self.padding,
                duration=total_duration - prev_end - 2 * self.padding
            ))
        
        silences = [s for s in silences if s.duration > 0]
        total_silence = sum(s.duration for s in silences)
        
        return {
            "silences": [s.to_dict() for s in silences],
            "speeches": [s.to_dict() for s in speeches],
            "total_duration": round(total_duration, 3),
            "silence_ratio": round(total_silence / total_duration, 3) if total_duration > 0 else 0,
            "stats": {
                "silence_count": len(silences),
                "speech_count": len(speeches),
                "total_silence_duration": round(total_silence, 3),
                "method": "silero"
            }
        }
    
    def _detect_webrtc(self, audio_path: str) -> Dict:
        """基于 WebRTC VAD 的检测"""
        import webrtcvad
        import soundfile as sf
        
        # 读取音频
        audio, sr = sf.read(audio_path)
        
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)
        
        # WebRTC VAD 只支持 8000, 16000, 32000, 48000 Hz
        target_sr = 16000
        if sr != target_sr:
            from scipy import signal
            audio = signal.resample(audio, int(len(audio) * target_sr / sr))
            sr = target_sr
        
        total_duration = len(audio) / sr
        
        # 转换为 16-bit PCM
        audio_int16 = (audio * 32767).astype(np.int16)
        
        # 创建 VAD
        vad = webrtcvad.Vad()
        vad.set_mode(2)  # 0-3, 3 最激进
        
        # 30ms 帧
        frame_duration = 30  # ms
        frame_size = int(sr * frame_duration / 1000)
        
        speech_frames = []
        for i in range(0, len(audio_int16) - frame_size, frame_size):
            frame = audio_int16[i:i + frame_size].tobytes()
            is_speech = vad.is_speech(frame, sr)
            speech_frames.append(is_speech)
        
        # 合并片段
        silences = []
        speeches = []
        
        current_type = "speech" if speech_frames[0] else "silence"
        current_start = 0
        
        for i, is_speech in enumerate(speech_frames):
            frame_time = i * frame_duration / 1000
            frame_type = "speech" if is_speech else "silence"
            
            if frame_type != current_type:
                duration = frame_time - current_start
                
                if current_type == "silence":
                    if duration >= self.min_silence_duration:
                        silences.append(SilenceSegment(
                            start=current_start + self.padding,
                            end=frame_time - self.padding,
                            duration=duration - 2 * self.padding
                        ))
                else:
                    if duration >= self.min_speech_duration:
                        speeches.append(SpeechSegment(
                            start=current_start,
                            end=frame_time,
                            duration=duration
                        ))
                
                current_type = frame_type
                current_start = frame_time
        
        silences = [s for s in silences if s.duration > 0]
        total_silence = sum(s.duration for s in silences)
        
        return {
            "silences": [s.to_dict() for s in silences],
            "speeches": [s.to_dict() for s in speeches],
            "total_duration": round(total_duration, 3),
            "silence_ratio": round(total_silence / total_duration, 3) if total_duration > 0 else 0,
            "stats": {
                "silence_count": len(silences),
                "speech_count": len(speeches),
                "total_silence_duration": round(total_silence, 3),
                "method": "webrtc"
            }
        }


# ============================================
# FFmpeg 方式检测 (无依赖)
# ============================================

def detect_silence_ffmpeg(
    audio_path: str,
    silence_threshold_db: float = -35,
    min_silence_duration: float = 0.5
) -> Dict:
    """
    使用 FFmpeg silencedetect 滤镜检测静音
    无需额外 Python 依赖
    """
    cmd = [
        "ffmpeg", "-i", audio_path,
        "-af", f"silencedetect=noise={silence_threshold_db}dB:d={min_silence_duration}",
        "-f", "null", "-"
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    stderr = result.stderr
    
    silences = []
    current_start = None
    
    for line in stderr.split('\n'):
        if 'silence_start' in line:
            try:
                current_start = float(line.split('silence_start:')[1].strip())
            except:
                pass
        elif 'silence_end' in line and current_start is not None:
            try:
                parts = line.split('silence_end:')[1].strip().split('|')
                end = float(parts[0].strip())
                duration = float(parts[1].split(':')[1].strip()) if len(parts) > 1 else end - current_start
                
                silences.append({
                    "start": round(current_start, 3),
                    "end": round(end, 3),
                    "duration": round(duration, 3),
                    "type": "silence"
                })
                current_start = None
            except:
                pass
    
    # 获取总时长
    probe_cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", audio_path
    ]
    probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
    try:
        total_duration = float(json.loads(probe_result.stdout)["format"]["duration"])
    except:
        total_duration = silences[-1]["end"] if silences else 0
    
    total_silence = sum(s["duration"] for s in silences)
    
    return {
        "silences": silences,
        "total_duration": round(total_duration, 3),
        "silence_ratio": round(total_silence / total_duration, 3) if total_duration > 0 else 0,
        "stats": {
            "silence_count": len(silences),
            "total_silence_duration": round(total_silence, 3),
            "threshold_db": silence_threshold_db,
            "method": "ffmpeg"
        }
    }


# ============================================
# Celery 任务
# ============================================

try:
    from ..celery_config import celery_app, update_task_progress, update_task_status
    
    @celery_app.task(bind=True, queue="cpu_high")
    def detect_silence_task(
        self,
        task_id: str,
        project_id: str,
        audio_url: str,
        method: str = "energy",
        silence_threshold_db: float = -35,
        min_silence_duration: float = 0.5,
        min_speech_duration: float = 0.3,
        padding: float = 0.1
    ):
        """Celery 静音检测任务"""
        import asyncio
        import httpx
        from ..services.supabase_client import supabase
        
        try:
            update_task_status(task_id, "processing")
            update_task_progress(task_id, 10, "下载音频")
            
            with tempfile.TemporaryDirectory() as tmpdir:
                audio_path = os.path.join(tmpdir, "audio.wav")
                
                # 下载音频
                async def download():
                    async with httpx.AsyncClient(timeout=300) as client:
                        response = await client.get(audio_url, follow_redirects=True)
                        response.raise_for_status()
                        with open(audio_path, "wb") as f:
                            f.write(response.content)
                
                asyncio.run(download())
                
                update_task_progress(task_id, 30, "检测静音片段")
                
                # 执行检测
                if method == "ffmpeg":
                    result = detect_silence_ffmpeg(
                        audio_path,
                        silence_threshold_db,
                        min_silence_duration
                    )
                else:
                    detector = VADDetector(
                        method=method,
                        silence_threshold_db=silence_threshold_db,
                        min_silence_duration=min_silence_duration,
                        min_speech_duration=min_speech_duration,
                        padding=padding
                    )
                    result = detector.detect(audio_path)
                
                update_task_progress(task_id, 90, "保存结果")
                
                # 保存到数据库
                supabase.table("ai_tasks").update({
                    "status": "completed",
                    "result": result,
                    "progress": 100,
                    "progress_step": "完成"
                }).eq("id", task_id).execute()
                
                return result
                
        except Exception as e:
            logger.error(f"静音检测失败: {e}")
            update_task_status(task_id, "failed", error=str(e))
            raise

except ImportError:
    logger.info("Celery 未配置，使用同步模式")


# ============================================
# API 辅助函数
# ============================================

async def analyze_silences(
    audio_path: str,
    method: str = "energy",
    **kwargs
) -> Dict:
    """
    分析音频静音片段
    
    Args:
        audio_path: 音频文件路径
        method: 检测方法
        **kwargs: VADDetector 参数
    
    Returns:
        检测结果字典
    """
    if method == "ffmpeg":
        return detect_silence_ffmpeg(
            audio_path,
            kwargs.get("silence_threshold_db", -35),
            kwargs.get("min_silence_duration", 0.5)
        )
    
    detector = VADDetector(method=method, **kwargs)
    return detector.detect(audio_path)


async def detect_silence_segments(
    audio_url: str,
    min_silence_duration: float = 0.5,
    silence_threshold_db: float = -35,
    method: str = "energy",
) -> Dict:
    """
    检测音频 URL 中的静音片段
    
    Args:
        audio_url: 音频/视频文件 URL
        min_silence_duration: 最小静音时长 (秒)
        silence_threshold_db: 静音阈值 (dB)
        method: 检测方法 ("energy", "ffmpeg", "silero")
    
    Returns:
        {
            "segments": [...],  # 静音片段列表
            "total_duration": float,
            "silence_count": int,
            "silence_ratio": float
        }
    """
    import httpx
    
    logger.info(f"开始静音检测: {audio_url[:80]}...")
    
    # 下载音频到临时文件
    audio_path = None
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(audio_url)
            response.raise_for_status()
            
            # 获取文件扩展名
            content_type = response.headers.get("content-type", "")
            ext = ".mp4" if "video" in content_type else ".wav"
            
            # 保存到临时文件
            audio_path = tempfile.mktemp(suffix=ext)
            with open(audio_path, "wb") as f:
                f.write(response.content)
            
            logger.info(f"音频下载完成: {audio_path}, 大小: {len(response.content)} bytes")
        
        # 执行静音检测
        if method == "ffmpeg":
            result = detect_silence_ffmpeg(
                audio_path,
                silence_threshold_db,
                min_silence_duration
            )
        else:
            detector = VADDetector(
                method=method,
                silence_threshold_db=silence_threshold_db,
                min_silence_duration=min_silence_duration,
            )
            result = detector.detect(audio_path)
        
        # 转换为统一格式
        segments = [s.to_dict() if hasattr(s, 'to_dict') else s for s in result.get("silences", [])]
        
        return {
            "segments": segments,
            "total_duration": result.get("total_duration", 0),
            "silence_count": len(segments),
            "silence_ratio": result.get("silence_ratio", 0),
        }
        
    except Exception as e:
        logger.error(f"静音检测失败: {e}")
        raise
        
    finally:
        # 清理临时文件
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
            logger.info(f"临时文件已删除: {audio_path}")
