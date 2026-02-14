-- ============================================================================
-- Lepus AI - 完整数据库 Schema
-- 生成日期: 2026-01-15
-- 最后更新: 2026-02-14
-- 说明: 纯表定义 + 索引 + 种子数据，无函数/触发器/视图（benchmark_segments 除外）
-- 
-- 更新记录:
--   - 2026-02-14: 归并 20260213~20260214 迁移
--     • 新增: prompt_library, enhancement_strategies, quality_references (向量库 + RPC)
--     • tasks.task_type CHECK 补充: doubao_image
--     • canvas_edges 新增: relation_type, relation_label 字段
--   - 2026-02-13: 归并 20260210~20260213 迁移 + 全量审计清理
--     • 新增: trend_templates, canvas_sessions, user_references
--     • 新增: capability_registry, capability_executions
--     • 新增: digital_avatar_templates, digital_avatar_generations
--     • 新增: canvas_nodes, canvas_edges
--     • tasks.task_type CHECK 补充: visual_separation, add_broll, add_subtitle, style_transfer
--     • tasks.task_type CHECK 移除 11 个从未使用的值 (vad/filler_detection/diarization 等)
--     • tasks 表移除 2 个死字段: celery_task_id, result_asset_id
--     • 标记废弃: project_scripts, content_analyses, content_selections (代码零引用)
--   - 2026-02-10: 归并所有迁移文件，新增 28 张表
--     • workspace_sessions 新增 metadata / ai_config JSONB 字段
--     • tasks 表统一合并 ai_tasks 所有能力类型 + AI 专属字段
--     • clips 新增 GIN 索引 (metadata jsonb_path_ops)
--     • assets.project_id 改为可空 (用户素材库)
--     • 新增: voice_clones, user_material_preferences
--     • 新增: benchmark_segments (RAG 向量, 1024 维)
--     • 新增: template_ingest_jobs, template_records, template_preview_renders
--   - 2026-01-26: 积分系统简化为固定计费 (ai_model_credits 只保留 credits_per_call)
--   - 2026-01-26: 统一命名 ai_create
--   - 2026-01-26: 添加积分系统 (ai_model_credits, user_credits, credit_transactions)
--   - 2026-01-25: 重构订阅系统 (subscription_plans 新增 credits_per_month 等字段)
--   - 2026-01-25: 添加 subscription_history 订阅历史表
--   - 2026-01-25: 订阅计划改为 Free/Basic/Pro/Ultimate/Creator 五档
--   - 2026-01-25: 添加用户配额系统 (user_profiles, user_quotas, subscription_plans)
--   - 2026-01-23: 添加 ai_tasks 表 (AI 任务状态追踪)
--   - 2026-01-23: assets 表新增 ai_task_id, ai_generated 字段
--   - 2026-01-19: 添加 exports.created_at 索引
--   - 集成所有迁移文件 (proxy_path, hls_path, order_index,
--     upload_progress, multi-asset, smart_clip_v2)
-- ============================================================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector (benchmark_segments 需要)

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
    project_id UUID,             -- ★ 可空: 用户素材库的素材可以不关联项目
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
    cloudflare_uid VARCHAR(64),                    -- Cloudflare Stream 视频 UID
    cloudflare_status VARCHAR(32) DEFAULT 'none',  -- none/uploading/processing/ready/error
    -- ★ MP4 快速启动优化
    faststart_applied BOOLEAN DEFAULT FALSE,
    -- 素材在会话中的排序索引，用于多素材上传场景
    order_index INTEGER DEFAULT 0,
    -- 上传进度信息: {bytes_uploaded, total_bytes, percentage, completed}
    upload_progress JSONB DEFAULT '{}'::jsonb,
    -- AI 生成相关
    ai_task_id UUID,                               -- 关联的 AI 任务 ID
    ai_generated BOOLEAN DEFAULT FALSE,            -- 是否为 AI 生成
    metadata JSONB DEFAULT '{}',                   -- 扩展元数据（如 transcript_segments）
    -- ★ 用户素材系统扩展
    asset_category TEXT DEFAULT 'ai_generated' CHECK (asset_category IN ('ai_generated', 'user_material', 'project_asset')),
    material_type TEXT DEFAULT 'general' CHECK (material_type IN ('avatar', 'voice_sample', 'general')),
    material_metadata JSONB DEFAULT '{}'::jsonb,
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
CREATE INDEX idx_assets_tags ON assets USING GIN(tags);

-- ============================================================================
-- 3. 统一任务表 (tasks)
-- ★ 2026-02-06 合并原 ai_tasks → tasks，统一所有任务类型
-- ============================================================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID,                -- ★ 可空 (AI 任务可能没有 project_id)
    asset_id UUID,
    clip_id UUID,                   -- 关联的 clip (换背景等场景)
    user_id UUID NOT NULL,

    -- 任务类型（统一：基础处理 + AI 能力 + 模板）
    -- ★ 2026-02-13 审计清理：移除 11 个从未使用的值
    task_type TEXT NOT NULL CHECK (task_type IN (
        -- 基础处理
        'transcribe', 'asset_processing',
        'clip_split', 'background_replace',
        -- Visual Editor 画布任务
        'visual_separation', 'add_broll', 'add_subtitle', 'style_transfer',
        -- AI 生成能力
        'lip_sync', 'face_swap', 'text_to_video', 'image_to_video',
        'image_generation', 'motion_control', 'omni_image',
        'multi_image_to_video', 'video_extend',
        -- 语音增强
        'voice_enhance',
        -- 模板操作
        'template_render',
        -- Enhance & Style 五大能力
        'skin_enhance', 'relight', 'outfit_swap', 'ai_stylist', 'outfit_shot',
        -- 数字人
        'avatar_confirm_portraits',
        -- 豆包图像生成
        'doubao_image'
    )),

    -- 状态
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'running', 'processing', 'completed', 'failed', 'cancelled'
    )),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    status_message TEXT,            -- 当前状态描述

    -- 任务参数 & 结果
    params JSONB DEFAULT '{}'::jsonb,
    result JSONB,
    error_message TEXT,
    error_code TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- AI 服务专属字段 (原 ai_tasks 字段)
    provider TEXT,                  -- AI 服务提供商 (kling, etc.)
    provider_task_id TEXT,          -- AI 服务返回的任务 ID
    input_params JSONB DEFAULT '{}'::jsonb,  -- AI 输入参数
    output_url TEXT,                -- AI 输出 URL
    output_asset_id UUID,           -- 关联到素材库的 Asset ID
    result_url TEXT,                -- 结果 URL (换背景等)

    -- 积分
    credits_consumed INTEGER DEFAULT 0,
    credits_held INTEGER DEFAULT 0,

    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_asset_id ON tasks(asset_id);
