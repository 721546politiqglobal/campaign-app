-- supabase/migrations/037_drop_campaign_monthly_cap.sql
-- monthly_cost_cap_cents was never enforced after migration 030 dropped the
-- cap-guard infrastructure (reserve_usage/finalize_usage) — it was only ever
-- displayed, and displayed misleadingly for campaigns with no plan/subscription
-- at all. Removing it outright rather than leaving a dead, confusing field.
alter table campaigns drop column if exists monthly_cost_cap_cents;
