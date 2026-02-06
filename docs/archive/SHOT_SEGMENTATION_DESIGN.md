# 分镜策略 Agent Workflow 设计文档

> 版本: v1.0
> 日期: 2026-02-03
> 作者: AI Assistant

---

## 1. 场景分析

### 1.1 用户场景

**目标用户**: 已完成口播录制的创作者
**输入**: 完整的口播视频（已上传为 Asset）
**目的**: 将视频进行分镜划分，为后续添加 B-Roll、背景替换、特效等提供基础

### 1.2 数据流

```
用户上传视频 → Asset 表 (status: ready)
                ↓
         WorkspaceSession (workflow_step: analyze)
                ↓
         选择分镜策略
                ↓
         Shot Segmentation Agent
                ↓
         生成 Shots 数据
                ↓
         进入 Visual Editor
```

---

## 2. 三种分镜策略

### 2.1 策略对比

| 策略 | 说明 | 适用场景 | 依赖 | 预期分镜数 |
|------|------|----------|------|-----------|
| **场景分镜** | 基于视觉变化检测镜头切换 | 已有多镜头素材、场景变化丰富 | PySceneDetect | 少 (3-10) |
| **分句分镜** | 基于 ASR 断句，每句一镜 | 口播清晰、节奏明快 | ASR + 断句 | 多 (10-30) |
| **段落分镜** | 基于语义分析，按段落/话题划分 | 内容有章节结构 | ASR + LLM 语义分析 | 中等 (5-15) |

### 2.2 策略详解

#### A. 场景分镜 (Scene Detection)

**技术方案**: PySceneDetect

```python
# 核心检测器
1. ContentDetector - 基于内容变化检测硬切
   - 计算相邻帧的亮度/颜色差异
   - 超过阈值 (threshold) 则判定为场景切换
   - 默认阈值: 27.0

2. AdaptiveDetector - 两遍自适应检测
   - 第一遍: 统计视频整体的帧间差异分布
   - 第二遍: 动态调整阈值，处理快速镜头运动
   - 适合: 运动镜头多的视频

3. ThresholdDetector - 基于亮度阈值
   - 检测淡入淡出 (fade in/out)
   - 适合: 有转场特效的视频
```

**实现流程**:

```
1. 获取视频文件路径 (从 Asset.storage_path)
2. 调用 PySceneDetect 检测场景边界
3. 提取每个场景的关键帧 (中间帧)
4. 生成 Shots 列表
```

**代码示例**:

```python
from scenedetect import detect, AdaptiveDetector, ContentDetector

def detect_scenes(video_path: str, threshold: float = 27.0) -> list:
    """
    场景检测
    
    Returns:
        list of (start_time, end_time) in seconds
    """
    # 优先使用 AdaptiveDetector (更稳健)
    scene_list = detect(video_path, AdaptiveDetector())
    
    # 如果检测结果太少，降级到 ContentDetector
    if len(scene_list) < 2:
        scene_list = detect(video_path, ContentDetector(threshold=threshold))
    
    return [(scene[0].get_seconds(), scene[1].get_seconds()) for scene in scene_list]
```

#### B. 分句分镜 (Sentence Segmentation)

**技术方案**: ASR 转写 + 断句

**依赖**: 豆包 ASR API (已有实现)

**实现流程**:

```
1. 检查 Asset.metadata 是否已有 transcript_segments
   - 如果有: 直接使用
   - 如果没有: 调用 ASR 任务

2. 解析 ASR 结果的 utterances (分句)
3. 每个句子作为一个分镜
4. 生成 Shots 列表
```

**关键配置**:

```python
# ASR 配置
enable_ddc = False  # ★ 关闭语义顺滑，保留原始口癖词用于后续检测
show_utterances = True  # 获取分句信息

# 断句规则
MIN_SENTENCE_DURATION = 0.5  # 最短句子时长 (秒)
MAX_SENTENCE_DURATION = 15.0  # 最长句子时长 (秒)
```

**合并策略**:

```python
def merge_short_sentences(segments: list, min_duration: float = 1.5) -> list:
    """
    合并过短的句子
    
    逻辑:
    1. 如果句子 < min_duration，尝试与前一句合并
    2. 如果合并后 > max_duration，保持独立
    """
    merged = []
    buffer = None
    
    for seg in segments:
        duration = seg['end'] - seg['start']
        
        if buffer is None:
            buffer = seg
        elif duration < min_duration:
            # 尝试合并
            buffer['end'] = seg['end']
            buffer['text'] += seg['text']
        else:
            merged.append(buffer)
            buffer = seg
    
    if buffer:
        merged.append(buffer)
    
    return merged
```

