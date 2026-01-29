-- ============================================================================
-- 用户素材系统扩展迁移
-- 添加素材分类和类型字段，支持数字人形象和声音样本
-- ============================================================================

-- 1. 添加 asset_category 字段 - 区分素材来源
-- ai_generated: Rabbit Hole 等 AI 功能生成的素材
-- user_material: 用户上传的个人素材（数字人、声音样本等）
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS asset_category TEXT 
DEFAULT 'ai_generated' 
CHECK (asset_category IN ('ai_generated', 'user_material'));

-- 2. 添加 material_type 字段 - 细分用户素材类型
-- avatar: 数字人形象（图片/视频）
-- voice_sample: 声音样本（音频）
-- general: 普通素材
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS material_type TEXT 
DEFAULT 'general'
CHECK (material_type IN ('avatar', 'voice_sample', 'general'));

-- 3. 添加 material_metadata 字段 - 存储素材特定元数据
-- 对于 avatar: { "style": "realistic", "gender": "female", ... }
-- 对于 voice_sample: { "language": "zh", "duration": 30, "cloned": false, "model_id": "..." }
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS material_metadata JSONB DEFAULT '{}'::jsonb;

-- 4. 添加 display_name 字段 - 用户自定义的显示名称
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- 5. 添加 is_favorite 字段 - 收藏标记
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;

-- 6. 添加 tags 字段 - 标签数组
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- 7. 添加 usage_count 字段 - 使用次数统计
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;

-- 8. 添加 last_used_at 字段 - 最后使用时间
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- 9. 创建索引优化查询
CREATE INDEX IF NOT EXISTS idx_assets_asset_category ON assets(asset_category);
CREATE INDEX IF NOT EXISTS idx_assets_material_type ON assets(material_type);
CREATE INDEX IF NOT EXISTS idx_assets_is_favorite ON assets(is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_assets_tags ON assets USING GIN(tags);

-- 10. 更新已有数据
-- 将所有关联 ai_task_id 的素材标记为 ai_generated
UPDATE assets 
SET asset_category = 'ai_generated' 
WHERE ai_task_id IS NOT NULL AND asset_category IS NULL;

-- 将所有 ai_generated = true 的素材标记为 ai_generated
UPDATE assets 
SET asset_category = 'ai_generated' 
WHERE ai_generated = TRUE AND asset_category IS NULL;

-- 将其余素材默认为 user_material（用户自己上传的）
UPDATE assets 
SET asset_category = 'user_material' 
WHERE asset_category IS NULL;

-- ============================================================================
-- 说明
-- ============================================================================
-- 
-- 素材分类架构：
-- 
-- ┌─────────────────────────────────────────────────────────────────┐
-- │                        我的素材 (MyMaterialsView)                │
-- ├─────────────────────────────┬───────────────────────────────────┤
-- │      AI 创作                │        我的素材库                   │
-- │   (asset_category =         │   (asset_category =                │
-- │    'ai_generated')          │    'user_material')                │
-- ├─────────────────────────────┼───────────────────────────────────┤
-- │ • 口型同步 (lip_sync)       │ • 数字人形象 (avatar)             │
-- │ • 文生视频 (text_to_video)  │   - 图片/视频格式                 │
-- │ • 图生视频 (image_to_video) │   - 用于智能播报                  │
-- │ • 图像生成 (image_gen)      │                                   │
-- │ • 智能播报 (smart_broadcast)│ • 声音样本 (voice_sample)         │
-- │ • ...                       │   - 用于声音克隆                  │
-- │                             │   - 30秒-3分钟音频                │
-- │                             │                                   │
-- │                             │ • 通用素材 (general)              │
-- │                             │   - 普通视频/图片/音频            │
-- └─────────────────────────────┴───────────────────────────────────┘
-- 
-- 素材流向：
-- 
--   用户上传 ────────────────────────────────────────┐
--       │                                            │
--       ├──► 数字人形象 ──────────────┐              │
--       │    (avatar)                │              │
--       │                            ▼              │
--       │                    ┌──────────────┐       │
--       ├──► 声音样本 ──────►│   智能播报    │◄──────┘
--       │    (voice_sample)  │ (WorkflowModal)│
--       │                    └──────┬───────┘
--       │                           │
--       └──► 通用素材               │
--            (general)              ▼
--                           AI 生成的视频
--                                │
--                                ▼
--                           我的素材
--                         (ai_generated)
-- 

-- ============================================================================
-- 11. 创建声音克隆记录表 (voice_clones)
-- ============================================================================
CREATE TABLE IF NOT EXISTS voice_clones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    
    -- 关联的原始音频素材
    source_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    
    -- 声音名称 (用户自定义)
    name TEXT NOT NULL,
    
    -- Fish Audio 服务端的 reference_id
    fish_audio_reference_id TEXT NOT NULL,
    
    -- 声音属性
    language TEXT DEFAULT 'zh',
    gender TEXT CHECK (gender IN ('male', 'female', 'neutral')),
    
    -- 试听音频 URL
    preview_audio_url TEXT,
    
    -- 使用统计
    usage_count INTEGER DEFAULT 0,
    
    -- 状态
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'processing', 'failed')),
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_voice_clones_user_id ON voice_clones(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_clones_source_asset ON voice_clones(source_asset_id);
CREATE INDEX IF NOT EXISTS idx_voice_clones_status ON voice_clones(status);

-- ============================================================================
-- 12. 创建用户素材偏好设置表 (user_material_preferences)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_material_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    
    -- 默认数字人形象
    default_avatar_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    
    -- 默认声音配置
    default_voice_type TEXT DEFAULT 'preset' CHECK (default_voice_type IN ('preset', 'cloned')),
    default_voice_id TEXT,
    
    -- 智能播报默认设置
    default_broadcast_settings JSONB DEFAULT '{
        "aspect_ratio": "16:9",
        "model": "kling-v2-master",
        "lip_sync_mode": "audio2video"
    }'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_material_prefs_user ON user_material_preferences(user_id); 
