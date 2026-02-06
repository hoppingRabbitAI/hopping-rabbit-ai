-- ============================================================================
-- 允许 assets.project_id 为空
-- 日期: 2026-02-06
-- 说明: 用户素材库的素材不属于任何项目，需要 project_id 可以为空
-- ============================================================================

-- 移除 project_id 的 NOT NULL 约束
ALTER TABLE assets ALTER COLUMN project_id DROP NOT NULL;

-- 添加注释说明
COMMENT ON COLUMN assets.project_id IS '项目ID，用户素材库的素材可以为空';
