-- ============================================================================
-- 添加 broll clip 类型
-- B-Roll 是 video 的子类型，用于覆盖层视频，不受"连续无间隙"规则约束
-- ============================================================================

-- 更新 clip_type 约束，添加 'broll' 类型
ALTER TABLE clips DROP CONSTRAINT IF EXISTS clips_clip_type_check;
ALTER TABLE clips ADD CONSTRAINT clips_clip_type_check 
    CHECK (clip_type IN ('video', 'broll', 'image', 'audio', 'subtitle', 'text', 'voice', 'effect', 'filter', 'sticker', 'transition'));

-- 添加注释说明类型关系
COMMENT ON COLUMN clips.clip_type IS '片段类型：video(主视频,连续), broll(B-Roll覆盖层,可间断), audio, subtitle(字幕,可间断), text, voice, effect, filter, sticker, transition';
