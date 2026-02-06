"""
HoppingRabbit AI - 智能播报 Celery 任务
一键生成数字人播报视频

支持三种输入模式:
1. 图片 + 音频 → 对口型视频
2. 图片 + 文本脚本 → TTS + 对口型视频
3. 图片 + 文本脚本 + 声音样本 → 克隆声音 + 对口型视频

处理流程:
1. (可选) TTS 语音合成
2. 图生视频 (Image2Video) - 将静态图转为动态视频
3. 口型同步 (Lip Sync) - 音频驱动口型
4. 上传结果到存储
"""
import os
import asyncio
import logging
import tempfile
import httpx
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import uuid4

from ..celery_config import celery_app
from ..services.kling_ai_service import kling_client
from ..services.tts_service import tts_service

logger = logging.getLogger(__name__)

# ============================================
# Supabase 配置
# ============================================

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_ANON_KEY", ""))

def _get_supabase():
    """延迟导入 supabase 客户端"""
    from ..services.supabase_client import supabase
    return supabase


# ============================================
# 任务状态更新函数
# ============================================

def update_ai_task_progress(task_id: str, progress: int, message: str):
    """更新任务进度"""
    supabase = _get_supabase()
    supabase.table("ai_tasks").update({
        "progress": progress,
        "status_message": message,
    }).eq("id", task_id).execute()
    logger.info(f"[SmartBroadcast] {task_id}: {progress}% - {message}")


def update_ai_task_status(task_id: str, status: str, output_url: str = None, output_asset_id: str = None, error: str = None):
    """更新任务最终状态"""
    supabase = _get_supabase()
    update_data = {
        "status": status,
        "progress": 100 if status == "completed" else None,
    }
    if output_url:
        update_data["output_url"] = output_url
    if output_asset_id:
        update_data["output_asset_id"] = output_asset_id
    if error:
        update_data["error_message"] = error
    
    supabase.table("ai_tasks").update(update_data).eq("id", task_id).execute()


def update_ai_task(task_id: str, **fields):
    """通用字段更新"""
    supabase = _get_supabase()
    supabase.table("ai_tasks").update(fields).eq("id", task_id).execute()


# ============================================
# 辅助函数
# ============================================

async def download_file(url: str, path: str):
    """下载文件"""
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        with open(path, "wb") as f:
            f.write(response.content)


def upload_to_storage(local_path: str, storage_path: str) -> str:
    """上传到 Supabase Storage"""
    from ..tasks.ai_task_base import upload_to_storage as base_upload
    return base_upload(local_path, storage_path)


def create_asset_record(user_id: str, storage_path: str, ai_task_id: str) -> str:
    """创建 Asset 记录"""
    supabase = _get_supabase()
    
    asset_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    
    asset_data = {
        "id": asset_id,
        "project_id": "00000000-0000-0000-0000-000000000000",
        "user_id": user_id,
        "name": f"智能播报_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4",
        "original_filename": "smart_broadcast.mp4",
        "file_type": "video",
        "mime_type": "video/mp4",
        "storage_path": storage_path,
        "status": "ready",
        "ai_task_id": ai_task_id,
        "ai_generated": True,
        "created_at": now,
    }
    
    supabase.table("assets").insert(asset_data).execute()
    return asset_id


# ============================================
# Celery 任务
# ============================================

@celery_app.task(
    name="smart_broadcast",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_kwargs={"max_retries": 2},
)
def process_smart_broadcast(
    self,
    ai_task_id: str,
    user_id: str,
    image_url: str,
    audio_url: str = None,
    script: str = None,
    voice_id: str = None,
    voice_clone_audio_url: str = None,
    options: Dict = None,
):
    """
    智能播报任务
    
    输入模式:
    1. image_url + audio_url → 图片+音频模式
    2. image_url + script + voice_id → 图片+脚本+预设音色模式
    3. image_url + script + voice_clone_audio_url → 图片+脚本+克隆声音模式
    """
    options = options or {}
    
    logger.info(f"[SmartBroadcast] 开始处理任务: {ai_task_id}")
    logger.info(f"[SmartBroadcast] 模式: image={bool(image_url)}, audio={bool(audio_url)}, script={bool(script)}")
    
    # 运行异步任务
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        result = loop.run_until_complete(
            _process_smart_broadcast_async(
                ai_task_id=ai_task_id,
                user_id=user_id,
                image_url=image_url,
                audio_url=audio_url,
                script=script,
                voice_id=voice_id,
                voice_clone_audio_url=voice_clone_audio_url,
                options=options,
            )
        )
        return result
    except Exception as e:
        logger.error(f"[SmartBroadcast] 任务失败: {ai_task_id} - {e}")
        update_ai_task_status(ai_task_id, "failed", error=str(e))
        raise
    finally:
        loop.close()