CREATE INDEX idx_tasks_clip_id ON tasks(clip_id);
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_task_type ON tasks(task_type);
CREATE INDEX idx_tasks_provider_task_id ON tasks(provider_task_id);
CREATE INDEX idx_tasks_output_asset_id ON tasks(output_asset_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);
-- ★ 复合索引：任务列表性能优化
CREATE INDEX idx_tasks_user_created ON tasks(user_id, created_at DESC);
CREATE INDEX idx_tasks_user_status_created ON tasks(user_id, status, created_at DESC);

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
CREATE INDEX idx_exports_created_at ON exports(created_at DESC);

-- ============================================================================
-- 6. 轨道表 (tracks)
-- ============================================================================
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
--   video:      主视频 (连续排列，不允许有间隙)
--   broll:      B-Roll 视频 (覆盖层，可以有间隙)
--   image:      图片 (AI 生成图片等)
--   audio:      音频
--   subtitle:   字幕 (可以有间隙)
--   text:       文案 (独立内容，可被 AI 处理切分)
--   voice:      配音 (TTS 生成或录制)
--   effect:     特效 (粒子、动画)
--   filter:     滤镜 (颜色调整、风格滤镜)
--   sticker:    贴纸
--   transition: 转场
CREATE TABLE clips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    track_id UUID NOT NULL,
    asset_id UUID,

    -- 片段类型
    clip_type TEXT NOT NULL DEFAULT 'video' CHECK (clip_type IN (
        'video', 'broll', 'image', 'audio', 'subtitle',
        'text', 'voice', 'effect', 'filter', 'sticker', 'transition'
    )),

    -- 时间信息 (毫秒)；自由节点 start_time = -1
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    source_start INTEGER DEFAULT 0,
    source_end INTEGER,

    -- 音频属性
    volume FLOAT DEFAULT 1.0 CHECK (volume >= 0 AND volume <= 2),
    is_muted BOOLEAN DEFAULT false,

    -- 视觉变换
    transform JSONB DEFAULT '{"x": 0, "y": 0, "scale": 1, "rotation": 0, "opacity": 1}'::jsonb,

    -- 转场效果
    transition_in JSONB,
    transition_out JSONB,

    -- 播放速度
    speed FLOAT DEFAULT 1.0 CHECK (speed > 0 AND speed <= 10),

    -- 分割追溯
    parent_clip_id UUID,

    -- 文本内容 (subtitle, text)
    content_text TEXT,
    text_style JSONB DEFAULT '{"fontFamily": "default", "fontSize": 24, "fontColor": "#FFFFFF", "backgroundColor": "transparent", "alignment": "center"}'::jsonb,

    -- 特效/滤镜参数
    effect_type TEXT,
    effect_params JSONB,

    -- 配音/语音参数
    voice_params JSONB,

    -- 贴纸参数
    sticker_id TEXT,

    -- 缓存
    cached_url TEXT,
    cached_url_expires_at TIMESTAMPTZ,

    -- ★ 替换视频 URL（AI 生成的替换视频地址）
    video_url TEXT,

    -- ★ 元数据（含 canvas_position、strategy 等）
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
-- ★ 递归分镜支持
CREATE INDEX idx_clips_parent_clip_id ON clips(parent_clip_id);
-- ★ GIN 索引：加速 metadata->canvas_mode / canvas_position 等查询
CREATE INDEX idx_clips_metadata_gin ON clips USING gin (metadata jsonb_path_ops);

-- ============================================================================
-- 8. 关键帧表 (keyframes)
-- ============================================================================
CREATE TABLE keyframes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clip_id UUID NOT NULL,
    property TEXT NOT NULL,
    "offset" REAL NOT NULL,
    value JSONB NOT NULL,
    easing TEXT NOT NULL DEFAULT 'linear',
    bezier_control JSONB,
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
    upload_progress JSONB DEFAULT '{}'::jsonb,
    -- ★ 画布元数据（canvas_edges 连线等）
    metadata JSONB DEFAULT '{}',
    -- ★ AI 处理配置（output_ratio / template_id / options）
    ai_config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_workspace_sessions_user_id ON workspace_sessions(user_id);
CREATE INDEX idx_workspace_sessions_project_id ON workspace_sessions(project_id);
CREATE INDEX idx_workspace_sessions_status ON workspace_sessions(status);
CREATE INDEX idx_workspace_sessions_workflow_step ON workspace_sessions(workflow_step);

-- ============================================================================
-- 10. 项目脚本表 (project_scripts) — ★ 已废弃，代码零引用
-- ============================================================================
CREATE TABLE project_scripts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    content TEXT NOT NULL,
    title TEXT,
    word_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_project_scripts_project_id ON project_scripts(project_id);
CREATE INDEX idx_project_scripts_user_id ON project_scripts(user_id);

