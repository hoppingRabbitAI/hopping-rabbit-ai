# 开发规范（统一文档）

> 合并自：前端开发规范 / 后端开发规范 / 前后端交互规范 / 代码审查标准 / 视频加载逻辑和规范
> 
> **严重程度**: 🔴 本文档所有规范均为高优先级，违反将导致数据错误或功能异常

---

## 1. 前后端交互规范

### 1.1 时间单位统一

| 层级 | 单位 | 说明 |
|------|------|------|
| **后端 API** | 秒 (float) | 所有接口时间字段用秒 |
| **前端 Store** | 毫秒 (number) | 内部计算用毫秒 |
| **数据库** | 秒 (float) | 存储用秒 |

**转换示例**：
```typescript
// 前端接收 API 响应
const startTimeMs = apiResponse.start_time * 1000;

// 前端发送 API 请求
const startTimeSec = storeState.startTimeMs / 1000;
```

### 1.2 ID 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| Project | `project-{uuid}` | `project-abc123` |
| Asset | `asset-{uuid}` | `asset-def456` |
| Clip | `clip-{uuid}` | `clip-ghi789` |
| Task | `task-{uuid}` | `task-jkl012` |

### 1.3 API 响应格式

```typescript
// 成功
{ data: T, error: null }

// 失败
{ data: null, error: { code: string, message: string } }
```

---

## 2. 前端开发规范

### 2.1 状态管理（Zustand）

```typescript
// ✅ 正确：使用 immer 修改嵌套状态
set(produce((state) => {
  state.clips[clipId].startTime = newTime;
}));

// ❌ 错误：直接修改
state.clips[clipId].startTime = newTime;
```

### 2.2 异步操作

```typescript
// ✅ 正确：使用 try-catch + loading 状态
const [isLoading, setIsLoading] = useState(false);
try {
  setIsLoading(true);
  await api.saveProject();
} catch (error) {
  toast.error(error.message);
} finally {
  setIsLoading(false);
}
```

### 2.3 组件规范

```typescript
// ✅ 文件命名：PascalCase
// VideoCanvas.tsx, TimelineTrack.tsx

// ✅ 导出方式
export function VideoCanvas() { ... }  // 具名导出

// ✅ Props 类型
interface VideoCanvasProps {
  clipId: string;
  onSeek?: (time: number) => void;
}
```

---

## 3. 后端开发规范

### 3.1 API 路由

```python
# ✅ RESTful 风格
GET    /api/projects/{id}
POST   /api/projects
PUT    /api/projects/{id}
DELETE /api/projects/{id}

# ✅ 嵌套资源
GET    /api/projects/{id}/clips
POST   /api/projects/{id}/clips
```

### 3.2 服务层

```python
# ✅ 服务类模式
class ProjectService:
    async def get_project(self, project_id: str) -> Project:
        ...
    
    async def create_project(self, data: ProjectCreate) -> Project:
        ...
```

### 3.3 错误处理

```python
# ✅ 使用 HTTPException
from fastapi import HTTPException

if not project:
    raise HTTPException(status_code=404, detail="Project not found")
```

---

## 4. 视频加载规范

### 4.1 核心组件

| 组件 | 职责 |
|------|------|
| **VideoResourceManager** | 全局单例，管理 video 元素生命周期 |
| **PlaybackClock** | RAF 驱动的高精度时钟 |
| **VideoCanvasV3** | 纯渲染层，不拥有资源 |

### 4.2 加载流程

```
1. batchCheckHlsAvailability() - 检查 HLS 可用性
2. createVideoForClip() - 创建 video 元素
3. 等待 loadedmetadata 事件
4. seek 到入点
5. 检查缓冲区 ≥ 2s
6. 标记 status = 'ready'
```

### 4.3 视频源决策

| 场景 | 源类型 | 原因 |
|------|--------|------|
| Cloudflare Stream | HLS | 只提供 HLS 流 |
| B-Roll (Pexels) | MP4 | 标准 H.264 |
| HLS 不可用 | MP4 | 回退代理 |

---

## 5. 代码审查清单

### 5.1 最高优先级 🔴

- [ ] 时间单位是否正确转换（秒 ↔ 毫秒）
- [ ] API 响应是否正确解析
- [ ] 异步操作是否有 try-catch
- [ ] 状态更新是否使用 immer

### 5.2 高优先级 🟠

- [ ] 组件是否有 key 属性（列表渲染）
- [ ] useEffect 依赖数组是否完整
- [ ] 是否有内存泄漏（清理函数）
- [ ] 错误边界是否覆盖

### 5.3 中优先级 🟡

- [ ] TypeScript 类型是否完整
- [ ] 命名是否清晰
- [ ] 注释是否充分
- [ ] 代码是否重复

---

## 6. 常见问题

### 6.1 时间单位错误

```typescript
// ❌ 错误：混用单位
clip.startTime = apiResponse.start_time; // API 返回秒，Store 用毫秒

// ✅ 正确
clip.startTimeMs = apiResponse.start_time * 1000;
```

### 6.2 异步状态竞争

```typescript
// ❌ 错误：可能 stale closure
const handleClick = async () => {
  await saveProject();
  console.log(clips); // 可能是旧值
};

// ✅ 正确：使用 ref 或重新获取
const handleClick = async () => {
  await saveProject();
  const latestClips = useEditorStore.getState().clips;
};
```

### 6.3 HLS 加载失败

```typescript
// 自动回退到 MP4
hls.on(Hls.Events.ERROR, (event, data) => {
  if (data.fatal) {
    fallbackToMp4(assetId);
  }
});
```

---

## 7. 详细实现参考

完整规范文档请查看归档：
- [前端开发规范.md](archive/前端开发规范.md)
- [后端开发规范.md](archive/后端开发规范.md)
- [前后端交互规范.md](archive/前后端交互规范.md)
- [代码审查标准.md](archive/代码审查标准.md)
- [视频加载逻辑和规范.md](archive/视频加载逻辑和规范.md)
