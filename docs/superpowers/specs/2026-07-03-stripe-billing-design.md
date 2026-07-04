# Stripe Billing (Subscriptions + Metered Usage) — Design Spec

**Date:** 2026-07-03
**Status:** Approved

---

## Overview

Add a real billing system on top of Stripe: each campaign (tenant) subscribes to a flat-rate plan with an included monthly usage allowance, and usage beyond that allowance (AI drafting, HeyGen video, ElevenLabs voice — already tracked in `usage_events`) is billed as Stripe metered overage. The platform admin (`super_admin`) manages plan assignment per campaign, matching the existing manual campaign-onboarding flow; campaign owners/managers can view their plan/usage and manage payment method/invoices via a Stripe Customer Portal link, but cannot change plans themselves.

This spec does not cover: self-serve signup/plan switching by campaign owners, multi-currency support, tax configuration beyond Stripe Tax defaults, annual billing, or enforcing `seat_limit` against invite-code issuance (seat limit is informational/display-only in v1) — all out of scope for v1, flag for a future spec if needed.

---

## Plan Tiers

| Plan | Price/mo | Seats | Included usage/mo | Overage rate |
|---|---|---|---|---|
| Starter | $49 | up to 3 | $25 (blended AI + video + voice cost) | 1.3x underlying vendor cost |
| Pro | $149 | up to 10 | $100 | 1.3x underlying vendor cost |
| Enterprise | $499 (or custom) | unlimited | $400 | 1.2x underlying vendor cost |

Usage stays blended across AI/video/voice (one meter, measured in cents) rather than split per vendor, matching how `usage_events.cost_cents` already works today. Each plan maps to one Stripe Product with two Prices: a flat recurring price and a metered price (graduated tiers: $0 up to the included allowance, then the overage rate per unit beyond it).

---

## Data Model

### New table: `billing_plans`
```sql
create table billing_plans (
  id                      text primary key,       -- 'starter' | 'pro' | 'enterprise'
  name                    text not null,
  monthly_price_cents     integer not null,
  seat_limit              integer,                 -- null = unlimited
  included_usage_cents    integer not null,
  overage_multiplier      numeric not null,         -- e.g. 1.3
  stripe_product_id       text not null,
  stripe_flat_price_id    text not null,
  stripe_metered_price_id text not null,
  is_active               boolean not null default true
);
```