#### C. 段落分镜 (Paragraph Segmentation)

**技术方案**: ASR + LLM 语义分析

**实现流程**:

```
1. 获取 ASR 转写结果 (完整文本)
2. 调用 LLM 进行段落划分
3. 将段落映射回时间轴
4. 生成 Shots 列表
```

**LLM Prompt**:

```python
PARAGRAPH_SEGMENTATION_PROMPT = """
你是一个专业的视频编辑助手。请分析以下口播文稿，将其划分为有意义的段落/章节。

文稿内容:
{transcript}

请按以下规则划分:
1. 每个段落应该有一个完整的主题
2. 段落之间应该有明显的话题转换
3. 每个段落建议 30-120 秒 (除非内容需要)
4. 段落数量建议 3-10 个

请返回 JSON 格式:
{{
    "paragraphs": [
        {{
            "index": 0,
            "title": "段落标题",
            "summary": "段落摘要",
            "start_sentence_index": 0,
            "end_sentence_index": 5
        }}
    ]
}}
"""
```

**时间映射**:

```python
def map_paragraphs_to_timeline(
    paragraphs: list,
    sentences: list  # ASR 分句结果，带时间戳
) -> list:
    """
    将段落划分映射回时间轴
    """
    shots = []
    for para in paragraphs:
        start_idx = para['start_sentence_index']
        end_idx = para['end_sentence_index']
        
        start_time = sentences[start_idx]['start']
        end_time = sentences[end_idx]['end']
        
        shots.append({
            'start_time': start_time,
            'end_time': end_time,
            'title': para.get('title'),
            'summary': para.get('summary'),
        })
    
    return shots
```

---

## 3. Agent Workflow 设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shot Segmentation Agent                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │   Input      │   │   Strategy   │   │   Output     │        │
│  │   Validator  │ → │   Router     │ → │   Formatter  │        │
│  └──────────────┘   └──────────────┘   └──────────────┘        │
│         ↓                  ↓                  ↓                 │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                   Strategy Handlers                   │       │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────────────┐     │       │
│  │  │ Scene   │   │Sentence │   │   Paragraph     │     │       │
│  │  │Detector │   │Segmenter│   │   Segmenter     │     │       │
│  │  └─────────┘   └─────────┘   └─────────────────┘     │       │
│  └──────────────────────────────────────────────────────┘       │
│         ↓                  ↓                  ↓                 │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              Thumbnail Extractor                      │       │
│  │              (生成每个分镜的关键帧)                    │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 文件结构

```
backend/app/
├── features/
│   └── shot_segmentation/
│       ├── __init__.py
│       ├── agent.py           # Agent 主入口
│       ├── strategies/
│       │   ├── __init__.py
│       │   ├── base.py        # 策略基类
│       │   ├── scene.py       # 场景分镜
│       │   ├── sentence.py    # 分句分镜
│       │   └── paragraph.py   # 段落分镜
│       ├── thumbnail.py       # 关键帧提取
│       └── types.py           # 类型定义
├── api/
│   └── shot_segmentation.py   # API 路由
└── tasks/
    └── shot_segmentation.py   # Celery 异步任务
```

### 3.3 核心类型定义

```python
# types.py

from enum import Enum
from pydantic import BaseModel
from typing import Optional, List

class SegmentationStrategy(str, Enum):
    SCENE = "scene"           # 场景分镜
    SENTENCE = "sentence"     # 分句分镜
    PARAGRAPH = "paragraph"   # 段落分镜

class Shot(BaseModel):
    """单个分镜"""
    id: str
    index: int
    start_time: float         # 秒
    end_time: float           # 秒
    duration: float           # 秒
    thumbnail_url: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    transcript: Optional[str] = None  # 该分镜的文稿

class SegmentationRequest(BaseModel):
    """分镜请求"""
    session_id: str
    asset_id: str
    strategy: SegmentationStrategy
    
    # 场景分镜参数
    scene_threshold: float = 27.0
    
    # 分句分镜参数
    min_sentence_duration: float = 1.5
    
    # 段落分镜参数
    target_paragraph_count: Optional[int] = None

class SegmentationResult(BaseModel):
    """分镜结果"""
    session_id: str
    asset_id: str
    strategy: SegmentationStrategy
    shots: List[Shot]
    total_duration: float
    created_at: str
```

### 3.4 Agent 实现

