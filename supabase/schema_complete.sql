-- ============================================================================
-- HoppingRabbit AI - 完整数据库 Schema
-- 生成日期: 2026-01-15
-- 最后更新: 2026-01-26
-- 说明: 纯表定义，无函数/触发器/视图
-- 更新记录:
--   - 2026-01-26: 积分系统简化为固定计费 (ai_model_credits 只保留 credits_per_call)
--   - 2026-01-26: 统一命名 ai_create
--   - 2026-01-26: 添加积分系统 (ai_model_credits, user_credits, credit_transactions)
--   - 2026-01-25: 重构订阅系统 (subscription_plans 新增 credits_per_month/bonus_credits/badge 等字段)
--   - 2026-01-25: 添加 subscription_history 订阅历史表
--   - 2026-01-25: 订阅计划改为 Free/Basic/Pro/Ultimate/Creator 五档
--   - 2026-01-25: 添加用户配额系统 (user_profiles, user_quotas, subscription_plans, user_subscriptions)
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
    -- ★ Cloudflare Stream 集成
    cloudflare_uid VARCHAR(64),           -- Cloudflare Stream 视频 UID
    cloudflare_status VARCHAR(32) DEFAULT 'none',  -- none/uploading/processing/ready/error
    -- ★ MP4 快速启动优化
    faststart_applied BOOLEAN DEFAULT FALSE,  -- 是否已应用 faststart 优化
    -- 素材在会话中的排序索引，用于多素材上传场景
    order_index INTEGER DEFAULT 0,
    -- 上传进度信息: {bytes_uploaded, total_bytes, percentage, completed}
    upload_progress JSONB DEFAULT '{}'::jsonb,
    -- AI 生成相关
    ai_task_id UUID,  -- 关联的 AI 任务 ID (延迟引用)
    ai_generated BOOLEAN DEFAULT FALSE,  -- 是否为 AI 生成的素材
    metadata JSONB DEFAULT '{}',  -- 扩展元数据（如 transcript_segments）
    -- ★ 用户素材系统扩展
    asset_category TEXT DEFAULT 'ai_generated' CHECK (asset_category IN ('ai_generated', 'user_material')),
    material_type TEXT DEFAULT 'general' CHECK (material_type IN ('avatar', 'voice_sample', 'general')),
    material_metadata JSONB DEFAULT '{}',
    display_name TEXT,
    is_favorite BOOLEAN DEFAULT FALSE,
    tags TEXT[] DEFAULT '{}',
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    -- ★ B-Roll 元数据
    broll_metadata JSONB,  -- {source, external_id, author, author_url, original_url, license, keywords, quality, orientation}
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
CREATE INDEX idx_assets_cloudflare_uid ON assets(cloudflare_uid);
CREATE INDEX idx_assets_cloudflare_status ON assets(cloudflare_status);
CREATE INDEX idx_assets_asset_category ON assets(asset_category);
CREATE INDEX idx_assets_material_type ON assets(material_type);
CREATE INDEX idx_assets_is_favorite ON assets(is_favorite);
CREATE INDEX idx_assets_last_used_at ON assets(last_used_at DESC);
CREATE INDEX idx_assets_broll_source ON assets((broll_metadata->>'source'));

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
--   video: 视频片段 (主视频，必须连续排列，不允许有间隙)
--   broll: B-Roll 视频片段 (video 的子类型，覆盖层，可以有间隙)
--   audio: 音频片段
--   subtitle: 字幕片段 (text 的子类型，可以有间隙)
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
    clip_type TEXT NOT NULL DEFAULT 'video' CHECK (clip_type IN ('video', 'broll', 'image', 'audio', 'subtitle', 'text', 'voice', 'effect', 'filter', 'sticker', 'transition')),
    
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
    -- ★ 工作流步骤跟踪
    workflow_step TEXT DEFAULT 'upload',  -- upload, config, analyze, defiller, broll_config, completed
    entry_mode TEXT DEFAULT 'refine',     -- refine(口播精修), quick(快速剪辑)
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
CREATE INDEX idx_workspace_sessions_workflow_step ON workspace_sessions(workflow_step);

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
    
    -- 任务类型
    -- lip_sync: 口型同步
    -- face_swap: AI换脸  
    -- background_replace: 换背景
    -- text_to_video: 文生视频
    -- image_to_video: 图生视频
    -- image_generation: 文生图/图生图
    -- digital_human: 数字人口播
    task_type TEXT NOT NULL CHECK (task_type IN (
        'lip_sync', 'face_swap', 'background_replace',
        'text_to_video', 'image_to_video', 'image_generation', 'digital_human'
    )),
    
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
    
    -- 输出（第一个结果的 URL，详细结果在 ai_outputs 表）
    output_url TEXT,
    output_asset_id UUID,  -- 关联到素材库的 Asset ID
    result_metadata JSONB,  -- {total_outputs, output_ids}
    
    -- 错误信息
    error_code TEXT,
    error_message TEXT,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_tasks_user_id ON ai_tasks(user_id);
