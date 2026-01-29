"""
HoppingRabbit AI - 视频导出任务 (Enhanced)
支持多轨道合成、特效渲染、水印、字幕烧录等功能
"""
import os
import uuid
import subprocess
import asyncio
import tempfile
import json
import logging
from typing import Optional
from datetime import datetime

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================
# 配置常量
# ============================================

# 分辨率映射 - 根据新需求，使用正方形分辨率
RESOLUTION_MAP = {
    "8k": ("4320", "4320"),
    "4k": ("2160", "2160"),
    "2k": ("1440", "1440"),
    "1080p": ("1080", "1080"),
    "720p": ("720", "720"),
    "480p": ("480", "480"),
    "original": None,  # 使用原始分辨率
    # 向后兼容的横屏分辨率
    "4k_landscape": ("3840", "2160"),
    "2k_landscape": ("2560", "1440"),
    "1080p_landscape": ("1920", "1080"),
    "720p_landscape": ("1280", "720"),
    "480p_landscape": ("854", "480"),
    "vertical_1080": ("1080", "1920"),  # 竖屏
    "vertical_720": ("720", "1280"),
    "square_1080": ("1080", "1080"),    # 正方形
}

PRESET_MAP = {
    "fast": {"preset": "veryfast", "crf": "28"},
    "balanced": {"preset": "medium", "crf": "23"},
    "quality": {"preset": "slow", "crf": "18"},
}

FORMAT_CODECS = {
    "mp4": {"v": "libx264", "a": "aac"},        # 推荐：社交媒体发布
    "webm": {"v": "libvpx-vp9", "a": "libopus"},  # Web 优化格式
    # 注：已移除 MOV/ProRes，社交媒体发布不需要中间格式
}


# ============================================
# 核心导出函数
# ============================================

async def export_project(
    project_id: str,
    timeline: dict,
    settings: dict,
    on_progress: Optional[callable] = None
) -> dict:
    """
    导出完整项目
    
    Args:
        project_id: 项目 ID
        timeline: 时间线数据（包含 tracks 和 clips）
        settings: 导出设置
        on_progress: 进度回调
    
    Returns:
        dict: 导出结果
    """
    
    # 解析设置
    resolution = settings.get("resolution", "original")
    output_format = settings.get("format", "mp4")  # 默认 mp4，适合社交媒体
    quality = settings.get("quality", "quality")
    fps = settings.get("fps", 30)
    title = settings.get("title", "export")
    watermark = settings.get("watermark")
    burn_subtitles = settings.get("burnSubtitles", False)
    
    # 获取分辨率，如果是 original 则使用 None（后续会从视频中获取）
    resolution_tuple = RESOLUTION_MAP.get(resolution)
    if resolution_tuple:
        width, height = resolution_tuple
    else:
        width, height = None, None  # 使用原始分辨率
    
    preset_config = PRESET_MAP.get(quality, PRESET_MAP["balanced"])
    codec_config = FORMAT_CODECS.get(output_format, FORMAT_CODECS["mp4"])  # 默认 mp4
    
    logger.info(f"[Export] 导出设置: resolution={resolution}, format={output_format}, codec={codec_config['v']}, quality={quality}, fps={fps}")
    logger.info(f"[Export] Timeline: {len(timeline.get('tracks', []))} tracks, {len(timeline.get('clips', []))} clips")
    
    import time
    step_times = {}
    
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            # 1. 准备资源文件
            if on_progress:
                on_progress(5, "准备媒体资源")
            
            t0 = time.time()
            assets_map = await prepare_assets(timeline, tmpdir)
            step_times['1_prepare_assets'] = time.time() - t0
            logger.info(f"[Export] ⏱️ 步骤1 准备资源: {step_times['1_prepare_assets']:.2f}秒, 共 {len(assets_map)} 个文件")
            
            # 2. 分析时间线
            if on_progress:
                on_progress(15, "分析时间线")
            
            t0 = time.time()
            total_duration = calculate_timeline_duration(timeline)
            step_times['2_analyze_timeline'] = time.time() - t0
            logger.info(f"[Export] ⏱️ 步骤2 分析时间线: {step_times['2_analyze_timeline']:.2f}秒, 总时长 {total_duration}秒")
            
            # 3. 生成滤镜图
            if on_progress:
                on_progress(25, "构建滤镜图")
            
            t0 = time.time()
            filter_graph, inputs = build_filter_graph(
                timeline=timeline,
                assets_map=assets_map,
                width=int(width),
                height=int(height),
                fps=fps,
                watermark=watermark,
                burn_subtitles=burn_subtitles
            )
            step_times['3_build_filter'] = time.time() - t0
            logger.info(f"[Export] ⏱️ 步骤3 构建滤镜: {step_times['3_build_filter']:.2f}秒")
            logger.info(f"[Export] 滤镜图长度: {len(filter_graph)} 字符, 输入文件数: {len(inputs)}")
            
            # 4. 执行 FFmpeg 渲染
            if on_progress:
                on_progress(40, "渲染视频")
            
            output_path = os.path.join(tmpdir, f"output.{output_format}")
            
            t0 = time.time()
            await render_video(
                inputs=inputs,
                filter_graph=filter_graph,
                output_path=output_path,
                codec=codec_config["v"],
                audio_codec=codec_config["a"],
                preset=preset_config["preset"],
                crf=preset_config["crf"],
                width=width,
                height=height,
                fps=fps,
                on_progress=lambda p, m: on_progress(int(40 + p * 0.5), m) if on_progress else None
            )
            step_times['4_ffmpeg_render'] = time.time() - t0
            output_size = os.path.getsize(output_path)
            logger.info(f"[Export] ⏱️ 步骤4 FFmpeg渲染: {step_times['4_ffmpeg_render']:.2f}秒, 输出 {output_size/1024/1024:.2f}MB")
            
            # 5. 上传到存储
            if on_progress:
                on_progress(92, "上传导出文件")
            
            t0 = time.time()
            export_url = await upload_export(
                project_id=project_id,
                output_path=output_path,
                output_format=output_format
            )
            step_times['5_upload'] = time.time() - t0
            logger.info(f"[Export] ⏱️ 步骤5 上传: {step_times['5_upload']:.2f}秒")
            
            # 6. 生成导出记录
            if on_progress:
                on_progress(98, "生成导出记录")
            
            result = {
                "success": True,
                "export_url": export_url,
                "duration": total_duration,
                "resolution": resolution,
                "format": output_format,
                "file_size": output_size,
                "created_at": datetime.utcnow().isoformat(),
            }
            
            await save_export_record(project_id, result)
            
            # 打印总耗时统计
            total_time = sum(step_times.values())
            logger.info(f"[Export] ========== 导出耗时统计 ==========")
            for step, duration in step_times.items():
                pct = (duration / total_time * 100) if total_time > 0 else 0
                logger.info(f"[Export]   {step}: {duration:.2f}秒 ({pct:.1f}%)")
            logger.info(f"[Export]   总计: {total_time:.2f}秒")
            logger.info(f"[Export] ====================================")
            
            if on_progress:
                on_progress(100, "导出完成")
            
            return result
            
        except Exception as e:
            logger.error(f"导出失败: {e}")
            raise


