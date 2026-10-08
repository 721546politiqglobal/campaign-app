-- supabase/migrations/044_campaign_social_profiles.sql
-- Per-campaign Ayrshare User Profile (spec: 2026-10-08-social-channels-design).
-- Before this, every campaign published through the single Ayrshare Primary
-- Profile — i.e. to the same social accounts.
--
-- ayrshare_profile_key is a credential (Ayrshare returns it only once, at
-- profile creation). It is read server-side only, with the service-role key.
-- RLS (026_rls.sql) does not protect it: campaign_scope_select is row-level,
-- not column-level. What keeps it out of reach today is that the app never
-- issues Supabase user JWTs (auth is a custom HMAC session cookie), so
-- campaign_scope_select never matches and anon/public callers get no campaign
-- rows. If Supabase Auth JWTs carrying a campaign_id claim are ever introduced,
-- this credential must first move to a table with no select policy.
alter table campaigns
  add column if not exists ayrshare_profile_key text,
  add column if not exists ayrshare_ref_id      text,
  -- Snapshot of the linked accounts (domain SocialAccount[]), refreshed from
  -- Ayrshare on /channels load and after linking; read by publish gating.
  add column if not exists social_accounts      jsonb not null default '[]'::jsonb,
  add column if not exists social_synced_at     timestamptz;
