-- ============================================================================
-- HoppingRabbit AI - Keyframes time → offset 迁移
-- 日期: 2026-01-19
-- 说明: 将 keyframes 表的 time (INTEGER) 改为 offset (REAL, 0-1 归一化)
-- ============================================================================

-- 1. 添加新的 offset 列（如果不存在）
ALTER TABLE keyframes ADD COLUMN IF NOT EXISTS "offset" REAL;

-- 2. 删除旧的 time 列（如果存在）
ALTER TABLE keyframes DROP COLUMN IF EXISTS "time";

-- 3. 确保 offset 列有默认值（用于历史数据）
UPDATE keyframes SET "offset" = 0 WHERE "offset" IS NULL;

-- 4. 设置 offset 为 NOT NULL
ALTER TABLE keyframes ALTER COLUMN "offset" SET NOT NULL;

-- 5. 重建唯一索引（clip_id, property, offset）
DROP INDEX IF EXISTS idx_keyframes_unique;
CREATE UNIQUE INDEX idx_keyframes_unique ON keyframes(clip_id, property, "offset");

-- 6. 重建 clip_property 索引
DROP INDEX IF EXISTS idx_keyframes_clip_property;
CREATE INDEX idx_keyframes_clip_property ON keyframes(clip_id, property);
