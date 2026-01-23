# 智能一键成片 V2 - 技术设计文档

> 版本: 2.0.0  
> 日期: 2026-01-15  
> 作者: @hexiangyang

---

## 一、核心目标

帮助口播类创作者解决**口癖、口吃、重复表达**等问题，提供智能筛选和用户选择机制，让最终成片更加流畅专业。

### 1.1 设计原则

| 原则 | 说明 |
|------|------|
| **🤖 LLM 优先** | 能在 LLM+ASR 环节做掉的就不要拆到后面，让模型承担更多智能责任 |
| **👁️ 用户感知度** | 用户能清晰看到当前进展到哪个阶段，知道系统在做什么 |
| **⚡ 效率为王** | 后台高效执行，减少用户决策负担，推荐优先，一键接受 |

### 1.2 用户痛点

| 痛点 | 描述 | 目标解决方案 |
|------|------|--------------|
| 口癖/口吃 | 说话时有"嗯"、"那个"、重复词等 | 智能识别并标记，用户一键删除 |
| 重复表达 | 同一句话说了多遍，不知道选哪个 | 识别重复片段，让用户选择最佳版本 |
| 脱稿偏差 | 有稿但说的和稿子不一致 | 对比脚本，高亮偏差内容 |
| 节奏不适 | 缩放节奏与视频风格不匹配 | 智能分析视频风格，自适应缩放节奏 |
| 等待焦虑 | 处理时间长，不知道在干嘛 | 清晰的阶段进度，知道当前在做什么 |

---

## 二、整体架构

### 2.1 LLM 优先架构

**核心思路**：将智能分析前置到 ASR 环节，一次 LLM 调用完成所有分析，而不是拆成多个独立步骤。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     一键成片 V2 - LLM 优先处理流程                          │
└─────────────────────────────────────────────────────────────────────────────┘

     ┌─────────────────────────────────────────────────────────────────────┐
     │                    Phase 1: 并行预处理 (后台)                        │
     │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐   │
     │  │ Whisper  │  │   VAD    │  │ 音频特征 │  │ 视频缩略图/场景  │   │
     │  │ ASR 转写 │  │ 静音检测 │  │ 语速情感 │  │ (用于预览展示)   │   │
     │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬──────────┘   │
     │       │              │              │                 │              │
     │       └──────────────┴──────────────┴─────────────────┘              │
     │                              │                                        │
     └──────────────────────────────┼────────────────────────────────────────┘
                                    ▼
     ┌─────────────────────────────────────────────────────────────────────┐
     │              Phase 2: LLM 一站式智能分析 (核心)                      │
     │  ┌─────────────────────────────────────────────────────────────────┐│
     │  │                    🧠 Super Prompt                              ││
     │  │  输入:                                                          ││
     │  │  • ASR 转写结果 + 时间戳                                        ││
     │  │  • 用户脚本 (如有)                                              ││
     │  │  • 音频特征 (语速/停顿/情感)                                    ││
     │  │                                                                 ││
     │  │  一次调用完成:                                                  ││
     │  │  ✅ 脚本对齐 (有脚本模式)                                       ││
     │  │  ✅ 废话/口癖识别                                               ││
     │  │  ✅ 重复片段检测 + 最佳版本推荐                                 ││
     │  │  ✅ 风格分析 + 缩放节奏推荐                                     ││
     │  │  ✅ 每个片段的分类和置信度                                      ││
     │  └─────────────────────────────────────────────────────────────────┘│
     └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
     ┌─────────────────────────────────────────────────────────────────────┐
     │                  Phase 3: 用户审核界面 (体验优化)                    │
     │  • 分析完成后一次性展示结果                                          │
     │  • 视频预览式选择 (悬停即播放)                                       │
     │  • 一键接受推荐 (90%用户直接点确认)                                  │
     │  • 精细调整 (10%用户需要微调)                                        │
     └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
     ┌─────────────────────────────────────────────────────────────────────┐
     │                       Phase 4: 编辑器微调                            │
     │  • 基于风格分析的自适应缩放动画已应用                                │
     │  • 字幕已生成                                                        │
     │  • 用户只需微调，不需要从零开始                                      │
     └─────────────────────────────────────────────────────────────────────┘
```

### 2.2 为什么是 LLM 优先？

| 传统方案 | LLM 优先方案 | 优势 |
|----------|--------------|------|
| ASR → 规则引擎 → LLM分类 → LLM风格 | ASR → **一次LLM调用** | 减少延迟，逻辑集中 |
| 多次网络请求，多次等待 | 一次请求，后台高效执行 | 整体耗时更短 |
| 各模块结果需要合并对齐 | LLM 内部自洽 | 结果一致性更好 |
| 规则引擎需要大量人工维护 | 模型自动适应 | 维护成本低 |

---

## 三、LLM 一站式分析 (核心模块)

### 3.1 设计理念

**核心原则**：一次 LLM 调用，完成所有智能分析任务。不再拆分成脚本对齐器、废话识别器、风格分析器等独立模块。

**为什么这样设计**：
1. **减少延迟**：一次请求 vs 3-4次请求
2. **内部自洽**：LLM 自己判断的结果不会有逻辑冲突
3. **上下文完整**：所有信息在一个 Prompt 里，判断更准确
4. **流式友好**：可以边生成边返回，前端边接收边渲染

### 3.2 Super Prompt 设计

```python
# backend/app/services/smart_analyzer.py

