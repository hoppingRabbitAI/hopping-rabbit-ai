-- ============================================================================
-- 迁移: 添加 ai_outputs 表 + 清理 ai_tasks 表
-- 运行日期: 2026-01-23
-- 目的: AI 模块完全独立于 assets/projects/clips
-- ============================================================================

-- ============================================
-- 1. 清理 ai_tasks 表中不需要的字段和约束
-- ============================================

-- 删除 source_clip_id 外键约束（如果存在）
ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_source_clip_id_fkey;

-- 删除 output_asset_id 外键约束（如果存在）
ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_output_asset_id_fkey;

-- 删除不需要的列（如果存在）
ALTER TABLE ai_tasks DROP COLUMN IF EXISTS source_clip_id;
ALTER TABLE ai_tasks DROP COLUMN IF EXISTS output_asset_id;
ALTER TABLE ai_tasks DROP COLUMN IF EXISTS source;

-- 添加 result_metadata 列（存储输出 ID 列表）
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS result_metadata JSONB;

-- ============================================
-- 2. 创建 ai_outputs 表
-- ============================================
CREATE TABLE IF NOT EXISTS ai_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,  -- 冗余存储，方便查询
    
    -- 输出类型
    output_type TEXT NOT NULL CHECK (output_type IN ('image', 'video', 'audio')),
    
    -- 输出索引（同一任务的多个输出）
    output_index INTEGER NOT NULL DEFAULT 0,
    
    -- 原始 URL（来自 AI 服务，30天后失效）
    original_url TEXT NOT NULL,
    
    -- 持久化存储
    storage_path TEXT,  -- Supabase Storage 路径
    storage_url TEXT,   -- 公开访问 URL
    
    -- 元数据
    width INTEGER,
    height INTEGER,
    duration FLOAT,  -- 视频/音频时长（秒）
    file_size BIGINT,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 创建索引
CREATE INDEX IF NOT EXISTS idx_ai_outputs_task_id ON ai_outputs(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_user_id ON ai_outputs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_output_type ON ai_outputs(output_type);
CREATE INDEX IF NOT EXISTS idx_ai_outputs_created_at ON ai_outputs(created_at DESC);

-- ============================================
-- 3. 更新 ai_tasks 约束
-- ============================================
-- 先删除旧约束
ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_task_type_check;

-- 添加新约束（包含 image_generation）
ALTER TABLE ai_tasks ADD CONSTRAINT ai_tasks_task_type_check 
  CHECK (task_type IN (
    'transcribe',
    'diarization', 
    'vad',
    'filler_detection',
    'stem_separation',
    'smart_clean',
    'subtitle_burn',
    'export',
    'ai_editing',
    'text_to_video',
    'image_to_video',
    'image_generation'
  ));

-- 4. 启用 Realtime（前端订阅任务状态变化）
ALTER PUBLICATION supabase_realtime ADD TABLE ai_tasks;

-- 5. 启用 RLS (可选，按需启用)
-- ALTER TABLE ai_outputs ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can view own outputs" ON ai_outputs
--   FOR SELECT USING (auth.uid() = user_id);
-- CREATE POLICY "Service can insert outputs" ON ai_outputs
--   FOR INSERT WITH CHECK (true);

-- ============================================================================
-- 完成！
-- 现在可以重启后端服务并测试 AI 任务回调
-- ============================================================================
