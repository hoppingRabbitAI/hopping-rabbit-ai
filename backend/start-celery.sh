#!/bin/bash

# ============================================
# Celery Worker 本地启动脚本
# ============================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}🐰 启动 Lepus Celery Worker${NC}"

# 切换到 backend 目录
cd "$(dirname "$0")"

# 加载 .env 文件
if [ -f "../.env" ]; then
    echo -e "${BLUE}📄 加载 .env 配置...${NC}"
    # 只读取有效的环境变量行（忽略注释和空行）
    while IFS='=' read -r key value; do
        # 跳过空行和注释
        [[ -z "$key" || "$key" =~ ^# ]] && continue
        # 去除值中的注释部分
        value=$(echo "$value" | sed 's/#.*//' | xargs)
        # 只导出非空值
        if [[ -n "$value" ]]; then
            export "$key=$value"
        fi
    done < "../.env"
fi

# 设置 Python 路径
export PYTHONPATH="$(pwd):$PYTHONPATH"

# 设置 Celery 配置（本地开发使用 localhost）
# 默认使用 Redis 作为 broker（简单可靠，不需要 RabbitMQ）
export CELERY_BROKER_URL="${CELERY_BROKER_URL:-redis://localhost:6379/0}"
export CELERY_RESULT_BACKEND="${CELERY_RESULT_BACKEND:-redis://localhost:6379/1}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"

# 检查 Redis 连接
echo -e "${BLUE}🔍 检查 Redis 连接...${NC}"
if python3 -c "import redis; r = redis.from_url('redis://localhost:6379/0'); print('ping:', r.ping())" 2>&1; then
    echo -e "${GREEN}   ✓ Redis 连接正常${NC}"
else
    echo -e "${RED}❌ Redis 连接失败，请确保 Redis 正在运行${NC}"
    echo -e "${YELLOW}   可以运行: docker run -d -p 6379:6379 redis:alpine${NC}"
    exit 1
fi

# 解析参数 — 所有任务统一使用 gpu 队列
QUEUES="gpu"
CONCURRENCY=2
LOGLEVEL="info"

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -Q|--queues) QUEUES="$2"; shift ;;
        -c|--concurrency) CONCURRENCY="$2"; shift ;;
        -l|--loglevel) LOGLEVEL="$2"; shift ;;
        --help)
            echo ""
            echo "Usage: ./start-celery.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -Q, --queues       队列名称 (默认: 所有队列)"
            echo "  -c, --concurrency  并发数 (默认: 2)"
            echo "  -l, --loglevel     日志级别 (默认: info)"
            echo ""
            echo "示例:"
            echo "  ./start-celery.sh                    # 默认配置"
            echo "  ./start-celery.sh -c 4 -l debug      # 4个并发，debug日志"
            echo "  ./start-celery.sh -Q cpu_low -c 1    # 只处理低优先级CPU任务"
            exit 0
            ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
    shift
done

echo ""
echo -e "${GREEN}📋 配置信息:${NC}"
echo -e "   Broker: ${CELERY_BROKER_URL}"
echo -e "   Backend: ${CELERY_RESULT_BACKEND}"
echo -e "   队列: ${QUEUES}"
echo -e "   并发: ${CONCURRENCY}"
echo ""

# 启动 Celery Worker
echo -e "${GREEN}🚀 启动 Worker...${NC}"
echo ""

celery -A app.celery_config worker \
    --loglevel=$LOGLEVEL \
    -Q $QUEUES \
    -c $CONCURRENCY \
    -n dev_worker@%h
