# Campaign App — Production-Ready Design Spec

**Date:** 2026-06-22  
**Status:** Approved for implementation  
**Audience:** 1–2 users per campaign (campaign owner + optional manager)  
**Core job:** Create and publish quality, on-brand content fast

---

## Context & Goals

The app is a political campaign management tool. Right now it has the right structure but several critical gaps make it unusable in production:

1. No candidate profile — AI drafts know nothing about the candidate
2. AI content generation has zero campaign context — produces generic placeholder text
3. Scheduling is fake — no timestamp stored, nothing executes later
4. Opponent monitoring shows raw feeds with no credibility signal
5. UX has rough edges: no toasts, poor empty states, broken mobile layout, mock messages leaking into UI

The target user is **1–2 people**: the campaign owner (often the candidate) and sometimes their manager. This is NOT a multi-team enterprise tool. Every design decision favors speed and simplicity over configurability.

**Success criteria:**
- Owner/manager can go from idea → published post in under 2 minutes
- Every AI draft is fully personalized to the candidate — zero generic placeholders
- Monitoring shows credibility signal so they know what's worth responding to
- The app works well on mobile (manager is often at events)
- No mock messages, no broken flows, no silent failures in production

---

## Section 1: Candidate Profile

### Problem
The `campaigns` table has: `id`, `name`, `jurisdictions`, `monthly_cost_cap_cents`. Zero candidate-specific data. Every AI prompt receives no context about who it's writing for.

### Solution

**New `candidate_profiles` table** (1-to-1 with campaigns):

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | primary key |
| `campaign_id` | uuid | FK → campaigns |
| `full_name` | text | e.g. "Maria Rivera" |
| `preferred_name` | text | e.g. "Maria" — used in first-person copy |
| `office` | text | e.g. "California State Assembly" |
| `district` | text | e.g. "District 12" |
| `party` | text | e.g. "Democratic" |
| `bio` | text | 2–3 sentence bio used in all AI prompts |
| `key_positions` | text[] | Array of 3–7 policy bullet points |
| `voice_tone` | text | One of: "formal", "conversational", "urgent", "inspirational" |
| `target_audience` | text | e.g. "Working families in the San Fernando Valley" |
| `tagline` | text | Campaign slogan |
| `photo_url` | text | Headshot URL used for HeyGen avatar reference |
| `opponent_name` | text | Primary opponent's name (pre-fills monitoring) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Onboarding gate**: On first login, if `candidate_profiles` has no record for the campaign, redirect to `/setup` — a one-page form to fill in the profile before accessing the dashboard. Cannot skip. Takes ~3 minutes.

**Editable later**: Full profile editable from Settings → Candidate Profile.

**AI prompt injection** (used everywhere AI generates content):

```
You are a political communications expert writing on behalf of {{preferred_name}} (full name: {{full_name}}).

Candidate context:
- Running for: {{office}}, {{district}}
- Party: {{party}}
- Bio: {{bio}}
- Key positions: {{key_positions joined with newlines}}
- Campaign tagline: "{{tagline}}"
- Target audience: {{target_audience}}
- Voice/tone: {{voice_tone}}

Opponent: {{opponent_name}}

Write in first person as the candidate unless the content type is a press release (third person).
Never use placeholder text like [Name] or [District]. Use the actual values above.
```

This prompt prefix is prepended to every content generation call in `src/integrations/index.ts`.

---

## Section 2: AI Content Generation — Overhaul

### Problem
- `ContentEditor` collects type + brief but generates content with zero candidate context
- The published Claude model string may be stale
- Cost is hardcoded at 9 cents regardless of content type
- Mock generator output leaks into UI (shows env var instructions)
- No platform-aware generation (same prompt for X as for email)

### Solution

**Simplified new-content flow** (replaces the current multi-step wizard for non-video types):

```
Step 1: Pick content type  →  Step 2: Write brief  →  Step 3: Review & edit AI draft  →  Step 4: Pick platforms + publish/schedule
```

The wizard (multi-step with stepper UI) is only used for **reels** (which require video generation). All other types use the simplified 4-step flow.

**Platform-aware generation**: Each `ContentType` maps to a platform constraint injected into the prompt:

| Type | Platform constraint added to prompt |
|------|-------------------------------------|
| `social_post` (X) | "Max 280 characters. No hashtags unless natural." |
| `social_post` (Instagram) | "Caption under 2,200 characters. End with 3–5 relevant hashtags." |
| `social_post` (Facebook) | "Conversational, can be longer. No character limit." |
| `email` | "Subject line on first line prefixed 'Subject:'. Then body with greeting and sign-off." |
| `sms` | "Max 160 characters. No URLs. Direct call to action." |
| `press_release` | "Third person. Include: headline, dateline, 3–4 paragraphs, boilerplate at end." |
| `talking_points` | "Bullet list, 5–7 points. Each under 2 sentences. Start with the strongest." |
| `ad_copy` | "Punchy headline (max 8 words), then 2 supporting sentences, then CTA." |

**Brief suggestions**: When the user focuses the brief textarea, show 3–4 quick-pick suggestions based on recent monitoring activity (e.g. "Respond to Smith's tax claim from yesterday").

**Generation UI**:
- "Generate with AI" button → shows a pulsing status line: "Writing your draft…"
- Draft appears inline in the same textarea once complete (Server Actions don't stream — show a spinner during generation, then replace the textarea content on completion)
- "Regenerate" button appears after first draft (re-runs with same brief)
- "I'll write it myself" link skips generation entirely

**Remove mock UI leakage**: If `LLM_API_KEY` is not set, show a settings-page warning (admin only), not inline in the content editor. The editor should fail gracefully with: "AI generation is not configured. Contact your administrator."

**Cost tracking**: Replace hardcoded `9_00` cents with a lookup table per content type:

| Type | Estimated cost (cents) |
|------|----------------------|
| social_post | 3 |
| sms | 2 |
| talking_points | 5 |
| email | 8 |
| press_release | 12 |
| ad_copy | 4 |
| reel (script) | 10 |

---

## Section 3: Dashboard — Morning Command Center

### Problem
Current dashboard shows stats then a "needs attention" table and a monitoring preview. For 1–2 users it should answer: "What do I need to do right now, and what's happening?"

### Solution

**Redesigned layout** (top to bottom):

**1. Action bar** — always pinned at top of content area:
```
[+ New content]   [Draft rebuttal ▾]
```
These are the two most common daily actions. Always visible.

**2. Today's schedule strip** — horizontal scrollable row of content going out today (or next 24h):
```
[Instagram · 9am]  [Email · 12pm]  [Facebook · 5pm]
```
Each card shows: platform icon, time, title snippet, status pill. Clicking opens the content item.

**3. Needs attention** — content in draft or in_review states, sorted by oldest first. Shows: title, type, status, time since last updated. Empty state: "Nothing waiting. You're all caught up." with a "New content" button.

**4. Spend summary** — single line, not a full card:
```
This month: $42.00 of $1,000.00 cap  ████░░░░░░ 4%
```

**5. Opponent pulse** — 2 most recent monitoring hits with credibility badge inline. "See all" link to full monitoring page.

**Remove**: the separate stat cards (awaiting review, scheduled, published counts) — these added visual weight without actionable value for 1–2 users who already know their content volume.

---

## Section 4: Real Scheduling

### Problem
`scheduleAction()` just sets `status = 'scheduled'`. No timestamp. Nothing publishes later.

### Solution

**Database change**: Add `scheduled_at timestamptz` and `timezone text` columns to `content_items`.

**Publish step UI change**: Replace single "Publish now" button with a toggle:

```
Publish:  ● Now   ○ Schedule for later
                  [Date picker]  [Time picker]  [Timezone dropdown]
```

- "Now" is the default
- "Schedule for later" reveals date/time/timezone inputs
- Timezone defaults to the campaign's timezone (stored in campaign profile, defaults to America/Los_Angeles)

**Execution**: A Vercel cron job at `/api/cron/publish` runs every 5 minutes. It queries:
```sql
SELECT * FROM content_items 
WHERE status = 'scheduled' 
AND scheduled_at <= now() 
AND scheduled_at IS NOT NULL
```
Then calls the Ayrshare publisher for each result and sets status to `published`.

**Cron config** in `vercel.ts` (preferred over `vercel.json`):
```ts
export const config: VercelConfig = {
  crons: [{ path: '/api/cron/publish', schedule: '*/5 * * * *' }],
};
```
The cron endpoint must validate a `CRON_SECRET` header to prevent unauthorized invocations.

**Dashboard today strip** queries `scheduled_at::date = today` to populate the schedule strip.

---

## Section 5: UX Polish

### 5a. Toast Notifications
Add a lightweight toast system (no external library — ~50 lines of CSS + context). Toasts appear bottom-right, auto-dismiss after 4 seconds.

Trigger toasts on:
- Content published → "Published to Instagram, Facebook"
- Content scheduled → "Scheduled for Jun 25 at 9:00 AM"
- Draft saved → "Draft saved"
- Error → "Something went wrong — please try again" (red)
- Approval submitted → "Sent for review"

Implementation: A `ToastContext` with `addToast(message, type)`. Server actions return `{ ok, message }`. Client components call `addToast` on response.

### 5b. Loading & Empty States

**Loading**: Replace full-page data-fetch blanks with skeleton screens:
- Content list: 5 skeleton rows (grey animated bars)
- Dashboard cards: shimmer placeholder
- AI generation: pulsing status text ("Writing your draft…")

**Empty states** (every list gets one):
- Content list (empty): Illustration placeholder + "No content yet" + "Create your first post →" button
- Monitoring (empty): "No results yet. Monitoring runs every 2 hours." + last-run timestamp
- Needs attention (empty): "You're all caught up." (positive, not just blank)

### 5c. Mobile Layout Fixes

Specific CSS fixes:
- `.admin-stat-grid`: Change from `repeat(4, 1fr)` to `repeat(2, 1fr)` at ≤768px and `1fr` at ≤480px
- Sidebar: On mobile (≤640px), collapse to bottom tab bar (Dashboard, Content, Monitoring, Settings) — 4 icons
- Login card: Add `max-width: 100%` and padding on small screens
- Tables: Wrap in `overflow-x: auto` container — all admin and content tables
- Add breakpoint at 768px (iPad portrait) — currently missing

### 5d. Remove Mock UI Leakage
- All `process.env.X ? <Live> : <"Add X to .env">` checks in user-facing pages → moved to Settings page (admin only)
- ContentEditor: If LLM not configured, show neutral "AI generation unavailable" — no env var names
- Monitoring: If no API key, show "Live monitoring not configured" — no technical details

### 5e. Consistent Date Formatting
Single `formatDate(iso: string, style: 'relative' | 'datetime' | 'date')` utility:
- `relative`: "3 hours ago", "yesterday", "Jun 15"
- `datetime`: "Jun 22 at 2:30 PM"
- `date`: "Jun 22, 2026"

Used everywhere. No more `.toLocaleString()` scattered across components.

### 5f. Feedback & Navigation
- Breadcrumbs on `/content/[id]`: Content → [Title]
- "Back" link on all detail pages
- Success redirect after publish goes to `/content` with a toast (not silent)
- Form validation: inline error messages appear on blur, not only on submit

### 5g. Accessibility
- Status pills get `aria-label` (e.g. `aria-label="Status: In review"`)
- All icon-only buttons get `aria-label`
- Modal dialogs trap focus and close on Escape
- Gate strip checkmarks get `role="status"` with descriptive text

---

## Section 6: Opponent Monitoring + News Credibility

### Problem
Monitoring shows a raw list of news/social results with no credibility signal, no categorization, no trending detection, and no path to rebuttal that uses candidate context.

### Solution

**Credibility scoring system**

Add `credibility_score` and `credibility_label` to monitoring results. On ingest (via n8n or the `/api/monitoring/ingest` endpoint), score each result:

Scoring approach — rule-based on domain, augmented by Claude:
1. **Domain allowlist** (High): nytimes.com, washingtonpost.com, latimes.com, politico.com, thehill.com, apnews.com, reuters.com, bbc.com, and any `.gov` domain
2. **Domain blocklist** (Low): hardcoded list of known tabloids and flagged misinformation domains (maintained in a `src/lib/credibility.ts` constant file — updated manually as needed)
3. **Everything else**: Claude rates it — send the URL + excerpt to Claude with the prompt: "Rate the credibility of this news source on a scale: high, medium, or low. Respond with one word only."
4. Result cached by domain to avoid repeated API calls

Store: `credibility` enum `'high' | 'medium' | 'low'` on `monitoring_results`.

**Monitoring page redesign**

Filter bar at top:
```
[All]  [High credibility]  [News]  [Social]  [Opponent posts]  [Trending 🔥]
```

Each result card shows:
- Source name + domain
- Credibility badge: 🟢 High | 🟡 Medium | 🔴 Low
- Category tag: News / Social / Blog / Press Release
- Excerpt (2–3 lines)
- Time ago
- "Draft rebuttal" button (primary action)
- "Dismiss" button (removes from view, logs in audit)

**Trending detection**: If 3+ results share the same story within 6 hours, mark them "Trending 🔥". Detection algorithm: same base domain OR 4+ consecutive matching words in the headline (case-insensitive). Show a single grouped card (showing source count: "5 sources") instead of separate entries.

**Rebuttal warning for low-credibility sources**:
When clicking "Draft rebuttal" on a Low-credibility result:
```
⚠️  Low-credibility source
Responding to this may give it more attention. 
Many campaigns choose to ignore low-credibility sources.
[Ignore this story]  [Draft rebuttal anyway →]
```

**Smart rebuttal generation**:
When "Draft rebuttal" is clicked (confirmed), navigate to `/content/new` with:
- Type pre-set to `social_post`
- Brief pre-filled: "Rebuttal to [opponent]'s claim: '[excerpt]'"
- The full candidate profile injected into the AI prompt as normal
- A "Context" panel on the right showing the original story

**Claim verification** (optional pre-rebuttal step):
A "Verify claim" button under each result opens a panel where Claude:
1. Summarizes the claim being made
2. States what the candidate's actual position is (from `key_positions`)
3. Flags if the claim is factually disputed vs opinion-based
4. Recommends: "Respond" / "Monitor" / "Ignore"

**Manual entry**:
"Add story manually" button opens a form:
- URL (optional)
- Headline / description
- Source name
- Category
- Opponent involved

Submitted entries go through same credibility scoring and appear in the feed.

---

## Section 7: Settings — Candidate Profile Edit

The Settings page gets a new primary section at the top: **Candidate Profile**.

Replaces the current read-only "Campaign" card with an editable form for all candidate profile fields. Changes save immediately with a toast confirmation.

The existing sections (spend cap, integrations, disclosure rules, team) remain below, in that order.

**Team section** stays read-only for now (super_admin manages users via admin panel). Add a note: "To add a team member, contact your platform administrator."

---

## What We Are NOT Building

To keep the scope right for 1–2 users:
- Full team management UI (invite/remove from campaign level)
- Comments / collaborative review threads
- Content analytics / engagement metrics (post-publish data from social APIs)
- A/B content variants
- Full calendar view (the dashboard schedule strip is sufficient)
- Voter targeting / demographics
- Fundraising integrations
- Volunteer management

These are valid future features but not needed for the core workflow.

---

## Implementation Order

Build in this order — each phase is independently shippable:

### Phase 1 — Foundation
1. `candidate_profiles` table + migration
2. Onboarding setup page (`/setup`)
3. Candidate profile edit in Settings
4. Inject candidate context into all AI prompts

### Phase 2 — AI Content Generation
5. Simplified new-content flow (non-video)
6. Platform-aware prompt constraints
7. Brief suggestions from monitoring
8. Remove mock UI leakage
9. Updated cost table

### Phase 3 — Scheduling
10. Add `scheduled_at` + `timezone` to `content_items`
11. Date/time picker in publish step
12. Cron job endpoint + Vercel cron config

### Phase 4 — Dashboard Redesign
13. Today's schedule strip
14. Redesigned needs-attention list
15. Action bar (New content + Draft rebuttal)
16. Remove stat cards

### Phase 5 — Monitoring + Credibility
17. Add `credibility` + `category` to `monitoring_results`
18. Credibility scoring on ingest
19. Monitoring page redesign with filters
20. Trending detection
21. Rebuttal warning for low-credibility sources
22. Smart rebuttal → `/content/new` pre-fill
23. Claim verification panel
24. Manual entry form

### Phase 6 — UX Polish
25. Toast notification system
26. Skeleton loading screens
27. Empty states with CTAs
28. Mobile layout fixes (sidebar, grids, tables)
29. `formatDate` utility
30. Breadcrumbs + back links
31. Accessibility (aria labels, focus traps)
32. Form validation (blur-time errors)
