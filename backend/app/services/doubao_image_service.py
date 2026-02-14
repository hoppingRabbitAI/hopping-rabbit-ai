"""
豆包 Seedream 4.0 图像生成服务

通过火山方舟 Ark API 调用 Seedream 4.0 模型。
统一端点 /api/v3/images/generations，通过参数组合覆盖 6 种模式：
  - 纯文生图 / 单图参考 / 多图参考 × 单张/多张

关键差异（vs Kling）：
  - 同步返回（单张）或 SSE 流式（多张）
  - image 参数为 string | string[]（非 image_list）
  - 无独立 negative_prompt 字段，需拼入 prompt
"""

import logging
from typing import Optional, Union, List

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"


class DoubaoImageService:
    """豆包 Seedream 4.0 图像生成"""

    def __init__(self):
        self._settings = None

    @property
    def settings(self):
        if self._settings is None:
            self._settings = get_settings()
        return self._settings

    @property
    def _headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.settings.volcengine_ark_api_key}",
        }

    async def generate(
        self,
        prompt: str,
        *,
        negative_prompt: Optional[str] = None,
        image: Optional[Union[str, List[str]]] = None,
        sequential: bool = False,
        max_images: int = 1,
        size: str = "2K",
        watermark: bool = False,
    ) -> dict:
        """
        统一生图入口。

        Args:
            prompt: 正面提示词
            negative_prompt: 负面提示词（拼入 prompt 尾部）
            image: 参考图 URL — string 单张, list 多张, None 纯文生图
            sequential: True → 生成连贯一组图
            max_images: sequential=True 时最多生成几张
            size: 图片尺寸 "2K" 等
            watermark: 是否加水印

        Returns:
            {"images": [{"url": "...", "index": 0}, ...]}
        """
        # 拼接 negative_prompt
        final_prompt = prompt
        if negative_prompt and negative_prompt.strip():
            final_prompt = f"{prompt}\n\n避免出现以下内容：{negative_prompt.strip()}"

        body: dict = {
            "model": self.settings.doubao_image_model_endpoint,
            "prompt": final_prompt,
            "response_format": "url",
            "size": size,
            "watermark": watermark,
        }

        # 参考图
        if image is not None:
            body["image"] = image

        # 单张 vs 多张
        if sequential:
            body["sequential_image_generation"] = "auto"
            body["sequential_image_generation_options"] = {"max_images": max_images}
            body["stream"] = True
        else:
            body["sequential_image_generation"] = "disabled"
            body["stream"] = False

        logger.info(
            f"[DoubaoImage] 请求: prompt={prompt[:60]}..., "
            f"images={'array' if isinstance(image, list) else ('single' if image else 'none')}, "
            f"sequential={sequential}, max_images={max_images}"
        )

        if body.get("stream"):
            return await self._request_stream(body)
        else:
            return await self._request_sync(body)

    async def _request_sync(self, body: dict) -> dict:
        """同步请求（单张生图）"""
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{ARK_BASE_URL}/images/generations",
                headers=self._headers,
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()

        images = []
        for i, item in enumerate(data.get("data", [])):
            url = item.get("url")
            if url:
                images.append({"url": url, "index": i})

        logger.info(f"[DoubaoImage] 同步返回 {len(images)} 张图片")
        return {"images": images}

    async def _request_stream(self, body: dict) -> dict:
        """SSE 流式请求（多张连贯图）"""
        import json

        images = []
        raw_lines: list[str] = []
        content_type = ""

        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream(
                "POST",
                f"{ARK_BASE_URL}/images/generations",
                headers=self._headers,
                json=body,
            ) as resp:
                content_type = resp.headers.get("content-type", "")
                logger.info(
                    f"[DoubaoImage] 流式响应 status={resp.status_code}, "
                    f"Content-Type: {content_type}"
                )

                # 检查 HTTP 错误（不直接 raise，先读 body 记录日志）
                if resp.status_code >= 400:
                    error_body = ""
                    async for line in resp.aiter_lines():
                        error_body += line
                    logger.error(
                        f"[DoubaoImage] API 返回 HTTP {resp.status_code}: "
                        f"{error_body[:500]}"
                    )
                    return {"images": []}

                # 如果返回的是普通 JSON（非 SSE），直接解析
                if "text/event-stream" not in content_type and "application/json" in content_type:
                    json_body = ""
                    async for line in resp.aiter_lines():
                        json_body += line
                    try:
                        data = json.loads(json_body)
                        # 检查是否有错误
                        if "error" in data:
                            logger.error(
                                f"[DoubaoImage] API 返回 JSON 错误: "
                                f"{data['error']}"
                            )
                            return {"images": []}
                        # 尝试从标准结构提取图片
                        for item in data.get("data", []):
                            url = item.get("url")
                            if url:
                                images.append({"url": url, "index": len(images)})
                        logger.info(
                            f"[DoubaoImage] JSON 响应（非 SSE）返回 {len(images)} 张图片"
                        )
                        return {"images": images}
                    except json.JSONDecodeError as e:
                        logger.error(
                            f"[DoubaoImage] JSON 解析失败: {e}, "
                            f"body={json_body[:500]}"
                        )
                        return {"images": []}

                # 正常 SSE 流式解析
                async for line in resp.aiter_lines():
                    stripped = line.strip()
                    if not stripped:
                        continue
                    raw_lines.append(stripped)

                    # SSE 格式: "data: {...}"
                    if stripped.startswith("data:"):
                        payload = stripped[len("data:"):].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                            # 检查 chunk 级别的错误
                            if "error" in chunk:
                                logger.warning(
                                    f"[DoubaoImage] SSE chunk 包含错误: "
                                    f"{chunk['error']}"
                                )
                                continue

                            # Seedream 4.0 SSE 格式：每个 chunk 直接含 url + image_index
                            # {"type":"image_generation.partial_succeeded","image_index":0,"url":"https://..."}
                            if chunk.get("url"):
                                idx = chunk.get("image_index", len(images))
                                images.append({"url": chunk["url"], "index": idx})
                                logger.debug(
                                    f"[DoubaoImage] SSE 收到图片 #{idx}: "
                                    f"type={chunk.get('type')}"
                                )
                            else:
                                # 兼容旧格式：{"data": [{"url": "..."}]}
                                for item in chunk.get("data", []):
                                    url = item.get("url")
                                    idx = item.get("index", len(images))
                                    if url:
                                        images.append({"url": url, "index": idx})
                        except json.JSONDecodeError as e:
                            logger.warning(
                                f"[DoubaoImage] SSE 解析失败: {e}, "
                                f"line={payload[:200]}"
                            )

        if not images and raw_lines:
            logger.error(
                f"[DoubaoImage] SSE 解析 0 张图。"
                f"Content-Type={content_type}, 共 {len(raw_lines)} 行, "
                f"前 5 行: {raw_lines[:5]}"
            )

        logger.info(f"[DoubaoImage] 流式返回 {len(images)} 张图片")
        return {"images": images}


# 单例
_instance: Optional[DoubaoImageService] = None


def get_doubao_image_service() -> DoubaoImageService:
    global _instance
    if _instance is None:
        _instance = DoubaoImageService()
    return _instance
