# HoppingRabbit AI - 数据架构 V4

## 概述

本文档描述 HoppingRabbit AI 的数据存储架构，解决以下核心问题：
1. 分片存储 - 分割后的素材需要独立存储
2. 素材关联 - video 与分片的关联关系
3. 用户隔离 - 所有数据需要 user_id
4. 高频操作 - 体验流畅性与数据持久化的平衡

---

## 实施状态清单

### ✅ 已完成

- [x] 创建数据库 schema (`/supabase/schema_v4_clips_tracks.sql`)
- [x] 创建 clips API (`/backend/app/api/clips.py`)
- [x] 创建 tracks API (`/backend/app/api/tracks.py`)
- [x] 更新 projects.py 处理 clip 操作同步
- [x] 添加 MOVE_CLIP 操作处理
- [x] 更新前端 `splitClip` 函数
- [x] 更新前端 `splitAllAtTime` 函数
- [x] 更新前端 `addClip` 函数
- [x] 更新前端 `duplicateClip` 函数
- [x] 更新前端 `updateClip` 字段映射
- [x] `deleteSelectedClip` 已正确发送 REMOVE_CLIP
- [x] `moveClipToTrack` 已正确发送 MOVE_CLIP

### ⏳ 待执行

1. **在 Supabase Dashboard 执行 SQL 迁移**
   ```
   打开 Supabase Dashboard -> SQL Editor -> 粘贴并执行 schema_v4_clips_tracks.sql
   ```
2. 迁移现有项目数据到新表（可选，新项目自动使用新架构）
3. 端到端测试：导入视频 → 分割 → 移动 → 刷新页面 → 验证数据完整

---

## 数据表设计

### 1. projects（项目表）
主要存储项目元数据，timeline 简化为 ID 引用。

```
projects
├── id (UUID)
├── user_id (UUID) ← 必须！用于权限隔离
├── name
├── settings (JSONB) - 分辨率、帧率等
├── timeline (JSONB) - 简化版，只存 track_order, playhead, zoom
├── segments (JSONB) - 转写片段
├── version (INT) - 乐观锁版本号
└── status, created_at, updated_at
```

### 2. tracks（轨道表）
独立存储轨道信息。

```
tracks
├── id (UUID)
├── project_id (UUID)
├── user_id (UUID)
├── name, type (video|audio|text|adjustment)
├── layer (INT) - 层级顺序，越大越上层
├── adjustment_params (JSONB) - 调节层参数（仅 adjustment 类型）
│   例: {"brightness": 0.1, "contrast": 1.2, "saturation": 1.0, "lut": "cinematic_01"}
├── muted, locked, solo, visible
└── color, height, created_at, updated_at
```

**轨道类型说明：**
- `video` - 视频轨道
- `audio` - 音频轨道
- `text` - 文字/字幕轨道
- `adjustment` - **调节层**（滤镜、调色），作用于下方所有轨道

### 3. clips（片段表）⭐ 核心
独立存储所有时间轴片段，支持分割追溯。

```
clips
├── id (UUID)
├── project_id (UUID)
├── user_id (UUID)
├── track_id (UUID) → tracks.id
├── asset_id (UUID) → assets.id  ← 关联原始素材
├── parent_clip_id (UUID) → clips.id  ← 分割来源追溯
│
├── name, clip_type (video|audio|text)
├── start_time (FLOAT) - 时间轴位置
├── duration (FLOAT)
├── source_start (FLOAT) - 源素材裁剪起点
├── source_end (FLOAT)
│
├── volume, muted, opacity, scale, rotation
├── effects (JSONB)
├── transition_in, transition_out (JSONB) ← 转场特效挂在 clip 上
│   例: {"type": "fade", "duration": 0.5}
│
├── is_deleted (BOOL) - 软删除
├── upload_status (TEXT) - pending|uploading|uploaded|ready
├── cached_url (TEXT) - 签名 URL 缓存
└── metadata (JSONB), created_at, updated_at
```

### 4. assets（资源表）
存储原始上传的媒体文件。

```
assets
├── id (UUID)
├── project_id (UUID)
├── user_id (UUID)
├── type (video|audio|image|text)
├── subtype (original|vocals|accompaniment|proxy)
├── storage_path, url, thumbnail_url
├── name, file_size, mime_type
├── metadata (JSONB) - duration, width, height, fps
├── parent_id (UUID) - 衍生资源关联
└── status, created_at, updated_at
```