-- ============================================================================
-- 11. 内容分析结果表 (content_analyses) — ★ 已废弃，代码零引用
-- ============================================================================
CREATE TABLE content_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('with_script', 'without_script')),
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    repeat_groups JSONB DEFAULT '[]'::jsonb,
    style_analysis JSONB,
    zoom_recommendations JSONB DEFAULT '[]'::jsonb,
    summary JSONB DEFAULT '{}'::jsonb,
    processing_stage TEXT DEFAULT 'pending' CHECK (processing_stage IN (
        'pending', 'uploading', 'transcribing', 'analyzing',
        'generating', 'completed', 'failed'
    )),
    processing_progress INTEGER DEFAULT 0 CHECK (processing_progress >= 0 AND processing_progress <= 100),
    processing_message TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'confirmed', 'failed')),
    error_message TEXT,
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
-- 12. 用户选择记录表 (content_selections) — ★ 已废弃，代码零引用
-- ============================================================================
CREATE TABLE content_selections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_id UUID NOT NULL REFERENCES content_analyses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    selections JSONB NOT NULL DEFAULT '[]'::jsonb,
    apply_zoom_recommendations BOOLEAN DEFAULT TRUE,
    generated_clips_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_selections_analysis_id ON content_selections(analysis_id);
CREATE INDEX idx_content_selections_user_id ON content_selections(user_id);

-- ============================================================================
-- 13. AI 任务表 (ai_tasks) — ★ 已废弃，保留兼容
-- ★ 新任务统一写入 tasks 表；ai_tasks 仅保留旧数据和回调兼容
-- ============================================================================
CREATE TABLE ai_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    task_type TEXT NOT NULL CHECK (task_type IN (
        'lip_sync', 'face_swap', 'background_replace',
        'text_to_video', 'image_to_video', 'image_generation', 'digital_human',
        'video_extend', 'multi_image_to_video', 'motion_control',
        'omni_image', 'voice_enhance',
        'clip_split',
        'template_ingest', 'template_render',
        -- Enhance & Style
        'skin_enhance', 'relight', 'outfit_swap', 'ai_stylist', 'outfit_shot'
    )),
    input_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider TEXT NOT NULL DEFAULT 'kling',
    provider_task_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'completed', 'failed', 'cancelled'
    )),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    status_message TEXT,
    output_url TEXT,
    output_asset_id UUID,
    result_metadata JSONB,
    error_code TEXT,
    error_message TEXT,
    -- ★ 积分字段
    credits_consumed INTEGER DEFAULT 0,
    credits_held INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_tasks_user_id ON ai_tasks(user_id);
CREATE INDEX idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX idx_ai_tasks_task_type ON ai_tasks(task_type);
CREATE INDEX idx_ai_tasks_created_at ON ai_tasks(created_at DESC);
CREATE INDEX idx_ai_tasks_provider_task_id ON ai_tasks(provider_task_id);
CREATE INDEX idx_ai_tasks_output_asset_id ON ai_tasks(output_asset_id);

-- ============================================================================
-- 14. AI 输出表 (ai_outputs) — ★ 仅回调写入，前端无读取
-- ============================================================================
CREATE TABLE ai_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    output_type TEXT NOT NULL CHECK (output_type IN ('image', 'video', 'audio')),
    output_index INTEGER NOT NULL DEFAULT 0,
    original_url TEXT NOT NULL,
    storage_path TEXT,
    storage_url TEXT,
    width INTEGER,
    height INTEGER,
    duration FLOAT,
    file_size BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_outputs_task_id ON ai_outputs(task_id);
CREATE INDEX idx_ai_outputs_user_id ON ai_outputs(user_id);
CREATE INDEX idx_ai_outputs_output_type ON ai_outputs(output_type);
CREATE INDEX idx_ai_outputs_created_at ON ai_outputs(created_at DESC);

-- ============================================================================
-- 15. 用户资料表 (user_profiles)
-- ============================================================================
CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    phone TEXT,
    company TEXT,
    website TEXT,
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
    total_projects_created INTEGER DEFAULT 0,
    total_exports INTEGER DEFAULT 0,
    total_ai_tasks INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 16. 用户配额表 (user_quotas)
-- ============================================================================
CREATE TABLE user_quotas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    free_trials_total INTEGER DEFAULT 6,
    free_trials_used INTEGER DEFAULT 0,
    monthly_credits INTEGER DEFAULT 0,
    credits_used_this_month INTEGER DEFAULT 0,
    credits_reset_at TIMESTAMPTZ,
    ai_tasks_daily_limit INTEGER DEFAULT 10,
    ai_tasks_used_today INTEGER DEFAULT 0,
    ai_tasks_reset_at DATE DEFAULT CURRENT_DATE,
    storage_limit_mb INTEGER DEFAULT 500,
    storage_used_mb INTEGER DEFAULT 0,
    max_projects INTEGER DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_quotas_user_id ON user_quotas(user_id);
CREATE INDEX idx_user_quotas_tier ON user_quotas(tier);

-- ============================================================================
-- 17. 订阅计划表 (subscription_plans)
-- ============================================================================
CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    price_monthly DECIMAL(10, 2) NOT NULL DEFAULT 0,
    price_yearly DECIMAL(10, 2) NOT NULL DEFAULT 0,
    credits_per_month INTEGER NOT NULL DEFAULT 0,
    bonus_credits INTEGER DEFAULT 0,
    monthly_credits INTEGER DEFAULT 0,
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    stripe_price_id_monthly TEXT,
    stripe_price_id_yearly TEXT,
    stripe_product_id TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_popular BOOLEAN DEFAULT false,
    badge_text TEXT,
    badge_color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置订阅计划数据
INSERT INTO subscription_plans (
    slug, name, description,
    price_monthly, price_yearly,
    credits_per_month, bonus_credits, monthly_credits,
    features,
    display_order, is_active, is_popular, badge_text
) VALUES
('free', 'Free', '免费体验基础功能', 0, 0, 100, 0, 100,
 '{"concurrent_videos": 1, "concurrent_images": 1, "concurrent_characters": 0, "ai_create_free_gens": 3, "access_all_models": false, "access_all_features": false, "early_access_advanced": false, "extra_credits_discount": 0, "storage_mb": 500, "max_projects": 3, "watermark": true, "unlimited_access": []}'::jsonb,
 0, true, false, NULL),
