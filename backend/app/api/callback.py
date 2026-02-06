"""
HoppingRabbit AI - 可灵AI Callback 接收器
接收可灵AI的任务状态回调通知，实时更新任务状态

回调协议:
- 当任务状态变更时，可灵AI 会主动 POST 到 callback_url
- 状态: submitted(已提交) / processing(处理中) / succeed(成功) / failed(失败)
- 成功时包含 task_result (images/videos)

优势:
- 无需轮询，实时更新
- 节省资源，降低延迟
- 用户体验更好
"""
import os
import logging
import tempfile
import httpx
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/callback", tags=["Callback"])

# ============================================
# Supabase 配置
# ============================================

STORAGE_BUCKET = "ai-creations"


def _get_supabase():
    """延迟导入 supabase 客户端"""
    from ..services.supabase_client import supabase
    return supabase


# ============================================
# 回调数据模型 (根据可灵AI文档)
# ============================================

class TaskInfoModel(BaseModel):
    """任务创建时的参数信息"""
    external_task_id: Optional[str] = None  # 我们的 ai_task_id
    parent_video: Optional[Dict] = None


class ImageResultModel(BaseModel):
    """图片结果"""
    index: int
    url: str


class VideoResultModel(BaseModel):
    """视频结果"""
    id: str
    url: str
    duration: Optional[str] = None


class TaskResultModel(BaseModel):
    """任务结果"""
    images: Optional[List[ImageResultModel]] = None
    videos: Optional[List[VideoResultModel]] = None


class KlingCallbackPayload(BaseModel):
    """可灵AI回调载荷"""
    task_id: str = Field(..., description="可灵AI任务ID")
    task_status: str = Field(..., description="任务状态: submitted/processing/succeed/failed")
    task_status_msg: Optional[str] = Field(None, description="状态信息/失败原因")
    task_info: Optional[TaskInfoModel] = None
    created_at: Optional[int] = None  # Unix时间戳 ms
    updated_at: Optional[int] = None
    task_result: Optional[TaskResultModel] = None


# ============================================
# 状态映射
# ============================================

KLING_STATUS_MAP = {
    "submitted": ("processing", "任务已提交到AI引擎"),
    "processing": ("processing", "AI正在处理中..."),
    "succeed": ("completed", "任务完成"),
    "failed": ("failed", None),  # 使用 task_status_msg
}


# ============================================
# 工具函数
# ============================================

def update_ai_task(task_id: str, **updates):
    """更新任务表"""
    updates["updated_at"] = datetime.utcnow().isoformat()
    try:
        _get_supabase().table("tasks").update(updates).eq("id", task_id).execute()
        logger.info(f"[Callback] 任务状态已更新: {task_id} -> {updates.get('status', 'N/A')}")
    except Exception as e:
        logger.error(f"[Callback] 更新任务状态失败: {e}")


def find_ai_task_by_provider_task_id(provider_task_id: str) -> Optional[Dict]:
    """根据可灵AI的task_id查找我们的ai_task"""
    try:
        result = _get_supabase().table("tasks").select("*").eq(
            "provider_task_id", provider_task_id
        ).single().execute()
        return result.data
    except Exception as e:
        logger.warning(f"[Callback] 查找任务失败: provider_task_id={provider_task_id}, error={e}")
        return None


async def download_file(url: str, dest_path: str) -> str:
    """下载文件到本地"""
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        with open(dest_path, "wb") as f:
            f.write(response.content)
    return dest_path


def upload_to_storage(file_path: str, storage_path: str, content_type: str) -> str:
    """上传文件到 Supabase Storage"""
    supabase = _get_supabase()
    
    with open(file_path, "rb") as f:
        file_data = f.read()
    
    supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        file_data,
        file_options={"content-type": content_type, "upsert": "true"}
    )
    
    return supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)


