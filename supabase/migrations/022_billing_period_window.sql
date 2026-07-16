-- supabase/migrations/022_billing_period_window.sql
-- Window the cap guard on the Stripe billing period instead of the calendar
-- month (BILL-11 / UX-1). Reads campaigns.current_period_end so the DB and the
-- app (src/lib/billing-period.ts) compute the identical window. PRESERVES the
-- reservation-id return introduced in 019_finalize_usage.sql (returns text).
create or replace function reserve_usage(
  p_campaign_id text,
  p_cap_cents integer,
  p_cost_cents integer
) returns text
language plpgsql
as $$
declare
  v_used integer;
  v_period_end timestamptz;
  v_window_start timestamptz;
  v_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id, 0));

  select current_period_end into v_period_end from campaigns where id = p_campaign_id;
  -- Billing period start, or UTC month start when there's no subscription.
  v_window_start := coalesce(v_period_end - interval '1 month', date_trunc('month', now() at time zone 'UTC'));

  select coalesce(sum(cost_cents), 0) into v_used
  from usage_events
  where campaign_id = p_campaign_id
    and created_at >= v_window_start
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
