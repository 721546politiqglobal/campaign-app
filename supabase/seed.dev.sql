-- ═══════════════════════════════════════════════════════════════════════════
-- DEV / LOCAL SEED ONLY — DO NOT RUN AGAINST PRODUCTION.
-- ═══════════════════════════════════════════════════════════════════════════
-- Provides demo campaigns, users, content, monitoring, and usage, plus login
-- credentials (password: changeme123) so the app is usable locally out of the
-- box. Running this in production would create known-credential accounts and
-- pollute usage/statistics.
--
-- Apply locally AFTER the migrations:
--   psql "$LOCAL_DB_URL" -f supabase/seed.dev.sql
-- Requires the pgcrypto extension (created by migration 003).

-- ── Demo campaign 1 ──────────────────────────────────────────────────────────
insert into campaigns (id, name, jurisdictions, monthly_cost_cap_cents)
values ('camp-1', 'Rivera for Assembly — District 12', array['US-FEDERAL','US-CA'], 100000)
on conflict (id) do nothing;

insert into users (id, campaign_id, name, role)
values ('u-alex', 'camp-1', 'Alex Rivera', 'owner')
on conflict (id) do nothing;

insert into content_items
  (id, campaign_id, type, title, body, status, is_ai_generated, target_jurisdictions, created_by)
values
  ('ct-1','camp-1','reel','Healthcare plan reel',
   'A 30-second reel explaining how our healthcare plan lowers premiums.',
   'in_review', true, array['US-FEDERAL','US-CA'], 'u-alex'),
  ('ct-2','camp-1','social_post','Town hall recap',
   'Thanks to everyone who came out last night. Here''s what we heard.',
   'approved', true, array['US-FEDERAL','US-CA'], 'u-alex'),
  ('ct-3','camp-1','press_release','Response on transit funding',
   'Statement on the new transit funding proposal.',
   'draft', true, array['US-FEDERAL','US-CA'], 'u-alex'),
  ('ct-4','camp-1','social_post','Volunteer thank-you',
   'Our volunteers knocked 4,000 doors this weekend.',
   'published', false, array['US-FEDERAL','US-CA'], 'u-alex')
on conflict (id) do nothing;

insert into approval_records (content_item_id, campaign_id, approver_user_id, decision)
values ('ct-2','camp-1','u-alex','approve')
on conflict do nothing;

insert into monitoring_results (campaign_id, source, opponent, excerpt, url)
values
  ('camp-1','NewsData','Opponent campaign',
   'Opponent announced a new position on transit funding at a press event.',
   'https://example.com/news/transit'),
  ('camp-1','GDELT','Opponent campaign',
   'Local coverage compares the two candidates'' healthcare proposals.',
   'https://example.com/news/healthcare')
on conflict do nothing;

insert into usage_events (campaign_id, kind, cost_cents)
values
  ('camp-1','video_minutes', 4200),
  ('camp-1','llm_tokens', 900)
on conflict do nothing;

-- ── Demo campaign 2 ──────────────────────────────────────────────────────────
insert into campaigns (id, name, jurisdictions, monthly_cost_cap_cents)
values ('camp-2', 'Johnson for Senate — State', array['US-FEDERAL','US-TX'], 250000)
on conflict (id) do nothing;

insert into users (id, campaign_id, name, role)
values
  ('u-sarah', 'camp-2', 'Sarah Johnson', 'owner'),
  ('u-mike',  'camp-2', 'Mike Torres',   'manager')
on conflict (id) do nothing;

insert into content_items
  (id, campaign_id, type, title, body, status, is_ai_generated, target_jurisdictions, created_by)
values
  ('ct-10','camp-2','social_post','Education funding bill support',
   'Proud to support the education funding bill that will benefit 200,000 Texas students.',
   'in_review', true, array['US-FEDERAL','US-TX'], 'u-sarah'),
  ('ct-11','camp-2','press_release','Response to debate challenge',
   'Senator Johnson welcomes the opportunity to debate on public education.',
   'approved', false, array['US-FEDERAL','US-TX'], 'u-mike')
on conflict (id) do nothing;

insert into monitoring_results (campaign_id, source, opponent, excerpt, url)
values
  ('camp-2','NewsData','Opponent campaign',
   'Opponent challenges Senator Johnson on education funding record.',
   'https://example.com/news/education'),
  ('camp-2','GDELT','Opponent campaign',
   'State media covers debate scheduling dispute between candidates.',
   'https://example.com/news/debate')
on conflict do nothing;

insert into usage_events (campaign_id, kind, cost_cents)
values
  ('camp-2','llm_tokens', 1800),
  ('camp-2','video_minutes', 9500)
on conflict do nothing;

-- ── Super-admin (dev) ────────────────────────────────────────────────────────
insert into users (id, campaign_id, name, role)
values ('u-admin', null, 'Super Admin', 'super_admin')
on conflict (id) do nothing;

-- ── Dev login credentials (password: changeme123) ────────────────────────────
update users set email = 'admin@commandcenter.local', password_hash = crypt('changeme123', gen_salt('bf', 10)) where id = 'u-admin' and password_hash is null;
update users set email = 'alex@example.com',           password_hash = crypt('changeme123', gen_salt('bf', 10)) where id = 'u-alex'  and password_hash is null;
update users set email = 'sarah@example.com',          password_hash = crypt('changeme123', gen_salt('bf', 10)) where id = 'u-sarah' and password_hash is null;
update users set email = 'mike@example.com',           password_hash = crypt('changeme123', gen_salt('bf', 10)) where id = 'u-mike'  and password_hash is null;
