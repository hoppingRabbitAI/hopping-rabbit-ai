# B-roll 素材库功能

## 概述

B-roll 功能允许用户从 Pexels 视频库搜索和导入高质量的免费视频素材到时间轴。

## 功能特点

- 🔍 关键词搜索视频
- 🎬 预览视频缩略图、时长、分辨率
- 🖱️ 拖放添加到时间轴
- 📱 热门关键词快速搜索
- 🆓 完全免费，无需登录
- ⚡ 分页加载，支持无限滚动

## 环境配置

### 1. 获取 Pexels API Key

1. 访问 [Pexels API](https://www.pexels.com/api/)
2. 点击 "Get Started" 注册账号
3. 完成注册后，在 Dashboard 中复制你的 API Key

### 2. 配置后端

在 `backend/.env` 文件中添加：

```bash
PEXELS_API_KEY=your_pexels_api_key_here
```

### 3. 重启服务

```bash
docker-compose restart backend
# 或
cd backend && uvicorn app.main:app --reload
```

## 使用方法

### 前端使用

1. 点击左侧工具栏的 "B-roll" 按钮
2. 在搜索框输入关键词（如 "nature", "city", "business"）
3. 或点击热门标签快速搜索
4. 浏览视频结果，查看缩略图和信息
5. 将视频拖拽到时间轴上添加为素材

### API 端点

#### 搜索视频
```http
GET /api/broll/search?query=nature&page=1&per_page=20
```

参数：
- `query` (string, required): 搜索关键词
- `page` (int, optional): 页码，默认 1
- `per_page` (int, optional): 每页数量，默认 20，最大 80
- `orientation` (string, optional): 方向 - "landscape", "portrait", "square"
- `size` (string, optional): 尺寸 - "large", "medium", "small"

响应：
```json
{
  "page": 1,
  "per_page": 20,
  "total_results": 1500,
  "videos": [
    {
      "id": 123456,
      "width": 1920,
      "height": 1080,
      "duration": 15,
      "image": "https://...",
      "video_files": [...],
      "user": {
        "name": "Photographer Name",
        "url": "https://..."
      }
    }
  ]
}
```

#### 获取热门视频
```http
GET /api/broll/popular?page=1&per_page=20
```

## 技术架构

### 前端 (React)

- **组件**: `BRollPanel.tsx`
- **位置**: `frontend/src/features/editor/components/BRollPanel.tsx`
- **状态管理**: Zustand (editor-store)
- **拖拽协议**: 
  ```typescript
  {
    type: 'b-roll',
    video: {
      url: string,
      duration: number,
      width: number,
      height: number,
      thumbnail: string,
      source: string,
      author: string,
      pexelsUrl: string
    }
  }
  ```

### 后端 (FastAPI)

- **路由**: `backend/app/api/broll.py`
- **API 集成**: Pexels Video API v1
- **HTTP 客户端**: httpx (异步)
- **超时**: 10秒
- **认证**: Bearer Token (API Key)

## Pexels API 限制

- **免费版**:
  - 每小时 200 请求
  - 每月 20,000 请求
- **必须显示来源**: 前端组件已包含 Pexels 归属信息
- **商业使用**: ✅ 允许
- **修改**: ✅ 允许

## 待实现功能

- [ ] B-roll 视频下载到项目资源库
- [ ] 拖拽到时间轴自动创建 clip
- [ ] 视频下载进度提示
- [ ] 搜索历史记录
- [ ] 收藏功能
- [ ] 更多筛选选项（时长、色调等）
- [ ] 缓存热门视频

## 故障排除

### 搜索无结果
- 检查 PEXELS_API_KEY 是否正确配置
- 检查后端日志: `docker logs hoppingrabbit-ai-backend-1`
- 验证 Pexels API 配额未超限

### 视频无法拖拽
- 检查 Timeline 组件是否处理 'b-roll' 类型
- 查看浏览器控制台是否有错误

### API 请求失败
- 检查网络连接
- 验证 Pexels API 状态: https://status.pexels.com/
- 检查 API Key 是否有效

## 相关文件

```
frontend/src/features/editor/components/
├── BRollPanel.tsx           # B-roll 主面板
├── LibrarySidebar.tsx       # 工具栏按钮
└── Timeline.tsx             # 拖拽处理 (待实现)

backend/app/api/
├── broll.py                 # Pexels API 集成
└── __init__.py              # 路由注册

docs/
└── BROLL_FEATURE.md         # 本文档
```

## 更新日志

### v1.0.0 (2024-01-XX)
- ✅ 基础搜索功能
- ✅ Pexels API 集成
- ✅ 拖拽界面
- ✅ 热门关键词
- ⏳ Timeline 拖拽处理
- ⏳ 视频下载与存储
