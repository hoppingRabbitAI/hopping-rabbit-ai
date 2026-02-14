# 模板系统完整设计

> **合并自**：TEMPLATE_INGEST_AND_RENDER_WORKFLOW / TRANSITION_TEMPLATE_V1_SPEC / TEMPLATE_PUBLISH_SYSTEM / TEMPLATE_TODO
>
> 覆盖：模板采集 → 审核发布 → 用户渲染 → 转场模板规格 → Golden Fingerprint

---

## 一、系统概览

```
Benchmark 视频上传 → Ingest 分析 → template_records (status=draft)
                                          │
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
              ⚙️ 配参数           🎬 试渲染             📋 预览
              publish_config      preview_render         模板信息
                     │                    │
                     │           ┌────────┴────────┐
                     │           ▼                 ▼
                     │       ✅ 效果好          ❌ 效果差
                     │       ⭐ featured         调参重试
                     ▼           ▼
              ┌─────────────────────────────┐
              │  管理员点击「发布」            │
              │  status → published          │
              │  quality_label = golden      │
              └──────────────┬──────────────┘
                             ▼
              ┌─────────────────────────────┐
              │  用户模板库（仅 published）    │
              │  查看效果预览 → 渲染          │
              └─────────────────────────────┘
```

---

## 二、数据模型

### 2.1 template_ingest_jobs

记录采集任务状态、参数、结果与错误。

### 2.2 template_records

模板本体，包含展示资产、workflow、标签、发布信息：

```sql
-- 核心字段
template_id TEXT PRIMARY KEY,
url TEXT,                          -- 模板图片 URL
thumbnail_url TEXT,                -- 缩略图
workflow JSONB,                    -- Agent 配方（见 §4）
tags TEXT[],
category TEXT,                     -- 'ad' / 'transition' 等
type TEXT,                         -- 'background' / 'transition'

-- 发布系统字段（§6）
status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
published_at TIMESTAMPTZ,
publish_config JSONB DEFAULT '{}',
preview_video_url TEXT,
quality_label TEXT DEFAULT 'unrated'
    CHECK (quality_label IN ('unrated', 'golden', 'good', 'average', 'poor')),
admin_notes TEXT,

-- 指纹（§8）
metadata JSONB                     -- 含 golden_fingerprint
```

### 2.3 template_preview_renders（试渲染表）

