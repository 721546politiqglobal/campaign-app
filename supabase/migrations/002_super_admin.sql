-- Super-admin role + user. Run this in your Supabase SQL editor after 001_init.sql.

-- Seed a second demo campaign so the admin panel has more than one row
INSERT INTO campaigns (id, name, jurisdictions, monthly_cost_cap_cents)
VALUES ('camp-2', 'Johnson for Senate — State', array['US-FEDERAL','US-TX'], 250000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, campaign_id, name, role)
VALUES
  ('u-sarah', 'camp-2', 'Sarah Johnson', 'owner'),
  ('u-mike',  'camp-2', 'Mike Torres',   'manager')
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_items
  (id, campaign_id, type, title, body, status, is_ai_generated, target_jurisdictions, created_by)
VALUES
  ('ct-10','camp-2','social_post','Education funding bill support',
   'Proud to support the education funding bill that will benefit 200,000 Texas students.',
   'in_review', true, array['US-FEDERAL','US-TX'], 'u-sarah'),
  ('ct-11','camp-2','press_release','Response to debate challenge',
   'Senator Johnson welcomes the opportunity to debate on public education.',
   'approved', false, array['US-FEDERAL','US-TX'], 'u-mike')
ON CONFLICT (id) DO NOTHING;

INSERT INTO monitoring_results (campaign_id, source, opponent, excerpt, url)
VALUES
  ('camp-2','NewsData','Opponent campaign',
   'Opponent challenges Senator Johnson on education funding record.',
   'https://example.com/news/education'),
  ('camp-2','GDELT','Opponent campaign',
   'State media covers debate scheduling dispute between candidates.',
   'https://example.com/news/debate')
ON CONFLICT DO NOTHING;

INSERT INTO usage_events (campaign_id, kind, cost_cents)
VALUES
  ('camp-2','llm_tokens', 1800),
  ('camp-2','video_minutes', 9500)
ON CONFLICT DO NOTHING;

-- 4. Insert the super admin user (no campaign)
INSERT INTO users (id, campaign_id, name, role)
VALUES ('u-admin', null, 'Super Admin', 'super_admin')
ON CONFLICT (id) DO NOTHING;
