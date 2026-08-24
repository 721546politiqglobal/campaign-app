-- supabase/migrations/038_content_items_publishing_status.sql

-- The 'publishing' status has been part of the TypeScript domain model
-- (ContentStatus, ContentLifecycle's TRANSITIONS map) since content_items
-- gained the cron-based scheduled-publish flow, but the original check
-- constraint from 001_init.sql was never updated to allow it. This made the
-- cron's atomic claim step (scheduled -> publishing) fail on every single
-- run, silently — the route swallows the update error and just skips the
-- item — so no content scheduled for later has ever actually been published
-- via the cron. Verified live against a real scheduled item.
alter table content_items drop constraint if exists content_items_status_check;
alter table content_items add constraint content_items_status_check
  check (status in ('draft','in_review','approved','scheduled','publishing','published','rejected','archived'));
