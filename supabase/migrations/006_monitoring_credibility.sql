-- supabase/migrations/006_monitoring_credibility.sql
alter table monitoring_results
  add column if not exists credibility  text not null default 'medium'
    check (credibility in ('high', 'medium', 'low')),
  add column if not exists category     text not null default 'news'
    check (category in ('news', 'social', 'blog', 'press_release')),
  add column if not exists dismissed_at timestamptz;

create index if not exists monitoring_results_credibility_idx
  on monitoring_results (campaign_id, credibility, captured_at desc);
