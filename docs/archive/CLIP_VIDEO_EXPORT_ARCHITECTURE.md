# Clip 视频片段导出与 AI 生成架构设计

本文档描述如何将 Clip 片段提取为可发送给 AI 模型（Kling/Veo 等）的视频文件，以及生成结果如何回流到时间线。

---

## 0. 核心约束 ⚠️

**AI 生成必须满足以下硬性要求：**

| 约束 | 说明 |
|------|------|
| **时长精确匹配** | AI 生成视频时长必须与原 clip 时长**毫秒级一致** |
| **音频对齐** | 生成的画面必须与原 clip 音频完美对齐（口型、节奏） |
| **格式统一** | 默认 MP4 格式 |

**主要应用场景：**
- 🎬 **换背景**：保留人物动作和声音，替换背景
- 🌄 **生成场景**：根据音频/文案生成匹配的场景
- 👄 **对口型 (Lip Sync)**：让虚拟形象说话，口型与音频同步

**输出公式：**
```
最终视频 = AI 生成的画面 + 原 Clip 的音频
时长: 必须相等到毫秒级
```

---

## 1. 核心问题分析

### 1.1 当前状态

| 存储位置 | 格式 | 前端播放 | 后端处理 | AI 模型输入 |
|---------|------|---------|---------|------------|
| Cloudflare Stream | HLS (m3u8) | ✅ HLS.js | ❌ OpenCV 不支持 | ❌ 需要 URL/文件 |
| Supabase Storage | MP4 | ✅ 原生 | ✅ 直接读取 | ✅ 上传/URL |

### 1.2 场景需求

| 场景 | 输入 | 处理 | 输出要求 |
|------|------|------|---------|
| 场景检测 (PySceneDetect) | 完整视频 | 本地 OpenCV | 可读的视频文件 |
| 送 Kling AI | clip 片段 | Kling API | 公网可访问 URL 或 Base64 |
| 送 Veo | clip 片段 | Veo API | 公网可访问 URL |
| 前端播放 | 时间线 | HLS.js | 流式 HLS |

### 1.3 核心挑战

1. **片段提取**：从 HLS 流中提取 `source_start → source_end` 范围
2. **格式转换**：HLS → MP4（AI 模型通用格式）
3. **公网访问**：AI 模型需要可公网访问的 URL
4. **生成结果回流**：AI 生成的新视频如何关联到原 clip

---

## 2. 架构设计

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          API Layer                                   │
│  /api/clips/{clip_id}/export                                        │
│  /api/clips/{clip_id}/ai-enhance                                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ClipExportService                                │
│  - 片段裁剪 (FFmpeg)                                                 │
│  - 格式转换 (HLS → MP4)                                              │
│  - 临时存储管理                                                       │
│  - 公网 URL 生成                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Storage Layer                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ Cloudflare Stream │  │ Supabase Storage │  │  Local Cache     │   │
│  │  (HLS 源)         │  │  (导出的 MP4)    │  │  (临时文件)      │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
                     Clip 片段导出流程
                     ═══════════════════
                     
        ┌────────────────────────────────────────┐
        │ 1. 获取 Clip 信息                       │
        │    clip_id → asset_id, source_start/end│
        └───────────────────┬────────────────────┘
                            │
                            ▼
        ┌────────────────────────────────────────┐
        │ 2. 获取视频源                           │
        │    asset → storage_path (cloudflare:xxx)│
        └───────────────────┬────────────────────┘
                            │
                            ▼
        ┌────────────────────────────────────────┐
        │ 3. FFmpeg 片段裁剪                      │
        │    HLS URL → 临时 MP4                   │
        │    ffmpeg -ss {start} -to {end}        │
        └───────────────────┬────────────────────┘
                            │
                            ▼
        ┌────────────────────────────────────────┐
        │ 4. 上传到 Supabase Storage              │
        │    临时 MP4 → exports/{clip_id}.mp4    │
        │    返回公网可访问 URL                   │
        └───────────────────┬────────────────────┘
                            │
                            ▼
        ┌────────────────────────────────────────┐
        │ 5. 返回导出信息                         │
        │    {url, duration, format, size}       │
        └────────────────────────────────────────┘
