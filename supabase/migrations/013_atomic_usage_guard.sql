-- supabase/migrations/013_atomic_usage_guard.sql
-- Usage cap enforcement was check-then-act at the application layer (SELECT
-- sum(...) in UsageMeter.guard, followed later by a separate INSERT in
-- record()) with no lock tying the two together. Concurrent requests near the
-- cap boundary could all read the same pre-insert total, all pass the check,
-- and all record afterward — spend could exceed the cap by up to N x the
-- per-request cost. This function makes the check-and-reserve atomic per
-- campaign via a transaction-scoped advisory lock, so only one concurrent
-- caller can be evaluating "would this fit under the cap?" for a given
-- campaign at a time.
--
-- Reservations are inserted as a `_reserved` kind with the estimated cost and
-- are meant to be short-lived — UsageMeter.record() finalizes (deletes the
-- reservation, inserts the real kind/cost) immediately after the paid work
-- completes. A reservation older than 5 minutes (e.g. the process crashed
-- before finalizing) is treated as abandoned and excluded from the running
-- total, so it can't permanently eat into a campaign's cap headroom.
create or replace function reserve_usage(
  p_campaign_id text,
  p_cap_cents integer,
  p_cost_cents integer
) returns boolean
language plpgsql
as $$
declare
  v_used integer;
  v_month_start timestamptz := date_trunc('month', now());
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id, 0));

  select coalesce(sum(cost_cents), 0) into v_used
  from usage_events
  where campaign_id = p_campaign_id
    and created_at >= v_month_start
    and (kind <> '_reserved' or created_at >= now() - interval '5 minutes');

  if v_used + p_cost_cents > p_cap_cents then
    return false;
  end if;

  insert into usage_events (campaign_id, kind, cost_cents)
  values (p_campaign_id, '_reserved', p_cost_cents);

  return true;
end;
$$;
