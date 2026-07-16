-- supabase/migrations/018_referential_integrity.sql
-- DATA-18: close referential-integrity gaps without re-introducing the
-- DATA-12 delete-block problem.

-- 1. billing_events blocked campaign deletes (no ON DELETE, unlike siblings
--    which cascade). The column is nullable, so SET NULL is safe and keeps the
--    payload for post-mortem after a campaign is removed.
alter table billing_events
  drop constraint if exists billing_events_campaign_id_fkey;
alter table billing_events
  add constraint billing_events_campaign_id_fkey
  foreign key (campaign_id) references campaigns(id) on delete set null;

-- 2. audit_entries.actor_user_id is nullable — add a real FK with ON DELETE SET
--    NULL so the author reference is validated but never blocks a user delete.
--    NOTE: if audit_entries has actor_user_id values with no matching users row
--    (e.g. 'system' placeholders), null them first or this add will fail:
--      update audit_entries ae set actor_user_id = null
--      where actor_user_id is not null
--        and not exists (select 1 from users u where u.id = ae.actor_user_id);
alter table audit_entries
  add constraint audit_entries_actor_user_id_fkey
  foreign key (actor_user_id) references users(id) on delete set null;

-- NOTE: content_items.created_by, approval_records.approver_user_id, and
-- invite_codes.created_by are NOT NULL. A blocking FK there would re-create the
-- silent-delete-block this audit is fixing (DATA-12), and SET NULL is
-- impossible on a NOT-NULL column. They are intentionally left as text; treat
-- them as historical author snapshots, not live FKs.

-- Verify (expect both confdeltype = 'n'):
--   select conname, confdeltype from pg_constraint
--   where conname in ('billing_events_campaign_id_fkey','audit_entries_actor_user_id_fkey');