### 5. markers（标记表）
时间轴标记点。

```
markers
├── id (UUID)
├── project_id (UUID)
├── user_id (UUID)
├── time (FLOAT) - 标记时间点
├── label, color
├── type (normal|chapter|todo|highlight)
└── note, created_at
```

### 6. project_effects（项目效果表）
全局效果/滤镜。

```
project_effects
├── id (UUID)
├── project_id (UUID)
├── user_id (UUID)
├── type (color_grade|filter|lut)
├── name, enabled, order_index
└── params (JSONB), created_at, updated_at
```

---

## 关系图

```
┌─────────────┐
│   projects  │
│  user_id ◄──┼──────────────────────────────────┐
└──────┬──────┘                                   │
       │                                          │
       │ 1:N                                      │
       ▼                                          │
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   tracks    │    │   assets    │    │   users     │
│ project_id  │    │ project_id  │    │   (auth)    │
│  user_id ◄──┼────┼── user_id ◄─┼────┼─────────────┤
└──────┬──────┘    └──────┬──────┘    └─────────────┘
       │                  │
       │ 1:N              │ 1:N
       ▼                  ▼
┌─────────────────────────────┐
│          clips              │
│  track_id → tracks.id       │
│  asset_id → assets.id       │
│  parent_clip_id → clips.id  │ ← 分割追溯
│  user_id                    │
└─────────────────────────────┘
```

---

## API 设计

### 高频操作优化策略

```
┌──────────────────────────────────────────────────────────┐
│                    前端 (SyncManager)                      │
├──────────────────────────────────────────────────────────┤
│  1. 本地优先：所有操作立即更新本地状态                        │
│  2. 防抖合并：300ms 内的操作合并为一次请求                    │
│  3. 批量同步：一次请求发送多个 operations                     │
│  4. 增量更新：只发送变化的字段                               │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                 后端 API                                   │
├──────────────────────────────────────────────────────────┤
│  PATCH /api/projects/{id}/state                           │
│  {                                                        │
│    "version": 5,                                          │
│    "operations": [                                        │
│      {"type": "ADD_CLIP", "payload": {...}},              │
│      {"type": "UPDATE_CLIP", "payload": {"id": "...", "start": 10}},
│      {"type": "REMOVE_CLIP", "payload": {"id": "..."}}    │
│    ]                                                      │
│  }                                                        │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                 数据库操作                                  │
├──────────────────────────────────────────────────────────┤
│  1. 版本冲突检测                                           │
│  2. 处理每个 operation:                                    │
│     - ADD_CLIP → INSERT INTO clips                        │
│     - UPDATE_CLIP → UPDATE clips SET ...                  │
│     - REMOVE_CLIP → UPDATE clips SET is_deleted=true      │
│  3. 更新 projects.version                                  │
│  4. 返回 new_version                                       │
└──────────────────────────────────────────────────────────┘
```

### 独立 CRUD API

除了增量同步，还提供直接的 CRUD API：

```
# Clips API
GET    /api/clips?project_id=xxx          # 列出所有片段
POST   /api/clips                         # 创建片段
POST   /api/clips/split                   # 分割片段
PATCH  /api/clips/{id}                    # 更新片段
PATCH  /api/clips/{id}/move               # 移动片段
DELETE /api/clips/{id}                    # 删除片段
POST   /api/clips/batch                   # 批量操作
POST   /api/clips/sync                    # 增量同步

# Tracks API
GET    /api/tracks?project_id=xxx         # 列出所有轨道
POST   /api/tracks                        # 创建轨道
PATCH  /api/tracks/{id}                   # 更新轨道
POST   /api/tracks/reorder                # 重新排序
DELETE /api/tracks/{id}                   # 删除轨道
POST   /api/tracks/batch                  # 批量创建
```

---

## 操作类型定义

### Clip Operations

| 类型 | 说明 | Payload |
|------|------|---------|
| ADD_CLIP | 添加片段 | `{id, track_id, asset_id, name, type, start, duration, ...}` |
| UPDATE_CLIP | 更新片段 | `{id, ...changed_fields}` |
| REMOVE_CLIP | 删除片段 | `{id}` or `{clip_id}` |
| MOVE_CLIP | 移动片段 | `{id, track_id, start}` |
| SPLIT_CLIP | 分割片段 | 由 UPDATE_CLIP + ADD_CLIP 组合实现 |

