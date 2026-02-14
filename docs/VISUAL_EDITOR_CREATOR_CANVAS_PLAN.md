# 视觉编辑器创作者画布扩展方案（V1）

> 状态：Draft（用于先对齐产品/交互，再进入开发）
> 
> 日期：2026-02-09
> 
> 目标：围绕「自由创作画布 + 单主线 Timeline + 节点化 AI 能力」定义一套可落地的路线，先治标跑通，再治本沉淀长期架构。

---

## 0. 背景与北极星

平台正在从“功能页集合”转向“创作者长期项目工具”。

这意味着视觉编辑器要从“分镜处理器”升级为：

1. **可持续创作容器**：节点/素材/AI 处理在同一画布中沉淀；
2. **统一成片出口**：无论画布多复杂，最终都落到一个主线 Timeline；
3. **可编排 AI 工作流**：右键、边中加号、中心加号都能触发能力；
4. **可调可验证**：Prompt、策略、任务日志可见，便于快速迭代模板和 Agent。

### 0.1 当前实施状态（2026-02-10）

> 说明：以下仅统计非 Timeline 部分，Timeline 正由另一个 Agent 开发。

| 模块 | 状态 | 已落地 | 仍需补齐（P0） | 仍需补齐（P1） |
|---|---|---|---|---|
| 点1 画布自由拖动 | ✅ 大部分完成 | ✅ 网格吸附（20px snap）、✅ 中心/边缘对齐线（8px 阈值）、✅ 整理按钮（横/纵/网格）、✅ 自由节点拖拽 + 位置持久化、✅ 等间距分布整理模式（水平/垂直）、✅ 等间距提示线（拖拽时自动检测）、✅ 节点类型简化决策（不分 text/group/ai-result，统一 clip 节点，AI 产物即 img/video node） | ⚠️ 20 节点性能校验（QA 验收项，低优先级） | ❌ CanvasTransform 模型（scale/rotation/zIndex/locked/groupId）、⚠️ Command Bus（已有快照 undo/redo，非指令式） |
| 点3 右键元素分离 | ✅ 大部分完成 | ✅ 分镜拆分、✅ 背景/人物分离、✅ 人物/服饰分离、✅ 人物/配饰分离、✅ 前/中/后景结构分离、✅ 换背景、✅ 声音优化、✅ 加入主线、✅ 删除、✅ 右键「打开/预览」（媒体全屏弹窗）、✅ 右键「单图生成」入口、✅ 右键「多图生成」入口（含连线上下文）、✅ 右键「复制」、✅ 右键「锁定/解锁」（位置锁定 + 拖拽拦截） | — | ❌ 分离向导弹窗（粒度选择 + 成本预估 + mask 预览）、❌ ElementPart 模型（类型/mask/置信度）、❌ 多层级分离与回滚 |
| 点4 添加节点 AssetPicker | ✅ 大部分完成 | ✅ 统一 MaterialPickerModal（素材库/本地上传/URL/项目分镜 4 个 Tab）、✅ 画布右键「添加素材」触发、✅ 边中 `+` 触发、✅ 拖放文件到画布自动成节点、✅ 节点右键「添加素材」入口 | — | ❌ 批量导入智能命名、❌ 上传队列与失败重试 |
| 点5 单图 Generate | ✅ 大部分完成 | ✅ GenerationComposerModal 两步弹窗、✅ 9 个能力定义（含 lip_sync/face_swap/video_extend 已接入画布工作流）、✅ Prompt + 高级参数可见、✅ 任务卡显示 prompt + 关键参数、✅ 节点右键「单图生成」入口、✅ seed/negativePrompt/quality 高级参数、✅ 预估耗时显示、✅ 「生成 3 个变体」CTA 按钮、✅ 能力分类分组（修复增强/结构编辑/风格生成/动态化）、✅ Capability Registry（minInputs/maxInputs/allowedMediaTypes/outputType + 不兼容能力灰显）、✅ Prompt 自动建议（从节点元数据 + 能力上下文拼接） | — | — |
| 点6 多图 Node | ✅ 大部分完成 | ✅ A/B 双节点连线 + 边中 `+` 触发转场/AI 生成、✅ 闭环检测（DFS，2~4 节点）、✅ 闭环中心 `+` 按钮（含节点计数角标）、✅ 智能曲线方向、✅ 三节点路径中间节点全收集（allInputNodes）、✅ `reference` 角色标签、✅ 几何顺时针路径排序（atan2 基于重心）、✅ 多图任务统一协议（ordering + generationMode + applyMode + outputType） | — | — |
| 3.8 +号弹窗规范 | ✅ 大部分完成 | ✅ 两步弹窗（确认输入 → 参数设置）、✅ 时长/比例/CFG/focus_modes/golden_preset/boundary_ms/variant_count、✅ Prompt 区域、✅ 保存为模板参数、✅ Payload 预览、✅ 输入图卡片拖拽排序（中间节点 HTML5 drag-sort）、✅ seed/negativePrompt/quality 高级参数（可折叠）、✅ 预估耗时显示、✅ 「生成 3 个变体」CTA 按钮、✅ 输入节点缩略图预览、✅ `reference` 角色标签（点击切换）、✅ Prompt 自动建议（从节点元数据 + 能力上下文拼接，一键应用） | — | — |
| 任务可观测性 | ✅ 大部分完成 | ✅ 能力类型标签、✅ Final prompt 显示、✅ 关键参数摘要（duration/boundary_ms/preset 等）、✅ 替换原视频 + 预览 + 保存到素材库、✅ Prompt 点击展开/收起、✅ 多输入节点缩略图、✅ 运行日志入口链接 | — | ❌ 细粒度调试链路 |

