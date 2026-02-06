"""
HoppingRabbit AI - 资源处理任务
处理上传的媒体文件：
- 生成代理视频（低分辨率预览）
- 提取波形数据
- 生成缩略图
- 提取元数据
- ★ faststart 优化（移动 moov atom 到文件开头，支持流式播放）
"""
import os
import tempfile
import logging
import json
import subprocess
import asyncio
from typing import Optional, Tuple
from uuid import uuid4
from datetime import datetime
import httpx

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================
# 配置
# ============================================

# 代理视频设置 - 720p 高质量预览
PROXY_WIDTH = 1280
PROXY_HEIGHT = 720
PROXY_BITRATE = "2M"  # 2 Mbps，平衡质量和文件大小
PROXY_CRF = "23"  # CRF 质量参数，18-28 越小越好
PROXY_FPS = 30
PROXY_PRESET = "fast"  # 编码速度： ultrafast, superfast, veryfast, faster, fast, medium

# 缩略图设置
THUMBNAIL_WIDTH = 320
THUMBNAIL_HEIGHT = 180
THUMBNAIL_COUNT = 5

# 波形设置
WAVEFORM_SAMPLES = 1000

# ============================================
# HLS 流式播放设置
# ============================================
HLS_SEGMENT_DURATION = 4  # 每个分片 4 秒
HLS_PLAYLIST_TYPE = "vod"  # VOD 模式（保留所有分片）
HLS_VIDEO_BITRATES = [
    {"height": 360, "bitrate": "800k", "name": "360p"},
    {"height": 720, "bitrate": "2500k", "name": "720p"},
]
# 当前只使用单码率（720p），未来可扩展为自适应码率
HLS_DEFAULT_QUALITY = "720p"


# ============================================
# 核心处理函数
# ============================================

async def process_asset(
    asset_id: str,
    asset_url: str,
    asset_type: str,
    on_progress: Optional[callable] = None
) -> dict:
    """
    处理媒体资源
    
    Args:
        asset_id: 资源 ID
        asset_url: 资源 URL
        asset_type: 资源类型 (video, audio, image)
        on_progress: 进度回调
    
    Returns:
        dict: 处理结果
    """
    
    # 1. 下载文件
    if on_progress:
        on_progress(5, "下载媒体文件")
    
    media_path = await download_media(asset_url)
    
    try:
        results = {
            "metadata": {},
            "proxy_url": None,
            "thumbnail_url": None,
            "waveform_data": None,
            "hls_path": None,  # ★ HLS 流路径
        }
        
        # 2. 提取元数据
        if on_progress:
            on_progress(10, "提取元数据")
        
        results["metadata"] = extract_metadata(media_path)
        
        # 3. 根据类型处理
        if asset_type == "video":
            # ★ 生成 HLS 流（优先级最高，用于播放）
            if on_progress:
                on_progress(20, "生成 HLS 流")
            
            hls_path = await generate_hls_stream(asset_id, media_path)
            results["hls_path"] = hls_path
            
            # 生成缩略图
            if on_progress:
                on_progress(60, "生成缩略图")
            
            thumbnail_url = await generate_thumbnail(asset_id, media_path)
            results["thumbnail_url"] = thumbnail_url
            
            # 提取音频波形
            if on_progress:
                on_progress(80, "提取波形数据")
            
            waveform = extract_waveform(media_path)
            results["waveform_data"] = waveform
            
        elif asset_type == "audio":
            # 提取波形
            if on_progress:
                on_progress(50, "提取波形数据")
            
            waveform = extract_waveform(media_path)
            results["waveform_data"] = waveform
            
        elif asset_type == "image":
            # 生成缩略图
            if on_progress:
                on_progress(50, "生成缩略图")
            
            thumbnail_url = await generate_image_thumbnail(asset_id, media_path)
            results["thumbnail_url"] = thumbnail_url
        
        # 4. 更新资源记录
        if on_progress:
            on_progress(95, "更新资源信息")
        
        await update_asset_record(asset_id, results)
        
        if on_progress:
            on_progress(100, "处理完成")
        
        return results
        
    finally:
        # 清理临时文件
        if os.path.exists(media_path):
            os.remove(media_path)


# ============================================
# 元数据提取
# ============================================

def extract_metadata(file_path: str) -> dict:
    """使用 FFprobe 提取媒体元数据"""
    try:
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            file_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            logger.error(f"FFprobe 错误: {result.stderr}")
            return {}
        
        data = json.loads(result.stdout)
        
        metadata = {
            "duration": float(data.get("format", {}).get("duration", 0)),
            "bitrate": int(data.get("format", {}).get("bit_rate", 0)),
        }
        
        # 提取视频流信息
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                metadata["width"] = stream.get("width")
                metadata["height"] = stream.get("height")
                # r_frame_rate 格式如 "30/1"，eval 后取整
                fps_str = stream.get("r_frame_rate", "0/1")
                try:
                    fps_value = eval(fps_str)
                    metadata["fps"] = int(round(fps_value)) if fps_value else 30
                except:
                    metadata["fps"] = 30
                metadata["codec"] = stream.get("codec_name")
                metadata["has_video"] = True
            elif stream.get("codec_type") == "audio":
                metadata["sample_rate"] = int(stream.get("sample_rate", 0))
                metadata["channels"] = stream.get("channels")
                metadata["audio_codec"] = stream.get("codec_name")
                metadata["has_audio"] = True
        
        return metadata
        
    except Exception as e:
        logger.error(f"元数据提取失败: {e}")
        return {}


# ============================================
# ★★★ 以下函数已废弃 - Cloudflare Stream 自动处理 ★★★
# ============================================
# 保留代码以兼容旧的导入，但不再使用

async def apply_faststart(asset_id: str, video_url: str) -> Tuple[bool, str]:
    """
    ★ 已废弃：Cloudflare Stream 自动优化
    保留函数签名以兼容旧代码
    """
    logger.warning(f"[Faststart] ⚠️ 已废弃，Cloudflare 自动处理: {asset_id[:8]}...")
    return (True, "Deprecated: Cloudflare handles optimization")