```python
# agent.py

import logging
from typing import Optional, Callable
from uuid import uuid4

from .types import (
    SegmentationStrategy,
    SegmentationRequest,
    SegmentationResult,
    Shot,
)
from .strategies import (
    SceneDetectionStrategy,
    SentenceSegmentationStrategy,
    ParagraphSegmentationStrategy,
)
from .thumbnail import extract_thumbnails

logger = logging.getLogger(__name__)

class ShotSegmentationAgent:
    """
    分镜 Agent
    
    负责根据策略对视频进行分镜划分
    """
    
    def __init__(self):
        self.strategies = {
            SegmentationStrategy.SCENE: SceneDetectionStrategy(),
            SegmentationStrategy.SENTENCE: SentenceSegmentationStrategy(),
            SegmentationStrategy.PARAGRAPH: ParagraphSegmentationStrategy(),
        }
    
    async def segment(
        self,
        request: SegmentationRequest,
        video_path: str,
        transcript_segments: Optional[list] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> SegmentationResult:
        """
        执行分镜
        
        Args:
            request: 分镜请求
            video_path: 视频文件路径
            transcript_segments: ASR 分句结果 (分句/段落策略需要)
            on_progress: 进度回调 (progress: int, step: str)
        """
        
        if on_progress:
            on_progress(5, "初始化分镜策略...")
        
        # 1. 获取策略处理器
        strategy = self.strategies.get(request.strategy)
        if not strategy:
            raise ValueError(f"不支持的分镜策略: {request.strategy}")
        
        if on_progress:
            on_progress(10, f"使用 {request.strategy.value} 策略分析...")
        
        # 2. 执行分镜
        raw_shots = await strategy.segment(
            video_path=video_path,
            transcript_segments=transcript_segments,
            params=request,
            on_progress=lambda p, s: on_progress(10 + int(p * 0.5), s) if on_progress else None,
        )
        
        if on_progress:
            on_progress(60, f"提取关键帧... (共 {len(raw_shots)} 个分镜)")
        
        # 3. 提取关键帧
        shots = await extract_thumbnails(
            video_path=video_path,
            shots=raw_shots,
            on_progress=lambda p, s: on_progress(60 + int(p * 0.35), s) if on_progress else None,
        )
        
        if on_progress:
            on_progress(95, "生成分镜结果...")
        
        # 4. 计算总时长
        total_duration = max(s.end_time for s in shots) if shots else 0
        
        # 5. 构建结果
        result = SegmentationResult(
            session_id=request.session_id,
            asset_id=request.asset_id,
            strategy=request.strategy,
            shots=shots,
            total_duration=total_duration,
            created_at=datetime.utcnow().isoformat(),
        )
        
        if on_progress:
            on_progress(100, "分镜完成")
        
        return result
```

---

## 4. 数据库变更

### 4.1 workspace_sessions 表扩展

```sql
-- 添加分镜相关字段
ALTER TABLE workspace_sessions ADD COLUMN IF NOT EXISTS 
    shot_strategy TEXT CHECK (shot_strategy IN ('scene', 'sentence', 'paragraph'));

ALTER TABLE workspace_sessions ADD COLUMN IF NOT EXISTS 
    shots JSONB DEFAULT '[]'::jsonb;

-- shots 结构:
-- [
--   {
--     "id": "shot-1",
--     "index": 0,
--     "start_time": 0.0,
--     "end_time": 15.5,
--     "thumbnail_url": "...",
--     "transcript": "..."
--   }
-- ]
```

### 4.2 Assets 表已有字段利用

```sql
-- 利用现有的 metadata 字段存储 ASR 结果
-- metadata: {
--   "transcript_segments": [...],  -- ASR 分句结果
--   "full_transcript": "...",      -- 完整文稿
--   "duration": 120.5              -- 视频时长
-- }
```

---

## 5. API 设计

### 5.1 触发分镜分析

```
POST /api/workspace/sessions/{session_id}/shot-segmentation

Request Body:
{
    "strategy": "sentence",  // scene | sentence | paragraph
    "scene_threshold": 27.0,  // 场景检测阈值 (可选)
    "min_sentence_duration": 1.5  // 最短句子时长 (可选)
}

Response:
{
    "task_id": "uuid",
    "status": "pending"
}
```

### 5.2 查询分镜结果

```
GET /api/workspace/sessions/{session_id}/shots

Response:
{
    "strategy": "sentence",
    "shots": [
        {
            "id": "shot-1",
            "index": 0,
            "start_time": 0.0,
            "end_time": 15.5,
            "duration": 15.5,
            "thumbnail_url": "https://...",
            "transcript": "大家好，今天我们来聊一聊..."
        }
    ],
    "total_duration": 120.5,
    "status": "completed"
}
```

