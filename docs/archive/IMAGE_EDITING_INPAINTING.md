# 图像编辑/Inpainting 功能开发文档

## 功能概述

实现基于 Kling AI omni-image API 的图像编辑功能，支持：
- **局部替换 (Inpainting)**：用户绘制 mask → 替换指定区域
- **风格迁移**：无 mask 时进行整体风格变换
- **两步工作流**：先生成预览 → 用户确认后应用

## 架构设计

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   前端 UI       │     │   Backend API    │     │   Kling AI      │
│                 │     │                  │     │                 │
│ DrawingCanvas   │────▶│ /preview         │────▶│ omni-image API  │
│ (mask 绘制)     │     │                  │     │                 │
│                 │     │ /tasks/{id}/apply│     │                 │
│ PreviewDialog   │◀────│                  │◀────│                 │
│ (确认应用)      │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## 新增/修改的文件

### 1. backend/app/utils/image_utils.py (新增)

图片处理工具模块，提供：

- `parse_data_url()` - 解析 Base64 Data URL
- `data_url_to_pil_image()` - Data URL → PIL Image
- `pil_image_to_base64()` - PIL Image → Base64
- `process_drawing_mask()` - 处理前端绘制的半透明 mask
- `prepare_kling_image_input()` - 准备 Kling API 的图片输入
- `prepare_mask_for_inpainting()` - 准备 inpainting 用的 mask

### 2. backend/app/services/ai_capability_service.py (修改)

**新增方法：**

- `create_preview_task()` - 创建预览任务（两步工作流第一步）
- `apply_preview()` - 应用预览结果（两步工作流第二步）
- `_apply_result_to_clip()` - 将结果应用到 clip（占位，由前端处理）
- `_wait_for_omni_image_task()` - 等待 omni-image 任务完成

**修改方法：**

- `_process_background_replace()` - 改用 omni-image API 替代 text2video

### 3. backend/app/api/ai_capabilities.py (修改)

**新增端点：**

- `POST /api/ai-capabilities/preview` - 创建预览任务
- `POST /api/ai-capabilities/tasks/{id}/apply` - 应用预览结果

### 4. backend/requirements.txt (修改)

添加依赖：
- `Pillow>=10.0.0` - 图片处理
- `numpy>=1.24.0` - 数组操作

## API 接口说明

### POST /api/ai-capabilities/preview

创建预览任务，生成预览图片但不自动应用。

**请求体：**
```json
{
  "capability_type": "background-replace",
  "clip_id": "clip-xxx",
  "session_id": "session-xxx",
  "prompt": "夏日海滩，金色阳光",
  "keyframe_url": "https://storage.../keyframe.jpg",
  "mask_data_url": "data:image/png;base64,..."
}
```

**响应：**
```json
{
  "id": "task-xxx",
  "capability_type": "background-replace",
  "clip_id": "clip-xxx",
  "session_id": "session-xxx",
  "status": "pending",
  "prompt": "夏日海滩，金色阳光",
  "keyframe_url": "https://storage.../keyframe.jpg",
  "result_url": null
}
```

### POST /api/ai-capabilities/tasks/{id}/apply

应用预览结果到 clip。

**响应：**
```json
{
  "id": "task-xxx",
  "status": "completed",
  "result_url": "https://kling.../result.jpg"
}
```

## SSE 事件

通过 `GET /api/ai-capabilities/events/{session_id}` 接收实时进度：

```
event: progress
data: {"task_id": "xxx", "progress": 30, "message": "AI 正在生成中..."}

event: completed
data: {"task_id": "xxx", "progress": 100, "result_url": "https://..."}

event: applied
data: {"task_id": "xxx", "message": "预览已应用到片段"}
```

## 工作流说明

### 两步工作流

```
1. 用户在 DrawingCanvas 绘制 mask
2. 用户输入 prompt 描述想要的效果
3. 前端调用 POST /preview
4. 后端：
   - 解析 keyframe 图片
   - 构建 omni-image prompt（使用 <<<image_1>>> 引用）
   - 调用 Kling AI omni-image API
   - 等待生成完成
   - 返回预览图片 URL
5. 前端展示预览图片
6. 用户确认 → 调用 POST /tasks/{id}/apply
7. 后端标记任务为已应用，前端更新 clip
```

### Kling omni-image Prompt 格式

有 mask 时：
```
Based on <<<image_1>>>, replace the marked/selected area with: {用户prompt}. 
Keep the rest of the image unchanged and seamlessly blend the edited area.
```

无 mask 时：
```
Transform <<<image_1>>> to show: {用户prompt}. 
Maintain the main composition and subject while changing the background or style.
```

## 后续开发建议

1. **Mask 优化**：当前未真正使用 mask 区域，可扩展为：
   - 将 mask 作为第二张图片传入 omni-image
   - 使用更精确的 prompt 描述 mask 区域

2. **图生视频**：预览确认后，可调用 image2video 将编辑后的图片生成为视频

3. **批量处理**：支持一次编辑应用到多个关键帧

4. **历史记录**：保存编辑历史，支持撤销/重做

## 测试步骤

1. 启动后端服务：
   ```bash
   cd backend
   uvicorn app.main:app --reload --port 8000
   ```

2. 测试 preview 端点：
   ```bash
   curl -X POST http://localhost:8000/api/ai-capabilities/preview \
     -H "Content-Type: application/json" \
     -d '{
       "capability_type": "background-replace",
       "clip_id": "test-clip",
       "session_id": "test-session",
       "prompt": "美丽的日落海滩",
       "keyframe_url": "https://example.com/test.jpg"
     }'
   ```

3. 查询任务状态：
   ```bash
   curl http://localhost:8000/api/ai-capabilities/tasks/{task_id}
   ```

4. 应用预览结果：
   ```bash
   curl -X POST http://localhost:8000/api/ai-capabilities/tasks/{task_id}/apply
   ```
