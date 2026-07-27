-- supabase/migrations/031_decrement_feature_usage.sql
-- Release a feature-usage slot that was consumed by increment_feature_usage
-- (029_feature_usage_counters.sql) for work that never happened — e.g. the
-- HeyGen/ElevenLabs call failed after the counter was already incremented.
-- Without this, one provider 500 costs a Starter campaign its whole day of
-- video quota (video_limit_daily = 1).
--
-- Takes the same advisory lock as increment_feature_usage so a release can't
-- interleave with a concurrent check-and-increment, and floors at zero so a
-- double release (or a release against a row that no longer exists) is a no-op
-- rather than a way to mint free quota.
create or replace function decrement_feature_usage(
  p_campaign_id text,
  p_feature text,
  p_period_start timestamptz
) returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id || ':' || p_feature, 0));

  update feature_usage_counters
  set count = greatest(count - 1, 0)
  where campaign_id = p_campaign_id
    and feature = p_feature
    and period_start = p_period_start;
end;
$$;
