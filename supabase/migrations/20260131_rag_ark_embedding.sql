-- ============================================
-- RAG 向量库迁移: 384维 → 2560维
-- 火山方舟 doubao-embedding-text-240715
-- 执行时间: 2026-01-31
-- ============================================

-- 注意: 此迁移会删除现有数据，需要重新生成 embeddings

-- 1. 删除依赖的视图和旧表 (如果存在)
DROP VIEW IF EXISTS benchmark_segments_stats CASCADE;
DROP TABLE IF EXISTS benchmark_segments_backup CASCADE;
DROP TABLE IF EXISTS benchmark_segments CASCADE;

-- 2. 创建新表 (2560维向量)
CREATE TABLE benchmark_segments (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    video_title TEXT,
    timestamp_start REAL DEFAULT 0,
    timestamp_end REAL DEFAULT 0,
    input_text TEXT NOT NULL,
    input_text_clean TEXT NOT NULL,
    content_type TEXT NOT NULL,
    template_id TEXT NOT NULL DEFAULT 'talking-head',
    broll_trigger_type TEXT,
    broll_trigger_pattern TEXT,
    visual_config JSONB,
    reasoning TEXT,
    quality_score REAL DEFAULT 1.0,
    tags TEXT[] DEFAULT '{}',
    embedding vector(2560),  -- 火山方舟 doubao-embedding-text-240715
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 创建索引
CREATE INDEX idx_benchmark_segments_video_id ON benchmark_segments(video_id);
CREATE INDEX idx_benchmark_segments_template_id ON benchmark_segments(template_id);
CREATE INDEX idx_benchmark_segments_content_type ON benchmark_segments(content_type);
CREATE INDEX idx_benchmark_segments_broll_trigger_type ON benchmark_segments(broll_trigger_type);

-- 4. 创建向量索引 (IVFFlat 支持高维向量)
-- 注意: HNSW 最多支持 2000 维，2560 维需要用 IVFFlat
-- IVFFlat 需要先有数据才能创建，所以改为手动创建
-- 数据导入后运行: CREATE INDEX idx_benchmark_segments_embedding ON benchmark_segments USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 5. 删除旧的 RPC 函数 (维度不同无法直接替换)
DROP FUNCTION IF EXISTS match_benchmark_segments(vector, integer, text, text, text, double precision);
DROP FUNCTION IF EXISTS match_benchmark_segments(vector(384), integer, text, text, text, double precision);

-- 6. 创建新的 RPC 函数 (匹配新的向量维度)
CREATE OR REPLACE FUNCTION match_benchmark_segments(
    query_embedding vector(2560),
    match_count INT DEFAULT 5,
    filter_template_id TEXT DEFAULT NULL,
    filter_content_type TEXT DEFAULT NULL,
    filter_broll_trigger_type TEXT DEFAULT NULL,
    similarity_threshold FLOAT DEFAULT 0.0
)
RETURNS TABLE (
    id TEXT,
    video_id TEXT,
    video_title TEXT,
    timestamp_start REAL,
    timestamp_end REAL,
    input_text TEXT,
    input_text_clean TEXT,
    content_type TEXT,
    template_id TEXT,
    broll_trigger_type TEXT,
    broll_trigger_pattern TEXT,
    visual_config JSONB,
    reasoning TEXT,
    quality_score REAL,
    tags TEXT[],
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        bs.id,
        bs.video_id,
        bs.video_title,
        bs.timestamp_start,
        bs.timestamp_end,
        bs.input_text,
        bs.input_text_clean,
        bs.content_type,
        bs.template_id,
        bs.broll_trigger_type,
        bs.broll_trigger_pattern,
        bs.visual_config,
        bs.reasoning,
        bs.quality_score,
        bs.tags,
        1 - (bs.embedding <=> query_embedding) AS similarity
    FROM benchmark_segments bs
    WHERE 
        (filter_template_id IS NULL OR bs.template_id = filter_template_id)
        AND (filter_content_type IS NULL OR bs.content_type = filter_content_type)
        AND (filter_broll_trigger_type IS NULL OR bs.broll_trigger_type = filter_broll_trigger_type)
        AND bs.embedding IS NOT NULL
        AND (1 - (bs.embedding <=> query_embedding)) >= similarity_threshold
    ORDER BY bs.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 7. RLS 策略
ALTER TABLE benchmark_segments ENABLE ROW LEVEL SECURITY;

-- 允许所有认证用户读取
CREATE POLICY "Allow authenticated read" ON benchmark_segments
    FOR SELECT TO authenticated USING (true);

-- 允许 service role 完全访问
CREATE POLICY "Allow service role full access" ON benchmark_segments
    FOR ALL TO service_role USING (true);

-- 8. 提示
-- 运行完此迁移后，需要重新生成所有 embeddings
-- 使用脚本: python -m scripts.regenerate_rag_embeddings