async def _process_smart_broadcast_async(
    ai_task_id: str,
    user_id: str,
    image_url: str,
    audio_url: str = None,
    script: str = None,
    voice_id: str = None,
    voice_clone_audio_url: str = None,
    options: Dict = None,
) -> Dict:
    """智能播报异步处理"""
    options = options or {}
    
    try:
        # ========================================
        # Step 1: TTS 语音合成 (如果需要)
        # ========================================
        if script and not audio_url:
            update_ai_task_progress(ai_task_id, 5, "正在合成语音...")
            
            # 如果提供了声音样本，先克隆声音
            if voice_clone_audio_url:
                update_ai_task_progress(ai_task_id, 5, "正在克隆您的声音...")
                clone_result = await tts_service.clone_voice(
                    audio_url=voice_clone_audio_url,
                    name=f"user_clone_{ai_task_id[:8]}",
                )
                model_id = clone_result["model_id"]
                logger.info(f"[SmartBroadcast] 声音克隆完成: {model_id}")
                
                # 使用克隆的声音合成
                tts_result = await tts_service.text_to_speech(
                    text=script,
                    model_id=model_id,
                )
            else:
                # 使用预设音色
                tts_result = await tts_service.text_to_speech(
                    text=script,
                    voice_id=voice_id or "zh_female_gentle",
                )
            
            audio_url = tts_result["audio_url"]
            logger.info(f"[SmartBroadcast] TTS 完成: {audio_url}")
            update_ai_task_progress(ai_task_id, 15, "语音合成完成")
        
        if not audio_url:
            raise ValueError("缺少音频：请提供 audio_url 或 script")
        
        # ========================================
        # Step 2: 图生视频 (Image to Video)
        # ========================================
        update_ai_task_progress(ai_task_id, 20, "正在将图片转换为视频...")
        
        # 创建图生视频任务
        i2v_result = await kling_client.create_image_to_video_task(
            image=image_url,
            prompt=options.get("image_prompt", "portrait, looking at camera, natural movement, subtle facial expressions"),
            options={
                "negative_prompt": "blur, distortion, deformation",
                "duration": options.get("duration", "5"),
                "cfg_scale": options.get("cfg_scale", 0.5),
                "model_name": options.get("model_name", "kling-v2-1-master"),
            }
        )
        
        i2v_task_id = i2v_result.get("task_id")
        if not i2v_task_id:
            raise ValueError("创建图生视频任务失败")
        
        logger.info(f"[SmartBroadcast] 图生视频任务已创建: {i2v_task_id}")
        update_ai_task(ai_task_id, provider_task_id=i2v_task_id)
        
        # 轮询等待图生视频完成
        poll_interval = 5
        max_polls = 120  # 最多等待 10 分钟
        
        for i in range(max_polls):
            await asyncio.sleep(poll_interval)
            
            task_info = await kling_client.get_task_status(i2v_task_id, task_type="image_to_video")
            status = task_info.get("task_status")
            
            progress = 20 + int((i / max_polls) * 30)  # 20% - 50%
            update_ai_task_progress(ai_task_id, progress, f"图片转视频中... ({status})")
            
            if status == "succeed":
                break
            elif status in ("failed", "cancelled"):
                error_msg = task_info.get("task_status_msg", "图生视频失败")
                raise ValueError(f"图生视频失败: {error_msg}")
        else:
            raise TimeoutError("图生视频超时")
        
        # 获取生成的视频 URL
        videos = task_info.get("task_result", {}).get("videos", [])
        if not videos:
            raise ValueError("图生视频未返回结果")
        
        i2v_video_url = videos[0]["url"]
        i2v_video_id = videos[0].get("id")
        
        logger.info(f"[SmartBroadcast] 图生视频完成: {i2v_video_url[:50]}...")
        update_ai_task_progress(ai_task_id, 50, "图片转视频完成，开始口型同步...")
        
        # ========================================
        # Step 3: 口型同步 (Lip Sync)
        # ========================================
        update_ai_task_progress(ai_task_id, 55, "正在识别人脸...")
        
        # 人脸识别
        face_result = await kling_client.identify_face(video_url=i2v_video_url)
        
        session_id = face_result.get("session_id")
        faces = face_result.get("face_list", [])
        
        if not faces:
            raise ValueError("未检测到人脸，请确保图片包含清晰的人脸")
        
        face_index = options.get("face_index", 0)
        face = faces[min(face_index, len(faces) - 1)]
        face_id = face["face_id"]
        
        logger.info(f"[SmartBroadcast] 人脸识别完成: session_id={session_id}, face_id={face_id}")
        update_ai_task_progress(ai_task_id, 60, "人脸识别完成，正在同步口型...")
        
        # 创建口型同步任务
        lip_result = await kling_client.create_lip_sync_task(
            session_id=session_id,
            face_id=face_id,
            audio_url=audio_url,
            sound_volume=options.get("sound_volume", 1.0),
            original_audio_volume=options.get("original_audio_volume", 0.0),  # 默认静音原视频
            external_task_id=ai_task_id,
        )
        
        lip_task_id = lip_result.get("task_id")
        if not lip_task_id:
            raise ValueError("创建口型同步任务失败")
        
        logger.info(f"[SmartBroadcast] 口型同步任务已创建: {lip_task_id}")
        update_ai_task(ai_task_id, provider_task_id=lip_task_id)
        
        # 轮询等待口型同步完成
        for i in range(max_polls):
            await asyncio.sleep(poll_interval)
            
            task_info = await kling_client.get_lip_sync_task(lip_task_id)
            status = task_info.get("task_status")
            
            progress = 60 + int((i / max_polls) * 25)  # 60% - 85%
            update_ai_task_progress(ai_task_id, progress, f"口型同步中... ({status})")
            
            if status == "succeed":
                break
            elif status in ("failed", "cancelled"):
                error_msg = task_info.get("task_status_msg", "口型同步失败")
                raise ValueError(f"口型同步失败: {error_msg}")
        else:
            raise TimeoutError("口型同步超时")
        
        # 获取最终视频
        videos = task_info.get("task_result", {}).get("videos", [])
        if not videos:
            raise ValueError("口型同步未返回结果")
        
        output_video_url = videos[0]["url"]
        logger.info(f"[SmartBroadcast] 口型同步完成: {output_video_url[:50]}...")
        
        # ========================================
        # Step 4: 下载并上传到存储
        # ========================================
        update_ai_task_progress(ai_task_id, 90, "正在保存结果...")
        
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = tmp.name
        
        await download_file(output_video_url, tmp_path)
        
        storage_path = f"ai_generated/{user_id}/{ai_task_id}.mp4"
        final_url = upload_to_storage(tmp_path, storage_path)
        
        # 清理临时文件
        os.unlink(tmp_path)
        
        # ========================================
        # Step 5: 创建 Asset 记录
        # ========================================
        update_ai_task_progress(ai_task_id, 95, "创建素材记录...")
        
        asset_id = create_asset_record(
            user_id=user_id,
            storage_path=storage_path,
            ai_task_id=ai_task_id,
        )
        
        # 完成
        update_ai_task_status(
            ai_task_id,
            status="completed",
            output_url=final_url,
            output_asset_id=asset_id,
        )
        
        logger.info(f"[SmartBroadcast] 任务完成: {ai_task_id}, asset_id={asset_id}")
        
        return {
            "success": True,
            "ai_task_id": ai_task_id,
            "output_url": final_url,
            "output_asset_id": asset_id,
        }
        
    except Exception as e:
        logger.error(f"[SmartBroadcast] 处理失败: {e}")
        update_ai_task_status(ai_task_id, "failed", error=str(e))
        raise
