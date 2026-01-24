-- 添加 image 类型到 clips.clip_type
-- 用于支持 AI 生成的图片作为 clip 添加到时间轴

-- 1. 删除旧的 CHECK 约束
ALTER TABLE clips DROP CONSTRAINT IF EXISTS clips_clip_type_check;

-- 2. 添加新的 CHECK 约束，包含 image 类型
ALTER TABLE clips ADD CONSTRAINT clips_clip_type_check 
    CHECK (clip_type IN ('video', 'audio', 'subtitle', 'text', 'voice', 'effect', 'filter', 'sticker', 'transition', 'image'));

-- 3. 添加注释
COMMENT ON COLUMN clips.clip_type IS '片段类型: video, audio, image, subtitle, text, voice, effect, filter, sticker, transition';