def create_ai_output(
    task_id: str,
    user_id: str,
    output_type: str,
    output_index: int,
    original_url: str,
    storage_path: str = None,
    storage_url: str = None,
    width: int = None,
    height: int = None,
    duration: float = None,
    file_size: int = None,
) -> str:
    """
    创建 AI 输出记录 (ai_outputs 表)
    
    这是正确的设计：
    - ai_tasks: 任务状态
    - ai_outputs: 生成结果（1个任务 → N个输出）
    
    与 assets 表无关，AI 模块完全独立！
    """
    supabase = _get_supabase()
    
    output_id = str(uuid4())
    now = datetime.utcnow().isoformat()
    
    output_data = {
        "id": output_id,
        "task_id": task_id,
        "user_id": user_id,
        "output_type": output_type,
        "output_index": output_index,
        "original_url": original_url,
        "storage_path": storage_path,
        "storage_url": storage_url,
        "width": width,
        "height": height,
        "duration": duration,
        "file_size": file_size,
        "created_at": now,
    }
    
    # 移除 None 值
    output_data = {k: v for k, v in output_data.items() if v is not None}
    
    supabase.table("ai_outputs").insert(output_data).execute()
    logger.info(f"[Callback] 创建输出记录: task={task_id}, index={output_index}, type={output_type}")
    return output_id


# ============================================
# 回调处理
# ============================================

async def process_callback_result(
    ai_task: Dict,
    payload: KlingCallbackPayload
):
    """
    异步处理回调结果
    - 下载生成的图片/视频
    - 上传到我们的存储
    - 创建 ai_outputs 记录（不是 assets！）
    - 更新任务状态
    """
    ai_task_id = ai_task["id"]
    user_id = ai_task["user_id"]
    task_type = ai_task["task_type"]
    
    try:
        result = payload.task_result
        if not result:
            update_ai_task(
                ai_task_id,
                status="failed",
                error_code="NO_RESULT",
                error_message="回调成功但无结果数据",
                progress=100
            )
            return
        
        # 处理图片结果
        if result.images:
            await _process_image_results(ai_task_id, user_id, result.images)
        
        # 处理视频结果
        elif result.videos:
            await _process_video_results(ai_task_id, user_id, result.videos)
        
        else:
            update_ai_task(
                ai_task_id,
                status="failed",
                error_code="EMPTY_RESULT",
                error_message="回调成功但结果为空",
                progress=100
            )
            
    except Exception as e:
        logger.error(f"[Callback] 处理结果失败: {ai_task_id}, error={e}")
        update_ai_task(
            ai_task_id,
            status="failed",
            error_code="CALLBACK_PROCESS_ERROR",
            error_message=f"处理回调结果失败: {str(e)}",
            progress=100
        )


async def _process_image_results(
    ai_task_id: str,
    user_id: str,
    images: List[ImageResultModel]
):
    """处理图片结果 - 存入 ai_outputs 表"""
    logger.info(f"[Callback] 处理 {len(images)} 张图片: {ai_task_id}")
    
    update_ai_task(ai_task_id, progress=70, status_message=f"下载 {len(images)} 张图片...")
    
    output_ids = []
    first_url = None
    
    for img in images:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = tmp.name
        
        try:
            # 下载图片
            await download_file(img.url, tmp_path)
            
            # 获取文件大小
            file_size = os.path.getsize(tmp_path)
            
            # 上传到我们的存储
            storage_path = f"ai_generated/{user_id}/{ai_task_id}_{img.index}.png"
            final_url = upload_to_storage(tmp_path, storage_path, "image/png")
            
            # 创建 ai_outputs 记录
            output_id = create_ai_output(
                task_id=ai_task_id,
                user_id=user_id,
                output_type="image",
                output_index=img.index,
                original_url=img.url,
                storage_path=storage_path,
                storage_url=final_url,
                file_size=file_size,
            )
            
            output_ids.append(output_id)
            
            if first_url is None:
                first_url = final_url
                
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    
    # 完成 - output_url 存第一张图，result_metadata 存所有输出 ID
    update_ai_task(
        ai_task_id,
        status="completed",
        progress=100,
        status_message=f"生成完成，共 {len(output_ids)} 张图片",
        output_url=first_url,
        result_metadata={
            "total_outputs": len(output_ids),
            "output_ids": output_ids
        },
        completed_at=datetime.utcnow().isoformat()
    )
    
    logger.info(f"[Callback] 图片处理完成: {ai_task_id}, 共 {len(output_ids)} 张")


