# 口播视频精修 V2 架构设计

## 一、问题分析

### 当前流程（V1）
```
上传视频 → 智能分析(detect-fillers) → 返回 transcript_segments
         ↓
口癖修剪(apply-trimming) → 基于 transcript_segments 创建 clips
         ↓
B-Roll配置(clip-suggestions) → 为每个 clip 搜索 Pexels 素材
```

### V1 问题
1. **Clips 创建太晚**：智能分析只返回 segments，不创建 clips，用户看不到分句
2. **B-Roll 是素材搜索**：为每个 clip 单独搜索素材，不是 Remotion 渲染
3. **流程耦合**：apply-trimming 做了太多事情（分析 + 创建 clips）

---

## 二、V2 架构设计

### 新流程
```
上传视频
    ↓
智能分析(detect-fillers) [改造]
    1. ASR 转写 → segments
    2. 口癖检测 → 标记 filler segments
    3. ★ 直接创建 clips（语义分句）
    4. ★ filler 类型的 clips 标记 metadata.is_filler=true
    ↓
口癖修剪(apply-trimming) [简化]
    - 只是"确认删除"操作
    - 软删除/隐藏 is_filler=true 的 clips
    - 或用户手动恢复某些
    ↓
B-Roll(clip-suggestions) [重构]
    - 拿完整文本（所有保留 clips 的文本拼接）
    - LLM 生成 Remotion 配置（不是搜索单个素材）
    - 返回完整的视频渲染配置
```

---

## 三、数据库变更

### clips 表新增字段
```sql
ALTER TABLE clips ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- metadata 结构示例:
{
  "is_filler": true,           -- 是否为口癖/待删除片段
  "filler_type": "breath",     -- 口癖类型: breath/hesitation/repeat_word/filler_word
  "filler_reason": "换气停顿",  -- 口癖原因
  "confidence": 0.95,          -- 检测置信度
  "hidden": false,             -- 是否被用户隐藏（软删除）
  "segment_index": 5           -- 原始 segment 索引
}
```

---

## 四、API 变更

### 4.1 detect-fillers 响应变更

**V1 响应**（只返回 segments）:
```json
{
  "transcript_segments": [...],
  "filler_words": [...],
  "silence_segments": [...]
}
```

**V2 响应**（返回 clips）:
```json
{
  "clips": [
    {
      "id": "clip-uuid",
      "text": "2025年对于我来说是行动力的一年",
      "start_time": 0,
      "end_time": 5750,
      "is_filler": false,
      "filler_type": null
    },
    {
      "id": "clip-uuid-2",
      "text": "",
      "start_time": 5750,
      "end_time": 6030,
      "is_filler": true,
      "filler_type": "breath",
      "filler_reason": "换气停顿"
    }
  ],
  "filler_summary": {
    "breath": { "count": 28, "total_duration_ms": 8400 },
    "repeat_word": { "count": 1, "total_duration_ms": 10220 }
  },
  "total_filler_duration_ms": 18620,
  "estimated_savings_percent": 9.5
}
```

### 4.2 apply-trimming 简化

**V1**（复杂，创建 clips）:
```json
POST /apply-trimming
{
  "removed_fillers": ["[换气]", "[重复]"],
  "trim_segments": [...],
  "transcript_segments": [...]
}
```

**V2**（简单，只标记删除）:
```json
POST /apply-trimming
{
  "clip_ids_to_remove": ["clip-uuid-2", "clip-uuid-5"],
  "clip_ids_to_keep": ["clip-uuid-3"]  // 可选：用户手动恢复的
}
```

**V2 响应**:
```json
{
  "status": "completed",
  "removed_clips_count": 29,
  "remaining_clips_count": 28,
  "removed_duration_ms": 18620,
  "remaining_duration_ms": 186780
}
```

---

## 五、B-Roll Remotion Schema

### 5.1 设计理念

