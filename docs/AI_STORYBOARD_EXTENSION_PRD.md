# AI 分镜补全与拓展（PRD + Agent API + 交互落地）

> 适用：视觉编辑器 `/visual-editor` 的分镜补全能力。  
> 关联：`AI_VISUAL_SYSTEM.md` 的分镜体系、`AI_STORYBOARD_EXTENSION_WORKFLOW.md` 的策略与 agent 设计。

---

## 1. PRD（产品需求文档）

### 1.1 背景与痛点
- 用户在剪辑时常缺少“承上启下”的镜头：开场交代、转场桥接、收尾余韵。
- 现有流程只做分镜切分与背景定制，缺少“自动补镜 + 可选增强”的能力。
- 不同视频类型差异明显：转场爽点、vlog 真实感、商业广告卖点表达。

### 1.2 目标
- 在每个 clip 的“前 / 中 / 后”补充分镜，且满足逻辑连续性。
- 输出多套候选分镜卡片，用户可一键套用或细调。
- 与风格化、变装、运镜、视听联动结合，作为可选增强层。

### 1.3 用户与场景
**核心用户**
- 轻剪用户：想“一键补镜”，减少手工剪辑。
- 专业剪辑用户：需要清晰的镜头结构与可编辑参数。

**核心场景**
- 转场/酷炫特效：需要强运镜 + 强转场，强调视觉刺激。
- vlog：真实感、生活细节、情绪递进。
- 商业广告：卖点清晰、品牌一致、节奏明确。

### 1.4 功能需求（MVP）
1) **补镜位识别**：在每个 clip 的 before / middle / after 生成补镜位（slot）。
2) **补镜策略生成**：基于角色/环境/动作，生成 3-5 组候选分镜。
3) **类型化策略**：区分转场/酷炫、vlog、广告三类。
4) **一键应用**：候选分镜可应用到时间线，并生成预览。
5) **增强层**：可选开启“风格化重绘/变装/运镜模板/视听联动”。

### 1.5 非功能需求
- **速度**：候选生成 < 20s（可异步）。
- **一致性**：人物/服装/光线连续性评分 >= 阈值。
- **可控性**：用户能锁定某些镜头或约束风格。

### 1.6 MVP 之外（后续）
- 多段多主题自动分段 + 结构化脚本生成
- 镜头热度库（热门模板、网感运镜）
- 自动对齐 TTS / 文案语义

### 1.7 技术选型约束
- 生成 / 渲染 API：对接 **Kling**（已在代码中集成）
  - 关键配置：`KLING_API_KEY` / `KLING_API_SECRET` / `KLING_API_BASE_URL` / `CALLBACK_BASE_URL`
- LLM：对接 **Doubao**（已在代码中集成）
  - 关键配置：`VOLCENGINE_ARK_API_KEY` / `DOUBAO_MODEL_ENDPOINT` / `DOUBAO_SEED_1_8_ENDPOINT` / `LLM_PROVIDER`
  - ASR 配置：`DOUBAO_APP_ID` / `DOUBAO_ACCESS_TOKEN` / `DOUBAO_RESOURCE_ID`

---

## 2. 交互流程（Flow）

### 2.1 用户流程（高层）
```
上传视频 → 分镜分析 → 进入 /visual-editor
→ 选择视频类型（或自动识别）
→ 生成补镜候选 → 预览/筛选 → 一键应用
→ 进入时间线精调 → 导出
```

### 2.2 详细流程（Mermaid）
```mermaid
flowchart LR
  A[Clip 列表/素材] --> B[Ingest + Shot 分析]
  B --> C{视频类型识别}
  C --> D[补镜位 Slotting]
  D --> E[Shot 组合 + 转场选择]
  E --> F[生成候选 (3-5 组)]
  F --> G[排序 + 连贯性校验]
  G --> H[视觉编辑器展示候选]
  H --> I[用户选择/锁定]
  I --> J[应用到时间线 + 预览]
```

---

## 3. Agent Workflow（和视觉编辑器衔接）

### 3.1 核心链路（简版）
1) Ingest Agent → 解析 clips、关键帧、音频节奏
2) Context Graph Agent → 维护人物/环境/时间关系
3) Intent & Type Agent → 分类为转场/酷炫、vlog、广告
4) Slotting Agent → before/middle/after 补镜位
5) Shot Composer Agent → 组合镜头类型与运镜
6) Transition & Rhythm Agent → 选择转场 + 节奏对齐
7) Render/Prompt Agent → 生成 prompt + 参考图约束
8) Consistency QA Agent → 连贯性校验
9) Ranking & Feedback Agent → 输出排序候选