CREATE INDEX idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX idx_ai_tasks_task_type ON ai_tasks(task_type);
CREATE INDEX idx_ai_tasks_created_at ON ai_tasks(created_at DESC);
CREATE INDEX idx_ai_tasks_provider_task_id ON ai_tasks(provider_task_id);

-- ============================================================================
-- 14. AI 输出表 (ai_outputs)
-- AI 任务生成的结果，1个任务可生成多个输出（如多张图片）
-- 创建时间: 2026-01-23
-- ============================================================================
CREATE TABLE ai_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,  -- 冗余存储，方便查询
    
    -- 输出类型
    output_type TEXT NOT NULL CHECK (output_type IN ('image', 'video', 'audio')),
    
    -- 输出索引（同一任务的多个输出）
    output_index INTEGER NOT NULL DEFAULT 0,
    
    -- 原始 URL（来自 AI 服务，30天后失效）
    original_url TEXT NOT NULL,
    
    -- 持久化存储
    storage_path TEXT,  -- Supabase Storage 路径
    storage_url TEXT,   -- 公开访问 URL
    
    -- 元数据
    width INTEGER,
    height INTEGER,
    duration FLOAT,  -- 视频/音频时长（秒）
    file_size BIGINT,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_outputs_task_id ON ai_outputs(task_id);
CREATE INDEX idx_ai_outputs_user_id ON ai_outputs(user_id);
CREATE INDEX idx_ai_outputs_output_type ON ai_outputs(output_type);
CREATE INDEX idx_ai_outputs_created_at ON ai_outputs(created_at DESC);

-- ============================================================================
-- 15. 用户资料表 (user_profiles)
-- 存储用户的个人信息和偏好设置
-- 创建时间: 2026-01-25
-- ============================================================================
CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY,  -- 与 auth.users.id 关联
    
    -- 基本信息
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    
    -- 联系信息
    phone TEXT,
    company TEXT,
    website TEXT,
    
    -- 偏好设置
    preferences JSONB DEFAULT '{
        "language": "zh-CN",
        "theme": "dark",
        "notifications": {
            "email": true,
            "browser": true,
            "marketing": false
        },
        "editor": {
            "autoSave": true,
            "autoSaveInterval": 30,
            "defaultResolution": "1080p"
        }
    }'::jsonb,
    
    -- 使用统计
    total_projects_created INTEGER DEFAULT 0,
    total_exports INTEGER DEFAULT 0,
    total_ai_tasks INTEGER DEFAULT 0,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 16. 用户配额表 (user_quotas)
