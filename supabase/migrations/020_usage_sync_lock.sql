-- supabase/migrations/020_usage_sync_lock.sql
-- Single-flight guard for the usage-sync cron (BILL-4). Two overlapping runs
-- previously read the same cursor, computed different `until` values, built
-- different idempotency keys (buildSyncKey includes `until`), and both reported
-- the overlapping usage to Stripe — whose identifier dedup can't collapse two
-- different identifiers. A short TTL lease makes only one run active per
-- campaign at a time; the TTL auto-releases a lease orphaned by a crash.
alter table usage_sync_cursor
  add column if not exists sync_lock_until timestamptz;

create or replace function claim_usage_sync(p_campaign_id text, p_ttl_seconds integer default 300)
returns boolean
language plpgsql
as $$
declare v_rows integer;
begin
  insert into usage_sync_cursor (campaign_id, last_synced_at, sync_lock_until)
  values (p_campaign_id, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (campaign_id) do update
    set sync_lock_until = now() + make_interval(secs => p_ttl_seconds)
    where usage_sync_cursor.sync_lock_until is null
       or usage_sync_cursor.sync_lock_until < now();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function release_usage_sync(p_campaign_id text)
returns void
language plpgsql
as $$
begin
  update usage_sync_cursor set sync_lock_until = null where campaign_id = p_campaign_id;
end;
$$;
