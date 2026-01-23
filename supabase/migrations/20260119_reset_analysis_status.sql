-- ============================================================================
-- 重置错误的 content_analyses 状态
-- 日期: 2026-01-19
-- 说明: 将 confirmed 状态的分析（没有生成 clips 的）重置为 completed
-- ============================================================================

-- 查看当前 confirmed 状态的分析
-- SELECT id, project_id, status, updated_at FROM content_analyses WHERE status = 'confirmed';

-- 重置所有 confirmed 状态为 completed（允许重新确认）
UPDATE content_analyses 
SET status = 'completed', 
    updated_at = NOW()
WHERE status = 'confirmed';

-- 如果只想重置最近的一条，使用：
-- UPDATE content_analyses 
-- SET status = 'completed', updated_at = NOW()
-- WHERE status = 'confirmed'
-- ORDER BY updated_at DESC
-- LIMIT 1;