-- 追踪用户的试用次数、额度、存储限制等
-- 创建时间: 2026-01-25
-- ============================================================================
CREATE TABLE user_quotas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    
    -- 会员等级
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    
    -- 试用额度
    free_trials_total INTEGER DEFAULT 6,       -- 总试用次数
    free_trials_used INTEGER DEFAULT 0,        -- 已使用次数
    
    -- 月度额度 (Pro/Enterprise)
    monthly_credits INTEGER DEFAULT 0,         -- 月度配额
    credits_used_this_month INTEGER DEFAULT 0, -- 本月已用
    credits_reset_at TIMESTAMPTZ,              -- 下次重置时间
    
    -- AI 任务限制
    ai_tasks_daily_limit INTEGER DEFAULT 10,   -- 每日 AI 任务上限
    ai_tasks_used_today INTEGER DEFAULT 0,     -- 今日已用
    ai_tasks_reset_at DATE DEFAULT CURRENT_DATE, -- 下次重置日期
    
    -- 存储限制 (MB)
    storage_limit_mb INTEGER DEFAULT 500,      -- 存储上限
    storage_used_mb INTEGER DEFAULT 0,         -- 已用存储
    
    -- 项目限制
    max_projects INTEGER DEFAULT 3,            -- 最大项目数
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_quotas_user_id ON user_quotas(user_id);
CREATE INDEX idx_user_quotas_tier ON user_quotas(tier);

-- ============================================================================
-- 17. 订阅计划表 (subscription_plans)
-- 创建时间: 2026-01-25
-- 更新时间: 2026-01-25 (完整重构)
-- ============================================================================
CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 基本信息
    name TEXT NOT NULL,                    -- 'Free', 'Basic', 'Pro', 'Ultimate', 'Creator'
    slug TEXT NOT NULL UNIQUE,             -- 'free', 'basic', 'pro', 'ultimate', 'creator'
    description TEXT,                      -- 方案描述
    
    -- 定价 (美元)
    price_monthly DECIMAL(10, 2) NOT NULL DEFAULT 0,
    price_yearly DECIMAL(10, 2) NOT NULL DEFAULT 0,
    
    -- 积分配额
    credits_per_month INTEGER NOT NULL DEFAULT 0,    -- 每月发放积分
    bonus_credits INTEGER DEFAULT 0,                  -- 首次订阅奖励积分
    
    -- 功能限制
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 结构:
    -- {
    --   "concurrent_videos": 2,
    --   "concurrent_images": 2,
    --   "concurrent_characters": 1,
    --   "ai_create_free_gens": 8,
    --   "access_all_models": false,
    --   "access_all_features": false,
    --   "early_access_advanced": false,
    --   "extra_credits_discount": 0,
    --   "storage_mb": 2000,
    --   "max_projects": 10,
    --   "watermark": false,
    --   "unlimited_access": []
    -- }
    
    -- Stripe 集成 (预留)
    stripe_price_id_monthly TEXT,
    stripe_price_id_yearly TEXT,
    stripe_product_id TEXT,
    
    -- 显示控制
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_popular BOOLEAN DEFAULT false,
    badge_text TEXT,                       -- '85% OFF', 'MOST POPULAR'
    badge_color TEXT,                      -- 'pink', 'green'
    
    -- 元数据
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置订阅计划数据
INSERT INTO subscription_plans (
    slug, name, description, 
    price_monthly, price_yearly, 
    credits_per_month, bonus_credits,
    features, 
    display_order, is_active, is_popular, badge_text
) VALUES 
('free', 'Free', '免费体验基础功能', 0, 0, 100, 0,
 '{"concurrent_videos": 1, "concurrent_images": 1, "concurrent_characters": 0, "ai_create_free_gens": 3, "access_all_models": false, "access_all_features": false, "early_access_advanced": false, "extra_credits_discount": 0, "storage_mb": 500, "max_projects": 3, "watermark": true, "unlimited_access": []}'::jsonb,
 0, true, false, NULL),
