# 数字人形象系统 PRD v1.0

> 产品：HoppingRabbit AI · Visual Editor  
> 日期：2026-02-12  
> 状态：Draft

---

## 一、市场调研与方向验证

### 1.1 竞品分析

| 维度 | HeyGen | Synthesia | D-ID | **HoppingRabbit（当前）** |
|------|--------|-----------|------|--------------------------|
| **创建方式** | ①上传照片 ②录制视频 ③AI设计 ④预设库 | ①上传照片+录制视频 ②预设库 | ①上传照片 ②预设库 | ①上传照片 ②AI生成 |
| **核心价值** | 创建一次→所有视频保持同一个人 | 创建一次→多语言视频 | 照片驱动说话 | ⚠️ 创建后未接入生成链路 |
| **人物一致性** | Avatar IV: 1张照片→一致性视频 | Personal Avatar: 高保真克隆 | Face reference 驱动 | ❌ 完全缺失 |
| **声音绑定** | 声音克隆→角色绑定 | 声音克隆→角色绑定 | 多语言TTS | ⚠️ 有字段但未接入 |
| **生成场景** | 脚本→数字人播报视频 | 脚本→数字人播报视频 | 照片→说话视频 | ⚠️ 仅智能播报，未接入Visual Editor |
| **换装/换景** | Look Packs换装 | 可定制环境+服装 | 品牌背景定制 | ❌ 无 |

### 1.2 关键洞察

**行业共识**：所有头部产品的数字人核心价值都是 **"创建一次，复用到所有内容生成中"**。

**HeyGen 的演进路径验证了我们的方向**：
- 早期：只有预设 Stock Avatar
- 中期：加入 Photo Avatar（1张照片→角色）← **我们正在这里**
- 现在：Avatar IV（照片→全身动作视频）+ Digital Twin（高保真克隆）

**我们的差异化机会**：
- HeyGen/Synthesia 定位在"播报类"视频（说话的数字人）
- 我们的 Visual Editor 做的是**创意类视频**（场景化、叙事化）
- 数字人 + Visual Editor = **"用你的脸/角色讲故事"** ← 这是竞品没做的

### 1.3 方向验证结论

| 判断项 | 结论 |
|--------|------|
| 双入口（上传照片 + AI生成） | ✅ 正确 — HeyGen 也有 Upload Photo + Design with AI 两个入口 |
| AI生成虚拟人像 | ✅ 有价值 — 适合不想露脸的创作者、品牌虚拟IP |
| 声音绑定 | ✅ 正确方向 — 所有竞品都做了声音克隆绑定 |
| 数字人接入生成链路 | 🔴 **当前完全缺失 — 这是第一优先级** |

---

## 二、产品定位

### 一句话定义

> 数字人 = 用户的 **AI 角色身份**，贯穿 Visual Editor 所有生成场景，确保人物一致性。

### 与竞品的差异

| 竞品 | 数字人用途 |
|------|----------|
| HeyGen/Synthesia | 数字人 **说话**（播报、培训、营销视频） |
| **HoppingRabbit** | 数字人 **出演**（场景化创意视频、故事化内容） |

我们不只是"让数字人读稿子"，而是"让数字人成为视频里的主角"。

---

## 三、用户场景

### 场景 A：真人创作者（上传照片）
> "我是个博主，想做AI视频但不想每次都拍。我上传一张照片，之后所有AI生成的视频里都是我。"

### 场景 B：品牌虚拟IP（AI生成）
> "我们公司想做一个虚拟代言人。用AI生成一个形象，然后在所有营销视频里统一使用。"

### 场景 C：内容系列制作
> "我做一个5集的短剧，每集的主角都要是同一个人。"

---

## 四、功能规划

### 4.1 第一期：打通核心链路（P0 · 1-2天）

**目标**：让数字人在 Visual Editor 的 AI 生成中真正发挥作用

#### 4.1.1 Visual Editor 集成

**入口位置**：GenerationComposerModal（生成面板）

