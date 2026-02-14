# Doubao (豆包) 生图 API 参考

> **来源**：火山方舟 Ark API — Seedream 4.0 图像生成模型
>
> **更新日期**：2026年2月14日
>
> **相关文档**：[KLING_API_REFERENCE.md](KLING_API_REFERENCE.md) | [VEO_API_REFERENCE.md](VEO_API_REFERENCE.md) | [AI_CAPABILITIES.md](AI_CAPABILITIES.md)

---

## 一、认证

```bash
VOLCENGINE_ARK_API_KEY=your-ark-api-key   # 从火山方舟控制台获取
```

所有请求通过 `Authorization: Bearer $ARK_API_KEY` 头部鉴权。

---

## 二、API 端点总表

| 功能 | 端点 | 方法 | 输入 | 输出 | 说明 |
|------|------|------|------|------|------|
| 文生图 | `/api/v3/images/generations` | POST | prompt | 单张图片 | 纯文本描述生成图片 |
| 文生一组图 | `/api/v3/images/generations` | POST | prompt | 多张图片 | 连贯序列图生成 |
| 单图生单图 | `/api/v3/images/generations` | POST | prompt + image | 单张图片 | 参考图编辑/变换 |
| 单图生一组图 | `/api/v3/images/generations` | POST | prompt + image | 多张图片 | 基于一张参考图生成一组 |
| 多图参考生单图 | `/api/v3/images/generations` | POST | prompt + image[] | 单张图片 | 多图参考融合 |
| 多图参考生一组图 | `/api/v3/images/generations` | POST | prompt + image[] | 多张图片 | 多图参考 + 连贯序列 |

> **Base URL**: `https://ark.cn-beijing.volces.com`
>
> 所有功能共用同一个端点，通过参数组合区分不同模式。

---

## 三、请求参数说明

### 3.1 通用参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 模型端点 ID（如 `ep-20260214085933-kv5kj`） |
| `prompt` | string | ✅ | 图像描述提示词 |
| `response_format` | string | ❌ | 返回格式：`"url"` / `"b64_json"`，默认 `"url"` |
| `size` | string | ❌ | 图片尺寸：`"2K"` 等 |
| `watermark` | boolean | ❌ | 是否添加水印 |
| `stream` | boolean | ❌ | 是否流式返回（生成多图时建议 `true`） |

### 3.2 参考图参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `image` | string \| string[] | 参考图片 URL。单张传 string，多张传 string 数组 |

- 不传 `image` → 纯文本生图
- 传单个 URL → 单图参考
- 传 URL 数组 → 多图参考（prompt 中用"图1""图2"等引用）

### 3.3 连贯序列生成参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `sequential_image_generation` | string | `"disabled"` = 只生成单张；`"auto"` = 生成一组连贯图 |
| `sequential_image_generation_options` | object | 序列生成选项 |
| `sequential_image_generation_options.max_images` | integer | 最多生成几张图（需 `sequential_image_generation: "auto"`） |

---

## 四、六种用法详解

### 4.1 文生图（Text → Single Image）

纯文本描述，生成一张图片。

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "ep-20260214085933-kv5kj",
    "prompt": "星际穿越，黑洞，黑洞里冲出一辆快支离破碎的复古列车...",
    "sequential_image_generation": "disabled",
    "response_format": "url",
    "size": "2K",
    "stream": false,
    "watermark": true
}'
```

**关键点**：
- `sequential_image_generation: "disabled"` → 单张
- `stream: false` → 同步返回
- 无 `image` 字段 → 纯文生图

### 4.2 文生一组图（Text → Multiple Images）

文本描述，生成一组连贯序列图。

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "ep-20260214085933-kv5kj",
    "prompt": "生成一组共4张连贯插画，核心为同一庭院一角的四季变迁...",
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": {
        "max_images": 4
    },
    "response_format": "url",
    "size": "2K",
    "stream": true,
    "watermark": true
}'
```

**关键点**：
- `sequential_image_generation: "auto"` → 连贯多张
- `max_images: 4` → 最多 4 张
- `stream: true` → 流式逐张返回（推荐）

### 4.3 单图生单图（Single Image → Single Image）

一张参考图 + 提示词，生成一张新图。

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "ep-20260214085933-kv5kj",
    "prompt": "生成狗狗趴在草地上的近景画面",
    "image": "https://example.com/dog.png",
    "sequential_image_generation": "disabled",
    "response_format": "url",
    "size": "2K",
    "stream": false,
    "watermark": true
}'
```

**关键点**：
- `image` 传单个 URL string → 单张参考
- `sequential_image_generation: "disabled"` → 输出单张

### 4.4 单图生一组图（Single Image → Multiple Images）

一张参考图 + 提示词，生成一组连贯图。

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "ep-20260214085933-kv5kj",
    "prompt": "参考这个LOGO，做一套户外运动品牌视觉设计...",
    "image": "https://example.com/logo.png",
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": {
        "max_images": 5
    },
    "response_format": "url",
    "size": "2K",
    "stream": true,
    "watermark": true
}'
```

**关键点**：
- `image` 单个 URL + `sequential_image_generation: "auto"` → 基于参考图批量生成
- `max_images: 5` → 最多 5 张

### 4.5 多图参考生单图（Multiple Images → Single Image）

