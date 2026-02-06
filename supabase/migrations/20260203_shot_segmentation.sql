-- ============================================================================
-- 分镜策略迁移说明
-- 日期: 2026-02-03
-- 
-- 设计说明:
-- - 分镜结果存储在 clips 表中（复用项目已有结构）
-- - 策略信息存在每个 clip.metadata.strategy 中（每个 clip 可能用不同策略切出）
-- - 通过 clips.parent_clip_id 支持递归分镜
-- - workspace_sessions 不需要额外的分镜策略字段
-- ============================================================================

-- 添加索引优化分镜查询性能
-- 不带 WHERE 条件，同时支持：
-- 1. 顶级 clips 查询：WHERE parent_clip_id IS NULL
-- 2. 子 clips 查询：WHERE parent_clip_id = xxx
CREATE INDEX IF NOT EXISTS idx_clips_parent_clip_id 
    ON clips(parent_clip_id);