```
┌─────────────────────────────────────────────┐
│ ✨ AI 生成                                   │
│                                             │
│ 🎭 角色形象                                  │
│ ┌──────────────────────────────────────────┐ │
│ │ [头像] 小美          ▼  [✕ 不使用角色]    │ │
│ └──────────────────────────────────────────┘ │
│                                             │
│ 📝 提示词                                    │
│ ┌──────────────────────────────────────────┐ │
│ │ 一个女孩走在东京涩谷的街头，樱花飘落...     │ │
│ └──────────────────────────────────────────┘ │
│                                             │
│ ⚙️ 参数                                     │
│   分辨率: 1080p    时长: 5s                   │
│                                             │
│          [ ✨ 生成视频 ]                      │
└─────────────────────────────────────────────┘
```

**技术实现**：

1. **前端 GenerationComposerModal** 新增"选择数字人"下拉
   - 数据源：`GET /api/v2/avatars?status=draft` （用户自己的）
   - 选中后在 state 中记录 `selectedAvatarId` 和 `avatarPortraitUrl`

2. **提交生成时传入 face reference**
   - 适用能力：`text_to_video`、`image_to_video`、`image_generation`、`omni_image`
   - 参数映射：

   | 生成能力 | Kling 参数 | 值 |
   |---------|-----------|-----|
   | 文生图 | `image` | avatar.portrait_url |
   | 文生图 | `image_reference` | `"face"` |
   | 文生图 | `human_fidelity` | 0.75（默认，可调） |
   | 文生视频 | `image` | avatar.portrait_url |
   | 文生视频 | `image_reference` | `"face"` |
   | 图生视频 | 不变（用户已有参考图） | — |

3. **后端适配**
   - `/api/kling/image-generation` 和 `/api/kling/text-to-video` 已支持 `image` + `image_reference` 参数
   - 新增：如果传入 `avatar_id`，自动查库获取 `portrait_url` 注入（安全校验）

#### 4.1.2 API 变更

```
POST /api/kling/image-generation
{
  "prompt": "...",
  "avatar_id": "uuid",        // 🆕 可选，传入后自动带入 face reference
  "aspect_ratio": "16:9",
  ...
}
```

后端逻辑：
```python
if request.avatar_id:
    avatar = get_avatar(request.avatar_id, user_id)
    request.image = avatar["portrait_url"]
    request.image_reference = "face"
    if not request.human_fidelity:
        request.human_fidelity = 0.75
```

#### 4.1.3 前端交互细节

- 默认不选择任何角色（"不使用角色"状态）
- 选择角色后，显示头像缩略图 + 名称
- 如果当前能力不支持 face reference（如 lip_sync、video_extend），角色选择器灰置
- 记住用户上次选择的角色（localStorage）

**支持 face reference 的能力列表**（已验证 Kling API 实际支持情况）：

| 能力 | 支持 | 备注 |
|------|------|------|
| image_generation | ✅ | 核心场景，通过 `image_reference: "face"` 注入 |
| omni_image | ✅ | 多元素合成，通过 `image_list` 中追加 face 参考 |
| text_to_video | ❌ | Kling API 不支持 `image_reference` 参数 |
| image_to_video | ❌ | Kling API 不支持 `image_reference` 参数 |
| multi_image_to_video | ❌ | 不支持 |
| face_swap | ❌ | 本身就是换脸 |
| lip_sync | ❌ | 对口型，不涉及人物生成 |
| video_extend | ❌ | 视频续写 |
| motion_control | ❌ | 动作控制 |
| skin_enhance / relight / outfit_swap / ai_stylist / outfit_shot | ❌ | 后处理类 |

> ⚠️ **实际验证说明**：Kling API 的 `text2video` 和 `image2video` 端点 **不支持** `image_reference` 参数，因此角色一致性保持仅在图像生成类能力（`image_generation`、`omni_image`）中生效。

---

### 4.2 第二期：角色创建增强（P1）

#### 4.2.0 上传照片 → AI 确认肖像（🆕 待实现）

