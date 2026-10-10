-- ═══════════════════════════════════════════════════════════════════════════
-- E2E SEED — applied by e2e/reset-db.ts against the E2E Supabase project only.
-- IDs / emails / codes mirror e2e/helpers/users.ts — keep the two in sync.
-- All seeded users share the password 'e2e-pass-123' (bcrypt, cost 10).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── Billing plans (mirror src/lib/billing-catalog.ts; monthly interval) ──────
insert into billing_plans
  (id, name, monthly_price_cents, seat_limit, avatar_limit, content_limit_monthly, video_limit_daily,
   stripe_product_id, stripe_flat_price_id, billing_interval, is_active)
values
  ('starter',    'Starter',    4900,  3,    2,  15,   1,  'prod_e2e_starter',    'price_e2e_starter_month',    'month', true),
  ('pro',        'Pro',        14900, 10,   5,  50,   3,  'prod_e2e_pro',        'price_e2e_pro_month',        'month', true),
  ('enterprise', 'Enterprise', 49900, null, 20, null, 10, 'prod_e2e_enterprise', 'price_e2e_enterprise_month', 'month', true);

-- ── Campaigns ────────────────────────────────────────────────────────────────
-- A: top paid plan, active subscription, default disclosure, an Ayrshare
-- profile with x + facebook connected (so the publish cron can post).
insert into campaigns
  (id, name, jurisdictions, plan_id, stripe_customer_id, stripe_subscription_id, subscription_status,
   current_period_end, default_disclosure_text,
   ayrshare_profile_key, ayrshare_ref_id, social_accounts, social_synced_at)
values
  ('e2e-camp-a', 'E2E Campaign A', array['US-FEDERAL','US-CA'], 'enterprise', 'cus_e2e_a', 'sub_e2e_a', 'active',
   now() + interval '20 days', 'Paid for by E2E Campaign A.',
   'e2e-profile-a', 'ref-e2e-a',
   '[{"platform":"x","name":"E2E Campaign A","handle":"@e2e_camp_a","profileUrl":null,"avatarUrl":null,"refreshRequired":false},
     {"platform":"facebook","name":"E2E Campaign A","handle":null,"profileUrl":null,"avatarUrl":null,"refreshRequired":false}]'::jsonb,
   now());

-- B: no plan, no subscription, no social profile.
insert into campaigns (id, name, jurisdictions)
values ('e2e-camp-b', 'E2E Campaign B', array['US-TX']);

-- ── Users (app-managed auth: public.users + bcrypt) ──────────────────────────
insert into users (id, campaign_id, name, role, email, password_hash, locale)
values
  ('e2e-owner-a',    'e2e-camp-a', 'Olivia Owner',  'owner',       'owner-a@e2e.test',    crypt('e2e-pass-123', gen_salt('bf', 10)), 'en'),
  ('e2e-manager-a',  'e2e-camp-a', 'Marco Manager', 'manager',     'manager-a@e2e.test',  crypt('e2e-pass-123', gen_salt('bf', 10)), 'en'),
  ('e2e-approver-a', 'e2e-camp-a', 'Ava Approver',  'approver',    'approver-a@e2e.test', crypt('e2e-pass-123', gen_salt('bf', 10)), 'en'),
  ('e2e-staff-a',    'e2e-camp-a', 'Sam Staff',     'staff',       'staff-a@e2e.test',    crypt('e2e-pass-123', gen_salt('bf', 10)), 'en'),
  ('e2e-staff-es-a', 'e2e-camp-a', 'Sofía Staff',   'staff',       'staff-es@e2e.test',   crypt('e2e-pass-123', gen_salt('bf', 10)), 'es'),
  ('e2e-owner-b',    'e2e-camp-b', 'Ben Owner',     'owner',       'owner-b@e2e.test',    crypt('e2e-pass-123', gen_salt('bf', 10)), 'en'),
  ('e2e-admin',      null,         'E2E Admin',     'super_admin', 'admin-e2e@e2e.test',  crypt('e2e-pass-123', gen_salt('bf', 10)), 'en'),
  -- AUTH_ONLY: reserved for auth.spec (throttle / logout), never storageState.
  ('e2e-throttle',   'e2e-camp-a', 'Throttle User', 'staff',       'throttle@e2e.test',   crypt('e2e-pass-123', gen_salt('bf', 10)), 'en'),
  ('e2e-logout',     'e2e-camp-a', 'Logout User',   'staff',       'logout@e2e.test',     crypt('e2e-pass-123', gen_salt('bf', 10)), 'en');

