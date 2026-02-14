"""
Lepus AI - 图像生成 Celery 任务
异步处理文生图/图生图任务，支持进度更新和结果存储

任务流程:
1. 接收 prompt 和可选参考图
2. (可选) 使用 LLM 增强 prompt
3. 调用可灵 AI API 创建图像生成任务
4. 轮询任务状态，更新进度
5. 下载生成结果，上传到 Supabase Storage
6. 创建 ai_outputs 记录，更新任务状态

应用场景:
- 生成口播背景图片
- 生成产品展示图
- 生成数字人参考形象
"""
import os
import asyncio
import logging
import tempfile
import httpx
from datetime import datetime
from typing import Optional, Dict, Any, List
from uuid import uuid4

from ..celery_config import celery_app
from ..services.kling_ai_service import kling_client
from ..services.llm import llm_service
from ..config import get_settings

logger = logging.getLogger(__name__)

# ============================================
# Supabase 配置
# ============================================

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", os.getenv("SUPABASE_ANON_KEY", ""))
STORAGE_BUCKET = "ai-creations"


def _get_supabase():
    """延迟导入 supabase 客户端"""
    from ..services.supabase_client import supabase
    return supabase


# ============================================
# AI 任务表操作
# ============================================

def update_ai_task(task_id: str, **updates):
    """更新任务表"""
    updates["updated_at"] = datetime.utcnow().isoformat()
    try:
        _get_supabase().table("tasks").update(updates).eq("id", task_id).execute()
    except Exception as e:
        logger.error(f"[ImageGen] 更新任务状态失败: {e}")


def update_ai_task_progress(task_id: str, progress: int, status_message: str = None):
    """更新任务进度"""
    updates = {"progress": progress}
    if status_message:
        updates["status_message"] = status_message
    update_ai_task(task_id, **updates)


def update_ai_task_status(
    task_id: str, 
    status: str, 
    output_url: str = None,
    output_asset_id: str = None,
    error_code: str = None,
    error_message: str = None,
    result_metadata: Dict = None
):
    """更新任务状态"""
    updates = {"status": status}
    
    if status == "processing":
        updates["started_at"] = datetime.utcnow().isoformat()
    elif status in ("completed", "failed"):
        updates["completed_at"] = datetime.utcnow().isoformat()
    
    if output_url:
        updates["output_url"] = output_url
    if output_asset_id:
        updates["output_asset_id"] = output_asset_id
    if error_code:
        updates["error_code"] = error_code
    if error_message:
        updates["error_message"] = error_message
    if result_metadata:
        updates["metadata"] = result_metadata
    if status == "completed":
        updates["progress"] = 100
    
    update_ai_task(task_id, **updates)


# ============================================
# 文件下载和上传
# ============================================

async def download_file(url: str, dest_path: str) -> str:
    """下载文件到本地"""
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        
        with open(dest_path, "wb") as f:
            f.write(response.content)
    
    return dest_path


def upload_to_storage(file_path: str, storage_path: str, content_type: str = "image/png") -> str:
    """上传文件到 Supabase Storage"""
    supabase = _get_supabase()
    
    with open(file_path, "rb") as f:
        file_data = f.read()
    
    # 上传文件 (upsert=true 避免重复报错)
    supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        file_data,
        file_options={"content-type": content_type, "upsert": "true"}
    )
    
    # 获取公开 URL
    public_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
    
    return public_url


def create_asset_record(
    user_id: str,
    storage_path: str,
    ai_task_id: str,
    asset_type: str = "image",
) -> str:
    """创建 Asset 记录 - 匹配 assets 表结构"""
    supabase = _get_supabase()
    
    asset_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    
    # 根据类型设置文件扩展名和 mime_type
    if asset_type == "image":
        ext = ".png"
        file_type = "image"
        mime_type = "image/png"
    else:
        ext = ".mp4"
        file_type = "video"
        mime_type = "video/mp4"
    
    asset_data = {
        "id": asset_id,
        # AI 生成的素材不关联具体项目，project_id 为 null
        "user_id": user_id,
        "name": f"AI生成_{datetime.now().strftime('%Y%m%d_%H%M%S')}{ext}",
        "original_filename": f"ai_generated{ext}",
        "file_type": file_type,
        "mime_type": mime_type,
        "storage_path": storage_path,
        "status": "ready",
        "ai_task_id": ai_task_id,
        "ai_generated": True,
        "created_at": now,
        "updated_at": now,
    }
    
    supabase.table("assets").insert(asset_data).execute()
    
    return asset_id


# ============================================
# Celery 任务
# ============================================

