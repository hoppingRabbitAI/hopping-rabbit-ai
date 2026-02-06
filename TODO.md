# HoppingRabbit AI - 待办事项

## 🔴 生产环境必做

### 1. Celery 任务队列
**当前状态**：同步模式（开发用）
**生产需要**：
- [ ] 部署 Redis 作为消息队列
- [ ] 启动 Celery Worker 处理后台任务
- [ ] 配置多队列（gpu_high, gpu_medium, cpu_high, cpu_low）

**启动命令**：
```bash
# Redis
docker run -d -p 6379:6379 redis

# Celery Worker
celery -A app.celery_config worker --loglevel=info
```

**涉及任务**：
- `transcribe` - Whisper 语音转写（GPU）
- `stem_separation` - 人声分离（GPU）
- `export` - 视频导出渲染（CPU）
- `smart_clean` - LLM 分析口癖/NG（CPU）
- `diarization` - 说话人分离（GPU）

---

## 🟡 功能优化

### 2. 文件处理
- [ ] 大文件分片上传
- [ ] 上传断点续传
- [ ] 视频格式兼容性检测

### 2.1 ASR 音频提取 - 线上部署配置
**当前状态**：已实现 FFmpeg 流式提取音频（4GB 视频 → 20MB 音频）
**线上部署注意事项**：
- [ ] `/tmp` 保留 20GB 空间（足够 1000 并发，每个音频约 20MB）
- [ ] 可选设置环境变量 `ASR_TEMP_DIR=/data/asr_tmp` 指向更大磁盘
- [ ] Docker 部署时挂载外部卷: `-v /data/asr_tmp:/data/asr_tmp`
- [ ] K8s 部署使用 emptyDir 或 PVC

### 3. AI 处理
- [ ] Whisper 模型本地部署（目前用 API）
- [ ] LLM 口癖检测优化
- [ ] 字幕翻译功能

### 3.1 一键成片性能优化
**当前流程**：ASR → 视觉分析 → LLM 分析 → 运镜决策 → 创建 Clips  
**优化空间**：

#### 已完成 ✅
- [x] ASR 前先提取音频（4GB 视频 → 20MB 音频，FFmpeg 流式处理）

#### 待优化
- [ ] **视觉分析并行化**：当前串行处理每个片段，可批量并行
  - 位置: `ai_video_creator.py` `_step2_visual_analysis()`
  - 方案: `asyncio.gather()` 并行处理 + 限制并发数
  
- [ ] **LLM 批量调用优化**：当前已有批量接口，检查是否真正复用
  - 位置: `llm_service.py` `analyze_segments_batch()`
  - 方案: 合并多个片段为一次 API 调用

- [ ] **人脸检测缓存**：同一视频多次处理时复用结果
  - 方案: 以 `asset_id + 时间区间` 为 key 缓存人脸位置

- [ ] **跳帧采样**：长视频不需要每秒采样，可按场景变化动态调整
  - 当前: `sample_rate=1.0` (每秒 1 帧)
  - 优化: 先粗采样，有人脸变化时再细采样

- [ ] **预计算运镜**：后台异步预计算常用运镜参数

### 4. 编辑器
- [x] 撤销/重做功能 ✅ (saveToHistory/undo/redo 已实现)
- [x] 键盘快捷键 ✅ (ClipToolbar 已实现 Shift+F/C/D/Z/Y 等)
- [ ] 多轨道音频混合
- [ ] 音频提取后还原声音播放延迟问题（WAV 加载同步优化）

#### 剪映对标功能（待开发）
- [ ] **Effect 运镜** - 镜头运动效果（推拉摇移）
- [ ] **滤镜调节** - 色彩/亮度/对比度/饱和度调整
- [x] **添加文本** - 标题、花字、字幕样式 ✅ (TextStylePanel/TextOverlay 已实现，支持字体/字号/颜色/描边/阴影等)
- [ ] **添加素材** - 贴纸、特效、转场
- [ ] **变速** - 快放/慢放/曲线变速
- [ ] **画中画** - 多视频叠加

#### 交互优化
- [ ] **重复说话/NG 自动检测** - 针对结巴或多次 NG 重录的场景，用 AI 自动识别重复内容并推荐保留最佳版本

#### 架构重构方向
> 当前 VideoCanvasStore.tsx (~1400行) 直接集成 EditorStore
> 未来如需提升可测试性和复用性，可拆分为：
> - CanvasProvider（状态层 - Context）
> - CanvasCore（核心渲染层）
> - Controls/（播放控制、进度条、缩放）
> - Overlays/（Transform、字幕、标注）

### 5. 一键切分功能（Vlog 场景）
**场景**：用户录制 vlog 等非口播内容时，无法依赖语音分析，需要手动切分