async def _apply_faststart_legacy(asset_id: str, video_url: str) -> Tuple[bool, str]:
    """
    ★ 原 apply_faststart 实现，保留备用
    对 MP4 视频应用 faststart 优化，将 moov atom 移到文件开头
    
    ★ 原理：
    - MP4 文件有一个 "moov" 原子包含视频索引信息
    - 如果 moov 在文件末尾，浏览器需要下载整个文件才能播放
    - faststart 将 moov 移到开头，浏览器可以立即开始播放
    
    ★ 性能：
    - 不重新编码，只是移动字节
    - 200MB 视频只需 5-15 秒
    - CPU 占用 < 5%
    
    Args:
        asset_id: 资源 ID
        video_url: Supabase 视频签名 URL
    
    Returns:
        (success, message)
    """
    logger.info(f"[Faststart] 🚀 开始优化: {asset_id[:8]}...")
    
    temp_input = None
    temp_output = None
    
    try:
        from ..services.supabase_client import supabase
        
        # 1. 创建临时文件
        temp_input = tempfile.mktemp(suffix=".mp4", prefix=f"fs_in_{asset_id[:8]}_")
        temp_output = tempfile.mktemp(suffix=".mp4", prefix=f"fs_out_{asset_id[:8]}_")
        
        # 2. 下载视频（流式下载，节省内存）
        logger.info(f"[Faststart] 📥 下载视频...")
        start_time = datetime.now()
        
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream("GET", video_url) as response:
                if response.status_code != 200:
                    return False, f"下载失败: HTTP {response.status_code}"
                
                total_size = int(response.headers.get("content-length", 0))
                downloaded = 0
                
                with open(temp_input, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):  # 1MB chunks
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0 and downloaded % (10 * 1024 * 1024) == 0:  # 每 10MB 打印一次
                            progress = downloaded / total_size * 100
                            logger.info(f"[Faststart] 📥 下载进度: {progress:.1f}%")
        
        download_time = (datetime.now() - start_time).total_seconds()
        file_size_mb = os.path.getsize(temp_input) / 1024 / 1024
        logger.info(f"[Faststart] 📥 下载完成: {file_size_mb:.1f}MB, 耗时: {download_time:.1f}s")
        
        # 3. 检查是否已经是 faststart（moov 在前面）
        is_already_faststart = await check_moov_position(temp_input)
        if is_already_faststart:
            logger.info(f"[Faststart] ✅ 视频已是 faststart，跳过处理")
            return True, "already_optimized"
        
        # 4. 应用 faststart（不重新编码，只移动 moov）
        logger.info(f"[Faststart] 🔧 应用 faststart 优化...")
        start_time = datetime.now()
        
        cmd = [
            "ffmpeg",
            "-i", temp_input,
            "-c", "copy",  # 不重新编码，只复制流
            "-movflags", "+faststart",  # 将 moov 移到开头
            "-y",  # 覆盖输出
            temp_output
        ]
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            error_msg = stderr.decode()[-500:] if stderr else "Unknown error"
            logger.error(f"[Faststart] ❌ FFmpeg 失败: {error_msg}")
            return False, f"FFmpeg error: {error_msg}"
        
        process_time = (datetime.now() - start_time).total_seconds()
        output_size_mb = os.path.getsize(temp_output) / 1024 / 1024
        logger.info(f"[Faststart] 🔧 处理完成: {output_size_mb:.1f}MB, 耗时: {process_time:.1f}s")
        
        # 5. 获取原始存储路径
        asset_result = supabase.table("assets").select("storage_path").eq("id", asset_id).single().execute()
        if not asset_result.data or not asset_result.data.get("storage_path"):
            return False, "Asset storage_path not found"
        
        storage_path = asset_result.data["storage_path"]
        logger.info(f"[Faststart] 📤 上传到: {storage_path}")
        
        # 6. 上传优化后的文件（覆盖原文件）
        start_time = datetime.now()
        
        with open(temp_output, "rb") as f:
            file_content = f.read()
        
        # 使用 upsert 覆盖原文件
        result = supabase.storage.from_("clips").upload(
            storage_path,
            file_content,
            {"content-type": "video/mp4", "upsert": "true"}
        )
        
        if hasattr(result, 'error') and result.error:
            return False, f"Upload failed: {result.error}"
        
        upload_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"[Faststart] 📤 上传完成, 耗时: {upload_time:.1f}s")
        
        # 7. 更新 asset 状态
        supabase.table("assets").update({
            "faststart_applied": True,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", asset_id).execute()
        
        total_time = download_time + process_time + upload_time
        logger.info(f"[Faststart] ✅ 优化完成! 总耗时: {total_time:.1f}s (下载:{download_time:.1f}s + 处理:{process_time:.1f}s + 上传:{upload_time:.1f}s)")
        
        return True, "success"
        
    except Exception as e:
        logger.error(f"[Faststart] ❌ 失败: {e}")
        import traceback
        logger.error(f"[Faststart] 堆栈: {traceback.format_exc()}")
        return False, str(e)
        
    finally:
        # 清理临时文件
        for temp_file in [temp_input, temp_output]:
            if temp_file and os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except:
                    pass


async def check_moov_position(file_path: str) -> bool:
    """
    检查 MP4 文件的 moov atom 是否在文件开头（已是 faststart）
    
    Returns:
        True 如果 moov 在 mdat 之前（已优化）
        False 如果 moov 在 mdat 之后（需要优化）
    """
    try:
        with open(file_path, "rb") as f:
            # 读取前 64KB 检查 atom 结构
            header = f.read(64 * 1024)
            
            # 查找 moov 和 mdat 的位置
            moov_pos = header.find(b"moov")
            mdat_pos = header.find(b"mdat")
            
            if moov_pos == -1:
                # moov 不在前 64KB，说明在文件后面
                return False
            
            if mdat_pos == -1:
                # mdat 不在前 64KB，可能 moov 在前面
                return True
            
            # 比较位置
            return moov_pos < mdat_pos
            
    except Exception as e:
        logger.warning(f"[Faststart] 检查 moov 位置失败: {e}")
        return False  # 假设需要优化


# ============================================
# HLS 流式播放生成
# ============================================

async def generate_hls_stream(asset_id: str, input_path: str) -> Optional[str]:
    """生成 HLS 流式播放文件（.m3u8 + .ts 分片）
    
    输出规格:
    - 分辨率: 根据项目设置裁剪到 9:16 或 16:9，然后缩放到 720p
    - 编码: H.264 (Main Profile, Level 3.1 - 兼容性好)
    - 分片: 4 秒每片
    - 格式: fMP4 (兼容性更好) 或 TS
    
    优点:
    - 内存占用极低（只缓冲几个分片）
    - Seek 响应快（只需加载目标分片）
    - 支持任意时长视频
    
    Returns:
        HLS 目录路径（如 "hls/{asset_id}/"），失败返回 None
    """
    try:
        from ..services.supabase_client import supabase
        from ..services.video_utils import calculate_crop_area, AspectRatio
        import shutil
        
        # 获取原始视频信息
        metadata = extract_metadata(input_path)
        original_width = metadata.get("width", 1920)
        original_height = metadata.get("height", 1080)
        duration = metadata.get("duration", 0)
        
        logger.info(f"[HLS] 开始生成: {asset_id}, 原始分辨率: {original_width}x{original_height}, 时长: {duration:.1f}s")
        
        # ★★★ 获取项目目标比例，用于裁剪 ★★★
        target_aspect_ratio: Optional[str] = None
        try:
            # 从 asset 获取 project_id
            asset_result = supabase.table("assets").select("project_id").eq("id", asset_id).single().execute()
            if asset_result.data and asset_result.data.get("project_id"):
                project_id = asset_result.data["project_id"]
                # 从 project 获取 resolution
                project_result = supabase.table("projects").select("resolution").eq("id", project_id).single().execute()
                if project_result.data and project_result.data.get("resolution"):
                    resolution = project_result.data["resolution"]
                    # 根据 resolution 判断目标比例
                    if resolution.get("width") and resolution.get("height"):
                        if resolution["width"] > resolution["height"]:
                            target_aspect_ratio = "16:9"
                        else:
                            target_aspect_ratio = "9:16"
                        logger.info(f"[HLS] 📐 项目目标比例: {target_aspect_ratio} (resolution={resolution})")
        except Exception as e:
            logger.warning(f"[HLS] ⚠️ 获取项目比例失败，使用原始比例: {e}")
        
        # 创建临时目录
        hls_temp_dir = tempfile.mkdtemp(prefix=f"hls_{asset_id}_")
        playlist_path = os.path.join(hls_temp_dir, "playlist.m3u8")
        segment_pattern = os.path.join(hls_temp_dir, "segment_%03d.ts")
        
        # ★★★ 计算滤镜链：裁剪 → 缩放 ★★★
        filter_parts = []
        
        # 1. 裁剪滤镜（如果需要）
        if target_aspect_ratio:
            # 计算源视频比例
            source_ratio = original_width / original_height
            target_ratio = 16/9 if target_aspect_ratio == "16:9" else 9/16
            
            # 只有比例不匹配时才裁剪
            ratio_diff = abs(source_ratio - target_ratio) / target_ratio
            if ratio_diff > 0.05:  # 超过 5% 差异才裁剪
                crop_x, crop_y, crop_w, crop_h = calculate_crop_area(
                    original_width, 
                    original_height, 
                    AspectRatio(target_aspect_ratio),
                    alignment="center"
                )
                crop_filter = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}"
                filter_parts.append(crop_filter)
                # 记录裁剪后的分辨率（用于后续更新 metadata）
                cropped_width, cropped_height = crop_w, crop_h
                logger.info(f"[HLS] ✂️ 应用裁剪滤镜: {crop_filter}, 裁剪后: {crop_w}x{crop_h}")
            else:
                cropped_width, cropped_height = original_width, original_height
                logger.info(f"[HLS] ✅ 比例接近目标，无需裁剪 (diff={ratio_diff:.2%})")
        else:
            cropped_width, cropped_height = original_width, original_height
        
        # 2. 缩放滤镜
        if target_aspect_ratio == "16:9":
            # 横屏视频：宽度不超过 1280
            scale_filter = "scale='min(1280,iw):-2'"
        else:
            # 竖屏视频：高度不超过 1280
            scale_filter = "scale='-2:min(1280,ih)'"
        filter_parts.append(scale_filter)
        
        # 3. 帧率滤镜
        filter_parts.append("fps=30")
        
        # 组合滤镜链
        video_filter = ",".join(filter_parts)
        logger.info(f"[HLS] 🎬 视频滤镜链: {video_filter}")
        
        # FFmpeg HLS 生成命令
        # 🎯 预览使用 30fps，提升浏览器解码性能，最终导出支持 60fps
        cmd = [
            "ffmpeg",
            "-i", input_path,
            # 视频编码（使用组合滤镜链：裁剪 → 缩放 → 帧率）
            "-vf", video_filter,
            "-r", "30",  # 输出帧率 30fps
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-profile:v", "main",  # Main profile 兼容性好
            "-level", "3.1",
            # 音频编码
            "-c:a", "aac",
            "-b:a", "128k",
            "-ac", "2",  # 立体声
            # HLS 参数
            "-f", "hls",
            "-hls_time", str(HLS_SEGMENT_DURATION),
            "-hls_list_size", "0",  # 保留所有分片（VOD 模式）
            "-hls_playlist_type", HLS_PLAYLIST_TYPE,
            "-hls_segment_filename", segment_pattern,
            "-hls_flags", "independent_segments",  # 每个分片独立可解码
            # 优化 seek（GOP = 分片时长 * 30fps）
            "-g", str(HLS_SEGMENT_DURATION * 30),  # GOP 大小 = 分片时长 * fps
            "-keyint_min", str(HLS_SEGMENT_DURATION * 30),
            "-sc_threshold", "0",  # 禁用场景切换检测，确保固定 GOP
            "-y",
            playlist_path
        ]
        
        logger.info(f"[HLS] 执行 FFmpeg 命令...")
        start_time = datetime.now()
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)  # 30 分钟超时
        
        if result.returncode != 0:
            logger.error(f"[HLS] FFmpeg 失败: {result.stderr[:1000]}")
            shutil.rmtree(hls_temp_dir, ignore_errors=True)
            return None
        
        # 检查生成的文件
        if not os.path.exists(playlist_path):
            logger.error(f"[HLS] 播放列表文件不存在")
            shutil.rmtree(hls_temp_dir, ignore_errors=True)
            return None
        
        # 统计生成的分片
        segment_files = [f for f in os.listdir(hls_temp_dir) if f.endswith('.ts')]
        total_size = sum(os.path.getsize(os.path.join(hls_temp_dir, f)) for f in os.listdir(hls_temp_dir))
        
        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(f"[HLS] 生成完成: {len(segment_files)} 个分片, 总大小: {total_size / 1024 / 1024:.1f} MB, 耗时: {elapsed:.1f}s")
        
        # 上传到 Supabase Storage
        hls_storage_dir = f"hls/{asset_id}"
        uploaded_count = 0
        
        for filename in os.listdir(hls_temp_dir):
            file_path = os.path.join(hls_temp_dir, filename)
            storage_path = f"{hls_storage_dir}/{filename}"
            
            # 确定 content-type
            if filename.endswith('.m3u8'):
                content_type = "application/vnd.apple.mpegurl"
            elif filename.endswith('.ts'):
                content_type = "video/mp2t"
            else:
                content_type = "application/octet-stream"
            
            with open(file_path, 'rb') as f:
                try:
                    # 先尝试删除旧的（如果存在）
                    try:
                        supabase.storage.from_("clips").remove([storage_path])
                    except:
                        pass
                    supabase.storage.from_("clips").upload(
                        storage_path, 
                        f, 
                        file_options={"content-type": content_type}
                    )
                    uploaded_count += 1
                except Exception as upload_error:
                    logger.error(f"[HLS] 上传失败 {filename}: {upload_error}")
        
        # 清理临时目录
        shutil.rmtree(hls_temp_dir, ignore_errors=True)
        
        if uploaded_count == 0:
            logger.error(f"[HLS] 没有文件上传成功")
            return None
        
        # 更新数据库记录（包含裁剪后的分辨率）
        try:
            update_data = {
                "hls_path": hls_storage_dir,
            }
            # ★ 如果进行了裁剪，更新 metadata 中的宽高为裁剪后的值
            if target_aspect_ratio and (cropped_width != original_width or cropped_height != original_height):
                update_data["width"] = cropped_width
                update_data["height"] = cropped_height
                logger.info(f"[HLS] 📐 更新分辨率: {original_width}x{original_height} → {cropped_width}x{cropped_height}")
            
            supabase.table("assets").update(update_data).eq("id", asset_id).execute()
            logger.info(f"[HLS] 已更新数据库: hls_path = {hls_storage_dir}")
        except Exception as db_error:
            logger.warning(f"[HLS] 更新数据库失败: {db_error}")
        except Exception as db_error:
            logger.warning(f"[HLS] 更新数据库失败: {db_error}")
        
        logger.info(f"[HLS] ✅ 完成! 上传 {uploaded_count} 个文件到 {hls_storage_dir}")
        return hls_storage_dir
        
    except subprocess.TimeoutExpired:
        logger.error(f"[HLS] FFmpeg 超时（超过 30 分钟）")
        return None
    except Exception as e:
        logger.error(f"[HLS] 生成失败: {e}")
        import traceback
        traceback.print_exc()
        return None