```sql
CREATE TABLE template_preview_renders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id TEXT NOT NULL REFERENCES template_records(template_id),
    task_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    video_url TEXT,
    thumbnail_url TEXT,
    render_params JSONB DEFAULT '{}',
    is_featured BOOLEAN DEFAULT FALSE,
    admin_rating INTEGER CHECK (admin_rating BETWEEN 1 AND 5),
    admin_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.4 publish_config 结构

```jsonc
{
  "default_focus_modes": ["outfit_change"],
  "default_golden_preset": "spin_occlusion_outfit",
  "default_duration": "5",
  "default_mode": "pro",
  "default_cfg_scale": 0.7,
  "default_boundary_ms": 480,
  "default_variant_count": 3,
  "allowed_focus_modes": ["outfit_change", "subject_preserve", "scene_shift"],
  "duration_range": ["5", "10"],
  "cfg_scale_range": [0.3, 1.0],
  "display_name": "旋转遮挡换装",
  "description": "适合全身换装场景",
  "best_for": ["outfit_change"],
  "preview_task_ids": ["task-abc123"]
}
```

---

## 三、Ingest 流程（采集入口）

### 3.1 API

**创建任务** `POST /api/templates/ingest`
```json
{
  "source_url": "https://xxx/video.mp4",
  "source_type": "video",
  "template_type": "ad",
  "extract_frames": 8,
  "clip_ranges": [
    {"start": 1.5, "end": 4.2},
    {"start_ms": 9000, "end_ms": 13000}
  ],
  "tags_hint": ["广告", "科技感"],
  "metadata": { "scopes": ["visual-studio"] }
}
```

**查询任务** `GET /api/templates/ingest/{job_id}`

### 3.2 内部流程

1. 下载素材（image/zip/video）
2. 抽帧（video）— 支持 `clip_ranges` 限定区间，按区间时长加权分配帧数
3. 生成模板图片 + 缩略图
4. 生成 workflow（LangChain + fallback）
5. 上传 Supabase Storage
6. 写入 `template_records`（**status=draft**）

环境变量控制：
- `ENABLE_TEMPLATE_WORKFLOW_LLM=true|false`
- `ENABLE_TEMPLATE_RANKING_LLM=true|false`

---

## 四、Workflow 字段规范

```json
{
  "kling_endpoint": "image_to_video",
  "prompt_seed": "广告模板，产品质感清晰，光线高级",
  "negative_prompt": "low quality, blurry, watermark",
  "duration": "5",
  "model_name": "kling-v2-1-master",
  "cfg_scale": 0.5,
  "mode": "std",
  "shot_type": "medium",
  "camera_move": "push",
  "transition": "none",
  "pacing": "medium",
  "style": { "color": "cool", "light": "soft" },
  "camera_control": {}
}
```

- **kling_endpoint**：决定调用哪个 Kling API
- **prompt_seed**：模板风格引导
- **camera_move/transition**：自动映射为 `camera_control`（simple 模式）

---

## 五、模板渲染 API

### 5.1 普通渲染

`POST /api/templates/{template_id}/render`
```json
{
  "prompt": "科技感产品广告",
  "duration": "5",
  "clip_id": "clip-xxxx",
  "write_clip_metadata": true,
  "overrides": { "kling_endpoint": "image_to_video" }
}
```

支持的 endpoint 映射：
| endpoint | 说明 | 输入要求 |
|----------|------|----------|
| `image_to_video` | 图生视频 | 默认用模板 url |
| `text_to_video` | 文生视频 | 无需模板图 |
| `multi_image_to_video` | 多图转场 | ≥2 张图 |
| `motion_control` | 动作控制 | 需 video_url |

### 5.2 两图复刻转场

`POST /api/templates/{template_id}/replicate`
```json
{
  "from_image_url": "https://.../from.jpg",
  "to_image_url": "https://.../to.jpg",
  "focus_mode": "outfit_change",
  "variant_count": 3,
  "boundary_ms": 480,
  "quality_tier": "template_match"
}
```

- 仅支持 `type=transition` 模板
- 自动走 `multi_image_to_video`
- 一次创建 `variant_count` 条候选任务
- `focus_mode`：`outfit_change` / `subject_preserve` / `scene_shift`

### 5.3 多模板候选

`POST /api/templates/candidates`
```json
{
  "category": "ad",
  "template_kind": "background",
  "scope": "visual-studio",
  "limit": 3,
  "prompt": "科技感产品广告",
  "auto_render": false
}
```

`auto_render=true` 时直接触发渲染。

### 5.4 渲染参数合并逻辑

当模板有 `publish_config` 时，渲染接口按如下优先级合并：

```
用户请求参数 > publish_config 默认值 > workflow 原始参数
```

---

## 六、预发布系统

### 6.1 核心目标

模板不再一入库就对用户可见，增加 draft → published 审核流程。

### 6.2 管理员 API

| 方法 | 路径 | 用途 |
|------|------|------|
| `PATCH` | `/api/templates/{id}/status` | 发布/下架/归档 |
| `PUT` | `/api/templates/{id}/publish-config` | 更新发布配置 |
| `PUT` | `/api/templates/{id}/quality-label` | 设置质量标签 |
| `GET` | `/api/templates/{id}/preview-renders` | 试渲染列表 |
| `POST` | `/api/templates/{id}/preview-render` | 创建试渲染 |
| `PATCH` | `/api/templates/{id}/preview-renders/{rid}` | 标记 featured |

### 6.3 用户侧变更

- `GET /api/templates` 默认过滤 `status=published`
- 模板卡片展示 `preview_video_url` 预览视频
- 渲染时读取 `publish_config` 默认值填入表单

### 6.4 前端结构

```
PlatformMaterialsView
├── Tab: 📋 预发布 (draft) ← 管理员
│   └── TemplatePublishPanel（参数配置 + 试渲染 + 效果预览）
├── Tab: ✅ 已发布 (published)
└── Tab: 📦 已归档 (archived)
```

### 6.5 管理员操作流程

```
1. Ingest 生成 draft 模板
2. 预发布 Tab 查看
3. 试渲染 → 预览效果
   ├── 效果好 → ⭐ 标为主预览 → 标 golden
   └── 效果差 → 调参 → 重试