```

---

## 3. 数据模型扩展

### 3.1 clip_exports 表 (新增)

```sql
-- 记录 clip 导出信息（缓存，避免重复导出）
CREATE TABLE clip_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    
    -- 导出规格
    format TEXT NOT NULL DEFAULT 'mp4',    -- 固定 mp4
    resolution TEXT DEFAULT '1080p',        -- 原始, 720p, 1080p
    quality TEXT DEFAULT 'medium',          -- low, medium, high
    
    -- 片段范围（来自 clip）
    source_start INTEGER NOT NULL,          -- 毫秒
    source_end INTEGER NOT NULL,            -- 毫秒
    
    -- 导出结果
    storage_path TEXT,                      -- exports/{clip_id}_{hash}.mp4
    public_url TEXT,                        -- 公网可访问 URL
    
    -- 独立音频轨（用于 AI 生成后合成）
    audio_storage_path TEXT,                -- exports/{clip_id}_{hash}.aac
    audio_url TEXT,                         -- 音频公网 URL
    
    -- 精确时长（毫秒）
    duration_ms INTEGER NOT NULL,           -- 精确到毫秒
    
    file_size BIGINT,
    
    -- 缓存控制
    fingerprint TEXT NOT NULL,              -- hash(clip_id + source_range + quality + extract_audio)
    expires_at TIMESTAMPTZ,                 -- URL 过期时间
    
    -- 状态
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'error')),
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clip_exports_clip_id ON clip_exports(clip_id);
CREATE UNIQUE INDEX idx_clip_exports_fingerprint ON clip_exports(fingerprint);
```

### 3.2 clip_ai_generations 表 (新增)

```sql
-- 记录 clip 的 AI 生成任务和结果
CREATE TABLE clip_ai_generations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 源 clip
    source_clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    clip_export_id UUID REFERENCES clip_exports(id),  -- 使用的导出版本
    
    -- AI 任务
    provider TEXT NOT NULL,                 -- kling, veo, runway
    model TEXT NOT NULL,                    -- kling-v2-1-master, veo-2
    task_type TEXT NOT NULL,                -- background_replace, scene_generate, lip_sync
    task_id TEXT,                           -- 提供商任务 ID
    
    -- 任务参数
    prompt TEXT,
    parameters JSONB DEFAULT '{}',
    
    -- ⚠️ 时长约束（毫秒级精确）
    expected_duration_ms INTEGER NOT NULL,  -- 期望时长 = 原 clip 时长
    actual_duration_ms INTEGER,             -- AI 实际生成的时长
    duration_adjusted BOOLEAN DEFAULT FALSE, -- 是否进行了时长调整
    
    -- 任务状态
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'merging', 'completed', 'failed')),
    progress INTEGER DEFAULT 0,
    error_message TEXT,
    
    -- AI 原始结果
    ai_result_url TEXT,                     -- AI 返回的视频 URL（仅画面）
    
    -- 最终结果（AI 画面 + 原音频 合成后）
    final_storage_path TEXT,                -- 合成后的视频路径
    final_url TEXT,                         -- 合成后的公网 URL
    result_asset_id UUID REFERENCES assets(id),  -- 作为新 asset 保存
    
    -- 应用到时间线
    applied BOOLEAN DEFAULT FALSE,
    applied_clip_id UUID REFERENCES clips(id),
    
    -- 元数据
    credits_used INTEGER DEFAULT 0,
    processing_time_ms INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clip_ai_generations_source ON clip_ai_generations(source_clip_id);
CREATE INDEX idx_clip_ai_generations_status ON clip_ai_generations(status);
CREATE INDEX idx_clip_ai_generations_provider ON clip_ai_generations(provider);
```

---

## 4. API 设计

### 4.1 导出 Clip 片段

```
POST /api/clips/{clip_id}/export
Request:
{
    "format": "mp4",           // 可选: mp4, webm
    "resolution": "1080p",     // 可选: original, 720p, 1080p
    "quality": "medium"        // 可选: low, medium, high
}