('basic', 'Basic', '适合初次体验 AI 视频创作', 9, 108, 150, 0,
 '{"concurrent_videos": 2, "concurrent_images": 2, "concurrent_characters": 1, "ai_create_free_gens": 8, "access_all_models": false, "access_all_features": false, "early_access_advanced": false, "extra_credits_discount": 0, "storage_mb": 2000, "max_projects": 10, "watermark": false, "unlimited_access": []}'::jsonb,
 1, true, false, NULL),
('pro', 'Pro', '适合日常内容创作者', 29, 208.8, 600, 50,
 '{"concurrent_videos": 3, "concurrent_images": 4, "concurrent_characters": 2, "ai_create_free_gens": 13, "access_all_models": true, "access_all_features": true, "early_access_advanced": false, "extra_credits_discount": 0, "storage_mb": 10000, "max_projects": 50, "watermark": false, "unlimited_access": ["image_generation", "ai_create"]}'::jsonb,
 2, true, false, NULL),
('ultimate', 'Ultimate', '专业创作者的明智之选', 49, 294, 1200, 100,
 '{"concurrent_videos": 4, "concurrent_images": 8, "concurrent_characters": 3, "ai_create_free_gens": 35, "access_all_models": true, "access_all_features": true, "early_access_advanced": true, "extra_credits_discount": 10, "storage_mb": 50000, "max_projects": 200, "watermark": false, "unlimited_access": ["image_generation", "ai_create", "kling_all"]}'::jsonb,
 3, true, true, 'MOST POPULAR'),
('creator', 'Creator', '专家级大规模生产', 249, 448.8, 6000, 500,
 '{"concurrent_videos": 8, "concurrent_images": 8, "concurrent_characters": 6, "ai_create_free_gens": 35, "access_all_models": true, "access_all_features": true, "early_access_advanced": true, "extra_credits_discount": 15, "storage_mb": 200000, "max_projects": -1, "watermark": false, "unlimited_access": ["image_generation", "ai_create", "kling_all", "all_models"]}'::jsonb,
 4, true, false, '2 YEAR OFFER')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- 18. 用户订阅表 (user_subscriptions)
-- 创建时间: 2026-01-25
-- 更新时间: 2026-01-25 (完整重构)
-- ============================================================================
CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,  -- REFERENCES auth.users(id) ON DELETE CASCADE
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    
    -- 订阅状态
    status TEXT NOT NULL DEFAULT 'active',
    -- 可选值: 'active', 'canceled', 'past_due', 'expired', 'trialing'
    
    -- 计费周期
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',  -- 'monthly' | 'yearly'
    
    -- 时间信息
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL,
    canceled_at TIMESTAMPTZ,
    
    -- 自动续期
    auto_renew BOOLEAN DEFAULT true,
    
    -- 支付信息 (Stripe 预留)
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    payment_method TEXT,                   -- 'stripe', 'manual', 'dev_mode'
    
    -- 实际支付金额 (记录折扣后的价格)
    amount_paid DECIMAL(10, 2),
    currency TEXT DEFAULT 'USD',
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX idx_user_subscriptions_plan_id ON user_subscriptions(plan_id);
CREATE INDEX idx_user_subscriptions_period_end ON user_subscriptions(current_period_end);

-- ============================================================================
-- 18.1 订阅历史表 (subscription_history)
-- 创建时间: 2026-01-25
-- ============================================================================
CREATE TABLE subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,  -- REFERENCES auth.users(id) ON DELETE CASCADE
    subscription_id UUID REFERENCES user_subscriptions(id),
    
    -- 变更信息
    action TEXT NOT NULL,                  -- 'created', 'upgraded', 'downgraded', 'canceled', 'renewed', 'expired'
    from_plan_id UUID REFERENCES subscription_plans(id),
    to_plan_id UUID REFERENCES subscription_plans(id),
    
    -- 金额信息
    amount DECIMAL(10, 2),
    currency TEXT DEFAULT 'USD',
    
    -- 详情
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscription_history_user_id ON subscription_history(user_id);

