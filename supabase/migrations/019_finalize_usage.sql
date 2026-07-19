-- supabase/migrations/019_finalize_usage.sql
-- Atomic usage finalize keyed on the reservation id (BILL-13). Previously
-- UsageMeter.finalize() (repos.ts) matched the _reserved row by cost_cents and
-- did delete-then-insert as two separate statements: an equal-cost race could
-- release the wrong reservation, and a crash between the two lost the spend.
-- reserve_usage now RETURNS the id of the row it inserts; finalize_usage
-- deletes exactly that row and records the real spend in one transaction.
--
-- NOTE (numbering): the data-integrity plan already created 015-018; this
-- billing migration is 019. Migration 020 (billing-period window) re-defines
-- reserve_usage and MUST preserve this `returns text` / reservation-id shape.

create or replace function reserve_usage(
  p_campaign_id text,
  p_cap_cents integer,
  p_cost_cents integer
) returns text
language plpgsql
as $$
declare
  v_used integer;
  v_month_start timestamptz := date_trunc('month', now());
  v_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id, 0));

  select coalesce(sum(cost_cents), 0) into v_used
  from usage_events
  where campaign_id = p_campaign_id
    and created_at >= v_month_start
    and (kind <> '_reserved' or created_at >= now() - interval '5 minutes');

  if v_used + p_cost_cents > p_cap_cents then
    return null;
  end if;

  insert into usage_events (campaign_id, kind, cost_cents)
  values (p_campaign_id, '_reserved', p_cost_cents)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function finalize_usage(
  p_reservation_id text,
  p_kind text,
  p_cost_cents integer
) returns void
language plpgsql
as $$
declare v_campaign_id text;
begin
  -- Delete the exact reservation and capture its campaign in one shot; if it's
  -- already gone (double-finalize), do nothing — this is idempotent.
  delete from usage_events
   where id = p_reservation_id and kind = '_reserved'
   returning campaign_id into v_campaign_id;

  if v_campaign_id is not null and p_cost_cents > 0 then
    insert into usage_events (campaign_id, kind, cost_cents)
    values (v_campaign_id, p_kind, p_cost_cents);
  end if;
end;
$$;
