# Disclosures, Billing Admin, Weekly Plans, Campaign Filtering — Design Spec

**Date:** 2026-08-11
**Status:** Approved

---

## Overview

Four independent changes, bundled into one spec at the user's request:

1. **Disclosures should never be skipped due to missing jurisdiction rules.** Today `disclosure_rules` only has rows for `US-FEDERAL` and `US-CA`; any other jurisdiction gets no disclosure at all, which can silently block scheduling. Fix: always generate a disclosure (generic default when no specific rule exists), and let staff edit it per content item.
2. **Admin should manage the billing plan catalog through a UI**, not by editing `billing-catalog.ts`.
3. **Plans need a per-plan billing interval (week or month)**, not just month, since campaigns run shorter cycles.
4. **The campaigns list needs tag and active/paying filters** — currently a plain table with no filtering at all.

---

## 1. Disclosures for all jurisdictions

### Current behavior
- `disclosure_rules` (`supabase/migrations/001_init.sql:69-76`) is keyed by `jurisdiction`, seeded only for `US-FEDERAL` and `US-CA` (`001_init.sql:109-114`).
- `DisclosureEngine.requiredFor()` (`src/domain/disclosure.ts:33-47`) loops over a content item's jurisdictions, looks up each in the rules repo, and **skips any jurisdiction with no row**. If a campaign's only jurisdiction has no rule, zero disclosures are ever produced for it.
- `content-lifecycle.ts` `schedule()` (~line 55) hard-blocks moving AI-generated content to `scheduled` unless at least one disclosure record is attached — so a jurisdiction with no rule can never schedule AI content.

### Change
- Add one generic fallback rule (in code, not a DB row): `DEFAULT_DISCLOSURE_RULE = { requiresAiLabel: true, requiredText: null /* falls back to DEFAULT_LABEL */, placement: 'end', ... }`.
- `DisclosureEngine.requiredFor()`: when `DisclosureRulesRepo.get(jurisdiction)` returns nothing, use `DEFAULT_DISCLOSURE_RULE` instead of skipping. Every AI-generated content item now gets exactly one `RequiredDisclosure` per jurisdiction it targets, always.
- `disclosure_records` gains `is_default boolean not null default false` — set true when the record was created from the fallback rule rather than a jurisdiction-specific one. This is how the UI distinguishes "vetted legal text" from "generic, please review."
- `content-lifecycle.ts` scheduling gate is unchanged in logic — it already just checks "≥1 disclosure record exists" — but is now always satisfiable regardless of jurisdiction.
- UI: on the content review/edit surface where a content item's disclosure text is shown before scheduling, make that text an editable field, saved back to `disclosure_records.required_text` (override). When `is_default` is true, show a small inline hint ("Generic disclosure — review and edit for your state's requirements") next to the field.

### Data flow
Generate content → `DisclosureEngine.requiredFor(item.jurisdictions, item.isAiGenerated)` → one or more `RequiredDisclosure` → written to `disclosure_records` (with `is_default` set appropriately) → shown/editable on the content review UI → edited text persists back to the same record → `schedule()` gate passes.

### Testing
- `DisclosureEngine` unit test: jurisdiction with no rule row still returns a `RequiredDisclosure` using the default text/label.
- `content-lifecycle.ts` test: content targeting an unlisted jurisdiction can now reach `scheduled`.
- Edit flow: saving edited disclosure text updates the record and does not regenerate/overwrite on subsequent renders.

---

## 2. Editable billing plan catalog (admin)

### Current behavior
- `PLAN_DEFINITIONS` (`src/lib/billing-catalog.ts`) hardcodes `starter`/`pro`/`enterprise` with `monthlyPriceCents` and limits.
- `billing_plans` table (`supabase/migrations/010_billing.sql:4-15`) mirrors the catalog plus Stripe IDs.
- `syncBillingPlansAction()` (`src/app/admin/billing/actions.ts`) is `requireAdmin()`-gated and creates/upserts Stripe product+price per catalog entry; UI is `/admin/billing`.
- Assigning a plan to a campaign (`assignPlanAction`, `src/app/admin/actions.ts:93-159`) is separate — also `super_admin`-only.