**当前问题**：用户上传照片后直接作为数字人头像使用，但系统后续生成内容时依赖 AI 对人物特征的理解（face reference）。如果 AI 理解有偏差（丢失眼镜、发型细节、肤色偏移），用户在看到最终生成结果时才发现"不像自己"，体验很差且浪费积分。

**核心洞察**：用户上传照片的真正目的不是"存一张图"，而是"让 AI 认识我"。因此需要在创建阶段就让用户验证 AI 是否正确理解了自己的外貌特征。

**方案：上传后 AI 生成 4 张白底增强肖像，用户选 1 张确认**

```
用户上传照片
    ↓
AI 基于照片生成 4 张白底标准化肖像（正面，干净白底，保留核心特征）
    ↓
展示给用户："这是 AI 理解的你，选择一张最像你的"
    ├── ✅ 选 1 张 → 该图作为主肖像（portrait_url）→ 后台静默生成多角度参考图
    ├── 🔄 都不像 → "重新生成" / "重新上传照片"
    └── 💬 细节反馈（可选）→ "眼镜没了" "发型不对" → 带反馈重新生成
```

**交互流程**：

```
┌───────────────────────────────────────────────┐
│ 📷 上传照片 · 创建数字人                         │
│                                               │
│ Step 1: 上传你的照片                             │
│ ┌─────────────────────────────────────────┐    │
│ │  [📷 点击上传清晰正脸照片]                │    │
│ │  支持 JPG/PNG，建议正面、光线充足           │    │
│ └─────────────────────────────────────────┘    │
│                                               │
│ Step 2: 确认你的数字人形象                       │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐                   │
│ │ 📷 │ │ 📷 │ │ 📷 │ │ 📷 │ ← AI 生成的 4 张  │
│ │ ✓  │ │    │ │    │ │    │   白底增强肖像      │
│ └────┘ └────┘ └────┘ └────┘                   │
│ "选择一张最像你的作为数字人形象"                   │
│                                               │
│ [😕 都不太像？重新生成]  [📝 哪里不像？告诉我]     │
│                                               │
│ Step 3: 给你的数字人起个名字                     │
│ ┌─────────────────────────────────────────┐    │
│ │ 小美                                    │    │
│ └─────────────────────────────────────────┘    │
│                                               │
│              [ ✨ 创建数字人 ]                   │
└───────────────────────────────────────────────┘
```

**技术要点**：

1. **生成 prompt 设计**：
   - 以用户上传照片作为 `image`，`image_reference: "subject"`
   - prompt: `"professional portrait photo, clean white background, front-facing, natural expression, studio lighting, high quality"`
   - `image_fidelity: 0.85`（较高，确保像本人）
   - `human_fidelity: 0.85`
   - 生成 4 张（`n: 4` 或 4 次独立请求），通过微调 prompt 变体（微笑/自然/自信/柔和）产生差异

2. **用户选择的那张成为 `portrait_url`**：
   - 替代用户原始上传照片（因为 AI 增强版在白底下更适合作为 face reference 基准）
   - 原始上传照片保留在 `reference_images` 中作为参考

3. **反馈机制（可选 MVP 后迭代）**：
   - 用户可勾选"哪里不像"：眼镜 / 发型 / 肤色 / 五官 / 体型
   - 将反馈作为负面约束注入 prompt 重新生成

4. **积分策略**：
   - 创建数字人的这 4 张确认肖像 **免费**（属于创建成本，不单独计费）
   - "重新生成"也免费（限制次数，如最多 3 次）

**与现有流程的关系**：
- 此步骤插入在"上传照片"之后、"填写名字并保存"之前
- "AI 生成"入口不需要此步骤（已有选图流程）
- 后台多角度生成（`avatar_reference_angles.py`）逻辑不变，只是触发时机从"上传原图后"变为"用户确认肖像后"

#### 4.2.1 AI 生成优化（✅ 已完成）

**当前问题**：AI 生成 4 张图是"随机抽卡"，不可控。

