"""
HoppingRabbit AI - 多模态视频编辑 Celery 任务
异步处理视频元素增加/替换/删除任务

应用场景：
- 视频中增加新元素（如产品、角色）
- 替换视频中的元素（如换背景、换物品）
- 删除视频中的元素（如去水印、去路人）
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
from ..services.kling_ai_service import kling_client, KlingConfig

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
    """更新 ai_tasks 表"""
    updates["updated_at"] = datetime.utcnow().isoformat()
    try:
        _get_supabase().table("ai_tasks").update(updates).eq("id", task_id).execute()
    except Exception as e:
        logger.error(f"更新 ai_task 失败: {e}")


def create_asset(user_id: str, asset_data: Dict) -> Optional[str]:
    """创建 Asset 记录"""
    try:
        result = _get_supabase().table("assets").insert(asset_data).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]["id"]
    except Exception as e:
        logger.error(f"创建 asset 失败: {e}")
    return None


# ============================================
# Celery 任务
# ============================================

@celery_app.task(name="tasks.multi_elements.process_multi_elements", bind=True)
def process_multi_elements(
    self,
    task_id: str,
    user_id: str,
    video_url: str,
    edit_mode: str,
    prompt: str,
    selections: List[Dict] = None,
    options: Dict = None
):
    """
    多模态视频编辑任务入口
    
    Args:
        task_id: ai_tasks 表的任务 ID
        user_id: 用户 ID
        video_url: 待编辑视频 URL
        edit_mode: 编辑模式 "addition"/"swap"/"removal"
        prompt: 提示词
        selections: 选区列表 [{"frame_index": 0, "points": [{"x": 0.5, "y": 0.5}]}]
        options: 可选参数 (image_list, negative_prompt, duration, mode)
    """
    options = options or {}
    selections = selections or []
    
    logger.info(f"[MultiElements] 开始处理任务: task_id={task_id}, edit_mode={edit_mode}")
    
    try:
        # 使用异步函数
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        result = loop.run_until_complete(
            _process_multi_elements_async(task_id, user_id, video_url, edit_mode, prompt, selections, options)
        )
        return result
    
    except Exception as e:
        logger.error(f"[MultiElements] 任务失败: {e}", exc_info=True)
        update_ai_task(
            task_id,
            status="failed",
            error_message=str(e),
            progress=0
        )
        raise


async def _process_multi_elements_async(
    task_id: str,
    user_id: str,
    video_url: str,
    edit_mode: str,
    prompt: str,
    selections: List[Dict],
    options: Dict
) -> Dict:
    """
    多模态视频编辑异步处理
    
    流程:
    1. 更新状态为 processing
    2. 初始化待编辑视频，获取 session_id
    3. 添加选区标记（如果是替换或删除模式）
    4. 创建编辑任务
    5. 轮询任务状态，更新进度
    6. 下载生成的视频
    7. 上传到 Supabase Storage
    8. 创建 Asset 记录
    9. 更新任务状态为 completed
    """
    
    try:
        # Step 1: 更新状态
        update_ai_task(task_id, status="processing", progress=5)
        logger.info(f"[MultiElements] Step 1: 状态更新为 processing")
        
        # Step 2: 初始化待编辑视频
        logger.info(f"[MultiElements] Step 2: 初始化待编辑视频...")
        init_response = await kling_client.init_video_selection(video_url=video_url)
        
        init_data = init_response.get("data", {})
        session_id = init_data.get("session_id")
        if not session_id:
            raise ValueError(f"初始化视频失败: {init_response}")
        
        logger.info(f"[MultiElements] 获取 session_id: {session_id}")
        update_ai_task(task_id, progress=15)
        
        # Step 3: 添加选区标记（替换或删除模式需要标记元素）
        if selections and edit_mode in ["swap", "removal"]:
            logger.info(f"[MultiElements] Step 3: 添加选区标记...")
            for i, sel in enumerate(selections):
                frame_index = sel.get("frame_index", 0)
                points = sel.get("points", [])
                
                if points:
                    await kling_client.add_video_selection(
                        session_id=session_id,
                        frame_index=frame_index,
                        points=points
                    )
                    logger.info(f"[MultiElements] 添加选区 {i+1}/{len(selections)}: frame={frame_index}")
            
            update_ai_task(task_id, progress=25)
        else:
            update_ai_task(task_id, progress=25)
        
        # Step 4: 创建编辑任务
        logger.info(f"[MultiElements] Step 4: 创建编辑任务...")
        api_options = {
            "model_name": options.get("model_name", "kling-v1-6"),
            "duration": options.get("duration", "5"),
            "mode": options.get("mode", "std"),
        }
        
        if options.get("image_list"):
            api_options["image_list"] = options["image_list"]
        if options.get("negative_prompt"):
            api_options["negative_prompt"] = options["negative_prompt"]
        
        create_response = await kling_client.create_multi_elements_task(
            session_id=session_id,
            edit_mode=edit_mode,
            prompt=prompt,
            options=api_options
        )
        
        kling_task_id = create_response.get("data", {}).get("task_id")
        if not kling_task_id:
            raise ValueError(f"创建编辑任务失败: {create_response}")
        
        update_ai_task(task_id, kling_task_id=kling_task_id, progress=30)
        logger.info(f"[MultiElements] 可灵任务ID: {kling_task_id}")
        
        # Step 5: 轮询任务状态
        max_polls = 180  # 最多 180 次，总计 15 分钟
        poll_count = 0
        status_data = {}
        
        while poll_count < max_polls:
            await asyncio.sleep(5)  # 每 5 秒轮询一次
            poll_count += 1
            
            status_response = await kling_client.get_multi_elements_task(kling_task_id)
            status_data = status_response.get("data", {})
            task_status = status_data.get("task_status", "")
            
            logger.info(f"[MultiElements] 轮询 {poll_count}/{max_polls}: status={task_status}")
            
            # 计算进度 30-80%
            progress = 30 + int((poll_count / max_polls) * 50)
            update_ai_task(task_id, progress=min(progress, 80))
            
            if task_status == "succeed":
                logger.info(f"[MultiElements] 任务成功")
                break
            elif task_status == "failed":
                error_msg = status_data.get("task_status_msg", "Unknown error")
                raise RuntimeError(f"可灵任务失败: {error_msg}")
        
        if poll_count >= max_polls:
            raise TimeoutError("任务超时")
        
        # Step 6: 获取结果视频 URL
        task_result = status_data.get("task_result", {})
        videos = task_result.get("videos", [])
        if not videos or len(videos) == 0:
            raise ValueError("任务结果中没有视频")
        
        video_result_url = videos[0].get("url")
        if not video_result_url:
            raise ValueError("视频 URL 为空")
        
        logger.info(f"[MultiElements] Step 6: 获取视频 URL: {video_result_url[:80]}...")
        update_ai_task(task_id, progress=85)
        
        # Step 7: 下载视频到临时文件
        logger.info(f"[MultiElements] Step 7: 下载视频...")
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.get(video_result_url)
            response.raise_for_status()
            temp_file.write(response.content)
            temp_file.close()
        
        file_size = os.path.getsize(temp_file.name)
        logger.info(f"[MultiElements] 视频已下载: {temp_file.name}, size={file_size}")
        update_ai_task(task_id, progress=90)
        
        # Step 8: 上传到 Supabase Storage
        logger.info(f"[MultiElements] Step 8: 上传到 Supabase Storage...")
        storage_path = f"ai_generated/{user_id}/{task_id}.mp4"
        
        with open(temp_file.name, "rb") as f:
            _get_supabase().storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                f.read(),
                {"content-type": "video/mp4", "upsert": "true"}
            )
        
        # 获取公开 URL
        storage_url = _get_supabase().storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
        logger.info(f"[MultiElements] 上传成功: {storage_url[:80]}...")
        
        # 清理临时文件
        os.unlink(temp_file.name)
        
        update_ai_task(task_id, progress=95)
        
        # Step 9: 创建 Asset 记录
        logger.info(f"[MultiElements] Step 9: 创建 Asset 记录...")
        
        edit_mode_names = {
            "addition": "增加元素",
            "swap": "替换元素",
            "removal": "删除元素"
        }
        
        asset_data = {
            "project_id": "00000000-0000-0000-0000-000000000000",
            "user_id": user_id,
            "name": f"AI{edit_mode_names.get(edit_mode, '编辑')}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
            "file_type": "video",
            "original_filename": "ai_generated.mp4",
            "mime_type": "video/mp4",
            "storage_path": storage_path,
            "duration": float(videos[0].get("duration", 5.0)),
            "ai_task_id": task_id,
            "ai_generated": True,
            "status": "ready"
        }
        
        asset_id = create_asset(user_id, asset_data)
        if not asset_id:
            raise RuntimeError("创建 Asset 记录失败")
        
        logger.info(f"[MultiElements] Asset 创建成功: {asset_id}")
        
        # Step 10: 完成任务
        update_ai_task(
            task_id,
            status="completed",
            progress=100,
            result_asset_id=asset_id,
            result_url=storage_url
        )
        
        logger.info(f"[MultiElements] 任务完成: task_id={task_id}, asset_id={asset_id}")
        
        return {
            "task_id": task_id,
            "asset_id": asset_id,
            "video_url": storage_url
        }
    
    except Exception as e:
        logger.error(f"[MultiElements] 处理失败: {e}", exc_info=True)
        update_ai_task(task_id, status="failed", error_message=str(e))
        raise
