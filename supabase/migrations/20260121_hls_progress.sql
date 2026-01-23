-- ============================================================================
-- 迁移: 添加 HLS 处理进度字段
-- 日期: 2026-01-21
-- 说明: 在 assets 表添加 hls_progress 和 hls_message 字段，
--       用于前端实时展示 HLS 转码进度
-- ============================================================================

-- 添加 HLS 进度字段（0-100）
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hls_progress INTEGER DEFAULT 0;

-- 添加 HLS 进度消息（如：正在下载远程视频...、编码中: 00:01:23 (1.5x)）
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hls_message TEXT;

-- 添加注释
COMMENT ON COLUMN assets.hls_progress IS 'HLS 处理进度百分比 (0-100)';
COMMENT ON COLUMN assets.hls_message IS 'HLS 处理状态消息，用于前端展示';
