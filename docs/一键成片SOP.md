# AI 一键成片标准作业程序 (SOP)

本文档定义了"一键AI成片"功能的标准操作流程与技术执行细节。

## 流程概览
```
用户上传 → 预处理 → 智能切片(VAD+ASR) → 视觉分析(CV) → LLM语义分析 → 运镜决策 → 序列优化 → 工程构建
```

---

## 核心文件
| 文件 | 职责 |
|------|------|
| `backend/app/services/ai_video_creator.py` | 流程编排 |
| `backend/app/services/transform_rules.py` | **运镜规则引擎** |
| `backend/app/services/llm_service.py` | LLM 情绪/重要性分析 |

---

## 步骤详解

### Step 1: 媒体接收与清洗
1. 接收用户上传视频，生成 `Asset` 记录
2. 提取 16kHz 单声道 WAV 用于 AI 分析
3. 确保视频格式可播放 (MP4/H.264)

### Step 2: 智能切片 (VAD + ASR)
1. **VAD 扫描**: Silero VAD (阈值 0.5)
2. **ASR 对齐**: Whisper 生成带时间戳字幕
3. **切片规则**:
   - 忽略 < 0.5秒 的碎片
   - 合并间隔 < 0.3秒 的相邻片段

### Step 3: 视觉分析 (CV)
1. 每个 Clip 抽取关键帧 (1-2帧/秒)
2. 人脸检测 (MediaPipe): 获取中心点 `(x, y)` 和占比
3. 无人脸时使用显著性检测

### Step 4: LLM 语义分析
分析每个片段的文本，输出：
- **情绪** (emotion): `excited` | `serious` | `happy` | `sad` | `neutral`
- **重要性** (importance): `high` | `medium` | `low`
- **关键词** (keywords): 用于后续匹配

---

## 🎬 运镜规则引擎

### 规则优先级

| 优先级 | 规则 | 匹配条件 | 效果 |
|--------|------|----------|------|
| 1 | `BreathClipRule` | 换气片段 | 保持静止 |
| 5 | `ShortClipRule` | 时长 < 1.5秒 | 静止或轻微放大 |
| 10 | `EmotionZoomRule` | 有人脸 + 时长 > 1秒 | 情绪驱动缩放 |
| 20 | `NoFaceZoomRule` | 无人脸 + 时长 > 2秒 | Ken Burns 效果 |

### 情绪-重要性 → 缩放映射

| 情绪 | 重要性 | 策略 | 缩放范围 | 缓动 |
|------|--------|------|----------|------|
| **excited** | high | INSTANT | 1.0 → 1.35 | - |
| **excited** | medium | KEYFRAME | 1.10 → 1.25 | ease-out |
| **excited** | low | KEYFRAME | 1.05 → 1.15 | ease-out |
| **serious** | high | KEYFRAME | 1.08 → 1.25 | linear |
| **serious** | medium | KEYFRAME | 1.05 → 1.18 | linear |
| **serious** | low | KEYFRAME | 1.00 → 1.10 | linear |
| **happy** | high | KEYFRAME | 1.00 → 1.15 | ease-in-out |
| **happy** | medium | KEYFRAME | 1.00 → 1.10 | ease-in-out |
| **happy** | low | STATIC | 1.0 | - |
| **sad** | high | KEYFRAME | 1.05 → 1.00 | ease-in |
| **sad** | medium/low | STATIC | 1.0 | - |
| **neutral** | high | KEYFRAME | 1.05 → 1.18 | linear |
| **neutral** | medium | KEYFRAME | 1.00 → 1.08 | linear |
| **neutral** | low | STATIC | 1.0 | - |

### 缩放策略说明

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| `INSTANT` | 首帧直接放大，无动画 | 高潮点、惊讶时刻 |
| `KEYFRAME` | 渐变动画 (start → end) | 情绪递进、推进感 |
| `STATIC` | 保持原样，不缩放 | 平淡叙述、换气 |

---

## 🔄 序列感知后处理器

**解决问题**: 连续多个片段相同运镜效果，导致观感单调

### 核心规则

| 规则 | 触发条件 | 效果 |
|------|----------|------|
| **高潮后休息** | `excited + high` 后 | 强制 1 个静止片段 |
| **连续相同限制** | 连续 > 2 个相同效果 | 强制切换为替代效果 |
| **关键帧缩放不连续** | 前一个是 zoom_in/zoom_out | 当前若也是缩放则强制 static |
| **效果交替** | zoom_in 连续后 | 切换为 zoom_out 或 static |

#### 关键帧缩放不连续规则示例
```
❌ 错误: zoom_in → zoom_out → zoom_in (连续缩放动画，视觉疲劳)
✅ 正确: zoom_in → static → zoom_out (动静结合，呼吸感)
```

### 效果对比

**❌ 不启用序列感知**:
```
Clip1: zoom_in → Clip2: zoom_in → Clip3: zoom_in → Clip4: zoom_in → ...
(单调如"卡带")
```

**✅ 启用序列感知**:
```
Clip1: zoom_in → Clip2: zoom_in → Clip3: zoom_out → Clip4: zoom_in → ...
(推进-回拉的节奏感)
```

### 可配置参数

```python
# transform_rules.py -> SequenceAwarePostProcessor
MAX_CONSECUTIVE_SAME = 2      # 连续相同效果最大次数
POST_CLIMAX_REST_COUNT = 1    # 高潮后休息片段数
```

---

## 📊 短视频黄金法则

- ✅ 每 2-3 秒有视觉变化
- ✅ 避免连续 3 个以上相同效果
- ✅ 高潮后有"呼吸"空间
- ✅ 推进 ↔ 后拉交替，产生节奏感

---

## 关键帧数据结构

```json
{
  "enable_animation": true,
  "keyframes": [
    {
      "time_offset": 0,
      "scale": 1.0,
      "position_x": 0,
      "position_y": 0,
      "rotation": 0
    },
    {
      "time_offset": 3000,
      "scale": 1.08,
      "position_x": -0.02,
      "position_y": -0.01,
      "rotation": 0,
      "easing": "ease-out"
    }
  ],
  "_rule_applied": "emotion_zoom:neutral+medium:keyframe",
  "_strategy": "keyframe"
}
```

---

## 附录：LLM Prompt 示例

```
分析这段台词的情绪和重要性：
"我们今天要通过这个视频彻底改变你的工作流！"

输出 JSON:
{
  "emotion": "excited",
  "importance": "high", 
  "keywords": ["彻底改变", "工作流"]
}
```
