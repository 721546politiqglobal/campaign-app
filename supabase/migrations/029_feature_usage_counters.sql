create table if not exists feature_usage_counters (
  campaign_id   text not null references campaigns(id) on delete cascade,
  feature       text not null check (feature in ('content', 'video')),
  period_start  timestamptz not null, -- start-of-billing-period for 'content', start-of-day (UTC) for 'video'
  count         integer not null default 0,
  primary key (campaign_id, feature, period_start)
);

-- Atomic check-and-increment, mirroring reserve_usage's advisory-lock pattern
-- (013_atomic_usage_guard.sql) but without dollar math — just a bounded counter.
create or replace function increment_feature_usage(
  p_campaign_id text,
  p_feature text,
  p_period_start timestamptz,
  p_limit integer -- null = unlimited, always succeeds
) returns boolean
language plpgsql
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id || ':' || p_feature, 0));

  insert into feature_usage_counters (campaign_id, feature, period_start, count)
  values (p_campaign_id, p_feature, p_period_start, 0)
  on conflict (campaign_id, feature, period_start) do nothing;

  select count into v_count
  from feature_usage_counters
  where campaign_id = p_campaign_id and feature = p_feature and period_start = p_period_start;

  if p_limit is not null and v_count >= p_limit then
    return false;
  end if;

  update feature_usage_counters
  set count = count + 1
  where campaign_id = p_campaign_id and feature = p_feature and period_start = p_period_start;

  return true;
end;
$$;
