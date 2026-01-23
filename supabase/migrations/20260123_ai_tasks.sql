-- =============================================
-- AI 任务表 - 用于存储 AI 处理任务状态
-- 创建时间: 2026-01-23
-- 功能: 口型同步、换脸、换背景等 AI 任务追踪
-- =============================================

-- 创建 AI 任务表
CREATE TABLE IF NOT EXISTS ai_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,  -- 不添加 FK，由后端 service_key 管理
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  
  -- 任务类型
  task_type TEXT NOT NULL,
  -- 可选值: lip_sync, face_swap, background_replace,
  --        text_to_video, image_to_video, digital_human
  
  -- 任务来源
  source TEXT NOT NULL DEFAULT 'rabbit_hole',
  -- 可选值: rabbit_hole (Rabbit Hole 创作), editor (编辑器 AI 工具)
  
  -- 关联的源 Clip (仅 editor 来源)
  source_clip_id UUID REFERENCES clips(id) ON DELETE SET NULL,
  
  -- 输入参数 (JSON)
  input_params JSONB NOT NULL DEFAULT '{}',
  -- 示例:
  -- lip_sync: {"video_url": "...", "audio_url": "..."}
  -- face_swap: {"video_url": "...", "face_image_url": "..."}
  
  -- 第三方 AI 服务
  provider TEXT NOT NULL DEFAULT 'kling',
  provider_task_id TEXT,  -- 可灵AI 返回的 task_id
  
  -- 状态
  status TEXT NOT NULL DEFAULT 'pending',
  -- 可选值: pending, processing, completed, failed, cancelled
  progress INTEGER DEFAULT 0,  -- 0-100
  status_message TEXT,  -- 当前状态描述
  
  -- 输出
  output_url TEXT,  -- 生成的视频 URL (可灵返回)
  output_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,  -- 关联到素材库
  
  -- 错误信息
  error_code TEXT,
  error_message TEXT,
  
  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- 状态约束
  CONSTRAINT ai_tasks_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT ai_tasks_task_type_check CHECK (
    task_type IN ('lip_sync', 'face_swap', 'background_replace', 
                  'text_to_video', 'image_to_video', 'digital_human')
  ),
  CONSTRAINT ai_tasks_source_check CHECK (
    source IN ('rabbit_hole', 'editor')
  )
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ai_tasks_user_id ON ai_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_project_id ON ai_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_task_type ON ai_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_created_at ON ai_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_provider_task_id ON ai_tasks(provider_task_id);

-- RLS 策略
ALTER TABLE ai_tasks ENABLE ROW LEVEL SECURITY;

-- 用户只能看到自己的任务
CREATE POLICY "Users can view own ai_tasks"
  ON ai_tasks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 用户可以创建自己的任务
CREATE POLICY "Users can create own ai_tasks"
  ON ai_tasks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 用户可以更新自己的任务
CREATE POLICY "Users can update own ai_tasks"
  ON ai_tasks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- 用户可以删除自己的任务
CREATE POLICY "Users can delete own ai_tasks"
  ON ai_tasks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =============================================
-- 扩展 assets 表，添加 AI 相关字段
-- =============================================
ALTER TABLE assets ADD COLUMN IF NOT EXISTS ai_task_id UUID REFERENCES ai_tasks(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT FALSE;

-- assets 表索引
CREATE INDEX IF NOT EXISTS idx_assets_ai_task_id ON assets(ai_task_id);
CREATE INDEX IF NOT EXISTS idx_assets_ai_generated ON assets(ai_generated);

-- =============================================
-- 注释
-- =============================================
COMMENT ON TABLE ai_tasks IS 'AI 处理任务表，追踪口型同步、换脸等 AI 任务状态';
COMMENT ON COLUMN ai_tasks.task_type IS '任务类型: lip_sync/face_swap/background_replace/text_to_video/image_to_video/digital_human';
COMMENT ON COLUMN ai_tasks.source IS '任务来源: rabbit_hole(AI创作工具集)/editor(编辑器AI工具)';
COMMENT ON COLUMN ai_tasks.provider IS 'AI 服务提供商: kling(可灵AI)';
COMMENT ON COLUMN ai_tasks.provider_task_id IS '第三方 AI 服务返回的任务 ID';
COMMENT ON COLUMN ai_tasks.input_params IS '任务输入参数 JSON';
COMMENT ON COLUMN ai_tasks.output_url IS 'AI 生成的结果文件 URL';
COMMENT ON COLUMN ai_tasks.output_asset_id IS '生成结果保存到素材库后的 Asset ID';