async def _process_video_results(
    ai_task_id: str,
    user_id: str,
    videos: List[VideoResultModel]
):
    """处理视频结果 - 存入 ai_outputs 表"""
    logger.info(f"[Callback] 处理 {len(videos)} 个视频: {ai_task_id}")
    
    update_ai_task(ai_task_id, progress=70, status_message=f"下载 {len(videos)} 个视频...")
    
    output_ids = []
    first_url = None
    
    for idx, video in enumerate(videos):
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = tmp.name
        
        try:
            # 下载视频
            await download_file(video.url, tmp_path)
            
            # 获取文件大小
            file_size = os.path.getsize(tmp_path)
            
            # 解析时长
            duration = float(video.duration) if video.duration else None
            
            # 上传到我们的存储
            storage_path = f"ai_generated/{user_id}/{ai_task_id}_{idx}.mp4"
            final_url = upload_to_storage(tmp_path, storage_path, "video/mp4")
            
            # 创建 ai_outputs 记录
            output_id = create_ai_output(
                task_id=ai_task_id,
                user_id=user_id,
                output_type="video",
                output_index=idx,
                original_url=video.url,
                storage_path=storage_path,
                storage_url=final_url,
                duration=duration,
                file_size=file_size,
            )
            
            output_ids.append(output_id)
            
            if first_url is None:
                first_url = final_url
                
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    
    # 完成
    update_ai_task(
        ai_task_id,
        status="completed",
        progress=100,
        status_message=f"生成完成，共 {len(output_ids)} 个视频",
        output_url=first_url,
        result_metadata={
            "total_outputs": len(output_ids),
            "output_ids": output_ids
        },
        completed_at=datetime.utcnow().isoformat()
    )
    
    logger.info(f"[Callback] 视频处理完成: {ai_task_id}, 共 {len(output_ids)} 个")


# ============================================
# API 端点
# ============================================

@router.post("/kling", summary="可灵AI回调接收", tags=["Callback"])
async def kling_callback(
    request: Request,
    background_tasks: BackgroundTasks
):
    """
    接收可灵AI的任务状态回调
    
    可灵AI 会在以下情况推送:
    - 任务状态变更 (submitted → processing → succeed/failed)
    - 包含生成结果 (图片/视频 URL)
    
    注意: 30天后可灵AI会清理结果，我们会下载并存储到自己的 Storage
    """
    try:
        # 解析原始请求体
        body = await request.json()
        logger.info(f"[Callback] 收到可灵AI回调: task_id={body.get('task_id')}, status={body.get('task_status')}")
        
        # 验证并解析
        payload = KlingCallbackPayload(**body)
        
        # 查找对应的任务
        ai_task = find_ai_task_by_provider_task_id(payload.task_id)
        
        if not ai_task:
            # 尝试从 external_task_id 查找
            if payload.task_info and payload.task_info.external_task_id:
                try:
                    result = _get_supabase().table("tasks").select("*").eq(
                        "id", payload.task_info.external_task_id
                    ).single().execute()
                    ai_task = result.data
                except:
                    pass
        
        if not ai_task:
            logger.warning(f"[Callback] 未找到对应任务: provider_task_id={payload.task_id}")
            # 返回 200 避免可灵AI重试
            return {"success": True, "message": "任务不存在，已忽略"}
        
        ai_task_id = ai_task["id"]
        
        # 映射状态
        status_info = KLING_STATUS_MAP.get(payload.task_status)
        if not status_info:
            logger.warning(f"[Callback] 未知状态: {payload.task_status}")
            return {"success": True, "message": f"未知状态: {payload.task_status}"}
        
        our_status, status_message = status_info
        
        # 更新任务状态
        if payload.task_status == "submitted":
            update_ai_task(
                ai_task_id,
                status="processing",
                progress=10,
                status_message="任务已提交到AI引擎",
                started_at=datetime.utcnow().isoformat()
            )
        
        elif payload.task_status == "processing":
            update_ai_task(
                ai_task_id,
                status="processing",
                progress=30,
                status_message="AI正在生成中..."
            )
        
        elif payload.task_status == "succeed":
            # 成功：异步处理结果（下载、上传、创建Asset）
            update_ai_task(
                ai_task_id,
                status="processing",
                progress=60,
                status_message="AI生成完成，正在处理结果..."
            )
            # 后台处理结果
            background_tasks.add_task(process_callback_result, ai_task, payload)
        
        elif payload.task_status == "failed":
            error_msg = payload.task_status_msg or "AI处理失败"
            update_ai_task(
                ai_task_id,
                status="failed",
                progress=100,
                status_message=error_msg,
                error_code="KLING_FAILED",
                error_message=error_msg,
                completed_at=datetime.utcnow().isoformat()
            )
        
        return {
            "success": True,
            "ai_task_id": ai_task_id,
            "status": our_status,
            "message": "回调处理成功"
        }
        
    except Exception as e:
        logger.error(f"[Callback] 处理回调失败: {e}")
        # 返回 200 避免可灵AI无限重试
        return {"success": False, "error": str(e)}


