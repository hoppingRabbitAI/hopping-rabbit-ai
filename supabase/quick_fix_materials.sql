-- ============================================================================
-- 快速修复脚本 - 添加缺失的 assets 字段和 user_material_preferences 表
-- ============================================================================

-- 1. 添加 assets 表缺失的字段
ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS asset_category TEXT 
DEFAULT 'ai_generated' 
CHECK (asset_category IN ('ai_generated', 'user_material'));

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS material_type TEXT 
DEFAULT 'general'
CHECK (material_type IN ('avatar', 'voice_sample', 'general'));

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS material_metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- 2. 创建索引
CREATE INDEX IF NOT EXISTS idx_assets_asset_category ON assets(asset_category);
CREATE INDEX IF NOT EXISTS idx_assets_material_type ON assets(material_type);
CREATE INDEX IF NOT EXISTS idx_assets_is_favorite ON assets(is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_assets_tags ON assets USING GIN(tags);

-- 3. 创建 user_material_preferences 表
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

-- 4. 创建 voice_clones 表（如果还没有）
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

-- 5. 启用 RLS
ALTER TABLE user_material_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_clones ENABLE ROW LEVEL SECURITY;

-- 6. 创建 RLS 策略
DROP POLICY IF EXISTS "Users can view own preferences" ON user_material_preferences;
CREATE POLICY "Users can view own preferences" ON user_material_preferences
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own preferences" ON user_material_preferences;
CREATE POLICY "Users can insert own preferences" ON user_material_preferences
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON user_material_preferences;
CREATE POLICY "Users can update own preferences" ON user_material_preferences
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own voice clones" ON voice_clones;
CREATE POLICY "Users can view own voice clones" ON voice_clones
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own voice clones" ON voice_clones;
CREATE POLICY "Users can insert own voice clones" ON voice_clones
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own voice clones" ON voice_clones;
CREATE POLICY "Users can update own voice clones" ON voice_clones
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own voice clones" ON voice_clones;
CREATE POLICY "Users can delete own voice clones" ON voice_clones
    FOR DELETE USING (auth.uid() = user_id);

-- 完成
SELECT 'Migration completed successfully!' as status;
