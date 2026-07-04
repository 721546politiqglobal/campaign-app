-- Idempotent-retry support for the usage-sync cron: persist the pending
-- report's range/key BEFORE calling Stripe, so a retry after a Stripe-
-- succeeds-but-DB-write-fails race reuses the exact same range and
-- idempotency key instead of recomputing a new (and therefore
-- non-deduplicated) one.
alter table usage_sync_cursor
  add column if not exists pending_key text,
  add column if not exists pending_until timestamptz;