4. 配置发布参数
5. 发布 → status=published → 用户可见
```

---

## 七、转场模板规格（Transition Template V1）

### 7.1 架构

转场模板采用 **确定层 + AI 层** 双层架构：

| 层 | 职责 | 技术 |
|----|------|------|
| **确定层** | 时序骨架、遮挡窗口、入/出动画曲线 | Remotion / FFmpeg |
| **AI 层** | 中间帧生成（换装/身份保持） | Kling multi_image_to_video |

### 7.2 transition_spec V1 JSON Schema

```jsonc
{
  "version": "1.0",
  "family": "whip_pan",           // whip_pan/zoom_blur/flash_cut/glitch/spin/luma_wipe
  "duration_ms": 800,
  "timing": {
    "occlusion_start": 0.30,      // 遮挡开始（归一化 0-1）
    "occlusion_end": 0.70,        // 遮挡结束
    "peak": 0.50                  // 最大模糊/运动点
  },
  "curves": {
    "blur": "ease_in_out",
    "motion": "ease_in",
    "opacity_a": "linear_fade",
    "opacity_b": "linear_fade"
  },
  "effect_graph": [
    { "type": "motion_blur", "axis": "x", "max_px": 120 },
    { "type": "gaussian_blur", "max_sigma": 15 }
  ],
  "asset_pack": {
    "overlay": null,
    "lut": null
  }
}
```

### 7.3 V1 支持的 6 种转场族

| family | 说明 | 遮挡机制 |
|--------|------|----------|
| `whip_pan` | 横向快甩 | 方向运动模糊 |
| `zoom_blur` | 推拉变焦 | 径向模糊 |
| `flash_cut` | 闪白/闪黑 | 高斯 + 亮度 |
| `glitch` | 故障风 | RGB 位移 + 扫描线 |
| `spin` | 旋转 | 旋转运动模糊 |
| `luma_wipe` | 亮度擦除 | 亮度 mask |

### 7.4 多转场检测 Pipeline

单个 Benchmark 视频可能包含多段转场：

```
视频帧序列 → 运动强度曲线 → 峰值检测 → 切分 → 逐段生成 transition_spec
```

检测指标：帧间光流 magnitude + Laplacian variance（模糊度）。

### 7.5 与 Ingest 集成

Ingest 产出 `type=transition` 模板时，`metadata.transition_spec` 存储上述 JSON。Render/Replicate API 读取 spec 参数指导 Kling 生成。

---

## 八、Golden Template Fingerprint 系统

> 前置依赖：预发布系统（§6）完成，积累试渲染 + 评分数据。

### 8.1 目标

新 Benchmark 上传后，系统自动判断模板质量潜力、自动预填最佳参数，减少管理员手动试渲染。

### 8.2 三层架构

```
指纹提取层 → 质量预测层 → 自动配置层
```

#### 第 1 层：指纹提取（Ingest 时自动）

在 `_analyze_transition_frames` LLM 多帧分析基础上扩展：

```jsonc
// metadata.golden_fingerprint
{
  "version": "v1",
  "source": "llm",
  "occlusion_effectiveness": "high",     // high/medium/low
  "occlusion_type": "motion_blur",       // motion_blur/spin_occlusion/flash/...
  "swap_point_visibility": "hidden",     // hidden/partially_visible/visible
  "motion_intensity": "strong",          // strong/medium/weak
  "motion_direction": "rotational",      // horizontal/vertical/radial/rotational
  "motion_rhythm": "ease_in_out",
  "recommended_for": ["outfit_change"],
  "color_tone_coherence": "high",
  "identity_preservation_difficulty": "low",
  "dimension_scores": {
    "outfit_change": 0.9,
    "subject_preserve": 0.8,
    "scene_shift": 0.3
  }
}
```

可选 CV 增强：`blur_curve_peak`、`optical_flow_magnitude`、`structural_similarity` 等 OpenCV 帧级指标。

#### 第 2 层：Golden Profile 构建

从标注了 `golden`/`good` 的已发布模板中聚合统计画像：

```python
GOLDEN_PROFILES = {
    "outfit_change_spin": {
        "name": "旋转遮挡换装",
        "match_criteria": {
            "occlusion_effectiveness": ["high"],
            "occlusion_type": ["spin_occlusion", "motion_blur"],
            "motion_intensity": ["strong"],
            "motion_direction": ["rotational"],
        },
        "recommended_config": {
            "focus_modes": ["outfit_change"],
            "golden_preset": "spin_occlusion_outfit",
            "cfg_scale": 0.7,
            "boundary_ms": 480,
        },
        "sample_count": 12,
        "avg_admin_rating": 4.5,
    },
}
```

每 N 个新标注触发 profile 重计算，或管理员手动触发。

#### 第 3 层：自动匹配 + 预填

```
新模板 Ingest → 提取 fingerprint → 遍历 profiles 计算匹配度(0-1)
  ≥0.8: 自动预填 publish_config + 预标 quality_label=good
  0.5-0.8: 预填部分参数，标记需人工确认
  <0.5: 不预填，可能是新类型
