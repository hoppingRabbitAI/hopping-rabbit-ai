"""
HoppingRabbit AI - 字幕烧录任务
将字幕硬编码到视频中
"""
import os
import subprocess
import tempfile
import json
import logging
from typing import Optional
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================
# 字幕样式配置
# ============================================

def generate_ass_style(style: dict, name: str = "Default") -> str:
    """
    根据前端样式配置生成 ASS 字幕样式
    
    ASS 格式样式参数:
    Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
    Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, 
    BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
    """
    
    def color_to_ass(hex_color: str, opacity: float = 1.0) -> str:
        """将 #RRGGBB 转换为 ASS 颜色格式 &HAABBGGRR"""
        hex_color = hex_color.lstrip('#')
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        a = int((1 - opacity) * 255)
        return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"
    
    font_name = style.get("fontFamily", "Noto Sans SC")
    font_size = style.get("fontSize", 48)
    primary_color = color_to_ass(style.get("fontColor", "#FFFFFF"))
    outline_color = color_to_ass(style.get("strokeColor", "#000000"))
    back_color = color_to_ass(
        style.get("backgroundColor", "#000000"),
        style.get("backgroundOpacity", 0.5)
    )
    
    bold = -1 if style.get("fontWeight") in ["bold", "700", "800", "900"] else 0
    italic = -1 if style.get("italic") else 0
    outline = style.get("strokeWidth", 2)
    shadow = 1 if style.get("shadowBlur", 0) > 0 else 0
    
    # 对齐方式映射 (ASS 使用小键盘数字)
    align_map = {
        "left": 1, "center": 2, "right": 3,
        "top-left": 7, "top": 8, "top-right": 9,
        "bottom-left": 1, "bottom": 2, "bottom-right": 3,
        "middle": 5,
    }
    alignment = align_map.get(style.get("position", "bottom"), 2)
    
    # 边距
    margin_v = style.get("verticalOffset", 50)
    
    return (
        f"Style: {name},{font_name},{font_size},{primary_color},&H00FFFFFF,"
        f"{outline_color},{back_color},{bold},{italic},0,0,100,100,"
        f"{style.get('letterSpacing', 0)},0,1,{outline},{shadow},{alignment},"
        f"20,20,{margin_v},1"
    )