# ============================================
# 资源准备
# ============================================

async def prepare_assets(timeline: dict, tmpdir: str) -> dict:
    """下载并准备所有资源文件"""
    import httpx
    
    assets_map = {}
    clips = timeline.get("clips", [])
    
    logger.info(f"[Export] prepare_assets: 准备处理 {len(clips)} 个片段")
    
    async with httpx.AsyncClient(timeout=300) as client:
        for clip in clips:
            # 兼容前端 camelCase 和后端 snake_case
            asset_url = clip.get("asset_url") or clip.get("assetUrl") or clip.get("url") or clip.get("cached_url") or clip.get("mediaUrl")
            clip_type = clip.get("clipType") or clip.get("clip_type", "video")
            
            # 只处理视频和音频类型
            if clip_type not in ("video", "audio"):
                continue
            
            # 验证 URL 格式
            if not asset_url:
                logger.warning(f"[Export] Clip {clip.get('id', 'unknown')[:8]}... ({clip_type}) 没有 URL，跳过")
                continue
            
            if not (asset_url.startswith("http://") or asset_url.startswith("https://")):
                logger.warning(f"[Export] Clip {clip.get('id', 'unknown')[:8]}... URL 格式无效: {asset_url[:50]}，跳过")
                continue
            
            logger.info(f"[Export] Clip type={clip_type}, url={asset_url[:80] if asset_url else 'None'}...")
            
            if asset_url not in assets_map:
                # 下载资源
                ext = ".mp4"
                if "mp3" in asset_url.lower():
                    ext = ".mp3"
                elif "wav" in asset_url.lower():
                    ext = ".wav"
                elif "png" in asset_url.lower():
                    ext = ".png"
                elif "jpg" in asset_url.lower() or "jpeg" in asset_url.lower():
                    ext = ".jpg"
                
                local_path = os.path.join(tmpdir, f"{uuid.uuid4().hex}{ext}")
                
                logger.info(f"[Export] 下载资源: {asset_url[:80]}... -> {local_path}")
                response = await client.get(asset_url, follow_redirects=True)
                response.raise_for_status()
                
                with open(local_path, 'wb') as f:
                    f.write(response.content)
                
                assets_map[asset_url] = local_path
                logger.info(f"[Export] 下载完成，文件大小: {os.path.getsize(local_path)} bytes")
    
    return assets_map


def calculate_timeline_duration(timeline: dict) -> float:
    """计算时间线总时长"""
    max_end = 0
    
    # clips 是独立数组，不是嵌套在 track 中
    for clip in timeline.get("clips", []):
        # 兼容前端 camelCase 和后端 snake_case
        # 优先使用 end_time，其次用 start + duration
        end_time = clip.get("end") or clip.get("end_time")
        if end_time:
            max_end = max(max_end, end_time)
        else:
            start = clip.get("start") or clip.get("start_time", 0)
            duration = clip.get("duration", 0)
            if duration > 0:
                max_end = max(max_end, start + duration)
    
    return max_end / 1000  # 转换为秒


def build_atempo_chain(speed: float) -> str:
    """
    构建 atempo 滤镜链
    atempo 只支持 0.5-2.0 范围，超出范围需要链式处理
    例如：4x 加速需要 atempo=2.0,atempo=2.0
    """
    if speed == 1.0:
        return ""
    
    parts = []
    remaining = speed
    
    while remaining > 2.0:
        parts.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        parts.append("atempo=0.5")
        remaining /= 0.5
    
    if remaining != 1.0:
        parts.append(f"atempo={remaining:.4f}")
    
    return ",".join(parts) if parts else ""


def escape_ffmpeg_text(text: str) -> str:
    """转义 FFmpeg drawtext 滤镜中的特殊字符"""
    if not text:
        return ""
    # 转义顺序很重要：先转义反斜杠，再转义其他字符
    text = text.replace("\\", "\\\\")
    text = text.replace("'", "'\\''")  # 单引号
    text = text.replace(":", "\\:")
    text = text.replace("[", "\\[")
    text = text.replace("]", "\\]")
    text = text.replace(",", "\\,")
    text = text.replace(";", "\\;")
    return text


# ============================================
# 滤镜预设支持（全局色彩调整）
# ============================================
# 注意：真正的美颜（磨皮、瘦脸、大眼等）必须通过 AI 处理（MediaPipe + 面部检测）
# FFmpeg 的 blur/eq 只能做全局处理，无法针对面部区域
# 这里只保留"滤镜预设"功能（全局色彩风格化）