-- ============================================================================
-- 19. AI 模型积分配置表 (ai_model_credits)
-- 创建时间: 2026-01-26
-- 更新时间: 2026-01-26 (简化为固定计费)
-- 定义每种 AI 操作消耗的积分数
-- ============================================================================
CREATE TABLE ai_model_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 模型标识
    model_key TEXT NOT NULL UNIQUE,  -- 'ai_create', 'kling_lip_sync', etc.
    model_name TEXT NOT NULL,        -- 显示名称
    provider TEXT NOT NULL,          -- 'openai', 'kling', 'internal'
    
    -- 积分消耗配置（简化为固定计费）
    credits_per_call INTEGER,        -- 固定积分/次
    
    -- 成本追踪
    estimated_cost_usd DECIMAL(10,4),-- 预估单次成本 (USD)
    cost_updated_at TIMESTAMPTZ,     -- 成本更新时间
    
    -- 状态
    is_active BOOLEAN DEFAULT true,
    category TEXT,                   -- 'transcription', 'generation', 'enhancement', 'analysis', 'editing'
    description TEXT,                -- 功能描述
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置 AI 模型积分配置（固定计费）
-- 定价规则 (2026-01-26):
-- - 基础功能 (voice-extract): 免费
-- - AI 智能剪辑 (ai-create): 100 积分/次
-- - Kling AI 功能: 按功能固定收费
INSERT INTO ai_model_credits (model_key, model_name, provider, credits_per_call, estimated_cost_usd, category, description) VALUES
-- 基础功能 (免费)
('whisper_transcribe', '语音转文字', 'openai', 0, 0.006, 'transcription', '将视频/音频中的语音转换为文字'),
('filler_detection', '填充词检测', 'internal', 0, 0.01, 'analysis', '检测"嗯"、"啊"等填充词'),
('vad', '语音活动检测', 'internal', 0, 0.005, 'analysis', '检测视频中的静音片段'),
('stem_separation', '人声分离', 'internal', 0, 0.02, 'enhancement', '分离人声和背景音乐'),
('diarization', '说话人识别', 'internal', 0, 0.015, 'analysis', '识别视频中的不同说话人'),
-- 智能功能 (免费)
('gpt4_analysis', 'AI 智能分析', 'openai', 0, 0.04, 'analysis', '使用 GPT-4 分析视频内容'),
('smart_clip', '智能剪辑', 'internal', 0, 0.08, 'editing', '一键智能剪辑视频'),
('smart_camera', '智能运镜', 'internal', 0, 0.05, 'editing', '自动添加镜头运动效果'),
('smart_clean', '智能清理', 'internal', 0, 0.06, 'editing', '自动去除静音和填充词'),
-- 图片生成 (免费)
('dalle3', 'AI 图片生成', 'openai', 0, 0.08, 'generation', 'DALL-E 3 文生图'),
('sd_generate', 'SD 图片生成', 'internal', 0, 0.04, 'generation', 'Stable Diffusion 文生图'),
-- AI 智能剪辑会话 (核心收费功能)
('ai_create', 'AI 智能剪辑', 'internal', 100, 0.50, 'editing', '一键智能剪辑 - 包含转录、智能分析、剪辑建议等全流程'),
-- Kling AI 功能 (按功能固定收费)
('kling_lip_sync', 'AI 口型同步', 'kling', 50, 0.40, 'generation', '让视频中的人物口型匹配新音频'),
('kling_face_swap', 'AI 换脸', 'kling', 60, 0.50, 'generation', '替换视频中的人脸'),
('kling_i2v', '图生视频', 'kling', 100, 0.60, 'generation', '将图片转换为动态视频'),
('kling_t2v', '文生视频', 'kling', 200, 1.20, 'generation', '根据文字描述生成视频'),
('kling_motion', '运动控制', 'kling', 80, 0.45, 'generation', '控制视频中物体的运动轨迹'),
('kling_omni_image', '全能图像', 'kling', 50, 0.30, 'generation', 'Kling 全能图像处理')
ON CONFLICT (model_key) DO NOTHING;