-- ── Invite codes ─────────────────────────────────────────────────────────────
insert into invite_codes (code, campaign_id, role, created_by, expires_at, used_by, used_at)
values
  ('E2E-VALID-1',   'e2e-camp-a', 'staff', 'e2e-owner-a', now() + interval '7 days', null,            null),
  ('E2E-USED-1',    'e2e-camp-a', 'staff', 'e2e-owner-a', now() + interval '7 days', 'e2e-staff-a',   now() - interval '1 day'),
  ('E2E-EXPIRED-1', 'e2e-camp-a', 'staff', 'e2e-owner-a', now() - interval '1 day',  null,            null),
  ('E2E-VALID-2',   'e2e-camp-b', 'staff', 'e2e-owner-b', now() + interval '7 days', null,            null);

-- ── Avatars (inserted before candidate profiles: active_avatar_id FK) ────────
insert into avatars
  (id, campaign_id, name, status, heygen_group_id, heygen_look_id, source_photo_urls, source_type,
   consent_confirmed_by, created_by)
values
  ('e2e-avatar-a', 'e2e-camp-a', 'Olivia Avatar',  'ready', 'hg-group-e2e-a', 'hg-look-e2e-a',
   array['https://example.com/e2e/avatar-a.jpg'], 'photo', 'e2e-owner-a', 'e2e-owner-a'),
  ('e2e-avatar-b', 'e2e-camp-b', 'B-ONLY-avatar',  'ready', 'hg-group-e2e-b', 'hg-look-e2e-b',
   array['https://example.com/e2e/avatar-b.jpg'], 'photo', 'e2e-owner-b', 'e2e-owner-b');

-- ── Candidate profile (A only) ───────────────────────────────────────────────
insert into candidate_profiles
  (id, campaign_id, full_name, preferred_name, office, district, party, bio, key_positions,
   voice_tone, target_audience, tagline, opponent_name, opponent_aliases, monitoring_keywords,
   active_avatar_id, content_locale)
values
  ('e2e-profile-a', 'e2e-camp-a', 'Olivia Example', 'Olivia', 'State Assembly', 'District 12', 'Independent',
   'Olivia Example is a test candidate seeded for end-to-end tests.',
   array['Affordable housing','Public transit','Clean water'],
   'conversational', 'Working families in District 12', 'Building a better District 12', 'Pat Opponent',
   array['P. Opponent'], array['transit','housing'],
   'e2e-avatar-a', 'en');

-- ── Content: campaign A, one per lifecycle state ─────────────────────────────
insert into content_items
  (id, campaign_id, type, title, body, status, is_ai_generated, target_jurisdictions, created_by,
   scheduled_at, platforms, ayrshare_post_ids)
values
  ('e2e-c-draft',        'e2e-camp-a', 'social_post', 'E2E Draft post',
   'Draft body for end-to-end tests.', 'draft', true, array['US-FEDERAL','US-CA'], 'e2e-staff-a',
   null, array['x'], '{}'::jsonb),
  ('e2e-c-review',       'e2e-camp-a', 'social_post', 'E2E In-review post',
   'In-review body for end-to-end tests.', 'in_review', true, array['US-FEDERAL','US-CA'], 'e2e-staff-a',
   null, array['x'], '{}'::jsonb),
  ('e2e-c-approved',     'e2e-camp-a', 'social_post', 'E2E Approved post',
   'Approved body for end-to-end tests.', 'approved', true, array['US-FEDERAL','US-CA'], 'e2e-staff-a',
   null, array['x','facebook'], '{}'::jsonb),
  ('e2e-c-sched-due',    'e2e-camp-a', 'social_post', 'E2E Scheduled (due) post',
   'Scheduled-due body for end-to-end tests.', 'scheduled', true, array['US-FEDERAL','US-CA'], 'e2e-staff-a',
   now() - interval '5 minutes', array['x','facebook'], '{}'::jsonb),
  ('e2e-c-sched-future', 'e2e-camp-a', 'social_post', 'E2E Scheduled (future) post',
   'Scheduled-future body for end-to-end tests.', 'scheduled', true, array['US-FEDERAL','US-CA'], 'e2e-staff-a',
   now() + interval '7 days', array['x','facebook'], '{}'::jsonb),
  ('e2e-c-published',    'e2e-camp-a', 'social_post', 'E2E Published post',
   'Published body for end-to-end tests.', 'published', true, array['US-FEDERAL','US-CA'], 'e2e-staff-a',
   now() - interval '7 days', array['x','facebook'], '{"x":"post-e2e-x","facebook":"post-e2e-fb"}'::jsonb);