Response:
{
    "export_id": "uuid",
    "status": "ready",         // pending, processing, ready
    "url": "https://...",      // 公网可访问 URL
    "duration": 5.2,           // 秒
    "file_size": 12345678,
    "expires_at": "2026-02-10T00:00:00Z"
}
```

### 4.2 AI 增强 Clip

```
POST /api/clips/{clip_id}/ai-enhance
Request:
{
    "provider": "kling",
    "model": "kling-v2-1-master",
    "task_type": "enhance",    // enhance, extend, regenerate
    "prompt": "提升画质，增加动感",
    "parameters": {
        "aspect_ratio": "16:9",
        "duration": 5
    },
    "auto_apply": true         // 生成后自动应用到时间线
}

Response:
{
    "generation_id": "uuid",
    "task_id": "kling-task-xxx",
    "status": "processing",
    "estimated_time": 120      // 预计秒数
}
```

### 4.3 查询 AI 生成状态

```
GET /api/clips/ai-generations/{generation_id}

Response:
{
    "id": "uuid",
    "status": "completed",
    "progress": 100,
    "result": {
        "url": "https://kling.../video.mp4",
        "duration": 5.0,
        "applied": true,
        "applied_clip_id": "uuid"
    }
}
```

### 4.4 应用 AI 结果到时间线

```
POST /api/clips/ai-generations/{generation_id}/apply
Request:
{
    "mode": "replace",         // replace, overlay, append
    "target_clip_id": "uuid"   // 可选：指定替换哪个 clip
}

Response:
{
    "clip_id": "uuid",         // 新创建/更新的 clip ID
    "track_id": "uuid",
    "start_time": 5000,
    "end_time": 10000
}
```

---

## 5. 服务实现

### 5.1 ClipExportService

```python
# backend/app/services/clip_export.py

