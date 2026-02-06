# 换背景功能改造计划

> 基于 BACKGROUND_REPLACE_WITH_LIPSYNC.md 的技术方案，对现有换背景功能进行改造

## 一、现有代码分析

### 1.1 后端架构

```
backend/app/services/background_replace_workflow.py (1278行)
├── 数据模型
│   ├── WorkflowStage (enum) - 工作流阶段
│   ├── WorkflowStatus (enum) - 工作流状态
│   ├── BackgroundReplaceTask (dataclass) - 任务数据
│   └── 各种中间结果数据类
│
├── Agent 模块（5个阶段）
│   ├── VideoAnalysisAgent - 视频分析（场景、光线、运动）
│   ├── ForegroundSeparationAgent - 前景分离（rembg，TODO: SAM2）
│   ├── BackgroundVideoAgent - 背景视频生成（Kling I2V）⭐ 需要改造
│   ├── IntelligentCompositingAgent - 智能合成
│   └── QualityEnhancementAgent - 质量增强
│
└── BackgroundReplaceWorkflow - 主协调器

backend/app/api/background_replace.py (366行)
├── CreateWorkflowRequest - 请求模型
├── WorkflowResponse - 响应模型
└── API 端点（创建、查询、SSE事件流、取消）
```

### 1.2 前端架构

```
frontend/src/components/visual-editor/workflow/
├── useBackgroundReplaceWorkflow.ts - 工作流 Hook
├── BackgroundReplaceProgress.tsx - 进度展示组件
├── WorkflowCanvas.tsx - 主画布（集成工作流）
├── DrawingCanvas.tsx - 涂抹画布
├── KeyframeEditor.tsx - 关键帧编辑器
└── MultiStepRefineEditor.tsx - 多步骤精修编辑器
```

### 1.3 当前流程

```
用户涂抹区域 → 上传背景图 + 描述 → 调用 API
                                    ↓
                    后端执行5阶段工作流（纯策略A）
                    1. 视频分析
                    2. 前景分离（rembg）
                    3. 背景I2V生成（Kling）
                    4. 智能合成
                    5. 质量增强
                                    ↓
                              返回最终视频
```

**问题**：当前实现只有策略A（纯背景替换），**无法处理用户编辑了人物的场景**。

---

## 二、改造目标

### 2.1 支持两种策略

| 策略 | 触发条件 | 流程 | 口型 |
|-----|---------|-----|-----|
| **策略A** | 用户只编辑背景 | 抠图 → I2V → 合成 | ✅ 保持 |
| **策略B** | 用户编辑了人物 | Motion Control → Lip Sync | ⚠️ 重建 |

### 2.2 改造范围

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           改造范围                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  后端改造                                                                    │
│  ├── [新增] EditDetectionAgent - 编辑检测算法                                │
│  ├── [改造] BackgroundVideoAgent → VideoGenerationAgent                     │
│  │          支持策略A（I2V）和策略B（Motion + LipSync）                       │
│  ├── [新增] LipSyncAgent - 口型同步（调用可灵 Lip Sync）                      │
│  ├── [改造] BackgroundReplaceTask - 增加策略类型字段                         │
│  └── [改造] API 接口 - 支持传递 edit_mask                                    │
│                                                                             │
│  前端改造                                                                    │
│  ├── [改造] DrawingCanvas - 导出用户涂抹的 mask                              │
│  ├── [改造] useBackgroundReplaceWorkflow - 传递 mask 数据                    │
│  ├── [改造] BackgroundReplaceProgress - 根据策略显示不同阶段                  │
│  └── [新增] 策略提示 UI - 检测后告知用户当前策略                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、详细改造计划

### 3.1 后端改造

#### 3.1.1 新增 EditDetectionAgent

```python
# backend/app/services/background_replace_workflow.py

class EditStrategy(str, Enum):
    """编辑策略"""
    BACKGROUND_ONLY = "background_only"      # 策略A：纯背景替换
    PERSON_MINOR_EDIT = "person_minor_edit"  # 策略B-轻度：小配饰
    PERSON_MAJOR_EDIT = "person_major_edit"  # 策略B-重度：换装


@dataclass
class EditDetectionResult:
    """编辑检测结果"""
    strategy: EditStrategy
    edit_on_person_ratio: float    # 编辑区域中落在人物上的比例
    person_edited_ratio: float     # 人物区域被编辑的比例
    confidence: float              # 置信度
    recommendation: str            # 推荐说明


class EditDetectionAgent:
    """
    编辑检测 Agent
    
    职责：
    - 分析用户涂抹区域与人物区域的交集
    - 决定使用策略A还是策略B
    """
    
    async def detect(
        self,
        original_frame_url: str,      # 原始帧
        edited_frame_url: str,        # 用户编辑后的帧
        edit_mask_url: str,           # 用户涂抹的mask（可选，如前端已提供）
        progress_callback: callable = None
    ) -> EditDetectionResult:
        """检测编辑策略"""
        # 实现详见 BACKGROUND_REPLACE_WITH_LIPSYNC.md 第一章
        pass
```

