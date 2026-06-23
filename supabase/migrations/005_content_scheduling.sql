-- supabase/migrations/005_content_scheduling.sql
alter table content_items
  add column if not exists scheduled_at  timestamptz,
  add column if not exists timezone      text not null default 'America/Los_Angeles',
  add column if not exists platforms     text[] not null default '{}';

create index if not exists content_items_scheduled_idx
  on content_items (scheduled_at)
  where status = 'scheduled' and scheduled_at is not null;
