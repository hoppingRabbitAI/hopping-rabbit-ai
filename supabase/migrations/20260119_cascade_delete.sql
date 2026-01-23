-- ============================================================================
-- HoppingRabbit AI - 级联删除迁移
-- 日期: 2026-01-19
-- 说明: 为所有关联表添加 ON DELETE CASCADE，删除项目时自动清理关联数据
-- ============================================================================

-- ============================================================================
-- 0. 清理孤立数据（外键约束前必须执行）
-- ============================================================================

-- 删除指向不存在 clip 的 keyframes
DELETE FROM keyframes 
WHERE clip_id NOT IN (SELECT id FROM clips);

-- 删除指向不存在 track 的 clips
DELETE FROM clips 
WHERE track_id NOT IN (SELECT id FROM tracks);

-- 删除指向不存在 asset 的 clips（或者设为 NULL）
UPDATE clips SET asset_id = NULL 
WHERE asset_id IS NOT NULL AND asset_id NOT IN (SELECT id FROM assets);

-- 删除指向不存在 project 的 tracks
DELETE FROM tracks 
WHERE project_id NOT IN (SELECT id FROM projects);

-- 删除指向不存在 project 的 assets
DELETE FROM assets 
WHERE project_id NOT IN (SELECT id FROM projects);

-- 删除指向不存在 project 的 tasks
DELETE FROM tasks 
WHERE project_id NOT IN (SELECT id FROM projects);

-- 删除指向不存在 asset 的 tasks（或者设为 NULL）
UPDATE tasks SET asset_id = NULL 
WHERE asset_id IS NOT NULL AND asset_id NOT IN (SELECT id FROM assets);

-- 删除指向不存在 project 的 snapshots
DELETE FROM snapshots 
WHERE project_id NOT IN (SELECT id FROM projects);

-- 删除指向不存在 project 的 exports
DELETE FROM exports 
WHERE project_id NOT IN (SELECT id FROM projects);

-- 删除指向不存在 project 的 workspace_sessions
DELETE FROM workspace_sessions 
WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects);

-- ============================================================================
-- 1. assets 表 - 添加 project_id 外键级联删除
-- ============================================================================
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_project_id_fkey;
ALTER TABLE assets 
    ADD CONSTRAINT assets_project_id_fkey 
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- ============================================================================
-- 2. tracks 表 - 添加 project_id 外键级联删除
-- ============================================================================
ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_project_id_fkey;
ALTER TABLE tracks 
    ADD CONSTRAINT tracks_project_id_fkey 
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- ============================================================================
-- 3. clips 表 - 添加 track_id 外键级联删除
-- ============================================================================
ALTER TABLE clips DROP CONSTRAINT IF EXISTS clips_track_id_fkey;
ALTER TABLE clips 
    ADD CONSTRAINT clips_track_id_fkey 
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE;

-- clips.asset_id 设为 SET NULL (删除素材时保留 clip，但清空 asset_id)
ALTER TABLE clips DROP CONSTRAINT IF EXISTS clips_asset_id_fkey;
ALTER TABLE clips 
    ADD CONSTRAINT clips_asset_id_fkey 
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL;

-- ============================================================================
-- 4. keyframes 表 - 添加 clip_id 外键级联删除
-- ============================================================================
ALTER TABLE keyframes DROP CONSTRAINT IF EXISTS keyframes_clip_id_fkey;
ALTER TABLE keyframes 
    ADD CONSTRAINT keyframes_clip_id_fkey 
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE;

-- ============================================================================
-- 5. tasks 表 - 添加 project_id 外键级联删除
-- ============================================================================
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_project_id_fkey;
ALTER TABLE tasks 
    ADD CONSTRAINT tasks_project_id_fkey 
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- tasks.asset_id 设为 SET NULL
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_asset_id_fkey;
ALTER TABLE tasks 
    ADD CONSTRAINT tasks_asset_id_fkey 
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL;

-- ============================================================================
-- 6. snapshots 表 - 添加 project_id 外键级联删除
-- ============================================================================
ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_project_id_fkey;
ALTER TABLE snapshots 
    ADD CONSTRAINT snapshots_project_id_fkey 
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- ============================================================================
-- 7. exports 表 - 添加 project_id 外键级联删除
-- ============================================================================
ALTER TABLE exports DROP CONSTRAINT IF EXISTS exports_project_id_fkey;
ALTER TABLE exports 
    ADD CONSTRAINT exports_project_id_fkey 
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- ============================================================================
-- 8. workspace_sessions 表 - 添加 project_id 外键级联删除
-- ============================================================================
ALTER TABLE workspace_sessions DROP CONSTRAINT IF EXISTS workspace_sessions_project_id_fkey;
ALTER TABLE workspace_sessions 
    ADD CONSTRAINT workspace_sessions_project_id_fkey 
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- ============================================================================
-- 9. content_analyses 表 - 已有 ON DELETE CASCADE (确认)
-- ============================================================================
-- project_id 已有: REFERENCES projects(id) ON DELETE CASCADE

-- ============================================================================
-- 10. content_selections 表 - 已有 ON DELETE CASCADE (确认)
-- ============================================================================
-- analysis_id 已有: REFERENCES content_analyses(id) ON DELETE CASCADE

-- ============================================================================
-- 完成后，删除项目只需一条 SQL:
-- DELETE FROM projects WHERE id = 'xxx'
-- 数据库会自动级联删除所有关联数据
-- ============================================================================
