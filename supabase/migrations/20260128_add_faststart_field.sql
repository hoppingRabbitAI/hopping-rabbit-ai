-- 添加 faststart_applied 字段到 assets 表
-- 用于标记 MP4 视频是否已应用 faststart 优化（moov atom 移到文件开头）

ALTER TABLE assets ADD COLUMN IF NOT EXISTS faststart_applied BOOLEAN DEFAULT FALSE;

-- 添加注释
COMMENT ON COLUMN assets.faststart_applied IS '是否已应用 faststart 优化（moov atom 移到文件开头，支持流式播放）';
