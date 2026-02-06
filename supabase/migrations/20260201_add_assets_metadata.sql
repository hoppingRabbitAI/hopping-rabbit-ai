-- 添加 assets.metadata 字段用于存储扩展元数据（如 transcript_segments）
ALTER TABLE assets ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- 添加注释
COMMENT ON COLUMN assets.metadata IS '扩展元数据，如 transcript_segments 等';
