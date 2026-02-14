#!/bin/bash

# ============================================
# Lepus AI - 开发环境启动脚本
# ============================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 启动 Lepus AI 开发环境${NC}"

# 检查 .env 文件
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  未找到 .env 文件，从示例创建...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}📝 请编辑 .env 文件填入实际配置${NC}"
fi

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker 未安装，请先安装 Docker${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose 未安装${NC}"
    exit 1
fi

# 解析参数
GPU_MODE=false
STORAGE_MODE=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --gpu) GPU_MODE=true ;;
        --storage) STORAGE_MODE=true ;;
        --help)
            echo "Usage: ./start-dev.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --gpu       启用 GPU 工作节点"
            echo "  --storage   启用本地 MinIO 存储"
            echo "  --help      显示帮助"
            exit 0
            ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# 构建 Docker 命令
COMPOSE_CMD="docker compose"
if ! docker compose version &> /dev/null; then
    COMPOSE_CMD="docker-compose"
fi

PROFILES=""
if [ "$GPU_MODE" = true ]; then
    PROFILES="$PROFILES --profile gpu"
    echo -e "${GREEN}🎮 GPU 模式已启用${NC}"
fi

if [ "$STORAGE_MODE" = true ]; then
    PROFILES="$PROFILES --profile storage"
    echo -e "${GREEN}📦 本地存储模式已启用${NC}"
fi

# 停止现有容器
echo -e "${YELLOW}🛑 停止现有容器...${NC}"
$COMPOSE_CMD down

# 构建镜像
echo -e "${YELLOW}🔨 构建镜像...${NC}"
$COMPOSE_CMD build

# 启动服务
echo -e "${GREEN}🚀 启动服务...${NC}"
$COMPOSE_CMD $PROFILES up -d

# 等待服务就绪
echo -e "${YELLOW}⏳ 等待服务就绪...${NC}"
sleep 5

# 检查服务状态
echo -e "\n${GREEN}📊 服务状态:${NC}"
$COMPOSE_CMD ps

echo -e "\n${GREEN}✅ 启动完成!${NC}"
echo -e ""
echo -e "📍 访问地址:"
echo -e "  - 前端:     http://localhost:3000"
echo -e "  - 后端 API: http://localhost:8000"
echo -e "  - API 文档: http://localhost:8000/docs"
echo -e "  - Flower:   http://localhost:5555"
echo -e "  - RabbitMQ: http://localhost:15672 (guest/guest)"
if [ "$STORAGE_MODE" = true ]; then
    echo -e "  - MinIO:    http://localhost:9001 (minioadmin/minioadmin)"
fi

echo -e "\n📝 查看日志: $COMPOSE_CMD logs -f"
echo -e "🛑 停止服务: $COMPOSE_CMD down"
