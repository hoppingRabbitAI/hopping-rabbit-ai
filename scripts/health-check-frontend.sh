#!/bin/bash

# 前端健康检查脚本
# 用于快速诊断和修复常见的页面加载问题

set -e

echo "🔍 Lepus 前端健康检查..."
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查项计数
CHECKS=0
PASSED=0
FAILED=0
WARNINGS=0

check_pass() {
    CHECKS=$((CHECKS + 1))
    PASSED=$((PASSED + 1))
    echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
    CHECKS=$((CHECKS + 1))
    FAILED=$((FAILED + 1))
    echo -e "${RED}✗${NC} $1"
}

check_warn() {
    CHECKS=$((CHECKS + 1))
    WARNINGS=$((WARNINGS + 1))
    echo -e "${YELLOW}⚠${NC} $1"
}

# 切换到前端目录
cd "$(dirname "$0")/../frontend"

# 1. 检查 Node.js 版本
echo "1️⃣  检查 Node.js 环境..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    check_pass "Node.js 已安装: $NODE_VERSION"
else
    check_fail "Node.js 未安装"
fi

# 2. 检查 pnpm
echo ""
echo "2️⃣  检查包管理器..."
if command -v pnpm &> /dev/null; then
    PNPM_VERSION=$(pnpm -v)
    check_pass "pnpm 已安装: $PNPM_VERSION"
else
    check_warn "pnpm 未安装，建议安装: npm install -g pnpm"
fi

# 3. 检查依赖
echo ""
echo "3️⃣  检查依赖安装..."
if [ -d "node_modules" ]; then
    check_pass "node_modules 存在"
    
    # 检查关键依赖
    if [ -d "node_modules/next" ]; then
        check_pass "Next.js 已安装"
    else
        check_fail "Next.js 未安装"
    fi
    
    if [ -d "node_modules/react" ]; then
        check_pass "React 已安装"
    else
        check_fail "React 未安装"
    fi
else
    check_fail "node_modules 不存在，需要运行: pnpm install"
fi

# 4. 检查关键文件
echo ""
echo "4️⃣  检查关键文件..."
critical_files=(
    "package.json"
    "next.config.mjs"
    "tsconfig.json"
    "tailwind.config.js"
    "src/app/layout.tsx"
    "src/app/page.tsx"
)

for file in "${critical_files[@]}"; do
    if [ -f "$file" ]; then
        check_pass "$file 存在"
    else
        check_fail "$file 缺失"
    fi
done

# 5. 检查静态资源
echo ""
echo "5️⃣  检查静态资源..."
if [ -f "public/rabbit-loading.gif" ]; then
    check_pass "rabbit-loading.gif 存在"
else
    check_warn "rabbit-loading.gif 缺失（可选）"
fi

# 6. 检查构建缓存
echo ""
echo "6️⃣  检查构建缓存..."
if [ -d ".next" ]; then
    NEXT_SIZE=$(du -sh .next 2>/dev/null | cut -f1)
    check_pass ".next 目录存在 ($NEXT_SIZE)"
    
    # 检查缓存年龄
    NEXT_AGE=$(find .next -type f -mtime +7 | wc -l | tr -d ' ')
    if [ "$NEXT_AGE" -gt "10" ]; then
        check_warn ".next 目录较旧，建议清理: rm -rf .next"
    fi
else
    check_warn ".next 目录不存在（首次运行正常）"
fi

# 7. 检查环境变量
echo ""
echo "7️⃣  检查环境配置..."
if [ -f ".env.local" ]; then
    check_pass ".env.local 存在"
else
    check_warn ".env.local 不存在（可能使用其他环境文件）"
fi

# 8. 尝试编译检查
echo ""
echo "8️⃣  运行类型检查..."
if pnpm tsc --noEmit &> /dev/null; then
    check_pass "TypeScript 类型检查通过"
else
    check_warn "TypeScript 类型检查有警告（通常不影响运行）"
fi

# 9. 检查端口占用
echo ""
echo "9️⃣  检查端口..."
if lsof -i :3000 &> /dev/null; then
    check_warn "端口 3000 被占用"
    echo "   占用进程:"
    lsof -i :3000 | tail -n +2 | awk '{print "   - PID " $2 ": " $1}'
else
    check_pass "端口 3000 可用"
fi

# 10. 检查磁盘空间
echo ""
echo "🔟 检查磁盘空间..."
DISK_USAGE=$(df -h . | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -lt 90 ]; then
    check_pass "磁盘空间充足 (已使用 ${DISK_USAGE}%)"
else
    check_warn "磁盘空间不足 (已使用 ${DISK_USAGE}%)"
fi

# 总结
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "检查完成: $CHECKS 项检查"
echo -e "${GREEN}通过: $PASSED${NC} | ${RED}失败: $FAILED${NC} | ${YELLOW}警告: $WARNINGS${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 提供修复建议
if [ $FAILED -gt 0 ]; then
    echo ""
    echo "🔧 修复建议:"
    echo ""
    
    if [ ! -d "node_modules" ]; then
        echo "1. 安装依赖:"
        echo "   pnpm install"
        echo ""
    fi
    
    if [ -d ".next" ]; then
        NEXT_AGE=$(find .next -type f -mtime +7 | wc -l | tr -d ' ')
        if [ "$NEXT_AGE" -gt "10" ]; then
            echo "2. 清理构建缓存:"
            echo "   rm -rf .next"
            echo ""
        fi
    fi
    
    echo "3. 尝试重新构建:"
    echo "   pnpm run build"
    echo ""
    
    echo "4. 清理并重装依赖:"
    echo "   rm -rf node_modules .next"
    echo "   pnpm install"
    echo ""
fi

if [ $WARNINGS -gt 0 ]; then
    echo ""
    echo "💡 优化建议:"
    echo ""
    
    if [ ! -f "public/rabbit-loading.gif" ]; then
        echo "- 添加加载动画: 将 rabbit-loading.gif 放到 public 目录"
    fi
    
    if [ ! -f ".env.local" ]; then
        echo "- 创建环境配置: cp .env.example .env.local (如果有模板)"
    fi
    
    echo ""
fi

# 快速修复选项
if [ $FAILED -gt 0 ] || [ $WARNINGS -gt 0 ]; then
    echo ""
    read -p "是否执行快速修复？(清理缓存并重装依赖) [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🔧 执行快速修复..."
        echo ""
        
        echo "1. 清理构建缓存..."
        rm -rf .next
        
        echo "2. 清理 node_modules..."
        rm -rf node_modules
        
        echo "3. 重新安装依赖..."
        pnpm install
        
        echo ""
        echo "✅ 快速修复完成！"
        echo ""
        echo "现在可以运行:"
        echo "  pnpm run dev    # 启动开发服务器"
        echo "  pnpm run build  # 构建生产版本"
    fi
fi

exit 0
