-- ============================================================================
-- HoppingRabbit AI - 完整数据库 Schema
-- 生成日期: 2026-01-15
-- 最后更新: 2026-01-23
-- 说明: 纯表定义，无函数/触发器/视图
-- 更新记录:
--   - 2026-01-23: 添加 ai_tasks 表 (AI 任务状态追踪)
--   - 2026-01-23: assets 表新增 ai_task_id, ai_generated 字段
--   - 2026-01-19: 添加 exports.created_at 索引，优化导出列表查询
--   - 集成所有迁移文件 (proxy_path, hls_path, order_index, 
--     upload_progress, multi-asset, smart_clip_v2)
-- ============================================================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. 项目表 (projects)
-- ============================================================================
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL DEFAULT 'Untitled Project',
    description TEXT,
    thumbnail_url TEXT,
    resolution JSONB DEFAULT '{"width": 1920, "height": 1080}'::jsonb,
    fps INTEGER DEFAULT 30,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'ready', 'exported', 'archived')),
    wizard_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_created_at ON projects(created_at DESC);

-- ============================================================================
-- 2. 素材表 (assets)
-- ============================================================================
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    original_filename TEXT,
    file_type TEXT NOT NULL CHECK (file_type IN ('video', 'audio', 'image', 'subtitle')),
    mime_type TEXT,
    file_size BIGINT,
    storage_path TEXT NOT NULL,
    thumbnail_path TEXT,
    duration FLOAT,
    width INTEGER,
    height INTEGER,
    fps FLOAT,
    sample_rate INTEGER,
    channels INTEGER,
    waveform_data JSONB,
    status TEXT DEFAULT 'uploading' CHECK (status IN ('uploading', 'uploaded', 'processing', 'ready', 'error')),
    error_message TEXT,
    -- 代理视频路径 (720p 低码率版本用于编辑预览)
    proxy_path TEXT,
    -- HLS 流文件目录路径（存储 playlist.m3u8 和 .ts 分片）
    hls_path TEXT,
    -- 素材在会话中的排序索引，用于多素材上传场景
    order_index INTEGER DEFAULT 0,
    -- 上传进度信息: {bytes_uploaded, total_bytes, percentage, completed}
    upload_progress JSONB DEFAULT '{}'::jsonb,
    -- AI 生成相关
    ai_task_id UUID,  -- 关联的 AI 任务 ID (延迟引用)
    ai_generated BOOLEAN DEFAULT FALSE,  -- 是否为 AI 生成的素材
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_project_id ON assets(project_id);
CREATE INDEX idx_assets_user_id ON assets(user_id);
CREATE INDEX idx_assets_file_type ON assets(file_type);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_hls_path ON assets(hls_path) WHERE hls_path IS NOT NULL;
CREATE INDEX idx_assets_ai_task_id ON assets(ai_task_id);
CREATE INDEX idx_assets_ai_generated ON assets(ai_generated);

-- ============================================================================
-- 3. 任务表 (tasks)
-- ============================================================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    asset_id UUID,
    user_id UUID NOT NULL,
    task_type TEXT NOT NULL CHECK (task_type IN (
        'transcribe', 'vad', 'filler_detection', 'diarization',
        'stem_separation', 'smart_clean', 'smart_camera', 'export', 'subtitle_burn', 'asset_processing'
    )),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    celery_task_id TEXT,
    params JSONB DEFAULT '{}'::jsonb,
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_asset_id ON tasks(asset_id);
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_task_type ON tasks(task_type);
CREATE INDEX idx_tasks_celery_task_id ON tasks(celery_task_id);

-- ============================================================================
-- 4. 快照表 (snapshots)
-- ============================================================================
CREATE TABLE snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    state JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_snapshots_project_id ON snapshots(project_id);
CREATE INDEX idx_snapshots_version ON snapshots(project_id, version DESC);

-- ============================================================================
-- 5. 导出表 (exports)
-- ============================================================================
CREATE TABLE exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    format TEXT NOT NULL DEFAULT 'mp4' CHECK (format IN ('mp4', 'mov', 'webm', 'gif', 'mp3', 'wav')),
    quality TEXT DEFAULT 'high' CHECK (quality IN ('low', 'medium', 'high', 'ultra')),
    -- resolution 存储结构: {"preset": "1080p", "config": {...}}
    -- preset: 分辨率预设标识
    -- config: 完整导出配置，用于重试功能
    resolution JSONB,
    output_path TEXT,
    file_size BIGINT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    error_message TEXT,
    task_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_exports_project_id ON exports(project_id);
