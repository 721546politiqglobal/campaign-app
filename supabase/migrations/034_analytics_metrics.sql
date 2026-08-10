-- supabase/migrations/034_analytics_metrics.sql

-- Ayrshare returns a post id per platform on successful publish; capturing it
-- lets us later ask Ayrshare for that specific post's analytics.
alter table content_items
  add column if not exists ayrshare_post_ids jsonb not null default '{}'::jsonb;

create table if not exists post_metrics (
  id              text primary key default gen_random_uuid()::text,
  campaign_id     text not null references campaigns(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  platform        text not null,
  captured_on     date not null default current_date,
  impressions     integer not null default 0,
  reach           integer not null default 0,
  likes           integer not null default 0,
  comments        integer not null default 0,
  shares          integer not null default 0,
  saves           integer not null default 0,
  video_views     integer not null default 0,
  video_avg_watch_seconds numeric not null default 0,
  created_at      timestamptz not null default now(),
  unique (content_item_id, platform, captured_on)
);

create table if not exists insight_snapshots (
  id              text primary key default gen_random_uuid()::text,
  campaign_id     text not null references campaigns(id) on delete cascade,
  generated_at    timestamptz not null default now(),
  summary         text not null,
  recommendations text[] not null default '{}'
);

create index if not exists idx_post_metrics_campaign on post_metrics(campaign_id, captured_on);
create index if not exists idx_insight_campaign on insight_snapshots(campaign_id, generated_at desc);

alter table post_metrics      enable row level security;
alter table insight_snapshots enable row level security;

create policy campaign_scope_select on post_metrics
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on insight_snapshots
  for select using (campaign_id = auth_campaign_id());