def build_beauty_filter(clip: dict) -> str:
    """
    构建视频滤镜链
    
    注意：此函数只处理全局色彩滤镜预设，不处理面部美颜。
    真正的面部美颜需要 AI 人脸检测 + 网格变形，FFmpeg 无法实现。
    
    根据 clip.effectParams.filter 构建滤镜预设（全局色彩调整）
    
    Args:
        clip: clip 数据
        
    Returns:
        FFmpeg 滤镜字符串，如果没有滤镜效果则返回空字符串
    """
    effect_params = clip.get("effect_params") or clip.get("effectParams") or {}
    filter_settings = effect_params.get("filter") or {}
    
    filters = []
    
    # ============ 滤镜预设（全局色彩调整） ============
    filter_id = filter_settings.get("id") or filter_settings.get("filterId")
    filter_intensity = filter_settings.get("intensity", 100) / 100
    
    if filter_id and filter_id != "none" and filter_intensity > 0:
        filter_expr = get_filter_preset(filter_id, filter_intensity)
        if filter_expr:
            filters.append(filter_expr)
    
    # 注意：面部美颜（磨皮、美白、瘦脸、大眼等）需要前端 AI 处理后导出
    # 或使用专门的 AI 视频处理管道，不在此处实现
    
    return ",".join(filters) if filters else ""


def get_filter_preset(filter_id: str, intensity: float = 1.0) -> str:
    """
    获取滤镜预设的 FFmpeg 表达式
    
    Args:
        filter_id: 滤镜 ID
        intensity: 强度 0.0-1.0
        
    Returns:
        FFmpeg 滤镜表达式
    """
    # 滤镜预设映射
    FILTER_PRESETS = {
        # 自然风格
        "natural": f"eq=saturation={1.0 + 0.1 * intensity}:contrast={1.0 + 0.05 * intensity}",
        "warm": f"colortemperature={5000 + 1500 * intensity}",  # 暖色调
        "cool": f"colortemperature={6500 - 1000 * intensity}",  # 冷色调
        "fresh": f"eq=saturation={1.0 + 0.15 * intensity}:brightness={0.02 * intensity}",
        
        # 人像风格
        "soft": f"gblur=sigma={0.5 * intensity},eq=brightness={0.03 * intensity}",
        "rosy": f"colorbalance=rs={0.1 * intensity}:gs={-0.05 * intensity}:bs={-0.05 * intensity}",
        "cream": f"eq=saturation={1.0 - 0.2 * intensity}:brightness={0.05 * intensity}:gamma={1.0 + 0.1 * intensity}",
        
        # 风格化
        "film": f"curves=preset=vintage,eq=saturation={0.9 - 0.1 * intensity}",
        "bw": f"colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3",  # 黑白
        "drama": f"eq=contrast={1.0 + 0.3 * intensity}:saturation={1.0 + 0.2 * intensity}",
        
        # 复古风格
        "vintage": f"curves=preset=vintage",
        "fade": f"colorlevels=rimax={1.0 - 0.1 * intensity}:gimax={1.0 - 0.1 * intensity}:bimax={1.0 - 0.1 * intensity}",
    }
    
    # 简单滤镜（不需要复杂处理）
    if filter_id in FILTER_PRESETS:
        return FILTER_PRESETS[filter_id]
    
    # 暖色/冷色调需要特殊处理（colortemperature 可能不可用）
    if filter_id == "warm":
        # 使用 colorbalance 模拟暖色调
        r_shift = 0.1 * intensity
        return f"colorbalance=rs={r_shift}:gs={r_shift * 0.3}:bs={-r_shift * 0.5}"
    
    if filter_id == "cool":
        # 使用 colorbalance 模拟冷色调
        b_shift = 0.1 * intensity
        return f"colorbalance=rs={-b_shift * 0.5}:gs={b_shift * 0.3}:bs={b_shift}"
    
    return ""


# ============================================
# 关键帧动画支持
# ============================================

def get_easing_expression(easing: str, t_expr: str) -> str:
    """
    生成缓动函数的 FFmpeg 表达式
    t_expr: 归一化时间表达式 (0-1)
    """
    if easing == "linear" or not easing:
        return t_expr
    elif easing == "ease_in":
        # t^2 缓入
        return f"pow({t_expr},2)"
    elif easing == "ease_out":
        # 1-(1-t)^2 缓出
        return f"(1-pow(1-{t_expr},2))"
    elif easing == "ease_in_out":
        # 分段：t<0.5 ? 2*t^2 : 1-pow(-2*t+2,2)/2
        return f"if(lt({t_expr},0.5),2*pow({t_expr},2),1-pow(-2*{t_expr}+2,2)/2)"
    elif easing == "hold":
        # 保持起始值
        return "0"
    else:
        return t_expr


def build_keyframe_expression(keyframes: list, prop: str, clip_start_sec: float, clip_duration_sec: float, default_value: float = None) -> str:
    """
    为单个属性构建关键帧插值表达式
    
    Args:
        keyframes: 该属性的关键帧列表，已按 offset 排序
        prop: 属性名 (position, scale, rotation, opacity, volume)
        clip_start_sec: clip 在时间线上的起始时间（秒）
        clip_duration_sec: clip 的时长（秒）
        default_value: 没有关键帧时的默认值
    
    Returns:
        FFmpeg 表达式字符串
    """
    if not keyframes:
        return str(default_value) if default_value is not None else None
    
    # 按 offset 排序
    sorted_kf = sorted(keyframes, key=lambda k: k.get("offset", 0))
    
    # 如果只有一个关键帧，返回常量值
    if len(sorted_kf) == 1:
        value = sorted_kf[0].get("value", default_value)
        if isinstance(value, dict):
            # 复合值，返回 None 表示需要单独处理
            return None
        return str(value)
    
    # 构建分段插值表达式
    # t 是相对于 clip 的归一化时间 (0-1)
    # 使用 FFmpeg 的 (t-clip_start)/clip_duration 来计算
    t_expr = f"((t-{clip_start_sec})/{clip_duration_sec})"
    
    # 构建嵌套的 if 表达式
    expr_parts = []
    
    for i in range(len(sorted_kf) - 1):
        kf1 = sorted_kf[i]
        kf2 = sorted_kf[i + 1]
        
        offset1 = kf1.get("offset", 0)
        offset2 = kf2.get("offset", 1)
        value1 = kf1.get("value", default_value)
        value2 = kf2.get("value", default_value)
        easing = kf2.get("easing", "linear")  # 缓动类型应用于到达该关键帧的过渡
        
        # 处理复合值
        if isinstance(value1, dict):
            value1 = value1.get("x", default_value) if default_value is not None else 0
        if isinstance(value2, dict):
            value2 = value2.get("x", default_value) if default_value is not None else 0
        
        # 计算该段的归一化进度
        segment_t = f"(({t_expr}-{offset1})/({offset2}-{offset1}))"
        eased_t = get_easing_expression(easing, segment_t)
        
        # 线性插值: value1 + (value2 - value1) * eased_t
        interpolated = f"({value1}+({value2}-{value1})*{eased_t})"
        
        # 条件: offset1 <= t < offset2
        condition = f"gte({t_expr},{offset1})*lt({t_expr},{offset2})"
        expr_parts.append(f"{condition}*{interpolated}")
    
    # 最后一段（t >= last_offset）
    last_kf = sorted_kf[-1]
    last_value = last_kf.get("value", default_value)
    if isinstance(last_value, dict):
        last_value = last_value.get("x", default_value) if default_value is not None else 0
    last_offset = last_kf.get("offset", 1)
    expr_parts.append(f"gte({t_expr},{last_offset})*{last_value}")
    
    # 第一段之前（t < first_offset）
    first_kf = sorted_kf[0]
    first_value = first_kf.get("value", default_value)
    if isinstance(first_value, dict):
        first_value = first_value.get("x", default_value) if default_value is not None else 0
    first_offset = first_kf.get("offset", 0)
    expr_parts.insert(0, f"lt({t_expr},{first_offset})*{first_value}")
    
    return "+".join(expr_parts)


