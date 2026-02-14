"""
Lepus AI - 可灵AI HTTP 客户端

高性能异步 HTTP 客户端封装，特性:
1. JWT 动态生成（支持 AK/SK）
2. 单例模式（连接复用）
3. 自动重试和错误处理
4. 完整的 API 方法封装

参考: Kling AI 官方 API 文档
"""

import os
import time
import logging
from typing import Dict, Any, Optional

import httpx
import jwt

logger = logging.getLogger(__name__)


class KlingClient:
    """
    可灵AI API 客户端
    
    使用 HTTPX AsyncClient 实现高性能异步请求
    支持 AK/SK JWT 动态生成认证
    """
    
    # 默认 Base URL（北京节点）
    DEFAULT_BASE_URL = "https://api-beijing.klingai.com"
    
    def __init__(
        self,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 120.0
    ):
        """
        初始化客户端
        
        Args:
            access_key: Kling Access Key（从环境变量 KLING_ACCESS_KEY 读取）
            secret_key: Kling Secret Key（从环境变量 KLING_SECRET_KEY 读取）
            base_url: API 基础 URL（默认北京节点）
            timeout: 请求超时时间（秒）
        """
        self.ak = access_key or os.getenv("KLING_ACCESS_KEY")
        self.sk = secret_key or os.getenv("KLING_SECRET_KEY")
        
        # 备用：静态 token（不推荐，AK/SK 更安全）
        self.static_token = os.getenv("KLING_AI_API_TOKEN")
        
        # 处理 Base URL
        env_base_url = os.getenv("KLING_API_BASE_URL", self.DEFAULT_BASE_URL)
        self.base_url = base_url or env_base_url
        
        # 确保 base_url 包含 /v1
        if not self.base_url.endswith("/v1"):
            self.base_url = f"{self.base_url.rstrip('/')}/v1"
        
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
        
        logger.info(f"[KlingClient] 初始化: base_url={self.base_url}, ak={'***' if self.ak else 'N/A'}")
    
    @property
    def client(self) -> httpx.AsyncClient:
        """延迟初始化 HTTP 客户端"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers={"Content-Type": "application/json"}
            )
        return self._client
    
    def _generate_jwt_token(self) -> str:
        """
        动态生成 JWT Token
        
        使用 AK/SK 生成短期有效的 JWT，比静态 token 更安全
        """
        if self.ak and self.sk:
            headers = {
                "alg": "HS256",
                "typ": "JWT"
            }
            now = int(time.time())
            payload = {
                "iss": self.ak,
                "exp": now + 1800,  # 30 分钟有效期
                "nbf": now - 5,     # 5 秒前开始生效（时钟容差）
            }
            token = jwt.encode(payload, self.sk, algorithm="HS256", headers=headers)
            # PyJWT 2.x 返回 str，但为保险起见处理 bytes
            if isinstance(token, bytes):
                token = token.decode('utf-8')
            return token
        
        # 回退到静态 token
        return self.static_token or ""
    
    def _get_auth_headers(self) -> Dict[str, str]:
        """获取认证请求头"""
        token = self._generate_jwt_token()
        if token:
            return {"Authorization": f"Bearer {token}"}
        return {}
    
    async def close(self):
        """关闭客户端连接"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            logger.info("[KlingClient] 客户端已关闭")
    
    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        发送 API 请求
        
        Args:
            method: HTTP 方法 (GET/POST)
            endpoint: API 端点 (如 /videos/text2video)
            **kwargs: 传递给 httpx 的其他参数
        
        Returns:
            API 响应 JSON
        
        Raises:
            httpx.HTTPStatusError: HTTP 错误
        """
        # 注入认证头
        auth_headers = self._get_auth_headers()
        kwargs.setdefault("headers", {})
        kwargs["headers"].update(auth_headers)
        
        try:
            response = await self.client.request(method, endpoint, **kwargs)
            
            # 记录调试信息
            if response.status_code >= 400:
                logger.error(f"[KlingClient] API 错误: {method} {endpoint} -> {response.status_code}")
                logger.error(f"[KlingClient] 响应: {response.text[:500]}")
            
            response.raise_for_status()
            return response.json()
            
        except httpx.HTTPStatusError as e:
            logger.error(f"[KlingClient] HTTP 错误: {e.response.status_code} - {e.response.text[:200]}")
            raise
        except Exception as e:
            logger.error(f"[KlingClient] 请求异常: {str(e)}")
            raise
    
    # ========================================
    # 视频生成 API
    # ========================================
    
    async def create_text2video(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        文生视频
        
        API: POST /videos/text2video
        """
        logger.info(f"[KlingClient] 文生视频: prompt={data.get('prompt', '')[:50]}...")
        return await self._request("POST", "/videos/text2video", json=data)
    
    async def create_image2video(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        图生视频
        
        API: POST /videos/image2video
        """
        logger.info(f"[KlingClient] 图生视频")
        return await self._request("POST", "/videos/image2video", json=data)
    
    async def create_multi_image2video(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        多图生视频
        
        API: POST /videos/multi-image2video
        """
        logger.info(f"[KlingClient] 多图生视频: images={len(data.get('image_list', []))}张")
        return await self._request("POST", "/videos/multi-image2video", json=data)
    
    async def create_motion_control(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        动作控制
        
        API: POST /videos/motion-control
        """
        logger.info(f"[KlingClient] 动作控制")
        return await self._request("POST", "/videos/motion-control", json=data)
    
    async def extend_video(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        视频延长
        
        API: POST /videos/video-extend
        """
        logger.info(f"[KlingClient] 视频延长: video_id={data.get('video_id')}")
        return await self._request("POST", "/videos/video-extend", json=data)
    
    # ========================================
    # 口型同步 API
    # ========================================
    
    async def identify_face(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        人脸识别 - 对口型第一步
        
        API: POST /videos/identify-face
        """
        logger.info(f"[KlingClient] 人脸识别")
        return await self._request("POST", "/videos/identify-face", json=data)
    
    async def create_lip_sync(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        创建对口型任务 - 第二步
        
        API: POST /videos/advanced-lip-sync
        """
        logger.info(f"[KlingClient] 创建对口型任务: session_id={data.get('session_id')}")
        return await self._request("POST", "/videos/advanced-lip-sync", json=data)
    
    # ========================================
    # 图像生成 API
    # ========================================
    
    async def generate_image(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        标准图像生成
        
        API: POST /images/generations
        """
        logger.info(f"[KlingClient] 图像生成: prompt={data.get('prompt', '')[:50]}...")
        return await self._request("POST", "/images/generations", json=data)
    
    async def generate_omni_image(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Omni-Image (O1) 高级图像生成
        
        API: POST /images/omni-image
        """
        logger.info(f"[KlingClient] Omni图像生成")
        return await self._request("POST", "/images/omni-image", json=data)
    
    # ========================================
    # 其他 API
    # ========================================
    
    async def create_multi_elements(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        多元素视频编辑
        
        API: POST /videos/multi-elements
        """
        logger.info(f"[KlingClient] 多元素编辑")
        return await self._request("POST", "/videos/multi-elements", json=data)
    
    # ========================================
    # 任务查询 API
    # ========================================
    
    async def get_task(self, endpoint_base: str, task_id: str) -> Dict[str, Any]:
        """
        查询任务状态
        
        Args:
            endpoint_base: 端点基础路径 (如 /videos/text2video)
            task_id: 任务 ID
        
        Returns:
            任务状态和结果
        """
        logger.info(f"[KlingClient] 查询任务: {endpoint_base}/{task_id}")
        return await self._request("GET", f"{endpoint_base}/{task_id}")
    
    async def get_task_list(
        self,
        endpoint_base: str,
        page_num: int = 1,
        page_size: int = 30
    ) -> Dict[str, Any]:
        """
        查询任务列表
        
        Args:
            endpoint_base: 端点基础路径 (如 /videos/text2video)
            page_num: 页码 [1, 1000]
            page_size: 每页数量 [1, 500]
        
        Returns:
            任务列表
        """
        params = {"pageNum": page_num, "pageSize": page_size}
        return await self._request("GET", endpoint_base, params=params)
    
    # 便捷方法：各类型任务查询
    async def get_text2video_task(self, task_id: str) -> Dict[str, Any]:
        """查询文生视频任务"""
        return await self.get_task("/videos/text2video", task_id)
    
    async def get_image2video_task(self, task_id: str) -> Dict[str, Any]:
        """查询图生视频任务"""
        return await self.get_task("/videos/image2video", task_id)
    
    async def get_multi_image2video_task(self, task_id: str) -> Dict[str, Any]:
        """查询多图生视频任务"""
        return await self.get_task("/videos/multi-image2video", task_id)
    
    async def get_motion_control_task(self, task_id: str) -> Dict[str, Any]:
        """查询动作控制任务"""
        return await self.get_task("/videos/motion-control", task_id)
    
    async def get_video_extend_task(self, task_id: str) -> Dict[str, Any]:
        """查询视频延长任务"""
        return await self.get_task("/videos/video-extend", task_id)
    
    async def get_lip_sync_task(self, task_id: str) -> Dict[str, Any]:
        """查询对口型任务"""
        return await self.get_task("/videos/advanced-lip-sync", task_id)
    
    async def get_image_generation_task(self, task_id: str) -> Dict[str, Any]:
        """查询图像生成任务"""
        return await self.get_task("/images/generations", task_id)
    
    async def get_omni_image_task(self, task_id: str) -> Dict[str, Any]:
        """查询Omni图像任务"""
        return await self.get_task("/images/omni-image", task_id)


# ============================================
# 单例模式
# ============================================

_kling_client: Optional[KlingClient] = None


def get_kling_client() -> KlingClient:
    """
    获取 KlingClient 单例
    
    使用单例模式复用 HTTP 连接，提高性能
    """
    global _kling_client
    if _kling_client is None:
        _kling_client = KlingClient()
    return _kling_client


async def close_kling_client():
    """关闭 KlingClient 单例"""
    global _kling_client
    if _kling_client is not None:
        await _kling_client.close()
        _kling_client = None
