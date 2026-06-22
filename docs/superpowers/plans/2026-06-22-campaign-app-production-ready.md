# Campaign App — Production-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the campaign app production-ready for 1–2 users by adding candidate profile, real AI personalization, actual scheduling, opponent monitoring with credibility scoring, and full UX polish.

**Architecture:** Candidate profile stored in a new `candidate_profiles` table (1-to-1 with campaigns), injected into every Claude API call via a `buildCandidatePrompt()` utility. Scheduling uses a `scheduled_at` timestamp on `content_items` executed by a Vercel cron job. Credibility scoring is rule-based (domain allowlist/blocklist) with Claude fallback, stored on ingest. Toast notifications use a React context provider in the root layout.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL via `adminDb`), Server Actions (`'use server'`), Anthropic SDK (`claude-sonnet-4-6`), Vitest (new — for unit tests on pure functions), native HTML date/time inputs (no UI library).

## Global Constraints

- All DB queries use `adminDb` from `src/lib/supabase.ts`
- `requireSession()` from `src/lib/session.ts` returns `{ userId, name, role, campaignId, exp }` — call it at the top of every server action
- Server actions return `{ ok: true } | { ok: false; error: string }` — use the existing `Result` type in `src/app/actions.ts`
- CSS: use existing global classes from `src/app/globals.css` (`card`, `btn`, `btn primary`, `input`, `field-label`, `muted`, `eyebrow`, `pill`) — no Tailwind, no CSS modules
- Claude model: `'claude-sonnet-4-6'` in all AI calls
- `uid()` from `src/lib/store.ts` generates new IDs
- No external UI libraries beyond what's already in `package.json`
- TypeScript strict mode — no `any` without a comment explaining why

---

## File Map

**New files:**
- `vitest.config.ts` — test runner config
- `src/lib/candidate.ts` — `getCandidateProfile`, `upsertCandidateProfile`
- `src/lib/prompt.ts` — `buildCandidatePrompt`, `PLATFORM_CONSTRAINTS`, `CONTENT_COST_CENTS`
- `src/lib/credibility.ts` — `scoreCredibility`, `categorizeSource`, domain lists
- `src/lib/formatDate.ts` — `formatDate` utility
- `src/components/Toast.tsx` — `ToastProvider`, `useToast`, `ToastContainer`
- `src/components/SkeletonRow.tsx` — table skeleton loading row
- `src/app/setup/page.tsx` — candidate onboarding form
- `src/app/setup/actions.ts` — `upsertProfileAction`
- `src/app/api/cron/publish/route.ts` — scheduled publish cron handler
- `vercel.ts` — Vercel config with cron schedule
- `supabase/migrations/001_candidate_profiles.sql`
- `supabase/migrations/002_content_scheduling.sql`
- `supabase/migrations/003_monitoring_credibility.sql`

**Modified files:**
- `src/domain/types.ts` — add `CandidateProfile`, `VoiceTone`, update `ContentItem`
- `src/integrations/index.ts` — update `ContentGenerator.draft()` interface + `ClaudeContentGenerator`
- `src/lib/data.ts` — add `getCandidateProfile`, `getScheduledToday`, `getDueScheduledItems`
- `src/app/actions.ts` — update `generateDraftAction`, `generateFromMonitoringAction`, add `scheduleWithTimeAction`, `savePlatformsAction`
- `src/components/AppFrame.tsx` — add onboarding gate
- `src/components/ContentEditor.tsx` — platform-aware generation, remove mock leakage, read URL params
- `src/components/ContentWizard.tsx` — add publish-mode toggle with date/time picker, import `scheduleWithTimeAction`
- `src/components/MonitoringTable.tsx` — full redesign with credibility badges, filters, rebuttal flow
- `src/app/dashboard/page.tsx` — redesigned layout
- `src/app/monitoring/page.tsx` — pass credibility data, add manual entry
- `src/app/settings/page.tsx` — add candidate profile edit section
- `src/app/layout.tsx` — wrap with `ToastProvider`
- `src/components/Sidebar.tsx` — mobile bottom tab bar
- `src/app/globals.css` — toast styles, skeleton animation, mobile fixes

---

## Phase 1 — Foundation

### Task 1: Vitest Setup

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm test` command that runs `src/**/*.test.ts` files

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest
```

Expected: `package.json` devDependencies gains `"vitest": "^x.x.x"`

- [ ] **Step 2: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: { environment: 'node' },
  resolve: { alias: { '@': resolve(__dirname, './src') } },
});
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify config works**

```bash
npm test
```
Expected: `No test files found` (zero failures — runner works)

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add Vitest test runner"
```

---

### Task 2: candidate_profiles Database Migration

**Files:**
- Create: `supabase/migrations/001_candidate_profiles.sql`

**Interfaces:**
- Produces: `candidate_profiles` table in Supabase with a unique constraint on `campaign_id`

- [ ] **Step 1: Create migration file**

```bash
mkdir -p supabase/migrations
```

```sql
-- supabase/migrations/001_candidate_profiles.sql
create table if not exists candidate_profiles (
  id                text primary key,
  campaign_id       text not null references campaigns(id) on delete cascade,
  full_name         text not null,
  preferred_name    text not null,
  office            text not null,
  district          text not null,
  party             text not null default '',
  bio               text not null default '',
  key_positions     text[] not null default '{}',
  voice_tone        text not null default 'conversational'
                      check (voice_tone in ('formal','conversational','urgent','inspirational')),
  target_audience   text not null default '',
  tagline           text not null default '',
  photo_url         text,
  opponent_name     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (campaign_id)
);
```

- [ ] **Step 2: Apply migration**

Open your Supabase project → SQL Editor → paste the contents of `supabase/migrations/001_candidate_profiles.sql` → Run.

Expected: Query returns "Success. No rows returned."

- [ ] **Step 3: Verify table exists**

In Supabase SQL Editor:
```sql
select column_name, data_type from information_schema.columns
where table_name = 'candidate_profiles' order by ordinal_position;
```
Expected: 15 rows listing all columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/001_candidate_profiles.sql
git commit -m "feat: add candidate_profiles migration"
```

---

### Task 3: CandidateProfile Types + Data Helpers

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/lib/candidate.ts`
- Create: `src/lib/candidate.test.ts`

**Interfaces:**
- Produces:
  - `CandidateProfile` type exported from `src/domain/types.ts`
  - `getCandidateProfile(campaignId: string): Promise<CandidateProfile | null>` from `src/lib/candidate.ts`
  - `upsertCandidateProfile(campaignId: string, data: Omit<CandidateProfile, 'id' | 'campaignId' | 'createdAt' | 'updatedAt'>): Promise<void>` from `src/lib/candidate.ts`

- [ ] **Step 1: Add types to domain/types.ts**

Add after the existing exports at the bottom of `src/domain/types.ts`:

```typescript
export type VoiceTone = 'formal' | 'conversational' | 'urgent' | 'inspirational';

