-- pgTAP test for the reserve_usage cap guard (TEST-7).
-- Run with: supabase test db   (or pg_prove against a scratch DB with migrations applied).
-- NOT part of the Vitest suite or the default CI job (CI has no Postgres).
--
-- NOTE: after migration 019 (finalize_usage) / 022 (billing_period_window),
-- reserve_usage RETURNS TEXT — the reservation id (non-null) on success, NULL
-- when the request would exceed the cap. These assertions reflect that shape.

begin;
select plan(5);

-- Isolate: work in a campaign id no seed data uses. Give it a subscription-less
-- window (falls back to the UTC calendar month in migration 022).
delete from usage_events where campaign_id = 'test-cap';

-- 1. A reservation that fits under the cap returns a non-null id.
select isnt( reserve_usage('test-cap', 1000, 400), null,
  'reserve returns a reservation id when 400 fits under the 1000 cap' );

-- 2. That reservation is now counted; a second one that would exceed returns null.
select is( reserve_usage('test-cap', 1000, 700), null,
  'reserve returns null when 400 (in-flight) + 700 exceeds the 1000 cap' );

-- 3. A second reservation that still fits alongside the first returns an id.
select isnt( reserve_usage('test-cap', 1000, 500), null,
  'reserve returns an id when 400 + 500 stays within 1000' );

-- 4. Exactly hitting the cap is allowed (> comparison, not >=).
delete from usage_events where campaign_id = 'test-cap';
select isnt( reserve_usage('test-cap', 1000, 1000), null,
  'reserve allows a request that exactly equals the cap' );

-- 5. An abandoned _reserved row older than 5 minutes is excluded from the total.
delete from usage_events where campaign_id = 'test-cap';
insert into usage_events (campaign_id, kind, cost_cents, created_at)
  values ('test-cap', '_reserved', 900, now() - interval '10 minutes');
select isnt( reserve_usage('test-cap', 1000, 800), null,
  'a _reserved row older than 5 minutes does not count against the cap' );

select * from finish();
rollback;