**改进（已实现）**：

1. **引导式生成**（替代纯文本 prompt）✅
   - 支持"引导式生成"和"自由描述"两种子模式切换
   - 引导式表单：性别（3选1按钮）、年龄段（5选1）、面孔类型（7选1）、穿搭风格（6选1）、表情（6选1）+ 补充描述
   - 自动合成高质量 Kling prompt，支持实时预览
   ```
   ┌─────────────────────────────────┐
   │ 📷 AI 生成人像                    │
   │ [✨ 引导式生成] [📝 自由描述]      │
   │                                 │
   │ 性别:  [👩 女性] [👨 男性] [🧑 中性] │
   │ 年龄段: [青年 (20-30) ▼]          │
   │ 面孔:  [东亚面孔 ▼]               │
   │ 风格:  [职业正装] [休闲日常] ...    │
   │ 表情:  [😊 温暖微笑] [😌 自信] ... │
   │                                 │
   │ 补充描述（可选）:                   │
   │ ┌─────────────────────────────┐  │
   │ │ 戴眼镜，短发，背景为办公室    │  │
   │ └─────────────────────────────┘  │
   │ ▸ 查看生成的 Prompt               │
   │   [ ✨ 生成人像 (4 张) ]           │
   └─────────────────────────────────┘
   ```

2. **基于选中图的变体生成** ✅
   - 选中 1 张后，显示"🔄 再来 4 张类似的 (基于选中图)"按钮
   - 技术：将选中图作为 `image` + `image_reference: "subject"` + `image_fidelity: 0.7` 重新生成
   - 新生成的变体追加到候选列表（不替换现有的）
   - 确保人物特征一致，只变化表情/角度/背景

3. **角色特征自动存储** ✅
   - 引导式生成的选择（gender, age_range, ethnicity, style）直接存入数据库字段
   - `CreateAvatarRequest` 类型已扩展支持这些字段
   - 后端 `digital_avatar_service.create_avatar()` 已支持这些字段

#### 4.2.2 角色风格预设

在数字人创建时增加持久属性：

```json
{
  "character_traits": {
    "gender": "female",
    "age_range": "25-30",
    "hair": "黑色长直发",
    "skin_tone": "东亚肤色",
    "distinguishing_features": "圆脸，单眼皮"
  },
  "style_presets": {
    "default_outfit": "职业装",
    "default_scene": "办公室/会议室",
    "mood": "专业、亲切"
  }
}
```

这些属性在生成时自动拼入 prompt：
```
原始 prompt: "一个人在咖啡馆喝咖啡"
增强后 prompt: "一位25-30岁的东亚女性，黑色长直发，圆脸，穿着职业装，在咖啡馆喝咖啡"
```

---

### 4.3 第三期：声音闭环 + 生态（P2 · 后续）

#### 4.3.1 声音绑定

- 数字人绑定 `default_voice_id`
- Visual Editor 中使用 TTS/配音时，自动匹配角色声音
- 支持声音试听和更换

#### 4.3.2 角色作品集

- 角色详情页展示"使用该角色生成的所有内容"
- 技术：`tasks` 表增加 `avatar_id` 字段，生成时记录

#### 4.3.3 角色市场

- 用户可以发布自己创建的虚拟角色
- 其他用户可以使用（按次计费/免费）
- `digital_avatar_templates` 表的 `status: published` 已支持

---

## 五、数据架构

### 5.1 现有表（无需修改）

```sql
-- digital_avatar_templates 表已有的关键字段
portrait_url    TEXT NOT NULL   -- 人像照片 URL（作为 face reference）
portrait_prompt TEXT            -- 生成该人像的 prompt
default_voice_id TEXT           -- 默认音色
generation_config JSONB         -- 生成参数配置
status          TEXT            -- draft/published/archived
created_by      UUID            -- 用户 ID
```

### 5.2 需要扩展的字段

