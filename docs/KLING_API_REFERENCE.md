# Kling AI API 参考

> 统一的 Kling API 端点清单。其他文档引用此处，避免重复。

---

## 一、认证

```bash
KLING_AI_ACCESS_KEY=your-access-key
KLING_AI_SECRET_KEY=your-secret-key
```

使用 JWT 签名方式鉴权（HMAC-SHA256），详见 Kling 官方文档。

---

## 二、API 端点总表

| 功能 | 端点 | 方法 | 主要用途 | 积分消耗 |
|------|------|------|----------|----------|
| 口型同步 | `/v1/videos/lipsync` | POST | 音频+形象→口型同步视频 | 50-80 |
| 文生视频 | `/v1/videos/text2video` | POST | 提示词→视频 | 150-300 |
| 图生视频 | `/v1/videos/image2video` | POST | 图片→动态视频 | 80-150 |
| 多图生视频 | `/v1/videos/multi-image2video` | POST | 多图→转场视频 | 80-150 |
| 动作控制 | `/v1/videos/motion/generation` | POST | 参考视频引导运动 | 80-150 |
| 视频延长 | `/v1/videos/extend` | POST | 视频时长扩展 | 50-80 |
| AI 换脸 | —— | —— | **通过 Omni-Image 实现**，见下方说明 | 8-15 |
| 图像编辑 | `/v1/images/omni-image` | POST | Inpainting / 背景替换 / 换脸 | 8-15 |
| 图像生成 | `/v1/images/generations` | POST | 文生图 / 图生图 | 8-15 |
| 任务查询 | `/v1/videos/{task_id}` | GET | 查询任务状态 | 0 |

---

## 三、关键参数说明

### 3.1 通用参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `model_name` | string | `kling-v2-1-master` / `kling-v1-6` 等 |
| `duration` | string | `"5"` / `"10"`（秒） |
| `mode` | string | `"std"` / `"pro"` |
| `cfg_scale` | float | 0.0-1.0，提示词引导强度 |
| `negative_prompt` | string | 负面提示词 |

### 3.2 Camera Control

```json
{
  "type": "simple",
  "config": {
    "horizontal": 0,    // -10 ~ 10
    "vertical": 0,      // -10 ~ 10
    "zoom": 0,          // -10 ~ 10
    "tilt": 0,          // -10 ~ 10
    "pan": 0,           // -10 ~ 10
    "roll": 0           // -10 ~ 10
  }
}
```

### 3.3 多图生视频特有参数

| 参数 | 说明 |
|------|------|
| `image_list` | 图片 URL 列表（≥2 张） |
| `image_tail` | 尾帧图片（可选） |

### 3.4 Omni-Image 参数

| 参数 | 说明 |
|------|------|
| `model_name` | `kling-image-o1`（唯一支持的模型） |
| `image` | 原图 URL |
| `image_list` | 参考图列表 `[{"image": "url"}]`，用 `<<<image_N>>>` 引用 |
| `mask_image` | Mask 图片（Base64 或 URL） |
| `prompt` | 替换/编辑描述 |

---

## 四、任务状态流转

```
submitted → processing → succeed / failed
```

轮询间隔建议：3-5 秒。

---

## 五、后端调用入口

```python
# backend/app/services/kling_ai_service.py
class KlingAIClient:
    async def create_lipsync(audio_url, avatar_url) -> Task
    async def create_text2video(prompt, duration, mode, cfg_scale) -> Task
    async def create_image2video(image_url, prompt, duration) -> Task
    async def create_multi_image2video(images, prompt, duration) -> Task
    async def create_motion_control(video_url, prompt) -> Task
    async def create_omni_image_task(prompt, image_list, ...) -> Task  # 换脸也用此接口
    async def get_omni_image_task(task_id) -> TaskStatus
    async def get_task_status(task_id) -> TaskStatus
```

---

## 六、Celery 任务映射

| Kling 端点 | Celery 任务 |
|------------|-------------|
| image2video | `tasks.image_to_video.process_image_to_video` |
| text2video | `tasks.text_to_video.process_text_to_video` |
| multi-image2video | `tasks.multi_image_to_video.process_multi_image_to_video` |
| motion-control | `tasks.motion_control.process_motion_control` |
| lipsync | `tasks.lip_sync.process_lip_sync` |
| omni-image (换脸) | `tasks.face_swap.process_face_swap` |
| omni-image (编辑) | `tasks.omni_image.process_omni_image` |

---

## 七、错误码

| 错误码 | 含义 | 处理建议 |
|--------|------|----------|
| 1001 | 鉴权失败 | 检查 Access/Secret Key |
| 1002 | 余额不足 | 充值 Kling 账户 |
| 1003 | 参数错误 | 检查请求参数 |
| 2001 | 内容审核不通过 | 修改提示词/图片 |
| 5001 | 服务繁忙 | 重试（指数退避） |