('basic', 'Basic', '适合初次体验 AI 视频创作', 9, 108, 150, 0, 150,
 '{"concurrent_videos": 2, "concurrent_images": 2, "concurrent_characters": 1, "ai_create_free_gens": 8, "access_all_models": false, "access_all_features": false, "early_access_advanced": false, "extra_credits_discount": 0, "storage_mb": 2000, "max_projects": 10, "watermark": false, "unlimited_access": []}'::jsonb,
 1, true, false, NULL),
('pro', 'Pro', '适合日常内容创作者', 29, 208.8, 600, 50, 700,
 '{"concurrent_videos": 3, "concurrent_images": 4, "concurrent_characters": 2, "ai_create_free_gens": 13, "access_all_models": true, "access_all_features": true, "early_access_advanced": false, "extra_credits_discount": 0, "storage_mb": 10000, "max_projects": 50, "watermark": false, "unlimited_access": ["image_generation", "ai_create"]}'::jsonb,
 2, true, false, NULL),
('ultimate', 'Ultimate', '专业创作者的明智之选', 49, 294, 1200, 100, 1200,
 '{"concurrent_videos": 4, "concurrent_images": 8, "concurrent_characters": 3, "ai_create_free_gens": 35, "access_all_models": true, "access_all_features": true, "early_access_advanced": true, "extra_credits_discount": 10, "storage_mb": 50000, "max_projects": 200, "watermark": false, "unlimited_access": ["image_generation", "ai_create", "kling_all"]}'::jsonb,
 3, true, true, 'MOST POPULAR'),
('creator', 'Creator', '专家级大规模生产', 249, 448.8, 6000, 500, 6000,
 '{"concurrent_videos": 8, "concurrent_images": 8, "concurrent_characters": 6, "ai_create_free_gens": 35, "access_all_models": true, "access_all_features": true, "early_access_advanced": true, "extra_credits_discount": 15, "storage_mb": 200000, "max_projects": -1, "watermark": false, "unlimited_access": ["image_generation", "ai_create", "kling_all", "all_models"]}'::jsonb,
 4, true, false, '2 YEAR OFFER')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- 18. 用户订阅表 (user_subscriptions)
-- ============================================================================
CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status TEXT NOT NULL DEFAULT 'active',
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL,
    canceled_at TIMESTAMPTZ,
    auto_renew BOOLEAN DEFAULT true,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    payment_method TEXT,
    amount_paid DECIMAL(10, 2),
    currency TEXT DEFAULT 'USD',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_active_subscription UNIQUE (user_id, status)
);

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX idx_user_subscriptions_plan_id ON user_subscriptions(plan_id);
CREATE INDEX idx_user_subscriptions_period_end ON user_subscriptions(current_period_end);

-- ============================================================================
-- 18.1 订阅历史表 (subscription_history)
-- ============================================================================
CREATE TABLE subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    subscription_id UUID REFERENCES user_subscriptions(id),
    action TEXT NOT NULL,
    from_plan_id UUID REFERENCES subscription_plans(id),
    to_plan_id UUID REFERENCES subscription_plans(id),
    amount DECIMAL(10, 2),
    currency TEXT DEFAULT 'USD',
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscription_history_user_id ON subscription_history(user_id);

-- ============================================================================
-- 19. AI 模型积分配置表 (ai_model_credits)
-- 固定计费模型：credits_per_call
-- ============================================================================
CREATE TABLE ai_model_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_key TEXT NOT NULL UNIQUE,
    model_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    credits_per_call INTEGER,
    estimated_cost_usd DECIMAL(10,4),
    cost_updated_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    category TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
-- AI 智能剪辑会话 (核心收费)
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
-- ============================================================================
CREATE TABLE user_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    credits_balance INTEGER DEFAULT 0,
    credits_total_granted INTEGER DEFAULT 0,
    credits_total_consumed INTEGER DEFAULT 0,
    monthly_credits_limit INTEGER DEFAULT 100,
    monthly_credits_used INTEGER DEFAULT 0,
    monthly_reset_at TIMESTAMPTZ,
    free_trial_credits INTEGER DEFAULT 50,
    free_trial_used BOOLEAN DEFAULT FALSE,
    paid_credits INTEGER DEFAULT 0,
    storage_limit_mb INTEGER DEFAULT 500,
    storage_used_mb INTEGER DEFAULT 0,
    max_projects INTEGER DEFAULT 3,
    -- ★ 订阅关联字段
    subscription_id UUID,
    subscription_credits_remaining INTEGER DEFAULT 0,
    next_credits_refresh_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_credits_user_id ON user_credits(user_id);
CREATE INDEX idx_user_credits_tier ON user_credits(tier);

-- ============================================================================
-- 21. 积分消耗记录表 (credit_transactions)
-- ============================================================================
CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN (
        'consume', 'grant', 'refund', 'purchase', 'expire', 'adjust', 'hold', 'release'
    )),
    credits_amount INTEGER NOT NULL,
    credits_before INTEGER NOT NULL,
    credits_after INTEGER NOT NULL,
    model_key TEXT,
    ai_task_id UUID,
    subscription_id UUID,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(transaction_type);
CREATE INDEX idx_credit_transactions_ai_task ON credit_transactions(ai_task_id);
CREATE INDEX idx_credit_transactions_status ON credit_transactions(status);

-- ============================================================================
-- 22. 声音克隆记录表 (voice_clones)
-- 创建时间: 2026-01-30
-- ============================================================================
CREATE TABLE voice_clones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    source_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    fish_audio_reference_id TEXT NOT NULL,
    language TEXT DEFAULT 'zh',
    gender TEXT CHECK (gender IN ('male', 'female', 'neutral')),
    preview_audio_url TEXT,
    usage_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'processing', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_voice_clones_user_id ON voice_clones(user_id);
CREATE INDEX idx_voice_clones_source_asset ON voice_clones(source_asset_id);
CREATE INDEX idx_voice_clones_status ON voice_clones(status);