def _get_callback_url() -> str:
    """获取回调URL"""
    from ..config import get_settings
    settings = get_settings()
    
    if settings.callback_base_url:
        return f"{settings.callback_base_url.rstrip('/')}/api/callback/kling"
    return ""


@celery_app.task(
    bind=True,
    name="app.tasks.image_generation.process_image_generation",
    queue="gpu",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_kwargs={"max_retries": 3},
    soft_time_limit=600,   # 10 分钟软超时
    time_limit=900,        # 15 分钟硬超时
)
def process_image_generation(
    self,
    ai_task_id: str,
    user_id: str,
    prompt: str,
    negative_prompt: str = "",
    image: str = None,
    image_reference: str = None,
    options: Dict = None
):
    """
    图像生成 Celery 任务 - 文生图/图生图
    
    支持两种模式:
    1. 回调模式 (推荐): 配置 callback_base_url 后，任务提交后立即返回，结果由回调接收
    2. 轮询模式: 未配置回调时，任务会轮询等待结果
    
    Args:
        ai_task_id: 任务 ID
        user_id: 用户 ID
        prompt: 正向提示词
        negative_prompt: 负向提示词
        image: 参考图像（Base64 或 URL）
        image_reference: 图片参考类型 (subject/face)
        options: 可选参数
            - model_name: 模型 kling-v1/kling-v1-5/kling-v2/kling-v2-new/kling-v2-1
            - image_fidelity: 图片参考强度 [0,1]
            - human_fidelity: 面部参考强度 [0,1]
            - resolution: 清晰度 1k/2k
            - n: 生成数量 [1,9]
            - aspect_ratio: 画面比例
    """
    options = options or {}
    
    # 检查是否使用回调模式
    callback_url = _get_callback_url()
    if callback_url:
        options["callback_url"] = callback_url
        logger.info(f"[ImageGen] 使用回调模式: {ai_task_id}, callback_url={callback_url}")
    else:
        logger.info(f"[ImageGen] 使用轮询模式: {ai_task_id}")
    
    # 运行异步任务
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        result = loop.run_until_complete(
            _process_image_generation_async(
                ai_task_id=ai_task_id,
                user_id=user_id,
                prompt=prompt,
                negative_prompt=negative_prompt,
                image=image,
                image_reference=image_reference,
                options=options,
                use_callback=bool(callback_url),
            )
        )
        return result
    finally:
        loop.close()