-- Campaign B content (must never leak into A).
insert into content_items
  (id, campaign_id, type, title, body, status, is_ai_generated, target_jurisdictions, created_by, platforms)
values
  ('e2e-c-b-1', 'e2e-camp-b', 'social_post', 'B-ONLY-content',
   'B-ONLY-body for tenant isolation tests.', 'in_review', true, array['US-TX'], 'e2e-owner-b', array['x']);

-- ── Approval + disclosure records for items past review ──────────────────────
insert into approval_records (id, content_item_id, campaign_id, approver_user_id, decision, note)
values
  ('e2e-appr-approved',  'e2e-c-approved',     'e2e-camp-a', 'e2e-approver-a', 'approve', null),
  ('e2e-appr-sched-due', 'e2e-c-sched-due',    'e2e-camp-a', 'e2e-approver-a', 'approve', null),
  ('e2e-appr-sched-fut', 'e2e-c-sched-future', 'e2e-camp-a', 'e2e-approver-a', 'approve', null),
  ('e2e-appr-published', 'e2e-c-published',    'e2e-camp-a', 'e2e-approver-a', 'approve', null);

insert into disclosure_records (id, content_item_id, campaign_id, jurisdiction, disclosure_text, placement)
select 'e2e-disc-' || ci.id || '-' || lower(j.jur), ci.id, 'e2e-camp-a', j.jur,
       coalesce(dr.required_text, 'This content was created with the help of AI.'), dr.placement
from (values ('e2e-c-approved'), ('e2e-c-sched-due'), ('e2e-c-sched-future'), ('e2e-c-published')) as ci(id)
cross join (values ('US-FEDERAL'), ('US-CA')) as j(jur)
join disclosure_rules dr on dr.jurisdiction = j.jur;

-- ── Monitoring ───────────────────────────────────────────────────────────────
-- A: three items. 'https://news.e2e.test/a/duplicate-candidate' is the
-- dedupe candidate — re-ingesting that URL for campaign A must not add a row
-- (unique (campaign_id, url), migration 017).
insert into monitoring_results (id, campaign_id, source, opponent, excerpt, url, credibility, category, captured_at)
values
  ('e2e-mon-a-1', 'e2e-camp-a', 'NewsData', 'Pat Opponent',
   'Pat Opponent announced a new transit position at a press event.',
   'https://news.e2e.test/a/transit', 'high', 'news', now() - interval '1 hour'),
  ('e2e-mon-a-2', 'e2e-camp-a', 'GDELT', 'Pat Opponent',
   'Local coverage compares the two candidates on housing.',
   'https://news.e2e.test/a/housing', 'medium', 'news', now() - interval '2 hours'),
  ('e2e-mon-a-dup', 'e2e-camp-a', 'Google Alerts', 'Pat Opponent',
   'Opinion blog discusses Pat Opponent water policy.',
   'https://news.e2e.test/a/duplicate-candidate', 'low', 'blog', now() - interval '3 hours');

insert into monitoring_results (id, campaign_id, source, opponent, excerpt, url, credibility, category)
values
  ('e2e-mon-b-1', 'e2e-camp-b', 'NewsData', 'B-ONLY-opponent',
   'B-ONLY-monitoring excerpt for tenant isolation tests.',
   'https://news.e2e.test/b/only', 'medium', 'news');

-- ── Analytics: 7 days of metrics for the published item (x + facebook) ───────
insert into post_metrics
  (campaign_id, content_item_id, platform, captured_on, impressions, reach, likes, comments, shares, saves)
select 'e2e-camp-a', 'e2e-c-published', p.platform, current_date - d,
       1000 + d * 100 + p.bump, 800 + d * 80 + p.bump, 50 + d * 5, 10 + d, 5 + d, 2 + d
from generate_series(0, 6) as d
cross join (values ('x', 0), ('facebook', 37)) as p(platform, bump);

commit;