class ClipExportService:
    """
    Clip 片段导出服务
    
    导出格式：MP4 (默认)
    支持同时导出独立音频轨（用于 AI 生成后合成）
    """
    
    async def export_clip(
        self,
        clip_id: str,
        resolution: str = "1080p",
        quality: str = "medium",
        extract_audio: bool = False,  # 是否同时导出独立音频
    ) -> ClipExportResult:
        """
        导出 clip 片段为独立视频文件
        
        1. 查询 clip 和关联 asset
        2. 检查缓存（相同 fingerprint 的导出）
        3. 获取视频源 (HLS URL)
        4. FFmpeg 裁剪片段
        5. 可选：提取独立音频轨
        6. 上传到 Supabase Storage
        7. 返回公网 URL
        """
        
        # 1. 获取 clip 信息
        clip = await self._get_clip(clip_id)
        asset = await self._get_asset(clip.asset_id)
        
        # 2. 计算 fingerprint 检查缓存
        fingerprint = self._compute_fingerprint(clip, resolution, quality, extract_audio)
        cached = await self._get_cached_export(fingerprint)
        if cached and cached.status == 'ready':
            return cached
        
        # 3. 获取视频源 URL
        video_url = self._get_video_url(asset)
        
        # 4. FFmpeg 裁剪
        temp_video_path = await self._extract_clip(
            video_url=video_url,
            start_ms=clip.source_start,
            end_ms=clip.source_end,
            resolution=resolution,
            quality=quality,
        )
        
        # 5. 提取独立音频（用于 AI 生成后合成）
        temp_audio_path = None
        audio_url = None
        if extract_audio:
            temp_audio_path = await self._extract_audio(temp_video_path)
            audio_storage_path = f"exports/{clip_id}_{fingerprint[:8]}.aac"
            audio_url = await self._upload_to_storage(temp_audio_path, audio_storage_path)
        
        # 6. 上传视频到 Storage
        storage_path = f"exports/{clip_id}_{fingerprint[:8]}.mp4"
        public_url = await self._upload_to_storage(temp_video_path, storage_path)
        
        # 7. 获取精确时长
        duration_ms = await self._get_video_duration_ms(temp_video_path)
        
        # 8. 保存记录
        export = await self._save_export_record(
            clip_id=clip_id,
            fingerprint=fingerprint,
            storage_path=storage_path,
            public_url=public_url,
            audio_url=audio_url,
            duration_ms=duration_ms,
            ...
        )
        
        # 9. 清理临时文件
        await self._cleanup_temp_files([temp_video_path, temp_audio_path])
        
        return export
    
    def _get_video_url(self, asset) -> str:
        """获取可读取的视频 URL"""
        storage_path = asset.storage_path
        
        if storage_path.startswith("cloudflare:"):
            video_uid = storage_path.replace("cloudflare:", "")
            # Cloudflare HLS URL (FFmpeg 支持)
            return f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"
        
        return storage_path
    
    async def _extract_clip(
        self,
        video_url: str,
        start_ms: int,
        end_ms: int,
        resolution: str,
        quality: str,
    ) -> str:
        """使用 FFmpeg 裁剪片段"""
        
        start_sec = start_ms / 1000
        duration_sec = (end_ms - start_ms) / 1000
        
        temp_path = f"/tmp/clip_export_{uuid4()}.mp4"
        
        # 构建 FFmpeg 命令
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_sec),       # 起始时间
            "-i", video_url,             # 输入 (支持 HLS)
            "-t", str(duration_sec),     # 时长
            "-c:v", "libx264",           # 视频编码
            "-c:a", "aac",               # 音频编码
            "-movflags", "+faststart",   # 快速启动
            temp_path
        ]
        
        # 添加分辨率缩放
        if resolution != "original":
            scale = {"720p": "1280:720", "1080p": "1920:1080"}[resolution]
            cmd.insert(-1, "-vf")
            cmd.insert(-1, f"scale={scale}")
        
        await asyncio.create_subprocess_exec(*cmd)
        
        return temp_path
    
    async def _extract_audio(self, video_path: str) -> str:
        """提取独立音频轨"""
        
        audio_path = video_path.replace(".mp4", ".aac")
        
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",                # 不要视频
            "-acodec", "copy",    # 直接复制音频流
            audio_path
        ]
        
        await asyncio.create_subprocess_exec(*cmd)
        return audio_path
    
    async def _get_video_duration_ms(self, video_path: str) -> int:
        """获取视频精确时长（毫秒）"""
        
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_path
        ]
        
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        
        duration_sec = float(stdout.decode().strip())
        return int(duration_sec * 1000)
```

### 5.2 ClipAIEnhanceService

```python
# backend/app/services/clip_ai_enhance.py