async def generate_hls_from_url(asset_id: str, video_url: str, extract_audio: bool = True) -> Optional[str]:
    """
    ★ 已废弃：Cloudflare Stream 自动生成 HLS
    保留函数签名以兼容旧代码
    """
    logger.warning(f"[HLS] ⚠️ 已废弃，Cloudflare 自动处理: {asset_id[:8]}...")
    return None


async def _generate_hls_from_url_legacy(asset_id: str, video_url: str, extract_audio: bool = True) -> Optional[str]:
    """
    ★ 原 generate_hls_from_url 实现，保留备用
    从远程视频 URL 直接生成 HLS 流（FFmpeg 直读 URL，无需完整下载）
    
    ★★★ 优化版本：边生成边上传 + 同时提取音频 ★★★
    - FFmpeg 生成分片时，后台协程立即上传已完成的分片
    - 同时提取 16kHz 单声道音频用于 ASR（可选）
    - 用户可以在部分分片可用后就开始播放
    - 大幅提升首帧可见时间 (Time to First Frame)
    - ★ 只读取一次远程视频，同时生成 HLS 和音频
    - ★ 实时更新数据库进度，前端可展示给用户
    
    Args:
        asset_id: 资源 ID
        video_url: 视频的远程 URL
        extract_audio: 是否同时提取音频用于 ASR（默认 True）
    
    Returns:
        HLS 目录路径（如 "hls/{asset_id}/"），失败返回 None
    """
    import asyncio
    import shutil
    
    # ★ 进度更新函数（节流：每秒最多更新一次）
    last_progress_update = {"time": 0}
    
    def update_hls_progress(progress: int, message: str, force: bool = False):
        """更新 HLS 处理进度到数据库"""
        import time
        now = time.time()
        # 节流：每秒最多更新一次，除非强制更新
        if not force and now - last_progress_update["time"] < 1:
            return
        last_progress_update["time"] = now
        
        try:
            supabase.table("assets").update({
                "hls_progress": progress,
                "hls_message": message,
                "hls_status": "processing",
            }).eq("id", asset_id).execute()
        except Exception as e:
            logger.debug(f"[HLS-Stream] 进度更新失败: {e}")
    
    try:
        from ..services.supabase_client import supabase
        
        logger.info(f"[HLS-Stream] 🚀 开始边生成边上传: {asset_id}, extract_audio={extract_audio}")
        update_hls_progress(0, "准备中...", force=True)
        
        # 创建临时目录
        hls_temp_dir = tempfile.mkdtemp(prefix=f"hls_{asset_id}_")
        playlist_path = os.path.join(hls_temp_dir, "playlist.m3u8")
        segment_pattern = os.path.join(hls_temp_dir, "segment_%03d.ts")
        audio_path = os.path.join(hls_temp_dir, "audio_for_asr.mp3") if extract_audio else None
        hls_storage_dir = f"hls/{asset_id}"
        
        # 已上传的分片集合
        uploaded_segments = set()
        upload_lock = asyncio.Lock()
        upload_errors = []
        ffmpeg_finished = asyncio.Event()  # FFmpeg 完成信号
        
        async def upload_segment(filename: str) -> bool:
            """上传单个分片到 Supabase Storage"""
            file_path = os.path.join(hls_temp_dir, filename)
            storage_path = f"{hls_storage_dir}/{filename}"
            
            # 确定 content-type
            if filename.endswith('.m3u8'):
                content_type = "application/vnd.apple.mpegurl"
                # 添加 Cache-Control: 短缓存，因为会更新
                cache_control = "public, max-age=2"
            elif filename.endswith('.ts'):
                content_type = "video/mp2t"
                # 分片文件长缓存（不变）
                cache_control = "public, max-age=31536000, immutable"
            else:
                return False
            
            try:
                with open(file_path, 'rb') as f:
                    data = f.read()
                
                # 先删除旧文件（如果存在）
                try:
                    supabase.storage.from_("clips").remove([storage_path])
                except:
                    pass
                
                supabase.storage.from_("clips").upload(
                    storage_path, 
                    data, 
                    file_options={
                        "content-type": content_type,
                        "cache-control": cache_control
                    }
                )
                return True
            except Exception as e:
                logger.error(f"[HLS-Stream] 上传失败 {filename}: {e}")
                upload_errors.append(f"{filename}: {e}")
                return False
        
        async def monitor_and_upload():
            """监控目录，边生成边上传分片"""
            consecutive_empty = 0
            max_wait_cycles = 600  # 600 * 0.5s = 300s = 5分钟（远程视频下载可能很慢）
            
            while True:
                # 检查 FFmpeg 是否已完成
                if ffmpeg_finished.is_set():
                    # FFmpeg 完成后，再扫描一次确保所有分片都上传
                    await asyncio.sleep(0.5)
                    break
                
                await asyncio.sleep(0.5)  # 每 500ms 检查一次
                
                if not os.path.exists(hls_temp_dir):
                    break
                
                # 扫描新生成的分片
                current_files = set(f for f in os.listdir(hls_temp_dir) if f.endswith('.ts'))
                new_files = current_files - uploaded_segments
                
                if new_files:
                    consecutive_empty = 0
                    for filename in sorted(new_files):
                        file_path = os.path.join(hls_temp_dir, filename)
                        # 检查文件是否写入完成（大小稳定）
                        try:
                            size1 = os.path.getsize(file_path)
                            await asyncio.sleep(0.1)
                            size2 = os.path.getsize(file_path)
                            
                            if size1 == size2 and size1 > 0:
                                # 文件写入完成，立即上传
                                async with upload_lock:
                                    if filename not in uploaded_segments:
                                        success = await upload_segment(filename)
                                        if success:
                                            uploaded_segments.add(filename)
                                            segment_count = len(uploaded_segments)
                                            logger.info(f"[HLS-Stream] ✅ 已上传分片: {filename} ({segment_count}个)")
                                            # ★ 更新进度：分片上传进度 (50-90%)
                                            update_hls_progress(50 + min(40, segment_count * 5), f"上传分片 {segment_count}...")
                        except FileNotFoundError:
                            pass
                else:
                    consecutive_empty += 1
                    # 每 10 秒输出一次等待日志（更及时发现问题）
                    if consecutive_empty % 20 == 0:  # 20 * 0.5s = 10s
                        wait_secs = consecutive_empty * 0.5
                        logger.info(f"[HLS-Stream] ⏳ 等待 FFmpeg 生成分片... ({wait_secs:.0f}秒)")
                        # ★ 更新进度
                        update_hls_progress(10, f"正在处理视频... ({wait_secs:.0f}秒)")
                
                # 如果连续 5 分钟没有新分片且 FFmpeg 未通知完成，可能有问题
                if consecutive_empty > max_wait_cycles:
                    logger.warning(f"[HLS-Stream] ⚠️ 监控超时（5分钟无新分片），FFmpeg 可能卡住或下载失败")
                    break
        
        # ★★★ 检查是否需要提取音频（如果已缓存则跳过）★★★
        audio_storage_path = f"asr_audio/{asset_id}.mp3"
        should_extract_audio = extract_audio
        
        if extract_audio:
            try:
                from ..services.supabase_client import supabase
                # 尝试直接获取签名 URL，如果成功说明文件存在
                result = supabase.storage.from_("clips").create_signed_url(audio_storage_path, 60)
                if result.get("signedURL") or result.get("signedUrl") or result.get("signed_url"):
                    logger.info(f"[HLS-Stream] 📦 音频缓存已存在，跳过提取")
                    should_extract_audio = False
            except:
                pass  # 缓存不存在，需要提取
        
        # FFmpeg 命令
        # 注意：添加 -pix_fmt yuv420p 强制转换为 8-bit，解决 10-bit HEVC 不兼容问题
        # ★ 如果需要提取音频，使用 tee muxer 同时输出 HLS 和音频
        
        # ★ 编码器 preset：使用 fast 平衡速度和质量
        # 对于大多数用例（H.264/HEVC/ProRes 输入），fast preset 已足够快
        # 如果未来需要进一步优化，可考虑：
        # - 检测实际编码格式（用 ffprobe）来决定 preset
        # - 对高分辨率（4K+）使用 faster preset
        encoder_preset = "fast"
        
        if should_extract_audio and audio_path:
            # 使用 -map 分别处理视频和音频流
            cmd = [
                "ffmpeg",
                "-stats",  # 强制输出进度信息
                "-i", video_url,
                # 输出1：HLS 视频流
                "-map", "0:v:0", "-map", "0:a:0?",  # 视频+音频（音频可选）
                "-vf", "scale='min(1280,iw):-2',format=yuv420p",
                "-c:v", "libx264",
                "-preset", encoder_preset,  # 动态 preset: ProRes 用 faster
                "-crf", "23",
                "-profile:v", "high",
                "-level", "4.0",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ac", "2",
                "-f", "hls",
                "-hls_time", str(HLS_SEGMENT_DURATION),
                "-hls_list_size", "0",
                "-hls_playlist_type", HLS_PLAYLIST_TYPE,
                "-hls_segment_filename", segment_pattern,
                "-hls_flags", "independent_segments",
                "-g", str(HLS_SEGMENT_DURATION * 30),
                "-keyint_min", str(HLS_SEGMENT_DURATION * 30),
                "-sc_threshold", "0",
                playlist_path,
                # 输出2：ASR 音频（16kHz 单声道 64kbps）
                "-map", "0:a:0?",  # 只要音频流
                "-vn",
                "-ar", "16000",
                "-ac", "1",
                "-b:a", "64k",
                "-f", "mp3",
                audio_path,
                "-y",
            ]
            logger.info(f"[HLS-Stream] 🎬 使用多输出模式: HLS + ASR 音频")
        else:
            # 只生成 HLS
            cmd = [
                "ffmpeg",
                "-stats",  # 强制输出进度信息
                "-i", video_url,
                "-vf", "scale='min(1280,iw):-2',format=yuv420p",  # 强制 8-bit 像素格式
                "-c:v", "libx264",
                "-preset", encoder_preset,  # 动态 preset: ProRes 用 faster
                "-crf", "23",
                "-profile:v", "high",  # 改用 high profile，兼容性更好
                "-level", "4.0",       # 提升 level 以支持更高分辨率
                "-c:a", "aac",
                "-b:a", "128k",
                "-ac", "2",
                "-f", "hls",
                "-hls_time", str(HLS_SEGMENT_DURATION),
                "-hls_list_size", "0",
                "-hls_playlist_type", HLS_PLAYLIST_TYPE,
                "-hls_segment_filename", segment_pattern,
                "-hls_flags", "independent_segments",
                "-g", str(HLS_SEGMENT_DURATION * 30),
                "-keyint_min", str(HLS_SEGMENT_DURATION * 30),
                "-sc_threshold", "0",
                "-y",
                playlist_path
            ]
        
        logger.info(f"[HLS-Stream] 🎬 FFmpeg 命令: {' '.join(cmd[:5])}...")
        logger.info(f"[HLS-Stream] 📥 输入 URL: {video_url[:150]}...")
        logger.info(f"[HLS-Stream] 启动 FFmpeg + 后台上传监控...")
        start_time = datetime.now()
        
        # 启动上传监控任务
        monitor_task = asyncio.create_task(monitor_and_upload())
        
        # FFmpeg 进度状态（供监控任务参考）
        ffmpeg_progress = {"time": "00:00:00", "speed": "0x", "last_log": 0}
        
        async def read_ffmpeg_progress(stderr_stream):
            """实时读取 FFmpeg stderr 并解析进度"""
            import re
            stderr_lines = []
            last_progress_time = datetime.now()
            
            while True:
                line = await stderr_stream.readline()
                if not line:
                    break
                
                line_text = line.decode('utf-8', errors='ignore').strip()
                stderr_lines.append(line_text)
                
                # 解析 FFmpeg 进度行 (例如: "frame=  120 fps= 30 ... time=00:00:04.00 ... speed=1.5x")
                if 'time=' in line_text:
                    time_match = re.search(r'time=(\d+:\d+:\d+\.\d+)', line_text)
                    speed_match = re.search(r'speed=\s*([\d.]+x|N/A)', line_text)
                    
                    if time_match:
                        ffmpeg_progress["time"] = time_match.group(1)
                    if speed_match:
                        ffmpeg_progress["speed"] = speed_match.group(1)
                    
                    # 每 10 秒输出一次进度
                    now = datetime.now()
                    if (now - last_progress_time).total_seconds() >= 10:
                        logger.info(f"[HLS-Stream] 📊 FFmpeg 编码进度: time={ffmpeg_progress['time']}, speed={ffmpeg_progress['speed']}")
                        last_progress_time = now
                        # ★ 更新数据库进度（让前端展示）
                        update_hls_progress(30, f"编码中: {ffmpeg_progress['time']} ({ffmpeg_progress['speed']})")
                
                # 检测常见状态
                if 'Opening' in line_text and 'for reading' in line_text:
                    logger.info(f"[HLS-Stream] 📥 开始下载远程视频...")
                    update_hls_progress(5, "正在下载远程视频...", force=True)
                elif 'Stream mapping' in line_text:
                    logger.info(f"[HLS-Stream] 🔄 视频流映射完成，开始编码...")
                    update_hls_progress(15, "视频分析完成，开始编码...", force=True)
            
            return '\n'.join(stderr_lines)
        
        # 异步执行 FFmpeg
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # 创建进度读取任务
            stderr_task = asyncio.create_task(read_ffmpeg_progress(process.stderr))
            
            # 等待进程完成
            try:
                await asyncio.wait_for(process.wait(), timeout=1800)  # 30 分钟超时
                stderr_text = await stderr_task
            except asyncio.TimeoutError:
                logger.error(f"[HLS-Stream] FFmpeg 超时")
                process.kill()
                monitor_task.cancel()
                shutil.rmtree(hls_temp_dir, ignore_errors=True)
                return None
            
            if process.returncode != 0:
                # 从 stderr 末尾提取真正的错误信息
                stderr_lines = stderr_text.strip().split('\n')
                # 取最后 20 行，通常包含真正的错误
                error_lines = stderr_lines[-20:] if len(stderr_lines) > 20 else stderr_lines
                error_tail = '\n'.join(error_lines)
                
                logger.error(f"[HLS-Stream] FFmpeg 失败 (returncode={process.returncode})")
                logger.error(f"[HLS-Stream] 输入 URL: {video_url[:200]}...")
                logger.error(f"[HLS-Stream] stderr 末尾:\n{error_tail}")
                monitor_task.cancel()
                shutil.rmtree(hls_temp_dir, ignore_errors=True)
                return None
                
        except Exception as e:
            logger.error(f"[HLS-Stream] FFmpeg 执行异常: {e}")
            if 'process' in locals():
                process.kill()
            monitor_task.cancel()
            shutil.rmtree(hls_temp_dir, ignore_errors=True)
            return None
        
        # 通知监控任务 FFmpeg 已完成
        ffmpeg_finished.set()
        
        # 等待上传监控完成剩余工作
        await asyncio.sleep(1)
        monitor_task.cancel()
        try:
            await monitor_task
        except asyncio.CancelledError:
            pass
        
        elapsed = (datetime.now() - start_time).total_seconds()
        
        # 上传剩余的分片（可能遗漏的）
        remaining_files = set(f for f in os.listdir(hls_temp_dir) if f.endswith('.ts')) - uploaded_segments
        for filename in remaining_files:
            success = await upload_segment(filename)
            if success:
                uploaded_segments.add(filename)
        
        # ★ 更新进度：上传播放列表
        update_hls_progress(95, "上传播放列表...", force=True)
        
        # 最后上传 playlist（包含完整分片列表）
        if os.path.exists(playlist_path):
            await upload_segment("playlist.m3u8")
        
        logger.info(f"[HLS-Stream] 📊 FFmpeg 完成: {len(uploaded_segments)} 个分片, 耗时: {elapsed:.1f}s")
        
        # ★★★ 上传提取的音频文件（如果有）★★★
        if should_extract_audio and audio_path and os.path.exists(audio_path):
            try:
                audio_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
                logger.info(f"[HLS-Stream] 🎵 上传 ASR 音频: {audio_size_mb:.1f}MB")
                
                with open(audio_path, "rb") as f:
                    audio_data = f.read()
                
                # 先删除旧文件
                try:
                    supabase.storage.from_("clips").remove([audio_storage_path])
                except:
                    pass
                
                supabase.storage.from_("clips").upload(
                    audio_storage_path,
                    audio_data,
                    file_options={
                        "content-type": "audio/mpeg",
                        "cache-control": "public, max-age=86400"  # 缓存 1 天
                    }
                )
                logger.info(f"[HLS-Stream] ✅ ASR 音频上传完成: {audio_storage_path}")
            except Exception as audio_err:
                logger.warning(f"[HLS-Stream] ⚠️ ASR 音频上传失败（不影响 HLS）: {audio_err}")
        
        # 清理临时目录
        shutil.rmtree(hls_temp_dir, ignore_errors=True)
        
        if len(uploaded_segments) == 0:
            update_hls_progress(0, "处理失败：无分片生成", force=True)
            return None
        
        # ★ 完成进度更新
        update_hls_progress(100, "处理完成", force=True)
        logger.info(f"[HLS-Stream] ✅ 完成! 边生成边上传 {len(uploaded_segments)} 个文件")
        return hls_storage_dir
        
    except Exception as e:
        logger.error(f"[HLS-Stream] 失败: {e}")
        import traceback
        traceback.print_exc()
        if 'hls_temp_dir' in locals():
            shutil.rmtree(hls_temp_dir, ignore_errors=True)
        return None


