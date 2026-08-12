-- supabase/migrations/034_billing_plan_interval.sql
-- Lets a plan bill weekly instead of only monthly (campaigns run shorter
-- cycles than a typical SaaS subscription) — see
-- docs/superpowers/specs/2026-08-11-disclosures-billing-campaigns-design.md.
alter table billing_plans
  add column if not exists billing_interval text not null default 'month'
    check (billing_interval in ('week', 'month'));
