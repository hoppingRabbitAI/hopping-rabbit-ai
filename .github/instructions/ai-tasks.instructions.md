---
applyTo: "backend/app/tasks/**/*.py,backend/app/services/kling*"
---

# AI Task Skill — Kling API + Celery Pipeline

## 🔴 Model Name Lookup (MUST USE CORRECT MODEL)

| Endpoint | model_name | Notes |
|----------|-----------|-------|
| **text2video** | `kling-v2-6` (default) | Also: `kling-v2-1-master`, `kling-video-o1`, `kling-v2-5-turbo` |
| **image2video** | `kling-v2-6` (default) | Also: `kling-v2-5-turbo`, `kling-v2-1-master`, `kling-video-o1` |
| **multi-image2video** | `kling-v2-5-turbo` | Do NOT pass other models — only turbo supported |
| **motion-control** | `kling-v2-5-turbo` (default) | Also: `kling-v1-6` |
| **multi-elements** (video edit) | `kling-v1-6` (default) | Video-level editing only |
| **omni-image** | `kling-image-o1` | **ONLY** model supported. NEVER use `kling-v2-1` here |
| **image generation** (text2img) | `kling-v2-1` (default) | Also: `kling-image-o1` |
| **image generation** (img2img) | `kling-v1-5` | **FORCED** — only model supporting img2img |

### Omni Models (latest generation)
- **kling-image-o1** — Omni image model. For: omni-image, face_swap, image editing
- **kling-video-o1** — Omni video model. For: high-quality i2v/t2v when quality matters most

### Legacy Models (avoid unless specific reason)
- `kling-v1-5`, `kling-v1-6` — Only for img2img / multi-elements / motion-control compatibility

## 🔴 Prompt Language Rules

| Rule | Details |
|------|---------|
| **Always use English prompts** | English prompts produce significantly better results, especially for realistic photos |
| **Be specific, not generic** | Bad: "保持场景不变，替换人脸" Good: "Keep scene, composition, pose, clothing unchanged. Replace ONLY the face..." |
| **Reference images** | Omni-image uses `<<<image_1>>>`, `<<<image_2>>>` to reference `image_list` items |
| **Include quality anchors** | Add: "realistic", "no artifacts", "seamless blending", "natural lighting" |
| **Negative prompt for video** | Use: "blurry, distorted, low quality, deformed" |

## Capability to API to Model Mapping

| Capability | Kling Endpoint | Client Method | Default Model | Celery Task |
|------------|---------------|---------------|---------------|-------------|
| face_swap | `/v1/images/omni-image` | `create_omni_image_task()` | `kling-image-o1` | `tasks.face_swap` |
| omni_image | `/v1/images/omni-image` | `create_omni_image_task()` | `kling-image-o1` | `tasks.omni_image` |
| image_generation | `/v1/images/generations` | `create_image_task()` | `kling-v2-1` | `tasks.image_generation` |
| image_to_video | `/v1/videos/image2video` | `create_image_to_video_task()` | `kling-v2-6` | `tasks.image_to_video` |
| text_to_video | `/v1/videos/text2video` | `create_text_to_video_task()` | `kling-v2-6` | `tasks.text_to_video` |
| multi_image_to_video | `/v1/videos/multi-image2video` | `create_multi_image_to_video_task()` | `kling-v2-5-turbo` | `tasks.multi_image_to_video` |
| motion_control | `/v1/videos/motion/generation` | `create_motion_control_task()` | `kling-v2-5-turbo` | `tasks.motion_control` |
| lip_sync | `/v1/videos/lipsync` | `create_lipsync_task()` | — | `tasks.lip_sync` |
| multi_elements | `/v1/videos/multi-elements/` | `create_multi_elements_edit_task()` | `kling-v1-6` | `tasks.multi_elements` |

IMPORTANT: face_swap does NOT have its own Kling endpoint — it uses omni-image with a face-reference prompt pattern.

## Kling API Integration

All Kling API calls go through `KlingAIClient` (`app/services/kling_ai_service.py`):

```python
from app.services.kling_ai_service import kling_client

# Image to Video
task = await kling_client.create_image_to_video_task(image_url, prompt, options={"model_name": "kling-v2-6"})

# Text to Video
task = await kling_client.create_text_to_video_task(prompt, options={"duration": "5", "mode": "pro"})

# Multi-image to Video (transitions)
task = await kling_client.create_multi_image_to_video_task(image_list, prompt)

# Omni-Image (face swap, image editing, style transfer)
task = await kling_client.create_omni_image_task(
    prompt="Keep <<<image_1>>> scene unchanged, replace face with <<<image_2>>>...",
    image_list=[{"image": url1}, {"image": url2}],
    options={"model_name": "kling-image-o1"}
)

# Image Generation
task = await kling_client.create_image_task(prompt, options={"model_name": "kling-v2-1"})

# Lip Sync
task = await kling_client.create_lipsync_task(audio_url, video_url)

# Poll status (method varies by endpoint type)
status = await kling_client.get_image_to_video_task(task_id)
status = await kling_client.get_omni_image_task(task_id)
status = await kling_client.get_text_to_video_task(task_id)
```

**Common params:**
- `duration`: `"5"` or `"10"` (string, in seconds)
- `mode`: `"std"` or `"pro"`
- `cfg_scale`: 0.0-1.0 (prompt guidance strength)
- Task statuses: `submitted` -> `processing` -> `succeed` / `failed`

## Celery Task Template

```python
import asyncio
import logging
from app.celery_config import celery_app
from app.services.kling_ai_service import kling_client

logger = logging.getLogger(__name__)

@celery_app.task(queue='gpu_medium', bind=True, max_retries=3)
def process_my_task(self, task_id: str, user_id: str, **params):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_process_async(task_id, user_id, params))
    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}", exc_info=True)
        update_task_status(task_id, "failed", error_message=str(e))
        raise
    finally:
        loop.close()

async def _process_async(task_id, user_id, params):
    # 1. Update status
    update_task_status(task_id, "processing")
    # 2. Call Kling API (use correct model!)
    result = await kling_client.create_xxx_task(...)
    provider_task_id = result["data"]["task_id"]
    # 3. Poll (5s interval, 60 max)
    for i in range(60):
        await asyncio.sleep(5)
        status = await kling_client.get_xxx_task(provider_task_id)
        if status["data"]["task_status"] == "succeed": break
        elif status["data"]["task_status"] == "failed": raise ValueError("failed")
    # 4. Download result -> Upload to Supabase Storage -> Create Asset -> Complete
```

## Progress Update Protocol

```python
update_task_progress(task_id, 5, "准备请求")
update_task_progress(task_id, 10, "提交 AI 任务")
update_task_progress(task_id, 20, "AI 处理中")      # increment in poll loop
update_task_progress(task_id, 80, "下载结果")
update_task_progress(task_id, 90, "上传存储")
update_task_status(task_id, "completed", output_url=url)
```

## Template Rendering Flow

```
API request -> Resolve template -> Merge params -> Create task -> Celery -> Kling -> Poll -> Store
```
- Transition templates: use `multi_image_to_video`, requires `from_image_url` + `to_image_url`
- Creates `variant_count` parallel tasks (default 3)

## Credits Integration

```python
MODEL_KEYS = {
    "lip_sync": "kling_lip_sync",
    "face_swap": "kling_face_swap",
    "image_to_video": "kling_i2v",
    "text_to_video": "kling_t2v",
    "multi_image_to_video": "kling_i2v",
    "omni_image": "dalle3",
}
```
Credits are pre-deducted on task creation; refunded on failure.
