-- supabase/migrations/032_feature_usage_counters_rls.sql
-- feature_usage_counters (029) was added after 026_rls.sql and so shipped with
-- RLS off — leaving quota state readable and writable by anyone holding the
-- anon/public key (cross-tenant usage visibility, and the ability to zero out
-- your own counters to bypass every per-feature limit).
--
-- Same shape as 026_rls.sql: the app uses the SERVICE ROLE key and bypasses RLS,
-- so this changes no app behavior. It makes the auto-generated PostgREST API
-- default-deny and declares the campaign scoping that becomes enforcing if end
-- users are ever authenticated via Supabase Auth JWTs carrying a `campaign_id`
-- claim. auth_campaign_id() is defined in 026_rls.sql.
alter table feature_usage_counters enable row level security;

create policy campaign_scope_select on feature_usage_counters
  for select using (campaign_id = auth_campaign_id());

-- Verify on a scratch DB (expect relrowsecurity = t):
--   select relname, relrowsecurity from pg_class where relname = 'feature_usage_counters';