def generate_ass_content(
    subtitles: list,
    style: dict,
    video_width: int = 1920,
    video_height: int = 1080
) -> str:
    """生成完整的 ASS 字幕文件内容"""
    
    def format_time(seconds: float) -> str:
        """转换为 ASS 时间格式 H:MM:SS.CC"""
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        cs = int((seconds % 1) * 100)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"
    
    # ASS 文件头
    header = f"""[Script Info]
Title: HoppingRabbit AI Subtitles
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{generate_ass_style(style)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    
    # 生成字幕事件
    events = []
    for sub in subtitles:
        start = format_time(sub["start"])
        end = format_time(sub["end"])
        text = sub["text"].replace("\n", "\\N")
        
        # 处理动画效果
        effect = ""
        animation = sub.get("animation", "none")
        if animation == "fade":
            effect = "{\\fad(200,200)}"
        elif animation == "typewriter":
            # 打字机效果需要逐字显示
            pass
        elif animation == "scale":
            effect = "{\\fscx0\\fscy0\\t(0,200,\\fscx100\\fscy100)}"
        
        events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{effect}{text}")
    
    return header + "\n".join(events)


# ============================================
# 字幕烧录函数
# ============================================

async def burn_subtitles(
    video_path: str,
    subtitles: list,
    style: dict,
    output_path: str,
    on_progress: Optional[callable] = None
) -> str:
    """
    将字幕烧录到视频中
    
    Args:
        video_path: 输入视频路径
        subtitles: 字幕列表
        style: 字幕样式
        output_path: 输出视频路径
        on_progress: 进度回调
    
    Returns:
        str: 输出视频路径
    """
    
    # 获取视频分辨率
    probe_cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        video_path
    ]
    
    result = subprocess.run(probe_cmd, capture_output=True, text=True)
    video_info = json.loads(result.stdout)
    
    video_width = 1920
    video_height = 1080
    
    for stream in video_info.get("streams", []):
        if stream.get("codec_type") == "video":
            video_width = stream.get("width", 1920)
            video_height = stream.get("height", 1080)
            break
    
    # 生成 ASS 字幕文件
    ass_content = generate_ass_content(subtitles, style, video_width, video_height)
    
    ass_path = tempfile.mktemp(suffix=".ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ass_content)
    
    try:
        if on_progress:
            on_progress(10, "准备字幕文件")
        
        # FFmpeg 命令
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", f"ass={ass_path}",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "23",
            "-c:a", "copy",
            output_path
        ]
        
        if on_progress:
            on_progress(20, "烧录字幕中")
        
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )
        
        stdout, stderr = process.communicate()
        
        if process.returncode != 0:
            logger.error(f"FFmpeg 错误: {stderr}")
            raise RuntimeError(f"字幕烧录失败: {stderr}")
        
        if on_progress:
            on_progress(100, "烧录完成")
        
        return output_path
        
    finally:
        # 清理临时文件
        if os.path.exists(ass_path):
            os.remove(ass_path)


# ============================================
# Celery 任务
# ============================================

try:
    from ..celery_config import celery_app, update_task_progress, update_task_status
    
    @celery_app.task(bind=True, queue="cpu_high")
    def burn_subtitles_task(
        self,
        task_id: str,
        project_id: str,
        video_url: str,
        subtitles: list,
        style: dict
    ):
        """Celery 字幕烧录任务"""
        import asyncio
        import httpx
        from ..services.supabase_client import supabase
        
        def on_progress(progress: int, step: str):
            update_task_progress(task_id, progress, step)
        
        try:
            update_task_status(task_id, "processing")
            
            # 下载视频
            with tempfile.TemporaryDirectory() as tmpdir:
                video_path = os.path.join(tmpdir, "input.mp4")
                output_path = os.path.join(tmpdir, "output_subtitled.mp4")
                
                async def download_video():
                    async with httpx.AsyncClient(timeout=300) as client:
                        response = await client.get(video_url, follow_redirects=True)
                        response.raise_for_status()
                        with open(video_path, "wb") as f:
                            f.write(response.content)
                
                asyncio.run(download_video())
                
                # 烧录字幕
                asyncio.run(burn_subtitles(
                    video_path=video_path,
                    subtitles=subtitles,
                    style=style,
                    output_path=output_path,
                    on_progress=on_progress
                ))
                
                # 上传结果
                storage_path = f"exports/{project_id}/subtitled_{task_id}.mp4"
                
                with open(output_path, "rb") as f:
                    supabase.storage.from_("videos").upload(
                        storage_path,
                        f.read(),
                        {"content-type": "video/mp4"}
                    )
                
                from ..services.supabase_client import get_file_url
                result_url = get_file_url("videos", storage_path)
                
                result = {
                    "success": True,
                    "url": result_url,
                    "subtitle_count": len(subtitles)
                }
                
                update_task_status(task_id, "completed", result=result)
                return result
                
        except Exception as e:
            logger.error(f"字幕烧录任务失败: {e}")
            update_task_status(task_id, "failed", error=str(e))
            raise

except ImportError:
    logger.info("Celery 未配置，使用同步模式")


# ============================================
# SRT/VTT 导出
# ============================================

def export_srt(subtitles: list) -> str:
    """导出 SRT 格式字幕"""
    
    def format_time(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int((seconds % 1) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    
    lines = []
    for i, sub in enumerate(subtitles, 1):
        lines.append(str(i))
        lines.append(f"{format_time(sub['start'])} --> {format_time(sub['end'])}")
        lines.append(sub["text"])
        lines.append("")
    
    return "\n".join(lines)


def export_vtt(subtitles: list) -> str:
    """导出 WebVTT 格式字幕"""
    
    def format_time(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int((seconds % 1) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"
    
    lines = ["WEBVTT", ""]
    
    for i, sub in enumerate(subtitles, 1):
        lines.append(str(i))
        lines.append(f"{format_time(sub['start'])} --> {format_time(sub['end'])}")
        lines.append(sub["text"])
        lines.append("")
    
    return "\n".join(lines)


def export_ass(subtitles: list, style: dict) -> str:
    """导出 ASS 格式字幕"""
    return generate_ass_content(subtitles, style)