async def _process_image_generation_async(
    ai_task_id: str,
    user_id: str,
    prompt: str,
    negative_prompt: str,
    image: str,
    image_reference: str,
    options: Dict,
    use_callback: bool = False
) -> Dict:
    """
    图像生成异步处理
    
    Args:
        use_callback: 是否使用回调模式
            - True: 提交任务后立即返回，结果由 /api/callback/kling 接收
            - False: 轮询等待任务完成
    """
    
    try:
        # Step 1: 更新状态为处理中
        update_ai_task_status(ai_task_id, "processing")
        
        mode_hint = "回调模式" if use_callback else "轮询模式"
        update_ai_task_progress(ai_task_id, 5, f"准备处理（{mode_hint}）")
        
        # Step 1.5: Prompt 增强（可选）
        is_image_to_image = bool(image)
        enhanced_prompt = prompt
        
        if llm_service.is_configured():
            update_ai_task_progress(ai_task_id, 8, "优化提示词...")
            try:
                enhanced_prompt = await llm_service.enhance_image_prompt(prompt, is_image_to_image)
                logger.info(f"[ImageGen] Prompt 增强: {prompt[:30]}... -> {enhanced_prompt[:50]}...")
            except Exception as e:
                logger.warning(f"[ImageGen] Prompt 增强失败，使用原始 prompt: {e}")
                enhanced_prompt = prompt
        
        # Step 2: 创建图像生成任务
        update_ai_task_progress(ai_task_id, 10, "提交生成请求到AI引擎")
        
        task_type = "图生图" if image else "文生图"
        logger.info(f"[ImageGen] 创建{task_type}任务: prompt={enhanced_prompt[:50]}...")
        
        create_result = await kling_client.create_image_generation_task(
            prompt=enhanced_prompt,
            negative_prompt=negative_prompt,
            image=image,
            image_reference=image_reference,
            options=options
        )
        
        if create_result.get("code") != 0:
            raise ValueError(f"创建任务失败: {create_result.get('message', '未知错误')}")
        
        provider_task_id = create_result.get("data", {}).get("task_id")
        task_status = create_result.get("data", {}).get("task_status")
        
        if not provider_task_id:
            raise ValueError("创建任务失败：未返回 task_id")
        
        update_ai_task(ai_task_id, provider_task_id=provider_task_id)
        logger.info(f"[ImageGen] 任务已创建: provider_task_id={provider_task_id}, status={task_status}")
        
        # ============================================
        # 回调模式: 立即返回，等待回调通知
        # ============================================
        if use_callback:
            update_ai_task_progress(
                ai_task_id, 
                15, 
                "任务已提交，等待AI处理完成..."
            )
            
            logger.info(f"[ImageGen] 回调模式 - 任务已提交，等待回调: {ai_task_id}")
            
            return {
                "success": True,
                "ai_task_id": ai_task_id,
                "provider_task_id": provider_task_id,
                "mode": "callback",
                "message": "任务已提交，结果将通过回调返回"
            }
        
        # ============================================
        # 轮询模式: 等待任务完成
        # ============================================
        update_ai_task_progress(ai_task_id, 20, "AI 生成中（轮询等待）")
        
        max_polls = 60  # 最多轮询 60 次（5 分钟）
        poll_interval = 5  # 每 5 秒轮询一次
        current_status = task_status
        task_result = None
        
        for i in range(max_polls):
            await asyncio.sleep(poll_interval)
            
            query_result = await kling_client.get_image_generation_task(provider_task_id)
            
            if query_result.get("code") != 0:
                logger.warning(f"[ImageGen] 查询失败: {query_result.get('message')}")
                continue
            
            task_data = query_result.get("data", {})
            current_status = task_data.get("task_status")
            
            # 更新进度（20% - 80%）
            progress = 20 + int((i / max_polls) * 60)
            status_msg = {
                "submitted": "任务已提交",
                "processing": "AI正在生成中...",
                "succeed": "生成完成",
                "failed": "生成失败"
            }.get(current_status, current_status)
            update_ai_task_progress(ai_task_id, progress, status_msg)
            
            logger.info(f"[ImageGen] 轮询 {i+1}/{max_polls}: status={current_status}")
            
            if current_status == "succeed":
                task_result = task_data
                logger.info(f"[ImageGen] 任务完成")
                break
            elif current_status == "failed":
                error_msg = task_data.get("task_status_msg", "未知错误")
                raise ValueError(f"AI 任务失败: {error_msg}")
            elif current_status in ("submitted", "processing"):
                continue
            else:
                logger.warning(f"[ImageGen] 未知状态: {current_status}")
        
        if current_status != "succeed":
            raise TimeoutError(f"任务超时：{max_polls * poll_interval} 秒后仍未完成")
        
        # Step 4: 获取生成结果
        images = task_result.get("task_result", {}).get("images", [])
        
        if not images:
            raise ValueError("AI 返回结果中没有图片")
        
        logger.info(f"[ImageGen] 生成了 {len(images)} 张图片")
        
        # Step 5: 下载并上传所有图片
        update_ai_task_progress(ai_task_id, 85, f"下载生成结果 ({len(images)} 张)")
        
        uploaded_images = []
        first_asset_id = None
        first_url = None
        
        for img in images:
            img_index = img.get("index", 0)
            img_url = img.get("url")
            
            if not img_url:
                continue
            
            # 下载图片
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp_path = tmp.name
            
            await download_file(img_url, tmp_path)
            
            # 上传到 Supabase Storage
            storage_path = f"ai_generated/{user_id}/{ai_task_id}_{img_index}.png"
            final_url = upload_to_storage(tmp_path, storage_path, "image/png")
            
            # 清理临时文件
            os.unlink(tmp_path)
            
            # 创建 Asset 记录
            asset_id = create_asset_record(
                user_id=user_id,
                storage_path=storage_path,
                ai_task_id=ai_task_id,
                asset_type="image",
            )
            
            uploaded_images.append({
                "index": img_index,
                "url": final_url,
                "asset_id": asset_id
            })
            
            # 保存第一张图片信息
            if first_asset_id is None:
                first_asset_id = asset_id
                first_url = final_url
        
        # Step 6: 完成
        update_ai_task_status(
            ai_task_id,
            status="completed",
            output_url=first_url,
            output_asset_id=first_asset_id,
            result_metadata={
                "total_images": len(uploaded_images),
                "images": uploaded_images
            }
        )
        
        logger.info(f"[ImageGen] 任务完成: {ai_task_id}, 共 {len(uploaded_images)} 张图片")
        
        return {
            "success": True,
            "ai_task_id": ai_task_id,
            "output_url": first_url,
            "output_asset_id": first_asset_id,
            "images": uploaded_images,
            "mode": "polling"
        }
        
    except Exception as e:
        logger.error(f"[ImageGen] 任务失败: {ai_task_id}, error={e}")
        
        update_ai_task_status(
            ai_task_id,
            status="failed",
            error_code="PROCESSING_ERROR",
            error_message=str(e)
        )
        
        raise