B-Roll 不再是"为每个 clip 搜索素材"，而是：
1. 拿完整文本（所有保留 clips 的文本）
2. LLM 分析整体内容，生成 Remotion 组件配置
3. 配置包括：文字动画、B-Roll 插入点、过渡效果等

### 5.2 Remotion 配置 Schema

```typescript
interface BRollRemotionConfig {
  // 元信息
  version: "1.0";
  totalDurationMs: number;
  fps: 30;
  
  // 整体风格
  style: {
    theme: "minimalist" | "dynamic" | "cinematic" | "vlog";
    colorPalette: string[];  // 主色调
    fontFamily: string;
  };
  
  // 时间线组件
  timeline: Array<TimelineComponent>;
}

// 时间线组件基类
interface TimelineComponent {
  id: string;
  type: "text" | "broll" | "transition" | "overlay";
  startMs: number;
  endMs: number;
}

// 文字动画组件
interface TextComponent extends TimelineComponent {
  type: "text";
  text: string;
  animation: "typewriter" | "fade-in" | "slide-up" | "highlight";
  position: "center" | "bottom" | "top" | "left" | "right";
  style: {
    fontSize: number;
    color: string;
    backgroundColor?: string;
  };
}

// B-Roll 视频组件
interface BRollComponent extends TimelineComponent {
  type: "broll";
  // 搜索配置（前端根据这个搜索 Pexels）
  searchKeywords: string[];
  // 或者直接指定素材
  assetUrl?: string;
  // 显示方式
  displayMode: "fullscreen" | "pip" | "split-left" | "split-right";
  // 过渡效果
  transitionIn: "fade" | "slide" | "zoom";
  transitionOut: "fade" | "slide" | "zoom";
}

// 过渡效果组件
interface TransitionComponent extends TimelineComponent {
  type: "transition";
  effect: "fade" | "slide" | "wipe" | "zoom";
  direction?: "left" | "right" | "up" | "down";
}

// 叠加层组件（Logo、水印等）
interface OverlayComponent extends TimelineComponent {
  type: "overlay";
  overlayType: "logo" | "watermark" | "progress-bar" | "chapter-title";
  content: string;
  position: { x: number; y: number };
}
```

### 5.3 LLM Prompt 示例

```
你是一个视频编辑 AI，根据口播视频的文本内容，生成 Remotion 渲染配置。

输入：
- 视频总时长：185850ms
- 文本内容（按时间顺序）：
  1. [0-5750ms] 2025年对于我来说是行动力的一年，今年我把我的很多想法都付诸行动了。
  2. [5750-9350ms] 主要在两个方面有了比较大的收获，第一就是内容方面。
  ...

输出要求：
1. 分析文本，找出适合插入 B-Roll 的位置（抽象概念、数据、转场等）
2. 为每个 B-Roll 位置生成搜索关键词
3. 设计文字动画高亮关键信息
4. 设计整体风格和过渡效果

返回 JSON 格式的 BRollRemotionConfig。
```

### 5.4 clip-suggestions V2 响应

```json
{
  "status": "completed",
  "remotion_config": {
    "version": "1.0",
    "totalDurationMs": 185850,
    "fps": 30,
    "style": {
      "theme": "minimalist",
      "colorPalette": ["#1a1a1a", "#ffffff", "#3b82f6"],
      "fontFamily": "Inter"
    },
    "timeline": [
      {
        "id": "text-1",
        "type": "text",
        "startMs": 0,
        "endMs": 3000,
        "text": "2025年度总结",
        "animation": "fade-in",
        "position": "center",
        "style": { "fontSize": 48, "color": "#ffffff" }
      },
      {
        "id": "broll-1",
        "type": "broll",
        "startMs": 12000,
        "endMs": 18000,
        "searchKeywords": ["social media growth", "followers increase"],
        "displayMode": "pip",
        "transitionIn": "fade",
        "transitionOut": "fade"
      },
      {
        "id": "text-2",
        "type": "text",
        "startMs": 12000,
        "endMs": 20000,
        "text": "小红书: 2万 → 18万",
        "animation": "typewriter",
        "position": "bottom",
        "style": { "fontSize": 32, "color": "#ff2442" }
      }
    ]
  },
  // 向后兼容：保留 clips 数组
  "clips": [...]
}
```

