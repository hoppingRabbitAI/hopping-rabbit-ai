-- ============================================================================
-- 积分收费模型更新
-- 
-- 新规则:
-- 1. 提取字幕/音频 (voice-extract) → 免费
-- 2. AI 智能剪辑 (ai-create) → 收一次固定费用
-- 3. Kling AI 功能 → 保持原有收费
-- ============================================================================

-- 1. 将基础功能和智能分析模型的积分设为 0 (免费)
UPDATE ai_model_credits SET
    credits_per_call = 0,
    credits_per_minute = NULL,
    credits_per_second = NULL,
    min_credits = 0,
    max_credits = NULL,
    updated_at = NOW()
WHERE model_key IN (
    -- 基础功能 (原先有消耗，现在免费)
    'whisper_transcribe',
    'filler_detection',
    'vad',
    'stem_separation',
    'diarization',
    -- 智能分析功能 (原先有消耗，现在免费)
    'gpt4_analysis',
    'smart_clip',
    'smart_camera',
    'smart_clean',
    -- 图片生成 (暂时也免费)
    'dalle3',
    'sd_generate'
);

-- 2. 新增 AI 智能剪辑会话收费模型 (一次性收费)
INSERT INTO ai_model_credits (
    model_key, 
    model_name, 
    provider, 
    credits_per_call, 
    credits_per_minute, 
    credits_per_second, 
    min_credits, 
    max_credits, 
    estimated_cost_usd, 
    category, 
    description
) VALUES (
    'ai_create_session',
    'AI 智能剪辑',
    'internal',
    15,          -- 固定 15 积分/次
    NULL,
    NULL,
    15,
    15,
    0.10,
    'editing',
    '一键智能剪辑 - 包含转录、智能分析、剪辑建议等全流程'
)
ON CONFLICT (model_key) DO UPDATE SET
    model_name = EXCLUDED.model_name,
    credits_per_call = EXCLUDED.credits_per_call,
    credits_per_minute = EXCLUDED.credits_per_minute,
    credits_per_second = EXCLUDED.credits_per_second,
    min_credits = EXCLUDED.min_credits,
    max_credits = EXCLUDED.max_credits,
    estimated_cost_usd = EXCLUDED.estimated_cost_usd,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    updated_at = NOW();

-- 3. 验证 Kling AI 功能保持原有收费 (不做修改，仅确认)
-- kling_lip_sync: 8 积分/秒
-- kling_face_swap: 10 积分/秒
-- kling_i2v: 100 积分/次
-- kling_t2v: 200 积分/次
-- kling_motion: 80 积分/次
-- kling_omni_image: 50 积分/次

-- 添加注释记录定价规则
COMMENT ON TABLE ai_model_credits IS '
AI 模型积分定价表

定价规则 (2026-01-25 更新):
- 提取字幕/音频 (voice-extract): 免费
- AI 智能剪辑 (ai-create): 15 积分/次 (ai_create_session)
- Kling AI 功能: 按原定价收费

免费功能: whisper_transcribe, filler_detection, vad, stem_separation, 
          diarization, gpt4_analysis, smart_clip, smart_camera, smart_clean
';