#### 3.1.2 改造 BackgroundReplaceTask

```python
@dataclass
class BackgroundReplaceTask:
    """背景替换任务"""
    id: str
    clip_id: str
    session_id: str
    video_url: str
    background_image_url: str
    prompt: Optional[str]
    
    # [新增] 编辑相关
    edit_mask_url: Optional[str] = None      # 用户涂抹的 mask
    edited_frame_url: Optional[str] = None   # 用户编辑后的帧
    original_audio_url: Optional[str] = None # 原视频音频
    
    # [新增] 策略相关
    detected_strategy: Optional[EditStrategy] = None
    edit_detection: Optional[EditDetectionResult] = None
    
    # ... 其他字段保持不变
```

#### 3.1.3 新增 LipSyncAgent

```python
class LipSyncAgent:
    """
    口型同步 Agent
    
    职责：
    - 调用可灵 Lip Sync API 进行口型同步
    - 处理 identify_face → create_lip_sync_task 流程
    """
    
    def __init__(self):
        from .kling_ai_service import KlingAIClient
        self.kling_client = KlingAIClient()
    
    async def sync_lip(
        self,
        video_url: str,           # 输入视频（Motion Control 输出）
        audio_url: str,           # 音频文件
        progress_callback: callable = None
    ) -> str:
        """执行口型同步，返回最终视频URL"""
        
        # Step 1: 人脸识别
        face_result = await self.kling_client.identify_face(video_url=video_url)
        session_id = face_result.get("session_id")
        face_id = face_result.get("face_data", [{}])[0].get("face_id")
        
        # Step 2: 创建对口型任务
        task = await self.kling_client.create_lip_sync_task(
            session_id=session_id,
            face_id=face_id,
            audio_url=audio_url,
            sound_volume=1.0,
            original_audio_volume=0.0  # 静音原视频
        )
        
        # Step 3: 等待完成
        # ... 轮询逻辑
        
        return final_video_url
```

#### 3.1.4 改造 BackgroundVideoAgent → VideoGenerationAgent

```python
class VideoGenerationAgent:
    """
    视频生成 Agent（重命名自 BackgroundVideoAgent）
    
    职责：
    - 策略A：图生视频（原逻辑）
    - 策略B：Motion Control + Lip Sync
    """
    
    def __init__(self):
        from .kling_ai_service import KlingAIClient
        self.kling_client = KlingAIClient()
        self.lip_sync_agent = LipSyncAgent()
    
    async def generate(
        self,
        task: BackgroundReplaceTask,
        analysis: VideoAnalysisReport,
        progress_callback: callable = None
    ) -> VideoGenerationResult:
        """根据策略生成视频"""
        
        if task.detected_strategy == EditStrategy.BACKGROUND_ONLY:
            return await self._generate_strategy_a(task, analysis, progress_callback)
        else:
            return await self._generate_strategy_b(task, analysis, progress_callback)
    
    async def _generate_strategy_a(self, task, analysis, progress_callback):
        """策略A：纯背景 I2V（保留原逻辑）"""
        # 现有的 BackgroundVideoAgent.generate() 逻辑
        pass
    
    async def _generate_strategy_b(self, task, analysis, progress_callback):
        """策略B：Motion Control + Lip Sync"""
        
        # Step 1: Motion Control - 让编辑后的人物图动起来
        motion_result = await self.kling_client.create_motion_control_task(
            image_url=task.edited_frame_url,     # 用户编辑后的帧
            video_url=task.video_url,            # 原视频提供动作
            character_orientation="video",
            mode="pro",
            options={"keep_original_sound": "yes"}
        )
        
        motion_video_url = await self._poll_motion_task(motion_result)
        
        # Step 2: Lip Sync - 对口型
        final_video_url = await self.lip_sync_agent.sync_lip(
            video_url=motion_video_url,
            audio_url=task.original_audio_url,
            progress_callback=progress_callback
        )
        
        return VideoGenerationResult(
            video_url=final_video_url,
            duration=analysis.duration,
            strategy_used=task.detected_strategy
        )
```