-- ============================================================================
-- 23. 用户素材偏好设置表 (user_material_preferences)
-- 创建时间: 2026-01-30
-- ============================================================================
CREATE TABLE user_material_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    default_avatar_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    default_voice_type TEXT DEFAULT 'preset' CHECK (default_voice_type IN ('preset', 'cloned')),
    default_voice_id TEXT,
    default_broadcast_settings JSONB DEFAULT '{
        "aspect_ratio": "16:9",
        "model": "kling-v2-master",
        "lip_sync_mode": "audio2video"
    }'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_material_prefs_user ON user_material_preferences(user_id);

-- ============================================================================
-- 24. RAG 向量库表 (benchmark_segments)
-- 多模态 Embedding: doubao-embedding-vision-250615, 维度 1024
-- 创建时间: 2026-01-31
-- ============================================================================
CREATE TABLE benchmark_segments (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    segment_idx INTEGER NOT NULL,
    segment_text TEXT NOT NULL,
    transform_rules JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1024),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX benchmark_segments_embedding_idx
  ON benchmark_segments USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX benchmark_segments_template_idx ON benchmark_segments(template_id);

-- RPC 函数：相似度搜索
CREATE OR REPLACE FUNCTION match_benchmark_segments(
    query_embedding vector(1024),
    match_count integer DEFAULT 5,
    match_threshold float DEFAULT 0.3
)
RETURNS TABLE (
    id text,
    template_id text,
    segment_idx integer,
    segment_text text,
    transform_rules jsonb,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        bs.id,
        bs.template_id,
        bs.segment_idx,
        bs.segment_text,
        bs.transform_rules,
        bs.metadata,
        (1 - (bs.embedding <=> query_embedding))::float as similarity
    FROM benchmark_segments bs
    WHERE bs.embedding IS NOT NULL
    AND (1 - (bs.embedding <=> query_embedding)) > match_threshold
    ORDER BY bs.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

GRANT ALL ON benchmark_segments TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION match_benchmark_segments(vector(1024), integer, float)
  TO postgres, anon, authenticated, service_role;

-- ============================================================================
-- 25. 模板采集任务表 (template_ingest_jobs)
-- 创建时间: 2026-02-07
-- ============================================================================
CREATE TABLE template_ingest_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
    progress FLOAT DEFAULT 0,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'video'
        CHECK (source_type IN ('video', 'image', 'zip')),
    template_type TEXT NOT NULL
        CHECK (template_type IN ('ad', 'transition')),
    extract_frames INTEGER DEFAULT 8,
    clip_ranges JSONB DEFAULT '[]'::jsonb,
    tags_hint JSONB DEFAULT '[]'::jsonb,
    params JSONB DEFAULT '{}'::jsonb,
    result JSONB DEFAULT '{}'::jsonb,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_ingest_jobs_status ON template_ingest_jobs(status);
CREATE INDEX idx_template_ingest_jobs_created_at ON template_ingest_jobs(created_at DESC);
CREATE INDEX idx_template_ingest_jobs_template_type ON template_ingest_jobs(template_type);

-- ============================================================================
-- 26. 模板记录表 (template_records)
-- 创建时间: 2026-02-07
-- 更新时间: 2026-02-08 (添加发布系统字段)
-- ============================================================================
CREATE TABLE template_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'background'
        CHECK (type IN ('background', 'motion', 'transition')),
    category TEXT NOT NULL DEFAULT 'ad',
    tags JSONB DEFAULT '[]'::jsonb,

    -- 模板资产 (Supabase Storage)
    bucket TEXT NOT NULL DEFAULT 'templates',
    storage_path TEXT NOT NULL,
    thumbnail_path TEXT,
    url TEXT,
    thumbnail_url TEXT,

    -- Workflow 配置 (Agent 用)
    workflow JSONB DEFAULT '{}'::jsonb,

    -- 来源信息
    source_origin TEXT,
    source_url TEXT,
    source_timecode TEXT,

    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,

    -- ★ 发布系统字段
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
    published_at TIMESTAMPTZ,
    publish_config JSONB DEFAULT '{}'::jsonb,
    preview_video_url TEXT,
    quality_label TEXT
        CHECK (quality_label IS NULL OR quality_label IN ('golden', 'good', 'average', 'poor')),
    admin_notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_records_template_id ON template_records(template_id);
CREATE INDEX idx_template_records_category ON template_records(category);
CREATE INDEX idx_template_records_type ON template_records(type);
CREATE INDEX idx_template_records_created_at ON template_records(created_at DESC);
CREATE INDEX idx_template_records_tags ON template_records USING GIN (tags);
CREATE INDEX idx_template_records_workflow ON template_records USING GIN (workflow);
CREATE INDEX idx_template_records_status ON template_records(status);
CREATE INDEX idx_template_records_quality_label ON template_records(quality_label);
CREATE INDEX idx_template_records_published_at ON template_records(published_at DESC);

-- ============================================================================
-- 27. 模板试渲染预览表 (template_preview_renders)
-- 创建时间: 2026-02-08
-- ============================================================================
CREATE TABLE template_preview_renders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    video_url TEXT,
    thumbnail_url TEXT,
    render_params JSONB DEFAULT '{}'::jsonb,
    is_featured BOOLEAN DEFAULT FALSE,
    admin_rating INTEGER CHECK (admin_rating IS NULL OR admin_rating BETWEEN 1 AND 5),
    admin_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_preview_renders_template_id ON template_preview_renders(template_id);
CREATE INDEX idx_template_preview_renders_status ON template_preview_renders(status);

-- ============================================================================
-- 28. 热门模板表 (trend_templates)
-- 创建时间: 2026-02-11 (PRD v1.1 Phase 0)
-- 更新时间: 2026-02-12 (列重命名 + 新增列)
-- ============================================================================
CREATE TABLE trend_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ★ 基本信息 (2026-02-12 重命名: title→name, cover_url→thumbnail_url)
    name TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    before_url TEXT,
    after_url TEXT,
    -- ★ 分类 (2026-02-12 更新: 移除 background/enhance/composite, 添加 scene/mixed)
    category TEXT NOT NULL CHECK (category IN (
        'hair', 'outfit', 'scene', 'lighting',
        'style', 'action', 'mixed'
    )),
    capability_tags TEXT[] NOT NULL DEFAULT '{}',  -- 旧字段，保留向后兼容
    trending_score INT NOT NULL DEFAULT 0 CHECK (trending_score BETWEEN 0 AND 5),
    -- ★ 2026-02-12 重命名: use_count→usage_count, pipeline_preset→golden_preset
    usage_count INT NOT NULL DEFAULT 0,
    requires_face BOOLEAN NOT NULL DEFAULT false,
    golden_preset JSONB,            -- GoldenPreset (原 pipeline_preset)
    -- ★ 2026-02-12 新增列
    route JSONB NOT NULL DEFAULT '[]',       -- 能力链路 [{capability, params, prompt_template}]
    preview_video_url TEXT,
    output_duration REAL NOT NULL DEFAULT 0,
    output_aspect_ratio TEXT NOT NULL DEFAULT '1:1',
    author_type TEXT NOT NULL DEFAULT 'official'
        CHECK (author_type IN ('official', 'community', 'ai')),
    tags TEXT[] NOT NULL DEFAULT '{}',
    -- 状态 & 归属
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trend_templates_category ON trend_templates(category, trending_score DESC);
CREATE INDEX idx_trend_templates_name ON trend_templates(name);
CREATE INDEX idx_trend_templates_tags ON trend_templates USING gin(tags);

-- ============================================================================
-- 29. 画布会话表 (canvas_sessions)
-- 创建时间: 2026-02-11 (PRD v1.1 Phase 0)
-- 更新时间: 2026-02-12 (新增 route_result/subject_url/reference_url/text_input)
-- ============================================================================
CREATE TABLE canvas_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    template_id UUID REFERENCES trend_templates(id),
    state JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'done', 'archived')),
    title TEXT,
    thumbnail_url TEXT,
    -- ★ 2026-02-12 新增
    route_result JSONB,
    subject_url TEXT,
    reference_url TEXT,
    text_input TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canvas_sessions_user ON canvas_sessions(user_id, updated_at DESC);

