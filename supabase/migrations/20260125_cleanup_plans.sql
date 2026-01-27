-- ============================================================================
-- 清理多余的订阅计划
-- 只保留 4 种计划: free, basic, pro, ultimate
-- 删除: enterprise, creator
-- ============================================================================

-- 1. 首先检查是否有用户订阅了这些计划
-- 如果有，需要先处理这些订阅

-- 将 enterprise 和 creator 用户迁移到 ultimate（如果存在）
UPDATE user_subscriptions 
SET plan_id = (SELECT id FROM subscription_plans WHERE slug = 'ultimate' LIMIT 1)
WHERE plan_id IN (
    SELECT id FROM subscription_plans WHERE slug IN ('enterprise', 'creator')
);

-- 2. 删除多余的计划
DELETE FROM subscription_plans WHERE slug = 'enterprise';
DELETE FROM subscription_plans WHERE slug = 'creator';

-- 3. 更新 display_order 确保正确排序
UPDATE subscription_plans SET display_order = 0 WHERE slug = 'free';
UPDATE subscription_plans SET display_order = 1 WHERE slug = 'basic';
UPDATE subscription_plans SET display_order = 2 WHERE slug = 'pro';
UPDATE subscription_plans SET display_order = 3 WHERE slug = 'ultimate';

-- 4. 确保 ultimate 是 popular
UPDATE subscription_plans SET is_popular = true, badge_text = 'MOST POPULAR' WHERE slug = 'ultimate';
UPDATE subscription_plans SET is_popular = false WHERE slug != 'ultimate';

-- 5. 验证结果
-- SELECT slug, name, display_order, is_popular FROM subscription_plans ORDER BY display_order;