CREATE INDEX idx_exports_user_id ON exports(user_id);
CREATE INDEX idx_exports_status ON exports(status);
-- 优化: 导出列表按创建时间倒序查询，需要此索引
CREATE INDEX idx_exports_created_at ON exports(created_at DESC);

-- ============================================================================
-- 6. 轨道表 (tracks)
-- ============================================================================
-- 轨道设计说明:
--   Track 是通用容器，不区分类型
--   素材类型由 clips.clip_type 决定（video/audio/subtitle 等）
--   任何类型的 Clip 都可以放在任意轨道上
CREATE TABLE tracks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    name TEXT NOT NULL DEFAULT 'Track',
    order_index INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    is_locked BOOLEAN DEFAULT false,
    is_muted BOOLEAN DEFAULT false,
    adjustment_params JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tracks_project_id ON tracks(project_id);
CREATE INDEX idx_tracks_order ON tracks(project_id, order_index);

-- ============================================================================
-- 7. 片段表 (clips)
-- ============================================================================
-- 片段类型说明:
--   video: 视频片段
--   audio: 音频片段
--   subtitle: 字幕片段 (关联到时间轴的文字)
--   text: 文案片段 (独立的文案内容，可被AI处理切分)
--   voice: 配音片段 (TTS生成或录制的旁白)
--   effect: 特效片段 (视觉效果，如粒子、动画)
--   filter: 滤镜片段 (颜色调整、风格滤镜)
--   sticker: 贴纸片段
--   transition: 转场片段
CREATE TABLE clips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    track_id UUID NOT NULL,
    asset_id UUID,
    
    -- 片段类型 (核心字段：区分不同类型的clip)
    clip_type TEXT NOT NULL DEFAULT 'video' CHECK (clip_type IN ('video', 'audio', 'subtitle', 'text', 'voice', 'effect', 'filter', 'sticker', 'transition')),
    
    -- 时间信息 (毫秒)
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    source_start INTEGER DEFAULT 0,
    source_end INTEGER,
    
    -- 音频属性 (适用于 video, audio, voice)
    volume FLOAT DEFAULT 1.0 CHECK (volume >= 0 AND volume <= 2),
    is_muted BOOLEAN DEFAULT false,
    
    -- 视觉变换 (适用于 video, text, sticker, effect)
    transform JSONB DEFAULT '{"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1}'::jsonb,
    
    -- 转场效果
    transition_in JSONB,
    transition_out JSONB,
    
    -- 播放速度
    speed FLOAT DEFAULT 1.0 CHECK (speed > 0 AND speed <= 10),
    
    -- 分割追溯
    parent_clip_id UUID,
    
    -- 文本内容 (适用于 subtitle, text)
    content_text TEXT,
    text_style JSONB DEFAULT '{"fontFamily": "default", "fontSize": 24, "fontColor": "#FFFFFF", "backgroundColor": "transparent", "alignment": "center"}'::jsonb,
    
    -- 特效/滤镜参数 (适用于 effect, filter)
    effect_type TEXT,
    effect_params JSONB,
    
    -- 配音/语音参数 (适用于 voice)
    voice_params JSONB,
    
    -- 贴纸参数 (适用于 sticker)
    sticker_id TEXT,
    
    -- 缓存
    cached_url TEXT,
    cached_url_expires_at TIMESTAMPTZ,
    
    -- 元数据
    name TEXT,
    color TEXT,
    metadata JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_time_range CHECK (end_time > start_time),
    CONSTRAINT valid_source_range CHECK (source_end IS NULL OR source_end > source_start)
);

CREATE INDEX idx_clips_track_id ON clips(track_id);
CREATE INDEX idx_clips_asset_id ON clips(asset_id);
CREATE INDEX idx_clips_time_range ON clips(start_time, end_time);
CREATE INDEX idx_clips_parent ON clips(parent_clip_id);