---

## 1. 市场交互基线（2026-02-09）

用于借鉴“画布工具如何做自由拖拽、上下文操作、AI 辅助、时间轴入口”。

| 产品 | 可借鉴交互 | 对我们的启发 |
|---|---|---|
| Figma / FigJam | Smart selection、Tidy up、对象对齐与重排、右键菜单体系、AI 组织与总结 | 我们应优先做“自由拖拽 + 对齐吸附 + 快速整理”，并把 AI 能力放入上下文菜单 |
| Miro | 画布内内容上传/拖拽、Snap to grid、Smart guides、Sidekicks（上下文 AI） | 我们应做“上传即节点化”“对齐引导线”“画布语境下 AI 建议” |
| Adobe Express | 底部 timeline + 图层 timing + 场景管理 | 我们的“单主线 Timeline”要支持可折叠、层时序可视化、导出前预检 |
| Canva（Video Suite / Video features） | 场景拆分与时间线基础操作、右键 split、多媒体拼装 | 我们应保留低门槛剪辑路径：拖入素材 → 自动进主线 → 一键导出 |
| Krea Realtime | 实时画布操作、可视输入驱动生成（文本/图像/画布） | 我们可在节点右键中引入“快速实时预览生成”能力，降低试错成本 |

---

## 2. 总体产品结构（先定框架）

### 2.1 三层模型

- **Canvas Layer（创作层）**：自由拖动、连线、分离、分组、AI 触发。
- **Timeline Layer（成片层）**：每个 Project 仅 1 条主线 Timeline，位于底部，可展开/收起。
- **Export Layer（发布层）**：最终只导出 Timeline 内容（图片或视频）。

### 2.2 核心原则

- **单一真相源**：导出只认 Timeline，不直接认画布几何布局。
- **画布驱动编排**：画布操作会更新 Timeline（可自动/手动确认两种模式）。
- **所有 AI 可追溯**：每次生成显示模板、Prompt、参数、任务日志。

---

## 3. 六个方向的独立 Plan（每点治标 + 治本）

## 3.1 点 1：画布元素全自由拖动

### 目标

让所有节点都可自由拖动，并具备对齐与整理能力。

> **设计决策（2026-02-10）**：不引入 `text/group/ai-result` 等独立节点类型。每个节点形态自由，统一使用 `clip` 节点；AI 生成的结果只产出 image node 或 video node，不做分组，不做类型区分。

### 治标（P0）

- 开放当前节点统一拖拽（含多选拖拽）。
- 增加基础吸附：网格、相邻节点中心线、等间距提示线。
- 增加“整理”按钮：横向排布、纵向排布、等间距分布。

### 治本（P1）

