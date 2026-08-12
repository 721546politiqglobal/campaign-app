-- supabase/migrations/036_campaign_tags.sql
-- Freeform, admin-assigned labels for filtering the campaigns list (see
-- docs/superpowers/specs/2026-08-11-disclosures-billing-campaigns-design.md).
alter table campaigns add column if not exists tags text[] not null default '{}';
