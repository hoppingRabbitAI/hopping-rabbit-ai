-- 添加 HLS 状态和转码标记字段
-- 用于支持 ProRes 等非标准编码视频的后台转码

-- hls_status: HLS 生成状态 (pending/processing/ready/failed)
-- needs_transcode: 是否需要转码才能播放（ProRes、HEVC 等浏览器不支持的格式）

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS hls_status TEXT DEFAULT NULL;

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS needs_transcode BOOLEAN DEFAULT FALSE;

-- 添加索引以加速查询
CREATE INDEX IF NOT EXISTS idx_assets_hls_status ON assets(hls_status);
CREATE INDEX IF NOT EXISTS idx_assets_needs_transcode ON assets(needs_transcode) WHERE needs_transcode = TRUE;

COMMENT ON COLUMN assets.hls_status IS 'HLS 生成状态: pending(等待生成), processing(生成中), ready(已就绪), failed(失败)';
COMMENT ON COLUMN assets.needs_transcode IS '是否需要转码才能在浏览器播放（如 ProRes、HEVC 等）';