- 引入统一 `CanvasTransform` 模型：`position/scale/rotation/zIndex/locked/groupId`。
- 引入命令系统（Command Bus）支持 Undo/Redo、批量变更回放。
- 建立节点布局策略层（手动布局 / 自动布局 / 混合布局）。

### 验收指标

- 拖拽响应 < 16ms；
- 多选 20 节点拖拽无明显卡顿；
- 对齐吸附命中率和可理解性通过内部可用性测试。

---

## 3.2 点 2：每个 Project 只有一个主线 Video Timeline（底部可收起）

### 目标

建立“画布创作 → 主线成片”的强约束，避免导出逻辑分叉。

### 交互设计

- 底部固定 Timeline 面板：`展开 / 半展开 / 收起` 三态；
- 主线只允许 1 条（可含多段 clip、图片段、过渡段、AI 段）；
- 画布节点可“加入主线 / 替换主线段 / 插入主线位置”。

### 导出规则（Auto + 可手动改）

- 若主线仅 1 个静态图片段且无动画/转场：默认导出图片；
- 其余情况默认导出视频；
- 导出弹窗显示“判定原因”，允许用户手动改为图片/视频（只在合法条件下）。

### 治标（P0）

- 先做主线面板容器 + collapse/expand + 时间段列表；
- 导出先支持“纯图片主线导图，其他导视频”。

### 治本（P1）

- 建立 `project_timelines` 与 `timeline_segments` 数据模型；
- 加入导出预检（空段、重叠、缺资源、时长异常）；
- 加入“渲染解释层”：展示导出前最终拼装结构。

---

## 3.3 点 3：节点右键能力（重点：元素分离）

### 目标

把"分镜 + 人物/背景/服饰"等统一成一个"元素分离"入口，降低理解成本。

> **设计决策（2026-02-10）**：分词、分句能力暂不纳入本期规划，只保留分镜拆分。后续有需求再扩展。

### 右键菜单建议结构

- 打开/预览
- 加入主线 / 插入主线
- **元素分离**
  - 视觉语义：分镜拆分、背景/人物、人物/服饰、人物/配饰
  - 结构分离：前景层/中景层/后景层
- 单图生成
- 多图生成（当有连线上下文时）
- 删除 / 锁定 / 复制

### 交互关键点

- 分离操作进入“分离向导”弹窗：
  - 选择粒度（粗 / 中 / 细）；
  - 预计耗时与成本提示；
  - 结果预览（mask 覆盖 + 产物数量预估）。
- 分离后自动生成子节点，并记录父子关系。

### 治标（P0）

- 统一右键菜单容器；
- 把现有分镜拆分迁移到"元素分离"分组。

### 治本（P1）

- 引入 `ElementPart` 结构（类型、mask、置信度、可编辑区域）；
- 支持多层级分离与回滚；
- 支持“重新分离（保留上次参数）”。

---

## 3.4 点 4：添加节点（新增 Asset）

### 目标

让“加素材”成为统一入口：本地、项目库、平台库、模板库、URL。

### 交互

- 画布空白处 `+`、边中 `+`、节点右键都可触发同一 `AssetPicker`。
- 资源来源 Tab：本地上传 / 项目资产 / 系统素材 / 模板库 / URL 导入。
- 选中后支持 3 个动作：
  - 放入画布（仅节点）
  - 放入主线（仅 timeline）
  - 同时放入（推荐）

### 治标（P0）

- 先统一弹窗和数据返回格式；
- 先支持本地 + 系统素材 + 项目素材。

### 治本（P1）

- 支持拖拽上传到画布直接成节点；
- 支持批量导入与自动命名；
- 加入上传队列与失败重试。

---

## 3.5 点 5：单图 Generate（节点右键触发）

### 目标

让单节点（image/video 首帧）可直接调用 AI 能力，复用现有画布工作流。

### 能力分类（建议）

- 修复增强：超分、去噪、面部修复
- 结构编辑：扩图、抠图、重绘、背景替换
- 风格生成：风格化、光线重打、品牌化改写
- 动态化：单图转短视频（image2video）

### 交互