export interface CandidateProfile {
  id: string;
  campaignId: string;
  fullName: string;
  preferredName: string;
  office: string;
  district: string;
  party: string;
  bio: string;
  keyPositions: string[];
  voiceTone: VoiceTone;
  targetAudience: string;
  tagline: string;
  photoUrl?: string | null;
  opponentName?: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/candidate.test.ts
import { describe, it, expect } from 'vitest';

// Verify the module exports the expected functions (shape test — no DB call)
describe('candidate module exports', () => {
  it('exports getCandidateProfile and upsertCandidateProfile', async () => {
    const mod = await import('./candidate');
    expect(typeof mod.getCandidateProfile).toBe('function');
    expect(typeof mod.upsertCandidateProfile).toBe('function');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test src/lib/candidate.test.ts
```
Expected: FAIL — `Cannot find module './candidate'`

- [ ] **Step 4: Create src/lib/candidate.ts**

```typescript
// src/lib/candidate.ts
import { adminDb } from './supabase';
import { CandidateProfile, VoiceTone } from '@/domain/types';
import { uid } from './store';

function toProfile(r: Record<string, unknown>): CandidateProfile {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    fullName: r.full_name as string,
    preferredName: r.preferred_name as string,
    office: r.office as string,
    district: r.district as string,
    party: (r.party as string) ?? '',
    bio: (r.bio as string) ?? '',
    keyPositions: (r.key_positions as string[]) ?? [],
    voiceTone: (r.voice_tone as VoiceTone) ?? 'conversational',
    targetAudience: (r.target_audience as string) ?? '',
    tagline: (r.tagline as string) ?? '',
    photoUrl: (r.photo_url as string | null) ?? null,
    opponentName: (r.opponent_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function getCandidateProfile(campaignId: string): Promise<CandidateProfile | null> {
  const { data } = await adminDb
    .from('candidate_profiles')
    .select('*')
    .eq('campaign_id', campaignId)
    .single();
  return data ? toProfile(data) : null;
}

export async function upsertCandidateProfile(
  campaignId: string,
  data: Omit<CandidateProfile, 'id' | 'campaignId' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const payload = {
    campaign_id:    campaignId,
    full_name:      data.fullName,
    preferred_name: data.preferredName,
    office:         data.office,
    district:       data.district,
    party:          data.party,
    bio:            data.bio,
    key_positions:  data.keyPositions,
    voice_tone:     data.voiceTone,
    target_audience: data.targetAudience,
    tagline:        data.tagline,
    photo_url:      data.photoUrl ?? null,
    opponent_name:  data.opponentName ?? null,
    updated_at:     new Date().toISOString(),
  };

  // Avoid passing id into an upsert — Supabase would overwrite the PK on conflict.
  // Use insert for new records, update for existing ones.
  const existing = await getCandidateProfile(campaignId);
  if (existing) {
    await adminDb.from('candidate_profiles').update(payload).eq('campaign_id', campaignId);
  } else {
    await adminDb.from('candidate_profiles').insert({ id: uid(), ...payload });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test src/lib/candidate.test.ts
```
Expected: PASS

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/domain/types.ts src/lib/candidate.ts src/lib/candidate.test.ts
git commit -m "feat: add CandidateProfile type and data helpers"
```

---

### Task 4: AI Prompt Builder

**Files:**
- Create: `src/lib/prompt.ts`
- Create: `src/lib/prompt.test.ts`

**Interfaces:**
- Produces:
  - `buildCandidatePrompt(profile: CandidateProfile, contentType: string): string` — returns the full system prompt
  - `PLATFORM_CONSTRAINTS: Record<string, string>` — per-type instruction strings
  - `CONTENT_COST_CENTS: Record<string, number>` — cost lookup table

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildCandidatePrompt, CONTENT_COST_CENTS } from './prompt';
import type { CandidateProfile } from '@/domain/types';

const profile: CandidateProfile = {
  id: 'test-id',
  campaignId: 'camp-1',
  fullName: 'Maria Rivera',
  preferredName: 'Maria',
  office: 'California State Assembly',
  district: 'District 12',
  party: 'Democratic',
  bio: 'A lifelong community advocate.',
  keyPositions: ['Expand healthcare access', 'Lower housing costs'],
  voiceTone: 'conversational',
  targetAudience: 'Working families in the San Fernando Valley',
  tagline: 'A Voice for District 12',
  opponentName: 'John Smith',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('buildCandidatePrompt', () => {
  it('includes the candidate full name', () => {
    const prompt = buildCandidatePrompt(profile, 'social_post');
    expect(prompt).toContain('Maria Rivera');
  });

  it('includes all key positions', () => {
    const prompt = buildCandidatePrompt(profile, 'social_post');
    expect(prompt).toContain('Expand healthcare access');
    expect(prompt).toContain('Lower housing costs');
  });

  it('includes the opponent name', () => {
    const prompt = buildCandidatePrompt(profile, 'social_post');
    expect(prompt).toContain('John Smith');
  });

  it('instructs third person for press_release', () => {
    const prompt = buildCandidatePrompt(profile, 'press_release');
    expect(prompt.toLowerCase()).toContain('third person');
  });

  it('does not contain placeholder brackets', () => {
    const prompt = buildCandidatePrompt(profile, 'email');
    expect(prompt).not.toMatch(/\[.*?\]/);
  });
});

describe('CONTENT_COST_CENTS', () => {
  it('has entries for all content types', () => {
    const types = ['social_post', 'sms', 'email', 'press_release', 'ad_copy', 'talking_points', 'reel'];
    types.forEach(t => {
      expect(CONTENT_COST_CENTS[t]).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test src/lib/prompt.test.ts
```
Expected: FAIL — `Cannot find module './prompt'`

- [ ] **Step 3: Create src/lib/prompt.ts**

```typescript
// src/lib/prompt.ts
import type { CandidateProfile } from '@/domain/types';

export const PLATFORM_CONSTRAINTS: Record<string, string> = {
  social_post: 'Keep it under 280 characters for X/Twitter compatibility. Write naturally — only use hashtags if they feel organic.',
  social_post_instagram: 'Caption under 2,200 characters. End with 3–5 relevant hashtags on their own line.',
  email: 'First line must be: "Subject: [your subject here]". Then a blank line, then the body with a greeting and a sign-off using the candidate\'s full name.',
  sms: 'Max 160 characters. No URLs. One direct call to action.',
  press_release: 'Write in third person. Structure: headline, dateline (City, State — Date), 3–4 body paragraphs, then a boilerplate paragraph about the candidate starting with "About [Name]:".',
  talking_points: 'Output a bullet list of 5–7 points. Each point must be 1–2 sentences. Lead with the strongest point.',
  ad_copy: 'Punchy headline (max 8 words). Two supporting sentences. End with a clear CTA.',
  reel: 'Write a natural-sounding spoken script. No stage directions. Aim for 30–60 seconds at normal speaking pace (~130 words).',
};

export const CONTENT_COST_CENTS: Record<string, number> = {
  social_post: 3_00,
  sms:         2_00,
  talking_points: 5_00,
  email:       8_00,
  press_release: 12_00,
  ad_copy:     4_00,
  reel:        10_00,
};

export function buildCandidatePrompt(profile: CandidateProfile, contentType: string): string {
  const positions = profile.keyPositions.map(p => `• ${p}`).join('\n');
  const platformNote = PLATFORM_CONSTRAINTS[contentType] ?? '';
  const personNote = contentType === 'press_release'
    ? 'Write in THIRD PERSON — refer to the candidate by name, not as "I".'
    : 'Write in FIRST PERSON as the candidate.';

  return `You are a professional political communications expert.
You are writing on behalf of ${profile.preferredName} (full name: ${profile.fullName}).

CANDIDATE CONTEXT:
- Running for: ${profile.office}, ${profile.district}
- Party: ${profile.party}
- Bio: ${profile.bio}
- Key policy positions:
${positions}
- Campaign tagline: "${profile.tagline}"
- Target audience: ${profile.targetAudience}
- Voice and tone: ${profile.voiceTone}
${profile.opponentName ? `- Primary opponent: ${profile.opponentName}` : ''}

RULES:
- ${personNote}
- Never invent facts or policy positions not listed above.
- Never use placeholder text such as [Name], [District], or [Party].
- Use the actual candidate name, office, and district from this context.
${platformNote ? `- Format requirements: ${platformNote}` : ''}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test src/lib/prompt.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt.ts src/lib/prompt.test.ts
git commit -m "feat: add buildCandidatePrompt utility and cost table"
```

---

### Task 5: Inject Candidate Profile into AI Generation

**Files:**
- Modify: `src/integrations/index.ts` — update `ContentGenerator` interface and `ClaudeContentGenerator.draft()`
- Modify: `src/app/actions.ts` — update `generateDraftAction` and `generateFromMonitoringAction`

**Interfaces:**
- Consumes: `buildCandidatePrompt` from `src/lib/prompt.ts`, `getCandidateProfile` from `src/lib/candidate.ts`, `CONTENT_COST_CENTS` from `src/lib/prompt.ts`
- Produces: `contentGenerator.draft()` now accepts optional `candidateProfile` and uses it to build a personalized system prompt

- [ ] **Step 1: Update ContentGenerator interface in src/integrations/index.ts**

Replace the existing `ContentGenerator` interface (lines 11–13):

```typescript
import type { CandidateProfile } from '@/domain/types';

export interface ContentGenerator {
  draft(input: {
    instruction: string;
    type: string;
    audience?: string;
    candidateProfile?: CandidateProfile;
  }): Promise<{ text: string; title: string }>;
}
```

- [ ] **Step 2: Update ClaudeContentGenerator.draft() in src/integrations/index.ts**

Replace the existing `draft` method body inside `ClaudeContentGenerator`:

```typescript
async draft({ instruction, type, candidateProfile }: {
  instruction: string;
  type: string;
  audience?: string;
  candidateProfile?: CandidateProfile;
}) {
  const { buildCandidatePrompt } = await import('@/lib/prompt');

  const systemPrompt = candidateProfile
    ? buildCandidatePrompt(candidateProfile, type)
    : 'You are a professional political campaign copywriter. Write factual, persuasive campaign content.';

  const msg = await this.client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Content type: ${type}
Brief: ${instruction}

Write the content now. Start with "Title: [your title here]" on the first line, then a blank line, then the body.`,
    }],
  });

  const raw = (msg.content[0] as { type: string; text: string }).text;
  const lines = raw.split('\n');
  const titleLine = lines.find(l => l.toLowerCase().startsWith('title:'));
  const title = titleLine ? titleLine.replace(/^title:\s*/i, '').trim() : instruction.slice(0, 60);
  const body = lines.filter(l => !l.toLowerCase().startsWith('title:')).join('\n').trim();
  return { title, text: body };
}
```

- [ ] **Step 3: Update MockContentGenerator.draft() to remove env var message**

Replace the `MockContentGenerator.draft()` body:

```typescript
async draft({ instruction, type }: { instruction: string; type: string; candidateProfile?: CandidateProfile }) {
  const title = instruction.replace(/^(make|write|draft)\s+(a|an)?\s*/i, '').slice(0, 60) || 'Untitled draft';
  const text =
    `Here's how our plan answers what voters told us matters most.\n\n` +
    `${instruction.trim()}\n\n` +
    `We'll keep costs down, protect what works, and fix what doesn't. ` +
    `Read the full proposal and tell us what you think.`;
  return { title: title[0].toUpperCase() + title.slice(1), text };
}
```

- [ ] **Step 4: Update generateDraftAction in src/app/actions.ts**

Replace the existing `generateDraftAction` function:

```typescript
export async function generateDraftAction(instruction: string, type: string) {
  const s = requireSession();
  const { CONTENT_COST_CENTS } = await import('@/lib/prompt');
  const { getCandidateProfile } = await import('@/lib/candidate');

  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) throw new Error('Campaign not found');

  const cost = CONTENT_COST_CENTS[type] ?? 5_00;
  await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, cost);
  const out = await contentGenerator.draft({
    instruction,
    type,
    candidateProfile: profile ?? undefined,
  });
  await usageMeter.record(s.campaignId, 'llm_tokens', 1, cost);
  return out;
}
```

- [ ] **Step 5: Update generateFromMonitoringAction in src/app/actions.ts**

Add candidate profile fetch at the top of the existing `generateFromMonitoringAction` (after `getCampaign`):

```typescript
const { getCandidateProfile } = await import('@/lib/candidate');
const { CONTENT_COST_CENTS } = await import('@/lib/prompt');

const [campaign, profile] = await Promise.all([
  getCampaign(s.campaignId),
  getCandidateProfile(s.campaignId),
]);
```

Then update the `contentGenerator.draft()` call inside the same function:

```typescript
const out = await contentGenerator.draft({
  instruction,
  type: contentType,
  candidateProfile: profile ?? undefined,
});
```

And replace the hardcoded `9_00` cost with:

```typescript
const cost = CONTENT_COST_CENTS[contentType] ?? 5_00;
await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, cost);
// ... existing draft call ...
await usageMeter.record(s.campaignId, 'llm_tokens', 1, cost);
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/integrations/index.ts src/app/actions.ts
git commit -m "feat: inject candidate profile into all AI content generation"
```

---

### Task 6: Onboarding Setup Page

**Files:**
- Create: `src/app/setup/page.tsx`
- Create: `src/app/setup/actions.ts`

**Interfaces:**
- Consumes: `requireSession` from `src/lib/session.ts`, `getCandidateProfile` from `src/lib/candidate.ts`, `upsertCandidateProfile` from `src/lib/candidate.ts`
- Produces: `/setup` route — a standalone form (no AppFrame) that saves candidate profile and redirects to `/dashboard`

- [ ] **Step 1: Create src/app/setup/actions.ts**

```typescript
'use server';

import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { upsertCandidateProfile } from '@/lib/candidate';
import type { VoiceTone } from '@/domain/types';

export async function upsertProfileAction(formData: FormData) {
  const s = requireSession();

  const fullName      = String(formData.get('full_name')      ?? '').trim();
  const preferredName = String(formData.get('preferred_name') ?? '').trim();
  const office        = String(formData.get('office')         ?? '').trim();
  const district      = String(formData.get('district')       ?? '').trim();
  const party         = String(formData.get('party')          ?? '').trim();
  const bio           = String(formData.get('bio')            ?? '').trim();
  const keyPositions  = String(formData.get('key_positions')  ?? '')
    .split('\n').map(p => p.trim()).filter(Boolean);
  const voiceTone     = (String(formData.get('voice_tone') ?? 'conversational')) as VoiceTone;
  const targetAudience= String(formData.get('target_audience')?? '').trim();
  const tagline       = String(formData.get('tagline')        ?? '').trim();
  const photoUrl      = String(formData.get('photo_url')      ?? '').trim() || null;
  const opponentName  = String(formData.get('opponent_name')  ?? '').trim() || null;

  if (!fullName || !preferredName || !office || !district) {
    redirect('/setup?error=required');
  }

  await upsertCandidateProfile(s.campaignId, {
    fullName, preferredName, office, district, party, bio, keyPositions,
    voiceTone, targetAudience, tagline, photoUrl, opponentName,
  });

  redirect('/dashboard');
}
```

- [ ] **Step 2: Create src/app/setup/page.tsx**

```tsx
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { upsertProfileAction } from './actions';

const TONES = [
  ['conversational', 'Conversational — warm, direct, relatable'],
  ['formal',         'Formal — authoritative, measured, professional'],
  ['urgent',         'Urgent — energizing, action-oriented, passionate'],
  ['inspirational',  'Inspirational — hopeful, visionary, uplifting'],
] as const;

export default async function SetupPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const s = requireSession();
  const existing = await getCandidateProfile(s.campaignId);
  if (existing) redirect('/dashboard');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 24px' }}>
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ marginBottom: 32 }}>
          <span className="eyebrow">Welcome</span>
          <h1 style={{ margin: '4px 0 8px' }}>Set up your campaign</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            This takes about 3 minutes. Every AI draft will be written specifically for your candidate from this point on.
          </p>
        </div>

        {searchParams.error === 'required' && (
          <div className="banner warn" style={{ marginBottom: 20 }}>
            <div><div className="t">Required fields missing</div>
            <div className="b">Full name, preferred name, office, and district are required.</div></div>
          </div>
        )}

        <form action={upsertProfileAction} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h2 style={{ marginBottom: 16 }}>Candidate</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="field-label">Full name *</label>
                <input name="full_name" className="input" placeholder="Maria Rivera" required />
              </div>
              <div>
                <label className="field-label">Preferred name *</label>
                <input name="preferred_name" className="input" placeholder="Maria" required />
              </div>
              <div>
                <label className="field-label">Running for *</label>
                <input name="office" className="input" placeholder="California State Assembly" required />
              </div>
              <div>
                <label className="field-label">District / jurisdiction *</label>
                <input name="district" className="input" placeholder="District 12" required />
              </div>
              <div>
                <label className="field-label">Party</label>
                <input name="party" className="input" placeholder="Democratic" />
              </div>
              <div>
                <label className="field-label">Primary opponent name</label>
                <input name="opponent_name" className="input" placeholder="John Smith" />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="field-label">Candidate photo URL (optional)</label>
              <input name="photo_url" className="input" placeholder="https://..." />
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 16 }}>Campaign voice</h2>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">Short bio (2–3 sentences used in every AI draft)</label>
              <textarea name="bio" className="input" style={{ minHeight: 80 }}
                placeholder="A lifelong community advocate and small business owner, Maria has spent 20 years fighting for working families in the San Fernando Valley." />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">Campaign tagline</label>
              <input name="tagline" className="input" placeholder="A Voice for District 12" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">Target audience</label>
              <input name="target_audience" className="input" placeholder="Working families in the San Fernando Valley" />
            </div>
            <div>
              <label className="field-label">Key policy positions (one per line, 3–7)</label>
              <textarea name="key_positions" className="input" style={{ minHeight: 120 }}
                placeholder={"Expand access to affordable healthcare\nLower housing costs for renters\nInvest in public schools and teachers"} />
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Tone</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TONES.map(([value, label]) => (
                <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)' }}>
                  <input type="radio" name="voice_tone" value={value} defaultChecked={value === 'conversational'} />
                  <span style={{ fontSize: 14 }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <button className="btn primary" style={{ alignSelf: 'flex-end', padding: '12px 28px', fontSize: 15 }}>
            Complete setup →
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and test manually**

```bash
npm run dev
```

- Open `http://localhost:3000/setup` (while logged in as a campaign user without an existing profile)
- Verify: page renders all form sections
- Submit with missing required fields → verify error banner appears
- Submit with all fields filled → verify redirect to `/dashboard`
- Check Supabase `candidate_profiles` table — verify a row was inserted

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/app/setup/
git commit -m "feat: add candidate onboarding setup page"
```

---

### Task 7: Onboarding Gate in AppFrame

**Files:**
- Modify: `src/components/AppFrame.tsx`

**Interfaces:**
- Consumes: `getCandidateProfile` from `src/lib/candidate.ts`
- Produces: Any non-admin page that uses `AppFrame` will redirect to `/setup` if no candidate profile exists for the campaign

- [ ] **Step 1: Update AppFrame to check for profile**

Replace the full contents of `src/components/AppFrame.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { getCampaign } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { Sidebar } from './Sidebar';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', manager: 'Manager', approver: 'Approver', staff: 'Staff',
};

export async function AppFrame({ children }: { children: React.ReactNode }) {
  const s = requireSession();

  // super_admin manages all campaigns — no profile required
  if (s.role !== 'super_admin') {
    const profile = await getCandidateProfile(s.campaignId);
    if (!profile) redirect('/setup');
  }

  const campaign = await getCampaign(s.campaignId);

  return (
    <div className="shell">
      <Sidebar name={s.name} campaign={campaign?.name ?? ''} />
      <div className="main">
        <div className="topbar">
          <span className="eyebrow">Workspace</span>
          <span className="ws">{campaign?.name}</span>
          <div className="right">
            <span className="rolebadge">{ROLE_LABEL[s.role] ?? s.role}</span>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test the gate manually**

- Delete the candidate_profiles row for your test campaign in Supabase
- Navigate to `/dashboard` → verify redirect to `/setup`
- Complete the setup form → verify redirect back to `/dashboard` works
- Verify that `/admin` pages (which use `AdminFrame`, not `AppFrame`) are not affected

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/AppFrame.tsx
git commit -m "feat: gate dashboard behind candidate profile setup"
```

---

### Task 8: Candidate Profile Edit in Settings

**Files:**
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `getCandidateProfile` from `src/lib/candidate.ts`, `upsertProfileAction` from `src/app/setup/actions.ts`
- Produces: Settings page shows an editable "Candidate profile" section at the top, pre-filled with current values

- [ ] **Step 1: Update settings/page.tsx to add profile edit section**

At the top of the file, add the import and fetch:

```typescript
import { getCandidateProfile } from '@/lib/candidate';
import { upsertProfileAction } from '@/app/setup/actions';
```

Add `getCandidateProfile(s.campaignId)` to the existing `Promise.all`:

```typescript
const [campaign, rules, users, profile] = await Promise.all([
  getCampaign(s.campaignId),
  getDisclosureRules(),
  getUsers(s.campaignId),
  getCandidateProfile(s.campaignId),
]);
```

Add this section BEFORE the existing "Campaign" card (i.e., as the first card in the page):

```tsx
<div className="card" style={{ marginBottom: 24 }}>
  <h2 style={{ marginBottom: 16 }}>Candidate profile</h2>
  <form action={upsertProfileAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <label className="field-label">Full name</label>
        <input name="full_name" className="input" defaultValue={profile?.fullName ?? ''} required />
      </div>
      <div>
        <label className="field-label">Preferred name</label>
        <input name="preferred_name" className="input" defaultValue={profile?.preferredName ?? ''} required />
      </div>
      <div>
        <label className="field-label">Running for</label>
        <input name="office" className="input" defaultValue={profile?.office ?? ''} required />
      </div>
      <div>
        <label className="field-label">District</label>
        <input name="district" className="input" defaultValue={profile?.district ?? ''} required />
      </div>
      <div>
        <label className="field-label">Party</label>
        <input name="party" className="input" defaultValue={profile?.party ?? ''} />
      </div>
      <div>
        <label className="field-label">Primary opponent</label>
        <input name="opponent_name" className="input" defaultValue={profile?.opponentName ?? ''} />
      </div>
    </div>
    <div>
      <label className="field-label">Bio (2–3 sentences)</label>
      <textarea name="bio" className="input" style={{ minHeight: 72 }} defaultValue={profile?.bio ?? ''} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <label className="field-label">Tagline</label>
        <input name="tagline" className="input" defaultValue={profile?.tagline ?? ''} />
      </div>
      <div>
        <label className="field-label">Target audience</label>
        <input name="target_audience" className="input" defaultValue={profile?.targetAudience ?? ''} />
      </div>
    </div>
    <div>
      <label className="field-label">Key positions (one per line)</label>
      <textarea name="key_positions" className="input" style={{ minHeight: 100 }}
        defaultValue={profile?.keyPositions.join('\n') ?? ''} />
    </div>
    <div>
      <label className="field-label">Voice tone</label>
      <select name="voice_tone" className="input" defaultValue={profile?.voiceTone ?? 'conversational'}>
        <option value="conversational">Conversational</option>
        <option value="formal">Formal</option>
        <option value="urgent">Urgent</option>
        <option value="inspirational">Inspirational</option>
      </select>
    </div>
    <button className="btn primary" type="submit" style={{ alignSelf: 'flex-start' }}>Save profile</button>
  </form>
</div>
```

- [ ] **Step 2: Test manually**

- Navigate to `/settings`
- Verify the candidate profile section appears at the top, pre-filled
- Change a field and save — verify it persists after reload

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: add candidate profile edit section to settings"
```

---

## Phase 2 — AI Content Generation

### Task 9: Redesign ContentEditor with Platform-Aware Generation

**Files:**
- Modify: `src/components/ContentEditor.tsx`
- Modify: `src/app/content/new/page.tsx`

**Interfaces:**
- Consumes: `generateDraftAction` from `src/app/actions.ts` (already updated in Task 5), `PLATFORM_CONSTRAINTS` from `src/lib/prompt.ts`
- Produces: Redesigned creation UI — brief → generate → review inline — with no mock env-var messages visible

- [ ] **Step 1: Replace ContentEditor.tsx**

```typescript
'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createContentAction, generateDraftAction } from '@/app/actions';

const TYPES = [
  ['social_post', 'Social post'], ['reel', 'Reel script'], ['press_release', 'Press release'],
  ['email', 'Email'], ['sms', 'SMS'], ['ad_copy', 'Ad copy'], ['talking_points', 'Talking points'],
] as const;

const BRIEF_SUGGESTIONS = [
  'Announce our upcoming town hall event',
  'Respond to an opponent attack ad',
  'Share our healthcare plan highlights',
  'Thank volunteers after a successful event',
  'Push back on a false claim in the news',
];

export function ContentEditor() {
  const searchParams = useSearchParams();
  const [type, setType]           = useState((searchParams.get('type') as string) || 'social_post');
  const [instruction, setInstruction] = useState(searchParams.get('brief') || '');
  const [title, setTitle]         = useState('');
  const [body, setBody]           = useState('');
  const [isAi, setIsAi]           = useState(true);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState('');
  const [generated, setGenerated] = useState(false);

  async function generate() {
    if (!instruction.trim()) { setError('Describe what you want first.'); return; }
    setBusy(true); setError('');
    try {
      const out = await generateDraftAction(instruction, type);
      setTitle(out.title); setBody(out.text); setIsAi(true); setGenerated(true);
    } catch {
      setError('Could not generate a draft. Your AI key may not be configured or the spend cap has been reached.');
    } finally { setBusy(false); }
  }

  return (
    <form action={createContentAction}>
      <input type="hidden" name="isAiGenerated" value={isAi ? 'on' : 'off'} />

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Brief</h2>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {TYPES.map(([v, l]) => (
            <label key={v} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13,
              border: `1.5px solid ${type === v ? 'var(--accent)' : 'var(--line)'}`,
              background: type === v ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
              color: type === v ? 'var(--accent)' : 'var(--text-2)',
            }}>
              <input type="radio" name="type" value={v} checked={type === v}
                onChange={() => setType(v)} style={{ display: 'none' }} />
              {l}
            </label>
          ))}
        </div>
        <label className="field-label">What should this say?</label>
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder="e.g. Announce our healthcare town hall on Saturday"
          style={{ minHeight: 80, marginBottom: 10 }}
        />
        {!instruction && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {BRIEF_SUGGESTIONS.map(s => (
              <button key={s} type="button" className="btn"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setInstruction(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn primary" onClick={generate} disabled={busy} style={{ minWidth: 170 }}>
            {busy ? 'Writing your draft…' : generated ? 'Regenerate' : 'Generate with AI'}
          </button>
          {!generated && (
            <button type="button" className="btn" style={{ fontSize: 13 }}
              onClick={() => { setIsAi(false); setGenerated(true); }}>
              Write it myself
            </button>
          )}
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {generated && (
        <div className="card">
          <h2>Draft</h2>
          <label className="field-label">Title</label>
          <input type="text" name="title" className="input" value={title}
            onChange={e => setTitle(e.target.value)} required style={{ marginBottom: 12 }} />
          <label className="field-label">Body</label>
          <textarea name="body" className="input" value={body}
            onChange={e => setBody(e.target.value)} required style={{ minHeight: 180 }} />
          <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" className="btn primary">Save draft →</button>
            <label className="checkrow" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={isAi} onChange={e => setIsAi(e.target.checked)} />
              AI-generated (adds required disclosure)
            </label>
          </div>
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Update content/new/page.tsx to pass searchParams to ContentEditor**

```tsx
import { Suspense } from 'react';
import { AppFrame } from '@/components/AppFrame';
import { ContentEditor } from '@/components/ContentEditor';

export default function NewContent() {
  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Create</span><h1>New content</h1></div>
      </div>
      <Suspense>
        <ContentEditor />
      </Suspense>
    </AppFrame>
  );
}
```

(`useSearchParams()` requires a Suspense boundary in Next.js 14.)

- [ ] **Step 3: Test manually**

- Navigate to `/content/new`
- Verify: type selector shows as pills, brief suggestions appear, "Write it myself" shows
- Click a brief suggestion — verify it fills the textarea
- Click "Generate with AI" — verify draft appears below
- Click "Save draft" — verify redirect to content detail page
- Verify: no "[Draft — social_post]" text or env var messages in the output

- [ ] **Step 4: Commit**

```bash
git add src/components/ContentEditor.tsx src/app/content/new/page.tsx
git commit -m "feat: redesign content creation with platform-aware AI generation"
```

---

## Phase 3 — Real Scheduling

### Task 10: Content Scheduling Database Migration

**Files:**
- Create: `supabase/migrations/002_content_scheduling.sql`

**Interfaces:**
- Produces: `content_items` table gains `scheduled_at timestamptz`, `timezone text`, and `platforms text[]` columns

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/002_content_scheduling.sql
alter table content_items
  add column if not exists scheduled_at  timestamptz,
  add column if not exists timezone      text not null default 'America/Los_Angeles',
  add column if not exists platforms     text[] not null default '{}';

create index if not exists content_items_scheduled_idx
  on content_items (scheduled_at)
  where status = 'scheduled' and scheduled_at is not null;
```

- [ ] **Step 2: Apply migration via Supabase SQL Editor**

Paste and run. Expected: "Success. No rows returned."

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_content_scheduling.sql
git commit -m "feat: add scheduling columns to content_items"
```

---

### Task 11: Scheduling UI + scheduleWithTimeAction

**Files:**
- Modify: `src/components/ContentWizard.tsx`
- Modify: `src/app/actions.ts`
- Modify: `src/lib/data.ts`

**Interfaces:**
- Produces:
  - `scheduleWithTimeAction(id, scheduledAt, timezone, platforms): Promise<Result>` in `src/app/actions.ts`
  - `getScheduledToday(campaignId): Promise<ScheduledItem[]>` in `src/lib/data.ts`
  - Publish step in ContentWizard has a "Now / Schedule for later" toggle; "Schedule" reveals date/time/timezone inputs

- [ ] **Step 1: Add scheduleWithTimeAction to src/app/actions.ts**

Add after the existing `scheduleAction`:

```typescript
export async function scheduleWithTimeAction(
  id: string,
  scheduledAt: string,
  timezone: string,
  platforms: Platform[],
): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
  if (!item) return { ok: false, error: 'Content not found.' };
  if (!scheduledAt) return { ok: false, error: 'A scheduled date and time is required.' };

  await adminDb.from('content_items')
    .update({
      status: 'scheduled',
      scheduled_at: scheduledAt,
      timezone,
      platforms,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  await auditRepo.append({
    campaignId: item.campaignId, actorUserId: s.userId,
    action: 'schedule_content', entityType: 'content_item', entityId: id,
    details: { scheduledAt, timezone, platforms },
  });

  revalidatePath(`/content/${id}`);
  revalidatePath('/dashboard');
  return { ok: true };
}
```

- [ ] **Step 2: Add getScheduledToday to src/lib/data.ts**

Add at the bottom of `src/lib/data.ts`:

```typescript
export interface ScheduledItem {
  id: string; title: string; type: string;
  scheduledAt: string; platforms: string[]; status: string;
}

export async function getScheduledToday(campaignId: string): Promise<ScheduledItem[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { data } = await adminDb
    .from('content_items')
    .select('id, title, type, scheduled_at, platforms, status')
    .eq('campaign_id', campaignId)
    .in('status', ['scheduled', 'published'])
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', start.toISOString())
    .lte('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true });

  return (data ?? []).map(r => ({
    id: r.id, title: r.title, type: r.type,
    scheduledAt: r.scheduled_at, platforms: r.platforms ?? [], status: r.status,
  }));
}
```

- [ ] **Step 3: Update ContentWizard publish step**

In `src/components/ContentWizard.tsx`, add these imports at the top of the file:

```typescript
import { scheduleWithTimeAction } from '@/app/actions';
```

Add these state variables inside the `ContentWizard` function (alongside the existing `useState` calls):

```typescript
const [publishMode, setPublishMode]   = useState<'now' | 'schedule'>('now');
const [scheduledAt, setScheduledAt]   = useState('');
const [timezone, setTimezone]         = useState('America/Los_Angeles');
```

Replace the publish step JSX (the `currentStep === 'publish'` block) with:

```tsx
{currentStep === 'publish' && (
  <div style={{ maxWidth: 620, margin: '0 auto', width: '100%' }}>
    <div className="card">
      <h2>Publish</h2>

      {/* Platform selector — keep existing code unchanged */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Platforms</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {PLATFORMS.map(p => {
          const selected = platforms.includes(p);
          return (
            <label key={p} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 20,
              border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
              cursor: 'pointer', fontSize: 13,
              fontWeight: selected ? 600 : 400,
              background: selected ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
              color: selected ? 'var(--accent)' : 'var(--text-2)',
            }}>
              <input type="checkbox" checked={selected} onChange={() => togglePlatform(p)} style={{ display: 'none' }} />
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </label>
          );
        })}
      </div>

      {/* When toggle */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>When</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['now', 'schedule'] as const).map(mode => (
          <label key={mode} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 20, cursor: 'pointer', fontSize: 13,
            border: `1.5px solid ${publishMode === mode ? 'var(--accent)' : 'var(--line)'}`,
            background: publishMode === mode ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
            color: publishMode === mode ? 'var(--accent)' : 'var(--text-2)',
          }}>
            <input type="radio" name="publish_mode" value={mode}
              checked={publishMode === mode} onChange={() => setPublishMode(mode)} style={{ display: 'none' }} />
            {mode === 'now' ? 'Publish now' : 'Schedule for later'}
          </label>
        ))}
      </div>

      {publishMode === 'schedule' && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <label className="field-label">Date & time</label>
            <input type="datetime-local" className="input"
              value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)} style={{ width: 'auto' }} />
          </div>
          <div>
            <label className="field-label">Timezone</label>
            <select className="input" value={timezone} onChange={e => setTimezone(e.target.value)}>
              {['America/Los_Angeles','America/Denver','America/Chicago','America/New_York'].map(tz => (
                <option key={tz} value={tz}>{tz.replace('America/', '')}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {item.mediaUrl && (
        <div style={{ marginBottom: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Video</div>
          <video src={item.mediaUrl} controls style={{ width: '100%', maxWidth: 400, borderRadius: 8, background: '#000' }} />
        </div>
      )}

      <button
        className="btn primary"
        style={{ width: '100%' }}
        disabled={busy || platforms.length === 0 || (publishMode === 'schedule' && !scheduledAt)}
        onClick={() => {
          if (publishMode === 'now') {
            run(() => publishAction(item.id, platforms));
          } else {
            run(() => scheduleWithTimeAction(item.id, new Date(scheduledAt).toISOString(), timezone, platforms));
          }
        }}
      >
        {busy
          ? (publishMode === 'now' ? 'Publishing…' : 'Scheduling…')
          : publishMode === 'now'
            ? `Publish to ${platforms.length} platform${platforms.length !== 1 ? 's' : ''}`
            : scheduledAt
              ? `Schedule for ${new Date(scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : 'Pick a date and time'}
      </button>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  </div>
)}
```

- [ ] **Step 4: Test scheduling manually**

- Open any approved content item
- In the publish step, toggle "Schedule for later"
- Pick a date/time 5 minutes from now → click Schedule
- Verify: content status becomes `scheduled`, `scheduled_at` field is set in Supabase

- [ ] **Step 5: Commit**

```bash
git add src/components/ContentWizard.tsx src/app/actions.ts src/lib/data.ts
git commit -m "feat: add real scheduling with date/time picker"
```

---

### Task 12: Scheduled Publish Cron Job

**Files:**
- Create: `src/app/api/cron/publish/route.ts`
- Create: `vercel.ts`

**Interfaces:**
- Consumes: `adminDb`, `publisher` from `src/lib/services.ts`, `disclosureRepo` from `src/lib/repos.ts`
- Produces: GET `/api/cron/publish` — fetches all due scheduled items, publishes them, marks as `published`. Secured by `CRON_SECRET` env var.

- [ ] **Step 1: Create the cron route**

```typescript
// src/app/api/cron/publish/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { publisher } from '@/lib/services';
import { disclosureRepo } from '@/lib/repos';
import type { Platform } from '@/domain/types';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: dueItems } = await adminDb
    .from('content_items')
    .select('id, campaign_id, body, media_url, platforms')
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString());

  if (!dueItems?.length) {
    return NextResponse.json({ published: 0 });
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const item of dueItems) {
    try {
      const disclosures = await disclosureRepo.listFor(item.id);
      await publisher.publish({
        platforms: (item.platforms ?? []) as Platform[],
        text: item.body,
        disclosureText: disclosures[0]?.disclosureText ?? '',
        mediaUrl: item.media_url ?? undefined,
      });
      await adminDb.from('content_items')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('id', item.id);
      await adminDb.from('audit_entries').insert({
        campaign_id: item.campaign_id,
        action: 'cron_publish',
        entity_type: 'content_item',
        entity_id: item.id,
        details: { platforms: item.platforms },
      });
      results.push({ id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: String(e) });
    }
  }

  return NextResponse.json({
    published: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
}
```

- [ ] **Step 2: Create vercel.ts**

```typescript
// vercel.ts
import type { VercelConfig } from '@vercel/config';

export const config: VercelConfig = {
  crons: [{ path: '/api/cron/publish', schedule: '*/5 * * * *' }],
};
```

- [ ] **Step 3: Add CRON_SECRET to .env**

Add to `.env.local`:
```
CRON_SECRET=<generate a random 32-char string, e.g. openssl rand -hex 16>
```

- [ ] **Step 4: Test the cron endpoint manually**

```bash
# In a separate terminal with the dev server running:
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/publish
```

Expected response: `{"published":0}` (no due items) or a results array if you have scheduled items past their time.

Set a test item's `scheduled_at` to 1 minute in the past in Supabase, then re-run:
Expected: `{"published":1, "failed":0, ...}`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/publish/route.ts vercel.ts
git commit -m "feat: add scheduled publish cron job endpoint"
```

---

## Phase 4 — Dashboard Redesign

### Task 13: Dashboard Redesign

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getScheduledToday` from `src/lib/data.ts`
- Produces: Redesigned dashboard with action bar, today's schedule strip, and simplified needs-attention list

- [ ] **Step 1: Replace dashboard/page.tsx**

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { requireSession } from '@/lib/session';
import {
  getContentItems, getMonitoringResults, getMonthlySpend,
  getCampaign, getScheduledToday,
} from '@/lib/data';

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'IG', facebook: 'FB', x: 'X', linkedin: 'LI', tiktok: 'TK', youtube: 'YT',
};

export default async function Dashboard() {
  const s = requireSession();
  if (s.role === 'super_admin') redirect('/admin');

  const [items, monitoring, spend, campaign, todayScheduled] = await Promise.all([
    getContentItems(s.campaignId),
    getMonitoringResults(s.campaignId),
    getMonthlySpend(s.campaignId),
    getCampaign(s.campaignId),
    getScheduledToday(s.campaignId),
  ]);

  const needsAttention = items
    .filter(c => c.status === 'draft' || c.status === 'in_review')
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

  const cap = campaign?.monthlyCostCapCents ?? 0;
  const spendPct = cap > 0 ? Math.min((spend / cap) * 100, 100) : 0;

  return (
    <AppFrame>
      {/* Action bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <span className="eyebrow">Overview</span>
          <h1 style={{ margin: '2px 0 0' }}>Today</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn" href="/monitoring">Opponent feed</Link>
          <Link className="btn primary" href="/content/new">+ New content</Link>
        </div>
      </div>

      {/* Today's schedule strip */}
      {todayScheduled.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Going out today</div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {todayScheduled.map(item => (
              <Link key={item.id} href={`/content/${item.id}`} style={{
                display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px',
                border: '1px solid var(--line)', borderRadius: 10, minWidth: 180,
                background: 'var(--bg-hover)', textDecoration: 'none', color: 'inherit', flexShrink: 0,
              }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {item.platforms.slice(0, 3).map(p => (
                    <span key={p} style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 5px',
                      borderRadius: 4, background: 'var(--accent)', color: '#fff',
                    }}>{PLATFORM_ICON[p] ?? p.toUpperCase()}</span>
                  ))}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>
                  {item.title.slice(0, 48)}{item.title.length > 48 ? '…' : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {new Date(item.scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid cols-2">
        {/* Needs attention */}
        <div className="card">
          <h2>Needs attention</h2>
          {needsAttention.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <div className="muted" style={{ marginBottom: 12 }}>You're all caught up.</div>
              <Link className="btn primary" href="/content/new">Create new content</Link>
            </div>
          ) : (
            needsAttention.map(c => (
              <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <Link className="linkcell" href={`/content/${c.id}`}>{c.title}</Link>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {c.type.replace('_', ' ')} · updated {new Date(c.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <StatusPill status={c.status} />
              </div>
            ))
          )}
        </div>

        {/* Opponent pulse */}
        <div className="card">
          <h2>Opponent pulse</h2>
          {monitoring.slice(0, 3).map(m => (
            <div key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="eyebrow">{m.source}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{m.excerpt.slice(0, 120)}{m.excerpt.length > 120 ? '…' : ''}</div>
            </div>
          ))}
          {monitoring.length === 0 && <p className="muted">No monitoring results yet.</p>}
          <div className="spacer-y" />
          <Link className="btn" href="/monitoring">See full feed</Link>
        </div>
      </div>

      {/* Spend — single line */}
      <div style={{ marginTop: 20, padding: '14px 20px', border: '1px solid var(--line)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 16 }}>
        <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Monthly spend</span>
        <div style={{ flex: 1, height: 4, background: 'var(--bg-hover)', borderRadius: 2 }}>
          <div style={{
            height: '100%', borderRadius: 2, transition: 'width 0.3s',
            width: `${spendPct}%`,
            background: spendPct > 90 ? 'var(--bad)' : spendPct > 70 ? 'var(--warn)' : 'var(--accent)',
          }} />
        </div>
        <span style={{ fontSize: 13, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          ${(spend / 100).toFixed(2)} <span className="muted">/ ${(cap / 100).toFixed(2)}</span>
        </span>
      </div>
    </AppFrame>
  );
}
```

- [ ] **Step 2: Test manually**

- Open `/dashboard`
- Verify: action bar with "New content" and "Opponent feed" buttons
- Verify: "Going out today" strip only appears if there are scheduled items today
- Verify: "Needs attention" empty state shows CTA when nothing is pending
- Schedule a content item for today → reload → verify it appears in the strip

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: redesign dashboard with schedule strip and action bar"
```

---

## Phase 5 — Opponent Monitoring + Credibility

### Task 14: Monitoring Credibility Database Migration

**Files:**
- Create: `supabase/migrations/003_monitoring_credibility.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/003_monitoring_credibility.sql
alter table monitoring_results
  add column if not exists credibility  text not null default 'medium'
    check (credibility in ('high', 'medium', 'low')),
  add column if not exists category     text not null default 'news'
    check (category in ('news', 'social', 'blog', 'press_release')),
  add column if not exists dismissed_at timestamptz;

create index if not exists monitoring_results_credibility_idx
  on monitoring_results (campaign_id, credibility, captured_at desc);
```

- [ ] **Step 2: Apply migration via Supabase SQL Editor**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/003_monitoring_credibility.sql
git commit -m "feat: add credibility and category to monitoring_results"
```

---

### Task 15: Credibility Scoring Module

**Files:**
- Create: `src/lib/credibility.ts`
- Create: `src/lib/credibility.test.ts`

**Interfaces:**
- Produces:
  - `scoreCredibility(url: string): 'high' | 'medium' | 'low'`
  - `categorizeSource(url: string, source: string): 'news' | 'social' | 'blog' | 'press_release'`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/credibility.test.ts
import { describe, it, expect } from 'vitest';
import { scoreCredibility, categorizeSource } from './credibility';

describe('scoreCredibility', () => {
  it('returns high for major news domains', () => {
    expect(scoreCredibility('https://www.nytimes.com/article')).toBe('high');
    expect(scoreCredibility('https://apnews.com/story')).toBe('high');
    expect(scoreCredibility('https://latimes.com/politics')).toBe('high');
  });

  it('returns high for .gov domains', () => {
    expect(scoreCredibility('https://ca.gov/press')).toBe('high');
  });

  it('returns low for known misinformation domains', () => {
    expect(scoreCredibility('https://infowars.com/article')).toBe('low');
    expect(scoreCredibility('https://naturalnews.com/post')).toBe('low');
  });

  it('returns medium for unknown domains', () => {
    expect(scoreCredibility('https://somelocalblog.com/post')).toBe('medium');
  });

  it('returns medium for malformed URLs', () => {
    expect(scoreCredibility('not-a-url')).toBe('medium');
  });
});

describe('categorizeSource', () => {
  it('categorizes social media URLs as social', () => {
    expect(categorizeSource('https://x.com/user/status/123', 'x')).toBe('social');
    expect(categorizeSource('https://twitter.com/user', 'Twitter')).toBe('social');
    expect(categorizeSource('https://facebook.com/post', 'Facebook')).toBe('social');
  });

  it('categorizes major news as news', () => {
    expect(categorizeSource('https://politico.com/story', 'Politico')).toBe('news');
  });

  it('categorizes press release sources correctly', () => {
    expect(categorizeSource('https://prnewswire.com/release', 'PR Newswire')).toBe('press_release');
  });

  it('categorizes unknown sources as blog', () => {
    expect(categorizeSource('https://randomblog.com', 'Random Blog')).toBe('blog');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test src/lib/credibility.test.ts
```
Expected: FAIL — `Cannot find module './credibility'`

- [ ] **Step 3: Create src/lib/credibility.ts**

```typescript
// src/lib/credibility.ts

const HIGH_CREDIBILITY_DOMAINS = new Set([
  'nytimes.com', 'washingtonpost.com', 'latimes.com', 'politico.com',
  'thehill.com', 'apnews.com', 'reuters.com', 'bbc.com', 'npr.org',
  'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'pbs.org',
  'sfgate.com', 'sacbee.com', 'sfchronicle.com', 'calmatters.org',
]);

// Maintained manually — update as needed
const LOW_CREDIBILITY_DOMAINS = new Set([
  'infowars.com', 'naturalnews.com', 'breitbart.com', 'beforeitsnews.com',
  'worldnewsdailyreport.com', 'thedailybuzzer.com', 'empirenews.net',
  'yournewswire.com', 'abcnews.com.co', 'newslo.com',
]);

const SOCIAL_DOMAINS = new Set([
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'youtube.com', 'linkedin.com',
]);

const PRESS_RELEASE_KEYWORDS = ['prnewswire', 'businesswire', 'globenewswire', 'prlog', 'press release'];

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function scoreCredibility(url: string): 'high' | 'medium' | 'low' {
  const domain = getDomain(url);
  if (!domain) return 'medium';
  if (domain.endsWith('.gov')) return 'high';
  if (HIGH_CREDIBILITY_DOMAINS.has(domain)) return 'high';
  if (LOW_CREDIBILITY_DOMAINS.has(domain)) return 'low';
  return 'medium';
}

export function categorizeSource(
  url: string,
  source: string,
): 'news' | 'social' | 'blog' | 'press_release' {
  const domain = getDomain(url) ?? '';
  const sourceLower = source.toLowerCase();

  if ([...SOCIAL_DOMAINS].some(d => domain.includes(d))) return 'social';
  if (PRESS_RELEASE_KEYWORDS.some(k => sourceLower.includes(k) || domain.includes(k))) return 'press_release';
  if (HIGH_CREDIBILITY_DOMAINS.has(domain)) return 'news';
  return 'blog';
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test src/lib/credibility.test.ts
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/credibility.ts src/lib/credibility.test.ts
git commit -m "feat: add credibility scoring module with unit tests"
```

---

### Task 16: Credibility Scoring on Ingest + Monitoring Data Layer

**Files:**
- Modify: `src/app/api/monitoring/ingest/route.ts`
- Modify: `src/lib/data.ts` — update `getMonitoringResults` to include credibility/category

**Interfaces:**
- Consumes: `scoreCredibility`, `categorizeSource` from `src/lib/credibility.ts`
- Produces: Every new monitoring result stored with `credibility` and `category` fields; `getMonitoringResults` returns those fields

- [ ] **Step 1: Read the current ingest route**

```bash
cat src/app/api/monitoring/ingest/route.ts
```

- [ ] **Step 2: Update the ingest route to score credibility on write**

After the existing imports, add:

```typescript
import { scoreCredibility, categorizeSource } from '@/lib/credibility';
```

In the insert statement (wherever `monitoring_results` is written), add the two new fields:

```typescript
credibility: scoreCredibility(result.url),
category:    categorizeSource(result.url, result.source),
```

- [ ] **Step 3: Update getMonitoringResults in src/lib/data.ts**

Find the `MonitoringResult` interface and add the new fields:

```typescript
export interface MonitoringResult {
  id: string; campaignId: string; source: string; opponent?: string;
  excerpt: string; url: string; capturedAt: string;
  credibility: 'high' | 'medium' | 'low';
  category: 'news' | 'social' | 'blog' | 'press_release';
}
```

Update `getMonitoringResults` to select and map the new columns:

```typescript
export async function getMonitoringResults(campaignId: string): Promise<MonitoringResult[]> {
  const { data } = await adminDb
    .from('monitoring_results')
    .select('*')
    .eq('campaign_id', campaignId)
    .is('dismissed_at', null)
    .order('captured_at', { ascending: false })
    .limit(100);

  return (data ?? []).map(r => ({
    id: r.id, campaignId: r.campaign_id, source: r.source,
    opponent: r.opponent ?? undefined, excerpt: r.excerpt, url: r.url,
    capturedAt: r.captured_at,
    credibility: (r.credibility ?? 'medium') as 'high' | 'medium' | 'low',
    category: (r.category ?? 'news') as 'news' | 'social' | 'blog' | 'press_release',
  }));
}
```

- [ ] **Step 4: Add dismissMonitoringAction to src/app/actions.ts**

```typescript
export async function dismissMonitoringAction(id: string): Promise<Result> {
  requireSession();
  await adminDb.from('monitoring_results')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/monitoring');
  revalidatePath('/dashboard');
  return { ok: true };
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/monitoring/ingest/route.ts src/lib/data.ts src/app/actions.ts
git commit -m "feat: add credibility scoring to monitoring ingest and data layer"
```

---

### Task 17: Monitoring Page Redesign

**Files:**
- Modify: `src/components/MonitoringTable.tsx`
- Modify: `src/app/monitoring/page.tsx`

**Interfaces:**
- Consumes: `MonitoringResult` (with `credibility`, `category`) from `src/lib/data.ts`, `dismissMonitoringAction` from `src/app/actions.ts`
- Produces: Redesigned monitoring page with filter bar, credibility badges, low-credibility rebuttal warning, rebuttal pre-fill redirect, and manual entry form

- [ ] **Step 1: Replace MonitoringTable.tsx**

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MonitoringResult } from '@/lib/data';
import { dismissMonitoringAction } from '@/app/actions';

const CREDIBILITY_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: '● High credibility',   color: '#16a34a', bg: 'color-mix(in srgb, #16a34a 12%, transparent)' },
  medium: { label: '● Medium credibility', color: '#d97706', bg: 'color-mix(in srgb, #d97706 12%, transparent)' },
  low:    { label: '● Low credibility',    color: '#dc2626', bg: 'color-mix(in srgb, #dc2626 12%, transparent)' },
};

const CATEGORY_LABEL: Record<string, string> = {
  news: 'News', social: 'Social', blog: 'Blog', press_release: 'Press Release',
};

type Filter = 'all' | 'high' | 'medium' | 'low' | 'news' | 'social';

function detectTrending(results: MonitoringResult[]): Set<string> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const recent = results.filter(r => r.capturedAt > sixHoursAgo);

  // Group by domain
  const domainCount = new Map<string, string[]>();
  for (const r of recent) {
    try {
      const domain = new URL(r.url).hostname.replace(/^www\./, '');
      if (!domainCount.has(domain)) domainCount.set(domain, []);
      domainCount.get(domain)!.push(r.id);
    } catch { /* skip malformed URLs */ }
  }

  const trendingIds = new Set<string>();
  for (const ids of domainCount.values()) {
    if (ids.length >= 3) ids.forEach(id => trendingIds.add(id));
  }
  return trendingIds;
}

export function MonitoringTable({ results }: { results: MonitoringResult[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [warnId, setWarnId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const trendingIds = detectTrending(results);

  const filtered = results.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'high' || filter === 'medium' || filter === 'low') return r.credibility === filter;
    if (filter === 'news' || filter === 'social') return r.category === filter;
    return true;
  });

  function handleRebuttal(result: MonitoringResult) {
    if (result.credibility === 'low') {
      setWarnId(result.id);
      return;
    }
    goToRebuttal(result);
  }

  function goToRebuttal(result: MonitoringResult) {
    const brief = encodeURIComponent(
      `Respond to this story from ${result.source}: "${result.excerpt.slice(0, 200)}"`
    );
    router.push(`/content/new?brief=${brief}&type=social_post`);
  }

  async function handleDismiss(id: string) {
    setDismissing(id);
    await dismissMonitoringAction(id);
    setDismissing(null);
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',    label: 'All' },
    { key: 'high',   label: '🟢 High' },
    { key: 'medium', label: '🟡 Medium' },
    { key: 'low',    label: '🔴 Low' },
    { key: 'news',   label: 'News' },
    { key: 'social', label: 'Social' },
  ];

  return (
    <div>
      {/* Filter bar */}
      <div className="btnrow" style={{ marginBottom: 20 }}>
        {FILTERS.map(f => (
          <button key={f.key} className="btn"
            onClick={() => setFilter(f.key)}
            style={filter === f.key ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Low-credibility rebuttal warning */}
      {warnId && (() => {
        const result = results.find(r => r.id === warnId)!;
        return (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
          }}>
            <div className="card" style={{ maxWidth: 480, width: '90%' }}>
              <h2 style={{ marginBottom: 10 }}>⚠️ Low-credibility source</h2>
              <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                <strong>{result.source}</strong> has a low credibility rating.
                Responding publicly may give this story more attention than it deserves.
                Many campaigns choose to monitor and ignore low-credibility sources.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => setWarnId(null)}>
                  Ignore this story
                </button>
                <button className="btn primary" style={{ flex: 1 }}
                  onClick={() => { setWarnId(null); goToRebuttal(result); }}>
                  Draft rebuttal anyway →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Results */}
      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted">No results for this filter.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map(result => {
          const badge = CREDIBILITY_BADGE[result.credibility];
          const trending = trendingIds.has(result.id);
          return (
            <div key={result.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{result.source}</span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 20,
                    color: badge.color, background: badge.bg, fontWeight: 600,
                  }}>{badge.label}</span>
                  <span className="pill" style={{ fontSize: 10 }}>{CATEGORY_LABEL[result.category]}</span>
                  {trending && (
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 20,
                      background: 'color-mix(in srgb, var(--warn) 15%, transparent)',
                      color: 'var(--warn)', fontWeight: 700,
                    }}>🔥 Trending</span>
                  )}
                </div>
                <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {new Date(result.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>

              <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 14px', color: 'var(--text)' }}>
                {result.excerpt}
              </p>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn primary" style={{ fontSize: 12, padding: '6px 14px' }}
                  onClick={() => handleRebuttal(result)}>
                  Draft rebuttal
                </button>
                {result.url && (
                  <a href={result.url} target="_blank" rel="noopener noreferrer"
                    className="btn" style={{ fontSize: 12, padding: '6px 14px' }}>
                    Read article ↗
                  </a>
                )}
                <button className="btn" style={{ fontSize: 12, padding: '6px 14px', marginLeft: 'auto', color: 'var(--text-3)' }}
                  disabled={dismissing === result.id}
                  onClick={() => handleDismiss(result.id)}>
                  {dismissing === result.id ? 'Dismissing…' : 'Dismiss'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update monitoring/page.tsx to add manual entry**

Replace the full contents:

```tsx
import { AppFrame } from '@/components/AppFrame';
import { MonitoringTable } from '@/components/MonitoringTable';
import { requireSession } from '@/lib/session';
import { getMonitoringResults } from '@/lib/data';
import { adminDb } from '@/lib/supabase';
import { uid } from '@/lib/store';
import { scoreCredibility, categorizeSource } from '@/lib/credibility';
import { revalidatePath } from 'next/cache';

async function addManualEntryAction(formData: FormData) {
  'use server';
  const { requireSession } = await import('@/lib/session');
  const s = requireSession();
  const url      = String(formData.get('url')      ?? '').trim();
  const headline = String(formData.get('headline') ?? '').trim();
  const source   = String(formData.get('source')   ?? '').trim();
  if (!headline || !source) return;
  const { adminDb } = await import('@/lib/supabase');
  const { uid }     = await import('@/lib/store');
  const { scoreCredibility, categorizeSource } = await import('@/lib/credibility');
  await adminDb.from('monitoring_results').insert({
    id: uid(),
    campaign_id: s.campaignId,
    source,
    excerpt: headline,
    url: url || '',
    captured_at: new Date().toISOString(),
    credibility: scoreCredibility(url),
    category:    categorizeSource(url, source),
  });
  revalidatePath('/monitoring');
}

export default async function Monitoring() {
  const s = requireSession();
  const results = await getMonitoringResults(s.campaignId);

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Intelligence</span><h1>Opponent monitoring</h1></div>
      </div>

      <MonitoringTable results={results} />

      {/* Manual entry */}
      <div className="card" style={{ marginTop: 32 }}>
        <h2 style={{ marginBottom: 12 }}>Add story manually</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Saw something offline? Add it here — a TV segment, a flyer, anything worth tracking.
        </p>
        <form action={addManualEntryAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label className="field-label">Headline / description *</label>
              <input name="headline" className="input" required placeholder="Smith claimed Rivera raised taxes" />
            </div>
            <div>
              <label className="field-label">Source name *</label>
              <input name="source" className="input" required placeholder="Local TV / Flyer / Twitter" />
            </div>
          </div>
          <div>
            <label className="field-label">URL (optional)</label>
            <input name="url" className="input" placeholder="https://..." />
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Add to monitoring</button>
        </form>
      </div>
    </AppFrame>
  );
}
```

- [ ] **Step 3: Test manually**

- Navigate to `/monitoring`
- Verify: filter bar works, credibility badges show, trending badge appears when appropriate
- Click "Draft rebuttal" on a high-credibility result → verify redirect to `/content/new` with pre-filled brief
- Click "Draft rebuttal" on a low-credibility result → verify warning modal appears
- Submit manual entry form → verify it appears in the list

- [ ] **Step 4: Commit**

```bash
git add src/components/MonitoringTable.tsx src/app/monitoring/page.tsx
git commit -m "feat: redesign monitoring with credibility scores, filters, and rebuttal flow"
```

---

## Phase 6 — UX Polish

### Task 18: Toast Notification System

**Files:**
- Create: `src/components/Toast.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/ContentWizard.tsx` — add toasts on publish/schedule
- Modify: `src/app/globals.css` — add toast styles

**Interfaces:**
- Produces: `useToast()` hook with `addToast(message, type?)` callable from any client component

- [ ] **Step 1: Create src/components/Toast.tsx**

```typescript
'use client';

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType; }
interface ToastContextType { addToast: (message: string, type?: ToastType) => void; }

const ToastContext = createContext<ToastContextType>({ addToast: () => {} });

export function useToast() { return useContext(ToastContext); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++counter.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 2: Add toast styles to globals.css**

Append to the end of `src/app/globals.css`:

```css
/* ── Toasts ────────────────────────────────────────────────────────────────── */
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 9999;
  pointer-events: none;
}
.toast {
  padding: 12px 18px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  max-width: 360px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  animation: toast-in 0.2s ease;
  pointer-events: auto;
}
.toast-success { background: var(--accent); color: #fff; }
.toast-error   { background: var(--bad);    color: #fff; }
.toast-info    { background: var(--text);   color: var(--bg); }

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 3: Wrap layout with ToastProvider**

In `src/app/layout.tsx`, import and wrap the children:

```typescript
import { ToastProvider } from '@/components/Toast';

// Inside the <body> tag, wrap {children}:
<ToastProvider>
  {children}
</ToastProvider>
```

- [ ] **Step 4: Add toasts to ContentWizard publish/schedule**

In `src/components/ContentWizard.tsx`, import and use the toast:

```typescript
import { useToast } from '@/components/Toast';

// Inside the ContentWizard function:
const { addToast } = useToast();
```

Update the `run` function to show toasts:

```typescript
const run = useCallback(async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
  setBusy(true);
  setError('');
  const r = await fn();
  setBusy(false);
  if (!r.ok) {
    setError(r.error ?? 'Something went wrong.');
    addToast(r.error ?? 'Something went wrong.', 'error');
  } else {
    addToast(
      publishMode === 'schedule'
        ? `Scheduled for ${new Date(scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
        : `Published to ${platforms.length} platform${platforms.length !== 1 ? 's' : ''}`,
      'success'
    );
    router.refresh();
  }
}, [router, addToast, publishMode, scheduledAt, platforms]);
```

- [ ] **Step 5: Test manually**

- Publish a content item — verify green toast appears bottom-right
- Schedule a content item — verify "Scheduled for …" toast
- Trigger an error (e.g. publish with no platforms selected — should be blocked by the disabled state, so try another error path) — verify red toast

- [ ] **Step 6: Commit**

```bash
git add src/components/Toast.tsx src/app/globals.css src/app/layout.tsx src/components/ContentWizard.tsx
git commit -m "feat: add toast notification system"
```

---

### Task 19: formatDate Utility

**Files:**
- Create: `src/lib/formatDate.ts`
- Create: `src/lib/formatDate.test.ts`

**Interfaces:**
- Produces: `formatDate(iso: string, style?: 'relative' | 'datetime' | 'date'): string`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/formatDate.test.ts
import { describe, it, expect } from 'vitest';
import { formatDate } from './formatDate';

const now = new Date();
const minutesAgo   = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
const hoursAgo     = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
const daysAgo      = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

describe('formatDate relative', () => {
  it('returns "just now" for < 1 minute ago', () => {
    expect(formatDate(minutesAgo(0))).toBe('just now');
  });
  it('returns minutes for < 1 hour ago', () => {
    expect(formatDate(minutesAgo(5))).toBe('5 minutes ago');
  });
  it('returns singular minute', () => {
    expect(formatDate(minutesAgo(1))).toBe('1 minute ago');
  });
  it('returns hours for < 24 hours ago', () => {
    expect(formatDate(hoursAgo(3))).toBe('3 hours ago');
  });
  it('returns "yesterday" for ~1 day ago', () => {
    expect(formatDate(daysAgo(1))).toBe('yesterday');
  });
  it('returns days for 2–6 days ago', () => {
    expect(formatDate(daysAgo(4))).toBe('4 days ago');
  });
});

describe('formatDate datetime', () => {
  it('returns a human-readable datetime string', () => {
    const result = formatDate('2026-06-22T14:30:00Z', 'datetime');
    expect(result).toContain('Jun');
    expect(result).toContain('at');
  });
});

describe('formatDate date', () => {
  it('returns a short date string', () => {
    const result = formatDate('2026-06-22T00:00:00Z', 'date');
    expect(result).toContain('Jun');
    expect(result).toContain('2026');
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npm test src/lib/formatDate.test.ts
```

- [ ] **Step 3: Create src/lib/formatDate.ts**

```typescript
// src/lib/formatDate.ts

export function formatDate(iso: string, style: 'relative' | 'datetime' | 'date' = 'relative'): string {
  const date = new Date(iso);

  if (style === 'date') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (style === 'datetime') {
    return (
      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    );
  }

  const diffMs    = Date.now() - date.getTime();
  const diffMins  = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays  = Math.floor(diffHours / 24);

  if (diffMins < 1)  return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7)  return `${diffDays} days ago`;
  return formatDate(iso, 'date');
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npm test src/lib/formatDate.test.ts
```

- [ ] **Step 5: Replace all raw date calls across the app**

Search for `.toLocaleString()` and `.toLocaleTimeString()` usage:

```bash
grep -rn "toLocaleString\|toLocaleTimeString\|toLocaleDateString" src/app src/components
```

Replace each with the appropriate `formatDate()` call. Examples:
- `new Date(c.updatedAt).toLocaleDateString()` → `formatDate(c.updatedAt, 'date')`
- `new Date(r.created_at).toLocaleString()` → `formatDate(r.created_at, 'datetime')`
- `new Date(invite.expires_at).toLocaleString()` → `formatDate(invite.expires_at, 'datetime')`

- [ ] **Step 6: Commit**

```bash
git add src/lib/formatDate.ts src/lib/formatDate.test.ts
git commit -m "feat: add formatDate utility and replace raw date calls"
```

---

### Task 20: Skeleton Screens + Empty States

**Files:**
- Create: `src/components/SkeletonRow.tsx`
- Modify: `src/app/globals.css` — add skeleton animation
- Modify: `src/app/content/page.tsx` — wrap table in Suspense with skeleton fallback + improved empty state

**Interfaces:**
- Produces: `<SkeletonRow cols={n} />` component, skeleton animation CSS, improved empty state on content list

- [ ] **Step 1: Add skeleton CSS to globals.css**

Append to `src/app/globals.css`:

```css
/* ── Skeletons ─────────────────────────────────────────────────────────────── */
.skeleton {
  background: linear-gradient(90deg, var(--bg-hover) 25%, var(--line) 50%, var(--bg-hover) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s infinite;
  border-radius: 4px;
  display: inline-block;
}
@keyframes skeleton-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 2: Create src/components/SkeletonRow.tsx**

```typescript
export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '14px 16px' }}>
          <span className="skeleton" style={{
            height: 14,
            width: i === 0 ? '70%' : '40%',
            display: 'block',
          }} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} cols={cols} />
      ))}
    </>
  );
}
```

- [ ] **Step 3: Update content/page.tsx with better empty state**

Replace the empty-list JSX inside `content/page.tsx`:

```tsx
{items.length === 0 && (
  <tr>
    <td colSpan={4} style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div className="muted" style={{ marginBottom: 12 }}>
        No content {filter ? `with status "${filter.replace('_', ' ')}"` : 'yet'}.
      </div>
      {!filter && (
        <a href="/content/new" className="btn primary">Create your first post →</a>
      )}
    </td>
  </tr>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/SkeletonRow.tsx src/app/globals.css src/app/content/page.tsx
git commit -m "feat: add skeleton loading and improved empty states"
```

---

### Task 21: Mobile CSS Fixes + Breadcrumbs

**Files:**
- Modify: `src/app/globals.css` — mobile breakpoints
- Modify: `src/components/Sidebar.tsx` — mobile bottom tab bar
- Modify: `src/app/content/[id]/page.tsx` — add breadcrumb

**Interfaces:**
- Produces: App usable on 375px–768px screens; bottom tab bar on mobile; breadcrumb on content detail

- [ ] **Step 1: Fix mobile layout in globals.css**

Find the existing `@media (max-width: 860px)` block and update/replace the responsive rules:

```css
/* ── Responsive / Mobile ────────────────────────────────────────────────────── */
@media (max-width: 860px) {
  .shell { flex-direction: column; }
  .sidebar { display: none; }          /* Hidden — replaced by bottom tab bar */
  .main { padding-bottom: 64px; }      /* Space for bottom tab bar */

  .grid.cols-2,
  .grid.cols-3 { grid-template-columns: 1fr; }

  .admin-stat-grid { grid-template-columns: repeat(2, 1fr); }

  /* Make tables scroll horizontally */
  .card table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }

  /* Login card */
  .login-card { max-width: 100%; margin: 0 16px; }
}

@media (max-width: 640px) {
  .admin-stat-grid { grid-template-columns: 1fr; }
  .pagehead { flex-direction: column; align-items: flex-start; gap: 12px; }
  .pagehead .actions { width: 100%; }
  .pagehead .actions .btn { width: 100%; text-align: center; }
}

/* Bottom tab bar — mobile only */
.mobile-tabs {
  display: none;
}
@media (max-width: 860px) {
  .mobile-tabs {
    display: flex;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--bg);
    border-top: 1px solid var(--line);
    z-index: 100;
  }
  .mobile-tabs a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 0;
    font-size: 10px;
    color: var(--text-3);
    text-decoration: none;
    font-weight: 500;
  }
  .mobile-tabs a.active { color: var(--accent); }
  .mobile-tabs a svg { width: 22px; height: 22px; }
}
```

- [ ] **Step 2: Add mobile tab bar to Sidebar.tsx**

In `src/components/Sidebar.tsx`, after the closing `</aside>` tag, add:

```tsx
{/* Mobile bottom tab bar */}
<nav className="mobile-tabs">
  {NAV.map(n => (
    <Link key={n.href} href={n.href} className={isActive(n.href) ? 'active' : ''}>
      {n.icon}
      {n.label}
    </Link>
  ))}
</nav>
```

- [ ] **Step 3: Add breadcrumb to content/[id]/page.tsx**

At the top of the page JSX (before the existing `pagehead`), add:

```tsx
<div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
  <Link href="/content" style={{ color: 'var(--text-3)', textDecoration: 'none' }}>Content</Link>
  <span style={{ margin: '0 6px' }}>›</span>
  <span>{item.title}</span>
</div>
```

- [ ] **Step 4: Add aria-labels to icon-only buttons and status pills**

In `src/components/StatusPill.tsx`, ensure each pill has an aria-label:

```tsx
<span className={`pill ${status}`} aria-label={`Status: ${status.replace('_', ' ')}`}>
  {LABELS[status] ?? status}
</span>
```

- [ ] **Step 5: Test on mobile viewport**

In Chrome DevTools: toggle device toolbar → select iPhone 12 Pro (390px width)
- Verify: sidebar is hidden, bottom tab bar is visible and functional
- Verify: content list table scrolls horizontally rather than overflowing
- Verify: dashboard two-column grid becomes single column

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/components/Sidebar.tsx src/app/content/[id]/page.tsx
git commit -m "feat: fix mobile layout, add bottom tab bar, breadcrumbs, and aria labels"
```

---

### Task 22: Final Typecheck + Full Manual Smoke Test

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 2: Run all unit tests**

```bash
npm test
```
Expected: All tests pass (prompt, credibility, formatDate, candidate module shape).

- [ ] **Step 3: Full smoke test — walk the complete user journey**

With the dev server running (`npm run dev`):

1. Log in as a campaign user with no candidate profile → verify redirect to `/setup`
2. Fill in the setup form and submit → verify redirect to `/dashboard`
3. From dashboard, click "New content" → verify `/content/new` loads with type picker and brief suggestions
4. Click a brief suggestion, then "Generate with AI" → verify AI draft appears (personalized with candidate name)
5. Save the draft → verify redirect to content detail page with breadcrumb
6. Walk through the wizard: approve text → (skip video for non-reel) → confirm disclosure → reach publish step
7. In publish step, toggle "Schedule for later" → pick a date/time → click Schedule → verify toast appears
8. Check Supabase: verify `scheduled_at` is set on the content item
9. Navigate to `/monitoring` → verify credibility badges show on results
10. Click "Draft rebuttal" on a high-credibility result → verify pre-filled `/content/new`
11. Click "Draft rebuttal" on a low-credibility result → verify warning modal
12. Submit manual entry form → verify it appears in the feed
13. Navigate to `/settings` → verify candidate profile section is editable and saves
14. On mobile viewport in DevTools → verify bottom tab bar and readable layouts

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: production-ready — all phases complete"
```
