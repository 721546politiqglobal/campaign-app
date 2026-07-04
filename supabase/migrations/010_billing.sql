-- Stripe billing: subscriptions + metered usage overage.
-- Run in the Supabase SQL editor after 009_avatars.sql.

create table if not exists billing_plans (
  id                      text primary key,
  name                    text not null,
  monthly_price_cents     integer not null,
  seat_limit              integer,
  included_usage_cents    integer not null,
  overage_multiplier      numeric not null,
  stripe_product_id       text not null,
  stripe_flat_price_id    text not null,
  stripe_metered_price_id text not null,
  is_active               boolean not null default true
);

alter table campaigns
  add column if not exists plan_id text references billing_plans(id),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists grace_period_ends_at timestamptz,
  add column if not exists current_period_end timestamptz;

create unique index if not exists idx_campaigns_stripe_customer
  on campaigns(stripe_customer_id) where stripe_customer_id is not null;

create unique index if not exists idx_campaigns_stripe_subscription
  on campaigns(stripe_subscription_id) where stripe_subscription_id is not null;

-- Append-only log of processed Stripe webhook events — mirrors audit_entries
-- and doubles as idempotency protection against Stripe's at-least-once delivery.
create table if not exists billing_events (
  id           text primary key,
  type         text not null,
  campaign_id  text references campaigns(id),
  payload      jsonb not null,
  processed_at timestamptz not null default now()
);

-- Tracks how far the usage-sync cron has gotten reporting usage_events to Stripe.
create table if not exists usage_sync_cursor (
  campaign_id    text primary key references campaigns(id) on delete cascade,
  last_synced_at timestamptz not null default '1970-01-01',
  last_synced_id text
);