多张参考图 + 提示词，融合生成一张新图。

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "ep-20260214085933-kv5kj",
    "prompt": "将图1的服装换为图2的服装",
    "image": [
      "https://example.com/person.png",
      "https://example.com/outfit.png"
    ],
    "sequential_image_generation": "disabled",
    "response_format": "url",
    "size": "2K",
    "stream": false,
    "watermark": true
}'
```

**关键点**：
- `image` 传 URL 数组 → 多图参考
- prompt 中用「图1」「图2」引用对应位置的图片
- `sequential_image_generation: "disabled"` → 输出单张

### 4.6 多图参考生一组图（Multiple Images → Multiple Images）

多张参考图 + 提示词，生成一组连贯图。

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "ep-20260214085933-kv5kj",
    "prompt": "生成3张女孩和奶牛玩偶在游乐园开心地坐过山车的图片...",
    "image": [
      "https://example.com/girl.png",
      "https://example.com/cow_toy.png"
    ],
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": {
        "max_images": 3
    },
    "response_format": "url",
    "size": "2K",
    "stream": true,
    "watermark": true
}'
```

**关键点**：
- `image` 数组 + `sequential_image_generation: "auto"` → 多图参考 + 连贯序列
- 可同时保持多图的角色一致性 + 生成连贯变化

---

## 五、模式决策矩阵

根据两个维度快速选择参数组合：

|  | 无参考图 | 单张参考图 | 多张参考图 |
|--|---------|-----------|-----------|
| **生成单张** | `sequential: disabled` | `image: "url"` + `sequential: disabled` | `image: ["url1", "url2"]` + `sequential: disabled` |
| **生成多张** | `sequential: auto` + `max_images: N` | `image: "url"` + `sequential: auto` + `max_images: N` | `image: ["url1", "url2"]` + `sequential: auto` + `max_images: N` |

> **`stream` 建议**：生成单张用 `false`，生成多张用 `true`（逐张返回，体验更好）。

---

## 六、响应格式

### 6.1 非流式响应（`stream: false`）

```json
{
  "created": 1739512773,
  "data": [
    {
      "url": "https://...",
      "content_filter": []
    }
  ],
  "model": "ep-20260214085933-kv5kj",
  "object": "list"
}
```

### 6.2 流式响应（`stream: true`）

生成多图时，以 SSE（Server-Sent Events）逐张返回：

```
data: {"created":1739512773,"data":[{"url":"https://...","index":0}],"model":"ep-...","object":"list"}

data: {"created":1739512780,"data":[{"url":"https://...","index":1}],"model":"ep-...","object":"list"}

data: [DONE]
```

---

## 七、后端集成指引

### 7.1 配置项（`backend/app/config.py`）

```python
# 已有配置
volcengine_ark_api_key: str = ""           # 火山方舟 API Key（与 LLM 共用）

# 需要新增
doubao_image_model_endpoint: str = "ep-20260214085933-kv5kj"  # Seedream 4.0 生图模型
```

### 7.2 Service 层接口设计建议

```python
# backend/app/services/doubao_image_service.py

class DoubaoImageService:
    """豆包 Seedream 4.0 图像生成服务"""

    BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

    async def generate_image(
        self,
        prompt: str,
        *,
        image: str | list[str] | None = None,
        sequential: bool = False,
        max_images: int = 1,
        size: str = "2K",
        watermark: bool = True,
    ) -> dict:
        """
        统一入口，通过参数组合覆盖全部 6 种模式：
        - prompt only → 文生图
        - prompt + image(str) → 单图生图
        - prompt + image(list) → 多图参考生图
        - sequential=True + max_images → 生成一组连贯图
        """
        ...
```

### 7.3 Celery 任务映射（待实现）

| 功能 | 建议 Celery 任务 |
|------|-----------------|
| 文生图 / 图生图 | `tasks.doubao_image.process_doubao_image_generation` |

---

## 八、与 Kling 生图能力对比

| 维度 | Doubao Seedream 4.0 | Kling Image |
|------|-------------------|-------------|
| 端点 | `/api/v3/images/generations` | `/v1/images/generations` |
| 鉴权 | Bearer Token | JWT (HMAC-SHA256) |
| 多图参考 | ✅ `image` 数组 | ✅ `image_list` |
| 连贯序列生成 | ✅ `sequential_image_generation` | ❌ 无 |
| 流式返回 | ✅ SSE | ❌ 轮询 |
| 分辨率 | 2K | 1024×1024 等 |
| 异步/同步 | 同步返回（单张）/ 流式（多张） | 异步任务 + 轮询 |

---

## 九、Prompt 最佳实践

1. **描述尽量详细**：包含主体、场景、风格、光影、镜头语言（如"广角透视""景深""动态模糊"）
2. **多图参考时明确引用**：prompt 中用「图1」「图2」指代 `image` 数组中对应位置的图片
3. **连贯序列提示**：在 prompt 中说明总张数和变化维度（如"四季变迁""早中晚"），模型会自动保持风格一致性
4. **负面描述**：目前 API 无 `negative_prompt` 参数，通过 prompt 正面描述来控制

---

## 十、注意事项

- `model` 参数为火山方舟的**推理接入点 ID**（`ep-` 前缀），不是模型名称。不同账户的 endpoint ID 不同
- 当 `sequential_image_generation: "auto"` 时，模型**可能**返回少于 `max_images` 的图片数量
- 流式模式下需处理 SSE 解析，最后一条消息为 `data: [DONE]`
- `image` URL 需要公网可访问。如果是 Supabase Storage 的文件，确保使用公开链接或签名 URL
