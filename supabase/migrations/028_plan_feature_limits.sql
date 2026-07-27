-- supabase/migrations/028_plan_feature_limits.sql
-- Replaces dollar-based plan allowances with concrete per-feature counts
-- (see docs/superpowers/specs/2026-07-27-self-serve-billing-design.md).
--
-- DEPLOY ORDER: Apply this migration BEFORE deploying application code that
-- reads avatar_limit/content_limit_monthly/video_limit_daily. If the code ships
-- first, the columns don't exist, toBillingPlan maps every limit to null, and
-- null silently means "no limit configured" — so every plan is either
-- unlimited or blocked depending on the gate. Either way it is silently wrong.
alter table billing_plans
  add column if not exists avatar_limit integer,          -- null = unlimited
  add column if not exists content_limit_monthly integer, -- null = unlimited
  add column if not exists video_limit_daily integer;      -- null = unlimited

update billing_plans set avatar_limit = 2,  content_limit_monthly = 15,   video_limit_daily = 1  where id = 'starter';
update billing_plans set avatar_limit = 5,  content_limit_monthly = 50,   video_limit_daily = 3  where id = 'pro';
update billing_plans set avatar_limit = 20, content_limit_monthly = null, video_limit_daily = 10 where id = 'enterprise';

alter table billing_plans
  drop column if exists included_usage_cents,
  drop column if exists overage_multiplier,
  drop column if exists stripe_metered_price_id;