### 3.2 与 /visual-editor 的连接点
- **入口按钮**：右侧面板新增“AI 分镜补全”
- **候选区**：展示 3–5 组候选（可切换、可锁定）
- **时间线反馈**：补镜位显示为“ghost slot”
- **应用后**：补镜位转为“已应用”状态

---

## 4. 现有接口对接（基于代码）

### 4.1 Doubao LLM（内部服务调用）
- 统一入口：`backend/app/services/llm/service.py`
- 客户端：`backend/app/services/llm/clients.py`（DoubaoChat）
- 典型调用：`llm_service.call(...)` / `chains.*` / `get_remotion_llm()`
- 分镜相关可用点：
  - 段落分镜：`backend/app/features/shot_segmentation/strategies/paragraph.py`
  - 内容分析/意图识别：`backend/app/services/smart_analyzer.py`

### 4.2 Kling 生成/渲染 API（对外接口）
**API 前缀**：`/api/kling`

用于补分镜的推荐映射：
- **关键帧生成 / 细节补镜**：`POST /api/kling/image-generation`
- **多图场景编辑 / 风格化**：`POST /api/kling/omni-image`
- **关键帧动起来**：`POST /api/kling/image-to-video`
- **首尾帧过渡**：`POST /api/kling/multi-image-to-video`
- **纯文本生成 B-roll**：`POST /api/kling/text-to-video`
- **运动桥接**：`POST /api/kling/motion-control`
- **前/后补镜延长**：`POST /api/kling/video-extend`

任务状态与管理：
- **查询任务**：`GET /api/kling/ai-task/{task_id}`
- **任务列表**：`GET /api/kling/ai-tasks`
- **取消任务**：`POST /api/kling/ai-task/{task_id}/cancel`

### 4.3 任务模型与回调
- 任务创建：`backend/app/api/kling.py` 内统一 `_create_ai_task(...)`
- 回调入口：`POST /api/callback/kling`（若配置 `CALLBACK_BASE_URL`）
- 默认模式：轮询 `/api/kling/ai-task/{task_id}`

---

## 5. Prompt 模板（对齐现有 Doubao 调用）

### 5.1 推荐调用方式
使用 `LLMService.generate_json(...)`，确保输出可解析 JSON：  
- 入口：`backend/app/services/llm/service.py`  
- 方法：`generate_json(user_prompt, system_prompt, temperature)`

### 5.2 系统 Prompt（结构化 JSON 输出）
```
你是剪辑导演助手。请基于人物与环境连续性，在 clip 的前/中/后补充分镜。
优先保证逻辑连续，其次增强节奏与情绪。
严格输出 JSON，不要解释说明。

输出 JSON Schema:
{
  "candidates": [
    {
      "candidate_id": "cand_1",
      "score_hint": 0.0,
      "shots": [
        {
          "slot": "before|middle|after",
          "purpose": "info|emotion|transition|branding",
          "shot_type": "establishing|insert|reaction|cutaway",
          "camera": "handheld|push_in|pull_out|orbit|top_down",
          "duration_sec": 0.0,
          "transition": "match_cut|whip_pan|jump_cut|montage|none",
          "render_prompt": "..."
        }
      ]
    }
  ]
}
```

### 5.3 User Prompt（传给 generate_json）
```
视频类型: vlog
slot: middle
clip:
  - start: 12.5
  - end: 19.2
  - keyframe: https://...
上下文:
  - 角色: girl_1
  - 服装: red_jacket
  - 环境: street, night
  - 动作: walking -> turn_back
目标:
  - 补镜连接动作，突出细节与节奏
约束:
  - 人物/服装/光线保持一致
  - 镜头时长 0.8-1.5s
  - 优先使用自然光、手持感
```

### 5.4 多模态提示（可选）
若需要对关键帧做视觉理解，可用 `LLMService.analyze_image(...)`：  
- 输入：`image_base64` + `prompt`  
- 输出：文本描述，可回填进上面的 user prompt（补充“人物姿态/环境元素”）

### 5.5 类型化差异提示（拼接到 user prompt）
- **转场/酷炫**：强调“运镜强、转场强、特效可插”
- **vlog**：强调“生活感、手持感、自然光”
- **广告**：强调“卖点镜头、干净转场、品牌一致”

---

## 6. 候选评分函数（Ranking）