# ============================================
# ★ 已废弃：代理视频生成（Cloudflare 自动处理）
# ============================================

async def generate_proxy_video(asset_id: str, input_path: str) -> str:
    """
    ★ 已废弃：Cloudflare Stream 自动提供自适应码率
    保留函数签名以兼容旧代码
    """
    logger.warning(f"[代理视频] ⚠️ 已废弃，Cloudflare 自动处理: {asset_id[:8]}...")
    return None


async def _generate_proxy_video_legacy(asset_id: str, input_path: str) -> str:
    """
    ★ 原 generate_proxy_video 实现，保留备用
    生成 720p 代理视频用于编辑预览
    
    输出规格:
    - 分辨率: 1280x720 (720p)
    - 编码: H.264
    - 码率: ~2 Mbps (CRF 23)
    - 帧率: 30fps（性能优化，最终导出支持 60fps）
    - 文件大小: 约为原始视频的 1/5 ~ 1/10
    """
    try:
        from ..services.supabase_client import supabase
        
        # 创建临时输出文件
        output_path = tempfile.mktemp(suffix=".mp4")
        
        # 获取原始视频信息，确定缩放方式
        metadata = extract_metadata(input_path)
        original_width = metadata.get("width", 1920)
        original_height = metadata.get("height", 1080)
        
        # 计算缩放滤镜：保持宽高比，最大 720p，强制 30fps
        if original_width > original_height:
            # 横屏视频：宽度不超过 1280
            scale_filter = f"scale='min(1280,iw):-2',fps=30"
        else:
            # 竖屏视频：高度不超过 1280
            scale_filter = f"scale='-2:min(1280,ih)',fps=30"
        
        cmd = [
            "ffmpeg",
            "-i", input_path,
            "-vf", scale_filter,
            "-r", "30",  # 输出帧率 30fps
            "-c:v", "libx264",
            "-preset", PROXY_PRESET,
            "-crf", PROXY_CRF,
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",  # 优化在线播放，关键！
            "-y",
            output_path
        ]
        
        logger.info(f"[代理视频] 开始生成: {asset_id}, 原始分辨率: {original_width}x{original_height}")
        
        # ★ 使用 asyncio.to_thread 避免阻塞事件循环
        import asyncio
        result = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=600
        )
        
        if result.returncode != 0:
            logger.error(f"代理视频生成失败: {result.stderr}")
            return None
        
        # 检查输出文件
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            logger.error(f"[代理视频] 输出文件无效")
            return None
        
        output_size = os.path.getsize(output_path)
        logger.info(f"[代理视频] 生成完成, 大小: {output_size / 1024 / 1024:.1f} MB")
        
        # 上传到存储
        storage_path = f"proxies/{asset_id}_proxy.mp4"
        
        # ★ 使用 asyncio.to_thread 避免阻塞事件循环
        def upload_proxy():
            with open(output_path, 'rb') as f:
                # 先尝试删除旧的（如果存在）
                try:
                    supabase.storage.from_("clips").remove([storage_path])
                except:
                    pass
                supabase.storage.from_("clips").upload(storage_path, f, file_options={"content-type": "video/mp4"})
        
        await asyncio.to_thread(upload_proxy)
        
        # 更新数据库记录 proxy_path
        try:
            supabase.table("assets").update({
                "proxy_path": storage_path
            }).eq("id", asset_id).execute()
            logger.info(f"[代理视频] 已更新数据库: {storage_path}")
        except Exception as db_error:
            logger.warning(f"[代理视频] 更新数据库失败: {db_error}")
        
        # 获取可访问 URL（签名 URL）
        from ..services.supabase_client import get_file_url
        proxy_url = get_file_url("clips", storage_path)
        
        # 清理临时文件
        os.remove(output_path)
        
        logger.info(f"[代理视频] ✅ 上传成功: {storage_path}")
        return storage_path  # 返回 storage_path 而不是 URL，前端通过代理访问
        
    except Exception as e:
        logger.error(f"代理视频生成失败: {e}")
        import traceback
        traceback.print_exc()
        return None


