-- 添加 background_replace 任务类型到 tasks 表
-- 执行时间：2026-02-05

-- 1. 移除旧的 CHECK 约束
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

-- 2. 添加新的 CHECK 约束（包含 background_replace）
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check 
CHECK (task_type IN (
    'transcribe', 'vad', 'filler_detection', 'diarization',
    'stem_separation', 'smart_clean', 'smart_camera', 'export', 
    'subtitle_burn', 'asset_processing', 'background_replace'
));

-- 3. 添加 clip_id 字段（背景替换任务需要关联到 clip）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS clip_id UUID;

-- 4. 添加其他需要的字段
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result_url TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result_asset_id UUID;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 5. 修改 project_id 为可选（背景替换任务可能没有 project_id）
ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL;

-- 6. 添加索引
CREATE INDEX IF NOT EXISTS idx_tasks_clip_id ON tasks(clip_id);
CREATE INDEX IF NOT EXISTS idx_tasks_result_asset_id ON tasks(result_asset_id);
