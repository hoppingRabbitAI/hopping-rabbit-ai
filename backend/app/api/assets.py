"""
HoppingRabbit AI - 资源管理 API
适配新表结构 (2026-01-07)
"""
import logging
import asyncio
from fastapi import APIRouter, HTTPException, BackgroundTasks, Response, Request
from fastapi.responses import StreamingResponse
from typing import Optional, Dict, Union
from datetime import datetime
from uuid import uuid4
import httpx

logger = logging.getLogger(__name__)

from ..models import PresignUploadRequest, PresignUploadResponse, ConfirmUploadRequest
from ..services.supabase_client import supabase, get_file_url

router = APIRouter(prefix="/assets", tags=["Assets"])


def get_file_type(content_type: str) -> str:
    """根据 MIME 类型判断文件类型（适配新表 file_type 字段）"""
    if not content_type:
        return "video"
    if content_type.startswith("video/"):
        return "video"
    elif content_type.startswith("audio/"):
        return "audio"
    elif content_type.startswith("image/"):
        return "image"
    else:
        return "subtitle"


@router.get("")
async def list_assets(
    project_id: Optional[str] = None,
    file_type: Optional[str] = None,
    limit: int = 50
):
    """获取资源列表"""
    try:
        query = supabase.table("assets").select("*").order("created_at", desc=True)
        
        if project_id:
            query = query.eq("project_id", project_id)
        if file_type:
            query = query.eq("file_type", file_type)  # 适配新字段名
        
        result = query.limit(limit).execute()
        
        if not result.data:
            return {"items": []}
        
        # 批量生成签名 URL（优化：一次 API 调用）
        from ..services.supabase_client import get_file_urls_batch
        
        storage_paths = [a["storage_path"] for a in result.data if a.get("storage_path")]
        thumbnail_paths = [a["thumbnail_path"] for a in result.data if a.get("thumbnail_path")]
        all_paths = list(set(storage_paths + thumbnail_paths))
        
        url_map = get_file_urls_batch("clips", all_paths) if all_paths else {}
        
        items = []
        for asset in result.data:
            asset_with_url = {**asset}
            if asset.get("storage_path"):
                asset_with_url["url"] = url_map.get(asset["storage_path"], "")
            if asset.get("thumbnail_path"):
                asset_with_url["thumbnail_url"] = url_map.get(asset["thumbnail_path"], "")
            items.append(asset_with_url)
        
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/presign-upload")
async def presign_upload(request: PresignUploadRequest):
    """获取预签名上传 URL"""
    try:
        asset_id = str(uuid4())
        file_ext = request.file_name.split(".")[-1] if "." in request.file_name else ""
        storage_path = f"uploads/{request.project_id}/{asset_id}.{file_ext}"
        
        presign_result = supabase.storage.from_("clips").create_signed_upload_url(storage_path)
        
        return PresignUploadResponse(
            asset_id=asset_id,
            upload_url=presign_result.get("signedURL") or presign_result.get("signed_url", ""),
            storage_path=storage_path,
            expires_at=datetime.utcnow().isoformat()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/confirm-upload")
async def confirm_upload(request: ConfirmUploadRequest, background_tasks: BackgroundTasks):
    """确认上传完成，创建资源记录"""
    try:
        now = datetime.utcnow().isoformat()
        
        # 适配新表结构：不存 url 字段，运行时生成签名 URL
        # duration: 前端传毫秒，数据库存秒
        duration_seconds = (request.duration / 1000) if request.duration else None
        
        asset_data = {
            "id": request.asset_id,
            "project_id": request.project_id,
            "user_id": "00000000-0000-0000-0000-000000000000",  # TODO: 从认证获取
            "name": request.file_name,
            "original_filename": request.file_name,
            "file_type": get_file_type(request.content_type),  # video/audio/image/subtitle
            "mime_type": request.content_type,
            "file_size": request.file_size,
            "storage_path": request.storage_path,
            "duration": duration_seconds,  # 前端本地提取的时长（秒）
            "status": "ready" if duration_seconds else "processing",  # 有时长就直接 ready
            "created_at": now,
            "updated_at": now
        }
        
        result = supabase.table("assets").insert(asset_data).execute()
        
        # 后台处理
        background_tasks.add_task(process_asset, request.asset_id)
        
        # 返回时添加 url
        response_data = result.data[0]
        response_data["url"] = get_file_url("clips", request.storage_path)
        
        return response_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{asset_id}")
async def get_asset(asset_id: str):
    """获取资源详情"""
    try:
        result = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="资源不存在")
        
        asset = result.data
        
        # 生成签名 URL
        if asset.get("storage_path"):
            asset["url"] = get_file_url("clips", asset["storage_path"])
        if asset.get("thumbnail_path"):
            asset["thumbnail_url"] = get_file_url("clips", asset["thumbnail_path"])
        
        return asset
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{asset_id}/url")
async def get_asset_url(asset_id: str):
    """获取资源的签名 URL（用于 URL 过期后刷新）"""
    try:
        result = supabase.table("assets").select("storage_path, thumbnail_path").eq("id", asset_id).single().execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="资源不存在")
        
        asset = result.data
        response = {}
        
        if asset.get("storage_path"):
            response["url"] = get_file_url("clips", asset["storage_path"])
        if asset.get("thumbnail_path"):
            response["thumbnail_url"] = get_file_url("clips", asset["thumbnail_path"])
        
        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{asset_id}")