### 6.1 评分维度
1) **连续性分**：人物/服装/环境一致性
2) **意图匹配分**：是否符合类型策略（转场/vlog/广告）
3) **节奏分**：镜头长度与音频节奏点对齐
4) **新鲜度分**：镜头角度/构图是否具有变化
5) **成本分**：生成复杂度与渲染成本

### 6.2 评分公式（示例）
```
score =
  0.40 * continuity +
  0.25 * intent_fit +
  0.15 * rhythm +
  0.10 * novelty +
  0.10 * cost
```

### 6.3 不同视频类型权重调整
- **转场/酷炫**：提升 novelty/rhythm 权重
- **vlog**：提升 continuity 权重
- **广告**：提升 intent_fit（卖点清晰）权重

### 6.4 评分结果落库（对齐 tasks 表）
建议把评分与候选结果写入 tasks 表的 `metadata`（前端可按 `result_metadata` 展示）：  
- `metadata.storyboard.score`
- `metadata.storyboard.candidate_id`
- `metadata.storyboard.video_type`
- `metadata.storyboard.slot`
- `metadata.storyboard.shots[]`

---

## 7. /visual-editor 页面落地方案

### 7.1 新增 UI 区块
右侧面板新增「AI 分镜补全」Tab：
- 选择视频类型（或自动识别）
- 候选模式切换：逻辑补镜 / 风格增强 / 节奏增强
- 展示候选分镜卡片（缩略图 + 镜头类型 + 时长）

### 7.2 时间线展示
- 在每个 clip 前/中/后显示 “ghost slot”
- Hover 显示推荐镜头摘要
- 应用后 slot 转为已生效状态

### 7.3 交互细节
- **一键应用**：套用当前候选组
- **锁定镜头**：锁定某张分镜后重新生成其余
- **替换单张**：在时间线中替换单镜

---

## 8. 数据结构对齐（tasks 表 / Visual Editor）

### 8.1 tasks 表（Supabase 统一任务）
用于承载补分镜任务与生成结果，字段以现有表结构为准：  
- **主键/关联**：`id`, `user_id`, `project_id?`, `clip_id?`, `asset_id?`  
- **任务定义**：`task_type`（如 `image_generation` / `image_to_video` / `multi_image_to_video` / `text_to_video` / `motion_control` / `video_extend` / `omni_image` 等）  
- **提供方**：`provider`（Kling）, `provider_task_id`  
- **状态**：`status`, `progress`, `status_message`  
- **输入**：`input_params`（请求体）, `params`（历史字段）  
- **输出**：`output_url` / `result_url`, `output_asset_id` / `result_asset_id`  
- **扩展**：`metadata`（JSONB）, `error_code`, `error_message`  
- **时间**：`created_at`, `started_at`, `completed_at`, `updated_at`

**建议的 metadata 结构（与评分/候选对齐）**
```json
{
  "storyboard": {
    "video_type": "vlog",
    "slot": "middle",
    "candidate_id": "cand_1",
    "score": 0.82,
    "shots": [
      {
        "shot_type": "insert",
        "camera": "handheld",
        "duration_sec": 1.1,
        "transition": "jump_cut",
        "render_prompt": "..."
      }
    ]
  }
}
```

### 8.2 与任务 API / 前端 TaskHistory 对齐
- `/api/tasks` 返回统一 tasks 表字段；已把 `result_url` 映射到 `output_url`。  
- 前端 `TaskHistoryItem` 读取：`output_url` / `output_asset_id` / `input_params` / `result_metadata`。  
  - 若需要在前端展示候选分镜，优先将内容写入 `metadata`，必要时兼容 `result_metadata`。

### 8.3 VisualEditorState 对齐（front-end）
分镜结构直接使用现有 `Shot` 与状态结构：  
- **核心字段**：`id`, `startTime`, `endTime`, `assetId`, `videoUrl`, `replacedVideoUrl`, `thumbnail`, `background`, `layers`, `artboard`, `viewportTransform`  
- **插入补镜**：使用 `insertShotsAfter(afterShotId, newShots)`（自动重算 index/time）  
- **替换补镜**：使用 `replaceShotVideo(shotId, newVideoUrl, newThumbnailUrl?)`（会同步 `replacedVideoUrl`）  
- **UI 暂存**：`activeSidebar` / `selectedClipIdForAI` 用于 AI 能力入口与候选切换  
- **ghost slot** 建议仅做 UI 计算态，不写入持久化

---

## 9. MVP 路线与里程碑
1) **Phase 1**：Slotting + 候选生成 + 一键应用
2) **Phase 2**：增强层（风格化、变装、运镜模板）
3) **Phase 3**：节奏对齐 + SFX 自动增强
