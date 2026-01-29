-- Cloudflare Stream 集成
-- 添加 cloudflare_uid 字段存储 Cloudflare 视频 ID

-- 添加 Cloudflare Stream 相关字段
ALTER TABLE assets ADD COLUMN IF NOT EXISTS cloudflare_uid VARCHAR(64);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS cloudflare_status VARCHAR(32) DEFAULT 'none';
-- cloudflare_status: none | uploading | processing | ready | error

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_assets_cloudflare_uid ON assets(cloudflare_uid);
CREATE INDEX IF NOT EXISTS idx_assets_cloudflare_status ON assets(cloudflare_status);

-- 添加注释
COMMENT ON COLUMN assets.cloudflare_uid IS 'Cloudflare Stream 视频 UID';
COMMENT ON COLUMN assets.cloudflare_status IS 'Cloudflare 转码状态: none/uploading/processing/ready/error';