# ============================================
# 缩略图生成
# ============================================

async def generate_thumbnail_from_url(asset_id: str, video_url: str, timestamp: float = 1.0) -> Optional[str]:
    """从远程视频 URL 直接生成缩略图（不下载完整文件）
    
    Args:
        asset_id: 资源 ID
        video_url: 视频的远程 URL
        timestamp: 截取缩略图的时间点（秒）
    
    Returns:
        缩略图的 storage_path，失败返回 None
    """
    try:
        from ..services.supabase_client import supabase
        
        output_path = tempfile.mktemp(suffix=".jpg")
        
        # FFmpeg 可以直接从 URL 读取并截取帧
        cmd = [
            "ffmpeg",
            "-ss", str(max(0, timestamp)),  # 先 seek 再打开，更快
            "-i", video_url,
            "-vframes", "1",
            "-vf", f"scale={THUMBNAIL_WIDTH}:{THUMBNAIL_HEIGHT}:force_original_aspect_ratio=decrease,pad={THUMBNAIL_WIDTH}:{THUMBNAIL_HEIGHT}:(ow-iw)/2:(oh-ih)/2",
            "-y",
            output_path
        ]
        
        logger.info(f"[Thumbnail] 开始生成缩略图: asset_id={asset_id}, timestamp={timestamp:.2f}s")
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0:
            logger.error(f"[Thumbnail] FFmpeg 失败: {result.stderr[:500]}")
            return None
        
        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            logger.error(f"[Thumbnail] 输出文件无效")
            return None
        
        # 上传到 Supabase Storage
        storage_path = f"thumbnails/{asset_id}_thumb.jpg"
        
        with open(output_path, 'rb') as f:
            # 先尝试删除旧的（如果存在）
            try:
                supabase.storage.from_("clips").remove([storage_path])
            except:
                pass
            supabase.storage.from_("clips").upload(storage_path, f, file_options={"content-type": "image/jpeg"})
        
        os.remove(output_path)
        
        logger.info(f"[Thumbnail] ✅ 缩略图已上传: {storage_path}")
        return storage_path
        
    except subprocess.TimeoutExpired:
        logger.error(f"[Thumbnail] FFmpeg 超时")
        return None
    except Exception as e:
        logger.error(f"[Thumbnail] 生成失败: {e}")
        import traceback
        traceback.print_exc()
        return None