### 5.3 手动调整分镜

```
PATCH /api/workspace/sessions/{session_id}/shots/{shot_id}

Request Body:
{
    "start_time": 10.0,  // 调整起始时间
    "end_time": 25.0     // 调整结束时间
}

Response:
{
    "success": true,
    "shot": { ... }
}
```

---

## 6. 前端集成

### 6.1 策略选择组件

已在 `ShotStrategySelector.tsx` 中实现，需要对接真实 API:

```typescript
// 调用分镜 API
const handleStrategySelect = async (strategy: ShotStrategy) => {
  setIsAnalyzing(true);
  
  try {
    // 1. 触发分镜任务
    const { task_id } = await api.post(`/workspace/sessions/${sessionId}/shot-segmentation`, {
      strategy,
    });
    
    // 2. 轮询任务状态
    await pollTaskStatus(task_id, (progress) => {
      setProgress(progress);
    });
    
    // 3. 获取分镜结果
    const result = await api.get(`/workspace/sessions/${sessionId}/shots`);
    
    // 4. 更新 Store
    setShots(result.shots);
    
  } catch (error) {
    console.error('分镜失败:', error);
  } finally {
    setIsAnalyzing(false);
  }
};
```

### 6.2 Visual Editor Store 更新

```typescript
// 添加分镜相关状态
interface VisualEditorState {
  // ... 现有字段
  
  // 分镜策略
  shotStrategy: ShotStrategy | null;
  
  // 分镜任务状态
  segmentationStatus: 'idle' | 'analyzing' | 'completed' | 'error';
  segmentationProgress: number;
}
```

---

## 7. 依赖安装

### 7.1 Python 依赖

```bash
# 场景检测
pip install scenedetect[opencv]

# 确保 ffmpeg 可用 (用于视频处理)
# macOS: brew install ffmpeg
# Ubuntu: apt install ffmpeg
```

### 7.2 requirements.txt 更新

```
# Scene Detection
scenedetect[opencv]>=0.6.7
```

---

## 8. 实施计划

### Phase 1: 基础架构 (1-2 天)

- [ ] 创建 `features/shot_segmentation/` 目录结构
- [ ] 实现基础类型定义 (`types.py`)
- [ ] 实现策略基类 (`strategies/base.py`)
- [ ] 添加 API 路由

### Phase 2: 场景分镜 (1 天)

- [ ] 实现 `SceneDetectionStrategy`
- [ ] 集成 PySceneDetect
- [ ] 实现关键帧提取
- [ ] 测试不同类型视频

### Phase 3: 分句分镜 (1 天)

- [ ] 实现 `SentenceSegmentationStrategy`
- [ ] 复用现有 ASR 流程
- [ ] 实现短句合并逻辑
- [ ] 处理 ASR 结果缺失情况

### Phase 4: 段落分镜 (1-2 天)

- [ ] 实现 `ParagraphSegmentationStrategy`
- [ ] 设计 LLM Prompt
- [ ] 实现时间映射逻辑
- [ ] 优化分段质量

### Phase 5: 前端集成 (1 天)

- [ ] 对接策略选择组件
- [ ] 实现任务状态轮询
- [ ] 更新 Visual Editor Store
- [ ] 测试完整流程

---

## 9. 注意事项

### 9.1 性能考虑

1. **场景检测**: 视频时长越长，处理时间越长。建议对 > 10 分钟视频使用异步任务
2. **关键帧提取**: 使用 ffmpeg 的 `thumbnail` 过滤器高效提取
3. **ASR 结果缓存**: 同一视频不重复调用 ASR

### 9.2 边界情况

1. **无场景切换**: 如果 SceneDetect 没有检测到切换点，回退到分句分镜
2. **ASR 失败**: 如果 ASR 失败，提示用户选择场景分镜
3. **视频过短**: < 10 秒的视频可能只有 1 个分镜

### 9.3 质量保证

1. **分镜最小时长**: 避免过短的分镜 (< 1 秒)
2. **分镜最大时长**: 避免过长的分镜 (> 60 秒)
3. **分镜连续性**: 确保分镜之间无缝衔接

---

## 10. 参考资料

- [PySceneDetect 官方文档](https://www.scenedetect.com/docs/)
- [豆包 ASR API 文档](https://www.volcengine.com/docs/6561/1354868)
- [FFmpeg 关键帧提取](https://ffmpeg.org/ffmpeg-filters.html#thumbnail-1)
