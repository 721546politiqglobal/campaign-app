# Campaign Tag & Active/Paying Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super_admin filter `/admin/campaigns` by active/inactive (paying vs. not) and by freeform tags, and tag campaigns from the campaign detail page.

**Architecture:** Add a `tags text[]` column to `campaigns`, editable the same way `jurisdictions` already is. "Active" is derived from `subscriptionStatus`, not stored. Extract the campaign table into a new client component `CampaignsTable` (mirrors the existing `MonitoringTable` filter-button-bar pattern), with the filtering logic itself pulled into a small pure, unit-tested function so it's covered by Vitest rather than a DOM test (this codebase has no component-testing library).

**Tech Stack:** TypeScript, React (client component), Supabase (Postgres), Vitest.

## Global Constraints
- "Active" means `subscriptionStatus` is `'active'` or `'trialing'`. Everything else (`past_due`, `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`, or `null`) is "inactive." Do not add a separate stored status column.
- Tags are freeform strings, admin-entered, comma-separated — same UX as the existing `jurisdictions` field.
- Selecting multiple tag chips is OR semantics (show campaigns matching *any* selected tag) — this keeps the filter useful as the tag list grows, rather than narrowing to empty quickly.

---

## Background (read before starting)

- `Campaign` / `CampaignWithStats` types and all campaign-reading functions live in `src/lib/data.ts`. `getAllCampaigns()` (lines 210-258) is what feeds `/admin/campaigns`.
- `/admin/campaigns/page.tsx` is currently a plain server component rendering a `<table>` with no filter/search of any kind.
- The established filter UI pattern in this codebase is `src/components/MonitoringTable.tsx`: a `'use client'` component, a `type Filter = 'all' | ...' union in `useState`, a row of toggle `<button className={`btn${filter === f.key ? ' active' : ''}`}>` elements, and a plain `.filter()` over the array. Follow this, don't invent a new filter UI pattern.
- `updateCampaignAction`/`createCampaignAction` (`src/app/admin/actions.ts:48-91`) already parse a comma-separated `jurisdictions` field the same way tags will need to be parsed.
- `campaign.jurisdictions` renders today as `<span className="tag">{j}</span>` chips in both `/admin/campaigns/page.tsx` (lines 68-72) and `/admin/campaigns/[id]/page.tsx`'s edit form (line 81-82) — tags reuse the same `.tag` class.

---

### Task 1: Add `tags` to `campaigns`

**Files:**
- Create: `supabase/migrations/035_campaign_tags.sql`

- [ ] **Step 1: Write the migration**

Before naming the file, run `ls supabase/migrations/ | sort | tail -3` to confirm the next free number — this plan assumed `035`, but another migration (e.g. from the billing-interval plan) may have landed first. Renumber if not.

```sql
-- supabase/migrations/035_campaign_tags.sql
-- Freeform, admin-assigned labels for filtering the campaigns list (see
-- docs/superpowers/specs/2026-08-11-disclosures-billing-campaigns-design.md).
alter table campaigns add column if not exists tags text[] not null default '{}';
```

- [ ] **Step 2: Apply it**

Run in the Supabase SQL editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/035_campaign_tags.sql
git commit -m "feat(campaigns): add tags column"
```

---

### Task 2: Pure filter logic (active/inactive + tags), unit-tested

**Files:**
- Create: `src/lib/campaign-filters.ts`
- Test: `src/lib/campaign-filters.test.ts`

**Interfaces:**
- Produces:
  - `type CampaignStatusFilter = 'all' | 'active' | 'inactive'`
  - `isCampaignActive(subscriptionStatus: string | null): boolean`
  - `filterCampaigns<T extends { subscriptionStatus: string | null; tags: string[] }>(campaigns: T[], statusFilter: CampaignStatusFilter, tagFilter: string[]): T[]`
  These are consumed by Task 4's `CampaignsTable` component.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/campaign-filters.test.ts
import { describe, it, expect } from 'vitest';
import { isCampaignActive, filterCampaigns } from './campaign-filters';

function camp(over: { subscriptionStatus?: string | null; tags?: string[] }) {
  return { id: 'c', subscriptionStatus: over.subscriptionStatus ?? null, tags: over.tags ?? [] };
}

describe('isCampaignActive', () => {
  it('treats active and trialing as active', () => {
    expect(isCampaignActive('active')).toBe(true);
    expect(isCampaignActive('trialing')).toBe(true);
  });
  it('treats past_due, canceled, unpaid, incomplete, and null as inactive', () => {
    for (const s of ['past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', null]) {
      expect(isCampaignActive(s)).toBe(false);
    }
  });
});