class ClipAIEnhanceService:
    """
    Clip AI 增强服务
    
    核心约束：
    - AI 生成视频时长必须与原 clip 时长毫秒级一致
    - 最终输出 = AI 画面 + 原 clip 音频
    """
    
    def __init__(self):
        self.export_service = ClipExportService()
        self.video_generators = {
            "kling": get_kling_generator(),
            "veo": get_veo_generator(),
        }
    
    async def enhance_clip(
        self,
        clip_id: str,
        provider: str,
        model: str,
        task_type: str,  # background_replace, scene_generate, lip_sync
        prompt: str = "",
        parameters: dict = None,
    ) -> ClipAIGeneration:
        """
        使用 AI 增强 clip
        
        流程:
        1. 导出 clip 片段 (视频 + 音频分离)
        2. 创建 AI 生成任务
        3. 等待完成
        4. 合成：AI 画面 + 原音频
        5. 验证时长一致性
        """
        
        # 1. 导出片段（包括独立的音频轨）
        export = await self.export_service.export_clip(
            clip_id,
            extract_audio=True,  # 同时导出音频
        )
        
        clip_duration_ms = export.duration * 1000  # 毫秒
        
        # 2. 获取生成器
        generator = self.video_generators[provider]
        
        # 3. 根据任务类型调用不同 API
        if task_type == "lip_sync":
            # 对口型：需要音频 + 目标形象
            task = await generator.lip_sync(
                audio_url=export.audio_url,
                avatar_image=parameters.get("avatar_image"),
                model=model,
                duration=clip_duration_ms,  # 强制指定时长
            )
        elif task_type == "background_replace":
            # 换背景：提取人物 + 生成新背景
            task = await generator.background_replace(
                video_url=export.url,
                background_prompt=prompt,
                model=model,
                duration=clip_duration_ms,
            )
        elif task_type == "scene_generate":
            # 场景生成：根据音频/文案生成画面
            task = await generator.scene_generate(
                prompt=prompt,
                audio_url=export.audio_url,  # 用于节奏匹配
                duration=clip_duration_ms,
                model=model,
            )
        
        # 4. 保存生成记录
        generation = await self._save_generation(
            source_clip_id=clip_id,
            clip_export_id=export.id,
            provider=provider,
            model=model,
            task_type=task_type,
            task_id=task.task_id,
            expected_duration_ms=clip_duration_ms,  # 记录期望时长
        )
        
        return generation
    
    async def finalize_generation(self, generation_id: str) -> ClipAIGeneration:
        """
        AI 任务完成后的后处理
        
        1. 下载 AI 生成的视频
        2. 验证时长一致性
        3. 合成：AI 画面 + 原音频
        4. 创建新 asset
        """
        
        generation = await self._get_generation(generation_id)
        export = await self._get_export(generation.clip_export_id)
        
        # 1. 下载 AI 结果
        ai_video_path = await self._download_video(generation.result_url)
        
        # 2. 验证时长
        ai_duration_ms = await self._get_video_duration_ms(ai_video_path)
        expected_ms = generation.expected_duration_ms
        
        if abs(ai_duration_ms - expected_ms) > 100:  # 允许 100ms 误差
            # 时长不匹配，需要调整
            ai_video_path = await self._adjust_duration(
                video_path=ai_video_path,
                target_duration_ms=expected_ms,
            )
        
        # 3. 合成：AI 画面 + 原音频
        final_video_path = await self._merge_video_audio(
            video_path=ai_video_path,      # AI 生成的画面
            audio_path=export.audio_path,   # 原 clip 的音频
            output_path=f"/tmp/final_{generation_id}.mp4",
        )
        
        # 4. 上传并创建 asset
        result_asset = await self._upload_and_create_asset(
            video_path=final_video_path,
            source_clip_id=generation.source_clip_id,
            metadata={
                "ai_generated": True,
                "provider": generation.provider,
                "model": generation.model,
                "task_type": generation.task_type,
            }
        )
        
        # 5. 更新记录
        generation.result_asset_id = result_asset.id
        generation.status = "completed"
        await self._update_generation(generation)
        
        return generation
    
    async def _merge_video_audio(
        self,
        video_path: str,
        audio_path: str,
        output_path: str,
    ) -> str:
        """
        合成视频和音频
        
        FFmpeg: 取 AI 视频的画面 + 原 clip 的音频
        """
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,          # AI 生成的视频（可能有或没有音频）
            "-i", audio_path,          # 原 clip 的音频
            "-map", "0:v:0",           # 取第一个输入的视频流
            "-map", "1:a:0",           # 取第二个输入的音频流
            "-c:v", "copy",            # 视频直接复制
            "-c:a", "aac",             # 音频转 AAC
            "-shortest",               # 以较短的为准
            output_path
        ]
        
        await asyncio.create_subprocess_exec(*cmd)
        return output_path
    
    async def _adjust_duration(
        self,
        video_path: str,
        target_duration_ms: int,
    ) -> str:
        """
        调整视频时长到精确值
        
        策略：
        - 如果 AI 视频略长：裁剪末尾
        - 如果 AI 视频略短：最后一帧定格补齐
        """
        current_ms = await self._get_video_duration_ms(video_path)
        target_sec = target_duration_ms / 1000
        
        output_path = video_path.replace(".mp4", "_adjusted.mp4")
        
        if current_ms > target_duration_ms:
            # 裁剪
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-t", str(target_sec),
                "-c", "copy",
                output_path
            ]
        else:
            # 定格最后一帧补齐
            pad_duration = (target_duration_ms - current_ms) / 1000
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-vf", f"tpad=stop_mode=clone:stop_duration={pad_duration}",
                "-c:a", "copy",
                output_path
            ]
        
        await asyncio.create_subprocess_exec(*cmd)
        return output_path