async def generate_thumbnail(asset_id: str, input_path: str) -> str:
    """从视频生成缩略图（根据项目比例裁剪）"""
    try:
        from ..services.supabase_client import supabase
        from ..services.video_utils import calculate_crop_area, AspectRatio
        
        # 获取视频元数据
        metadata = extract_metadata(input_path)
        duration = metadata.get("duration", 10)
        original_width = metadata.get("width", 1920)
        original_height = metadata.get("height", 1080)
        
        # 在 10% 位置截取缩略图
        timestamp = duration * 0.1
        
        # ★★★ 获取项目目标比例，用于裁剪（和 HLS 逻辑一致） ★★★
        target_aspect_ratio: Optional[str] = None
        try:
            # 从 asset 获取 project_id
            asset_result = supabase.table("assets").select("project_id").eq("id", asset_id).single().execute()
            if asset_result.data and asset_result.data.get("project_id"):
                project_id = asset_result.data["project_id"]
                # 从 project 获取 resolution
                project_result = supabase.table("projects").select("resolution").eq("id", project_id).single().execute()
                if project_result.data and project_result.data.get("resolution"):
                    resolution = project_result.data["resolution"]
                    # 根据 resolution 判断目标比例
                    if resolution.get("width") and resolution.get("height"):
                        if resolution["width"] > resolution["height"]:
                            target_aspect_ratio = "16:9"
                        else:
                            target_aspect_ratio = "9:16"
                        logger.info(f"[Thumbnail] 📐 项目目标比例: {target_aspect_ratio}")
        except Exception as e:
            logger.warning(f"[Thumbnail] ⚠️ 获取项目比例失败，使用原始比例: {e}")
        
        # ★★★ 计算滤镜链：裁剪 → 缩放 ★★★
        filter_parts = []
        
        # 1. 裁剪滤镜（如果需要）
        if target_aspect_ratio:
            source_ratio = original_width / original_height
            target_ratio = 16/9 if target_aspect_ratio == "16:9" else 9/16
            
            ratio_diff = abs(source_ratio - target_ratio) / target_ratio
            if ratio_diff > 0.05:  # 超过 5% 差异才裁剪
                crop_x, crop_y, crop_w, crop_h = calculate_crop_area(
                    original_width, 
                    original_height, 
                    AspectRatio(target_aspect_ratio),
                    alignment="center"
                )
                crop_filter = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}"
                filter_parts.append(crop_filter)
                logger.info(f"[Thumbnail] ✂️ 应用裁剪: {crop_filter}")
        
        # 2. 缩放滤镜（根据目标比例确定缩略图尺寸）
        if target_aspect_ratio == "9:16":
            # 竖屏缩略图：高度固定，宽度按比例
            thumb_w = THUMBNAIL_HEIGHT  # 180
            thumb_h = int(thumb_w * 16 / 9)  # 320
        else:
            # 横屏缩略图：宽度固定，高度按比例
            thumb_w = THUMBNAIL_WIDTH   # 320
            thumb_h = THUMBNAIL_HEIGHT  # 180
        
        scale_filter = f"scale={thumb_w}:{thumb_h}:force_original_aspect_ratio=decrease,pad={thumb_w}:{thumb_h}:(ow-iw)/2:(oh-ih)/2"
        filter_parts.append(scale_filter)
        
        video_filter = ",".join(filter_parts)
        logger.info(f"[Thumbnail] 🎬 滤镜链: {video_filter}")
        
        output_path = tempfile.mktemp(suffix=".jpg")
        
        cmd = [
            "ffmpeg",
            "-ss", str(timestamp),
            "-i", input_path,
            "-vframes", "1",
            "-vf", video_filter,
            "-y",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0:
            logger.error(f"缩略图生成失败: {result.stderr}")
            return None
        
        # 上传到存储
        storage_path = f"thumbnails/{asset_id}_thumb.jpg"
        
        with open(output_path, 'rb') as f:
            supabase.storage.from_("clips").upload(storage_path, f)
        
        os.remove(output_path)
        
        # ★ 返回存储路径，不是签名 URL
        return storage_path
        
    except Exception as e:
        logger.error(f"缩略图生成失败: {e}")
        return None


async def generate_image_thumbnail(asset_id: str, input_path: str) -> str:
    """从图片生成缩略图（根据项目比例裁剪）"""
    try:
        from ..services.supabase_client import supabase
        from ..services.video_utils import calculate_crop_area, AspectRatio
        
        # 获取图片尺寸
        metadata = extract_metadata(input_path)
        original_width = metadata.get("width", 1920)
        original_height = metadata.get("height", 1080)
        
        # ★★★ 获取项目目标比例，用于裁剪 ★★★
        target_aspect_ratio: Optional[str] = None
        try:
            asset_result = supabase.table("assets").select("project_id").eq("id", asset_id).single().execute()
            if asset_result.data and asset_result.data.get("project_id"):
                project_id = asset_result.data["project_id"]
                project_result = supabase.table("projects").select("resolution").eq("id", project_id).single().execute()
                if project_result.data and project_result.data.get("resolution"):
                    resolution = project_result.data["resolution"]
                    if resolution.get("width") and resolution.get("height"):
                        if resolution["width"] > resolution["height"]:
                            target_aspect_ratio = "16:9"
                        else:
                            target_aspect_ratio = "9:16"
                        logger.info(f"[ImageThumb] 📐 项目目标比例: {target_aspect_ratio}")
        except Exception as e:
            logger.warning(f"[ImageThumb] ⚠️ 获取项目比例失败: {e}")
        
        # ★★★ 计算滤镜链 ★★★
        filter_parts = []
        
        if target_aspect_ratio:
            source_ratio = original_width / original_height
            target_ratio = 16/9 if target_aspect_ratio == "16:9" else 9/16
            
            ratio_diff = abs(source_ratio - target_ratio) / target_ratio
            if ratio_diff > 0.05:
                crop_x, crop_y, crop_w, crop_h = calculate_crop_area(
                    original_width, 
                    original_height, 
                    AspectRatio(target_aspect_ratio),
                    alignment="center"
                )
                filter_parts.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")
                logger.info(f"[ImageThumb] ✂️ 应用裁剪: crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")
        
        # 缩放滤镜
        if target_aspect_ratio == "9:16":
            thumb_w = THUMBNAIL_HEIGHT
            thumb_h = int(thumb_w * 16 / 9)
        else:
            thumb_w = THUMBNAIL_WIDTH
            thumb_h = THUMBNAIL_HEIGHT
        
        filter_parts.append(f"scale={thumb_w}:{thumb_h}:force_original_aspect_ratio=decrease,pad={thumb_w}:{thumb_h}:(ow-iw)/2:(oh-ih)/2")
        
        video_filter = ",".join(filter_parts)
        
        output_path = tempfile.mktemp(suffix=".jpg")
        
        cmd = [
            "ffmpeg",
            "-i", input_path,
            "-vf", video_filter,
            "-y",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0:
            logger.error(f"图片缩略图生成失败: {result.stderr}")
            return None
        
        storage_path = f"thumbnails/{asset_id}_thumb.jpg"
        
        with open(output_path, 'rb') as f:
            supabase.storage.from_("clips").upload(storage_path, f)
        
        os.remove(output_path)
        
        # ★ 返回存储路径，不是签名 URL
        return storage_path
        
    except Exception as e:
        logger.error(f"图片缩略图生成失败: {e}")
        return None


# ============================================
# 波形提取
# ============================================

def extract_waveform(input_path: str, samples: int = WAVEFORM_SAMPLES) -> dict:
    """提取音频波形数据"""
    try:
        # 提取原始音频数据
        output_path = tempfile.mktemp(suffix=".raw")
        
        cmd = [
            "ffmpeg",
            "-i", input_path,
            "-ac", "1",  # 单声道
            "-ar", "8000",  # 8kHz 采样率
            "-f", "f32le",  # 32位浮点
            "-y",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0:
            logger.error(f"波形提取失败: {result.stderr}")
            return None
        
        # 读取原始数据
        import struct
        
        with open(output_path, 'rb') as f:
            raw_data = f.read()
        
        # 解析为浮点数组
        sample_count = len(raw_data) // 4
        audio_data = struct.unpack(f'{sample_count}f', raw_data)
        
        # 重采样到目标采样数
        samples_per_bin = max(1, sample_count // samples)
        peaks = []
        
        for i in range(samples):
            start = i * samples_per_bin
            end = min(start + samples_per_bin, sample_count)
            
            if start >= sample_count:
                break
            
            max_val = max(abs(audio_data[j]) for j in range(start, end))
            peaks.append(round(max_val, 4))
        
        os.remove(output_path)
        
        # 获取元数据
        metadata = extract_metadata(input_path)
        
        return {
            "left": peaks,
            "duration": metadata.get("duration", 0),
            "sample_rate": 8000,
            "channels": 1,
            "peaks": {
                "min": round(min(peaks) if peaks else 0, 4),
                "max": round(max(peaks) if peaks else 0, 4),
            }
        }
        
    except Exception as e:
        logger.error(f"波形提取失败: {e}")
        return None


# ============================================
# 数据库更新
# ============================================

async def update_asset_record(asset_id: str, results: dict):
    """更新资源记录，并在必要时更新项目封面"""
    from ..services.supabase_client import supabase
    
    update_data = {
        "status": "ready",
        "updated_at": datetime.utcnow().isoformat()
    }
    
    if results.get("metadata"):
        update_data["metadata"] = results["metadata"]
    
    if results.get("proxy_url"):
        update_data["proxy_url"] = results["proxy_url"]
    
    # ★ 存储路径到 thumbnail_path 字段
    if results.get("thumbnail_url"):
        update_data["thumbnail_path"] = results["thumbnail_url"]
    
    if results.get("waveform_data"):
        update_data["waveform_data"] = results["waveform_data"]
    
    supabase.table("assets").update(update_data).eq("id", asset_id).execute()
    
    # 如果有缩略图，尝试更新项目封面（仅当项目还没有封面时）
    if results.get("thumbnail_url"):
        await try_update_project_thumbnail(asset_id, results["thumbnail_url"])


async def try_update_project_thumbnail(asset_id: str, thumbnail_url: str):
    """
    尝试更新项目封面
    
    策略：如果项目还没有封面（thumbnail_url 为空），
    则使用这个 asset 的缩略图作为项目封面
    """
    from ..services.supabase_client import supabase
    
    try:
        # 获取 asset 对应的 project_id
        asset_result = supabase.table("assets").select("project_id").eq("id", asset_id).single().execute()
        
        if not asset_result.data or not asset_result.data.get("project_id"):
            return
        
        project_id = asset_result.data["project_id"]
        
        # 检查项目是否已有封面
        project_result = supabase.table("projects").select("thumbnail_url").eq("id", project_id).single().execute()
        
        if not project_result.data:
            return
        
        # 如果项目还没有封面，更新它
        if not project_result.data.get("thumbnail_url"):
            supabase.table("projects").update({
                "thumbnail_url": thumbnail_url,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", project_id).execute()
            logger.info(f"已更新项目 {project_id} 的封面")
    except Exception as e:
        # 封面更新失败不影响主流程
        logger.warning(f"更新项目封面失败: {e}")


# ============================================
# 辅助函数
# ============================================

async def download_media(url: str) -> str:
    """
    流式下载媒体文件到临时目录
    
    ★ 使用流式下载，避免将整个文件加载到内存
    - 旧方式：response.content 会把 500MB 视频全部加载到内存
    - 新方式：流式分块写入，内存占用仅 ~1MB（CHUNK_SIZE）
    """
    CHUNK_SIZE = 1024 * 1024  # 1MB 分块
    
    # 根据 URL 推断扩展名
    ext = ".mp4"
    url_lower = url.lower()
    if "mp3" in url_lower:
        ext = ".mp3"
    elif "wav" in url_lower:
        ext = ".wav"
    elif "jpg" in url_lower or "jpeg" in url_lower:
        ext = ".jpg"
    elif "png" in url_lower:
        ext = ".png"
    
    fd, path = tempfile.mkstemp(suffix=ext)
    
    try:
        async with httpx.AsyncClient(timeout=600) as client:
            # ★ 使用流式请求，不会把整个文件加载到内存
            async with client.stream("GET", url, follow_redirects=True) as response:
                response.raise_for_status()
                
                with os.fdopen(fd, 'wb') as f:
                    async for chunk in response.aiter_bytes(chunk_size=CHUNK_SIZE):
                        f.write(chunk)
        
        return path
    except Exception:
        # 出错时清理临时文件
        try:
            os.close(fd)
        except:
            pass
        if os.path.exists(path):
            os.remove(path)
        raise


async def extract_media_metadata(file_url: str) -> dict:
    """
    直接从 URL 提取媒体元数据（无需下载整个文件）
    FFprobe 支持直接读取远程 URL，只读取必要的头部数据（约 2-10MB）
    
    优化前：下载整个 500MB 文件 → 分析 → 删除（耗时 30-60s）
    优化后：FFprobe 直接读 URL 头部（耗时 2-5s）
    """
    try:
        import asyncio
        
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            # 限制分析时长，加速处理
            "-analyzeduration", "10000000",  # 10 秒
            "-probesize", "10000000",  # 10MB
            file_url  # 直接使用 URL
        ]
        
        # 使用 asyncio 运行子进程
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=30  # 30 秒超时
        )
        
        if process.returncode != 0:
            logger.error(f"FFprobe URL 分析错误: {stderr.decode()}")
            return {}
        
        data = json.loads(stdout.decode())
        
        metadata = {
            "duration": float(data.get("format", {}).get("duration", 0)),
            "bitrate": int(data.get("format", {}).get("bit_rate", 0)),
        }
        
        # 提取视频流信息
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                metadata["width"] = stream.get("width")
                metadata["height"] = stream.get("height")
                fps_str = stream.get("r_frame_rate", "0/1")
                try:
                    fps_value = eval(fps_str)
                    metadata["fps"] = int(round(fps_value)) if fps_value else 30
                except:
                    metadata["fps"] = 30
                metadata["codec"] = stream.get("codec_name")
                metadata["has_video"] = True
            elif stream.get("codec_type") == "audio":
                metadata["sample_rate"] = int(stream.get("sample_rate", 0))
                metadata["channels"] = stream.get("channels")
                metadata["audio_codec"] = stream.get("codec_name")
                metadata["has_audio"] = True
        
        logger.info(f"[Metadata] 直接从 URL 提取成功: {metadata.get('width')}x{metadata.get('height')}, {metadata.get('duration'):.1f}s")
        return metadata
        
    except asyncio.TimeoutError:
        logger.error(f"extract_media_metadata 超时: {file_url[:80]}")
        return {}
    except Exception as e:
        logger.error(f"extract_media_metadata 失败: {e}")
        return {}


# ============================================
# Celery 任务（可选）
# ============================================

try:
    from ..celery_config import celery_app, update_task_progress, update_task_status
    
    @celery_app.task(bind=True, queue="cpu_low")
    def asset_processing_task(
        self,
        task_id: str,
        asset_id: str,
        asset_url: str,
        asset_type: str
    ):
        """Celery 资源处理任务"""
        import asyncio
        
        def on_progress(progress: int, step: str):
            update_task_progress(task_id, progress, step)
        
        try:
            update_task_status(task_id, "processing")
            
            result = asyncio.run(process_asset(
                asset_id=asset_id,
                asset_url=asset_url,
                asset_type=asset_type,
                on_progress=on_progress
            ))
            
            update_task_status(task_id, "completed", result=result)
            return result
            
        except Exception as e:
            logger.error(f"资源处理任务失败: {e}")
            update_task_status(task_id, "failed", error=str(e))
            raise

except ImportError:
    logger.info("Celery 未配置，使用同步模式")


# ============================================
# 批量处理
# ============================================

async def batch_generate_sprites(
    asset_id: str,
    input_path: str,
    interval: float = 1.0,
    sprite_width: int = 160,
    sprite_height: int = 90
) -> str:
    """生成雪碧图（用于快速预览）"""
    try:
        from ..services.supabase_client import supabase
        
        # 获取视频时长
        metadata = extract_metadata(input_path)
        duration = metadata.get("duration", 0)
        
        if duration <= 0:
            return None
        
        # 计算帧数
        frame_count = int(duration / interval)
        cols = 10
        rows = (frame_count + cols - 1) // cols
        
        output_path = tempfile.mktemp(suffix=".jpg")
        
        # 使用 FFmpeg 生成雪碧图
        cmd = [
            "ffmpeg",
            "-i", input_path,
            "-vf", f"fps=1/{interval},scale={sprite_width}:{sprite_height},tile={cols}x{rows}",
            "-frames:v", "1",
            "-y",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode != 0:
            logger.error(f"雪碧图生成失败: {result.stderr}")
            return None
        
        # 上传到存储
        storage_path = f"sprites/{asset_id}_sprite.jpg"
        
        with open(output_path, 'rb') as f:
            supabase.storage.from_("clips").upload(storage_path, f)
        
        from ..services.supabase_client import get_file_url
        sprite_url = get_file_url("clips", storage_path)
        
        os.remove(output_path)
        
        return sprite_url
        
    except Exception as e:
        logger.error(f"雪碧图生成失败: {e}")
        return None
