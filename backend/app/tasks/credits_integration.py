"""
HoppingRabbit AI - AI 任务积分集成
在 AI 任务创建和完成时管理积分

用法:
1. 任务创建前: await hold_credits_for_task(user_id, task_type, params, task_id)
2. 任务成功后: await confirm_task_credits(task_id)
3. 任务失败后: await refund_task_credits(user_id, task_id)
"""
import logging
from typing import Dict, Any, Optional

from app.services.credit_service import get_credit_service, InsufficientCreditsError

logger = logging.getLogger(__name__)


# ============================================
# 任务类型到模型 key 的映射
# ============================================

TASK_TYPE_TO_MODEL_KEY = {
    # ========================================
    # 会话级收费 (创建项目时一次性收费)
    # ========================================
    "ai-create": "ai_create_session",      # AI 智能剪辑 - 15 积分/次
    "voice-extract": None,                  # 提取字幕/音频 - 免费
    
    # ========================================
    # 基础功能 (免费，积分设为 0)
    # ========================================
    "transcribe": "whisper_transcribe",
    "filler_detection": "filler_detection",
    "stem_separation": "stem_separation",
    "diarization": "diarization",
    "vad": "vad",
    
    # ========================================
    # 智能功能 (免费，积分设为 0)
    # ========================================
    "smart_clip": "smart_clip",
    "smart_camera": "smart_camera",
    "smart_clean": "smart_clean",
    "ai_analysis": "gpt4_analysis",
    
    # ========================================
    # 图像生成 (免费)
    # ========================================
    "image_generation": "dalle3",
    "sd_generate": "sd_generate",
    
    # ========================================
    # Kling AI (保持收费)
    # ========================================
    "lip_sync": "kling_lip_sync",
    "face_swap": "kling_face_swap",
    "image_to_video": "kling_i2v",
    "text_to_video": "kling_t2v",
    "motion_control": "kling_motion",
    "omni_image": "kling_omni_image",
    "multi_image_to_video": "kling_i2v",  # 多图也用 i2v
}


def get_model_key_for_task(task_type: str) -> Optional[str]:
    """
    根据任务类型获取模型 key
    
    Args:
        task_type: 任务类型 (如 'lip_sync', 'smart_clip')
        
    Returns:
        模型 key (如 'kling_lip_sync')，免费任务返回 None
    """
    # 检查是否在映射表中
    if task_type in TASK_TYPE_TO_MODEL_KEY:
        return TASK_TYPE_TO_MODEL_KEY[task_type]  # 可能是 None (免费)
    # 未知任务类型，默认使用 task_type 作为 model_key
    return task_type


def is_free_task(task_type: str) -> bool:
    """
    判断任务是否免费
    
    Args:
        task_type: 任务类型
        
    Returns:
        True 如果任务免费，False 如果需要收费
    """
    model_key = get_model_key_for_task(task_type)
    return model_key is None


async def calculate_task_credits(
    task_type: str,
    params: Dict[str, Any] = None
) -> int:
    """
    计算任务所需积分
    
    Args:
        task_type: 任务类型
        params: 参数 (可包含 duration_seconds, count 等)
        
    Returns:
        所需积分数 (免费任务返回 0)
    """
    model_key = get_model_key_for_task(task_type)
    
    # 免费任务直接返回 0
    if model_key is None:
        logger.info(f"[Credits] 任务类型 {task_type} 为免费，无需积分")
        return 0
    
    service = get_credit_service()
    return await service.calculate_credits(model_key, params or {})