async def delete_asset(asset_id: str):
    """删除资源"""
    try:
        asset = supabase.table("assets").select("storage_path, thumbnail_path").eq("id", asset_id).single().execute()
        
        if not asset.data:
            raise HTTPException(status_code=404, detail="资源不存在")
        
        # 删除存储文件
        paths_to_delete = []
        if asset.data.get("storage_path"):
            paths_to_delete.append(asset.data["storage_path"])
        if asset.data.get("thumbnail_path"):
            paths_to_delete.append(asset.data["thumbnail_path"])
        
        if paths_to_delete:
            try:
                supabase.storage.from_("clips").remove(paths_to_delete)
            except Exception as e:
                # 存储删除失败不阻断流程，仅记录日志
                import logging
                logging.warning(f"删除存储文件失败: {e}")
        
        # 删除数据库记录
        supabase.table("assets").delete().eq("id", asset_id).execute()
        
        return {"success": True, "message": "资源已删除"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def process_asset(asset_id: str) -> None:
    """后台处理资源：提取元数据 + 生成缩略图 + 生成 HLS 流
    
    Args:
        asset_id: 资源 ID
    """
    logger.info(f"开始处理资源: asset_id={asset_id}")
    try:
        asset = supabase.table("assets").select("*").eq("id", asset_id).single().execute()
        
        if not asset.data:
            logger.warning(f"资源不存在: asset_id={asset_id}")
            return
        
        file_type = asset.data.get("file_type")
        storage_path = asset.data.get("storage_path")
        logger.debug(f"资源信息: file_type={file_type}, storage_path={storage_path}")
        
        if not storage_path:
            logger.warning(f"缺少 storage_path: asset_id={asset_id}")
            return
        
        # 生成签名 URL
        file_url = get_file_url("clips", storage_path)
        logger.debug(f"生成文件 URL: {file_url[:100]}...")
        
        # 提取元数据
        update_data = {
            "status": "ready",
            "updated_at": datetime.utcnow().isoformat()
        }
        
        if file_type in ["video", "audio"]:
            try:
                from ..tasks.asset_processing import extract_media_metadata, generate_thumbnail_from_url, generate_hls_from_url
                logger.debug("正在提取元数据...")
                metadata = await extract_media_metadata(file_url)
                logger.debug(f"提取到的元数据: {metadata}")
                
                # 适配新表字段
                update_data.update({
                    "duration": metadata.get("duration"),
                    "width": metadata.get("width"),
                    "height": metadata.get("height"),
                    "fps": metadata.get("fps"),
                    "sample_rate": metadata.get("sample_rate"),
                    "channels": metadata.get("channels"),
                })
                
                # ★ 为视频生成缩略图和 HLS 流
                if file_type == "video":
                    # 生成缩略图
                    logger.debug("正在生成缩略图...")
                    try:
                        thumbnail_path = await generate_thumbnail_from_url(
                            asset_id=asset_id,
                            video_url=file_url,
                            timestamp=metadata.get("duration", 10) * 0.1  # 10% 位置
                        )
                        if thumbnail_path:
                            update_data["thumbnail_path"] = thumbnail_path
                            logger.info(f"缩略图生成成功: {thumbnail_path}")
                    except Exception as e:
                        logger.warning(f"缩略图生成失败: {e}")
                    
                    # ★ 检测视频编码，判断是否需要转码
                    # 浏览器原生支持的编码格式
                    BROWSER_SUPPORTED_CODECS = {"h264", "avc1", "vp8", "vp9", "av1", "hevc", "h265"}
                    video_codec = metadata.get("codec", "")
                    needs_transcode = video_codec and video_codec.lower() not in BROWSER_SUPPORTED_CODECS
                    
                    if needs_transcode:
                        logger.warning(f"⚠️ 视频编码 {video_codec} 需要转码为 H.264")
                        update_data["needs_transcode"] = True
                        update_data["hls_status"] = "pending"
                        
                        # ★ 必须生成 HLS，否则无法播放
                        logger.info(f"正在生成 HLS 流（codec={video_codec}）...")
                        try:
                            hls_path = await generate_hls_from_url(
                                asset_id=asset_id,
                                video_url=file_url
                            )
                            if hls_path:
                                update_data["hls_path"] = hls_path
                                update_data["hls_status"] = "ready"
                                logger.info(f"✅ HLS 生成成功: {hls_path}")
                            else:
                                update_data["hls_status"] = "failed"
                                logger.error(f"❌ HLS 生成失败（返回空）")
                        except Exception as e:
                            update_data["hls_status"] = "failed"
                            logger.error(f"❌ HLS 生成失败: {e}")
                    else:
                        # 浏览器支持的编码，无需转码
                        update_data["needs_transcode"] = False
                        logger.info(f"跳过 HLS 生成（浏览器支持编码: {video_codec or 'h264'}）")
                
                logger.debug(f"将更新: {update_data}")
            except Exception as e:
                logger.warning(f"提取元数据失败: {e}")
                import traceback
                traceback.print_exc()
        
        supabase.table("assets").update(update_data).eq("id", asset_id).execute()
        logger.info(f"资源处理完成: asset_id={asset_id}")
        
    except Exception as e:
        logger.error(f"资源处理失败: asset_id={asset_id}, error={e}")
        import traceback
        traceback.print_exc()
        supabase.table("assets").update({
            "status": "error",
            "error_message": str(e),
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", asset_id).execute()


# ============================================
# 流式传输常量与辅助函数
# ============================================

STREAM_CHUNK_SIZE = 65536  # 64KB chunks
STREAM_TIMEOUT = httpx.Timeout(300.0, connect=30.0)
STREAM_MAX_RETRIES = 3  # 最大重试次数


async def _create_streaming_response(
    signed_url: str,
    mime_type: str,
    range_header: Optional[str],
    extra_headers: Optional[dict] = None,
) -> StreamingResponse:
    """
    创建流式响应（支持 Range 请求）
    
    Args:
        signed_url: 已签名的存储 URL
        mime_type: MIME 类型
        range_header: Range 请求头（可选）
        extra_headers: 额外的响应头（可选）
    
    Returns:
        StreamingResponse 对象
    """
    client = httpx.AsyncClient(timeout=STREAM_TIMEOUT)
    
    try:
        # 获取文件大小（带重试机制）
        file_size = 0
        last_error = None
        for attempt in range(STREAM_MAX_RETRIES):
            try:
                head_response = await client.head(signed_url)
                file_size = int(head_response.headers.get("content-length", 0))
                break
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                last_error = e
                if attempt < STREAM_MAX_RETRIES - 1:
                    await asyncio.sleep(0.5 * (attempt + 1))  # 退避重试
                    logger.debug(f"HEAD request retry {attempt + 1}/{STREAM_MAX_RETRIES}")
        
        if last_error and file_size == 0:
            logger.warning(f"Failed to get file size after {STREAM_MAX_RETRIES} retries: {last_error}")
            # 继续处理，file_size 为 0 时也能工作
        
        base_headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        }
        if extra_headers:
            base_headers.update(extra_headers)
        
        if range_header and file_size > 0:
            # 解析 Range 头
            range_match = range_header.replace("bytes=", "").split("-")
            start = int(range_match[0]) if range_match[0] else 0
            end = int(range_match[1]) if range_match[1] else file_size - 1
            
            if end >= file_size:
                end = file_size - 1
            
            content_length = end - start + 1
            headers = {"Range": f"bytes={start}-{end}"}
            
            async def generate_range():
                try:
                    async with client.stream("GET", signed_url, headers=headers) as response:
                        async for chunk in response.aiter_bytes(chunk_size=STREAM_CHUNK_SIZE):
                            yield chunk
                except (httpx.RemoteProtocolError, httpx.ReadError, Exception) as e:
                    logger.debug(f"Stream interrupted: {type(e).__name__}")
                finally:
                    await client.aclose()
            
            return StreamingResponse(
                generate_range(),
                status_code=206,
                media_type=mime_type,
                headers={
                    **base_headers,
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Content-Length": str(content_length),
                }
            )
        else:
            # 完整文件请求
            async def generate_full():
                try:
                    async with client.stream("GET", signed_url) as response:
                        async for chunk in response.aiter_bytes(chunk_size=STREAM_CHUNK_SIZE):
                            yield chunk
                except (httpx.RemoteProtocolError, httpx.ReadError, Exception) as e:
                    logger.debug(f"Stream interrupted: {type(e).__name__}")
                finally:
                    await client.aclose()
            
            return StreamingResponse(
                generate_full(),
                status_code=200,
                media_type=mime_type,
                headers={
                    **base_headers,
                    "Content-Length": str(file_size) if file_size > 0 else None,
                }
            )
    except Exception as e:
        await client.aclose()
        raise e


def _get_mime_type(asset: dict) -> str:
    """根据资源信息获取 MIME 类型"""
    mime_type = asset.get("mime_type")
    if mime_type:
        return mime_type
    
    filename = asset.get("original_filename") or asset.get("storage_path", "")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    
    mime_map = {
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "aac": "audio/aac",
        "ogg": "audio/ogg",
        "flac": "audio/flac",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
        "avi": "video/x-msvideo",
        "mkv": "video/x-matroska",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
    }
    return mime_map.get(ext, "application/octet-stream")


# ============================================
# HLS 流式播放端点
# ============================================

@router.head("/hls/{asset_id}/playlist.m3u8")
async def head_hls_playlist(asset_id: str):
    """
    HEAD 请求检查 HLS 播放列表是否可用
    前端用于快速检测 HLS 是否就绪
    """
    try:
        result = await asyncio.to_thread(
            lambda: supabase.table("assets").select("hls_path, hls_status").eq("id", asset_id).single().execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Asset not found")
        
        hls_path = result.data.get("hls_path")
        hls_status = result.data.get("hls_status")
        
        if not hls_path or hls_status != "ready":
            raise HTTPException(status_code=404, detail="HLS not ready")
        
        # 返回空响应体，只有 headers
        return Response(
            status_code=200,
            headers={
                "Content-Type": "application/vnd.apple.mpegurl",
                "X-HLS-Status": "ready",
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"HLS HEAD check error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/hls/{asset_id}/playlist.m3u8")
async def get_hls_playlist(asset_id: str, request: Request):
    """
    获取 HLS 播放列表（.m3u8）
    这是 HLS 播放的入口文件
    """
    try:
        # 使用 asyncio.to_thread 避免阻塞事件循环
        result = await asyncio.to_thread(
            lambda: supabase.table("assets").select("hls_path").eq("id", asset_id).single().execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Asset not found")
        
        hls_path = result.data.get("hls_path")
        if not hls_path:
            raise HTTPException(status_code=404, detail="HLS not available for this asset. Please wait for processing to complete.")
        
        playlist_path = f"{hls_path}/playlist.m3u8"
        signed_url = get_file_url("clips", playlist_path)
        
        # 下载 playlist 内容并修改分片 URL
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(signed_url)
            if response.status_code != 200:
                raise HTTPException(status_code=404, detail="Playlist file not found")
            
            playlist_content = response.text
            
            # 替换分片 URL：将相对路径改为我们的 API 路径
            # 原始格式: segment_000.ts
            # 替换为: /api/assets/hls/{asset_id}/segment_000.ts
            import re
            modified_content = re.sub(
                r'^(segment_\d+\.ts)$',
                rf'/api/assets/hls/{asset_id}/\1',
                playlist_content,
                flags=re.MULTILINE
            )
        
        return Response(
            content=modified_content,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Cache-Control": "no-cache",  # playlist 不缓存，以便实时更新
                "Access-Control-Allow-Origin": "*",
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"HLS playlist error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/hls/{asset_id}/status")
async def get_hls_status(asset_id: str):
    """
    检查 HLS 是否可用
    前端可以用此接口判断是否使用 HLS 播放
    
    返回:
    - available: HLS 是否已就绪
    - needs_transcode: 是否需要转码才能播放（ProRes 等）
    - hls_status: HLS 生成状态 (pending/processing/ready/failed)
    - hls_progress: HLS 处理进度 (0-100)
    - hls_message: HLS 处理状态消息（如：正在下载远程视频...）
    - can_play_mp4: 是否可以直接播放 MP4（不需要等待 HLS）
    
    前端逻辑:
    1. if available → 使用 HLS
    2. elif needs_transcode and hls_status != 'ready' → 显示"转码中" + hls_message
    3. else → 使用 MP4 代理
    """
    # ★ 网络请求重试逻辑（处理 HTTP/2 连接断开等瞬时故障）
    max_retries = 2
    last_error = None
    
    for attempt in range(max_retries + 1):
        try:
            # 使用 asyncio.to_thread 避免阻塞事件循环
            result = await asyncio.to_thread(
                lambda: supabase.table("assets").select(
                    "hls_path, status, needs_transcode, hls_status, hls_progress, hls_message"
                ).eq("id", asset_id).maybe_single().execute()
            )
            
            # ★ 修复：result 或 result.data 可能为 None
            if result is None or result.data is None:
                raise HTTPException(status_code=404, detail="Asset not found")
            
            hls_path = result.data.get("hls_path")
            status = result.data.get("status")
            needs_transcode = result.data.get("needs_transcode", False)
            hls_status = result.data.get("hls_status")  # pending/processing/ready/failed
            hls_progress = result.data.get("hls_progress", 0)  # 0-100
            hls_message = result.data.get("hls_message")  # 进度消息
            
            # ★ 判断是否可以直接播放 MP4
            # 如果需要转码，必须等 HLS 实际可用（hls_path 存在）才能播放
            # 修复 bug: 之前只检查 hls_status == "ready"，但 hls_path 可能为空
            hls_available = hls_path is not None
            can_play_mp4 = not needs_transcode or hls_available
            
            return {
                "available": hls_available,
                "hls_path": hls_path,
                "asset_status": status,
                "playlist_url": f"/api/assets/hls/{asset_id}/playlist.m3u8" if hls_path else None,
                "needs_transcode": needs_transcode,
                "hls_status": hls_status,
                "hls_progress": hls_progress,
                "hls_message": hls_message,
                "can_play_mp4": can_play_mp4,
            }
            
        except HTTPException:
            raise
        except Exception as e:
            last_error = e
            error_msg = str(e).lower()
            # 仅对网络瞬时故障重试
            if attempt < max_retries and ("disconnect" in error_msg or "connection" in error_msg or "timeout" in error_msg):
                logger.warning(f"HLS status query retry {attempt + 1}/{max_retries} for asset {asset_id}: {e}")
                await asyncio.sleep(0.1 * (attempt + 1))  # 指数退避
                continue
            break
    
    # 所有重试失败
    import traceback
    logger.error(f"HLS status error for asset {asset_id}: {last_error}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    raise HTTPException(status_code=500, detail=str(last_error))


@router.get("/hls/{asset_id}/{segment}")
async def get_hls_segment(asset_id: str, segment: str, request: Request):
    """
    获取 HLS 分片（.ts 文件）
    支持 Range 请求
    """
    try:
        # 验证分片文件名格式
        if not segment.endswith('.ts') and not segment.endswith('.m3u8'):
            raise HTTPException(status_code=400, detail="Invalid segment format")
        
        # 使用 asyncio.to_thread 避免阻塞事件循环
        result = await asyncio.to_thread(
            lambda: supabase.table("assets").select("hls_path").eq("id", asset_id).single().execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Asset not found")
        
        hls_path = result.data.get("hls_path")
        if not hls_path:
            raise HTTPException(status_code=404, detail="HLS not available")
        
        segment_path = f"{hls_path}/{segment}"
        signed_url = get_file_url("clips", segment_path)
        
        # 确定 MIME 类型
        if segment.endswith('.ts'):
            mime_type = "video/mp2t"
        else:
            mime_type = "application/vnd.apple.mpegurl"
        
        range_header = request.headers.get("range")
        extra_headers = {
            "Cache-Control": "public, max-age=86400",  # 分片可以长时间缓存
        }
        
        return await _create_streaming_response(signed_url, mime_type, range_header, extra_headers)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"HLS segment error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stream/{asset_id}")
async def stream_asset(asset_id: str, request: Request):
    """
    流式代理资源文件，解决 CORS 问题
    支持 Range 请求，用于视频播放
    """
    max_retries = 3
    last_error = None
    
    for attempt in range(max_retries):
        try:
            # 使用 asyncio.to_thread 避免阻塞事件循环
            result = await asyncio.to_thread(
                lambda: supabase.table("assets").select("*").eq("id", asset_id).single().execute()
            )
            if not result.data:
                raise HTTPException(status_code=404, detail="Asset not found")
            
            asset = result.data
            storage_path = asset.get("storage_path")
            if not storage_path:
                raise HTTPException(status_code=404, detail="Asset has no storage path")
            
            signed_url = get_file_url("clips", storage_path)
            mime_type = _get_mime_type(asset)
            range_header = request.headers.get("range")
            
            return await _create_streaming_response(signed_url, mime_type, range_header)
            
        except HTTPException:
            raise
        except (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadTimeout) as e:
            last_error = e
            logger.warning(f"Stream retry {attempt + 1}/{max_retries} for asset {asset_id}: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(0.5 * (attempt + 1))  # 递增延迟
                continue
            break
        except Exception as e:
            last_error = e
            break
    
    logger.error(f"Stream error for asset {asset_id} after {max_retries} attempts: {last_error}")
    import traceback
    traceback.print_exc()
    raise HTTPException(status_code=500, detail=str(last_error))


@router.get("/proxy/{asset_id}")
async def stream_proxy_video(asset_id: str, request: Request):
    """
    流式代理视频（720p 低码率版本），用于编辑器预览
    
    优先返回代理视频，如果不存在则返回原始视频
    支持 Range 请求
    """
    max_retries = 3
    last_error = None
    
    for attempt in range(max_retries):
        try:
            # 使用 asyncio.to_thread 避免阻塞事件循环
            result = await asyncio.to_thread(
                lambda: supabase.table("assets").select("*").eq("id", asset_id).single().execute()
            )
            if not result.data:
                raise HTTPException(status_code=404, detail="Asset not found")
            
            asset = result.data
            proxy_path = asset.get("proxy_path")
            storage_path = asset.get("storage_path")
            
            if proxy_path:
                actual_path = proxy_path
                video_type = "proxy"
                logger.debug(f"使用代理视频: {proxy_path}")
            elif storage_path:
                actual_path = storage_path
                video_type = "original"
                logger.debug(f"代理视频不存在，使用原始视频: {storage_path}")
            else:
                raise HTTPException(status_code=404, detail="Asset has no video path")
            
            signed_url = get_file_url("clips", actual_path)
            range_header = request.headers.get("range")
            extra_headers = {
                "X-Video-Type": video_type,
                "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, X-Video-Type",
            }
            
            return await _create_streaming_response(signed_url, "video/mp4", range_header, extra_headers)
            
        except HTTPException:
            raise
        except (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadTimeout) as e:
            last_error = e
            logger.warning(f"Proxy stream retry {attempt + 1}/{max_retries} for asset {asset_id}: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            break
        except Exception as e:
            last_error = e
            break
    
    logger.error(f"Proxy stream error for asset {asset_id} after {max_retries} attempts: {last_error}")
    raise HTTPException(status_code=500, detail=str(last_error))


# ============================================
# 编辑器内添加素材处理
# ============================================

# 存储处理任务状态（生产环境应使用 Redis）
_process_additions_tasks: Dict[str, dict] = {}


from ..models import ProcessAdditionsRequest, ProcessAdditionsStatus


@router.post("/process-additions")
async def process_additions(request: ProcessAdditionsRequest, background_tasks: BackgroundTasks):
    """
    处理编辑器内添加的新素材
    
    1. 对每个新素材执行 ASR 转写
    2. 将生成的 clips 追加到现有时间轴末尾
    3. 返回任务 ID 供前端轮询进度
    """
    try:
        task_id = str(uuid4())
        now = datetime.utcnow().isoformat()
        
        # 验证项目存在
        project = supabase.table("projects").select("id, status").eq("id", request.project_id).single().execute()
        if not project.data:
            raise HTTPException(status_code=404, detail="项目不存在")
        
        # 验证所有 asset 存在
        assets = supabase.table("assets").select("*").in_("id", request.asset_ids).execute()
        if not assets.data or len(assets.data) != len(request.asset_ids):
            raise HTTPException(status_code=400, detail="部分素材不存在")
        
        # 初始化任务状态
        task_status = {
            "task_id": task_id,
            "project_id": request.project_id,
            "status": "pending",
            "current_step": "initializing",
            "progress": 0,
            "total_assets": len(request.asset_ids),
            "processed_assets": 0,
            "created_clips": 0,
            "error": None,
            "created_at": now,
        }
        _process_additions_tasks[task_id] = task_status
        
        # 后台处理
        background_tasks.add_task(
            _process_additions_async,
            task_id=task_id,
            project_id=request.project_id,
            asset_ids=request.asset_ids,
            enable_asr=request.enable_asr,
            enable_smart_camera=request.enable_smart_camera,
        )
        
        logger.info(f"[ProcessAdditions] 创建任务 {task_id}, 待处理素材: {len(request.asset_ids)}, enable_asr={request.enable_asr}, enable_smart_camera={request.enable_smart_camera}")
        
        return {"task_id": task_id, "status": "pending"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ProcessAdditions] 创建任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/process-additions/{task_id}")
async def get_process_additions_status(task_id: str):
    """获取素材处理任务状态"""
    if task_id not in _process_additions_tasks:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    return _process_additions_tasks[task_id]


async def _process_additions_async(
    task_id: str,
    project_id: str,
    asset_ids: list,
    enable_asr: bool = True,
    enable_smart_camera: bool = False,
):
    """
    异步处理添加的素材
    """
    import asyncio
    
    task = _process_additions_tasks.get(task_id)
    if not task:
        logger.error(f"[ProcessAdditions] 任务不存在: {task_id}")
        return
    
    try:
        task["status"] = "processing"
        task["current_step"] = "fetching_context"
        task["progress"] = 5
        
        now = datetime.utcnow().isoformat()
        
        # 1. 获取项目现有轨道
        tracks = supabase.table("tracks").select("*").eq("project_id", project_id).order("order_index").execute()
        
        video_track_id = None
        text_track_id = None
        
        if tracks.data:
            # 查找现有视频轨道
            for track in tracks.data:
                if track.get("name") in ["视频", "视频轨道", "Video", "AI 视频轨道"]:
                    video_track_id = track["id"]
                elif track.get("name") in ["转写文本", "字幕", "Subtitle", "Text"]:
                    text_track_id = track["id"]
        
        # 如果没有找到，使用第一个轨道
        if not video_track_id and tracks.data:
            video_track_id = tracks.data[0]["id"]
        
        # 如果没有轨道，创建新轨道
        if not video_track_id:
            video_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": video_track_id,
                "project_id": project_id,
                "name": "视频轨道",
                "order_index": 0,
                "is_muted": False,
                "is_locked": False,
                "is_visible": True,
                "created_at": now,
                "updated_at": now,
            }).execute()
        
        if not text_track_id:
            text_track_id = str(uuid4())
            supabase.table("tracks").insert({
                "id": text_track_id,
                "project_id": project_id,
                "name": "转写文本",
                "order_index": 1,
                "is_muted": False,
                "is_locked": False,
                "is_visible": True,
                "created_at": now,
                "updated_at": now,
            }).execute()
        
        # 2. 获取现有 clips 的结束时间
        existing_clips = supabase.table("clips").select("end_time, clip_type").eq("track_id", video_track_id).execute()
        
        timeline_position = 0
        if existing_clips.data:
            timeline_position = max(c.get("end_time", 0) for c in existing_clips.data)
        
        logger.info(f"[ProcessAdditions] 时间轴起始位置: {timeline_position}ms")
        
        task["progress"] = 10
        task["current_step"] = "loading_assets"
        
        # 3. 获取所有 asset 信息
        assets = supabase.table("assets").select("*").in_("id", asset_ids).execute()
        assets_map = {a["id"]: a for a in assets.data}
        
        # 按原始顺序排序
        sorted_assets = [assets_map[aid] for aid in asset_ids if aid in assets_map]
        
        all_video_clips = []
        all_subtitle_clips = []
        all_keyframes = []  # ★ 收集关键帧
        total_created_clips = 0
        
        progress_per_asset = 80 / len(sorted_assets)
        
        # 4. 处理每个素材
        for idx, asset in enumerate(sorted_assets):
            asset_id = asset["id"]
            storage_path = asset.get("storage_path")
            asset_name = asset.get("name") or asset.get("original_filename", f"素材 {idx + 1}")
            # duration 以秒存储，转为毫秒
            duration_sec = asset.get("duration") or 0
            duration_ms = int(duration_sec * 1000)
            
            base_progress = 10 + int(idx * progress_per_asset)
            task["progress"] = base_progress
            task["current_step"] = f"processing_asset_{idx + 1}"
            
            logger.info(f"[ProcessAdditions] 处理素材 {idx + 1}/{len(sorted_assets)}: {asset_name}")
            
            if not storage_path:
                logger.warning(f"[ProcessAdditions] 素材 {asset_id} 无 storage_path，跳过")
                continue
            
            file_url = get_file_url("clips", storage_path)
            
            transcript_segments = []
            
            # ★ 逻辑重构：
            # - enable_asr: 控制是否生成字幕
            # - enable_smart_camera: 控制是否切片 + 应用运镜
            # 只要任一选项开启，都需要执行 ASR 获取时间分段
            need_asr = enable_asr or enable_smart_camera
            
            if need_asr:
                task["current_step"] = f"asr_{idx + 1}"
                logger.info(f"[ProcessAdditions] 开始 ASR 转写: {asset_name} (enable_asr={enable_asr}, enable_smart_camera={enable_smart_camera})")
                
                # 等待避免 API 限流
                if idx > 0:
                    await asyncio.sleep(2)
                
                try:
                    from ..api.workspace import _run_asr
                    
                    def update_task_progress(step: str, progress: int):
                        task["progress"] = base_progress + int((progress - base_progress) * progress_per_asset / 100)
                    
                    transcript_segments = await _run_asr(
                        file_url,
                        update_task_progress,
                        base_progress,
                        int(progress_per_asset * 0.8)
                    )
                    
                    logger.info(f"[ProcessAdditions] ASR 完成，识别 {len(transcript_segments)} 个片段")
                except Exception as asr_err:
                    logger.error(f"[ProcessAdditions] ASR 失败: {asr_err}")
                    # 继续处理，创建完整视频 clip
            
            # 创建 clips
            if transcript_segments:
                from ..api.workspace import _create_clips_from_segments_with_offset
                
                video_clips, subtitle_clips, keyframes = await _create_clips_from_segments_with_offset(
                    project_id=project_id,
                    asset_id=asset_id,
                    transcript_segments=transcript_segments,
                    video_track_id=video_track_id,
                    text_track_id=text_track_id,
                    timeline_offset=timeline_position,
                    asset_index=idx,
                    enable_smart_camera=enable_smart_camera,
                    enable_subtitle=enable_asr,  # ★ 新增：只有勾选 ASR 才生成字幕
                )
                
                all_video_clips.extend(video_clips)
                all_subtitle_clips.extend(subtitle_clips)
                all_keyframes.extend(keyframes)  # ★ 收集关键帧
                
                # 更新时间轴位置
                if video_clips:
                    last_clip = max(video_clips, key=lambda c: c["end_time"])
                    timeline_position = last_clip["end_time"]
                else:
                    timeline_position += duration_ms
            else:
                # 没有 ASR 结果，创建完整视频 Clip
                video_clip_id = str(uuid4())
                video_clip = {
                    "id": video_clip_id,
                    "track_id": video_track_id,
                    "asset_id": asset_id,
                    "clip_type": "video",
                    "name": asset_name,
                    "start_time": timeline_position,
                    "end_time": timeline_position + duration_ms,
                    "source_start": 0,
                    "source_end": duration_ms,
                    "is_muted": False,
                    "metadata": {"asset_index": idx, "from_additions": True},
                    "created_at": now,
                    "updated_at": now,
                }
                all_video_clips.append(video_clip)
                timeline_position += duration_ms
            
            task["processed_assets"] = idx + 1
            logger.info(f"[ProcessAdditions] 素材 {idx + 1} 完成，时间轴位置: {timeline_position}ms")
        
        # 5. 批量插入 clips
        task["current_step"] = "saving_clips"
        task["progress"] = 90
        
        if all_video_clips:
            supabase.table("clips").insert(all_video_clips).execute()
            total_created_clips += len(all_video_clips)
            logger.info(f"[ProcessAdditions] 创建 {len(all_video_clips)} 个视频 Clip")
        
        if all_subtitle_clips:
            supabase.table("clips").insert(all_subtitle_clips).execute()
            total_created_clips += len(all_subtitle_clips)
            logger.info(f"[ProcessAdditions] 创建 {len(all_subtitle_clips)} 个字幕 Clip")
        
        # ★ 插入关键帧
        if all_keyframes:
            supabase.table("keyframes").insert(all_keyframes).execute()
            logger.info(f"[ProcessAdditions] 创建 {len(all_keyframes)} 个关键帧")
        
        # 6. 更新项目
        supabase.table("projects").update({
            "updated_at": now,
        }).eq("id", project_id).execute()
        
        # 7. 完成
        task["status"] = "completed"
        task["current_step"] = "completed"
        task["progress"] = 100
        task["created_clips"] = total_created_clips
        
        logger.info(f"[ProcessAdditions] 任务 {task_id} 完成，创建 {total_created_clips} 个 Clips")
        
    except Exception as e:
        logger.error(f"[ProcessAdditions] 任务 {task_id} 失败: {e}")
        import traceback
        traceback.print_exc()
        
        if task_id in _process_additions_tasks:
            task = _process_additions_tasks[task_id]
            task["status"] = "failed"
            task["error"] = str(e)