@router.get("/health", summary="回调服务健康检查")
async def callback_health():
    """健康检查端点，用于验证回调服务可达"""
    return {
        "status": "ok",
        "service": "kling_callback",
        "timestamp": datetime.utcnow().isoformat()
    }


# ============================================
# Stripe Webhook 处理
# ============================================

@router.post("/stripe", summary="Stripe Webhook")
async def stripe_webhook(request: Request):
    """
    处理 Stripe 支付事件回调
    
    主要处理:
    - checkout.session.completed: 支付成功，发放积分
    """
    import stripe
    from app.config import get_settings
    
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    
    # 获取原始请求体
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    # 验证 webhook 签名
    try:
        if settings.stripe_webhook_secret:
            event = stripe.Webhook.construct_event(
                payload, sig_header, settings.stripe_webhook_secret
            )
        else:
            # 开发模式：不验证签名
            import json
            event = stripe.Event.construct_from(
                json.loads(payload), stripe.api_key
            )
    except ValueError as e:
        logger.error(f"[Stripe] Invalid payload: {e}")
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError as e:
        logger.error(f"[Stripe] Invalid signature: {e}")
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    # 处理事件
    event_type = event.get("type")
    logger.info(f"[Stripe] Received event: {event_type}")
    
    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        
        # 检查是否是积分充值
        metadata = session.get("metadata", {})
        if metadata.get("type") == "credits_topup":
            user_id = metadata.get("user_id")
            credits_amount = int(metadata.get("credits_amount", 0))
            bonus_credits = int(metadata.get("bonus_credits", 0))
            total_credits = credits_amount + bonus_credits
            
            if user_id and total_credits > 0:
                try:
                    from app.services.credit_service import get_credit_service
                    credit_service = get_credit_service()
                    
                    await credit_service.grant_credits(
                        user_id=user_id,
                        credits=total_credits,
                        transaction_type="purchase",
                        description=f"Stripe 充值 {credits_amount} 积分" + (f" (赠送 {bonus_credits})" if bonus_credits > 0 else ""),
                        reference_id=session.get("id"),
                    )
                    
                    logger.info(f"[Stripe] ✅ 用户 {user_id} 充值成功: {total_credits} 积分 (session={session.get('id')})")
                    
                except Exception as e:
                    logger.error(f"[Stripe] ❌ 发放积分失败: {e}")
                    # 不要返回错误，避免 Stripe 重试
    
    return {"received": True}