---

## 六、实施计划

### Phase 1：数据库 + detect-fillers 改造 ✅ 已完成
1. ✅ clips 表添加 metadata 字段
2. ✅ detect-fillers 改为直接创建 clips
3. ✅ 前端适配新的响应结构

### Phase 2：apply-trimming 简化 ✅ 已完成
1. ✅ 新增 apply-trimming-v2 端点，只更新 clips.metadata.hidden
2. ✅ 前端 handleApplyTrim 使用 applyTrimmingV2

### Phase 3：B-Roll Remotion 化 ✅ 已完成
1. ✅ 设计并实现 LLM prompt (RemotionConfigGenerator)
2. ✅ 实现 Remotion 配置生成端点 (remotion-config)
3. ✅ 前端 loadBRollData 调用 getRemotionConfig

### Phase 4：前端 UI 适配 ✅ 已完成
1. ✅ WorkflowModal 添加 createdClipsV2 和 brollComponentsV2 状态
2. ✅ loadDefillerData 保存 V2 clips
3. ✅ handleApplyTrim 优先使用 V2 API
4. ✅ loadBRollData 优先使用 getRemotionConfig

### Phase 5：B-Roll 搜索与预览 ✅ 已完成
1. ✅ B-Roll 素材搜索功能（`handleSearchBRoll`，根据 search_keywords 搜索 Pexels）
2. ✅ UI 显示搜索关键词标签和缩略图
3. ✅ Remotion 预览组件
   - `RemotionConfigComposition`: 渲染 LLM 生成的配置
   - `RemotionConfigPreview`: 预览播放器组件
   - 支持文字动画、B-Roll、章节标题渲染
4. ✅ 集成到 WorkflowModal
   - V2 模式下使用 RemotionConfigPreview
   - V1 回退使用 BRollVideoPreview

---

## 八、V2 架构完整实现清单

### 后端
- ✅ `detect-fillers`: 智能分析阶段直接创建 clips，标记 `metadata.is_filler`
- ✅ `apply-trimming-v2`: 简化版本，仅操作 `metadata.hidden`
- ✅ `remotion-config`: LLM 生成整体 Remotion 配置
- ✅ `RemotionConfigGenerator`: Remotion 配置生成服务

### 前端 API
- ✅ `ClipInfoV2`, `DetectFillersResponseV2`: V2 响应类型
- ✅ `applyTrimmingV2()`: V2 修剪函数
- ✅ `getRemotionConfig()`: 获取 Remotion 配置
- ✅ `RemotionConfig` 类型族

### 前端 UI
- ✅ `WorkflowModal`: 
  - 使用 V2 API（V1 回退兼容）
  - 显示搜索关键词标签
  - Pexels 素材搜索功能
  - V2 Remotion 预览集成

### Remotion 组件
- ✅ `RemotionConfigComposition`: 渲染配置
  - `AnimatedText`: 文字动画（fade-in, slide-up, typewriter, bounce）
  - `BRollVideo`: B-Roll 视频（fullscreen, pip, split）
  - `ChapterTitle`: 章节标题
- ✅ `RemotionConfigPreview`: 预览播放器

---

## 七、迁移策略

### 向后兼容
- detect-fillers 同时返回 `clips` 和 `transcript_segments`
- apply-trimming 支持新旧两种请求格式
- clip-suggestions 同时返回 `remotion_config` 和 `clips`

### 逐步切换
1. 先发布后端改造
2. 前端逐步切换到新接口
3. 3个版本后移除旧字段