-- ============================================================================
-- 8. 关键帧表 (keyframes)
-- ============================================================================
CREATE TABLE keyframes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clip_id UUID NOT NULL,
    
    -- 属性标识: position, scale, rotation, opacity, volume, pan, blur
    -- 复合属性 (position/scale) 存储 {"x": number, "y": number}
    -- 简单属性存储 number
    property TEXT NOT NULL,
    
    -- 时间位置（相对于 clip 的归一化偏移，0-1 范围）
    -- 0 = clip 起点，1 = clip 终点
    "offset" REAL NOT NULL,
    
    -- 属性值（JSONB 支持复合值 {x, y} 和简单值 number）
    value JSONB NOT NULL,
    
    -- 插值类型: linear, ease_in, ease_out, ease_in_out, hold, bezier
    easing TEXT NOT NULL DEFAULT 'linear',
    
    -- 贝塞尔控制点（当 easing = 'bezier' 时使用）
    bezier_control JSONB,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_keyframes_clip_id ON keyframes(clip_id);
CREATE INDEX idx_keyframes_clip_property ON keyframes(clip_id, property);
CREATE UNIQUE INDEX idx_keyframes_unique ON keyframes(clip_id, property, "offset");

-- ============================================================================
-- 9. 工作区会话表 (workspace_sessions)
-- ============================================================================
CREATE TABLE workspace_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    project_id UUID,
    status TEXT DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'completed', 'failed', 'cancelled')),
    uploaded_asset_id UUID,
    -- 关联的多个素材ID数组，用于多素材上传场景
    uploaded_asset_ids UUID[] DEFAULT '{}',
    upload_source TEXT CHECK (upload_source IN ('local', 'youtube', 'url')),
    source_url TEXT,
    task_type TEXT DEFAULT 'clips',
    processing_steps JSONB DEFAULT '{"asr": true, "silence_removal": true}'::jsonb,
    selected_tasks JSONB DEFAULT '[]'::jsonb,
    current_step TEXT,
    progress INTEGER DEFAULT 0,
    transcript_segments INTEGER DEFAULT 0,
    marked_clips INTEGER DEFAULT 0,
    error_message TEXT,
    -- 多文件上传进度跟踪: {total_files, completed_files, failed_files, etc}
    upload_progress JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_workspace_sessions_user_id ON workspace_sessions(user_id);
CREATE INDEX idx_workspace_sessions_project_id ON workspace_sessions(project_id);
CREATE INDEX idx_workspace_sessions_status ON workspace_sessions(status);

-- ============================================================================
-- 10. 项目脚本表 (project_scripts)
-- 用户上传的原始脚本，用于对比实际口播内容
-- ============================================================================
CREATE TABLE project_scripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    
    -- 脚本内容
    content TEXT NOT NULL,
    
    -- 脚本元数据
    title TEXT,  -- 脚本标题（可选）
    word_count INTEGER,  -- 字数统计
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_project_scripts_project_id ON project_scripts(project_id);
CREATE INDEX idx_project_scripts_user_id ON project_scripts(user_id);

-- ============================================================================
-- 11. 内容分析结果表 (content_analyses)
-- LLM 一站式智能分析的完整结果
-- ============================================================================
CREATE TABLE content_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    
    -- 分析模式
    mode TEXT NOT NULL CHECK (mode IN ('with_script', 'without_script')),
    
    -- 分析结果 (JSONB)
    -- segments: 分析后的片段列表，每个包含 action/classification/confidence 等
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- repeat_groups: 重复片段组，包含 recommended_id 和 recommend_reason
    repeat_groups JSONB DEFAULT '[]'::jsonb,
    
    -- style_analysis: 风格分析结果，包含 detected_style 和 zoom_recommendation
    style_analysis JSONB,
    
    -- zoom_recommendations: 缩放推荐列表
    zoom_recommendations JSONB DEFAULT '[]'::jsonb,
    
    -- summary: 分析统计摘要
    summary JSONB DEFAULT '{}'::jsonb,
    
    -- 处理阶段 (用于前端展示进度)
    processing_stage TEXT DEFAULT 'pending' CHECK (processing_stage IN (
        'pending',       -- 等待处理
        'uploading',     -- 上传中
        'transcribing',  -- 语音转写中
        'analyzing',     -- AI 智能分析中
        'generating',    -- 生成推荐方案
        'completed',     -- 分析完成
        'failed'         -- 失败
    )),
    processing_progress INTEGER DEFAULT 0 CHECK (processing_progress >= 0 AND processing_progress <= 100),
    processing_message TEXT,  -- 当前阶段的描述信息
    
    -- 状态
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'confirmed', 'failed')),
    error_message TEXT,
    
    -- 关联的任务 ID
    task_id UUID,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_content_analyses_project_id ON content_analyses(project_id);