**功能设计**：
- [ ] 一键"大切"：首次切分使用较大粒度（如按场景/静默段切分）
- [ ] 用户预览切分结果
- [ ] 不满意可继续"细切"：在已选片段上进一步细分
- [ ] 支持手动微调切点

**切分策略**：
- 场景检测（画面变化）
- 静默段检测（音量阈值）
- 固定时长切分（兜底方案）

**不可切分的情况**：
- [ ] Clip 时长 < 最小时长阈值（如 0.5s）
- [ ] 已是最小原子单位（无法再细分）
- [ ] 用户锁定的片段
- [ ] 正在处理中的片段

**UI 交互**：
- 选中 clip 后显示"一键切分"按钮
- 切分后自动选中所有新片段
- 支持批量撤销切分操作

### 6. B-Roll 智能生成优化

#### 已完成 ✅ (2026-02-01)
- [x] **宽高比匹配** - B-Roll 自动匹配主视频宽高比
  - 9:16 竖屏主视频 → 搜索 portrait 方向的 B-Roll
  - 16:9 横屏主视频 → 搜索 landscape 方向的 B-Roll
  - 工具函数: `backend/app/services/video_utils.py`
  
- [x] **裁剪信息记录** - clip.metadata 中存储裁剪参数
  - `crop_info.needs_crop` - 是否需要裁剪
  - `crop_info.crop_area` - 裁剪区域 {x, y, width, height}
  - `crop_info.ffmpeg_filter` - FFmpeg 裁剪命令
  
- [x] **display_mode 默认值** - 全局覆盖 (fullscreen) 作为默认
  - `fullscreen` - B-Roll 全屏覆盖主画面（90% 场景）
  - `pip` - B-Roll 作为小窗显示（特殊场景）

#### 待完成
- [ ] **局部 B-Roll (pip 模式)** - 前端渲染支持 B-Roll 小窗
  - 需要实现 Picture-in-Picture 布局
  - 可配置 pip 位置（左上/右上/左下/右下）
  
- [ ] **实时裁剪预览** - 编辑器中预览裁剪效果
  - 显示裁剪框
  - 支持手动调整裁剪区域

- [ ] **B-Roll 替换** - 用户可替换自动选择的 B-Roll
  - 搜索同方向的替代素材
  - 保留时间和裁剪配置

### 7. 数据管理
- [x] 删除改为软删除 ✅ (transcript segments 已实现 is_deleted)
  - ~~projects/tracks/clips/assets 添加 `is_deleted` 字段~~
  - ~~删除操作改为更新 `is_deleted = true`~~
  - ~~查询时过滤已删除记录~~
  - [ ] 支持回收站功能（待实现）
  - 注：clips/tracks 使用硬删除，transcript segments 使用软删除

### 8. 状态持久化优化
- [x] localStorage 备份机制 ✅ (2026-01-12)
  - 操作后立即保存到 localStorage（pendingSync: true）
  - 刷新时优先恢复未同步的本地数据
  - 同步成功后标记 pendingSync: false
- [x] 过滤大数据字段避免 localStorage 超限 ✅ (2026-01-12)
  - waveformData、transcript、thumbnail 不存入 localStorage
- [ ] 完善离线模式支持
- [ ] 版本冲突自动合并策略

---

## 🟢 已完成

- [x] Supabase 认证集成
- [x] Workspace 上传流程（异步）
- [x] Session 进度轮询
- [x] 项目列表页
- [x] 数据库 Schema V4
- [x] 循环导入问题修复（smart_clean.py）
- [x] 导航栏加大 + 退出登陆
- [x] 项目删除（级联删除 assets/clips/tracks/workspace_sessions）
- [x] ConfigureView 改为弹窗形式
- [x] 去掉 AI 编辑助手面板
- [x] 项目列表点击跳转到工作台
- [x] 轨道缩放 0.05-4.0（支持 15f 精度）
- [x] 统一 Track 命名（不区分音视频轨道）
- [x] Clip 类型颜色区分（video/audio/text/subtitle/filter/transition/sticker）
- [x] AssetPanel 显示素材而非 clips
- [x] 项目列表 duration 显示修复
- [x] 播放头拖动时视频/音频同步 ✅ (2026-01-12)
- [x] 阻塞性加载弹窗（视频未加载时禁止操作）✅ (2026-01-12)
- [x] Crop/删除操作刷新后持久化 ✅ (2026-01-12)
- [x] 前端开发规范文档 ✅ (2026-01-12) → `frontend/docs/DEVELOPMENT_STANDARDS.md`
- [x] B-Roll 宽高比自动匹配 ✅ (2026-02-01)

---

## 📝 备注

- Chrome DevTools 404 (`/.well-known/appspecific/com.chrome.devtools.json`) 是正常行为，可忽略
- 开发环境不需要 Celery，同步模式足够

---

*最后更新：2026-02-01*
