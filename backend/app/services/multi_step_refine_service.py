"""
多步细粒度优化服务
使用 omni-image API 实现：
1. 分离人物（提取主体）
2. 单独优化背景
3. 合成最终图

核心思路：通过 prompt 工程让 AI 完成所有步骤，无需专门的抠图服务
"""

import logging
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime

from .kling_client import get_kling_client

logger = logging.getLogger(__name__)


class MultiStepRefineService:
    """多步细粒度优化服务"""
    
    def __init__(self):
        self.kling_client = get_kling_client()
    
    async def extract_person(self, image_url: str) -> Dict[str, Any]:
        """
        提取人物（纯白背景）
        
        使用 omni-image 通过 prompt 提取人物
        
        Args:
            image_url: 原图 URL
            
        Returns:
            {"result_url": "...", "task_id": "..."}
        """
        logger.info(f"[MultiStepRefine] 提取人物: {image_url[:50]}...")
        
        # 构建提取人物的 prompt
        prompt = "提取 <<<image_1>>> 中的主体人物，保持人物原始位置、大小和姿态完全不变，将背景替换为纯白色"
        
        result = await self._generate_omni_image(
            prompt=prompt,
            image_list=[{"image": image_url}],
            aspect_ratio="auto"
        )
        
        return result
    
    async def refine_background(
        self, 
        image_url: str, 
        background_prompt: str
    ) -> Dict[str, Any]:
        """
        优化背景（保持人物不变）
        
        这是最核心的功能：保持人物位置和姿态完全不变，只替换背景
        
        Args:
            image_url: 原图或已处理图 URL
            background_prompt: 用户描述的背景效果
            
        Returns:
            {"result_url": "...", "task_id": "..."}
        """
        logger.info(f"[MultiStepRefine] 优化背景: prompt={background_prompt[:30]}...")
        
        # ★ 关键 prompt：强调保持人物不变
        prompt = f"""保持 <<<image_1>>> 中人物的位置、大小、姿态、表情完全不变，
只将背景替换为：{background_prompt}
人物要与新背景自然融合，光影效果协调"""
        
        result = await self._generate_omni_image(
            prompt=prompt,
            image_list=[{"image": image_url}],
            aspect_ratio="auto"
        )
        
        return result
    
    async def composite_layers(
        self, 
        person_url: str, 
        background_url: str
    ) -> Dict[str, Any]:
        """
        合成图层
        
        将分离的人物图层与新背景合成
        
        Args:
            person_url: 人物图层 URL（通常是纯白/透明背景）
            background_url: 背景图 URL
            
        Returns:
            {"result_url": "...", "task_id": "..."}
        """
        logger.info(f"[MultiStepRefine] 合成图层")
        
        prompt = """将 <<<image_1>>> 的人物自然融合到 <<<image_2>>> 的背景中，
保持人物原始位置、大小和比例不变，
调整人物光影使其与背景协调"""
        
        result = await self._generate_omni_image(
            prompt=prompt,
            image_list=[
                {"image": person_url},
                {"image": background_url}
            ],
            aspect_ratio="auto"
        )
        
        return result
    
    async def one_step_refine(
        self, 
        image_url: str, 
        background_prompt: str
    ) -> Dict[str, Any]:
        """
        一步式背景优化（推荐使用）
        
        直接用 AI 完成「保持人物 + 换背景」，无需分步
        这是对用户最友好的方式
        
        Args:
            image_url: 原图 URL
            background_prompt: 用户描述的背景效果
            
        Returns:
            {"result_url": "...", "task_id": "..."}
        """
        return await self.refine_background(image_url, background_prompt)
    
    async def _generate_omni_image(
        self,
        prompt: str,
        image_list: list,
        aspect_ratio: str = "auto",
        n: int = 1
    ) -> Dict[str, Any]:
        """
        调用 omni-image API 生成图像
        
        Args:
            prompt: 提示词
            image_list: 参考图列表 [{"image": "url"}, ...]
            aspect_ratio: 画面比例
            n: 生成数量
            
        Returns:
            {"result_url": "...", "task_id": "..."}
        """
        try:
            # 创建任务
            create_result = await self.kling_client.generate_omni_image({
                "prompt": prompt,
                "image_list": image_list,
                "aspect_ratio": aspect_ratio,
                "n": n,
                "model_name": "kling-image-o1"  # omni-image 专用模型
            })
            
            if create_result.get("code") != 0:
                raise Exception(f"创建任务失败: {create_result.get('message')}")
            
            task_id = create_result.get("data", {}).get("task_id")
            if not task_id:
                raise Exception("未获取到 task_id")
            
            logger.info(f"[MultiStepRefine] 任务已创建: task_id={task_id}")
            
            # 轮询等待结果
            result_url = await self._poll_task_result(task_id)
            
            return {
                "result_url": result_url,
                "task_id": task_id
            }
            
        except Exception as e:
            logger.error(f"[MultiStepRefine] omni-image 生成失败: {e}")
            raise
    
    async def _poll_task_result(
        self, 
        task_id: str, 
        max_wait: int = 120,
        interval: int = 3
    ) -> str:
        """
        轮询任务结果
        
        Args:
            task_id: 任务 ID
            max_wait: 最大等待时间（秒）
            interval: 轮询间隔（秒）
            
        Returns:
            result_url: 生成的图像 URL
        """
        start_time = datetime.utcnow()
        
        while True:
            elapsed = (datetime.utcnow() - start_time).total_seconds()
            if elapsed > max_wait:
                raise Exception(f"任务超时: {task_id}")
            
            # 查询任务状态
            query_result = await self.kling_client.get_omni_image_task(task_id)
            
            if query_result.get("code") != 0:
                raise Exception(f"查询任务失败: {query_result.get('message')}")
            
            task_data = query_result.get("data", {})
            status = task_data.get("task_status")
            
            if status == "succeed":
                # 获取结果 URL
                images = task_data.get("task_result", {}).get("images", [])
                if images:
                    result_url = images[0].get("url")
                    logger.info(f"[MultiStepRefine] 任务完成: {result_url[:50]}...")
                    return result_url
                raise Exception("任务完成但没有图像结果")
                
            elif status == "failed":
                error_msg = task_data.get("task_status_msg", "未知错误")
                raise Exception(f"任务失败: {error_msg}")
            
            # 继续等待
            logger.debug(f"[MultiStepRefine] 等待中: status={status}, elapsed={elapsed:.1f}s")
            await asyncio.sleep(interval)


# 单例
_multi_step_refine_service: Optional[MultiStepRefineService] = None

def get_multi_step_refine_service() -> MultiStepRefineService:
    """获取多步优化服务单例"""
    global _multi_step_refine_service
    if _multi_step_refine_service is None:
        _multi_step_refine_service = MultiStepRefineService()
    return _multi_step_refine_service
