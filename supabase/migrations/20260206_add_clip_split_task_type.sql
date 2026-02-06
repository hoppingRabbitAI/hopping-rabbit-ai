-- ============================================================================
-- 添加 clip_split 任务类型
-- 日期: 2026-02-06
-- 说明: 为 tasks 表添加 clip_split 任务类型支持，用于分镜拆分任务
-- ============================================================================

-- 1. 删除旧的 CHECK 约束
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;

-- 2. 添加新的 CHECK 约束（包含所有已知任务类型）
ALTER TABLE tasks ADD CONSTRAINT tasks_task_type_check 
CHECK (task_type IN (
    'transcribe', 'vad', 'filler_detection', 'diarization',
    'stem_separation', 'smart_clean', 'smart_camera', 'export', 
    'subtitle_burn', 'asset_processing', 'clip_split', 'background_replace'
));
