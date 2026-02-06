# 一键成片与口播精修系统（统一文档）

> 合并自：SMART_CLIP_V2_DESIGN / 一键成片设计 / 一键成片SOP / 一键成片性能优化SOP / VOICE_EXTRACT_V2_DESIGN
> 
> 目标：提供“智能一键成片 + 口播精修 + 运镜规则 + 性能优化”的单一权威入口。

---

## 1. 系统目标与范围

**核心目标**：帮助口播类创作者快速完成内容剪辑与视觉优化，重点解决口癖/重复、节奏、运镜与成片效率。

覆盖能力：
- ASR + VAD 智能切片
- 口癖/重复识别与用户确认
- LLM 语义分析与运镜决策
- 可视化输出与工程化落地
- 性能优化与流程监控

---

## 2. 总体流程（简化版）

```
上传 → 预处理 → ASR/VAD → 智能切片 → 视觉分析 → LLM 语义分析
    → 运镜决策 → 序列优化 → 工程构建 → 编辑器微调
```

---

## 3. LLM 优先策略（Smart Clip V2）

一次 LLM 调用完成以下任务：
- 片段分类（keep/delete/choose）
- 口癖/废话识别
- 重复片段聚合 + 推荐
- 脚本对齐（可选）
- 风格识别 + 缩放节奏建议

优势：一次请求、逻辑自洽、减少延迟与合并成本。

---

## 4. 口播精修 V2（Voice Extract V2）

关键变化：
- **detect-fillers**：直接创建 clips，并标记 filler metadata
- **apply-trimming**：仅负责“确认删除/恢复”，不再创建 clips
- **clip-suggestions**：由“单条素材搜索”升级为 Remotion 配置生成

---

## 5. 运镜规则（核心）

规则引擎按情绪/重要性选择策略：
- INSTANT：高潮点、强强调
- KEYFRAME：渐变推进/回拉
- STATIC：平稳叙述或换气

序列感知后处理：
- 连续相同效果限制
- 高潮后休息片段
- 推进/回拉交替

---

## 6. 核心文件

```
backend/app/services/ai_video_creator.py
backend/app/services/transform_rules.py
backend/app/services/llm_service.py
backend/app/api/workspace.py
```

---

## 7. 性能与优化要点

**目标**：5 分钟视频端到端 < 90 秒

关键优化：
- FFprobe/FFmpeg 直读 URL
- HLS 与 ASR 并行
- 取消前端预加载
- 预热池 + 无缝 clip 切换

---

## 8. 当前状态

### ✅ 已完成
- LLM 优先分析与结果输出
- 运镜规则引擎与序列优化
- 并行 HLS/ASR
- 前端播放预热池

### ⚠️ 待优化
- 视觉分析进一步提速
- 进度汇报合并
- 超长视频策略

---

**最后更新**: 2026-02-04