-- ============================================================================
-- 30. 用户参考图表 (user_references)
-- 创建时间: 2026-02-11 (PRD v1.1 Phase 0)
-- ============================================================================
CREATE TABLE user_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    session_id UUID REFERENCES canvas_sessions(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'subject' CHECK (role IN ('subject', 'reference', 'background')),
    storage_path TEXT NOT NULL,
    url TEXT NOT NULL,
    filename TEXT,
    file_size BIGINT,
    mime_type TEXT,
    has_face BOOLEAN,
    width INT,
    height INT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_references_session ON user_references(session_id);
CREATE INDEX idx_user_references_user ON user_references(user_id, created_at DESC);

-- ============================================================================
-- 31. AI 能力注册表 (capability_registry)
-- 创建时间: 2026-02-11 (PRD v1.1 Phase 0)
-- ============================================================================
CREATE TABLE capability_registry (
    type TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    param_schema JSONB NOT NULL DEFAULT '{}',
    requires_face BOOLEAN NOT NULL DEFAULT false,
    estimated_time INT NOT NULL DEFAULT 30,
    credit_cost INT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO capability_registry (type, name, description, requires_face, estimated_time, credit_cost, sort_order) VALUES
    ('hair_color',      '发色变换',   '改变头发颜色和发型',          true,  20, 1, 1),
    ('outfit',          '穿搭换装',   '替换服装和配饰',             false, 25, 2, 2),
    ('background',      '背景替换',   '替换照片背景场景',           false, 15, 1, 3),
    ('lighting',        '光影调整',   '改变照片光影和氛围',         false, 10, 1, 4),
    ('style_transfer',  '风格迁移',   '将照片转换为特定艺术风格',    false, 20, 2, 5),
    ('action_transfer', '动作迁移',   '将参考动作应用到主体',       true,  30, 3, 6),
    ('angle',           '角度调整',   '改变拍摄角度和视角',         false, 15, 1, 7),
    ('enhance',         '画质增强',   '提升图片分辨率和清晰度',     false, 20, 1, 8),
    ('image_to_video',  '图生视频',   '将静态图片转换为动态视频',    false, 45, 5, 9)
ON CONFLICT (type) DO NOTHING;

-- ============================================================================
-- 32. 能力执行记录表 (capability_executions)
-- 创建时间: 2026-02-11 (PRD v1.1 Phase 0)
-- 更新时间: 2026-02-12 (新增 chain_id/chain_order)
-- ============================================================================
CREATE TABLE capability_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES canvas_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    capability_type TEXT NOT NULL REFERENCES capability_registry(type),
    input_urls TEXT[] NOT NULL DEFAULT '{}',
    params JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'error')),
    result_url TEXT,
    error TEXT,
    credits_used INT NOT NULL DEFAULT 0,
    duration_ms INT,
    -- ★ 2026-02-12 新增: 链路执行
    chain_id UUID,
    chain_order INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_capability_executions_session ON capability_executions(session_id);
CREATE INDEX idx_capability_executions_user ON capability_executions(user_id, created_at DESC);
CREATE INDEX idx_capability_executions_chain ON capability_executions(chain_id);

-- ============================================================================
-- 33. 数字人形象模板表 (digital_avatar_templates)
-- 创建时间: 2026-02-12
-- ============================================================================
CREATE TABLE digital_avatar_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 基本信息
    name TEXT NOT NULL,
    description TEXT,
    -- 形象资产
    portrait_url TEXT NOT NULL,
    portrait_prompt TEXT,
    reference_images TEXT[] NOT NULL DEFAULT '{}',   -- 多角度参考图
    thumbnail_url TEXT,
    demo_video_url TEXT,
    -- 音色配置
    default_voice_id TEXT DEFAULT 'zh_female_gentle',
    default_voice_name TEXT,
    voice_sample_url TEXT,
    -- 形象特征标签
    gender TEXT CHECK (gender IN ('male', 'female', 'neutral')),
    age_range TEXT CHECK (age_range IN ('youth', 'young_adult', 'middle_aged', 'senior')),
    ethnicity TEXT,
    style TEXT CHECK (style IN ('professional', 'casual', 'creative', 'elegant', 'energetic', 'warm')),
    tags TEXT[] NOT NULL DEFAULT '{}',
    -- 生成配置
    generation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 运营数据
    usage_count INT NOT NULL DEFAULT 0,
    trending_score INT NOT NULL DEFAULT 0 CHECK (trending_score BETWEEN 0 AND 5),
    is_featured BOOLEAN NOT NULL DEFAULT false,
    -- 状态 & 归属
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by UUID,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_digital_avatar_status ON digital_avatar_templates(status, trending_score DESC);
CREATE INDEX idx_digital_avatar_style ON digital_avatar_templates(gender, style, status);
CREATE INDEX idx_digital_avatar_search ON digital_avatar_templates USING gin(
    to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))
);