SUPER_ANALYSIS_PROMPT = """
# 角色
你是专业的口播视频内容分析师。你需要一次性完成所有分析任务，输出结构化的分析结果。

# 输入数据

## ASR 转写结果 (带时间戳)
```json
{transcript_json}
```

## 用户脚本 (可选，如果用户提供了)
{script_or_none}

## 音频特征
- 视频时长: {duration}秒
- 平均语速: {speech_rate} 字/分钟
- 停顿分布: {pause_info}

# 你的任务 (一次性完成以下所有分析)

## 任务1: 片段分类
对每个 ASR 片段进行分类：
- `keep` - 有效内容，直接保留
- `delete` - 废话/口癖，建议删除
- `choose` - 需要用户选择（通常是重复片段）

## 任务2: 废话识别
识别以下类型的废话：
- 口癖词：嗯、啊、那个、就是说、对吧
- 无意义重复：同一个词连说两遍
- 中断重启：说到一半重新说
- 自我纠正：口误后的纠正（保留纠正后的版本）

## 任务3: 重复片段检测
识别用户对同一句话录了多遍的情况：
- 标记为同一个 repeat_group
- 推荐最佳版本（语速自然、无口误、情绪到位）
- 说明推荐理由

## 任务4: 脚本对齐 (如果有脚本)
- 找出转写内容与脚本的对应关系
- 标记：matched(匹配) / deviation(偏离) / improvisation(即兴)
- 计算脚本完成度

## 任务5: 风格分析与缩放推荐
判断视频风格并推荐缩放参数：
- energetic_vlog: 活力vlog，缩放快速有力 (300ms, 1.0-1.4x)
- tutorial: 教程讲解，缩放平滑稳定 (500ms, 1.0-1.2x)  
- storytelling: 故事叙述，缩放缓慢沉浸 (800ms, 1.0-1.15x)
- news_commentary: 新闻评论，缩放中等强调 (400ms, 1.0-1.25x)

# 输出格式 (严格JSON)
```json
{
  "segments": [
    {
      "id": "seg_001",
      "start": 0.0,
      "end": 3.2,
      "text": "大家好，我是xxx",
      "action": "keep",
      "classification": "matched",
      "confidence": 0.95,
      "script_match": "大家好，我是xxx",
      "repeat_group_id": null,
      "filler_words": [],
      "quality_score": 0.9
    },
    {
      "id": "seg_002",
      "start": 3.2,
      "end": 4.1,
      "text": "嗯那个",
      "action": "delete",
      "classification": "filler",
      "confidence": 0.98,
      "filler_words": ["嗯", "那个"],
      "reason": "纯口癖词，无实际内容"
    },
    {
      "id": "seg_003",
      "start": 4.1,
      "end": 8.5,
      "text": "今天给大家分享一个技巧",
      "action": "choose",
      "classification": "repeat",
      "confidence": 0.92,
      "repeat_group_id": "group_intro",
      "is_recommended": false,
      "quality_score": 0.75,
      "quality_notes": "语速偏快，有轻微口误"
    }
  ],
  
  "repeat_groups": [
    {
      "id": "group_intro",
      "intent": "开场介绍今天的主题",
      "script_match": "今天给大家分享一个技巧",
      "segment_ids": ["seg_003", "seg_006", "seg_009"],
      "recommended_id": "seg_006",
      "recommend_reason": "语速适中，表达流畅，情绪自然"
    }
  ],
  
  "style_analysis": {
    "detected_style": "tutorial",
    "confidence": 0.88,
    "reasoning": "语速180字/分钟适中，停顿规律，内容有逻辑结构",
    "zoom_recommendation": {
      "rhythm": "smooth",
      "scale_range": [1.0, 1.2],
      "duration_ms": 500,
      "easing": "ease_in_out",
      "triggers": ["key_point", "new_topic"]
    }
  },
  
  "summary": {
    "total_segments": 25,
    "keep": 18,
    "delete": 5,
    "choose": 2,
    "repeat_groups": 1,
    "script_coverage": 0.92,
    "estimated_duration_after": 180,
    "reduction_percent": 28
  }
}
```
"""
```

### 3.3 后端实现

```python
# backend/app/services/smart_analyzer.py