### Change
- `billing_plans` becomes the live source of truth (no more reading `PLAN_DEFINITIONS` at runtime). New migration adds any missing editable columns: `seat_limit`, `avatar_limit`, `content_limit_monthly`, `video_limit_daily`, `billing_interval text not null default 'month' check (billing_interval in ('week','month'))`. `billing-catalog.ts`'s `PLAN_DEFINITIONS` is kept only as the seed migration's insert values, then deleted from runtime code paths.
- New admin UI on `/admin/billing`: a form per plan (create new / edit existing) for name, price, interval, seat/avatar/content/video limits. Submitting calls a new `upsertBillingPlanAction()`.
- `upsertBillingPlanAction()` behavior:
  - New plan: create Stripe product + price (with chosen `recurring.interval`), insert `billing_plans` row.
  - Edited price or interval on an existing plan: Stripe prices are immutable, so create a **new** Stripe price, archive (`active: false`) the old one, update `billing_plans.stripe_flat_price_id` (and metered price id if applicable) to the new price id.
  - Edited non-price fields (limits, name): plain update, no Stripe call needed.
  - Existing subscribers already on the old Stripe price are **not** touched — they keep billing at the old price/interval until a super_admin explicitly reassigns them via the existing `assignPlanAction` flow. Editing a plan definition never silently changes a live subscription.

### Testing
- `upsertBillingPlanAction` unit test: editing price creates a new Stripe price and archives the old one; editing only `seat_limit` makes no Stripe call.
- Regression: `assignPlanAction` still reads `billing_plans` correctly (no behavior change needed there since it already reads DB rows, not the catalog file).

---

## 3. Weekly billing cadence

### Current behavior
- Every plan is billed monthly; `interval: 'month'` is hardcoded wherever a Stripe subscription/price is created.

### Change
- `billing_plans.billing_interval` (added above) flows into every Stripe price/subscription creation call: `recurring: { interval: plan.billing_interval }` (Stripe supports `'week'` directly).
- `/billing` (self-service) and `/pricing` pages read `billing_interval` off the plan and render "$X/week" or "$X/month" accordingly — no separate weekly code path, just formatting off the field.
- `campaigns.monthly_cost_cap_cents` → renamed `billing_cost_cap_cents` (migration: `alter table campaigns rename column monthly_cost_cap_cents to billing_cost_cap_cents`) since the cap now applies to whatever period the assigned plan bills on, not always a month. All read/write sites (`src/lib/data.ts`, `src/app/admin/actions.ts`, campaign detail page) updated to the new column/field name.

### Testing
- Assigning a weekly-interval plan creates a Stripe subscription with `interval: 'week'`.
- Cap enforcement logic (wherever `monthlyCostCapCents` was read) still compares spend against the renamed field with no behavior change, just naming.

---

## 4. Campaign list: tags + active/paying filter

### Current behavior
- `Campaign` (`src/lib/data.ts:7-15`) has no `status`/`active`/`tags` field. "Paying" is inferable only from `subscriptionStatus`.
- `/admin/campaigns/page.tsx` is a plain server-rendered table: no filter, search, sort, or pagination.
- Existing filter pattern in the app: `MonitoringTable.tsx` — client component, `useState` over a `Filter` union, toggle-button row, `.filter()` over the list.

### Change
- Migration: `alter table campaigns add column tags text[] not null default '{}'`.
- Campaign detail page (`/admin/campaigns/[id]/page.tsx`) gets a `tags` input alongside the existing `jurisdictions` comma-separated input, saved via `updateCampaignAction`.
- "Active"/"paying" is **derived, not stored**: active := `subscriptionStatus in ('active', 'trialing')`. No new status column.
- `/admin/campaigns/page.tsx` becomes a client component (data still fetched server-side and passed down, filtering happens client-side same as `MonitoringTable`):
  - Toggle-button row: **All / Active / Inactive**, filtering on the derived active flag.
  - Tag chips rendered per row (same visual slot jurisdictions chips currently use); clicking a chip filters the list to campaigns carrying that tag (multi-select — click again to remove from filter).

### Testing
- Filter logic unit test: All/Active/Inactive correctly partitions a mixed fixture of subscription statuses.
- Tag filter: selecting a tag chip narrows the list to matching campaigns; clearing shows all.

---

## Summary of DB changes

Illustrative migration below — actual filename/number picked at implementation time from whatever the next free `supabase/migrations/0NN_*.sql` slot is (there's an unrelated pending spec that also provisionally referenced `034`; this is not a real collision since neither migration exists yet).

```sql
-- 0NN_disclosures_billing_campaigns.sql

```sql
alter table disclosure_records add column if not exists is_default boolean not null default false;

alter table billing_plans
  add column if not exists billing_interval text not null default 'month'
    check (billing_interval in ('week','month'));

alter table campaigns rename column monthly_cost_cap_cents to billing_cost_cap_cents;
alter table campaigns add column if not exists tags text[] not null default '{}';
```

## Out of scope
- No change to which roles can invite/assign `super_admin` — billing catalog editing stays `super_admin`-only, same as today's `assignPlanAction`/`syncBillingPlansAction`.
- No annual/other intervals beyond week/month.
- No campaign-level "active/paused/archived" status distinct from billing — explicitly rejected in favor of deriving from subscription status.