-- ============================================================================
-- 34. 数字人生成任务表 (digital_avatar_generations)
-- 创建时间: 2026-02-12
-- ============================================================================
CREATE TABLE digital_avatar_generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    avatar_id UUID NOT NULL REFERENCES digital_avatar_templates(id),
    -- 输入
    input_type TEXT NOT NULL CHECK (input_type IN ('script', 'audio', 'voice_clone')),
    script TEXT,
    audio_url TEXT,
    voice_id TEXT,
    -- 链路中的任务 ID
    broadcast_task_id TEXT,
    face_swap_task_id TEXT,
    -- 最终输出
    output_video_url TEXT,
    -- 状态
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'broadcasting', 'swapping', 'completed', 'failed'
    )),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_avatar_gen_user ON digital_avatar_generations(user_id, created_at DESC);
CREATE INDEX idx_avatar_gen_avatar ON digital_avatar_generations(avatar_id);

-- ============================================================================
-- 35. 画布节点表 (canvas_nodes)
-- 创建时间: 2026-02-13
-- 说明: 从 clips 表分离，专门服务于 Visual Editor 画布编辑器
-- ============================================================================
CREATE TABLE canvas_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    -- 节点类型: sequence(序列节点) / free(自由节点)
    node_type TEXT NOT NULL DEFAULT 'sequence',
    -- 媒体类型: video / image
    media_type TEXT NOT NULL DEFAULT 'video',
    -- 序列节点排序
    order_index INTEGER DEFAULT 0,
    -- 时间信息（秒）
    start_time FLOAT DEFAULT 0,
    end_time FLOAT DEFAULT 0,
    duration FLOAT DEFAULT 0,
    -- 素材裁剪偏移（毫秒）
    source_start INTEGER DEFAULT 0,
    source_end INTEGER DEFAULT 0,
    -- 画布位置
    canvas_position JSONB DEFAULT '{"x": 0, "y": 0}',
    -- AI 相关
    video_url TEXT,
    thumbnail_url TEXT,
    -- 扩展元数据
    metadata JSONB DEFAULT '{}',
    -- 对应的 timeline clip ID（双写同步用）
    clip_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_canvas_nodes_project_id ON canvas_nodes(project_id);
CREATE INDEX idx_canvas_nodes_asset_id ON canvas_nodes(asset_id);
CREATE INDEX idx_canvas_nodes_clip_id ON canvas_nodes(clip_id);
CREATE INDEX idx_canvas_nodes_project_type ON canvas_nodes(project_id, node_type);

-- ============================================================================
-- 36. 画布连线表 (canvas_edges)
-- 创建时间: 2026-02-13
-- ============================================================================
CREATE TABLE canvas_edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_node_id UUID NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
    source_handle TEXT,
    target_handle TEXT,
    relation_type TEXT DEFAULT NULL,   -- split / ai-generated / bg-replace / extract-frame / separation / reference / composite / duplicate / transition / style-transfer / custom
    relation_label TEXT DEFAULT NULL,  -- 自定义标签，覆盖 relation_type 的默认显示名
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_canvas_edges_project_id ON canvas_edges(project_id);
CREATE INDEX idx_canvas_edges_relation_type ON canvas_edges(relation_type) WHERE relation_type IS NOT NULL;

-- ============================================================================
-- 37. Prompt Library 向量库 (prompt_library)
-- 创建时间: 2026-02-14
-- 三维分类：capability × platform × input_type + 语义向量检索
-- ============================================================================
CREATE TABLE IF NOT EXISTS prompt_library (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capability      TEXT NOT NULL,
    platform        TEXT NOT NULL DEFAULT 'universal',
    input_type      TEXT NOT NULL DEFAULT 'universal',
    prompt          TEXT NOT NULL,
    negative_prompt TEXT DEFAULT '',
    label           TEXT DEFAULT '',
    source          TEXT DEFAULT 'scraped',
    quality_score   REAL DEFAULT 0.8,
    metadata        JSONB DEFAULT '{}',
    embedding       vector(1024),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_library_capability ON prompt_library(capability);
CREATE INDEX IF NOT EXISTS idx_prompt_library_platform ON prompt_library(platform);
CREATE INDEX IF NOT EXISTS idx_prompt_library_input_type ON prompt_library(input_type);
CREATE INDEX IF NOT EXISTS idx_prompt_library_source ON prompt_library(source);
CREATE INDEX IF NOT EXISTS idx_prompt_library_cap_plat_input ON prompt_library(capability, platform, input_type);
CREATE INDEX IF NOT EXISTS idx_prompt_library_embedding ON prompt_library USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);