def build_compound_keyframe_expression(keyframes: list, component: str, clip_start_sec: float, clip_duration_sec: float, default_value: float = 0) -> str:
    """
    为复合属性 (position/scale) 的单个分量构建表达式
    
    Args:
        keyframes: 关键帧列表
        component: 'x' 或 'y'
        clip_start_sec: clip 起始时间
        clip_duration_sec: clip 时长
        default_value: 默认值
    """
    if not keyframes:
        return str(default_value)
    
    sorted_kf = sorted(keyframes, key=lambda k: k.get("offset", 0))
    
    if len(sorted_kf) == 1:
        value = sorted_kf[0].get("value", {})
        if isinstance(value, dict):
            return str(value.get(component, default_value))
        return str(default_value)
    
    t_expr = f"((t-{clip_start_sec})/{clip_duration_sec})"
    expr_parts = []
    
    for i in range(len(sorted_kf) - 1):
        kf1 = sorted_kf[i]
        kf2 = sorted_kf[i + 1]
        
        offset1 = kf1.get("offset", 0)
        offset2 = kf2.get("offset", 1)
        
        v1 = kf1.get("value", {})
        v2 = kf2.get("value", {})
        value1 = v1.get(component, default_value) if isinstance(v1, dict) else default_value
        value2 = v2.get(component, default_value) if isinstance(v2, dict) else default_value
        
        easing = kf2.get("easing", "linear")
        segment_t = f"(({t_expr}-{offset1})/({offset2}-{offset1}))"
        eased_t = get_easing_expression(easing, segment_t)
        
        interpolated = f"({value1}+({value2}-{value1})*{eased_t})"
        condition = f"gte({t_expr},{offset1})*lt({t_expr},{offset2})"
        expr_parts.append(f"{condition}*{interpolated}")
    
    # 最后一段
    last_kf = sorted_kf[-1]
    last_v = last_kf.get("value", {})
    last_value = last_v.get(component, default_value) if isinstance(last_v, dict) else default_value
    last_offset = last_kf.get("offset", 1)
    expr_parts.append(f"gte({t_expr},{last_offset})*{last_value}")
    
    # 第一段之前
    first_kf = sorted_kf[0]
    first_v = first_kf.get("value", {})
    first_value = first_v.get(component, default_value) if isinstance(first_v, dict) else default_value
    first_offset = first_kf.get("offset", 0)
    expr_parts.insert(0, f"lt({t_expr},{first_offset})*{first_value}")
    
    return "+".join(expr_parts)


def get_clip_keyframes_by_property(clip_keyframes: list) -> dict:
    """
    将 clip 的关键帧按属性分组
    
    Returns:
        {property_name: [keyframe1, keyframe2, ...]}
    """
    result = {}
    for kf in (clip_keyframes or []):
        prop = kf.get("property")
        if prop:
            if prop not in result:
                result[prop] = []
            result[prop].append(kf)
    return result


# ============================================
# 滤镜图构建
# ============================================

