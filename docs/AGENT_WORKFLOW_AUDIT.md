# Lepus AI — Agent Workflow 全量审计文档

> 目标：逐一梳理所有 AI 任务的完整链路（API → Celery → Kling/外部 → 后处理），  
> 标注每个环节的 prompt、参数、默认值、已知问题，供逐条 check 调优。
>
> **最后更新**: 2026-02-13（队列统一 gpu、autoretry 补全、face_swap 英文 prompt + 模型升级、Avatar 持久化、motion_control 透传、_create_ai_task 去重等）

---

## 📋 总览

| # | Workflow | 队列 | Provider | 输入→输出 | Prompt 策略 | 状态 |
|---|---------|------|----------|----------|------------|------|
| 1 | [Face Swap](#1-face-swap-换脸) | `gpu` | Kling Omni-Image | 图+脸→图(+视频) | 英文详细模板 | ✅ 已调优 |
| 2 | [Image → Video](#2-image-to-video-图生视频) | `gpu` | Kling image2video | 图+prompt→视频 | 用户自填 | ✅ 基本可用 |
| 3 | [Text → Video](#3-text-to-video-文生视频) | `gpu` | Kling text2video | prompt→视频 | 用户自填 | ✅ 基本可用 |
| 4 | [Multi-Image → Video](#4-multi-image-to-video-多图生视频) | `gpu` | Kling multi-image2video | 多图+prompt→视频 | 用户自填 | ✅ 基本可用 |
| 5 | [Lip Sync](#5-lip-sync-口型同步) | `gpu` | Kling lip-sync | 视频+音频→视频 | 无 prompt | ✅ 可用 |
| 6 | [Motion Control](#6-motion-control-动作控制) | `gpu` | Kling motion-control | 图+动作源→视频 | 可选 prompt | ✅ 基本可用 |
| 7 | [Video Extend](#7-video-extend-视频延长) | `gpu` | Kling video-extend | Kling视频ID→视频 | 可选 prompt | ✅ 可用 |
| 8 | [Image Generation](#8-image-generation-图像生成) | `gpu` | Kling images/generations | prompt(+参考图)→图 | 用户自填+LLM增强 | ✅ 功能完善 |
| 9 | [Omni-Image](#9-omni-image) | `gpu` | Kling Omni-Image | prompt+多图→图 | 用户构造 `<<<image_N>>>` | ✅ 可用 |
| 10a | [Skin Enhance](#10a-skin-enhance-皮肤美化) | `gpu` | Kling Omni-Image | 图→图 | 强度分档英文模板 | ⚠️ 待验证 |
| 10b | [Relight](#10b-relight-ai打光) | `gpu` | Stability AI | 图→图 | 英文光照模板 | ⚠️ 第三方API |
| 10c | [Outfit Swap](#10c-outfit-swap-换装) | `gpu` | Kling Omni-Image | 人+衣→图 | 英文换装模板 | ✅ 已修复 |
| 10d | [AI Stylist](#10d-ai-stylist-穿搭师) | `gpu` | Kling Omni-Image | 衣→搭配图 | 英文搭配模板 | ⚠️ 待验证 |
| 10e | [Outfit Shot](#10e-outfit-shot-穿搭内容) | `gpu` | Kling Omni-Image | 衣→内容图 | 英文内容模板 | ⚠️ 待验证 |
| 11 | [Avatar Confirm Portraits](#11-avatar-confirm-portraits) | `gpu` | Doubao Seedream / Kling (fallback) | 多照片→4张肖像 | 双引擎详细模板 | ✅ 已升级 |
| 12 | [Avatar Reference Angles](#12-avatar-reference-angles) | `gpu` | Kling images/generations | 正面照→3角度照 | 英文角度模板×3 | ⚠️ model_name 被覆盖 |

> **队列说明**: 所有任务已统一到单一 `gpu` 队列，`start-celery.sh` 只监听 `-Q gpu`。不再有 `default` / `gpu_medium` 等多队列。

---

## 1. Face Swap (换脸)

### 链路
```
用户上传 → POST /kling/face-swap → create_ai_task(pending)  [shared util]
  → process_face_swap.delay(queue=gpu)
    → Step 1: 构建 Omni-Image 请求
    → Step 2: POST /v1/images/omni-edit (创建任务)
    → Step 3: 轮询 GET /v1/images/omni-edit/{task_id} (5s间隔, 最多60次=300s)
    → Step 4: 下载 PNG → 上传 Supabase Storage → 创建 Asset
    → Step 5 (可选): POST /v1/videos/image2video → 轮询 → 下载视频
  → update_ai_task_status(completed)
```

### Prompt 模板（英文）
```
默认 (FACE_SWAP_PROMPT):
  Keep the scene, composition, pose, clothing, hairstyle, and background of
  <<<image_1>>> completely unchanged. Replace ONLY the face of the person in
  <<<image_1>>> with the face from <<<image_2>>>. Maintain consistent lighting,
  natural skin texture, realistic facial details, and seamless blending. Preserve
  the original head angle, expression intensity, and shadow direction. The result
  must look like a real unedited photograph with no artifacts or uncanny valley effect.

自定义 (FACE_SWAP_PROMPT_WITH_CUSTOM):
  [同上] + Additional requirements: {custom_prompt}
```

### API 参数（Omni-Image 换脸）
| 参数 | 值 | 来源 |
|------|-----|------|
| model_name | `kling-v2-1` | 硬编码 |
| resolution | `1k` | 可配置(默认1k) |
| n | `1` | 硬编码 |
| image_list | `[{源图}, {人脸}]` | 用户输入 |

### 视频联动参数（可选）
| 参数 | 值 | 来源 |
|------|-----|------|
| model_name | `kling-video-o1` | 硬编码（已升级） |
| mode | `std` | 硬编码 |
| duration | `5` | 可配置(默认5) |
| prompt | `The person makes subtle natural movements, gentle blinking, slight head turns, and a soft smile. Realistic and lifelike motion with natural breathing.` | 硬编码英文默认 |

### Celery 配置
```python
queue="gpu", autoretry_for=(Exception,), retry_backoff=True,
retry_backoff_max=300, retry_kwargs={"max_retries": 3},
soft_time_limit=600, time_limit=900
```

### ⚠️ 已知问题 & 调优建议
1. ~~Prompt 是中文~~ → ✅ 已改为详细英文 prompt（含光照、肤色、无缝融合指令）
2. ~~视频联动用 `kling-v1-6`~~ → ✅ 已升级为 `kling-video-o1`
3. ~~Omni 模型 `kling-v2-1`~~ → ✅ 已与 `ai_engine_registry` 保持一致（omni-image 端点仅支持 `kling-v2-1`）
4. **没有图片预处理** — 没做人脸检测验证、没有对齐、没有尺寸标准化
5. **resolution 默认 1k** — 真实照片换脸 2k 效果更好
6. **Celery 有 autoretry** ✅ (max_retries=3, exponential backoff)

---

## 2. Image to Video (图生视频)

### 链路
```
POST /kling/image-to-video → create_ai_task(pending)  [shared util]
  → process_image_to_video.delay(queue=gpu)
    → POST /v1/videos/image2video
    → 轮询 (5s, 最多120次=600s)
    → 下载 MP4 → 上传 Storage (3x retry) → 创建 Asset
  → completed
```

### Prompt 模板
无内置模板，用户自填 prompt 直接透传。

### API 参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| model_name | `kling-v2-6` | ✅ 最新模型 |
| duration | `"5"` | 5或10秒 |
| cfg_scale | `0.5` | prompt 遵循度 |
| mode | `"std"` | std/pro |
| aspect_ratio | 无(API默认) | 由图片决定 |

### Celery 配置
```python
queue="gpu", autoretry_for=(Exception,), retry_backoff=True,
retry_backoff_max=300, retry_kwargs={"max_retries": 2}
```

### ⚠️ 已知问题
1. ~~没有 Celery autoretry~~ → ✅ 已添加 (max_retries=2, exponential backoff)
2. **Storage 上传有 3x retry** ✅ — 有 exponential backoff
3. **asset 默认 duration=5.0** — 如果 API 没返回 duration 字段

---

## 3. Text to Video (文生视频)

### 链路
```
POST /kling/text-to-video → create_ai_task(pending)  [shared util]
  → process_text_to_video.delay(queue=gpu)
    → POST /v1/videos/text2video
    → 轮询 (5s, 最多120次=600s)
    → 下载 MP4 → 上传 Storage → 创建 Asset
  → completed
```

### API 参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| model_name | `kling-v2-6` | ✅ 最新 |
| duration | `str("5")` | ✅ 默认已改为 str，防御性包装 |
| aspect_ratio | `"16:9"` | |
| cfg_scale | `0.5` | |
| style | `"realistic"` | 硬编码 |
| camera_motion | `"none"` | 硬编码 |

### Celery 配置
```python
queue="gpu", autoretry_for=(Exception,), retry_backoff=True,
retry_backoff_max=300, retry_kwargs={"max_retries": 2}
```

### ⚠️ 已知问题
1. ~~duration 类型不一致~~ → ✅ 已修复，默认值改为 `str("5")`，task 层也有 `str()` 防御
2. ~~没有 Celery autoretry~~ → ✅ 已添加
3. **prompt 截断 2500 字** — service 层做的

---

## 4. Multi-Image to Video (多图生视频)

### 链路
```
POST /kling/multi-image-to-video → create_ai_task(pending)  [shared util]
  → process_multi_image_to_video.delay(queue=gpu)
    → POST /v1/videos/multi-image2video
    → 轮询 (5s, 最多120次=600s)
    → 下载 MP4 → 自定义上传(httpx, 300s timeout, 3x retry) → 创建 Asset
  → completed
```

### API 参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| duration | `"5"` | |
| aspect_ratio | `"16:9"` | |
| images | 最多 4 张 | URL 列表 |
| prompt | **必填** | 不同于其他 video 能力 |

> **注意**: `model_name` 不传给 API（service 层的 `create_multi_image_to_video_task` 不转发此参数，API 端点不支持）。task 层已清除遗留的硬编码 `model_name: "kling-v1-6"`。

### Celery 配置
```python
queue="gpu", autoretry_for=(Exception,), retry_backoff=True,
retry_backoff_max=300, retry_kwargs={"max_retries": 2}
```

### ⚠️ 已知问题
1. ~~model_name 矛盾~~ → ✅ 已清理，task 不再传 model_name
2. ~~没有 Celery autoretry~~ → ✅ 已添加
3. **用自定义 httpx 上传** — 绕过了标准 storage lib，维护成本高

---

## 5. Lip Sync (口型同步)

### 链路
```
POST /kling/lip-sync → create_ai_task(pending)  [shared util]
  → process_lip_sync.delay(queue=gpu)
    → Step 1: POST /v1/videos/identify-face (人脸检测)
    → Step 2: POST /v1/videos/advanced-lip-sync (创建口型同步)
    → 轮询 (5s, 最多120次=600s)
    → 下载 MP4 → 上传 Storage → 创建 Asset
  → completed
```

### API 参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| face_index | `0` | 第一张脸 |
| sound_volume | `1.0` | 新音频音量 |
| original_audio_volume | `1.0` | 原始音频音量 |
| model_name | `kling-v2-master` | 硬编码 |
| mode | `audio2video` | 硬编码 |
| stream_id | 动态 | 来自 identify-face 结果 |

### Celery 配置
```python
queue="gpu", autoretry_for=(Exception,), retry_backoff=True,
retry_backoff_max=300, retry_kwargs={"max_retries": 3},
soft_time_limit=1800, time_limit=3600
```

### ⚠️ 已知问题
1. **超时极长** — soft_time_limit=1800s(30min), time_limit=3600s(60min)，远高于其他任务
2. **有 Celery autoretry** ✅ (max_retries=3)
3. **两步 API** — identify-face 失败会导致整个任务失败

---

## 6. Motion Control (动作控制)

### 链路
```
POST /kling/motion-control → create_ai_task(pending)  [shared util]
  → process_motion_control.delay(queue=gpu)
    → POST /v1/videos/motion-control
    → 轮询 (5s, 最多180次=900s ← 最长)
    → 下载 MP4 → 上传 Storage → 创建 Asset
  → completed
```

### API 参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| image | 必填 | 人物图片 |
| video_url | 必填 | 动作参考视频/图片 |
| mode | `"pro"` | std/pro |
| duration | `"5"` | ✅ API 路由 → task options → service payload 全链路透传 |
| model_name | `"kling-v2-6"` | ✅ API 路由 → task options → service payload 全链路透传 |
| keep_original_sound | `"yes"` | 硬编码 |

### Celery 配置
```python
queue="gpu", autoretry_for=(Exception,), retry_backoff=True,
retry_backoff_max=300, retry_kwargs={"max_retries": 2}
```

### ⚠️ 已知问题
1. ~~model_name 丢失~~ → ✅ 已修复，API 路由 → Celery task → service 三层全透传
2. **轮询时间最长** — 900s (15min)
3. ~~没有 Celery autoretry~~ → ✅ 已添加
4. **mode 限制**: image 模式最多 10s, video 模式最多 30s

---

## 7. Video Extend (视频延长)

### 链路
```
POST /kling/video-extend → create_ai_task(pending)  [shared util]
  → process_video_extend.delay(queue=gpu)
    → POST /v1/videos/video-extend
    → 轮询 (5s, 最多120次=600s)
    → 下载 MP4 → 上传 Storage → 创建 Asset
  → completed (返回 new_video_id 可链式延长)
```

### API 参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| video_id | 必填 | ⚠️ 必须是 Kling 生成的 video_id，不是 URL |
| extend_direction | `"end"` | end/start |
| cfg_scale | `0.5` | |
| prompt | 可选 | |

### Celery 配置
```python
queue="gpu", autoretry_for=(Exception,), retry_backoff=True,
retry_backoff_max=300, retry_kwargs={"max_retries": 2}
```

### ⚠️ 已知问题
1. **video_id 限制** — 只能延长 Kling 生成的视频，用户上传的不行
2. ~~没有 Celery autoretry~~ → ✅ 已添加
3. **单次延长 4-5s**，总长不超过 3min
4. **视频 30 天后过期**

---

## 8. Image Generation (图像生成)

### 链路
```
POST /kling/image-generation → create_ai_task(pending)  [shared util]
  → [可选] Avatar 注入: 匹配最佳角度肖像 → 覆盖 image + image_reference
  → process_image_generation.delay(queue=gpu)
    → [可选] LLM prompt 增强 (如果 enhance_prompt=True)
    → POST /v1/images/generations
    → [模式A] 回调: 提交后直接返回 15% 等回调
    → [模式B] 轮询 (5s, 最多60次=300s)
    → 下载每张 PNG → 上传 Storage → 创建 Asset (第一张为主输出)
  → completed
```

### API 参数 (Text-to-Image)
| 参数 | 默认值 | 说明 |
|------|--------|------|
| model_name | `kling-v2-1` | |
| resolution | `"1k"` | |
| n | `1` | 1-9 |
| aspect_ratio | 用户指定 | 仅 text2img 支持 |
| negative_prompt | 用户指定 | 仅 text2img 支持 |

### API 参数 (Image-to-Image)
| 参数 | 默认值 | 说明 |
|------|--------|------|
| model_name | ⚠️ **强制 `kling-v2-1`** | service 层覆盖 |
| image_reference | `"subject"` | subject/face |
| image_fidelity | `0.5` | 图片保真度 |
| human_fidelity | `0.45` | 人脸保真度 (Avatar 注入时提升到 >0.45) |
| negative_prompt | ⚠️ **强制清空** | img2img 不支持 |

### Avatar 注入逻辑（API 路由层）
如果用户传了 `avatar_id`:
1. 调用 `digital_avatar_service.get_best_angle_portrait(avatar_id, prompt)` — LLM 分析 prompt 推断最佳角度
2. 覆盖 `image = 匹配的肖像 URL`, `image_reference = "face"`
3. 如果用户没手动提高 `human_fidelity`(≤0.45)，自动设为更高值

### ⚠️ 已知问题
1. **回调模式** — 依赖 `CALLBACK_BASE_URL` 环境变量，本地开发通常没配置 → 降级为轮询
2. **有 Celery autoretry** ✅ (max_retries=3)
3. **LLM prompt 增强**的质量取决于 LLM 选择（Doubao/Gemini），可能引入噪声

---

## 9. Omni-Image

### 链路
```
POST /kling/omni-image → create_ai_task(pending)  [shared util]
  → [可选] Avatar 注入: 所有角度肖像追加到 image_list
  → process_omni_image.delay(queue=gpu)
    → POST /v1/images/omni-edit
    → 轮询 (5s, 最多60次=300s)
    → 下载每张 PNG → 上传 Storage → 创建 Asset
  → completed
```

### API 参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| model_name | ⚠️ **强制 `kling-v2-1`** | service 层覆盖，忽略用户输入 |
| resolution | `"2k"` | Omni 默认 2k |
| n | `1` | 1-9 |
| aspect_ratio | `"auto"` | |

### Prompt 构造
用户用 `<<<image_1>>>`, `<<<image_2>>>` 等标记引用 image_list 中的图片。

### ⚠️ 已知问题
1. **model_name 被覆盖** — 用户传什么都变成 `kling-v2-1`，可能 omni-edit 只支持这个
2. **有 Celery autoretry** ✅
3. **image + element 总数 ≤ 10**

---

## 10a. Skin Enhance (皮肤美化)

### 链路
```
POST /enhance-style/skin-enhance → create_ai_task(pending)  [shared util]
  → process_enhance_style.delay(queue=gpu, capability_id="skin_enhance")
    → AIEngineRegistry 路由到 KlingOmniImageEngine
    → 构建 prompt → POST /v1/images/omni-edit → 轮询 → 下载 → 上传
  → completed
```

### Prompt 模板（英文）
```
<<<image_1>>> {intensity_prompt}

intensity_prompt 按强度分档:
  natural:  "enhance skin texture, subtle skin smoothing, keep natural look, high quality portrait"
  moderate: "skin retouching, smooth skin, remove blemishes, bright and clear complexion, portrait photography"
  max:      "perfect skin, flawless complexion, professional beauty retouching, studio quality skin, magazine cover"
```

### Celery 配置
```python
queue="gpu", autoretry_for=(Exception,), retry_backoff=True,
retry_backoff_max=300, retry_kwargs={"max_retries": 2}
```

### ⚠️ 调优点
1. **intensity 只有 3 档** — 跳跃太大，moderate→max 之间差距明显
2. **没有中文场景优化** — "高质量人像" 类型的中文描述可能更好
3. **Credits: 3**

---

## 10b. Relight (AI打光)

### 链路
```
POST /enhance-style/relight → create_ai_task(pending)  [shared util]
  → process_enhance_style.delay(queue=gpu, capability_id="relight")
    → AIEngineRegistry 路由到 StabilityRelightEngine
    → POST https://api.stability.ai/v2beta/stable-image/edit/replace-background-and-relight
    → 轮询 GET /v2beta/results/{id} (3s 间隔, 最多100次=300s)
    → 下载 → 上传
  → completed
```

### API 参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| light_source_direction | 映射: front→above, left→left, right→right | |
| light_source_strength | `0.7` × light_intensity | |
| preserve_original_subject | `0.7` | 硬编码 |
| output_format | `"png"` | |

### 光照类型 Prompt（英文）
```
natural:     "natural daylight, soft ambient lighting"
studio:      "professional studio lighting, clean white background"
golden_hour: "warm golden hour sunlight, soft warm tones"
dramatic:    "dramatic moody lighting, strong contrast, dark atmosphere"
neon:        "neon lighting, colorful neon glow, cyberpunk atmosphere"
soft:        "soft diffused lighting, beauty lighting, gentle shadows"
```

### ⚠️ 调优点
1. **第三方 API (Stability AI)** — 独立账号、独立计费、独立限流
2. **方向映射有损** — front 和 back 都映射到 above，top 也映射到 above
3. **Credits: 8** — 最贵的单次操作之一
4. **API `replace-background-and-relight`** — 名字暗示会替换背景，可能不是纯打光

---

## 10c. Outfit Swap (换装)

### 链路
```
POST /enhance-style/outfit-swap → create_ai_task(pending)  [shared util]
  → process_enhance_style.delay(queue=gpu, capability_id="outfit_swap")
    → KlingOmniImageEngine
    → POST /v1/images/omni-edit → 轮询 → 下载 → 上传
  → completed
```

### Prompt 模板（英文）
```
<<<image_1>>> person {type_prompt}, <<<image_2>>> is the garment reference,
keep person's face and body unchanged, only change clothing,
photorealistic, high quality

type_prompt 按衣物类型:
  upper: "wearing the outfit shown in <<<image_2>>> as upper body clothing"
  lower: "wearing the pants/skirt shown in <<<image_2>>>"
  full:  "wearing the complete outfit shown in <<<image_2>>>"
```

### ⚠️ 调优点
1. ~~Prompt 引用不一致~~ → ✅ 已修复，`image_b` 已改为 `<<<image_2>>>`
2. **没有体型适配** — 换装没考虑人物体型与衣服尺寸匹配
3. **Credits: 5**

---

## 10d. AI Stylist (穿搭师)

### 链路
```
POST /enhance-style/ai-stylist → create_ai_task(pending)  [shared util]
  → process_enhance_style.delay(queue=gpu, capability_id="ai_stylist")
    → KlingOmniImageEngine
    → POST /v1/images/omni-edit → 轮询 → 下载 → 上传
  → completed
```

### Prompt 模板（英文）
```
Fashion stylist recommendation: create a complete {occasion_prompt} coordination
based on <<<image_1>>> garment, {style_tags} style, {season} season,
{gender} model wearing the complete styled outfit, full body shot,
fashion photography, high quality

occasion_prompt:
  daily:  "everyday casual outfit"
  work:   "professional office outfit"
  date:   "elegant date night outfit"
  travel: "comfortable travel outfit"
  party:  "stylish party outfit"
```

### ⚠️ 调优点
1. **只有 1 张参考图** — 只传了衣物图，没有模特形象参考
2. **style_tags 可能为空** — 如果用户不填，prompt 里会有空字符串
3. **Credits: 5**

---

## 10e. Outfit Shot (穿搭内容)

### 链路
```
POST /enhance-style/outfit-shot → create_ai_task(pending)  [shared util]
  → process_enhance_style.delay(queue=gpu, capability_id="outfit_shot")
    → KlingOmniImageEngine
    → POST /v1/images/omni-edit × num_variations → 轮询 → 下载 → 上传
  → completed
```

### 内容类型 Prompt（英文）
```
cover:      "social media cover image, bold text-friendly composition, eye-catching layout"
streetsnap: "street style photography, urban background, natural casual pose, city setting"
lifestyle:  "lifestyle photography, cozy atmosphere, cafe or home setting, warm tones"
flat_lay:   "flat lay photography, top-down view, neatly arranged items on clean background"
comparison: "before and after comparison, side by side outfit styling, split composition"
```

### 平台比例映射
```
xiaohongshu: 3:4
douyin:      9:16
instagram:   1:1
custom:      1:1
```

### ⚠️ 调优点
1. **批量生成** — 多变体时逐个创建任务，没有并行
2. **Credits: 8/variant** — 4 个变体 = 24 credits（有折扣），最贵的能力
3. **try_on 模式** — 声明了 avatar_id 字段但实际处理逻辑待确认

---

## 11. Avatar Confirm Portraits

### 链路（双引擎）
```
POST /v2/avatars/confirm-portraits { source_image_urls, engine } → 创建任务
  → generate_confirm_portraits.delay(queue=gpu, engine=前端选择)
    → 根据 engine 参数选择引擎:
    
    [引擎A: Doubao Seedream 4.0] (默认)
      → 构建中文 prompt（含「图1」「图2」引用）
      → DoubaoImageService.generate(image=urls[], sequential=True, max_images=4, size="2K")
      → 同步/SSE 返回 4 张图片 URL（无需轮询）
      → 失败时自动 fallback 到 Kling

    [引擎B: Kling omni-image] (fallback)
      → 构建英文 prompt（含 <<<image_N>>> 引用）
      → POST /v1/images/omni-edit (n=4, 2k, 3:4)
      → 轮询 (5s, 最多60次=300s)

    → 下载 PNG → 上传 Supabase Storage → 存持久化 URL 到 DB
  → completed
```

### 引擎选择
```
前端页面提供模型切换器（Seedream 4.0 / Kling）
→ POST /v2/avatars/confirm-portraits { engine: "doubao" | "kling" }
→ Celery task 接收 engine 参数
```

### Storage 路径
```
avatars/{user_id}/{task_id}_confirm_{i}.png
```
- 使用 `_persist_images_to_storage()` 统一处理
- 下载失败时 graceful degradation：回退到 CDN URL

### Prompt 模板（5-Section Realism Framework）

> 采用 5 层真实感框架：摄影媒介 → 身份还原 → 真实感引擎 → 光影构图 → 背景
> 核心是 **[3] Realism Engine** —— 毛孔/绒毛/油光 打破 AI 塑料感

#### Doubao Seedream（默认，中文）
```
[1] 摄影风格与媒介（最高权重）
  纪实风格35mm胶片摄影，参考{refs}中的人物。
  RAW底片，柯达Portra 400胶片质感。85mm人像镜头，f/2.8光圈。
  未经修图，无磨皮无美颜，微妙胶片颗粒感，真实色彩还原。

[2] 主体身份（严格还原）
  严格保持参考照片中所有面部特征：脸型、眼睛、鼻子、嘴唇、眉毛、
  肤色、雀斑、痣、发型、发色。淡妆或素颜，自然睫毛，真实眉形。

[3] 真实感引擎（反塑料核心 — 必须）
  可见毛孔和细纹，侧光下可见面部绒毛（桃子绒毛），
  T区皮肤油光和光泽（非哑光），鼻翼眼周微泛红。
  发际线自然碎发和飞丝，发丝半透明光泽。

[4] 光影与构图
  45度侧面主光 + 柔和补光，T区高光，发丝轮廓光。
  正面居中头肩构图，生成4张，每张角度略有不同。

[5] 背景：纯白高调影棚，浅景深，自然阴影。

{refs} = 图1、图2 ... (动态构建，引用 image 数组)
```

#### Kling omni-image（fallback，英文）
```
[1] Photography Style & Medium (highest weight)
  Candid 35mm film photograph of the person in {refs}.
  RAW photo, Kodak Portra 400 film stock. 85mm portrait lens, f/2.8.
  Unedited, no retouching, no airbrushing, subtle film grain.

[2] Subject & Identity
  Maintain EXACT identity from reference: face shape, eye shape,
  nose, lips, eyebrows, skin tone, freckles, moles, hair.
  Minimal makeup, natural lash line, hydrated lips.

[3] Realism Engine (MANDATORY — anti-plastic core)
  Visible pores and fine lines, natural vellus hair (peach fuzz)
  under side light, subtle skin oil/sheen on T-zone (not matte),
  slight redness around nose and under eyes.
  Natural flyaways and stray hairs, individual strands catching light.

[4] Lighting & Composition
  Side key light 45°, soft fill, specular highlights on T-zone,
  rim light for hair separation. Centered head & shoulders, gentle smile.

[5] Background: Solid white, high-key studio, shallow DOF.

{refs} = <<<image_1>>> and <<<image_2>>> ... (动态构建)
```

### API 参数对比

| 参数 | Doubao Seedream | Kling omni-image |
|------|----------------|-----------------|
| model | config endpoint ID | `kling-image-o1` |
| resolution/size | `"2K"` | `"2k"` |
| n/max_images | `4` (sequential) | `4` (n) |
| aspect_ratio | — (由 size 决定) | `"3:4"` |
| 响应模式 | SSE 流式（同步收集） | 异步轮询 5s×60 |
| 超时 | ~60s（同步） | ~300s（轮询） |

### ⚠️ 已知问题 / 待验证
1. ~~不持久化到 Storage~~ → ✅ 已修复
2. ~~resolution=1k~~ → ✅ 已升级为 2k（两个引擎均 2K）
3. ~~prompt 过于通用~~ → ✅ 已升级为 5-Section Realism Framework（胶片媒介 + 身份还原 + 毛孔/绒毛/油光反塑料引擎 + 侧光构图 + 白底背景）
4. **Doubao 身份保持度待验证** — Seedream 是生图模型，多图参考对人脸还原度不如 omni-image 有专门优化
5. **Doubao 用中文 prompt** — Seedream 对中文理解更好，但英文 prompt 效果可能不同
6. **fallback 机制** — Doubao 失败时自动回退到 Kling，但用户无感知哪个引擎生成的
7. **前端选择** — 用户可在页面切换 Seedream 4.0 或 Kling，方便 A/B 对比

---

## 12. Avatar Reference Angles

### 链路
```
确认头像后自动触发
  → generate_reference_angles.delay(queue=gpu)
    → 并行提交 3 个 image generation 任务 (3个角度)
    → 统一轮询 (5s, 最多60次=300s)
    → ✅ 每个角度完成后立即下载→上传 Supabase Storage→存持久化 URL
  → completed (部分成功也算 OK)
```

### Storage 路径
```
avatars/{user_id}/{avatar_id}_angle_{angle_key}.png
```
- 使用 `_persist_image_to_storage()` 逐个处理
- 下载失败时 graceful degradation：回退到 CDN URL

### 3 个角度 Prompt（英文）
```
three_quarter_left:
  "Same person, three-quarter view turned slightly to the left, natural soft
  lighting, neutral background, photorealistic, 85mm portrait lens, shallow
  depth of field, visible skin texture and pores, no retouching"

profile_right:
  "Same person, right profile view showing side of face, natural window light,
  neutral background, photorealistic, 85mm portrait lens, visible skin texture,
  natural hair detail, no retouching"

slight_above:
  "Same person, slightly elevated camera angle looking down, gentle overhead
  natural lighting, neutral background, photorealistic, 50mm lens, visible
  skin pores, natural expression, no retouching"
```

### API 参数
| 参数 | 值 | 说明 |
|------|-----|------|
| model_name | `kling-v1-5` | ⚠️ 但 service 层强制用 `kling-v2-1`，被静默覆盖 |
| image_fidelity | `0.75` | 高保真 |
| human_fidelity | `0.80` | 高人脸保真 |
| resolution | `"1k"` | |
| n | `1` | 每个角度 1 张 |

### ⚠️ 已知问题
1. **model_name 冲突** — task 传 `kling-v1-5`，但 service 层 img2img 强制 `kling-v2-1`，`v1-5` 被静默忽略。功能不受影响但代码有误导性
2. ~~不持久化到 Storage~~ → ✅ 已修复，每个角度实时持久化
3. **部分失败静默** — 只要有一个角度成功就算 OK，用户不知道缺失了哪些角度

---

## 🏗 跨 Workflow 共性问题

### 1. ✅ Celery 队列已统一
所有任务统一使用 `gpu` 队列。`start-celery.sh` 只启动 `-Q gpu`。

~~之前存在 `default` / `gpu_medium` / `gpu` 三种队列不一致的问题。~~

### 2. ✅ Celery Retry 策略已统一
所有 AI 任务都有 autoretry:

| 任务 | autoretry | max_retries | backoff |
|------|-----------|-------------|---------|
| face_swap, lip_sync, image_gen, omni_image | ✅ | 3 | exponential (max 300s) |
| image_to_video, text_to_video, multi_image_to_video, motion_control, video_extend, enhance_style | ✅ | 2 | exponential (max 300s) |
| avatar_confirm_portraits, avatar_reference_angles | ✅ | 3 | exponential (max 300s) |

### 3. ✅ Prompt 语言已统一
所有 prompt 现在都是英文：
- face_swap: 已从中文改为详细英文（含光照、肤色、融合指令）
- 其余所有: 原本就是英文

### 4. ✅ `_create_ai_task` 已去重
提取到 `app/utils/ai_task_helpers.py` 的共享 `create_ai_task()` 函数。
- `kling.py` 和 `enhance_style.py` 均委托到此共享实现
- 签名: `create_ai_task(user_id, task_type, input_params, provider="kling", callback_url=None) -> str`

### 5. 任务名前缀不一致（未修复）
- 部分用 `tasks.xxx.yyy` (如 face_swap)
- 部分用 `app.tasks.xxx.yyy` (如 broll_download)
- 部分无显式 name

**风险**：Celery routing 依赖 task name，不一致可能导致路由失败。目前因为统一队列 + 无 task_routes，此问题暂不影响功能。

### 6. ✅ Avatar 图片已持久化
- `avatar_confirm_portraits`: 生成后下载→上传 Supabase Storage，路径 `avatars/{user_id}/{task_id}_confirm_{i}.png`
- `avatar_reference_angles`: 每个角度实时持久化，路径 `avatars/{user_id}/{avatar_id}_angle_{angle_key}.png`
- 两者都有 graceful degradation（上传失败回退 CDN URL）

---

## 📊 调优优先级建议

### ✅ 已解决

| 原优先级 | 问题 | 状态 |
|---------|------|------|
| 🔴 P0 | Avatar 图片不持久化(会过期) | ✅ 已持久化到 Supabase Storage |
| 🔴 P0 | face_swap prompt 质量差(中文+笼统) | ✅ 英文详细 prompt + 升级到 kling-image-o1 |
| 🟡 P1 | 无 retry 的 6 个任务 | ✅ 全部添加 autoretry + exponential backoff |
| 🟡 P1 | face_swap 视频联动用旧模型 v1-6 | ✅ 升级为 kling-video-o1 |
| 🟡 P1 | outfit_swap prompt 引用 image_b | ✅ 改为 <<<image_2>>> |
| 🟢 P2 | Prompt 语言不统一 | ✅ 全部英文 |
| 🟢 P2 | _create_ai_task 去重 | ✅ 提取到 shared util |
| 🟢 P2 | motion_control model_name 未透传 | ✅ 三层全透传 |
| 🟢 P2 | Celery 队列不一致 | ✅ 统一 gpu 队列 |
| 🟡 P1 | Avatar 确认肖像只有 1k + prompt 过于通用 | ✅ 升级为 2K + 详细 prompt（含皮肤纹理、镜头参数） |
| 🟡 P1 | Avatar 确认肖像只有 Kling 单引擎 | ✅ 接入 Doubao Seedream 双引擎 + fallback |

### 🔮 待处理

| 优先级 | 问题 | 影响范围 | 工作量 |
|--------|------|---------|--------|
| 🟡 P1 | avatar_reference_angles model_name 被覆盖 (v1-5 → v2-1) | 角度生成 | 小 |
| 🟢 P2 | enhance_style 子能力缺少中文场景优化 | 5 个能力 | 中 |
| 🟢 P2 | 任务名前缀不一致 (tasks.xxx vs app.tasks.xxx) | 代码规范 | 小 |
| 🟢 P2 | face_swap 无图片预处理(人脸检测/对齐) | 换脸质量 | 中 |
| 🟢 P2 | face_swap resolution 默认 1k | 换脸质量 | 小 |
| 🟡 P1 | Doubao Seedream 人脸还原度待 A/B 验证 | Avatar 肖像质量 | 中 |
| 🟢 P3 | multi_image_to_video 用自定义 httpx 上传 | 维护成本 | 中 |
| 🟢 P3 | outfit_shot 批量生成无并行 | 性能 | 中 |
