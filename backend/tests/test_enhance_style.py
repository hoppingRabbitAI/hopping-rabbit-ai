"""
Enhance & Style Celery 任务 单元测试

覆盖:
- process_enhance_style: 正常流程 (execute → poll → download → upload → asset)
- 参数校验失败
- 引擎执行失败
- 轮询超时
- 下载失败 graceful degradation
- DB 更新函数
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock
from typing import Dict, Any

# ── stub 外部依赖 ──
import sys
import types
import importlib


import os
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_APP_ROOT = _BACKEND_ROOT / "app"


def _ensure_stubs():
    """
    在导入 app.* 前注入 stub，避免连接真实服务。
    只 stub “有副作用”的子模块，保留类似 ai_engine_registry 的真实模块。
    """

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

from app.services.ai_engine_registry import (
    AIEngineRegistry,
    AIEngineResult,
    AIEngineStatus,
    SkinEnhanceEngine,
)
from app.tasks.enhance_style import (
    _process_async,
    update_ai_task,
    create_asset,
)


# ============================================
# Helpers
# ============================================

def run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _completed_result(urls=None):
    return AIEngineResult(
        status=AIEngineStatus.COMPLETED,
        provider_task_id="kling-123",
        output_urls=urls or ["https://cdn.kling.ai/result.png"],
        output_type="image",
        credits_cost=3,
        metadata={"test": True},
    )


def _polling_result():
    return AIEngineResult(
        status=AIEngineStatus.POLLING,
        provider_task_id="kling-123",
        credits_cost=3,
    )


def _failed_result(msg="boom"):
    return AIEngineResult(
        status=AIEngineStatus.FAILED,
        error_message=msg,
    )


# ============================================
# update_ai_task / create_asset
# ============================================

class TestDBHelpers:

    @patch("app.tasks.enhance_style._get_supabase")
    def test_update_ai_task(self, mock_sb):
        mock_table = MagicMock()
        mock_sb.return_value.table.return_value = mock_table
        mock_table.update.return_value.eq.return_value.execute.return_value = None

        update_ai_task("task-1", status="completed", progress=100)

        mock_sb.return_value.table.assert_called_with("tasks")
        call_args = mock_table.update.call_args[0][0]
        assert call_args["status"] == "completed"
        assert call_args["progress"] == 100
        assert "updated_at" in call_args

    @patch("app.tasks.enhance_style._get_supabase")
    def test_create_asset_returns_id(self, mock_sb):
        mock_table = MagicMock()
        mock_sb.return_value.table.return_value = mock_table
        mock_result = MagicMock()
        mock_result.data = [{"id": "asset-abc"}]
        mock_table.insert.return_value.execute.return_value = mock_result

        aid = create_asset("user-1", {"name": "test"})
        assert aid == "asset-abc"

    @patch("app.tasks.enhance_style._get_supabase")
    def test_create_asset_returns_none_on_error(self, mock_sb):
        mock_sb.return_value.table.side_effect = Exception("db down")
        aid = create_asset("user-1", {"name": "test"})
        assert aid is None


# ============================================
# _process_async — 正常流程
# ============================================

class TestProcessAsync:

    @patch("app.tasks.enhance_style.create_asset", return_value="asset-1")
    @patch("app.tasks.enhance_style._get_supabase")
    @patch("app.tasks.enhance_style.update_ai_task")
    def test_full_flow_sync_engine(self, mock_update, mock_sb, mock_create_asset):
        """引擎直接返回 COMPLETED (无需轮询)"""

        with patch.object(
            SkinEnhanceEngine, "execute",
            new_callable=AsyncMock, return_value=_completed_result()
        ), patch.object(
            SkinEnhanceEngine, "validate_params", return_value=None
        ), patch("app.tasks.enhance_style.httpx") as mock_httpx:
            # mock download
            mock_response = MagicMock()
            mock_response.content = b"PNG_DATA"
            mock_response.raise_for_status = MagicMock()
            mock_client_ctx = AsyncMock()
            mock_client_ctx.__aenter__ = AsyncMock(return_value=mock_client_ctx)
            mock_client_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_client_ctx.get = AsyncMock(return_value=mock_response)
            mock_httpx.AsyncClient.return_value = mock_client_ctx

            # mock storage upload
            mock_storage = MagicMock()
            mock_storage.from_.return_value.upload.return_value = None
            mock_storage.from_.return_value.get_public_url.return_value = "https://storage/result.png"
            mock_sb.return_value.storage = mock_storage

            result = run(_process_async(
                task_id="task-1",
                user_id="user-1",
                capability_id="skin_enhance",
                params={"image_url": "https://x.com/a.jpg"},
            ))

            assert result["task_id"] == "task-1"
            assert result["capability_id"] == "skin_enhance"
            assert len(result["output_urls"]) == 1
            assert len(result["asset_ids"]) == 1

            # 验证 update_ai_task 被多次调用 (processing → progress → completed)
            assert mock_update.call_count >= 2

    @patch("app.tasks.enhance_style.update_ai_task")
    def test_validation_failure(self, mock_update):
        """参数校验失败应抛 ValueError"""
        with pytest.raises(ValueError, match="图片"):
            run(_process_async(
                task_id="task-2",
                user_id="user-1",
                capability_id="skin_enhance",
                params={},  # 缺 image_url
            ))

    @patch("app.tasks.enhance_style.update_ai_task")
    def test_engine_execute_failure(self, mock_update):
        """引擎 execute 返回 FAILED"""
        with patch.object(
            SkinEnhanceEngine, "execute",
            new_callable=AsyncMock, return_value=_failed_result("API quota exceeded")
        ), patch.object(
            SkinEnhanceEngine, "validate_params", return_value=None
        ):
            with pytest.raises(RuntimeError, match="引擎执行失败"):
                run(_process_async(
                    task_id="task-3",
                    user_id="user-1",
                    capability_id="skin_enhance",
                    params={"image_url": "https://x.com/a.jpg"},
                ))

    @patch("app.tasks.enhance_style.update_ai_task")
    def test_polling_timeout(self, mock_update):
        """轮询超时"""
        with patch.object(
            SkinEnhanceEngine, "execute",
            new_callable=AsyncMock, return_value=_polling_result()
        ), patch.object(
            SkinEnhanceEngine, "validate_params", return_value=None
        ), patch.object(
            SkinEnhanceEngine, "poll_status",
            new_callable=AsyncMock, return_value=AIEngineResult(
                status=AIEngineStatus.POLLING, provider_task_id="kling-123"
            )
        ):
            # 设置极短超时
            original_timeout = SkinEnhanceEngine.default_timeout
            original_interval = SkinEnhanceEngine.poll_interval
            SkinEnhanceEngine.default_timeout = 1
            SkinEnhanceEngine.poll_interval = 1

            try:
                with pytest.raises(TimeoutError):
                    run(_process_async(
                        task_id="task-4",
                        user_id="user-1",
                        capability_id="skin_enhance",
                        params={"image_url": "https://x.com/a.jpg"},
                    ))
            finally:
                SkinEnhanceEngine.default_timeout = original_timeout
                SkinEnhanceEngine.poll_interval = original_interval

    @patch("app.tasks.enhance_style.update_ai_task")
    def test_empty_output_urls(self, mock_update):
        """引擎完成但返回空 URL"""
        with patch.object(
            SkinEnhanceEngine, "execute",
            new_callable=AsyncMock,
            return_value=AIEngineResult(
                status=AIEngineStatus.COMPLETED,
                output_urls=[],
            )
        ), patch.object(
            SkinEnhanceEngine, "validate_params", return_value=None
        ):
            with pytest.raises(ValueError, match="空结果"):
                run(_process_async(
                    task_id="task-5",
                    user_id="user-1",
                    capability_id="skin_enhance",
                    params={"image_url": "https://x.com/a.jpg"},
                ))

    @patch("app.tasks.enhance_style.update_ai_task")
    def test_unknown_capability_raises(self, mock_update):
        """未知 capability_id"""
        with pytest.raises(ValueError, match="未注册"):
            run(_process_async(
                task_id="task-6",
                user_id="user-1",
                capability_id="magic_wand",
                params={},
            ))


# ============================================
# _process_async — 轮询成功
# ============================================

class TestPollingFlow:

    @patch("app.tasks.enhance_style.create_asset", return_value="asset-2")
    @patch("app.tasks.enhance_style._get_supabase")
    @patch("app.tasks.enhance_style.update_ai_task")
    def test_poll_then_succeed(self, mock_update, mock_sb, mock_create_asset):
        """execute → POLLING → poll 2 次 → COMPLETED"""

        poll_count = {"n": 0}

        async def mock_poll(provider_task_id):
            poll_count["n"] += 1
            if poll_count["n"] >= 2:
                return _completed_result()
            return AIEngineResult(
                status=AIEngineStatus.POLLING,
                provider_task_id=provider_task_id,
            )

        with patch.object(
            SkinEnhanceEngine, "execute",
            new_callable=AsyncMock, return_value=_polling_result()
        ), patch.object(
            SkinEnhanceEngine, "validate_params", return_value=None
        ), patch.object(
            SkinEnhanceEngine, "poll_status", side_effect=mock_poll
        ), patch("app.tasks.enhance_style.httpx") as mock_httpx, patch(
            "asyncio.sleep", new_callable=AsyncMock
        ):
            # mock download
            mock_response = MagicMock()
            mock_response.content = b"PNG_DATA"
            mock_response.raise_for_status = MagicMock()
            mock_client_ctx = AsyncMock()
            mock_client_ctx.__aenter__ = AsyncMock(return_value=mock_client_ctx)
            mock_client_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_client_ctx.get = AsyncMock(return_value=mock_response)
            mock_httpx.AsyncClient.return_value = mock_client_ctx

            # mock storage
            mock_storage = MagicMock()
            mock_storage.from_.return_value.upload.return_value = None
            mock_storage.from_.return_value.get_public_url.return_value = "https://s/result.png"
            mock_sb.return_value.storage = mock_storage

            result = run(_process_async(
                task_id="task-7",
                user_id="user-1",
                capability_id="skin_enhance",
                params={"image_url": "https://x.com/a.jpg"},
            ))

            assert result["task_id"] == "task-7"
            assert poll_count["n"] == 2