- 右键 `单图生成` → 能力选择弹窗（可按“常用/最新/推荐”排序）
- 填写 prompt + 高级参数
- 任务卡展示：模板名、Prompt、参数、状态、结果替换入口

### 治标（P0）

- 先把已有能力接到统一 `SingleNodeActionModal`；
- Prompt 与参数必须可见。

### 治本（P1）

- 建立 `Capability Registry`：输入输出约束、预估成本、可并发策略；
- 建立“节点上下文自动补全 Prompt”（从 node metadata 注入）。

---

## 3.6 点 6：多图 Node（首尾两线 + 闭环中心加号 + 边中加号能力统一）

### 目标

支持 A→B、A→B→C、闭环图形（圆/方形）等多图关系触发 AI 生成。

### 交互机制

- 两节点连线：边中 `+` 触发“多图生图 / 多图生视频 / 转场模板”。
- 闭环检测：当连线形成闭环（如圆/方）时，在几何中心出现 `+`。
- 点击中心 `+`：弹窗选择能力，并显示输入节点顺序（可拖动调整）。

### 治标（P0）

- 先支持两节点（A/B）和三节点（A/B/C）路径；
- 先复用现有边中 `+` 与转场模板能力。

### 治本（P1）

- 建立图关系引擎：
  - 环检测（cycle detection）
  - 路径排序（几何顺时针 + 手工覆盖）
  - 输入映射（start/end/keyframe anchors）
- 多图任务统一协议：`input_nodes[] + ordering + generation_mode + apply_mode`。

---


## 3.7 Rabbit Hole 能力矩阵（节点内 vs 节点间）

基于你补充的能力清单（Lip Sync / Text2Video / Image2Video / Multi-Image / Motion Control / Video Extend / Face Swap / Image Gen / Omni-Image），建议统一按“触发位置”建模：

- **节点内能力（右键）**：处理当前单节点素材；
- **节点间能力（边中 +）**：处理两个或多个节点关系；
- **画布中心能力（闭环中心 +）**：处理多节点结构化生成。

### A. 节点内能力（Right Click on Node）

| 能力 | 适合节点类型 | 必填输入 | 可选输入 | 默认输出 |
|---|---|---|---|---|
| 口型同步 Lip Sync | video / image(person) | 人像素材 + 音频 | prompt(风格) | video node |
| 文生视频 Text2Video | text node / empty node | prompt | 时长/比例/风格 | video node |
| 图生视频 Image2Video | image node | 1 张图 | prompt/运镜参数 | video node |
| 动作控制 Motion Control | image/video node | 主图 + 运动模板 | prompt/控制强度 | video node |
| 视频延长 Video Extend | video node | 视频节点 | 延长时长/prompt | video node(替换或分支) |
| AI 换脸 Face Swap | video/image(person) | 源脸 + 目标素材 | 保真度参数 | video/image node |
| 图像生成 Image Gen | image/text node | prompt 或参考图 | 风格/分辨率 | image node |
| Omni-Image | image node | 图 + 区域/掩码 | prompt/重绘强度 | image node |

### B. 节点间能力（Edge + between A/B）

| 能力 | 输入关系 | 典型场景 | 输出 |
|---|---|---|---|
| 多图生视频 Multi-Image | A→B（可扩展 A→B→C） | 前后场景衔接、人物换装、状态变化 | 中间转场 video node |
| 图生视频（双端约束） | A 与 B 作为 start/end anchor | 用 A/B 两图约束一段过渡运动 | video node |
| Motion Control（关系版） | A（主体）+B（动作参考） | 姿态迁移、镜头路径复制 | video/image node |
| 风格迁移（关系版） | A（内容）+B（风格） | 内容保留 + 风格替换 | image/video node |
| 对齐/匹配工具 | A/B 人脸、构图、尺度 | 生成前预处理，减少漂移 | 预处理结果（不直接导出） |

### C. 闭环中心能力（Cycle Center +）

| 能力 | 输入关系 | 场景 | 输出 |
|---|---|---|---|
| 多图生图 | 环内 N 图 | 品牌 KV、多角度融合 | 1~N image nodes |
| 多图生视频 | 环内 N 图 + 顺序 | 多镜头/多造型合成短片 | video node |
| 模板化转场批量生成 | 环内边集合 | 一次生成多段转场模板 | transition nodes pack |