```

---

## 6. 工作流集成

### 6.1 场景检测 (PySceneDetect)

```python
# 在 shot_segmentation.py 中

async def run_segmentation_task(...):
    # 使用 ClipExportService 的相同逻辑处理 Cloudflare 视频
    if storage_path.startswith("cloudflare:"):
        video_uid = storage_path.replace("cloudflare:", "")
        hls_url = f"https://videodelivery.net/{video_uid}/manifest/video.m3u8"
        
        # FFmpeg 下载到临时文件（PySceneDetect 需要）
        temp_path = await download_hls_to_mp4(hls_url)
        video_path = temp_path
```

### 6.2 前端交互

```typescript
// 用户选择 clip，点击 "AI 增强"
async function enhanceClip(clipId: string, options: EnhanceOptions) {
  // 1. 发起增强请求
  const { generation_id } = await api.post(`/clips/${clipId}/ai-enhance`, options);
  
  // 2. 轮询状态
  while (true) {
    const status = await api.get(`/clips/ai-generations/${generation_id}`);
    
    if (status.status === 'completed') {
      // 3. 如果没有自动应用，询问用户
      if (!options.auto_apply) {
        const mode = await showApplyDialog(); // replace, overlay, append
        await api.post(`/clips/ai-generations/${generation_id}/apply`, { mode });
      }
      
      // 4. 刷新时间线
      await reloadTimeline();
      break;
    }
    
    if (status.status === 'failed') {
      showError(status.error_message);
      break;
    }
    
    await sleep(2000);
  }
}
```

---

## 7. 存储策略

### 7.1 临时文件管理

```
/tmp/clip_exports/
  ├── {uuid}.mp4           # 裁剪后的临时文件
  └── {uuid}_keyframe.jpg  # 提取的关键帧

# 清理策略：
# - 处理完成后立即删除
# - 定时任务清理 > 1 小时的临时文件
```

### 7.2 持久存储

```
Supabase Storage: clip-exports/
  ├── {clip_id}_{fingerprint}.mp4   # 导出的片段
  └── ai-results/
      └── {generation_id}.mp4       # AI 生成的视频

# 缓存策略：
# - clip_exports 记录 fingerprint 避免重复导出
# - 导出文件 7 天过期
# - AI 结果永久保存（作为新 asset）
```

---

## 8. 性能优化

### 8.1 FFmpeg 优化

```bash
# 使用 stream copy 避免重新编码（如果不需要格式转换）
ffmpeg -ss {start} -i {hls_url} -t {duration} -c copy output.mp4

# 使用 GPU 加速（如果可用）
ffmpeg -ss {start} -i {hls_url} -t {duration} -c:v h264_nvenc output.mp4
```

### 8.2 并行处理

```python
# 批量导出多个 clips
async def batch_export_clips(clip_ids: List[str]) -> List[ClipExportResult]:
    tasks = [export_clip(clip_id) for clip_id in clip_ids]
    return await asyncio.gather(*tasks)
```

### 8.3 预导出

```python
# 用户选择 clip 时预先开始导出
@on_clip_selected
async def prefetch_export(clip_id: str):
    # 后台开始导出，用户点击 AI 增强时已经就绪
    asyncio.create_task(export_service.export_clip(clip_id))
```

---

## 9. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| HLS 下载失败 | 重试 3 次，使用备用 CDN |
| FFmpeg 超时 | 取消任务，返回错误 |
| AI 任务失败 | 返回错误信息，不扣费 |
| 存储上传失败 | 重试，使用本地缓存 |

---

## 10. 待讨论问题

1. **AI 模型时长控制**：Kling/Veo 是否支持精确指定生成时长？需要调研各模型的时长控制能力
2. **时长调整策略**：AI 生成时长不匹配时，裁剪 vs 定格补齐，哪个效果更好？
3. **Lip Sync 精度**：对口型场景对时长精度要求最高，Kling lip-sync API 的精度如何？

---

**文档版本**: v1.1  
**最后更新**: 2026-02-03  
**维护者**: AI Assistant