describe('filterCampaigns', () => {
  const campaigns = [
    camp({ subscriptionStatus: 'active', tags: ['midterm'] }),
    camp({ subscriptionStatus: 'past_due', tags: ['midterm', 'statewide'] }),
    camp({ subscriptionStatus: null, tags: ['statewide'] }),
  ];

  it('"all" with no tag filter returns everything', () => {
    expect(filterCampaigns(campaigns, 'all', [])).toHaveLength(3);
  });

  it('"active" keeps only active/trialing campaigns', () => {
    expect(filterCampaigns(campaigns, 'active', [])).toEqual([campaigns[0]]);
  });

  it('"inactive" keeps everything else', () => {
    expect(filterCampaigns(campaigns, 'inactive', [])).toEqual([campaigns[1], campaigns[2]]);
  });

  it('a tag filter keeps campaigns carrying ANY selected tag (OR semantics)', () => {
    expect(filterCampaigns(campaigns, 'all', ['midterm'])).toEqual([campaigns[0], campaigns[1]]);
  });

  it('status and tag filters combine', () => {
    expect(filterCampaigns(campaigns, 'inactive', ['midterm'])).toEqual([campaigns[1]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/campaign-filters.test.ts`
Expected: FAIL — `src/lib/campaign-filters.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

```typescript
// src/lib/campaign-filters.ts
export type CampaignStatusFilter = 'all' | 'active' | 'inactive';

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

export function isCampaignActive(subscriptionStatus: string | null): boolean {
  return subscriptionStatus !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
}

export function filterCampaigns<T extends { subscriptionStatus: string | null; tags: string[] }>(
  campaigns: T[],
  statusFilter: CampaignStatusFilter,
  tagFilter: string[],
): T[] {
  return campaigns.filter(c => {
    const active = isCampaignActive(c.subscriptionStatus);
    if (statusFilter === 'active' && !active) return false;
    if (statusFilter === 'inactive' && active) return false;
    if (tagFilter.length > 0 && !tagFilter.some(t => c.tags.includes(t))) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/campaign-filters.test.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaign-filters.ts src/lib/campaign-filters.test.ts
git commit -m "feat(campaigns): add pure active/inactive + tag filter logic"
```

---

### Task 3: Persist `tags` through the data layer and campaign edit form

**Files:**
- Modify: `src/lib/data.ts` (`Campaign` interface line 7-15, `getCampaign` line 24-36, `getAllCampaigns` line 210-258)
- Modify: `src/app/admin/actions.ts` (`updateCampaignAction` line 48-66)
- Modify: `src/app/admin/campaigns/[id]/page.tsx` (edit form, lines 73-84)

**Interfaces:**
- Produces: `Campaign.tags: string[]` and `CampaignWithStats.tags: string[]` (inherited), consumed by Task 4's `CampaignsTable`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/data.campaign-tags.test.ts
import { describe, it, expect, vi } from 'vitest';

const single = vi.fn(async () => ({
  data: { id: 'camp-1', name: 'Camp', jurisdictions: ['US-CA'], monthly_cost_cap_cents: 100000, tags: ['midterm', 'statewide'] },
}));
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
vi.mock('./supabase', () => ({ adminDb: { from: vi.fn(() => ({ select })) } }));

describe('getCampaign', () => {
  it('maps tags onto Campaign.tags', async () => {
    const { getCampaign } = await import('./data');
    const campaign = await getCampaign('camp-1');
    expect(campaign?.tags).toEqual(['midterm', 'statewide']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/data.campaign-tags.test.ts`
Expected: FAIL — `campaign.tags` is `undefined`.

- [ ] **Step 3: Add `tags` to the `Campaign` interface and its readers**

In `src/lib/data.ts`, update the `Campaign` interface (line 7-15):

```typescript
export interface Campaign {
  id: string; name: string; jurisdictions: string[]; tags: string[]; monthlyCostCapCents: number;
  planId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
}
```

Update `getCampaign` (line 24-36) to map it:

```typescript
export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  const { data } = await adminDb.from('campaigns').select('*').eq('id', campaignId).single();
  if (!data) return null;
  return {
    id: data.id, name: data.name, jurisdictions: data.jurisdictions, tags: data.tags ?? [],
    monthlyCostCapCents: data.monthly_cost_cap_cents,
    planId: data.plan_id ?? null,
    stripeCustomerId: data.stripe_customer_id ?? null,
    stripeSubscriptionId: data.stripe_subscription_id ?? null,
    subscriptionStatus: data.subscription_status ?? null,
    gracePeriodEndsAt: data.grace_period_ends_at ?? null,
    currentPeriodEnd: data.current_period_end ?? null,
  };
}
```

Update `getAllCampaigns` (the object literal inside the `campaigns.map(camp => { ... })` block, around line 241-249) to add `tags: camp.tags ?? [],` alongside the existing `jurisdictions: camp.jurisdictions,` line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/data.campaign-tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Save tags from the campaign edit form**

In `src/app/admin/actions.ts`, update `updateCampaignAction` (line 48-66):

```typescript
export async function updateCampaignAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id'));
  const name = String(formData.get('name') ?? '').trim();
  const capDollars = Number(formData.get('cap'));
  const jurisdictions = String(formData.get('jurisdictions') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const tags = String(formData.get('tags') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!name) return;
  await adminDb.from('campaigns').update({
    name,
    monthly_cost_cap_cents: Number.isFinite(capDollars) && capDollars >= 0
      ? Math.round(capDollars * 100) : undefined,
    ...(jurisdictions.length ? { jurisdictions } : {}),
    tags,
  }).eq('id', id);

  revalidatePath(`/admin/campaigns/${id}`);
  revalidatePath('/admin');
}
```

(Unlike `jurisdictions`, an empty `tags` submission is written as `[]` rather than skipped — clearing all tags is a legitimate action, whereas a campaign can never legitimately have zero jurisdictions.)

- [ ] **Step 6: Add the tags input to the campaign edit form**

In `src/app/admin/campaigns/[id]/page.tsx`, inside the "Edit campaign" form's grid (after the "Jurisdictions" field, around line 79-83), add:

```tsx
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="field-label">Monthly cap (USD)</label>
                <input name="cap" type="number" className="input"
                  defaultValue={campaign.monthlyCostCapCents / 100} min="0" />
              </div>
              <div>
                <label className="field-label">Jurisdictions</label>
                <input name="jurisdictions" className="input"
                  defaultValue={campaign.jurisdictions.join(', ')} />
              </div>
            </div>
            <div>
              <label className="field-label">Tags</label>
              <input name="tags" className="input" placeholder="2026-midterm, statewide"
                defaultValue={campaign.tags.join(', ')} />
            </div>
```

(This replaces the existing two-field grid block with the same two fields plus a new full-width `tags` field beneath it.)

- [ ] **Step 7: Run the full suite for regressions**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Manually verify**

Run the dev server, open `/admin/campaigns/[id]` for any campaign, add `2026-midterm, statewide` in the new Tags field, save, and confirm the page reloads with those values still in the field.

- [ ] **Step 9: Commit**

```bash
git add src/lib/data.ts src/lib/data.campaign-tags.test.ts src/app/admin/actions.ts src/app/admin/campaigns/\[id\]/page.tsx
git commit -m "feat(campaigns): add editable tags field"
```

---

### Task 4: `CampaignsTable` — active/inactive + tag filter UI on `/admin/campaigns`

**Files:**
- Create: `src/components/CampaignsTable.tsx`
- Modify: `src/app/admin/campaigns/page.tsx`

**Interfaces:**
- Consumes: `CampaignWithStats[]` (from `@/lib/data`, now including `tags`), `filterCampaigns`/`isCampaignActive`/`CampaignStatusFilter` (Task 2).
- Produces: `CampaignsTable({ campaigns }: { campaigns: CampaignWithStats[] })` — a client component rendering the filter bar + table, extracted so `page.tsx` stays a server component that just fetches data.

- [ ] **Step 1: Extract the table into `CampaignsTable`**

Move the `SpendBar` helper and the `<table>` block out of `src/app/admin/campaigns/page.tsx` into a new client component:

```tsx
// src/components/CampaignsTable.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CampaignWithStats } from '@/lib/data';
import { filterCampaigns, isCampaignActive, type CampaignStatusFilter } from '@/lib/campaign-filters';

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SpendBar({ spent, cap }: { spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min((spent / cap) * 100, 100) : 0;
  const over = spent > cap;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--bg-hover)', borderRadius: 2 }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${pct}%`,
          background: over ? 'var(--bad)' : pct > 80 ? 'var(--warn)' : 'var(--accent)',
          transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: 11, color: over ? 'var(--bad)' : 'var(--text-3)', minWidth: 36, textAlign: 'right' }}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

const STATUS_FILTERS: { key: CampaignStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
];

export function CampaignsTable({ campaigns }: { campaigns: CampaignWithStats[] }) {
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>('all');
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const allTags = [...new Set(campaigns.flatMap(c => c.tags))].sort();
  const filtered = filterCampaigns(campaigns, statusFilter, tagFilter);

  function toggleTag(tag: string) {
    setTagFilter(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }

  return (
    <div>
      <div className="btnrow" style={{ marginBottom: 12 }}>
        {STATUS_FILTERS.map(f => (
          <button key={f.key} className={`btn${statusFilter === f.key ? ' active' : ''}`}
            onClick={() => setStatusFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {allTags.length > 0 && (
        <div className="btnrow" style={{ marginBottom: 20 }}>
          {allTags.map(tag => (
            <button key={tag} className={`btn${tagFilter.includes(tag) ? ' active' : ''}`}
              onClick={() => toggleTag(tag)}>
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 0, marginBottom: 32 }}>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Jurisdictions</th>
              <th>Tags</th>
              <th>Status</th>
              <th>Users</th>
              <th>Content</th>
              <th>Monthly spend</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="row">
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13.5 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {c.inReviewCount > 0 && (
                      <span style={{ color: 'var(--warn)', fontWeight: 600 }}>
                        {c.inReviewCount} in review ·{' '}
                      </span>
                    )}
                    {c.contentCount} total
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.jurisdictions.map(j => (
                      <span key={j} className="tag">{j}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.tags.map(t => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`tag ${isCampaignActive(c.subscriptionStatus) ? 'cred-high' : 'cred-low'}`}>
                    {isCampaignActive(c.subscriptionStatus) ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="data" style={{ color: 'var(--text-2)' }}>{c.userCount}</td>
                <td className="data" style={{ color: 'var(--text-2)' }}>{c.contentCount}</td>
                <td style={{ minWidth: 160 }}>
                  <div className="data" style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                    {fmt(c.monthlySpendCents)}{' '}
                    <span style={{ color: 'var(--text-3)' }}>/ {fmt(c.monthlyCostCapCents)}</span>
                  </div>
                  <SpendBar spent={c.monthlySpendCents} cap={c.monthlyCostCapCents} />
                </td>
                <td>
                  <Link href={`/admin/campaigns/${c.id}`} className="btn" style={{ fontSize: 12, padding: '5px 10px' }}>
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ padding: 24 }}>
                  {campaigns.length === 0 ? 'No campaigns yet.' : 'No campaigns match this filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

`cred-high`/`cred-low` are the existing badge color classes already used by `MonitoringTable` for credibility — reused here rather than inventing new CSS.

- [ ] **Step 2: Slim `page.tsx` down to fetch + render**

Replace `src/app/admin/campaigns/page.tsx` with:

```tsx
import { getAllCampaigns } from '@/lib/data';
import { createCampaignAction } from '../actions';
import { CampaignsTable } from '@/components/CampaignsTable';

export default async function CampaignsPage() {
  const campaigns = await getAllCampaigns();

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">System</span>
          <h1>Campaigns</h1>
        </div>
      </div>

      <CampaignsTable campaigns={campaigns} />

      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <span className="eyebrow">New campaign</span>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 0' }}>Create campaign</h2>
        </div>
        <form action={createCampaignAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Campaign name</label>
            <input name="name" className="input" placeholder="e.g. Smith for Governor" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="field-label">Monthly cap (USD)</label>
              <input name="cap" type="number" className="input" defaultValue="1000" min="0" />
            </div>
            <div>
              <label className="field-label">Jurisdictions</label>
              <input
                name="jurisdictions"
                className="input"
                placeholder="US-FEDERAL, US-CA"
                defaultValue="US-FEDERAL"
              />
            </div>
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Create campaign</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manually verify**

Run the dev server, visit `/admin/campaigns` as super_admin:
1. Confirm the table renders exactly as before, now with added "Tags" and "Status" columns.
2. Click "Active" — confirm only campaigns with `active`/`trialing` status remain.
3. Click "Inactive" — confirm the complement shows.
4. Click a tag chip (requires at least one campaign to have a tag set via Task 3's edit form first) — confirm the list narrows to campaigns carrying that tag; click it again to clear.
5. Confirm "Manage →" links still navigate correctly.

- [ ] **Step 4: Run the full test suite for regressions**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CampaignsTable.tsx src/app/admin/campaigns/page.tsx
git commit -m "feat(campaigns): add active/inactive and tag filters to the campaigns list"
```
