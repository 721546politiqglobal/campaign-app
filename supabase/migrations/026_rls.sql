-- supabase/migrations/026_rls.sql
-- Defense-in-depth RLS (SEC-7).
--
-- The application uses the Supabase SERVICE ROLE key, which BYPASSES RLS —
-- so none of the policies below affect app behavior. Their purpose is to make
-- the auto-generated PostgREST API (reachable with the anon/public key)
-- default-deny, and to define the campaign-scoping that becomes enforcing if
-- the app ever authenticates end users via Supabase Auth JWTs carrying a
-- `campaign_id` claim. Until then these tables are simply closed to non-service
-- callers.
--
-- Helper: the campaign id asserted by the caller's JWT (NULL for anon / service
-- role). Kept in one place so the per-table policies read cleanly.
create or replace function auth_campaign_id() returns text
  language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'campaign_id', '')
  $$;

-- ── Enable RLS everywhere ────────────────────────────────────────────────────
alter table campaigns           enable row level security;
alter table users               enable row level security;
alter table content_items       enable row level security;
alter table approval_records    enable row level security;
alter table disclosure_records  enable row level security;
alter table audit_entries       enable row level security;
alter table monitoring_results  enable row level security;
alter table usage_events        enable row level security;
alter table candidate_profiles  enable row level security;
alter table avatars             enable row level security;
alter table billing_events      enable row level security;
alter table usage_sync_cursor   enable row level security;
alter table disclosure_rules    enable row level security;
alter table billing_plans       enable row level security;
alter table login_attempts      enable row level security;

-- ── Campaign-scoped read policies (columns named campaign_id) ────────────────
create policy campaign_scope_select on campaigns
  for select using (id = auth_campaign_id());
create policy campaign_scope_select on users
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on content_items
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on approval_records
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on disclosure_records
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on audit_entries
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on monitoring_results
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on usage_events
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on candidate_profiles
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on avatars
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on billing_events
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on usage_sync_cursor
  for select using (campaign_id = auth_campaign_id());

-- ── Global reference tables: readable by any authenticated caller ───────────
create policy ref_read on disclosure_rules
  for select to authenticated using (true);
create policy ref_read on billing_plans
  for select to authenticated using (true);

-- ── login_attempts: RLS on, zero policies → fully closed to non-service callers.

-- Verify on a scratch DB (expect relrowsecurity = t for every listed table):
--   select relname, relrowsecurity from pg_class where relname in (
--     'campaigns','users','content_items','approval_records','disclosure_records',
--     'audit_entries','monitoring_results','usage_events','candidate_profiles',
--     'avatars','billing_events','usage_sync_cursor','disclosure_rules',
--     'billing_plans','login_attempts') order by relname;