async def hold_credits_for_task(
    user_id: str,
    task_type: str,
    task_id: str,
    params: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """
    为任务冻结积分
    
    在任务创建时调用，冻结所需积分。
    任务完成后调用 confirm_task_credits 确认扣除，
    任务失败后调用 refund_task_credits 退还。
    
    免费任务会跳过冻结步骤，直接返回成功。
    
    Args:
        user_id: 用户 ID
        task_type: 任务类型
        task_id: AI 任务 ID
        params: 参数 (可包含 duration_seconds 等)
        
    Returns:
        {
            "success": True,
            "credits_held": 65,
            "model_key": "kling_lip_sync",
            "is_free": False
        }
        
    Raises:
        InsufficientCreditsError: 积分不足
    """
    model_key = get_model_key_for_task(task_type)
    
    # 免费任务直接返回成功，跳过积分冻结
    if model_key is None:
        logger.info(f"[Credits] 任务 {task_id} ({task_type}) 为免费，跳过积分冻结")
        return {
            "success": True,
            "credits_held": 0,
            "model_key": None,
            "is_free": True,
        }
    
    service = get_credit_service()
    
    # 计算所需积分
    credits = await service.calculate_credits(model_key, params or {})
    
    # 积分为 0 也视为免费
    if credits <= 0:
        logger.info(f"[Credits] 任务 {task_id} ({task_type}) 积分为 0，跳过积分冻结")
        return {
            "success": True,
            "credits_held": 0,
            "model_key": model_key,
            "is_free": True,
        }
    
    logger.info(f"[Credits] 任务 {task_id} ({task_type}) 需要 {credits} 积分")
    
    # 冻结积分
    result = await service.hold_credits(
        user_id=user_id,
        credits=credits,
        ai_task_id=task_id,
        model_key=model_key,
    )
    
    return {
        "success": result["success"],
        "credits_held": credits,
        "model_key": model_key,
        "transaction_id": result.get("transaction_id"),
        "is_free": False,
    }


async def confirm_task_credits(task_id: str) -> Dict[str, Any]:
    """
    确认任务积分扣除 (任务成功完成时调用)
    
    Args:
        task_id: AI 任务 ID
        
    Returns:
        {"success": True, "credits_confirmed": 65}
    """
    service = get_credit_service()
    result = await service.confirm_credits(task_id)
    
    logger.info(f"[Credits] 任务 {task_id} 积分确认扣除: {result.get('credits_confirmed', 0)}")
    
    return result


async def refund_task_credits(
    user_id: str = None,
    task_id: str = None,
    reason: str = "任务处理失败"
) -> Dict[str, Any]:
    """
    退还任务积分 (任务失败时调用)
    
    Args:
        user_id: 用户 ID (可选)
        task_id: AI 任务 ID
        reason: 退款原因
        
    Returns:
        {"success": True, "credits_refunded": 65}
    """
    service = get_credit_service()
    result = await service.refund_credits(
        user_id=user_id,
        ai_task_id=task_id,
        reason=reason,
    )
    
    logger.info(f"[Credits] 任务 {task_id} 积分退还: {result.get('credits_refunded', 0)}")
    
    return result


async def check_user_credits(user_id: str, task_type: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    检查用户是否有足够积分执行任务
    
    Args:
        user_id: 用户 ID
        task_type: 任务类型
        params: 参数
        
    Returns:
        {
            "allowed": True/False,
            "required": 65,
            "available": 523,
            "message": "积分充足" / "积分不足"
        }
    """
    model_key = get_model_key_for_task(task_type)
    service = get_credit_service()
    
    # 计算所需积分
    credits = await service.calculate_credits(model_key, params or {})
    
    # 检查余额
    return await service.check_credits(user_id, credits)


# ============================================
# 装饰器 (可选，用于自动管理积分)
# ============================================

def with_credits(task_type: str):
    """
    积分管理装饰器
    
    自动在任务执行前冻结积分，成功后确认，失败后退还。
    
    用法:
        @with_credits("lip_sync")
        async def process_lip_sync(task_id, user_id, params):
            ...
    """
    def decorator(func):
        async def wrapper(task_id: str, user_id: str, params: Dict[str, Any] = None, *args, **kwargs):
            # 计算时长参数
            credit_params = {}
            if params:
                if "duration" in params:
                    credit_params["duration_seconds"] = params["duration"]
                elif "duration_seconds" in params:
                    credit_params["duration_seconds"] = params["duration_seconds"]
            
            # 冻结积分
            try:
                await hold_credits_for_task(user_id, task_type, task_id, credit_params)
            except InsufficientCreditsError as e:
                # 积分不足，任务不执行
                from app.tasks.ai_task_base import mark_task_failed
                mark_task_failed(task_id, str(e), "INSUFFICIENT_CREDITS")
                raise
            
            try:
                # 执行任务
                result = await func(task_id, user_id, params, *args, **kwargs)
                
                # 任务成功，确认积分
                await confirm_task_credits(task_id)
                
                return result
            except Exception as e:
                # 任务失败，退还积分
                await refund_task_credits(user_id, task_id, f"任务处理失败: {str(e)}")
                raise
        
        return wrapper
    return decorator
