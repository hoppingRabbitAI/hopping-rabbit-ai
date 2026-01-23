FROM python:3.11-slim

WORKDIR /app

# ============================================
# 系统依赖安装
# ============================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    # FFmpeg 及相关
    ffmpeg \
    libsndfile1 \
    # 网络工具
    curl \
    wget \
    # 构建工具（某些 Python 包需要）
    build-essential \
    # Git（用于安装 GitHub 上的包）
    git \
    && rm -rf /var/lib/apt/lists/*

# ============================================
# Python 依赖安装
# ============================================
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ============================================
# 应用代码
# ============================================
COPY . .

# ============================================
# 目录初始化
# ============================================
RUN mkdir -p /app/cache /tmp/hoppingrabbit_cache /tmp/hoppingrabbit_storage

# ============================================
# 环境变量
# ============================================
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app

# ============================================
# 健康检查
# ============================================
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

# 默认命令（可被 docker-compose 覆盖）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
