-- ============================================================================
-- 添加 workflow_step 字段到 workspace_sessions 表
-- 用于跟踪工作流进度
-- ============================================================================

-- 添加 workflow_step 字段
ALTER TABLE workspace_sessions ADD COLUMN IF NOT EXISTS workflow_step TEXT DEFAULT 'upload';

-- 添加 entry_mode 字段（如果不存在）
ALTER TABLE workspace_sessions ADD COLUMN IF NOT EXISTS entry_mode TEXT DEFAULT 'refine';

-- 添加注释
COMMENT ON COLUMN workspace_sessions.workflow_step IS '工作流步骤: upload, config, analyze, defiller, broll_config, completed';
COMMENT ON COLUMN workspace_sessions.entry_mode IS '入口模式: refine(口播精修), quick(快速剪辑)';

-- 更新已有的 session: 如果 status=completed 且 workflow_step 为空，设为 config
UPDATE workspace_sessions 
SET workflow_step = 'config' 
WHERE status = 'completed' AND (workflow_step IS NULL OR workflow_step = 'upload');