CREATE INDEX idx_content_analyses_user_id ON content_analyses(user_id);
CREATE INDEX idx_content_analyses_status ON content_analyses(status);
CREATE INDEX idx_content_analyses_processing_stage ON content_analyses(processing_stage);

-- ============================================================================
-- 12. 用户选择记录表 (content_selections)
-- 用户在审核界面的选择结果
-- ============================================================================
CREATE TABLE content_selections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_id UUID NOT NULL REFERENCES content_analyses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    
    -- 选择结果 (JSONB)
    -- [{segment_id, action: 'keep'|'delete', selected_from_group}]
    selections JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- 应用的选项
    apply_zoom_recommendations BOOLEAN DEFAULT TRUE,
    
    -- 最终生成的 clips 信息
    generated_clips_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_selections_analysis_id ON content_selections(analysis_id);
CREATE INDEX idx_content_selections_user_id ON content_selections(user_id);

-- ============================================================================
-- 13. AI 任务表 (ai_tasks)
-- AI 处理任务状态追踪：口型同步、换脸、换背景等
-- 创建时间: 2026-01-23
-- ============================================================================
CREATE TABLE ai_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,  -- 不添加 FK，由后端 service_key 管理
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    
    -- 任务类型
    -- lip_sync: 口型同步
    -- face_swap: AI换脸  
    -- background_replace: 换背景
    -- text_to_video: 文生视频
    -- image_to_video: 图生视频
    -- digital_human: 数字人口播
    task_type TEXT NOT NULL CHECK (task_type IN (
        'lip_sync', 'face_swap', 'background_replace',
        'text_to_video', 'image_to_video', 'digital_human'
    )),
    
    -- 任务来源
    -- rabbit_hole: Rabbit Hole AI 创作工具集
    -- editor: 编辑器内 AI 工具
    source TEXT NOT NULL DEFAULT 'rabbit_hole' CHECK (source IN ('rabbit_hole', 'editor')),
    
    -- 关联的源 Clip (仅 editor 来源)
    source_clip_id UUID REFERENCES clips(id) ON DELETE SET NULL,
    
    -- 输入参数 (JSONB)
    -- lip_sync: {"video_url": "...", "audio_url": "...", "face_index": 0}
    -- face_swap: {"video_url": "...", "face_image_url": "..."}
    input_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- 第三方 AI 服务
    provider TEXT NOT NULL DEFAULT 'kling',  -- kling: 可灵AI
    provider_task_id TEXT,  -- AI 服务返回的任务 ID
    
    -- 状态
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'completed', 'failed', 'cancelled'
    )),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    status_message TEXT,  -- 当前状态描述
    
    -- 输出
    output_url TEXT,  -- AI 生成的视频 URL
    output_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,  -- 关联到素材库
    
    -- 错误信息
    error_code TEXT,
    error_message TEXT,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_tasks_user_id ON ai_tasks(user_id);
CREATE INDEX idx_ai_tasks_project_id ON ai_tasks(project_id);
CREATE INDEX idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX idx_ai_tasks_task_type ON ai_tasks(task_type);
CREATE INDEX idx_ai_tasks_created_at ON ai_tasks(created_at DESC);
CREATE INDEX idx_ai_tasks_provider_task_id ON ai_tasks(provider_task_id);

-- ============================================================================
-- 完成 - 13 张表
-- ============================================================================

-- ============================================================================
-- 迁移 SQL (用于已有数据库增量更新)
-- 运行日期: 2026-01-19
-- ============================================================================

-- 1. 为 exports 表添加 created_at 索引 (优化导出列表查询)
-- CREATE INDEX IF NOT EXISTS idx_exports_created_at ON exports(created_at DESC);

-- 2. 为 exports 表添加 cancelled 状态 (如果之前没有)
-- ALTER TABLE exports DROP CONSTRAINT IF EXISTS exports_status_check;
-- ALTER TABLE exports ADD CONSTRAINT exports_status_check 
--   CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));

-- 3. 为 exports 表添加 updated_at 字段 (如果不存在)
-- ALTER TABLE exports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. 为 exports 表添加 progress 约束 (如果没有)
-- ALTER TABLE exports ADD CONSTRAINT exports_progress_check 
--   CHECK (progress >= 0 AND progress <= 100);
