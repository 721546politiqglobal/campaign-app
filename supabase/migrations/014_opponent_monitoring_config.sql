-- supabase/migrations/014_opponent_monitoring_config.sql
-- Per-campaign opponent monitoring config, so the opposition-monitoring
-- workflow can loop over all active campaigns instead of one hardcoded id.

alter table candidate_profiles
  add column if not exists opponent_aliases            text[] not null default '{}',
  add column if not exists monitoring_keywords          text[] not null default '{}',
  add column if not exists opponent_twitter_handle      text,
  add column if not exists opponent_instagram_handle    text,
  add column if not exists opponent_facebook_page       text,
  add column if not exists google_alerts_rss_url        text;