### Track Operations

| 类型 | 说明 | Payload |
|------|------|---------|
| ADD_TRACK | 添加轨道 | `{id, name, type, layer}` |
| UPDATE_TRACK | 更新轨道 | `{id, ...changed_fields}` |
| REMOVE_TRACK | 删除轨道 | `{id}` |
| REORDER_TRACKS | 重排轨道 | `{track_ids: [...]}` |

---

## 分割片段的关联追溯

当用户分割一个片段时：

```
原始片段 (clip-A)
├── asset_id: "original-video"
├── start_time: 0
├── duration: 10
├── source_start: 0
└── source_end: 10

执行分割 (在 5s 处)
          ↓

片段 A (更新后)              片段 B (新建)
├── id: "clip-A"             ├── id: "clip-B"
├── asset_id: "original"     ├── asset_id: "original"  ← 共享原素材
├── start_time: 0            ├── start_time: 5
├── duration: 5              ├── duration: 5
├── source_start: 0          ├── source_start: 5       ← 从 5s 开始
├── source_end: 5            ├── source_end: 10
└── parent_clip_id: null     └── parent_clip_id: "clip-A" ← 追溯来源
```

---

## 前端 Store 更新建议

```typescript
// 分割 Clip 时同时发送两个操作
splitClip: (clipId, splitTime) => {
  const clip = clips.find(c => c.id === clipId);
  const relativeTime = splitTime - clip.start;
  
  const newClipId = `clip-${Date.now()}`;
  
  // 操作 1: 更新原片段
  _addOperation('UPDATE_CLIP', {
    id: clipId,
    duration: relativeTime,
    source_end: clip.source_start + relativeTime,
  });
  
  // 操作 2: 添加新片段
  _addOperation('ADD_CLIP', {
    id: newClipId,
    track_id: clip.trackId,
    asset_id: clip.assetId,
    parent_clip_id: clipId,  // ← 记录分割来源
    start: splitTime,
    duration: clip.duration - relativeTime,
    source_start: clip.source_start + relativeTime,
    source_end: clip.source_end,
    url: clip.mediaUrl,  // 共享同一个视频 URL
    name: `${clip.name}_split`,
  });
}
```

---

## 迁移步骤

1. **运行数据库迁移**
   ```sql
   -- 在 Supabase SQL Editor 中运行
   -- supabase/schema_v4_clips_tracks.sql
   ```

2. **迁移现有数据**
   ```sql
   -- 从 projects.timeline.clips 迁移到 clips 表
   INSERT INTO clips (id, project_id, user_id, ...)
   SELECT ...
   FROM projects, jsonb_array_elements(timeline->'clips') as clip;
   ```

3. **更新前端 Store**
   - 修改 `splitClip` 发送正确的操作
   - 确保所有 clip 操作都通过 `_addOperation` 发送

4. **测试验证**
   - 导入素材 → 检查 clips 表
   - 分割片段 → 检查 parent_clip_id
   - 移动片段 → 检查 track_id 更新
   - 重新加载 → 检查数据恢复

---

## 字段说明

### effects (项目级)
全局效果，应用于整个项目输出：
- 调色/滤镜 (color_grade, lut)
- 全局音量调整
- 导出水印

### markers
时间轴标记点，用于：
- 标记重要位置（精彩片段）
- 章节标记（导出时生成章节）
- TODO 标记（待处理位置）

### duration
项目总时长，可由 clips 计算得出：
```sql
SELECT MAX(start_time + duration) FROM clips 
WHERE project_id = ? AND is_deleted = FALSE;
```

---

## 性能考虑

1. **索引优化**
   - `clips(project_id, is_deleted)` - 常用查询
   - `clips(project_id, start_time)` - 时间轴排序
   - `tracks(project_id, layer)` - 轨道排序

2. **批量操作**
   - 使用 `upsert` 而非 `insert/update` 分开
   - 批量 API 减少网络往返

3. **软删除**
   - `is_deleted = TRUE` 而非物理删除
   - 支持撤销操作
   - 定期清理已删除数据