#### 3.1.5 改造 BackgroundReplaceWorkflow 主协调器

```python
class BackgroundReplaceWorkflow:
    """背景替换工作流协调器"""
    
    def __init__(self):
        # 原有 agents
        self.analysis_agent = VideoAnalysisAgent()
        self.separation_agent = ForegroundSeparationAgent()
        self.compositing_agent = IntelligentCompositingAgent()
        self.enhancement_agent = QualityEnhancementAgent()
        
        # [新增/改造]
        self.edit_detection_agent = EditDetectionAgent()
        self.video_generation_agent = VideoGenerationAgent()  # 原 background_agent
    
    async def _execute_workflow(self, task: BackgroundReplaceTask):
        """执行完整工作流"""
        try:
            task.status = WorkflowStatus.RUNNING
            
            # [新增] Stage 0: 编辑检测 (0-5%)
            await self._update_stage(task, WorkflowStage.DETECTING, 0)
            task.edit_detection = await self.edit_detection_agent.detect(
                original_frame_url=task.video_url,  # 需要提取首帧
                edited_frame_url=task.edited_frame_url,
                edit_mask_url=task.edit_mask_url,
                progress_callback=lambda p, m: self._update_progress(task, p, m, 0, 5)
            )
            task.detected_strategy = task.edit_detection.strategy
            
            # 通知前端检测结果
            await self._emit_event(task, "strategy_detected", {
                "strategy": task.detected_strategy.value,
                "confidence": task.edit_detection.confidence,
                "recommendation": task.edit_detection.recommendation
            })
            
            # Stage 1: 视频分析 (5-15%)
            await self._update_stage(task, WorkflowStage.ANALYZING, 5)
            task.analysis = await self.analysis_agent.analyze(...)
            
            # 根据策略走不同分支
            if task.detected_strategy == EditStrategy.BACKGROUND_ONLY:
                await self._execute_strategy_a(task)
            else:
                await self._execute_strategy_b(task)
            
        except Exception as e:
            # 错误处理
            pass
    
    async def _execute_strategy_a(self, task):
        """执行策略A流程"""
        # Stage 2: 前景分离 (15-35%)
        # Stage 3: 背景 I2V (35-65%)
        # Stage 4: 智能合成 (65-85%)
        # Stage 5: 质量增强 (85-100%)
        # ... 保持原有逻辑
    
    async def _execute_strategy_b(self, task):
        """执行策略B流程"""
        # Stage 2: Motion Control (15-50%)
        # Stage 3: Lip Sync (50-80%)
        # Stage 4: 背景合成 (80-90%)
        # Stage 5: 质量增强 (90-100%)
        pass
```

#### 3.1.6 改造 API 接口

```python
# backend/app/api/background_replace.py

class CreateWorkflowRequest(BaseModel):
    """创建工作流请求"""
    clip_id: str
    session_id: str
    video_url: str
    background_image_url: str
    prompt: Optional[str] = None
    
    # [新增] 编辑相关
    edit_mask_url: Optional[str] = None      # 用户涂抹区域 mask
    edited_frame_url: Optional[str] = None   # 用户编辑后的完整帧
    original_audio_url: Optional[str] = None # 原视频音频 URL
    
    # [新增] 策略覆盖（可选，让用户强制选择策略）
    force_strategy: Optional[str] = None     # "background_only" | "person_edit"
```

### 3.2 前端改造

#### 3.2.1 改造 DrawingCanvas - 导出 Mask

```typescript
// frontend/src/components/visual-editor/workflow/DrawingCanvas.tsx

interface DrawingCanvasProps {
  // ... 现有 props
  onMaskExport?: (maskDataUrl: string) => void;  // [新增] mask 导出回调
}

// 在用户完成涂抹后，导出 mask 为 base64
const exportMask = () => {
  const canvas = canvasRef.current;
  const maskDataUrl = canvas.toDataURL('image/png');
  onMaskExport?.(maskDataUrl);
};
```

#### 3.2.2 改造 useBackgroundReplaceWorkflow