```

匹配权重：occlusion_effectiveness(0.25) > swap_point_visibility(0.20) > motion_intensity(0.15) > occlusion_type(0.15) > motion_direction(0.10) > recommended_for(0.10) > color_tone_coherence(0.05)

### 8.3 API

| 方法 | 路径 | 用途 |
|------|------|------|
| `POST` | `/api/templates/{id}/extract-fingerprint` | 手动触发指纹提取 |
| `GET` | `/api/templates/golden-profiles` | 查看所有 profile |
| `POST` | `/api/templates/golden-profiles/rebuild` | 重建 profile |
| `GET` | `/api/templates/{id}/fingerprint-match` | 匹配详情 |

### 8.4 后端服务

```python
# backend/app/services/golden_fingerprint_service.py
class GoldenFingerprintService:
    def extract_fingerprint(self, template_record, transition_frames) -> Dict
    def match_profile(self, fingerprint) -> Tuple[str, float, Dict]
    def auto_fill_publish_config(self, template_id, fingerprint) -> Dict
    def rebuild_profiles(self) -> Dict
```

---

## 九、实施路线图

### Phase 1：基础发布流程（~1天）
- DB Migration：status / published_at / quality_label / publish_config
- Ingest 产出 status=draft
- `PATCH /templates/{id}/status` 发布/下架
- 前端 Tab 切换 + 发布按钮

### Phase 2：试渲染 + 参数调优（~2-3天）
- template_preview_renders 表
- 试渲染接口 + 结果列表
- TemplatePublishPanel 弹窗

### Phase 3：用户侧体验优化（~2天）
- 效果预览视频展示
- publish_config 填充默认值
- 参数微调 UI

### Phase 4a：指纹提取 + Profile（~2-3天）
- 扩展 LLM 指纹字段
- 手动定义 2-3 个 Profile
- 自动匹配 + 预填

### Phase 4b：数据驱动优化（~1-2天）
- 积累 20+ 标注后自动重建 Profile

### Phase 4c：CV 增强（可选，~2天）
- OpenCV 帧级分析

---

## 十、待办事项

### ✅ 已完成（19/22）

- Ingest API（POST/GET）、Workflow 生成、Supabase 存储
- Render/Replicate/Candidates API
- 候选排序 + LLM 排序开关
- clip_ranges 多片段抽帧
- Golden fingerprint 多维度评分
- 前端 TemplateCandidateModal + PreviewOverlay

### ⬜ 待做（P2）

| 项 | 说明 |
|----|------|
| LLM 排序默认值 | `ENABLE_TEMPLATE_RANKING_LLM` 默认 false 待调优 |
| RLS Policy | template_records 行级安全策略 |
| 批量导入脚本 | scripts/batch_ingest_templates.py |

---

## 十一、关键文件索引

| 文件 | 用途 |
|------|------|
| `backend/app/api/templates.py` | 模板 CRUD + 渲染 API |
| `backend/app/services/template_ingest_service.py` | Ingest 流程 |
| `backend/app/services/kling_ai_client.py` | Kling API 调用 |
| `backend/app/tasks/multi_image_to_video.py` | 多图转场 Celery 任务 |
| `frontend/src/features/visual-editor/components/TemplateCandidateModal.tsx` | 候选选择弹窗 |
| `supabase/migrations/20260207_add_template_ingest.sql` | 数据库迁移 |
