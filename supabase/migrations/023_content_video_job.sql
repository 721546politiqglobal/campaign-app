-- supabase/migrations/023_content_video_job.sql
-- Persist the in-flight HeyGen video job on the content row so a page refresh
-- can resume polling instead of orphaning a paid ($50) generation and letting
-- the user regenerate (INT-5). Nullable / no default: existing rows unaffected.
alter table content_items
  add column if not exists video_job_id text,
  add column if not exists video_status text
    check (video_status is null or video_status in ('processing', 'completed', 'failed'));