```typescript
// frontend/src/components/visual-editor/workflow/useBackgroundReplaceWorkflow.ts

export interface WorkflowState {
  // ... 现有字段
  
  // [新增] 策略相关
  detectedStrategy?: 'background_only' | 'person_minor_edit' | 'person_major_edit';
  strategyConfidence?: number;
  strategyRecommendation?: string;
}

const startWorkflow = useCallback(async (params: {
  sessionId: string;
  clipId: string;
  videoUrl: string;
  backgroundImageUrl: string;
  originalPrompt?: string;
  previewImageUrl?: string;
  
  // [新增]
  editMaskUrl?: string;        // mask 图片 URL
  editedFrameUrl?: string;     // 编辑后的帧
  originalAudioUrl?: string;   // 原音频
  forceStrategy?: string;      // 强制策略
}): Promise<string> => {
  // ... 调用 API
});
```

#### 3.2.3 改造 BackgroundReplaceProgress

```typescript
// frontend/src/components/visual-editor/workflow/BackgroundReplaceProgress.tsx

// 策略A的阶段
const STRATEGY_A_STAGES = [
  { id: 'detecting', name: '编辑检测', icon: Scan },
  { id: 'analyzing', name: '视频分析', icon: FileVideo },
  { id: 'separating', name: '人物分离', icon: Layers },
  { id: 'generating', name: '背景生成', icon: Wand2 },
  { id: 'compositing', name: '智能合成', icon: Blend },
  { id: 'enhancing', name: '质量增强', icon: Sparkles },
];

// 策略B的阶段
const STRATEGY_B_STAGES = [
  { id: 'detecting', name: '编辑检测', icon: Scan },
  { id: 'analyzing', name: '视频分析', icon: FileVideo },
  { id: 'motion', name: '动作迁移', icon: Move },      // 不同
  { id: 'lipsync', name: '口型同步', icon: Mic },      // 不同
  { id: 'compositing', name: '背景合成', icon: Blend },
  { id: 'enhancing', name: '质量增强', icon: Sparkles },
];

// 根据检测到的策略动态选择阶段列表
const stages = detectedStrategy === 'background_only' 
  ? STRATEGY_A_STAGES 
  : STRATEGY_B_STAGES;
```

#### 3.2.4 新增策略提示 UI

```typescript
// 在检测完成后显示策略提示

{strategyDetected && (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
    <div className="flex items-center gap-2">
      {detectedStrategy === 'background_only' ? (
        <>
          <CheckCircle className="text-green-500" />
          <span>检测到仅编辑背景，将保持原始口型和动作</span>
        </>
      ) : (
        <>
          <AlertCircle className="text-amber-500" />
          <span>检测到编辑了人物区域，将使用 AI 重建口型</span>
        </>
      )}
    </div>
    <p className="text-sm text-gray-600 mt-1">{strategyRecommendation}</p>
  </div>
)}
```

---

## 四、数据流改造

### 4.1 改造后的完整数据流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           改造后的数据流                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  前端                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  用户涂抹区域                                                        │   │
│  │       │                                                             │   │
│  │       ▼                                                             │   │
│  │  DrawingCanvas.exportMask() ──────────────┐                         │   │
│  │       │                                   │                         │   │
│  │       ▼                                   ▼                         │   │
│  │  上传 mask 到存储              用户输入描述 + 参考图                  │   │
│  │       │                                   │                         │   │
│  │       └───────────────┬───────────────────┘                         │   │
│  │                       ▼                                             │   │
│  │              useBackgroundReplaceWorkflow.startWorkflow({           │   │
│  │                videoUrl,                                            │   │
│  │                backgroundImageUrl,                                  │   │
│  │                editMaskUrl,        ← [新增]                         │   │
│  │                editedFrameUrl,     ← [新增]                         │   │
│  │                originalAudioUrl    ← [新增]                         │   │
│  │              })                                                     │   │
│  │                       │                                             │   │
│  └───────────────────────│─────────────────────────────────────────────┘   │
│                          │                                                  │
│                          ▼ POST /api/background-replace/workflows           │
│                                                                             │
│  后端                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  ┌────────────────────────────────────────────────────────────┐    │   │
│  │  │               Stage 0: 编辑检测                             │    │   │
│  │  │  EditDetectionAgent.detect(original, edited, mask)         │    │   │
│  │  │                     ↓                                      │    │   │
│  │  │  返回 EditStrategy: BACKGROUND_ONLY / PERSON_EDIT          │    │   │
│  │  └────────────────────────────────────────────────────────────┘    │   │
│  │                          │                                         │   │
│  │           ┌──────────────┴──────────────┐                          │   │
│  │           ▼                             ▼                          │   │
│  │  ┌─────────────────┐           ┌─────────────────┐                 │   │
│  │  │ 策略A Pipeline  │           │ 策略B Pipeline  │                 │   │
│  │  │                 │           │                 │                 │   │
│  │  │ 1. 视频分析     │           │ 1. 视频分析     │                 │   │
│  │  │ 2. 前景分离     │           │ 2. Motion Ctrl  │ ← Kling         │   │
│  │  │ 3. I2V 生成     │ ← Kling   │ 3. Lip Sync     │ ← Kling         │   │
│  │  │ 4. 智能合成     │           │ 4. 背景合成     │                 │   │
│  │  │ 5. 质量增强     │           │ 5. 质量增强     │                 │   │
│  │  └─────────────────┘           └─────────────────┘                 │   │
│  │           │                             │                          │   │
│  │           └──────────────┬──────────────┘                          │   │
│  │                          ▼                                         │   │
│  │                    最终视频 URL                                     │   │
│  │                          │                                         │   │
│  │                          ▼ SSE 事件流                               │   │
│  └──────────────────────────│─────────────────────────────────────────┘   │
│                             │                                              │
│                             ▼                                              │
│  前端 SSE 监听 → 更新进度 → 展示结果                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 五、实施步骤

