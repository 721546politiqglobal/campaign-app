-- supabase/migrations/021_subscription_event_ordering.sql
-- Out-of-order webhook protection (BILL-7). Stripe redelivers subscription
-- events without ordering guarantees; a stale `active` arriving after a
-- `past_due` must not overwrite the newer status or clear the grace period.
-- Track the unix-seconds `created` of the newest subscription event applied.
alter table campaigns
  add column if not exists subscription_event_created bigint;
