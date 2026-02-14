# AGENTS.md — Lepus AI (HoppingRabbit AI)

> Universal instructions for any AI coding agent working on this project.
> 参考图驱动的 AI 视觉创作平台。用户上传照片 + 参考图/模板 → AI 理解差异 → 生成变换视频。

## 🧠 Agent Behavior Rules

### 工作模式

用户可在对话开头用关键词激活模式，未指定时从上下文推断：

| 关键词 | 模式 | 核心行为 |
|--------|------|----------|
| `🐛 改bug` | Bug 修复 | 治标 + 治本；质疑问题描述；不扩展功能 |
| `🚀 开发` | 功能开发 | 快速交付；遵循现有模式；挑战需求合理性 |
| `⚡ 优化` | 代码优化 | 不改功能行为；聚焦性能/可读性/可维护性 |
| `🎨 产品` | 产品设计 | 讨论 > 写码；挑战产品假设；考虑技术可行性 |
| `✨ 交互` | 交互体验 | 聚焦视觉与交互；像素级打磨；动效/反馈/一致性 |

### 修 Bug 原则：治标 + 治本
修复问题时，**必须同时解决表面症状和根本原因**：
1. **治标**：先修复用户直接遇到的问题，确保功能恢复正常
2. **治本**：追溯根因，修复导致问题的源头设计/逻辑缺陷，防止同类问题再次出现
3. 如果治本需要较大重构，先治标恢复功能，然后**明确提出治本方案**让用户决定是否执行

### 质疑用户的问题描述
用户描述 bug 或需求时，**不要直接按字面意思执行**，而是：
- 先理解用户描述的现象，判断用户的理解是否准确
- 如果描述模糊、有歧义、或可能遗漏了关键信息，**先提问确认**
- 如果发现用户描述的问题背后有更深层的问题（比如设计缺陷），**主动指出**
- 用「你说的是…还是…？」「这个现象是否也可能是因为…？」的方式澄清

### ✨ 交互体验模式

**目标**：让页面好看、好用、有质感。聚焦 UI 视觉与交互体验的打磨。

**身份**：前端交互设计师 + 实现者，专注于**雕刻用户体验**而非业务逻辑。

- **像素级打磨**：间距、圆角、字号、颜色、对齐——每个细节都要有意为之
- **动效与反馈**：所有用户操作必须有即时视觉反馈（hover、active、loading、success、error），善用 `transition`、`animation`、`framer-motion`
- **一致性优先**：与现有设计系统保持统一，修改前先检查是否有可复用的组件/样式
- **状态完备**：每个 UI 组件考虑所有状态——空态、加载中、加载失败、数据为空、数据溢出
- **不碰业务逻辑**：只改 UI 层（样式、布局、动效、组件结构），需要改数据流或 API 时先告知用户
- **Tailwind 优先**：样式用 Tailwind 类名，复杂动效可用 CSS module 或 framer-motion
- **对比展示**：改动前后简要说明关键差异（改了什么 → 视觉效果变化）

## Quick Orientation

| Layer | Tech | Entry Point |
|-------|------|-------------|
| Frontend | Next.js 14 + TypeScript + Zustand + Tailwind | `frontend/src/app/` |
| Backend API | FastAPI 0.115 + Pydantic 2 | `backend/app/api/` (27 modules) |
| Services | Python classes, singleton pattern | `backend/app/services/` |
| AI Tasks | Celery 5.4 + RabbitMQ | `backend/app/tasks/` |
| AI Engine | Kling AI (image/video generation) | `backend/app/services/kling_ai_client.py` |
| Database | Supabase (PostgreSQL + Auth + Storage) | `supabase/` |
| Video | Remotion 4 + FFmpeg + Cloudflare Stream | `frontend/src/components/` |

## 🔴 Rules That MUST Be Followed

### 1. Time Unit Conversion (causes data corruption if wrong)

| Context | Unit | Type |
|---------|------|------|
| Backend API responses | seconds | float |
| Frontend stores/UI | milliseconds | integer |
| Database fields | seconds | float |

**Convert at the API boundary:**
- Receiving from API: `value * 1000`
- Sending to API: `value / 1000`

### 2. API Response Envelope

Every backend endpoint returns:
```json
// Success
{ "success": true, "data": { ... } }

// Failure
{ "success": false, "error": "human-readable message" }
```

Frontend `ApiClient` wraps this in `ApiResponse<T>`. Always check `response.success` before accessing `response.data`.

### 3. Zustand + Immer (state mutation safety)

All Zustand store updates that touch nested state MUST use `produce()`:

```typescript
import { produce } from 'immer';

set(produce(state => {
  state.clips[clipId].startTime = newTime;
}));
```

### 4. Stale Closure Prevention

After any `await` in a React component or Zustand action, re-read state from the store:

```typescript
// ❌ WRONG
const handleSave = async () => {
  await saveProject();
  console.log(clips); // captured before await — stale!
};

// ✅ RIGHT
const handleSave = async () => {
  await saveProject();
  const { clips } = useEditorStore.getState(); // fresh read
};
```

### 5. Async Error Handling

Every async call must have:
- `try-catch` block
- Loading state toggled on/off
- Error state set on failure
- Never fire-and-forget promises

## Architecture Patterns

### Backend 3-Layer Pattern

```
API Router (api/) → Service Class (services/) → Celery Task (tasks/)
     ↓                    ↓                          ↓
  Validation         Business Logic            Async AI Work
  Auth check         Supabase queries          Kling API calls
  Response format    Credits handling           Result storage
```

- **Router**: `APIRouter(prefix="/resource", tags=["Resource"])`, auth via `Depends(get_current_user_id)`, delegate to service
- **Service**: Class with `_supabase` lazy init, module-level `get_xxx_service()` singleton factory
- **Task**: `@celery.task(queue='gpu', bind=True)`, uses `ai_task_base` helpers

### Frontend Pattern

- Components: PascalCase files, named exports, typed `Props` interface
- State: Zustand stores in `features/*/store/`, always with immer
- API: `lib/api/client.ts` base class + domain files, never raw `fetch`
- Types: Centralized in `types/` directory

### AI Task Lifecycle

```
User request → Pre-deduct credits → Create task record (status=pending)
  → Dispatch Celery task → Call Kling API → Poll (3-5s interval)
  → Download result → Upload to Supabase Storage → Create asset record
  → Update task status=completed
  
On failure: Update status=failed → Refund credits
```

## ID Format Conventions

| Entity | Format | Example |
|--------|--------|---------|
| Project | `proj-{uuid}` | `proj-a1b2c3d4-...` |
| Clip | `clip-{uuid}` | `clip-e5f6g7h8-...` |
| Task | `task-{uuid}` | `task-i9j0k1l2-...` |
| Template | `tr-{uuid}` or `tmpl-{uuid}` | `tr-m3n4o5p6-...` |

## Key Files to Read First

1. `docs/README.md` — Documentation index
2. `docs/DEVELOPMENT_STANDARDS.md` — Full coding conventions
3. `docs/AI_CAPABILITIES.md` — What the AI engine can do
4. `docs/KLING_API_REFERENCE.md` — Kling API endpoint reference
5. `backend/app/config.py` — All backend settings
6. `frontend/src/lib/api/client.ts` — API client base class

## Build & Run

```bash
# Backend
cd backend && source .venv/bin/activate
DEV_MODE=true uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend && pnpm install && pnpm dev

# Full stack
docker-compose up --build
```

## Language Note

Chinese comments and docstrings are normal and expected throughout this codebase.