class SmartAnalyzer:
    """一站式智能分析器 - LLM 优先"""
    
    def __init__(self, llm_service: LLMService):
        self.llm = llm_service
    
    async def analyze(
        self,
        transcript_segments: list[TranscriptSegment],
        script: Optional[str] = None,
        audio_features: Optional[AudioFeatures] = None,
        video_duration: float = 0
    ) -> AnalysisResult:
        """
        一次 LLM 调用完成所有分析
        
        特点：
        1. 所有分析任务在一个 Prompt 中完成
        2. 支持流式返回，前端可以边接收边展示
        3. 结果内部自洽，无需后续合并
        """
        
        # 构建输入
        transcript_json = json.dumps([{
            "id": f"seg_{i:03d}",
            "start": seg.start,
            "end": seg.end,
            "text": seg.text
        } for i, seg in enumerate(transcript_segments)], ensure_ascii=False)
        
        script_or_none = f'"""\n{script}\n"""' if script else "无（用户未提供脚本）"
        
        # 构建 Prompt
        prompt = SUPER_ANALYSIS_PROMPT.format(
            transcript_json=transcript_json,
            script_or_none=script_or_none,
            duration=video_duration,
            speech_rate=audio_features.speech_rate if audio_features else "未知",
            pause_info=audio_features.pause_summary if audio_features else "未知"
        )
        
        # 一次 LLM 调用，后台高效执行
        response = await self.llm.chat(
            prompt,
            response_format="json"
        )
        
        return self._parse_result(response)
```

### 3.4 阶段进度推送

**设计理念**：用户不需要看到每个片段的分析过程，只需要知道当前在哪个阶段。

```python
# backend/app/services/smart_analyzer.py

class ProcessingStage(Enum):
    """处理阶段枚举"""
    UPLOADING = ("uploading", "📤 上传中...", 0)
    TRANSCRIBING = ("transcribing", "🎤 语音转写中...", 20)
    ANALYZING = ("analyzing", "🧠 AI 智能分析中...", 50)
    GENERATING = ("generating", "✨ 生成推荐方案...", 80)
    COMPLETED = ("completed", "✅ 分析完成！", 100)
    
    def __init__(self, stage_id: str, message: str, progress: int):
        self.stage_id = stage_id
        self.message = message
        self.progress = progress


async def process_with_stages(
    project_id: str,
    update_progress: Callable[[ProcessingStage], None]
) -> AnalysisResult:
    """
    分阶段处理，每完成一个阶段推送进度
    
    Args:
        project_id: 项目ID
        update_progress: 进度更新回调（更新数据库/WebSocket）
    """
    
    # 阶段1: 语音转写
    update_progress(ProcessingStage.TRANSCRIBING)
    transcript = await transcribe_video(project_id)
    
    # 阶段2: LLM 智能分析（一次调用完成所有分析）
    update_progress(ProcessingStage.ANALYZING)
    analysis = await smart_analyzer.analyze(
        transcript_segments=transcript.segments,
        script=project.script,
        audio_features=transcript.audio_features
    )
    
    # 阶段3: 生成推荐方案
    update_progress(ProcessingStage.GENERATING)
    result = await generate_recommendations(analysis)
    
    # 完成
    update_progress(ProcessingStage.COMPLETED)
    return result
```

### 3.5 前端轮询进度

```typescript
// frontend/src/features/workspace/useProcessingProgress.ts

interface ProcessingProgress {
  stage: 'uploading' | 'transcribing' | 'analyzing' | 'generating' | 'completed';
  message: string;
  progress: number;  // 0-100
}

