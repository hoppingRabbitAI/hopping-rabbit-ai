-- ============================================
-- 迁移到多模态 Embedding: doubao-embedding-vision-250615
-- 维度: 1024 (IVFFlat 最大支持 2000)
-- ============================================

-- 1. 删除依赖的函数
DROP FUNCTION IF EXISTS match_benchmark_segments(vector(2560), integer, float);
DROP FUNCTION IF EXISTS match_benchmark_segments(vector(2048), integer, float);
DROP FUNCTION IF EXISTS match_benchmark_segments(vector(1024), integer, float);
DROP FUNCTION IF EXISTS match_benchmark_segments(vector, integer, float);

-- 2. 删除旧索引
DROP INDEX IF EXISTS benchmark_segments_embedding_idx;

-- 3. 删除旧表 (数据需要重新生成)
DROP TABLE IF EXISTS benchmark_segments CASCADE;

-- 4. 创建新表 (1024 维度)
CREATE TABLE benchmark_segments (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    segment_idx INTEGER NOT NULL,
    segment_text TEXT NOT NULL,
    transform_rules JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1024),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 创建索引 (使用 IVFFlat, 最大支持 2000 维)
CREATE INDEX benchmark_segments_embedding_idx 
ON benchmark_segments 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 6. 创建普通索引
CREATE INDEX benchmark_segments_template_idx ON benchmark_segments(template_id);

-- 7. 创建 RPC 函数用于相似度搜索
CREATE OR REPLACE FUNCTION match_benchmark_segments(
    query_embedding vector(1024),
    match_count integer DEFAULT 5,
    match_threshold float DEFAULT 0.3
)
RETURNS TABLE (
    id text,
    template_id text,
    segment_idx integer,
    segment_text text,
    transform_rules jsonb,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        bs.id,
        bs.template_id,
        bs.segment_idx,
        bs.segment_text,
        bs.transform_rules,
        bs.metadata,
        (1 - (bs.embedding <=> query_embedding))::float as similarity
    FROM benchmark_segments bs
    WHERE bs.embedding IS NOT NULL
    AND (1 - (bs.embedding <=> query_embedding)) > match_threshold
    ORDER BY bs.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 8. 授权
GRANT ALL ON benchmark_segments TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION match_benchmark_segments(vector(1024), integer, float) TO postgres, anon, authenticated, service_role;

-- 完成提示
DO $$
BEGIN
    RAISE NOTICE 'Migration completed: benchmark_segments table created with vector(1024) for doubao-embedding-vision-250615';
END $$;
