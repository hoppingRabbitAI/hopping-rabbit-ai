# 任务历史记录功能设计

## 1. 概述

在编辑器右上角添加一个按钮，点击后展示侧边栏，显示所有 AI 任务的执行历史。

## 2. 治标方案（快速实现）

### 2.1 前端组件

```
┌─────────────────────────────────────────────────────────────┐
│ Header                                               [📋] ← │
├─────────────────────────────────────────────────────────────┤
│                                                    ┌───────┐│
│                                                    │任务历史││
│                                                    ├───────┤│
│  Canvas / Timeline                                 │ 任务1 ││
│                                                    │ 任务2 ││
│                                                    │ ...   ││
│                                                    └───────┘│
└─────────────────────────────────────────────────────────────┘
```

### 2.2 组件结构

- `TaskHistoryButton.tsx` - 右上角的触发按钮
- `TaskHistorySidebar.tsx` - 侧边栏主体
- `TaskHistoryItem.tsx` - 单个任务项

### 2.3 数据获取

使用现有的 `/api/tasks` 接口，按 `project_id` 过滤

## 3. 治本方案（完整设计）

### 3.1 数据模型增强

```sql
-- 任务与素材/片段的关联关系
CREATE TABLE task_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  target_type TEXT NOT NULL,  -- 'clip', 'asset', 'shot'
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX idx_task_targets_task ON task_targets(task_id);
CREATE INDEX idx_task_targets_target ON task_targets(target_type, target_id);
```

### 3.2 API 设计

```
GET /api/tasks/history
  ?project_id=xxx     # 按项目过滤
  &target_type=clip   # 按目标类型过滤
  &target_id=xxx      # 按目标 ID 过滤
  &status=completed   # 按状态过滤
  &page=1
  &page_size=20

Response:
{
  "tasks": [
    {
      "id": "task-uuid",
      "task_type": "background_replace",
      "status": "completed",
      "progress": 100,
      "status_message": "完成",
      "input_summary": "替换背景: 蓝天白云",
      "output_preview": "https://...",
      "target": {
        "type": "clip",
        "id": "clip-uuid",
        "name": "片段 1"
      },
      "created_at": "2026-02-05T10:00:00Z",
      "completed_at": "2026-02-05T10:05:00Z",
      "credits_used": 10
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 100
  }
}
```

### 3.3 前端状态管理

```typescript
// stores/taskHistoryStore.ts
interface TaskHistoryState {
  isOpen: boolean;
  tasks: TaskHistoryItem[];
  isLoading: boolean;
  error: string | null;
  filter: TaskHistoryFilter;
  
  // Actions
  toggle: () => void;
  open: () => void;
  close: () => void;
  fetch: (projectId: string) => Promise<void>;
  setFilter: (filter: Partial<TaskHistoryFilter>) => void;
}
```

### 3.4 任务类型映射

```typescript
const TASK_TYPE_LABELS: Record<string, string> = {
  'background_replace': '背景替换',
  'lip_sync': '口型同步',
  'text_to_video': '文生视频',
  'image_to_video': '图生视频',
  'face_swap': '换脸',
  'voice_enhance': '声音优化',
  'style_transfer': '风格迁移',
  'asr': '语音转文字',
  'stem_separation': '人声分离',
};

const TASK_STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  'pending': { label: '排队中', color: 'gray', icon: 'Clock' },
  'processing': { label: '处理中', color: 'blue', icon: 'Loader' },
  'completed': { label: '已完成', color: 'green', icon: 'Check' },
  'failed': { label: '失败', color: 'red', icon: 'X' },
  'cancelled': { label: '已取消', color: 'gray', icon: 'Ban' },
};
```

## 4. 实现优先级

### Phase 1: MVP（治标）
1. ✅ 创建 TaskHistoryButton 组件
2. ✅ 创建 TaskHistorySidebar 组件
3. ✅ 集成到 Header
4. ✅ 使用现有 /api/tasks 接口

### Phase 2: 增强（治本）
1. 添加任务目标关联表
2. 增强 API 返回更多上下文
3. 添加筛选功能
4. 添加任务详情弹窗
5. 支持重试失败任务
6. 支持从历史应用到新素材

## 5. UI/UX 规范

### 5.1 按钮样式
- 图标：Clock 或 History
- 位置：导出按钮左侧
- 有未完成任务时显示数量徽章

### 5.2 侧边栏样式
- 宽度：320px
- 从右侧滑入
- 半透明遮罩背景
- 点击外部关闭

### 5.3 任务项样式
- 左侧：任务类型图标
- 中间：任务名称 + 状态
- 右侧：时间 + 操作菜单
- 进行中任务显示进度条
