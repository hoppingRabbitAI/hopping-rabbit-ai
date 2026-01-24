-- ============================================================================
-- 迁移: ai_tasks 表添加 output_asset_id 字段
-- 创建时间: 2026-01-24
-- 说明: 用于关联生成结果到素材库
-- ============================================================================

-- 添加 output_asset_id 字段
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS output_asset_id UUID;

-- 添加外键约束（可选，设为 SET NULL 避免删除问题）
-- ALTER TABLE ai_tasks ADD CONSTRAINT ai_tasks_output_asset_id_fkey 
--     FOREIGN KEY (output_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_ai_tasks_output_asset_id ON ai_tasks(output_asset_id);

COMMENT ON COLUMN ai_tasks.output_asset_id IS '关联到素材库的 Asset ID';