ALTER TABLE prompt_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prompt_library_read" ON prompt_library FOR SELECT TO authenticated USING (true);
CREATE POLICY "prompt_library_service" ON prompt_library FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION match_prompt_library(
    query_embedding      vector(1024),
    match_count          INT DEFAULT 5,
    match_threshold      FLOAT DEFAULT 0.3,
    filter_capability    TEXT DEFAULT NULL,
    filter_platform      TEXT DEFAULT NULL,
    filter_input_type    TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID, capability TEXT, platform TEXT, input_type TEXT,
    prompt TEXT, negative_prompt TEXT, label TEXT, source TEXT,
    quality_score REAL, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT pl.id, pl.capability, pl.platform, pl.input_type,
           pl.prompt, pl.negative_prompt, pl.label, pl.source,
           pl.quality_score, 1 - (pl.embedding <=> query_embedding) AS similarity
    FROM prompt_library pl
    WHERE pl.embedding IS NOT NULL
      AND 1 - (pl.embedding <=> query_embedding) > match_threshold
      AND (filter_capability IS NULL OR pl.capability = filter_capability)
      AND (filter_platform IS NULL OR pl.platform = filter_platform)
      AND (filter_input_type IS NULL OR pl.input_type = filter_input_type)
    ORDER BY pl.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- 38. 增强策略库 (enhancement_strategies)
-- 创建时间: 2026-02-14
-- 内容类型 → 管线配置 + 语义向量检索
-- ============================================================================
CREATE TABLE IF NOT EXISTS enhancement_strategies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_category TEXT NOT NULL,
    quality_target   TEXT NOT NULL,
    description      TEXT NOT NULL,
    pipeline_config  JSONB NOT NULL,
    metadata         JSONB DEFAULT '{}',
    embedding        vector(1024),
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enhancement_strategies_category ON enhancement_strategies(content_category);
CREATE INDEX IF NOT EXISTS idx_enhancement_strategies_target ON enhancement_strategies(quality_target);
CREATE INDEX IF NOT EXISTS idx_enhancement_strategies_embedding ON enhancement_strategies USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

ALTER TABLE enhancement_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enhancement_strategies_read" ON enhancement_strategies FOR SELECT TO authenticated USING (true);
CREATE POLICY "enhancement_strategies_service" ON enhancement_strategies FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION match_enhancement_strategies(
    query_embedding    vector(1024),
    match_count        INT DEFAULT 3,
    match_threshold    FLOAT DEFAULT 0.5,
    filter_category    TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID, content_category TEXT, quality_target TEXT,
    description TEXT, pipeline_config JSONB, metadata JSONB, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT es.id, es.content_category, es.quality_target,
           es.description, es.pipeline_config, es.metadata,
           1 - (es.embedding <=> query_embedding) AS similarity
    FROM enhancement_strategies es
    WHERE es.embedding IS NOT NULL
      AND 1 - (es.embedding <=> query_embedding) > match_threshold
      AND (filter_category IS NULL OR es.content_category = filter_category)
    ORDER BY es.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- 39. 质量参考图库 (quality_references)
-- 创建时间: 2026-02-14
-- 高质量标杆图片 + 语义向量检索
-- ============================================================================
CREATE TABLE IF NOT EXISTS quality_references (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category         TEXT NOT NULL,
    style            TEXT NOT NULL,
    image_url        TEXT NOT NULL,
    description      TEXT NOT NULL,
    quality_score    REAL DEFAULT 1.0,
    source           TEXT DEFAULT 'manual',
    metadata         JSONB DEFAULT '{}',
    embedding        vector(1024),
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_references_category ON quality_references(category);
CREATE INDEX IF NOT EXISTS idx_quality_references_style ON quality_references(style);
CREATE INDEX IF NOT EXISTS idx_quality_references_source ON quality_references(source);
CREATE INDEX IF NOT EXISTS idx_quality_references_embedding ON quality_references USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

ALTER TABLE quality_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quality_references_read" ON quality_references FOR SELECT TO authenticated USING (true);
CREATE POLICY "quality_references_service" ON quality_references FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION match_quality_references(
    query_embedding    vector(1024),
    match_count        INT DEFAULT 3,
    match_threshold    FLOAT DEFAULT 0.5,
    filter_category    TEXT DEFAULT NULL,
    filter_style       TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID, category TEXT, style TEXT, image_url TEXT,
    description TEXT, quality_score REAL, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT qr.id, qr.category, qr.style, qr.image_url,
           qr.description, qr.quality_score,
           1 - (qr.embedding <=> query_embedding) AS similarity
    FROM quality_references qr
    WHERE qr.embedding IS NOT NULL
      AND 1 - (qr.embedding <=> query_embedding) > match_threshold
      AND (filter_category IS NULL OR qr.category = filter_category)
      AND (filter_style IS NULL OR qr.style = filter_style)
    ORDER BY qr.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================================
-- 完成 — 共 39 张表
-- ============================================================================
-- 1.  projects
-- 2.  assets
-- 3.  tasks              (统一任务表，合并原 ai_tasks)
-- 4.  snapshots
-- 5.  exports
-- 6.  tracks
-- 7.  clips
-- 8.  keyframes
-- 9.  workspace_sessions
-- 10. project_scripts     (★ 已废弃，代码零引用)
-- 11. content_analyses    (★ 已废弃，代码零引用)
-- 12. content_selections  (★ 已废弃，代码零引用)
-- 13. ai_tasks            (★ 已废弃，保留兼容)
-- 14. ai_outputs          (★ 仅回调写入)
-- 15. user_profiles
-- 16. user_quotas
-- 17. subscription_plans
-- 18. user_subscriptions
-- 18.1 subscription_history
-- 19. ai_model_credits
-- 20. user_credits
-- 21. credit_transactions
-- 22. voice_clones
-- 23. user_material_preferences
-- 24. benchmark_segments   (含 RPC 函数 match_benchmark_segments)
-- 25. template_ingest_jobs
-- 26. template_records
-- 27. template_preview_renders
-- 28. trend_templates      (热门模板 / Discover Feed)
-- 29. canvas_sessions      (画布会话)
-- 30. user_references      (用户参考图)
-- 31. capability_registry  (AI 能力注册表)
-- 32. capability_executions (能力执行记录)
-- 33. digital_avatar_templates  (数字人形象模板)
-- 34. digital_avatar_generations (数字人生成任务)
-- 35. canvas_nodes         (Visual Editor 画布节点)
-- 36. canvas_edges         (Visual Editor 画布连线)
-- 37. prompt_library       (Prompt 向量库 + RPC)
-- 38. enhancement_strategies (增强策略库 + RPC)
-- 39. quality_references   (质量参考图库 + RPC)
-- ============================================================================
