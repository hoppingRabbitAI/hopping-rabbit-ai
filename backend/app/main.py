"""
HoppingRabbit AI - FastAPI Application Entry
"""
import os
from pathlib import Path

# 加载环境变量（必须在其他导入之前）
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

import traceback
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse

logger = logging.getLogger(__name__)


# 过滤频繁轮询请求的日志，减少干扰
class EndpointFilter(logging.Filter):
    """过滤掉高频轮询请求的日志"""
    
    # 需要过滤的路径关键字
    FILTERED_PATHS = [
        "/workspace/sessions/",  # workspace session 轮询
        "/health",               # 健康检查
        "/.well-known/",         # Chrome DevTools 等浏览器自动请求
    ]
    
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for path in self.FILTERED_PATHS:
            if path in message:
                return False
        return True


class HttpxFilter(logging.Filter):
    """过滤掉高频 Supabase 轮询请求的 httpx 日志"""
    
    FILTERED_PATTERNS = [
        "workspace_sessions",  # workspace session 轮询
        "400 Bad Request",     # 缓存检查返回的 400（正常情况）
    ]
    
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for pattern in self.FILTERED_PATTERNS:
            if pattern in message:
                return False
        return True


# 应用过滤器到 uvicorn 访问日志
logging.getLogger("uvicorn.access").addFilter(EndpointFilter())
# 应用过滤器到 httpx 日志（Supabase 客户端）
logging.getLogger("httpx").addFilter(HttpxFilter())

from app.config import get_settings
from app.api import api_router

settings = get_settings()

app = FastAPI(
    title="HoppingRabbit AI",
    description="智能口播视频剪辑 API",
    version="0.1.0",
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局异常处理 - 确保所有错误都返回详细信息
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    error_detail = {
        "error": str(exc),
        "type": type(exc).__name__,
        "path": str(request.url.path),
        "method": request.method,
    }
    if settings.dev_mode:
        error_detail["traceback"] = traceback.format_exc()
    logger.error(f"{request.method} {request.url.path}: {exc}")
    logger.debug(traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": error_detail})

# 注册模块化路由
app.include_router(api_router, prefix="/api")

# ★ 缓存文件路由（带 CORS 支持，用于分镜缩略图等）
@app.options("/cache/{file_path:path}")
async def cache_options(file_path: str):
    """处理 CORS 预检请求"""
    from starlette.responses import Response
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )

@app.get("/cache/{file_path:path}")
async def serve_cache_file(file_path: str):
    """提供缓存文件访问，支持 CORS"""
    cache_dir = settings.cache_dir or "/tmp/hoppingrabbit_cache"
    full_path = os.path.join(cache_dir, file_path)
    
    if not os.path.exists(full_path):
        return JSONResponse(status_code=404, content={"detail": "File not found"})
    
    # 明确添加 CORS 头
    response = FileResponse(full_path)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    return response

# 开发模式：挂载静态文件目录（用于访问本地存储的视频）
if settings.dev_mode:
    static_dir = "/tmp/hoppingrabbit_storage"
    os.makedirs(static_dir, exist_ok=True)
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def root():
    return {
        "message": "HoppingRabbit AI API",
        "version": "0.1.0",
        "docs": "/docs",
        "dev_mode": settings.dev_mode,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
