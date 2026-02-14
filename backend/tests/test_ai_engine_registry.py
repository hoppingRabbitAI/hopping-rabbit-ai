"""
AI Engine Registry & 五大引擎 单元测试

覆盖:
- AIEngineRegistry: CRUD、单例、异常
- 每个引擎: validate_params / execute / prompt 格式 / image_list 格式 / options 格式
- KlingBaseEngine: poll_status 三种状态
- credits: 预估逻辑
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any

# ── 需要 stub Kling client 依赖 ──
import sys
import types

# stub kling_ai_service
kling_stub = types.ModuleType("app.services.kling_ai_service")
_mock_kling_client = MagicMock()
kling_stub.kling_client = _mock_kling_client
sys.modules.setdefault("app.services.kling_ai_service", kling_stub)

# stub supabase_client
supabase_stub = types.ModuleType("app.services.supabase_client")
supabase_stub.supabase = MagicMock()
sys.modules.setdefault("app.services.supabase_client", supabase_stub)

from app.services.ai_engine_registry import (
    AIEngineRegistry,
    AIEngineResult,
    AIEngineStatus,
    BaseAIEngine,
    KlingBaseEngine,
    SkinEnhanceEngine,
    StabilityRelightEngine,
    OutfitSwapEngine,
    AIStylistEngine,
    OutfitShotEngine,
)


# ============================================
# Helpers
# ============================================

def run(coro):
    """运行 async 函数的简便 wrapper"""
    return asyncio.get_event_loop().run_until_complete(coro)


def make_kling_response(task_id: str = "kling-task-123") -> Dict:
    """构造标准 Kling create response"""
    return {"data": {"task_id": task_id}}


def make_kling_poll_succeed(urls=None) -> Dict:
    if urls is None:
        urls = ["https://cdn.kling.ai/result.png"]
    return {
        "data": {
            "task_status": "succeed",
            "task_result": {
                "images": [{"url": u} for u in urls],
                "videos": [],
            },
        }
    }


def make_kling_poll_failed(msg="boom") -> Dict:
    return {
        "data": {
            "task_status": "failed",
            "task_status_msg": msg,
        }
    }


def make_kling_poll_processing() -> Dict:
    return {"data": {"task_status": "processing"}}


# ============================================
# 1. AIEngineRegistry
# ============================================

class TestAIEngineRegistry:
    """注册表基本功能"""

    def test_get_all_five_engines(self):
        for cap_id in ["skin_enhance", "relight", "outfit_swap", "ai_stylist", "outfit_shot"]:
            engine = AIEngineRegistry.get_engine(cap_id)
            assert engine is not None
            assert engine.capability_id == cap_id

    def test_get_unknown_raises(self):
        with pytest.raises(ValueError, match="未注册"):
            AIEngineRegistry.get_engine("nonexistent_capability")

    def test_singleton_instance(self):
        a = AIEngineRegistry.get_engine("skin_enhance")
        b = AIEngineRegistry.get_engine("skin_enhance")
        assert a is b

    def test_list_engines(self):
        engines = AIEngineRegistry.list_engines()
        assert len(engines) >= 5
        assert "skin_enhance" in engines
        assert engines["skin_enhance"] == "SkinEnhanceEngine"

    def test_has_engine(self):
        assert AIEngineRegistry.has_engine("relight") is True
        assert AIEngineRegistry.has_engine("magic_wand") is False

    def test_register_and_replace(self):
        """动态注册新引擎 / 替换旧引擎"""

        class DummyEngine(BaseAIEngine):
            engine_name = "dummy"
            capability_id = "dummy_test"
            provider = "test"

            async def execute(self, params):
                return AIEngineResult(status=AIEngineStatus.COMPLETED)

        AIEngineRegistry.register("dummy_test", DummyEngine)
        assert AIEngineRegistry.has_engine("dummy_test")
        engine = AIEngineRegistry.get_engine("dummy_test")
        assert isinstance(engine, DummyEngine)

        # 清理
        AIEngineRegistry._engines.pop("dummy_test", None)
        AIEngineRegistry._instances.pop("dummy_test", None)


# ============================================
# 2. SkinEnhanceEngine
# ============================================

class TestSkinEnhanceEngine:

    def setup_method(self):
        self.engine = SkinEnhanceEngine()

    def test_validate_missing_image(self):
        err = self.engine.validate_params({})
        assert err is not None
        assert "图片" in err

    def test_validate_ok(self):
        err = self.engine.validate_params({"image_url": "https://example.com/face.jpg"})
        assert err is None

    def test_credits(self):
        assert self.engine.default_credits == 3

    @patch.object(SkinEnhanceEngine, "_get_kling_client")
    def test_execute_prompt_format(self, mock_get):
        """确保 prompt 含 <<<image_1>>> 且 image_list 无 var"""
        mock_client = MagicMock()
        mock_client.create_omni_image_task = AsyncMock(return_value=make_kling_response())
        mock_get.return_value = mock_client

        result = run(self.engine.execute({
            "image_url": "https://example.com/face.jpg",
            "intensity": "moderate",
        }))

        call_kwargs = mock_client.create_omni_image_task.call_args
        prompt = call_kwargs.kwargs.get("prompt", call_kwargs[1].get("prompt", ""))
        image_list = call_kwargs.kwargs.get("image_list", call_kwargs[1].get("image_list", []))
        options = call_kwargs.kwargs.get("options", call_kwargs[1].get("options", {}))

        assert "<<<image_1>>>" in prompt
        assert "<<<image_a>>>" not in prompt
        assert len(image_list) == 1
        assert "var" not in image_list[0]
        assert "model_name" in options
        assert result.status == AIEngineStatus.POLLING
        assert result.provider_task_id == "kling-task-123"

    @patch.object(SkinEnhanceEngine, "_get_kling_client")
    def test_execute_with_custom_prompt(self, mock_get):
        mock_client = MagicMock()
        mock_client.create_omni_image_task = AsyncMock(return_value=make_kling_response())
        mock_get.return_value = mock_client

        run(self.engine.execute({
            "image_url": "https://example.com/face.jpg",
            "custom_prompt": "porcelain skin",
        }))

        call_kwargs = mock_client.create_omni_image_task.call_args
        prompt = call_kwargs.kwargs.get("prompt", call_kwargs[1].get("prompt", ""))
        assert "porcelain skin" in prompt

    @patch.object(SkinEnhanceEngine, "_get_kling_client")
    def test_execute_kling_error(self, mock_get):
        mock_client = MagicMock()
        mock_client.create_omni_image_task = AsyncMock(return_value={"data": {}})
        mock_get.return_value = mock_client

        result = run(self.engine.execute({"image_url": "https://x.com/a.jpg"}))
        assert result.status == AIEngineStatus.FAILED

    @patch.object(SkinEnhanceEngine, "_get_kling_client")
    def test_execute_exception(self, mock_get):
        mock_client = MagicMock()
        mock_client.create_omni_image_task = AsyncMock(side_effect=RuntimeError("network"))
        mock_get.return_value = mock_client

        result = run(self.engine.execute({"image_url": "https://x.com/a.jpg"}))
        assert result.status == AIEngineStatus.FAILED
        assert "network" in result.error_message


# ============================================
# 3. StabilityRelightEngine (Stability AI)
# ============================================

class TestStabilityRelightEngine:

    def setup_method(self):
        self.engine = StabilityRelightEngine()

    def test_validate_missing_image(self):
        assert self.engine.validate_params({}) is not None

    def test_validate_ok(self):
        assert self.engine.validate_params({"image_url": "https://x.com/a.jpg"}) is None

    def test_provider(self):
        assert self.engine.provider == "stability_ai"

    def test_credits(self):
        assert self.engine.default_credits == 8

    @patch.object(StabilityRelightEngine, "_get_api_key", return_value="sk-test-key")
    @patch.object(StabilityRelightEngine, "_get_api_base", return_value="https://api.stability.ai")
    @patch("app.services.ai_engine_registry.httpx.AsyncClient")
    def test_execute_submit_success(self, mock_httpx_cls, mock_base, mock_key):
        """测试提交 Stability API → 返回 POLLING + generation_id"""
        # ── mock image download ──
        mock_img_response = MagicMock()
        mock_img_response.status_code = 200
        mock_img_response.content = b"fake-image-bytes"
        mock_img_response.raise_for_status = MagicMock()

        # ── mock Stability API POST ──
        mock_api_response = MagicMock()
        mock_api_response.status_code = 200
        mock_api_response.json.return_value = {"id": "gen-abc-123"}
        mock_api_response.raise_for_status = MagicMock()

        # 两个 AsyncClient context manager 调用（下载图片 + 提交API）
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_img_response)
        mock_client.post = AsyncMock(return_value=mock_api_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_httpx_cls.return_value = mock_client

        result = run(self.engine.execute({
            "image_url": "https://x.com/photo.jpg",
            "light_type": "dramatic",
            "light_direction": "left",
            "light_intensity": 0.8,
            "keep_original_background": True,
        }))

        assert result.status == AIEngineStatus.POLLING
        assert result.provider_task_id == "gen-abc-123"
        assert result.credits_cost == 8
        assert result.metadata["light_source_direction"] == "left"
        assert result.metadata["provider"] == "stability_ai"

        # 验证 POST 调用参数
        post_call = mock_client.post.call_args
        assert "/replace-background-and-relight" in post_call.args[0] or "/replace-background-and-relight" in str(post_call)
        post_data = post_call.kwargs.get("data", {})
        assert post_data["light_source_direction"] == "left"
        assert post_data["keep_original_background"] == "true"

    @patch.object(StabilityRelightEngine, "_get_api_key", return_value="sk-test-key")
    @patch.object(StabilityRelightEngine, "_get_api_base", return_value="https://api.stability.ai")
    @patch("app.services.ai_engine_registry.httpx.AsyncClient")
    def test_execute_api_error(self, mock_httpx_cls, mock_base, mock_key):
        """测试 Stability API 返回无 id → FAILED"""
        mock_img_response = MagicMock()
        mock_img_response.content = b"img"
        mock_img_response.raise_for_status = MagicMock()

        mock_api_response = MagicMock()
        mock_api_response.json.return_value = {"error": "bad request"}
        mock_api_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_img_response)
        mock_client.post = AsyncMock(return_value=mock_api_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_httpx_cls.return_value = mock_client

        result = run(self.engine.execute({
            "image_url": "https://x.com/photo.jpg",
        }))
        assert result.status == AIEngineStatus.FAILED

    @patch.object(StabilityRelightEngine, "_get_api_key", return_value="sk-test-key")
    @patch.object(StabilityRelightEngine, "_get_api_base", return_value="https://api.stability.ai")
    @patch("app.services.ai_engine_registry.httpx.AsyncClient")
    def test_execute_network_exception(self, mock_httpx_cls, mock_base, mock_key):
        """测试网络异常 → FAILED"""
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=ConnectionError("timeout"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_httpx_cls.return_value = mock_client

        result = run(self.engine.execute({
            "image_url": "https://x.com/photo.jpg",
        }))
        assert result.status == AIEngineStatus.FAILED
        assert "timeout" in result.error_message

    @patch.object(StabilityRelightEngine, "_get_api_key", return_value="sk-test-key")
    @patch.object(StabilityRelightEngine, "_get_api_base", return_value="https://api.stability.ai")
    @patch("app.services.ai_engine_registry.httpx.AsyncClient")
    def test_poll_completed(self, mock_httpx_cls, mock_base, mock_key):
        """测试轮询成功 → COMPLETED + base64 图片"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "finish_reason": "SUCCESS",
            "image": "iVBORw0KGgo...",
            "seed": 42,
        }

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_httpx_cls.return_value = mock_client

        result = run(self.engine.poll_status("gen-abc-123"))
        assert result.status == AIEngineStatus.COMPLETED
        assert len(result.output_urls) == 1
        assert result.output_urls[0].startswith("data:image/png;base64,")
        assert result.metadata["seed"] == 42

    @patch.object(StabilityRelightEngine, "_get_api_key", return_value="sk-test-key")
    @patch.object(StabilityRelightEngine, "_get_api_base", return_value="https://api.stability.ai")
    @patch("app.services.ai_engine_registry.httpx.AsyncClient")
    def test_poll_processing(self, mock_httpx_cls, mock_base, mock_key):
        """测试轮询仍在处理 → POLLING"""
        mock_response = MagicMock()
        mock_response.status_code = 202

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_httpx_cls.return_value = mock_client

        result = run(self.engine.poll_status("gen-abc-123"))
        assert result.status == AIEngineStatus.POLLING

    @patch.object(StabilityRelightEngine, "_get_api_key", return_value="sk-test-key")
    @patch.object(StabilityRelightEngine, "_get_api_base", return_value="https://api.stability.ai")
    @patch("app.services.ai_engine_registry.httpx.AsyncClient")
    def test_poll_failed(self, mock_httpx_cls, mock_base, mock_key):
        """测试轮询失败 → FAILED"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"finish_reason": "CONTENT_FILTERED"}

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_httpx_cls.return_value = mock_client

        result = run(self.engine.poll_status("gen-abc-123"))
        assert result.status == AIEngineStatus.FAILED
        assert "CONTENT_FILTERED" in result.error_message

    @patch.object(StabilityRelightEngine, "_get_api_key", return_value="sk-test-key")
    @patch.object(StabilityRelightEngine, "_get_api_base", return_value="https://api.stability.ai")
    @patch("app.services.ai_engine_registry.httpx.AsyncClient")
    def test_poll_exception(self, mock_httpx_cls, mock_base, mock_key):
        """测试轮询网络异常 → FAILED"""
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=ConnectionError("timeout"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_httpx_cls.return_value = mock_client

        result = run(self.engine.poll_status("gen-abc-123"))
        assert result.status == AIEngineStatus.FAILED
        assert "timeout" in result.error_message

    def test_direction_mapping(self):
        """测试前端方向 → Stability API 方向映射"""
        assert self.engine._DIRECTION_MAP["left"] == "left"
        assert self.engine._DIRECTION_MAP["right"] == "right"
        assert self.engine._DIRECTION_MAP["top"] == "above"
        assert self.engine._DIRECTION_MAP["bottom"] == "below"
        assert self.engine._DIRECTION_MAP["front"] == "above"


# ============================================
# 4. OutfitSwapEngine
# ============================================

class TestOutfitSwapEngine:

    def setup_method(self):
        self.engine = OutfitSwapEngine()

    def test_validate_missing_person(self):
        err = self.engine.validate_params({"garment_image_url": "g.jpg"})
        assert err and "人物" in err

    def test_validate_missing_garment(self):
        err = self.engine.validate_params({"person_image_url": "p.jpg"})
        assert err and "衣物" in err

    def test_validate_ok(self):
        err = self.engine.validate_params({
            "person_image_url": "p.jpg",
            "garment_image_url": "g.jpg",
        })
        assert err is None

    @patch.object(OutfitSwapEngine, "_get_kling_client")
    def test_execute_two_images(self, mock_get):
        mock_client = MagicMock()
        mock_client.create_omni_image_task = AsyncMock(return_value=make_kling_response())
        mock_get.return_value = mock_client

        result = run(self.engine.execute({
            "person_image_url": "https://x.com/person.jpg",
            "garment_image_url": "https://x.com/shirt.jpg",
            "garment_type": "full",
        }))

        call_kwargs = mock_client.create_omni_image_task.call_args
        prompt = call_kwargs.kwargs.get("prompt", call_kwargs[1].get("prompt", ""))
        image_list = call_kwargs.kwargs.get("image_list", call_kwargs[1].get("image_list", []))

        assert "<<<image_1>>>" in prompt
        assert "<<<image_2>>>" in prompt
        assert len(image_list) == 2
        assert all("var" not in img for img in image_list)
        assert result.status == AIEngineStatus.POLLING


# ============================================
# 5. AIStylistEngine
# ============================================

class TestAIStylistEngine:

    def setup_method(self):
        self.engine = AIStylistEngine()

    def test_validate_missing_garment(self):
        err = self.engine.validate_params({})
        assert err is not None and "衣物" in err

    @patch.object(AIStylistEngine, "_get_kling_client")
    def test_execute_with_tags(self, mock_get):
        mock_client = MagicMock()
        mock_client.create_omni_image_task = AsyncMock(return_value=make_kling_response())
        mock_get.return_value = mock_client

        result = run(self.engine.execute({
            "garment_image_url": "https://x.com/jacket.jpg",
            "style_tags": ["casual", "korean"],
            "occasion": "date",
            "season": "autumn",
            "gender": "female",
            "num_variations": 2,
        }))

        call_kwargs = mock_client.create_omni_image_task.call_args
        prompt = call_kwargs.kwargs.get("prompt", call_kwargs[1].get("prompt", ""))
        options = call_kwargs.kwargs.get("options", call_kwargs[1].get("options", {}))

        assert "<<<image_1>>>" in prompt
        assert "casual" in prompt
        assert "korean" in prompt
        assert "date" in prompt.lower() or "elegant" in prompt.lower()
        assert options.get("n") == 2
        assert result.status == AIEngineStatus.POLLING


# ============================================
# 6. OutfitShotEngine
# ============================================

class TestOutfitShotEngine:

    def setup_method(self):
        self.engine = OutfitShotEngine()

    def test_validate_missing_images(self):
        err = self.engine.validate_params({})
        assert err is not None

    def test_validate_tryon_needs_avatar(self):
        err = self.engine.validate_params({
            "garment_images": ["g.jpg"],
            "mode": "try_on",
        })
        assert err is not None and "数字人" in err

    def test_validate_content_ok(self):
        err = self.engine.validate_params({
            "garment_images": ["g.jpg"],
            "mode": "content",
        })
        assert err is None

    def test_estimate_credits_content(self):
        assert self.engine.estimate_credits({"mode": "content", "num_variations": 1}) == 8
        assert self.engine.estimate_credits({"mode": "content", "num_variations": 3}) == 24
        assert self.engine.estimate_credits({"mode": "content", "num_variations": 4}) == 24  # 批量折扣

    def test_estimate_credits_tryon(self):
        assert self.engine.estimate_credits({"mode": "try_on"}) == 5

    @patch.object(OutfitShotEngine, "_get_kling_client")
    def test_execute_multi_image(self, mock_get):
        mock_client = MagicMock()
        mock_client.create_omni_image_task = AsyncMock(return_value=make_kling_response())
        mock_get.return_value = mock_client

        result = run(self.engine.execute({
            "garment_images": [
                "https://x.com/top.jpg",
                "https://x.com/bottom.jpg",
                "https://x.com/shoes.jpg",
            ],
            "mode": "content",
            "content_type": "streetsnap",
            "platform_preset": "douyin",
            "gender": "male",
            "num_variations": 2,
        }))

        call_kwargs = mock_client.create_omni_image_task.call_args
        prompt = call_kwargs.kwargs.get("prompt", call_kwargs[1].get("prompt", ""))
        image_list = call_kwargs.kwargs.get("image_list", call_kwargs[1].get("image_list", []))
        options = call_kwargs.kwargs.get("options", call_kwargs[1].get("options", {}))

        assert "<<<image_1>>>" in prompt
        assert "<<<image_2>>>" in prompt
        assert "<<<image_3>>>" in prompt
        assert len(image_list) == 3
        assert all("var" not in img for img in image_list)
        assert options.get("aspect_ratio") == "9:16"  # douyin
        assert options.get("n") == 2
        assert result.status == AIEngineStatus.POLLING
        assert result.metadata["platform_preset"] == "douyin"

    @patch.object(OutfitShotEngine, "_get_kling_client")
    def test_execute_platform_ratios(self, mock_get):
        """各平台预设 → 正确的 aspect_ratio"""
        mock_client = MagicMock()
        mock_client.create_omni_image_task = AsyncMock(return_value=make_kling_response())
        mock_get.return_value = mock_client

        expected = {
            "xiaohongshu": "3:4",
            "douyin": "9:16",
            "instagram": "1:1",
            "custom": "1:1",
        }

        for platform, ratio in expected.items():
            run(self.engine.execute({
                "garment_images": ["https://x.com/g.jpg"],
                "platform_preset": platform,
            }))
            call_kwargs = mock_client.create_omni_image_task.call_args
            options = call_kwargs.kwargs.get("options", call_kwargs[1].get("options", {}))
            assert options.get("aspect_ratio") == ratio, f"{platform} → {ratio}"


# ============================================
# 7. KlingBaseEngine — poll_status
# ============================================

class TestKlingPolling:

    def setup_method(self):
        self.engine = SkinEnhanceEngine()

    @patch.object(KlingBaseEngine, "_get_kling_client")
    def test_poll_succeed(self, mock_get):
        mock_client = MagicMock()
        mock_client.get_omni_image_task = AsyncMock(
            return_value=make_kling_poll_succeed(["https://cdn/result1.png", "https://cdn/result2.png"])
        )
        mock_get.return_value = mock_client

        result = run(self.engine.poll_status("task-abc"))
        assert result.status == AIEngineStatus.COMPLETED
        assert len(result.output_urls) == 2

    @patch.object(KlingBaseEngine, "_get_kling_client")
    def test_poll_failed(self, mock_get):
        mock_client = MagicMock()
        mock_client.get_omni_image_task = AsyncMock(
            return_value=make_kling_poll_failed("content policy")
        )
        mock_get.return_value = mock_client

        result = run(self.engine.poll_status("task-abc"))
        assert result.status == AIEngineStatus.FAILED
        assert "content policy" in result.error_message

    @patch.object(KlingBaseEngine, "_get_kling_client")
    def test_poll_processing(self, mock_get):
        mock_client = MagicMock()
        mock_client.get_omni_image_task = AsyncMock(return_value=make_kling_poll_processing())
        mock_get.return_value = mock_client

        result = run(self.engine.poll_status("task-abc"))
        assert result.status == AIEngineStatus.POLLING

    @patch.object(KlingBaseEngine, "_get_kling_client")
    def test_poll_exception(self, mock_get):
        mock_client = MagicMock()
        mock_client.get_omni_image_task = AsyncMock(side_effect=ConnectionError("timeout"))
        mock_get.return_value = mock_client

        result = run(self.engine.poll_status("task-abc"))
        assert result.status == AIEngineStatus.FAILED
        assert "timeout" in result.error_message
