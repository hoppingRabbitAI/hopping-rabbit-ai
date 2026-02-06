-- ============================================================================
-- 统一任务表：合并 ai_tasks 到 tasks
-- 日期: 2026-02-06
-- 说明: 将 ai_tasks 表的所有功能合并到 tasks 表，然后删除 ai_tasks 表
-- ============================================================================

-- 1. 移除旧的 CHECK 约束
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

-- 2. 添加 ai_tasks 表特有的字段到 tasks 表
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider TEXT;  -- AI 服务提供商 (kling, etc.)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provider_task_id TEXT;  -- AI 服务返回的任务 ID
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS input_params JSONB DEFAULT '{}'::jsonb;  -- 输入参数
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS output_url TEXT;  -- 输出 URL
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS output_asset_id UUID;  -- 关联到素材库
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS error_code TEXT;  -- 错误代码
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS credits_consumed INTEGER DEFAULT 0;  -- 消耗积分
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS credits_held INTEGER DEFAULT 0;  -- 预扣积分

-- 3. 添加新的 CHECK 约束（包含所有任务类型）
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check 
CHECK (task_type IN (
    -- 原 tasks 表任务类型
    'transcribe', 'vad', 'filler_detection', 'diarization',
    'stem_separation', 'smart_clean', 'smart_camera', 'export', 
    'subtitle_burn', 'asset_processing', 'clip_split', 'background_replace',
    -- 原 ai_tasks 表任务类型
    'lip_sync', 'face_swap', 'text_to_video', 'image_to_video', 
    'image_generation', 'digital_human', 'motion_control', 'omni_image',
    'multi_elements', 'smart_broadcast'
));

-- 4. 更新状态约束（统一 running/processing）
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check 
CHECK (status IN ('pending', 'running', 'processing', 'completed', 'failed', 'cancelled'));

-- 5. 添加索引
CREATE INDEX IF NOT EXISTS idx_tasks_provider_task_id ON tasks(provider_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_output_asset_id ON tasks(output_asset_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

-- 6. 迁移 ai_tasks 数据到 tasks 表
INSERT INTO tasks (
    id, project_id, user_id, task_type, status, progress, 
    params, error_message, created_at, started_at, completed_at,
    provider, provider_task_id, input_params, output_url, output_asset_id,
    error_code, credits_consumed, credits_held, metadata, status_message
)
SELECT 
    id,
    NULL as project_id,  -- ai_tasks 没有 project_id
    user_id,
    task_type,
    CASE WHEN status = 'processing' THEN 'running' ELSE status END as status,
    progress,
    input_params as params,  -- ai_tasks 用 input_params
    error_message,
    created_at,
    started_at,
    completed_at,
    provider,
    provider_task_id,
    input_params,
    output_url,
    output_asset_id,
    error_code,
    COALESCE(credits_consumed, 0),
    COALESCE(credits_held, 0),
    COALESCE(result_metadata, '{}'::jsonb) as metadata,
    status_message
FROM ai_tasks
ON CONFLICT (id) DO NOTHING;

-- 7. 更新 ai_outputs 表的外键引用 (如果存在)
-- 注意：先删除旧外键，再添加新外键
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_outputs') THEN
        ALTER TABLE ai_outputs DROP CONSTRAINT IF EXISTS ai_outputs_task_id_fkey;
        ALTER TABLE ai_outputs ADD CONSTRAINT ai_outputs_task_id_fkey 
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 8. 添加 realtime 支持
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;

-- 9. 删除 ai_tasks 表 (谨慎操作，确认数据迁移完成后执行)
-- DROP TABLE IF EXISTS ai_tasks CASCADE;

-- ★★★ 重要：确认数据迁移成功后，手动执行以下命令删除 ai_tasks 表 ★★★
-- DROP TABLE IF EXISTS ai_tasks CASCADE;