```sql
-- 第一期无需改表

-- 第二期扩展
ALTER TABLE digital_avatar_templates
  ADD COLUMN IF NOT EXISTS character_traits JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS style_presets JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'upload'
    CHECK (source_type IN ('upload', 'ai_generated'));

-- 第三期扩展
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS avatar_id UUID REFERENCES digital_avatar_templates(id);
```

---

## 六、第一期技术实现方案

### 6.1 前端改动

| 文件 | 改动 |
|------|------|
| `GenerationComposerModal.tsx` | 新增 AvatarSelector 组件，选择角色后记录 `selectedAvatarId` + `avatarPortraitUrl` |
| `GenerationComposerModal.tsx` | `handleSubmit` 中，对支持的能力类型注入 `avatar_id` 参数 |
| `rabbit-hole-api.ts` | 各生成 API 调用增加可选 `avatar_id` 参数 |

### 6.2 后端改动

| 文件 | 改动 |
|------|------|
| `kling.py` | ImageGenerationRequest / TextToVideoRequest 增加可选 `avatar_id` 字段 |
| `kling.py` | 各生成端点中，如果传入 `avatar_id`，查库获取 `portrait_url`，自动注入 `image` + `image_reference: "face"` |
| `image_generation.py` | Celery 任务中透传 face reference 参数 |

### 6.3 不需要改动的

- 数据库 schema（第一期）
- Kling API 调用层（`kling_ai_service.py` 已支持 `image_reference` + `human_fidelity`）
- 数字人创建流程（保持现有双入口）

---

## 七、成功指标

### 第一期

| 指标 | 目标 |
|------|------|
| 角色选择器使用率 | > 30% 的生成任务带角色 |
| 人物一致性提升 | 用户反馈主观评价 |
| 数字人创建→使用转化 | > 50% 创建的角色被用于生成 |

### 长期

| 指标 | 目标 |
|------|------|
| 数字人使用留存 | 创建角色后7日内再次使用率 > 40% |
| 付费转化 | 角色一致性功能成为付费驱动力 |

---

## 八、优先级总结

```
P0 - 第一期 ✅ 已完成
  └── Visual Editor GenerationComposerModal 增加"选择数字人" ✅
  └── 生成时自动传入 face reference ✅
  └── 后端 avatar_id → portrait_url → image + image_reference: "face" ✅
  └── 实际验证: 仅 image_generation 和 omni_image 支持 face reference

P1 - 第二期
  └── 🆕 上传照片 → AI 生成 4 张白底增强肖像 → 用户选 1 张确认（待实现）
  └── 引导式 AI 生成（性别/年龄/面孔/风格/表情 结构化表单 + 自由描述双模式）✅
  └── 基于选中图的变体生成（image_reference: "subject"）✅
  └── 角色属性存储（gender, age_range, ethnicity, style 入库）✅

P2 - 第三期（后续）
  └── 声音绑定 + TTS 联动
  └── 角色作品集
  └── 角色市场
```

---

## 九、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 上传后 AI 确认肖像等待时间 | 用户需等待 4 张图生成（约 15-30s） | 生成过程展示 loading 动画 + 进度提示；4 张并行生成缩短时间 |
| AI 增强肖像与本人差异过大 | 用户反复"不像"，流失 | `image_fidelity` 设置 0.85+；限制 prompt 变化幅度；提供反馈通道修正 |
| 免费生成被滥用 | 积分成本增加 | 限制重新生成次数（3 次/角色）；超出后消耗积分 |
| Kling face reference 一致性不够高 | 用户体验不达预期 | 调高 `human_fidelity` 到 0.8+，同时通过 prompt 注入角色特征补充 |
| AI 生成的虚拟人 face reference 效果差 | 虚拟角色场景失效 | 建议用户用清晰正面照，AI 生成时引导正面半身照 |
| 生成时间增加（多了 face reference） | 用户等待变长 | face reference 不会显著增加生成时间（Kling 官方确认） |
| 积分消耗增加（图生图 vs 文生图） | 用户成本上升 | 明确告知用户，角色一致性是增值功能 |
