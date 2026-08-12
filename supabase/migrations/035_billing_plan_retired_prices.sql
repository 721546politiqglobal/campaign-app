-- Tracks Stripe price ids a plan edit has archived, so the Stripe webhook can
-- still resolve a subscription/checkout that was created against an old price
-- before it was rotated out — see final review of
-- docs/superpowers/plans/2026-08-11-editable-billing-catalog-weekly-plans.md.
alter table billing_plans add column if not exists retired_stripe_price_ids text[] not null default '{}';