### Phase 1: 后端核心改造（预计 2-3 天）

| 步骤 | 任务 | 文件 | 优先级 |
|-----|------|------|-------|
| 1.1 | 添加 EditStrategy 枚举和 EditDetectionResult | background_replace_workflow.py | P0 |
| 1.2 | 实现 EditDetectionAgent | background_replace_workflow.py | P0 |
| 1.3 | 实现 LipSyncAgent | background_replace_workflow.py | P0 |
| 1.4 | 改造 BackgroundVideoAgent → VideoGenerationAgent | background_replace_workflow.py | P0 |
| 1.5 | 改造 BackgroundReplaceTask 数据模型 | background_replace_workflow.py | P0 |
| 1.6 | 改造 BackgroundReplaceWorkflow 协调器 | background_replace_workflow.py | P0 |
| 1.7 | 更新 API 请求/响应模型 | background_replace.py | P0 |

### Phase 2: 前端改造（预计 1-2 天）

| 步骤 | 任务 | 文件 | 优先级 |
|-----|------|------|-------|
| 2.1 | DrawingCanvas 导出 mask 功能 | DrawingCanvas.tsx | P0 |
| 2.2 | 更新 useBackgroundReplaceWorkflow Hook | useBackgroundReplaceWorkflow.ts | P0 |
| 2.3 | 更新 BackgroundReplaceProgress 组件 | BackgroundReplaceProgress.tsx | P1 |
| 2.4 | 添加策略提示 UI | WorkflowCanvas.tsx | P1 |

### Phase 3: 测试与优化（预计 1-2 天）

| 步骤 | 任务 |
|-----|------|
| 3.1 | 策略A 端到端测试 |
| 3.2 | 策略B 端到端测试 |
| 3.3 | 边缘情况测试（边缘编辑、小面积编辑等） |
| 3.4 | 性能优化 |

---

## 六、风险与应对

| 风险 | 影响 | 应对措施 |
|-----|------|---------|
| 可灵 Motion Control API 不稳定 | 策略B 失败 | 添加重试机制，降级到策略A |
| 编辑检测误判 | 用户体验差 | 允许用户手动覆盖策略选择 |
| Lip Sync 口型不自然 | 视频质量差 | 提供人工审核入口 |
| 前端 mask 导出格式问题 | 检测失败 | 统一 mask 格式为 PNG |

---

## 七、验收标准

### 策略A 验收
- [ ] 用户只涂抹背景区域时，自动检测为策略A
- [ ] 使用 I2V 生成动态背景
- [ ] 人物口型和动作 100% 保持
- [ ] 前端显示正确的阶段进度

### 策略B 验收
- [ ] 用户涂抹人物区域时，自动检测为策略B
- [ ] 正确调用 Motion Control API
- [ ] 正确调用 Lip Sync API
- [ ] 口型与音频同步
- [ ] 前端显示正确的阶段进度

### 通用验收
- [ ] 策略检测置信度显示
- [ ] 允许用户覆盖策略选择
- [ ] 错误情况正确处理和提示
- [ ] SSE 事件流正常工作