def build_filter_graph(
    timeline: dict,
    assets_map: dict,
    width: int,
    height: int,
    fps: int,
    watermark: Optional[dict] = None,
    burn_subtitles: bool = False
) -> tuple:
    """
    构建 FFmpeg 复杂滤镜图
    
    Returns:
        tuple: (filter_complex 字符串, 输入文件列表)
    """
    
    inputs = []
    filter_parts = []
    video_streams = []
    audio_streams = []
    
    # 先计算总时长（需要在构建滤镜之前知道）
    total_duration = calculate_timeline_duration(timeline)
    
    # 创建黑色背景视频（带时长限制）
    base_filter = f"color=c=black:s={width}x{height}:r={fps}:d={total_duration}[base]"
    # 静音音频也要限制时长！否则会无限生成
    silent_audio = f"anullsrc=channel_layout=stereo:sample_rate=48000:d={total_duration}[silent]"
    
    tracks = timeline.get("tracks", [])
    clips = timeline.get("clips", [])
    clip_index = 0
    
    # 按 track_id 分组 clips
    clips_by_track = {}
    for clip in clips:
        track_id = clip.get("track_id") or clip.get("trackId")
        if track_id:
            if track_id not in clips_by_track:
                clips_by_track[track_id] = []
            clips_by_track[track_id].append(clip)
    
    for track_idx, track in enumerate(tracks):
        track_id = track.get("id")
        track_clips = clips_by_track.get(track_id, [])
        
        for clip in track_clips:
            # 通过 clip_type 判断素材类型
            clip_type = clip.get("clipType") or clip.get("clip_type", "video")
            
            # 兼容前端 camelCase 和后端 snake_case
            asset_url = clip.get("asset_url") or clip.get("assetUrl") or clip.get("url") or clip.get("cached_url") or clip.get("mediaUrl")
            
            # 只处理视频和音频
            if clip_type not in ("video", "audio"):
                continue
            
            if not asset_url or asset_url not in assets_map:
                logger.warning(f"[Export] Clip {clip.get('id', 'unknown')[:8]}... 无 URL 或不在 assets_map 中")
                continue
            
            logger.info(f"[Export] 处理 clip: type={clip_type}, url={asset_url[:50]}...")
            
            local_path = assets_map[asset_url]
            input_idx = len(inputs)
            inputs.append(local_path)
            
            # 片段参数 - 兼容 camelCase 和 snake_case
            # timeline 上的位置
            start_time = clip.get("start") or clip.get("start_time") or clip.get("position", 0)
            end_time = clip.get("end") or clip.get("end_time") or 0
            
            # 如果没有 end_time，尝试从 duration 计算
            explicit_duration = clip.get("duration", 0)
            if end_time == 0 and explicit_duration > 0:
                end_time = start_time + explicit_duration
            
            # 计算 clip 在 timeline 上的时长
            duration_ms = end_time - start_time if end_time > start_time else explicit_duration
            if duration_ms <= 0:
                logger.warning(f"[Export] Clip {clip.get('id', 'unknown')[:8]}... duration 为 0，跳过")
                continue
            
            position = start_time / 1000  # 转为秒
            duration = duration_ms / 1000
            
            # 源素材的裁剪点
            source_start = (clip.get("sourceStart") or clip.get("source_start", 0)) / 1000
            source_end = clip.get("sourceEnd") or clip.get("source_end")
            
            # 如果没有指定 source_end，使用 source_start + duration
            if source_end:
                source_end = source_end / 1000
            else:
                source_end = source_start + duration
            
            volume = clip.get("volume", 1.0)
            opacity = clip.get("opacity", 1.0)
            is_muted = clip.get("isMuted") or clip.get("is_muted", False)
            
            # ★ 变速处理
            speed = clip.get("speed", 1.0)
            if speed <= 0:
                speed = 1.0
            
            actual_start = source_start
            actual_end = source_end
            
            logger.info(f"[Export] Clip timing: position={position}s, duration={duration}s, source={actual_start}-{actual_end}s, speed={speed}x")
            
            if clip_type == "video":
                # 视频处理滤镜
                v_filter = f"[{input_idx}:v]"
                
                # 裁剪时间
                v_filter += f"trim=start={actual_start}:end={actual_end},setpts=PTS-STARTPTS,"
                
                # ★ 变速处理 (setpts 调整视频速度)
                if speed != 1.0:
                    # setpts=PTS/speed 加速, setpts=PTS*speed 减速
                    # 但由于我们已经用了 setpts=PTS-STARTPTS，需要用乘法
                    pts_factor = 1.0 / speed
                    v_filter += f"setpts={pts_factor}*PTS,"
                
                # ============ 获取关键帧 ============
                clip_keyframes = clip.get("keyframes", [])
                kf_by_prop = get_clip_keyframes_by_property(clip_keyframes)
                has_keyframes = len(kf_by_prop) > 0
                
                if has_keyframes:
                    logger.info(f"[Export] Clip {clip.get('id', 'unknown')[:8]}... 有关键帧: {list(kf_by_prop.keys())}")
                
                # ============ Transform 处理 ============
                # 使用 `or {}` 确保即使 transform 是 None 也能正常工作
                transform = clip.get("transform") or {}
                
                # 1. 画面裁剪 (cropRect) - 不支持关键帧动画
                crop_rect = transform.get("cropRect") or transform.get("crop_rect")
                if crop_rect:
                    crop_x = crop_rect.get("x", 0)
                    crop_y = crop_rect.get("y", 0)
                    crop_w = crop_rect.get("width", 1)
                    crop_h = crop_rect.get("height", 1)
                    v_filter += f"crop=iw*{crop_w}:ih*{crop_h}:iw*{crop_x}:ih*{crop_y},"
                
                # 2. 翻转 - 不支持关键帧动画
                if transform.get("flipH"):
                    v_filter += "hflip,"
                if transform.get("flipV"):
                    v_filter += "vflip,"
                
                # 3. 旋转 - 支持关键帧动画
                rotation_kf = kf_by_prop.get("rotation", [])
                if rotation_kf:
                    # 使用关键帧动画
                    rotation_expr = build_keyframe_expression(rotation_kf, "rotation", position, duration, 0)
                    if rotation_expr and rotation_expr != "0":
                        # 转换为弧度
                        v_filter += f"rotate='({rotation_expr})*PI/180':fillcolor=black,"
                else:
                    # 静态旋转
                    rotation = transform.get("rotation", 0)
                    if rotation:
                        rotation = rotation % 360
                        if rotation == 90:
                            v_filter += "transpose=1,"
                        elif rotation == 180:
                            v_filter += "transpose=1,transpose=1,"
                        elif rotation == 270:
                            v_filter += "transpose=2,"
                        elif rotation != 0:
                            rad = rotation * 3.14159 / 180
                            v_filter += f"rotate={rad}:fillcolor=black,"
                
                # 4. 缩放 - 支持关键帧动画
                scale_kf = kf_by_prop.get("scale", [])
                if scale_kf:
                    # 复合属性 scale 有 x 和 y 分量
                    scale_x_expr = build_compound_keyframe_expression(scale_kf, "x", position, duration, 1.0)
                    scale_y_expr = build_compound_keyframe_expression(scale_kf, "y", position, duration, 1.0)
                    v_filter += f"scale='iw*({scale_x_expr})':'ih*({scale_y_expr})',"
                else:
                    clip_scale = transform.get("scale", 1.0)
                    if clip_scale != 1.0:
                        v_filter += f"scale=iw*{clip_scale}:ih*{clip_scale},"
                
                # ============ 标准处理 ============
                # 缩放适配目标分辨率
                v_filter += f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                v_filter += f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
                
                # ============ 美颜滤镜处理 ============
                beauty_filter = build_beauty_filter(clip)
                if beauty_filter:
                    v_filter += beauty_filter + ","
                
                # 5. 透明度 - 支持关键帧动画
                opacity_kf = kf_by_prop.get("opacity", [])
                if opacity_kf:
                    opacity_expr = build_keyframe_expression(opacity_kf, "opacity", position, duration, 1.0)
                    if opacity_expr and opacity_expr != "1.0":
                        v_filter += f"format=rgba,colorchannelmixer=aa='{opacity_expr}',"
                else:
                    if opacity < 1.0:
                        v_filter += f"format=rgba,colorchannelmixer=aa={opacity},"
                
                # 帧率
                v_filter += f"fps={fps}"
                
                v_filter += f"[v{clip_index}]"
                filter_parts.append(v_filter)
                
                # ★ 位置动画需要在 overlay 阶段处理
                position_kf = kf_by_prop.get("position", [])
                
                video_streams.append({
                    "stream": f"[v{clip_index}]",
                    "position": position,
                    "duration": duration / speed if speed != 1.0 else duration,
                    "position_keyframes": position_kf if position_kf else None,
                    "clip_duration": duration,
                })
                
                # 音频处理（视频片段的音频）
                a_filter = f"[{input_idx}:a]"
                a_filter += f"atrim=start={actual_start}:end={actual_end},asetpts=PTS-STARTPTS,"
                
                # ★ 音频变速 (atempo 只支持 0.5-2.0 范围，需要链式处理)
                if speed != 1.0:
                    a_filter += build_atempo_chain(speed) + ","
                
                # ★ 音量关键帧动画
                volume_kf = kf_by_prop.get("volume", [])
                if volume_kf:
                    volume_expr = build_keyframe_expression(volume_kf, "volume", position, duration, 1.0)
                    if is_muted:
                        a_filter += "volume=0"
                    else:
                        a_filter += f"volume='{volume_expr}'"
                else:
                    if is_muted:
                        a_filter += "volume=0"
                    else:
                        a_filter += f"volume={volume}"
                    
                a_filter += f"[a{clip_index}]"
                filter_parts.append(a_filter)
                
                audio_streams.append({
                    "stream": f"[a{clip_index}]",
                    "position": position,
                    "duration": duration / speed if speed != 1.0 else duration
                })
                
            elif clip_type == "audio":
                # 纯音频处理
                a_filter = f"[{input_idx}:a]"
                a_filter += f"atrim=start={actual_start}:end={actual_end},asetpts=PTS-STARTPTS,"
                
                # ★ 音频变速
                if speed != 1.0:
                    a_filter += build_atempo_chain(speed) + ","
                
                # ★ 静音处理
                if is_muted:
                    a_filter += "volume=0"
                else:
                    a_filter += f"volume={volume}"
                    
                a_filter += f"[a{clip_index}]"
                filter_parts.append(a_filter)
                
                audio_streams.append({
                    "stream": f"[a{clip_index}]",
                    "position": position,
                    "duration": duration / speed if speed != 1.0 else duration
                })
            
            clip_index += 1
    
    # ============================================
    # 处理文本和字幕 clips (不需要下载资源)
    # ============================================
    text_overlays = []  # 存储文本叠加信息
    
    for clip in clips:
        clip_type = clip.get("clipType") or clip.get("clip_type", "video")
        
        if clip_type not in ("text", "subtitle"):
            continue
        
        # 获取文本内容
        content_text = clip.get("content_text") or clip.get("contentText") or clip.get("text")
        if not content_text:
            logger.warning(f"[Export] Text/Subtitle clip {clip.get('id', 'unknown')[:8]}... 没有文本内容，跳过")
            continue
        
        # 时间信息
        start_time = clip.get("start") or clip.get("start_time", 0)
        end_time = clip.get("end") or clip.get("end_time") or 0
        explicit_duration = clip.get("duration", 0)
        if end_time == 0 and explicit_duration > 0:
            end_time = start_time + explicit_duration
        
        duration_ms = end_time - start_time if end_time > start_time else explicit_duration
        if duration_ms <= 0:
            continue
        
        position_sec = start_time / 1000
        duration_sec = duration_ms / 1000
        
        # 获取样式
        text_style = clip.get("text_style") or clip.get("textStyle") or {}
        font_size = text_style.get("fontSize", 48 if clip_type == "text" else 24)
        font_color = text_style.get("fontColor", "#FFFFFF").lstrip("#")
        bg_color = text_style.get("backgroundColor", "transparent")
        alignment = text_style.get("alignment", "center")
        
        # 字幕特有的位置属性
        subtitle_position = text_style.get("position", "bottom")  # top, center, bottom
        
        # Transform 属性
        transform = clip.get("transform") or {}
        clip_x = transform.get("x", 0)
        clip_y = transform.get("y", 0)
        clip_opacity = transform.get("opacity", 1.0)
        
        # ★ 获取关键帧
        clip_keyframes = clip.get("keyframes", [])
        kf_by_prop = get_clip_keyframes_by_property(clip_keyframes)
        
        # 计算文本位置 - 支持关键帧动画
        position_kf = kf_by_prop.get("position", [])
        opacity_kf = kf_by_prop.get("opacity", [])
        
        if position_kf:
            # 有位置关键帧
            x_pos = build_compound_keyframe_expression(position_kf, "x", position_sec, duration_sec, clip_x or width // 2)
            y_pos = build_compound_keyframe_expression(position_kf, "y", position_sec, duration_sec, clip_y or height // 2)
        elif clip_type == "subtitle":
            # 字幕使用预设位置
            if subtitle_position == "top":
                y_pos = f"{int(height * 0.1)}"
            elif subtitle_position == "center":
                y_pos = f"(h-text_h)/2"
            else:  # bottom
                y_pos = f"{int(height * 0.85)}"
            x_pos = "(w-text_w)/2"  # 居中
        else:
            # 普通文本使用 transform 坐标
            x_pos = str(int(clip_x)) if clip_x else "(w-text_w)/2"
            y_pos = str(int(clip_y)) if clip_y else "(h-text_h)/2"
        
        # 透明度 - 支持关键帧动画
        if opacity_kf:
            alpha_expr = build_keyframe_expression(opacity_kf, "opacity", position_sec, duration_sec, 1.0)
        else:
            alpha_expr = str(clip_opacity)
        
        text_overlays.append({
            "text": escape_ffmpeg_text(content_text),
            "start": position_sec,
            "end": position_sec + duration_sec,
            "fontsize": font_size,
            "fontcolor": font_color,
            "x": x_pos,
            "y": y_pos,
            "alpha": alpha_expr,  # 支持表达式
            "type": clip_type,
            "has_position_kf": bool(position_kf),
        })
        
        logger.info(f"[Export] 添加 {clip_type}: '{content_text[:20]}...' at {position_sec}s-{position_sec + duration_sec}s")
    
    # 添加背景（total_duration 已在函数开头计算）
    filter_parts.insert(0, base_filter)
    filter_parts.insert(1, silent_audio)
    
    # 合成视频轨道（overlay）- 支持位置关键帧动画
    current_video = "[base]"
    for i, vs in enumerate(video_streams):
        pos = vs["position"]
        stream = vs["stream"]
        dur = vs["duration"]
        
        # 检查是否有位置关键帧动画
        position_kf = vs.get("position_keyframes")
        clip_duration = vs.get("clip_duration", dur)
        
        output_label = f"[ov{i}]"
        
        if position_kf and len(position_kf) > 0:
            # 有位置关键帧 - 使用动态 x/y 表达式
            x_expr = build_compound_keyframe_expression(position_kf, "x", pos, clip_duration, 0)
            y_expr = build_compound_keyframe_expression(position_kf, "y", pos, clip_duration, 0)
            
            overlay_filter = f"{current_video}{stream}overlay="
            overlay_filter += f"x='{x_expr}':"
            overlay_filter += f"y='{y_expr}':"
            overlay_filter += f"enable='between(t,{pos},{pos + dur})'"
            overlay_filter += output_label
            
            logger.info(f"[Export] Video stream {i} 使用位置关键帧动画")
        else:
            # 无位置关键帧 - 静态位置 (居中)
            overlay_filter = f"{current_video}{stream}overlay=0:0:enable='between(t,{pos},{pos + dur})'{output_label}"
        
        filter_parts.append(overlay_filter)
        current_video = output_label
    
    # ★ 添加文本/字幕叠加
    for i, txt in enumerate(text_overlays):
        output_label = f"[txt{i}]"
        # drawtext 滤镜
        text_filter = f"{current_video}drawtext="
        text_filter += f"text='{txt['text']}':"
        text_filter += f"fontsize={txt['fontsize']}:"
        # drawtext 支持表达式的字段需要用单引号包裹
        has_expr = txt.get("has_position_kf", False) or ('+' in str(txt['alpha']))
        
        if has_expr:
            # 有表达式时使用单引号
            text_filter += f"x='{txt['x']}':y='{txt['y']}':"
        else:
            # 静态值直接使用
            text_filter += f"x={txt['x']}:y={txt['y']}:"
        
        # 透明度（alpha）- 通过 fontcolor 的 alpha 通道实现
        alpha_val = txt['alpha']
        if '+' in str(alpha_val):
            # 有表达式时，需要动态计算 fontcolor
            text_filter += f"fontcolor='{txt['fontcolor']}@({alpha_val})':"
        else:
            text_filter += f"fontcolor={txt['fontcolor']}@{alpha_val}:"
        
        text_filter += f"enable='between(t,{txt['start']},{txt['end']})'"
        # 字幕添加背景框
        if txt['type'] == 'subtitle':
            text_filter += ":box=1:boxcolor=black@0.5:boxborderw=5"
        text_filter += output_label
        filter_parts.append(text_filter)
        current_video = output_label
    
    # 添加水印
    if watermark:
        watermark_filter = build_watermark_filter(
            watermark, current_video, width, height
        )
        if watermark_filter:
            filter_parts.append(watermark_filter[0])
            current_video = watermark_filter[1]
    
    # 合成音频轨道（amerge）
    # 使用 duration=first 确保以第一个输入（[silent]，已限制时长）为基准
    if audio_streams:
        audio_inputs = "[silent]" + "".join(a["stream"] for a in audio_streams)
        n = len(audio_streams) + 1
        audio_merge = f"{audio_inputs}amix=inputs={n}:duration=first:dropout_transition=0[outa]"
        filter_parts.append(audio_merge)
    else:
        filter_parts.append("[silent]anull[outa]")
    
    # 最终输出标签
    final_video_label = current_video.strip("[]")
    filter_parts.append(f"{current_video}null[outv]")
    
    filter_complex = ";".join(filter_parts)
    
    logger.info(f"[Export] 滤镜图总时长: {total_duration}秒")
    
    return filter_complex, inputs


def build_watermark_filter(
    watermark: dict,
    input_label: str,
    width: int,
    height: int
) -> Optional[tuple]:
    """构建水印滤镜"""
    
    wm_text = watermark.get("text")
    wm_image = watermark.get("image")
    position = watermark.get("position", "bottom-right")
    opacity = watermark.get("opacity", 0.5)
    
    # 位置映射
    pos_map = {
        "top-left": "10:10",
        "top-right": f"{width - 200}:10",
        "bottom-left": f"10:{height - 50}",
        "bottom-right": f"{width - 200}:{height - 50}",
        "center": f"(W-w)/2:(H-h)/2",
    }
    
    xy = pos_map.get(position, pos_map["bottom-right"])
    
    if wm_text:
        # 文字水印
        filter_str = f"{input_label}drawtext="
        filter_str += f"text='{wm_text}':"
        filter_str += f"fontsize=24:fontcolor=white@{opacity}:"
        filter_str += f"x={xy.split(':')[0]}:y={xy.split(':')[1]}"
        filter_str += "[wm]"
        return (filter_str, "[wm]")
    
    return None


# ============================================
# FFmpeg 渲染
# ============================================

async def render_video(
    inputs: list,
    filter_graph: str,
    output_path: str,
    codec: str,
    audio_codec: str,
    preset: str,
    crf: str,
    width: str,
    height: str,
    fps: int,
    on_progress: Optional[callable] = None
):
    """执行 FFmpeg 渲染（内存优化版）"""
    
    # 构建命令
    cmd = ["ffmpeg", "-y"]
    
    # ============ 内存优化参数 ============
    # 限制线程数，减少并行内存占用（不影响输出质量）
    cmd.extend(["-threads", "2"])
    
    # 添加输入文件
    for input_file in inputs:
        cmd.extend(["-i", input_file])
    
    # 复杂滤镜
    cmd.extend(["-filter_complex", filter_graph])
    
    # 输出映射
    cmd.extend(["-map", "[outv]", "-map", "[outa]"])
    
    # 视频编码
    if codec == "libx264":
        cmd.extend([
            "-c:v", codec,
            "-preset", preset,
            "-crf", crf,
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",  # 优化网络播放（元数据前置）
        ])
    elif codec == "libvpx-vp9":
        cmd.extend([
            "-c:v", codec,
            "-b:v", "0",
            "-crf", crf,
        ])
    elif codec == "prores_ks":
        cmd.extend([
            "-c:v", codec,
            "-profile:v", "3",
        ])
    
    # 音频编码
    cmd.extend(["-c:a", audio_codec])
    if audio_codec == "aac":
        cmd.extend(["-b:a", "192k"])
    
    # 防止 muxing 队列溢出（不影响输出质量）
    cmd.extend(["-max_muxing_queue_size", "1024"])
    
    # 输出
    cmd.append(output_path)
    
    logger.info(f"FFmpeg 命令: {' '.join(cmd)}")
    
    # 使用 asyncio subprocess 执行，避免阻塞事件循环
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,  # 不缓存 stdout，节省内存
        stderr=asyncio.subprocess.PIPE,
    )
    
    # 流式读取 stderr，避免一次性加载全部日志到内存
    stderr_lines = []
    max_error_lines = 100  # 只保留最后 100 行用于错误诊断
    
    async for line in process.stderr:
        decoded_line = line.decode(errors='ignore').strip()
        if decoded_line:
            stderr_lines.append(decoded_line)
            # 只保留最后的错误信息，避免内存堆积
            if len(stderr_lines) > max_error_lines:
                stderr_lines.pop(0)
    
    await process.wait()
    
    if process.returncode != 0:
        error_msg = "\n".join(stderr_lines[-50:]) if stderr_lines else "Unknown error"
        logger.error(f"FFmpeg 错误: {error_msg}")
        raise RuntimeError(f"FFmpeg 渲染失败: {error_msg}")
    
    if on_progress:
        on_progress(100, "渲染完成")


# ============================================
# 上传与记录
# ============================================

async def upload_export(
    project_id: str,
    output_path: str,
    output_format: str
) -> str:
    """上传导出文件到 Supabase Storage"""
    from ..services.supabase_client import supabase, get_file_url
    
    export_filename = f"exports/{project_id}/{uuid.uuid4().hex}.{output_format}"
    
    with open(output_path, "rb") as f:
        supabase.storage.from_("export-videos").upload(
            export_filename,
            f.read(),
            {"content-type": f"video/{output_format}"}
        )
    
    return get_file_url("export-videos", export_filename)


async def save_export_record(project_id: str, result: dict):
    """保存导出记录到数据库"""
    from ..services.supabase_client import supabase
    
    supabase.table("exports").insert({
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "user_id": project_id,  # 暂时用 project_id，后续应从认证获取
        "status": "completed",
        "format": result.get("format", "mov"),
        "quality": "high",
        "resolution": {"preset": result.get("resolution")},
        "output_path": result["export_url"],
        "file_size": result["file_size"],
        "completed_at": result["created_at"]
    }).execute()


# ============================================
# Celery 任务
# ============================================

try:
    from ..celery_config import celery_app, update_task_progress, update_task_status
    
    @celery_app.task(bind=True, queue="gpu")
    def export_video_task(
        self,
        task_id: str,
        project_id: str,
        timeline: dict,
        settings: dict
    ):
        """Celery 视频导出任务"""
        import asyncio
        
        def on_progress(progress: int, step: str):
            update_task_progress(task_id, progress, step)
        
        try:
            update_task_status(task_id, "processing")
            
            result = asyncio.run(export_project(
                project_id=project_id,
                timeline=timeline,
                settings=settings,
                on_progress=on_progress
            ))
            
            update_task_status(task_id, "completed", result=result)
            return result
            
        except Exception as e:
            logger.error(f"导出任务失败: {e}")
            update_task_status(task_id, "failed", error=str(e))
            raise

except ImportError:
    logger.info("Celery 未配置，使用同步模式")


# ============================================
# 快速导出（单片段）
# ============================================

async def quick_export_segment(
    asset_url: str,
    start: float,
    end: float,
    output_format: str = "mp4"
) -> bytes:
    """快速导出单个片段（用于预览）"""
    import httpx
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # 下载源文件
        input_path = os.path.join(tmpdir, "input.mp4")
        
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(asset_url, follow_redirects=True)
            response.raise_for_status()
            
            with open(input_path, 'wb') as f:
                f.write(response.content)
        
        # 导出片段
        output_path = os.path.join(tmpdir, f"output.{output_format}")
        
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start),
            "-i", input_path,
            "-t", str(end - start),
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "28",
            "-c:a", "aac",
            "-b:a", "128k",
            output_path
        ]
        
        subprocess.run(cmd, check=True, capture_output=True)
        
        with open(output_path, 'rb') as f:
            return f.read()


# ============================================
# 导出预设
# ============================================

EXPORT_PRESETS = {
    "youtube_1080p": {
        "resolution": "1080p",
        "format": "mp4",
        "quality": "quality",
        "fps": 30,
    },
    "youtube_4k": {
        "resolution": "4k",
        "format": "mp4",
        "quality": "quality",
        "fps": 60,
    },
    "tiktok_vertical": {
        "resolution": "vertical_1080",
        "format": "mp4",
        "quality": "balanced",
        "fps": 30,
    },
    "instagram_square": {
        "resolution": "square_1080",
        "format": "mp4",
        "quality": "balanced",
        "fps": 30,
    },
    "wechat_video": {
        "resolution": "720p",
        "format": "mp4",
        "quality": "fast",
        "fps": 30,
    },
    "bilibili_1080p": {
        "resolution": "1080p",
        "format": "mp4",
        "quality": "quality",
        "fps": 60,
    },
}


def get_export_preset(name: str) -> dict:
    """获取导出预设"""
    return EXPORT_PRESETS.get(name, EXPORT_PRESETS["youtube_1080p"])