export function useProcessingProgress(projectId: string) {
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  
  useEffect(() => {
    // 轮询获取进度（每2秒）
    const interval = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}/progress`);
      const data = await res.json();
      setProgress(data);
      
      // 完成后停止轮询
      if (data.stage === 'completed') {
        clearInterval(interval);
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [projectId]);
  
  return progress;
}
```
        )
```

### 3.4 风格模板定义

```python
# 风格模板 - 内置在 Prompt 中，但也可作为后备校验

STYLE_TEMPLATES = {
    'energetic_vlog': {
        'name': '活力 Vlog',
        'description': '语速快、情绪高、节奏紧凑',
        'zoom_style': {
            'rhythm': 'punchy',
            'scale_range': (1.0, 1.4),
            'duration_ms': 300,
            'easing': 'ease_out',
            'triggers': ['emphasis', 'exclamation', 'punchline']
        }
    },
    'tutorial': {
        'name': '教程讲解',
        'description': '语速适中、逻辑清晰、节奏稳定',
        'zoom_style': {
            'rhythm': 'smooth',
            'scale_range': (1.0, 1.2),
            'duration_ms': 500,
            'easing': 'ease_in_out',
            'triggers': ['key_point', 'new_topic', 'transition']
        }
    },
    'storytelling': {
        'name': '故事叙述',
        'description': '语速慢、情感丰富、娓娓道来',
        'zoom_style': {
            'rhythm': 'minimal',
            'scale_range': (1.0, 1.15),
            'duration_ms': 800,
            'easing': 'ease_in_out',
            'triggers': ['emotional_peak', 'conclusion', 'pause']
        }
    },
    'news_commentary': {
        'name': '新闻评论',
        'description': '语速适中、观点鲜明、有节奏感',
        'zoom_style': {
            'rhythm': 'punchy',
            'scale_range': (1.0, 1.25),
            'duration_ms': 400,
            'easing': 'ease_out',
            'triggers': ['new_point', 'emphasis', 'conclusion']
        }
    }
}
```

---

## 四、用户审核界面设计 (体验优化重点)

### 4.1 设计原则

| 原则 | 具体做法 |
|------|----------|
| **减少等待焦虑** | 流式展示分析结果，边分析边看到 |
| **推荐优先** | 90%用户直接"接受推荐"一键确认 |
| **预览式交互** | 悬停即播放，不用点击就能试听 |
| **批量操作** | 一键删除所有废话，一键使用推荐 |
| **撤销友好** | 任何操作都可撤销，降低决策压力 |

### 4.2 阶段进度展示

**核心思路**：用户只需要知道当前在哪个阶段，不需要看到每个片段的分析细节。

```typescript
// frontend/src/features/workspace/ProcessingView.tsx

const STAGES = [
  { id: 'uploading', icon: '📤', text: '上传中...', progress: 0 },
  { id: 'transcribing', icon: '🎤', text: '语音转写中...', progress: 20 },
  { id: 'analyzing', icon: '🧠', text: 'AI 智能分析中...', progress: 50 },
  { id: 'generating', icon: '✨', text: '生成推荐方案...', progress: 80 },
  { id: 'completed', icon: '✅', text: '分析完成！', progress: 100 },
];

export function ProcessingView({ projectId }: Props) {
  const progress = useProcessingProgress(projectId);
  
  if (!progress) return <Loading />;
  
  // 分析完成，跳转到审核页面
  if (progress.stage === 'completed') {
    return <ReviewView projectId={projectId} />;
  }
  
  const currentStage = STAGES.find(s => s.id === progress.stage);
  const completedStages = STAGES.filter(s => s.progress < progress.progress);
  
  return (
    <div className="processing-view">
      {/* 进度条 */}
      <div className="progress-bar">
        <div 
          className="progress-fill"
          style={{ width: `${progress.progress}%` }}
        />
      </div>
      
      {/* 阶段列表 - 显示已完成和当前阶段 */}
      <div className="stages">
        {STAGES.map(stage => (
          <div 
            key={stage.id}
            className={cn(
              "stage",
              stage.progress < progress.progress && "completed",
              stage.id === progress.stage && "current"
            )}
          >
            <span className="icon">{stage.icon}</span>
            <span className="text">{stage.text}</span>
            {stage.progress < progress.progress && <span className="check">✓</span>}
          </div>
        ))}
      </div>
      
      {/* 当前阶段提示 */}
      <div className="current-stage">
        <span className="icon">{currentStage?.icon}</span>
        <span className="message">{currentStage?.text}</span>
      </div>
    </div>
  );
}
```

### 4.3 审核页面（分析完成后展示）

```typescript
// frontend/src/features/workspace/ReviewView.tsx

export function ReviewView({ projectId }: Props) {
  // 分析完成后，一次性获取所有结果
  const { data: analysisResult, isLoading } = useQuery(
    ['analysis', projectId],
    () => fetchAnalysisResult(projectId)
  );
  
  if (isLoading) return <Loading />;
  
  return (
    <div className="review-view">
      {/* 统计摘要 */}
      <ReviewSummary summary={analysisResult.summary} />
      
      {/* 片段列表 */}
      <SegmentList 
        segments={analysisResult.segments}
        repeatGroups={analysisResult.repeatGroups}
      />
      
      {/* 底部操作栏 */}
      <ActionBar onConfirm={handleConfirm} />
    </div>
  );
}
```

### 4.4 进度展示样式

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│     ████████████████████░░░░░░░░░░░░░░░░░░░░  50%              │
│                                                                 │
│     ✓ 📤 上传完成                                               │
│     ✓ 🎤 语音转写完成                                           │
│     → 🧠 AI 智能分析中...                                       │
│       ✨ 生成推荐方案                                           │
│       ✅ 分析完成                                               │
│                                                                 │
│     🧠 AI 正在理解视频内容，分析废话和重复片段...               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 悬停预览交互

```typescript
// frontend/src/features/workspace/SegmentCard.tsx

export function SegmentCard({ segment, isSelected, onSelect }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  
  // 悬停时自动播放预览
  const handleMouseEnter = () => {
    setIsHovering(true);
    if (videoRef.current) {
      videoRef.current.currentTime = segment.start;
      videoRef.current.play();
    }
  };
  
  const handleMouseLeave = () => {
    setIsHovering(false);
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };
  
  return (
    <div 
      className={cn(
        "segment-card",
        segment.action === 'delete' && "marked-delete",
        segment.action === 'keep' && "marked-keep",
        isSelected && "selected"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => onSelect(segment.id)}
    >
      {/* 视频缩略图/预览 */}
      <div className="preview-area">
        {isHovering ? (
          <video 
            ref={videoRef}
            src={videoUrl}
            className="preview-video"
            muted={false}
          />
        ) : (
          <img 
            src={segment.thumbnailUrl} 
            className="thumbnail"
          />
        )}
        <div className="duration">{formatDuration(segment.end - segment.start)}</div>
      </div>
      
      {/* 内容信息 */}
      <div className="content-area">
        <div className="text">"{segment.text}"</div>
        <div className="meta">
          <span className="time">{formatTime(segment.start)}</span>
          <ClassificationBadge type={segment.classification} />
        </div>
      </div>
      
      {/* 操作按钮 */}
      <div className="action-area">
        <ActionButton 
          action={segment.action}
          onChange={(action) => handleActionChange(segment.id, action)}
        />
      </div>
    </div>
  );
}
```

### 4.5 一键操作设计

```typescript
// frontend/src/features/workspace/ActionBar.tsx

export function ActionBar({ 
  summary, 
  onAcceptRecommendations,
  onDeleteAllFillers,
  onReset,
  onConfirm 
}: Props) {
  return (
    <div className="action-bar">
      {/* 统计摘要 */}
      <div className="summary">
        <span className="stat keep">保留 {summary.keep} 个</span>
        <span className="stat delete">删除 {summary.delete} 个</span>
        <span className="stat choose">待选择 {summary.choose} 个</span>
        <span className="stat reduction">
          预计时长减少 {summary.reductionPercent}%
        </span>
      </div>
      
      {/* 快捷操作 */}
      <div className="quick-actions">
        {/* ⭐ 核心按钮：一键接受推荐 */}
        <Button 
          variant="primary"
          size="lg"
          onClick={onAcceptRecommendations}
        >
          ⭐ 接受所有推荐
        </Button>
        
        <Button 
          variant="secondary"
          onClick={onDeleteAllFillers}
        >
          🗑️ 删除所有废话
        </Button>
        
        <Button 
          variant="ghost"
          onClick={onReset}
        >
          重置
        </Button>
      </div>
      
      {/* 主操作 */}
      <div className="main-action">
        <Button 
          variant="primary"
          size="xl"
          onClick={onConfirm}
          disabled={summary.choose > 0}  // 有未选择的不能继续
        >
          确认，进入编辑器 →
        </Button>
        {summary.choose > 0 && (
          <span className="hint">还有 {summary.choose} 个重复片段需要选择</span>
        )}
      </div>
    </div>
  );
}
```

### 4.6 页面布局设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         🎬 分析进度                                  │   │
│  │  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  65%                  │   │
│  │  🧠 AI 正在分析内容... 已分析 18/28 个片段                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │                             │  │                                     │  │
│  │      📹 视频预览            │  │        片段时间轴                   │  │
│  │                             │  │  ┌───┬───┬───┬───┬───┬───┬───┐     │  │
│  │   (悬停自动播放)            │  │  │ ✅│ 🗑│ 🔄│ 🔄│ 🔄│ ✅│ ✅│     │  │
│  │                             │  │  └───┴───┴───┴───┴───┴───┴───┘     │  │
│  │                             │  │                                     │  │
│  └─────────────────────────────┘  └─────────────────────────────────────┘  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         片段列表                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │ 🟢 00:00  "大家好，我是xxx"                    [保留] ✓     │    │   │
│  │  │ 🔴 00:03  "嗯那个"                             [删除] ✗     │    │   │
│  │  │ 🟡 00:04  "今天给大家..."  重复 1/3            [选择]       │    │   │
│  │  │ 🟡 00:08  "今天给大家..."  重复 2/3  ⭐推荐    [选择] ✓     │    │   │
│  │  │ 🟡 00:12  "今天给大家..."  重复 3/3            [选择]       │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  统计: 保留18 | 删除5 | 待选2    预计减少28%时长                    │   │
│  │                                                                      │   │
│  │  [🗑️ 删除所有废话]  [⭐ 接受推荐]  [↩️ 重置]    [确认，进入编辑器 →] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.7 重复片段选择器

```typescript
// frontend/src/features/workspace/RepeatGroupSelector.tsx

interface RepeatGroup {
  id: string;
  scriptText?: string;
  segments: RepeatSegment[];
  recommendedId: string;
  recommendReason: string;
}

interface RepeatSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  scores: {
    clarity: number;      // 清晰度 (0-1)
    fluency: number;      // 流畅度 (0-1)
    emotion: number;      // 情感表达 (0-1)
    speed: number;        // 语速适中程度 (0-1)
  };
  overallScore: number;
  isRecommended: boolean;
}

export function RepeatGroupSelector({ group, onSelect }: Props) {
  const [selectedId, setSelectedId] = useState(group.recommendedId);
  
  return (
    <div className="repeat-group">
      <div className="group-header">
        <span className="group-label">🔄 重复片段 ({group.segments.length}个版本)</span>
        {group.scriptText && (
          <span className="script-text">脚本: "{group.scriptText}"</span>
        )}
      </div>
      
      <div className="segments-list">
        {group.segments.map((seg) => (
          <div 
            key={seg.id}
            className={cn(
              "segment-option",
              selectedId === seg.id && "selected",
              seg.isRecommended && "recommended"
            )}
            onClick={() => setSelectedId(seg.id)}
          >
            {/* 视频缩略图预览 */}
            <VideoThumbnail 
              start={seg.start} 
              end={seg.end}
              onHover={() => playPreview(seg)}
            />
            
            <div className="segment-info">
              <div className="text">"{seg.text}"</div>
              <div className="time">{formatTime(seg.start)} - {formatTime(seg.end)}</div>
              
              {/* 质量评分可视化 */}
              <div className="scores">
                <ScoreBar label="清晰" value={seg.scores.clarity} />
                <ScoreBar label="流畅" value={seg.scores.fluency} />
                <ScoreBar label="情感" value={seg.scores.emotion} />
              </div>
            </div>
            
            {seg.isRecommended && (
              <div className="recommend-badge">
                ⭐ 推荐
                <span className="reason">{group.recommendReason}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 4.3 脚本偏差对比视图

```typescript
// frontend/src/features/editor/components/ScriptDiffView.tsx

interface ScriptDiffViewProps {
  script: string;
  alignedSegments: AlignedSegment[];
}

export function ScriptDiffView({ script, alignedSegments }: ScriptDiffViewProps) {
  return (
    <div className="script-diff-view">
      <div className="view-header">
        <h3>脚本对比</h3>
        <div className="legend">
          <span className="legend-item matched">✅ 匹配</span>
          <span className="legend-item deviation">⚠️ 偏离</span>
          <span className="legend-item omission">❌ 遗漏</span>
          <span className="legend-item improvisation">💡 即兴</span>
        </div>
      </div>
      
      <div className="diff-content">
        {/* 脚本列 */}
        <div className="script-column">
          <h4>原始脚本</h4>
          {renderScriptWithHighlights(script, alignedSegments)}
        </div>
        
        {/* 实际内容列 */}
        <div className="spoken-column">
          <h4>实际内容</h4>
          {alignedSegments.map(seg => (
            <SegmentCard 
              key={seg.id}
              segment={seg}
              showDiff={seg.category === 'deviation'}
            />
          ))}
        </div>
      </div>
      
      {/* 统计摘要 */}
      <div className="summary">
        <div className="stat">脚本完成度: 92%</div>
        <div className="stat">偏离片段: 3处</div>
        <div className="stat">即兴发挥: 2处</div>
      </div>
    </div>
  );
}
```

---

## 五、API 设计

### 5.1 后端 API 接口

```python
# backend/app/api/smart.py

@router.post("/analyze-content")
async def analyze_content(
    request: ContentAnalysisRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> ContentAnalysisResponse:
    """
    智能内容分析
    
    支持两种模式：
    1. 有脚本模式：对比脚本和 ASR 结果
    2. 无脚本模式：智能识别废话和有效内容
    """
    ...

class ContentAnalysisRequest(BaseModel):
    project_id: str
    # 可选：用户上传的脚本
    script: Optional[str] = None
    # ASR 结果 ID（如果已有）
    transcript_id: Optional[str] = None
    # 分析选项
    options: AnalysisOptions = AnalysisOptions()

class AnalysisOptions(BaseModel):
    # 是否检测重复片段
    detect_repeats: bool = True
    # 是否分析风格
    analyze_style: bool = True
    # 是否生成缩放推荐
    generate_zoom_recommendations: bool = True
    # 废话检测敏感度 (0-1, 高=更激进)
    filler_sensitivity: float = 0.7

class ContentAnalysisResponse(BaseModel):
    # 分析后的片段列表
    segments: list[AnalyzedSegment]
    # 重复片段组
    repeat_groups: list[RepeatGroup]
    # 风格分析结果
    style: Optional[VideoStyle]
    # 缩放推荐
    zoom_recommendations: Optional[list[ZoomRecommendation]]
    # 统计摘要
    summary: AnalysisSummary

class AnalyzedSegment(BaseModel):
    id: str
    start: float
    end: float
    text: str
    # 分类
    category: Literal['keep', 'delete', 'choose']
    classification: Literal['matched', 'deviation', 'filler', 'repeat', 'improvisation']
    confidence: float
    # 关联
    repeat_group_id: Optional[str] = None
    script_match: Optional[str] = None
    # 质量评分
    quality_scores: Optional[QualityScores] = None

class RepeatGroup(BaseModel):
    id: str
    script_text: Optional[str]
    segment_ids: list[str]
    recommended_id: str
    recommend_reason: str

class AnalysisSummary(BaseModel):
    total_segments: int
    keep_count: int
    delete_count: int
    choose_count: int
    repeat_groups_count: int
    estimated_reduction_percent: float
    script_coverage: Optional[float] = None  # 有脚本模式才有


@router.post("/confirm-selection")
async def confirm_selection(
    request: SelectionConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> SelectionConfirmResponse:
    """
    确认用户的选择，生成最终的 clips
    """
    ...

class SelectionConfirmRequest(BaseModel):
    project_id: str
    # 用户的选择
    selections: list[SegmentSelection]
    # 是否应用推荐的缩放
    apply_zoom_recommendations: bool = True

class SegmentSelection(BaseModel):
    segment_id: str
    action: Literal['keep', 'delete']
    # 对于重复组，指定选择的版本
    selected_from_group: Optional[str] = None
```

### 5.2 前端 API 调用

```typescript
// frontend/src/features/editor/lib/smart-api.ts

export interface ContentAnalysisRequest {
  projectId: string;
  script?: string;
  transcriptId?: string;
  options?: {
    detectRepeats?: boolean;
    analyzeStyle?: boolean;
    generateZoomRecommendations?: boolean;
    fillerSensitivity?: number;
  };
}

export interface ContentAnalysisResponse {
  segments: AnalyzedSegment[];
  repeatGroups: RepeatGroup[];
  style?: VideoStyle;
  zoomRecommendations?: ZoomRecommendation[];
  summary: AnalysisSummary;
}

export async function analyzeContent(
  request: ContentAnalysisRequest
): Promise<ContentAnalysisResponse> {
  const response = await apiClient.post('/smart/analyze-content', {
    project_id: request.projectId,
    script: request.script,
    transcript_id: request.transcriptId,
    options: {
      detect_repeats: request.options?.detectRepeats ?? true,
      analyze_style: request.options?.analyzeStyle ?? true,
      generate_zoom_recommendations: request.options?.generateZoomRecommendations ?? true,
      filler_sensitivity: request.options?.fillerSensitivity ?? 0.7,
    },
  });
  
  return transformResponse(response.data);
}

export async function confirmSelection(
  projectId: string,
  selections: SegmentSelection[],
  applyZoomRecommendations: boolean = true
): Promise<void> {
  await apiClient.post('/smart/confirm-selection', {
    project_id: projectId,
    selections: selections.map(s => ({
      segment_id: s.segmentId,
      action: s.action,
      selected_from_group: s.selectedFromGroup,
    })),
    apply_zoom_recommendations: applyZoomRecommendations,
  });
}
```

---

## 六、处理流程优化

### 6.1 新的处理步骤

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         一键成片 V2 处理步骤                                 │
└─────────────────────────────────────────────────────────────────────────────┘

步骤 1: 上传
├── 视频文件上传
├── 脚本上传（可选）
└── 配置处理选项

步骤 2: 基础分析 (后台并行)
├── ASR 语音转写
├── VAD 静音检测  
├── 音频特征提取（语速、情感、能量）
└── 视觉特征提取（场景、运动）

步骤 3: 智能分析 (LLM)
├── [有脚本] 脚本对齐
├── [无脚本] 废话识别
├── 重复片段检测
├── 风格分析
└── 缩放推荐生成

步骤 4: 用户审核 ⬅️ 新增关键步骤
├── 展示分析结果
├── 重复片段选择
├── 废话删除确认
├── 保留内容确认
└── 确认进入编辑器

步骤 5: 编辑器
├── 加载筛选后的 clips
├── 应用风格化缩放动画
├── 加载字幕
└── 用户微调
```

### 6.2 前端页面流转

```typescript
// frontend/src/app/workspace/page.tsx

type WorkflowStep = 
  | 'upload'        // 上传视频+脚本
  | 'configure'     // 配置选项
  | 'processing'    // 处理中（显示进度）
  | 'review'        // ⬅️ 新增：内容审核页面
  | 'editor';       // 编辑器

// 新增：审核页面
function ReviewView({ 
  analysisResult, 
  onConfirm, 
  onBack 
}: ReviewViewProps) {
  const [selections, setSelections] = useState<Map<string, SegmentSelection>>();
  
  // 初始化：使用推荐的选择
  useEffect(() => {
    const initial = new Map();
    analysisResult.segments.forEach(seg => {
      initial.set(seg.id, {
        segmentId: seg.id,
        action: seg.category === 'delete' ? 'delete' : 'keep',
      });
    });
    // 对于重复组，默认选择推荐的
    analysisResult.repeatGroups.forEach(group => {
      group.segment_ids.forEach(id => {
        initial.set(id, {
          segmentId: id,
          action: id === group.recommended_id ? 'keep' : 'delete',
          selectedFromGroup: group.id,
        });
      });
    });
    setSelections(initial);
  }, [analysisResult]);
  
  const handleConfirm = async () => {
    await confirmSelection(
      projectId,
      Array.from(selections.values()),
      true // 应用缩放推荐
    );
    onConfirm();
  };
  
  return (
    <div className="review-page">
      <ReviewHeader 
        summary={analysisResult.summary}
        style={analysisResult.style}
      />
      
      <SegmentList 
        segments={analysisResult.segments}
        repeatGroups={analysisResult.repeatGroups}
        selections={selections}
        onSelectionChange={setSelections}
      />
      
      <ReviewActions
        onConfirm={handleConfirm}
        onBack={onBack}
      />
    </div>
  );
}
```

---

## 七、数据模型扩展

### 7.1 数据库表结构

```sql
-- 项目脚本表
CREATE TABLE project_scripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 内容分析结果表
CREATE TABLE content_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    -- 分析模式
    mode VARCHAR(20) NOT NULL, -- 'with_script' | 'without_script'
    
    -- 分析结果 (JSONB)
    segments JSONB NOT NULL,
    repeat_groups JSONB,
    style_analysis JSONB,
    zoom_recommendations JSONB,
    summary JSONB,
    
    -- 状态
    status VARCHAR(20) DEFAULT 'pending', -- 'pending' | 'completed' | 'confirmed'
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户选择记录表
CREATE TABLE content_selections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_id UUID NOT NULL REFERENCES content_analyses(id) ON DELETE CASCADE,
    
    -- 选择结果 (JSONB)
    selections JSONB NOT NULL,
    
    -- 应用的选项
    apply_zoom_recommendations BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_project_scripts_project_id ON project_scripts(project_id);
CREATE INDEX idx_content_analyses_project_id ON content_analyses(project_id);
CREATE INDEX idx_content_analyses_status ON content_analyses(status);
```

---

## 八、实现计划

### Phase 1: 后端核心 (4天)
- [ ] 创建数据库表结构 (project_scripts, content_analyses, content_selections)
- [ ] 实现 SmartAnalyzer 一站式分析服务
- [ ] 设计 Super Prompt，一次调用完成所有分析
- [ ] 实现阶段进度更新 API `/api/projects/{id}/progress`
- [ ] 脚本上传 API

### Phase 2: 前端页面 (5天)
- [ ] ProcessingView 页面 - 阶段进度展示
- [ ] ReviewView 页面 - 分析结果审核
- [ ] SegmentCard 组件 - 悬停预览播放
- [ ] RepeatGroupSelector 组件 - 重复片段选择
- [ ] ActionBar 组件 - 一键接受推荐、批量操作
- [ ] ScriptDiffView 组件 (有脚本模式)

### Phase 3: 风格与缩放 (2天)
- [ ] 风格模板定义
- [ ] 缩放推荐应用到编辑器
- [ ] 风格预览 UI

### Phase 4: 对接与优化 (3天)
- [ ] 审核确认后生成 clips 对接编辑器
- [ ] 端到端测试
- [ ] LLM Prompt 调优
- [ ] 性能优化（缓存、并行预处理）

**总计：约14天**

---

## 九、技术风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|----------|
| LLM 分类准确率不足 | 用户需要大量手动调整 | Super Prompt 包含详细规则 + 持续优化 |
| 重复检测误判 | 把有意重复当成重录 | LLM 结合时间间隔+语义判断 |
| 处理时间过长 | 用户等待焦虑 | 清晰的阶段进度展示 |
| 用户审核步骤增加流程 | 部分用户觉得繁琐 | **"接受推荐"按钮超大**，一键跳过 |
| 风格分析主观性强 | 推荐不符合用户预期 | 提供预览，用户可修改 |

---

## 十、核心要点总结

### 10.1 用户感知度 Checklist

| 场景 | 用户需要知道什么 | 实现方式 |
|------|------------------|----------|
| 等待处理 | 当前在哪个阶段 | 阶段列表 + 当前阶段高亮 |
| 阶段切换 | 进度在推进 | 进度条动画 + ✓ 完成标记 |
| 分析完成 | 可以开始审核了 | 自动跳转到审核页面 |
| 选择片段 | 哪个是推荐的 | ⭐ 推荐标记 + 评分可视化 |

### 10.2 效率 Checklist

| 场景 | 效率优化点 | 实现方式 |
|------|------------|----------|
| LLM 分析 | 一次调用完成所有 | Super Prompt 包含全部任务 |
| 后台处理 | 不阻塞用户 | Celery 异步任务 |
| 用户决策 | 减少选择负担 | 默认使用推荐，一键确认 |
| 重复操作 | 批量处理 | 一键删除废话、一键接受推荐 |

---

*文档结束*
