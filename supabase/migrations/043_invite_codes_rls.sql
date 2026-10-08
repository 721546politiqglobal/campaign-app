-- supabase/migrations/043_invite_codes_rls.sql
-- invite_codes (003_auth.sql) is the only table that never had RLS enabled —
-- 026_rls.sql missed it. With Supabase's default grants that leaves it
-- readable AND writable through PostgREST by anyone holding the public
-- anon/publishable key (which ships to the browser): they could list live
-- invite codes, or insert a code with role = 'owner' for any campaign and then
-- redeem it through joinAction — a full campaign takeover.
--
-- Same shape as 026/032: the app uses the SERVICE ROLE key and bypasses RLS,
-- so this changes no app behavior. Deliberately NO select policy, not even a
-- campaign-scoped one: a code is a bearer credential, so no non-service caller
-- should ever read it.
alter table invite_codes enable row level security;

-- Belt and braces: drop the default table grants to the public roles too.
revoke all on table invite_codes from anon, authenticated;

-- Verify (expect relrowsecurity = t, and zero rows from the anon probe):
--   select relname, relrowsecurity from pg_class where relname = 'invite_codes';
--   curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/invite_codes?select=code" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
