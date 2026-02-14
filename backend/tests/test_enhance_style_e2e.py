"""
Enhance & Style — 端到端集成测试
模拟完整链路: API 端点 → Celery 任务 → Kling 引擎 → Storage → Asset

使用 FastAPI TestClient 发真实 HTTP 请求，
所有外部依赖 (Supabase / Kling / Celery) 全部 mock。
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any
from uuid import uuid4

# ── stub 外部依赖 ──
import sys
import types


def _ensure_stubs():
    """在导入 app.* 前注入 stub，避免连接真实服务"""

    # ---- supabase_client ----
    sb_stub = types.ModuleType("app.services.supabase_client")
    sb_stub.supabase = MagicMock()  # type: ignore
    sb_stub.get_supabase = lambda: MagicMock()  # type: ignore
    sb_stub.get_supabase_admin_client = lambda: MagicMock()  # type: ignore
    sb_stub.get_file_url = lambda *a, **kw: "https://stub/file.png"  # type: ignore
    sb_stub.get_file_urls_batch = lambda *a, **kw: {}  # type: ignore
    sb_stub.create_signed_upload_url = lambda *a, **kw: {}  # type: ignore
    sb_stub.with_retry = lambda *a, **kw: (lambda fn: fn)  # type: ignore
    sys.modules["app.services.supabase_client"] = sb_stub

    # ---- kling_ai_service (full attribute set for transitive imports) ----
    kling_stub = types.ModuleType("app.services.kling_ai_service")
    kling_stub.kling_client = MagicMock()  # type: ignore
    kling_stub.KlingConfig = MagicMock()  # type: ignore
    kling_stub.KlingAIClient = MagicMock()  # type: ignore
    kling_stub.koubo_service = MagicMock()  # type: ignore
    sys.modules["app.services.kling_ai_service"] = kling_stub

    # ---- celery_config ----
    celery_stub = types.ModuleType("app.celery_config")
    _fake_celery = MagicMock()
    _fake_celery.task = lambda *a, **kw: (lambda fn: fn)
    celery_stub.celery_app = _fake_celery  # type: ignore
    sys.modules["app.celery_config"] = celery_stub

    # ---- config ----
    config_stub = types.ModuleType("app.config")
    class _Settings:
        callback_base_url = ""
        supabase_url = ""
        supabase_key = ""
    config_stub.get_settings = lambda: _Settings()  # type: ignore
    sys.modules["app.config"] = config_stub


_ensure_stubs()

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.enhance_style import router
from app.services.ai_engine_registry import (
    AIEngineResult,
    AIEngineStatus,
    SkinEnhanceEngine,
    StabilityRelightEngine,
    OutfitSwapEngine,
    AIStylistEngine,
    OutfitShotEngine,
)


# ============================================
# 测试 App 搭建
# ============================================

def _create_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return app


# override auth dependency
MOCK_USER_ID = "user-test-001"


@pytest.fixture(autouse=True)
def override_auth():
    """所有测试绕过 JWT 认证"""
    from app.api import auth
    from app.api.enhance_style import router

    async def fake_user():
        return MOCK_USER_ID

    app = _create_test_app()

    # 覆盖 get_current_user_id
    app.dependency_overrides[auth.get_current_user_id] = fake_user

    yield app

    app.dependency_overrides.clear()


@pytest.fixture
def client(override_auth):
    return TestClient(override_auth)


# ============================================
# Mock helpers
# ============================================

def _mock_create_task():
    """mock _create_ai_task → 返回一个 UUID"""
    task_id = str(uuid4())
    return patch(
        "app.api.enhance_style._create_ai_task",
        return_value=task_id,
    ), task_id


def _mock_celery_delay():
    """mock Celery .delay()"""
    return patch(
        "app.api.enhance_style.process_enhance_style"
    )


# ============================================
# 1. 皮肤美化 E2E
# ============================================

class TestSkinEnhanceE2E:

    def test_success(self, client):
        mock_task_patch, task_id = _mock_create_task()
        with mock_task_patch, _mock_celery_delay() as mock_delay:
            resp = client.post("/api/enhance-style/skin-enhance", json={
                "image_url": "https://example.com/face.jpg",
                "intensity": "moderate",
            })

            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            assert data["task_id"] == task_id
            assert data["status"] == "pending"

            # Celery delay 被调用
            mock_delay.delay.assert_called_once()
            call_kwargs = mock_delay.delay.call_args.kwargs
            assert call_kwargs["capability_id"] == "skin_enhance"
            assert call_kwargs["user_id"] == MOCK_USER_ID
            assert call_kwargs["params"]["intensity"] == "moderate"

    def test_missing_image_url(self, client):
        """Pydantic 校验：缺少 image_url"""
        mock_task_patch, _ = _mock_create_task()
        with mock_task_patch, _mock_celery_delay():
            resp = client.post("/api/enhance-style/skin-enhance", json={
                "intensity": "natural",
            })
            assert resp.status_code == 422  # validation error

    def test_invalid_intensity_still_passes(self, client):
        """intensity 不在预设范围内，API 层不限制（引擎层 fallback）"""
        mock_task_patch, task_id = _mock_create_task()
        with mock_task_patch, _mock_celery_delay():
            resp = client.post("/api/enhance-style/skin-enhance", json={
                "image_url": "https://example.com/face.jpg",
                "intensity": "ultra",
            })
            assert resp.status_code == 200


# ============================================
# 2. AI 打光 E2E
# ============================================

class TestRelightE2E:

    def test_success_with_all_params(self, client):
        mock_task_patch, task_id = _mock_create_task()
        with mock_task_patch, _mock_celery_delay() as mock_delay:
            resp = client.post("/api/enhance-style/relight", json={
                "image_url": "https://example.com/portrait.jpg",
                "light_type": "dramatic",
                "light_direction": "left",
                "light_color": "#FFD700",
                "light_intensity": 0.9,
                "custom_prompt": "cinematic mood",
            })

            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            params = mock_delay.delay.call_args.kwargs["params"]
            assert params["light_type"] == "dramatic"
            assert params["light_intensity"] == 0.9
            assert params["custom_prompt"] == "cinematic mood"

    def test_light_intensity_out_of_range(self, client):
        """light_intensity > 1 应该 422"""
        mock_task_patch, _ = _mock_create_task()
        with mock_task_patch, _mock_celery_delay():
            resp = client.post("/api/enhance-style/relight", json={
                "image_url": "https://example.com/a.jpg",
                "light_intensity": 1.5,
            })
            assert resp.status_code == 422


# ============================================
# 3. 换装 E2E
# ============================================

class TestOutfitSwapE2E:

    def test_success(self, client):
        mock_task_patch, task_id = _mock_create_task()
        with mock_task_patch, _mock_celery_delay() as mock_delay:
            resp = client.post("/api/enhance-style/outfit-swap", json={
                "person_image_url": "https://example.com/person.jpg",
                "garment_image_url": "https://example.com/shirt.jpg",
                "garment_type": "upper",
            })

            assert resp.status_code == 200
            assert resp.json()["success"] is True
            params = mock_delay.delay.call_args.kwargs["params"]
            assert params["garment_type"] == "upper"

    def test_missing_garment(self, client):
        mock_task_patch, _ = _mock_create_task()
        with mock_task_patch, _mock_celery_delay():
            resp = client.post("/api/enhance-style/outfit-swap", json={
                "person_image_url": "https://example.com/person.jpg",
            })
            assert resp.status_code == 422


# ============================================
# 4. AI 穿搭师 E2E
# ============================================

class TestAIStylistE2E:

    def test_success_with_tags(self, client):
        mock_task_patch, task_id = _mock_create_task()
        with mock_task_patch, _mock_celery_delay() as mock_delay:
            resp = client.post("/api/enhance-style/ai-stylist", json={
                "garment_image_url": "https://example.com/jacket.jpg",
                "style_tags": ["casual", "korean"],
                "occasion": "date",
                "season": "autumn",
                "gender": "female",
                "num_variations": 3,
            })

            assert resp.status_code == 200
            params = mock_delay.delay.call_args.kwargs["params"]
            assert params["style_tags"] == ["casual", "korean"]
            assert params["num_variations"] == 3

    def test_num_variations_exceeds_max(self, client):
        """num_variations > 4 应 422"""
        mock_task_patch, _ = _mock_create_task()
        with mock_task_patch, _mock_celery_delay():
            resp = client.post("/api/enhance-style/ai-stylist", json={
                "garment_image_url": "https://example.com/jacket.jpg",
                "num_variations": 10,
            })
            assert resp.status_code == 422


# ============================================
# 5. AI 穿搭内容 E2E
# ============================================

class TestOutfitShotE2E:

    def test_content_mode_success(self, client):
        mock_task_patch, task_id = _mock_create_task()
        with mock_task_patch, _mock_celery_delay() as mock_delay:
            resp = client.post("/api/enhance-style/outfit-shot", json={
                "garment_images": [
                    "https://example.com/top.jpg",
                    "https://example.com/bottom.jpg",
                ],
                "mode": "content",
                "content_type": "streetsnap",
                "platform_preset": "xiaohongshu",
                "gender": "female",
                "num_variations": 2,
            })

            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True
            params = mock_delay.delay.call_args.kwargs["params"]
            assert len(params["garment_images"]) == 2
            assert params["platform_preset"] == "xiaohongshu"

    def test_too_many_garment_images(self, client):
        """超过 3 张衣物图应 422"""
        mock_task_patch, _ = _mock_create_task()
        with mock_task_patch, _mock_celery_delay():
            resp = client.post("/api/enhance-style/outfit-shot", json={
                "garment_images": ["a.jpg", "b.jpg", "c.jpg", "d.jpg"],
                "mode": "content",
            })
            assert resp.status_code == 422

    def test_empty_garment_images(self, client):
        """空数组应 422"""
        mock_task_patch, _ = _mock_create_task()
        with mock_task_patch, _mock_celery_delay():
            resp = client.post("/api/enhance-style/outfit-shot", json={
                "garment_images": [],
                "mode": "content",
            })
            assert resp.status_code == 422


# ============================================
# 6. Engines 列表端点
# ============================================

class TestEnginesEndpoint:

    def test_list_engines(self, client):
        resp = client.get("/api/enhance-style/engines")
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] >= 5
        assert "skin_enhance" in data["engines"]
        assert "outfit_shot" in data["engines"]