-- ============================================================================
-- 20. 用户积分账户表 (user_credits)
-- 创建时间: 2026-01-26
-- ============================================================================
CREATE TABLE user_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    
    -- 会员等级
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    
    -- 积分余额
    credits_balance INTEGER DEFAULT 0,          -- 当前可用积分
    credits_total_granted INTEGER DEFAULT 0,    -- 历史总获得积分
    credits_total_consumed INTEGER DEFAULT 0,   -- 历史总消耗积分
    
    -- 月度配额
    monthly_credits_limit INTEGER DEFAULT 100,  -- 每月配额上限
    monthly_credits_used INTEGER DEFAULT 0,     -- 本月已用
    monthly_reset_at TIMESTAMPTZ,               -- 下次重置时间
    
    -- 免费试用
    free_trial_credits INTEGER DEFAULT 50,      -- 免费试用积分 (一次性)
    free_trial_used BOOLEAN DEFAULT FALSE,      -- 是否已使用试用
    
    -- 充值积分 (非订阅购买)
    paid_credits INTEGER DEFAULT 0,             -- 充值积分 (永不过期)
    
    -- 存储配额 (保留)
    storage_limit_mb INTEGER DEFAULT 500,
    storage_used_mb INTEGER DEFAULT 0,
    
    -- 项目配额 (保留)
    max_projects INTEGER DEFAULT 3,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_credits_user_id ON user_credits(user_id);
CREATE INDEX idx_user_credits_tier ON user_credits(tier);

-- ============================================================================
-- 21. 积分消耗记录表 (credit_transactions)
-- 创建时间: 2026-01-26
-- ============================================================================
CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    
    -- 交易类型
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'consume',      -- 消耗 (使用 AI 功能)
        'grant',        -- 发放 (订阅续费、首次赠送)
        'refund',       -- 退款 (任务失败退回)
        'purchase',     -- 购买 (额外充值)
        'expire',       -- 过期 (月度积分清零)
        'adjust',       -- 调整 (客服手动调整)
        'hold',         -- 冻结 (任务进行中)
        'release'       -- 释放 (冻结取消)
    )),
    
    -- 积分变动
    credits_amount INTEGER NOT NULL,  -- 正数=增加，负数=减少
    credits_before INTEGER NOT NULL,  -- 变动前余额
    credits_after INTEGER NOT NULL,   -- 变动后余额
    
    -- 关联信息
    model_key TEXT,                   -- AI 模型 (consume 时)
    ai_task_id UUID,                  -- 关联的 AI 任务
    subscription_id UUID,             -- 关联的订阅 (grant 时)
    
    -- 详细信息
    description TEXT,                 -- 描述
    metadata JSONB DEFAULT '{}'::jsonb,  -- 额外信息 (时长、参数等)
    
    -- 状态 (用于冻结/释放)
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(transaction_type);
CREATE INDEX idx_credit_transactions_ai_task ON credit_transactions(ai_task_id);
CREATE INDEX idx_credit_transactions_status ON credit_transactions(status);

-- 添加 monthly_credits 到订阅计划
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS monthly_credits INTEGER DEFAULT 0;
UPDATE subscription_plans SET monthly_credits = 100 WHERE slug = 'free';
UPDATE subscription_plans SET monthly_credits = 700 WHERE slug = 'pro';
UPDATE subscription_plans SET monthly_credits = 3000 WHERE slug = 'enterprise';

-- AI 任务表添加积分字段
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS credits_consumed INTEGER DEFAULT 0;
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS credits_held INTEGER DEFAULT 0;

-- ============================================================================
-- 完成 - 21 张表
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