> 约束建议：P0 阶段先支持 2 节点和 3 节点路径；闭环中心 + 放到 P1。

---

## 3.8 “+号触发生成”弹窗规范（按你的草图）

你的草图方向是对的：左侧展示参与图片，右侧能力和 prompt，底部主 CTA。建议拆成**两步弹窗**，降低用户理解成本。

### Step 1：确认“用哪几张图”

- 输入区：
  - 左侧卡片列出参与节点（A/B/C...），支持拖拽排序；
  - 每张卡片显示：缩略图、节点名、角色标签（start/end/reference）；
  - 可一键替换某个输入图（从素材库或本地）。
- 顶部显示：`将使用 2 张图片生成 1 段视频`（动态文案）。
- 中部能力选择：按你截图的分组展示（Video Generation / Image Generation）。

### Step 2：能力参数（含 prompt）

- 通用参数：时长、比例、质量档、seed、负面词（高级折叠）。
- 能力特有参数：
  - Multi-Image：start/end 锁定、过渡窗口、focus_mode、golden_preset；
  - Omni-Image：mask 强度、重绘范围、保真度；
  - Motion Control：动作模板、镜头路径强度。
- Prompt 区：
  - 支持用户输入；
  - 支持“自动建议 prompt”（从节点元数据拼接）；
  - 显示最终下发 prompt（可展开查看完整文本）。

### 弹窗信息架构（建议）

- Header：能力名 + 输入数量 + 预计耗时
- Body-Left：输入节点与顺序
- Body-Right：参数与 prompt
- Footer：
  - 次要：`保存为模板参数`
  - 主要：`开始生成`
  - 辅助：`仅预览 prompt` / `生成 3 个变体`

### 弹窗提交协议（建议）

```json
{
  "capability": "multi_image_to_video",
  "input_nodes": [
    {"node_id": "clip-A", "role": "start", "url": "..."},
    {"node_id": "clip-B", "role": "end", "url": "..."}
  ],
  "prompt": "same person keeps identity, outfit transitions from white hoodie to black blazer via spin occlusion",
  "params": {
    "duration": "5",
    "aspect_ratio": "9:16",
    "focus_mode": "outfit_change",
    "golden_preset": "spin_occlusion_outfit",
    "boundary_ms": 480,
    "variant_count": 3
  },
  "apply_mode": "insert_between"
}
```

### 任务可观测性（必须）

提交后任务卡要展示：

- 能力类型（如 `multi_image_to_video`）
- 输入节点 ID/缩略图
- 最终 prompt（可展开）
- 关键参数（duration, boundary_ms, preset, focus_mode）
- 运行日志入口（方便你调质量）

---

## 3.9 前端组件建议（新增）

建议把 + 号弹窗抽象成统一组件：

- `GenerationComposerModal`
  - `InputSelectorPane`（输入图选择/排序）
  - `CapabilityPickerPane`（能力分组选择）
  - `PromptAndParamsPane`（prompt + 参数）
- `CapabilityPresetPanel`
  - 展示 Rabbit Hole 官方能力卡（你给的能力清单）
- `GenerationTaskDebugPanel`
  - 展示最终 prompt 与任务日志

这样节点右键和边中 `+` 可复用同一套弹窗，只是预填输入不同。

---

## 4. 核心数据模型补充（建议）

```ts
interface ProjectTimeline {
  id: string;
  projectId: string;
  isPrimary: true;
  collapsed: boolean;
  totalDurationMs: number;
}

interface TimelineSegment {
  id: string;
  timelineId: string;
  sourceNodeId: string;
  mediaType: 'image' | 'video' | 'transition';
  startMs: number;
  endMs: number;
  layer: number;
  exportPolicy?: 'auto' | 'image' | 'video';
}

interface CanvasNodeAction {
  nodeId: string;
  actionType: 'separate' | 'single_generate' | 'multi_generate' | 'add_asset';
  input: Record<string, unknown>;
}
```

---

## 5. 开发节奏（建议 3 个阶段）

### 阶段 A（2 周，先跑通）