### `campaigns` table gains:
- `plan_id` (references `billing_plans`, nullable until a plan is assigned)
- `stripe_customer_id` (nullable until first plan assignment)
- `stripe_subscription_id` (nullable)
- `subscription_status` (text — mirrors Stripe's subscription status enum: `trialing`, `active`, `past_due`, `canceled`, `unpaid`)
- `grace_period_ends_at` (timestamptz, nullable — set when status transitions to `past_due`)

`monthly_cost_cap_cents` (existing column) is unchanged in structure, but is now initialized from `billing_plans.included_usage_cents` when a plan is assigned. It remains an independently-editable internal safety guardrail with no upper ceiling tied to the plan — Stripe overage billing is intentionally uncapped (that's the point of metered pricing), so there is no natural "plan maximum" to clamp against. Staff can raise or lower it freely, same as today; raising it just changes when the internal safety-cap warning kicks in, not what Stripe bills.

### New table: `billing_events`
Append-only log of processed Stripe webhook events, mirroring the existing `audit_entries` pattern — doubles as idempotency protection against Stripe's at-least-once webhook delivery.
```sql
create table billing_events (
  id            text primary key,   -- Stripe event id
  type          text not null,
  campaign_id   text references campaigns(id),
  payload       jsonb not null,
  processed_at  timestamptz not null default now()
);
```

### New table: `usage_sync_cursor`
Tracks per-campaign progress of the usage-sync cron so it knows which `usage_events` rows have already been reported to Stripe.
```sql
create table usage_sync_cursor (
  campaign_id       text primary key references campaigns(id) on delete cascade,
  last_synced_at    timestamptz not null default '1970-01-01',
  last_synced_id    text
);
```

---

## Subscription Lifecycle

### Admin side — `/admin/campaigns/[id]`
New "Billing" panel:
- Assign/change a campaign's plan. First assignment creates a Stripe Customer for the campaign and a Subscription with that plan's flat + metered prices attached. Changing plans updates the existing subscription (proration handled by Stripe's defaults).
- Displays current subscription status, current period start/end, and a link to the customer's record in the Stripe Dashboard.
- "Open billing portal for this customer" button — creates a Stripe Customer Portal session on the campaign's behalf, for admin-assisted card updates.

### Campaign side — `/settings` (visible to all roles; edit actions gated by `can(role, 'edit_settings')`, same as the rest of the page)
New "Billing" card:
- Current plan name, price, and usage this period vs. included allowance (reusing the existing `SpendBar` visual pattern from `/admin/campaigns`).
- "Manage billing" button → Stripe Customer Portal session (update card, view/download invoices, see upcoming invoice total). No plan-switching here.
- Status banner when `subscription_status` is `past_due` (in grace period — explains days remaining) or `unpaid`/`canceled` (explains that paid actions are blocked and to contact the platform admin).

### Webhooks — `/api/webhooks/stripe/route.ts`
Verifies Stripe's signature, de-dupes via `billing_events` (skip if event id already processed), then handles:
- `customer.subscription.updated` / `customer.subscription.deleted` → sync `subscription_status` and `current_period_end`-derived fields onto `campaigns`. On transition into `past_due`, set `grace_period_ends_at = now() + 7 days`. On `canceled`/`unpaid`, clear `grace_period_ends_at` (locks immediately — no grace period on outright cancellation).
- Recovery (a past_due subscription being paid successfully) is handled by the same `customer.subscription.updated` event above — Stripe transitions the subscription's status back to `active` on successful payment, which this handler picks up like any other status change. A separate `invoice.paid` handler was considered but dropped: it would be redundant with the subscription-status event for this purpose, and Stripe's invoice-to-subscription linkage field has shifted across API versions, making it a needlessly fragile way to learn something the subscription event already tells us directly.
- All other subscription/invoice events are logged to `billing_events` for audit visibility but don't change gating state.

---

## Usage Metering Sync

New cron route `src/app/api/cron/billing-sync/route.ts` (same pattern/auth as the existing `src/app/api/cron/publish/route.ts`), scheduled every 30 minutes:

1. For each campaign with `subscription_status` in (`trialing`, `active`, `past_due`) and a `stripe_subscription_id`:
2. Read `usage_events` rows newer than `usage_sync_cursor.last_synced_at` for that campaign.
3. Sum `cost_cents` across those rows.
4. If the sum is non-zero, report it to Stripe as a meter event against the campaign's metered price, using an idempotency key derived from `campaign_id` + the cursor range (so a retried cron run can't double-report).
5. Only after Stripe confirms receipt, advance `usage_sync_cursor` to the newest synced row's id/timestamp.

Failures (Stripe API errors, timeouts) leave the cursor unchanged, so the next run retries the same range — no usage is lost or double-counted.

---

## Access Gating

New error class `BillingBlocked` in `src/domain/usage.ts`, parallel to the existing `CapExceeded`:
```ts
export class BillingBlocked extends Error {}
```

New guard function `checkBillingStatus(campaignId)` in `src/lib/services.ts`, called at the same call sites as `usageMeter.guard` in `src/app/actions.ts` (currently lines 162, 258, 290, 385 — AI drafting and video/voice generation):
- Throws `BillingBlocked` if `subscription_status` is `canceled` or `unpaid`, or if it's `past_due` and `grace_period_ends_at` has passed.
- No-op otherwise (including campaigns with no plan assigned yet, to avoid breaking existing/demo campaigns during rollout — see Rollout below).

`BillingBlocked` is caught in the same try/catch blocks that already handle `CapExceeded` (`src/app/actions.ts` lines 20, 274, 295, 422), returning `{ ok: false, error: e.message }` with a message pointing the user to Settings/the platform admin.

---

## Error Handling

- Webhook handler returns a non-200 response if the DB write fails after signature verification, so Stripe's automatic retry redelivers the event — `billing_events` de-dup ensures no double-processing once the write succeeds.
- Cron sync failures are logged (console/error tracking) and simply retried on the next scheduled run; the cursor design makes this safe.
- Stripe API errors during admin-initiated actions (plan assignment, portal session creation) are surfaced as inline form errors, matching the existing `{ ok: false, error }` pattern used elsewhere in `src/app/actions.ts` and `src/app/admin/actions.ts`.

---

## Testing

- Unit tests for `checkBillingStatus` (status/grace-period logic — pure function, no live Stripe calls) and the cursor-advance logic in the sync job, following the existing `*.test.ts` pattern (e.g. `src/lib/permissions.test.ts`).
- Webhook handler test using Stripe's test event fixtures with a stubbed signature verification, covering the `past_due` → `active` → `canceled` transitions and idempotent redelivery.
- No live Stripe calls in the test suite — all Stripe SDK calls are mocked/stubbed, consistent with how other external providers (HeyGen, ElevenLabs) are already abstracted in `src/integrations/`.

---

## Rollout

Existing campaigns have no `plan_id` until the platform admin assigns one. `checkBillingStatus` no-ops for campaigns without a plan, so nothing breaks for current campaigns until they're explicitly migrated onto a plan by the admin.

---

## Environment Variables

Added to `.env.example`:
```
# ── Billing — activates Stripe subscriptions + metered usage ────────────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PUBLISHABLE_KEY=
```

`CRON_SECRET` already exists (used by the publish cron in `src/app/api/cron/publish/route.ts`) and is reused as-is to authenticate the new `billing-sync` cron route — no new env var needed for that.