- 点 1 治标：全节点可拖拽 + 基础吸附
- 点 2 治标：底部主线 Timeline + 导出 auto 规则
- 点 3 治标：统一右键菜单 + 元素分离入口归并
- 点 4 治标：统一 AssetPicker（本地/项目/系统）

### 阶段 B（2-3 周，可用性跃迁）

- 点 5：单图生成统一弹窗 + Prompt 可视化 + 任务替换
- 点 6：边中加号统一能力 + A/B 多图生成标准化
- `GenerationComposerModal`（输入图确认 + 能力选择 + Prompt 参数）
- 增加主线操作：插入、替换、拖动重排

### 阶段 C（3-4 周，治本）

- 图关系引擎 + 闭环中心加号
- 元素分离层级化（背景/人物/服饰等）
- Command Bus + Undo/Redo + 操作回放
- 导出预检与解释层

---

## 6. 与当前代码的落地映射

### 前端重点改造位

- `frontend/src/components/visual-editor/workflow/WorkflowCanvas.tsx`
  - 节点拖拽规则、边中加号、闭环中心加号
- `frontend/src/components/visual-editor/workflow/AddButtonEdge.tsx`
  - 边中能力菜单统一
- `frontend/src/components/visual-editor/workflow/ClipNode.tsx`
  - 节点右键入口、单图/分离入口
- `frontend/src/components/visual-editor/workflow/MaterialPickerModal.tsx`
  - 升级为统一 AssetPicker
- `frontend/src/components/visual-editor/VisualEditor.tsx`
  - 主线 Timeline 与导出策略接入

### 后端重点改造位

- `backend/app/api/templates.py` / `backend/app/services/template_render_service.py`
  - 单图/多图模板任务参数统一
- `backend/app/api/ai_capabilities.py` / `backend/app/services/ai_capability_service.py`
  - 节点动作协议收敛（single/multi/separate）
- 新增 timeline 持久化 API（project 级唯一主线）

---

## 7. 风险与防抖策略

- **风险 1：功能入口过多，用户认知混乱**
  - 策略：所有 AI 功能统一进“节点右键 + 加号菜单”，不新增平行入口。
- **风险 2：画布与时间线双向同步引发状态错乱**
  - 策略：Timeline 为导出真相源，画布变更通过命令事务落库。
- **风险 3：元素分离颗粒度过细导致性能/成本爆炸**
  - 策略：先做 3 档粒度，默认中粒度；高级分离显式提示成本。
- **风险 4：多图闭环输入顺序不可预测**
  - 策略：先给系统建议顺序，再允许用户手动改序。

---

## 8. 第一阶段定义（建议立即启动）

先交付以下“最小可用创作闭环”作为版本里程碑：

1. 全节点自由拖动 + 边中加号能力统一；
2. 单主线 Timeline（底部可收起）+ 自动导出图片/视频判定；
3. 统一右键菜单（元素分离 + 单图生成 + 加素材）；
4. 单图生成任务中完整显示 Prompt/参数/状态；
5. A/B 两节点多图生成稳定可用（含转场模板复用）。

---

## 附：参考资料（外部）

- Figma（FigJam AI / Smart selection / 对齐）
  - https://help.figma.com/hc/en-us/articles/16822138920343-Use-AI-tools-in-FigJam
  - https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection
  - https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-and-position
- Miro（内容添加 / 对齐吸附 / Sidekicks）
  - https://help.miro.com/hc/en-us/articles/360017731233-Ways-to-add-content
  - https://help.miro.com/hc/en-us/articles/4403634496402-Miro-for-mapping-diagramming
  - https://help.miro.com/hc/en-us/articles/29902701849618-Sidekicks-overview-Beta
- Adobe Express（视频 timeline 与图层 timing）
  - https://helpx.adobe.com/express/create-and-edit-videos/create-videos/add-scenes.html
  - https://www.adobe.com/learn/express/web/adjust-video-timing
- Canva（视频编辑能力与 timeline）
  - https://www.canva.com/features/video-splitter/
  - https://www.canva.com/newsroom/news/canva-launches-video-suite-empower-everyone-create-edit-record-stunning-videos/
- Krea（实时画布与多输入生成）
  - https://docs.krea.ai/user-guide/features/realtime

