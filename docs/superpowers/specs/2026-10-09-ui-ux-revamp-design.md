# UI/UX Revamp — Design Spec

**Date:** 2026-10-09 · **Branch:** `feat/ui-ux-revamp`

## Goal

Turn PolitIQ into a clean, premium, industry-standard SaaS product (Stripe / Linear / Vercel dashboard caliber) and make every existing feature behave correctly and professionally. No feature additions beyond what is needed for correct, complete flows.

## Non-negotiables

- Keep all behavior covered by the 578 existing tests green; `npm run typecheck` clean; `npm run build` succeeds.
- i18n: every user-visible string goes through next-intl. New keys added to **both** `src/messages/en.json` and `es.json` (parity test enforces). Server actions keep the explicit `getTranslations({ locale, namespace })` form.
- No new runtime dependencies unless clearly justified (no Tailwind, no component library). Plain CSS in `globals.css` (reorganised) — design tokens as CSS custom properties.
- No autonomous git commits (the user reviews and commits).
- Never touch production data during verification.

## Visual direction

Light theme by default, full dark theme. Resolution order: `theme` cookie (`light` | `dark` | `system`, default `system`) → `prefers-color-scheme`. The root layout reads the cookie and sets `<html data-theme="light|dark">` when explicit (no attribute = follow system), so there is no flash. A `ThemeToggle` (light / dark / system) lives in the sidebar user menu, admin sidebar, and the pre-auth pages next to the language toggle.

Neutral, quiet surfaces; hairline borders; one confident accent; generous whitespace; real hierarchy. No grid textures, glows, or monospace headings. Monospace only for IDs/codes/numbers in tables where alignment matters (`.mono`, `.num` with `tabular-nums`).

### Tokens

```
/* light (default) */
--bg: #F7F8FA;         --surface: #FFFFFF;     --surface-2: #F2F4F7;  --surface-hover: #EEF0F4;
--border: #E4E7EC;     --border-strong: #D0D5DD;
--text: #101828;       --text-2: #475467;      --text-3: #667085;     --text-inverse: #FFFFFF;
--accent: #4F46E5;     --accent-hover: #4338CA; --accent-soft: #EEF2FF; --accent-text: #4338CA; --on-accent: #FFFFFF;
--ok: #067647;  --ok-soft: #ECFDF3;  --ok-border: #ABEFC6;
--warn: #B54708; --warn-soft: #FFFAEB; --warn-border: #FEDF89;
--bad: #B42318;  --bad-soft: #FEF3F2;  --bad-border: #FECDCA;
--info: #175CD3; --info-soft: #EFF8FF; --info-border: #B2DDFF;
--purple: #6941C6; --purple-soft: #F4F3FF; --purple-border: #D9D6FE;
--focus-ring: 0 0 0 3px rgba(79,70,229,.28);
--sh-xs: 0 1px 2px rgba(16,24,40,.05);
--sh-sm: 0 1px 3px rgba(16,24,40,.08), 0 1px 2px rgba(16,24,40,.04);
--sh-md: 0 4px 8px -2px rgba(16,24,40,.08), 0 2px 4px -2px rgba(16,24,40,.04);
--sh-lg: 0 12px 24px -4px rgba(16,24,40,.10), 0 4px 8px -4px rgba(16,24,40,.04);

/* dark */
--bg: #0B0D12;  --surface: #12151C;  --surface-2: #181C25;  --surface-hover: #1E2330;
--border: #232937; --border-strong: #303848;
--text: #F2F4F7; --text-2: #A9B1C1; --text-3: #8A93A6;
--accent: #7C83F7; --accent-hover: #959BFA; --accent-soft: rgba(124,131,247,.14); --accent-text: #A5AAFB; --on-accent: #0B0D12;
semantic: brighter fg (#47CD89 ok, #FDB022 warn, #F97066 bad, #53B1FD info, #9E77ED purple), soft = 12–14% alpha, border = 28% alpha.
shadows: darker, low-alpha black; cards rely on borders rather than shadows.
```

Contrast: `--text-3` must meet 4.5:1 on `--surface` in both themes (the values above do).

Scales:
- Type (Manrope, already self-hosted): 12 / 13 / 14 (body) / 16 / 18 / 20 / 24 / 30 / 36 / 48 (landing hero up to 56). Weights 400/500/600/700. Headings tight tracking (-0.01 to -0.02em). Page title 24/600; section title 16/600; eyebrow 12/600 uppercase +0.04em `--text-3`.
- Space: 4px base — `--s-1:4px … --s-2:8px, --s-3:12px, --s-4:16px, --s-5:20px, --s-6:24px, --s-8:32px, --s-10:40px, --s-12:48px, --s-16:64px`.
- Radius: `--r-sm:6px` (inputs, small buttons), `--r:8px` (buttons), `--r-lg:12px` (cards), `--r-xl:16px` (modals, hero blocks), `--r-full:999px` (pills).
- Motion: 120–200ms ease-out; everything disabled under `prefers-reduced-motion: reduce`.

`h2` is a real heading again (no global eyebrow hijack); use `.eyebrow` explicitly.

## Component primitives (CSS + React where useful)

All in `globals.css`, organised into clearly commented sections: tokens → reset/base → layout/shell → primitives → patterns → page-specific (landing, wizard, channels…) → responsive → reduced motion.

- **Buttons** `.btn` + modifiers `.btn-primary`, `.btn-secondary` (default), `.btn-ghost`, `.btn-danger`, `.btn-danger-soft`, sizes `.btn-sm`, `.btn-lg`, `.btn-icon`, `.btn-block`. Keep `.btn.primary` / `.btn.danger` as aliases so existing markup still works during migration, then migrate markup. Visible `:focus-visible` ring, disabled state, `aria-busy` spinner via `::after`.
- **Forms** one system: `<Field label hint error htmlFor>` React component (or `.field` > `label.field-label` + control + `.field-hint` / `.field-error`), labels always associated (`htmlFor`/`id` or wrapping). `.input`, `select`, `textarea` share one style; focus ring `--focus-ring`; invalid state `[aria-invalid=true]`. Checkbox/radio styled with `accent-color`. `.input-group` for prefixes.
- **Card** `.card` (surface, border, `--r-lg`, padding 24, `--sh-xs`), `.card-header` (title + actions), `.card-body`, `.card-footer`; `.card.interactive` hover.
- **PageHeader** component: breadcrumb (optional) · title · description · actions slot.
- **Stat / KPI tile** `.stat` (label, value with `.num`, delta/hint, optional link).
- **Table** `.table` inside `.table-wrap` (horizontal scroll on narrow screens, sticky header optional), row hover, `.row-link` making the first cell a real `<Link>` (keyboard accessible) — replaces mouse-only `ClickableRow`.
- **Badge / StatusPill** `.badge` + tones (neutral, accent, ok, warn, bad, info, purple) with leading dot.
- **Banner / Alert** `.alert` + tones (info/ok/warn/bad) with icon, title, body, optional action. (Fixes the missing `.banner.ok`.)
- **EmptyState** component: icon, title, description, primary action.
- **Tabs / segmented control** `.tabs` (links or buttons) and `.segmented` — used for filters (content status, admin content).
- **Dialog** component built on native `<dialog>` (focus trap, Escape, `aria-modal`, labelled title) + **ConfirmDialog** (`useConfirm()` hook returning a promise) for every destructive or billing action. Replaces ad-hoc `.modal-backdrop` divs.
- **Toast** restyled with tokens; error toasts `role="alert"`; pause on hover; 5s default.
- **SubmitButton** (existing, `useFormStatus`) used on **every** `<form action>`; shows spinner + pending label.
- **Skeleton** `.skeleton` blocks + reusable `PageSkeleton` variants (list, detail, form) — every route gets a `loading.tsx` matching its layout.
- **Icons**: a single `src/components/icons.tsx` module exporting consistent 16/20px stroke-1.5 SVG icons (currentColor). No emoji as icons.
- **Error boundaries**: `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/global-error.tsx` (translated, branded).

## Shell

- Authenticated app: left sidebar 248px (logo, campaign switcher-style campaign name block, grouped nav: *Workspace* — Dashboard, Content, Monitoring, Analytics; *Assets* — Channels, Avatars; *Campaign* — Team, Billing, Settings), bottom user menu (name, role badge, theme toggle, sign out). Top bar removed or reduced to page-level header. Main content max-width 1200px, padding 32px (24 tablet, 16 mobile).
- Mobile (<900px): sidebar becomes an off-canvas drawer opened from a sticky top bar (logo + menu button); no 9-item bottom tab bar.
- Admin shell shares the same structure/components with an "Admin" badge and its own nav; fully responsive.
- Logo: `/politiq-logo.png` (white text) in dark theme, `/politiq-logo-dark.png` (dark text) in light theme — swap via CSS (`.logo-light` / `.logo-dark` + theme selectors) so it works with `system`.

## Page-level UX standards

Every page: PageHeader; loading skeleton; designed empty state with a CTA; inline, translated errors (never raw provider/Stripe/DB messages — log them server-side, show a friendly translated message); success feedback (toast or inline “Saved”); pending states on every mutation; confirmation on destructive/billing actions; keyboard accessible; responsive to 360px wide.

Forms with server-side validation use `useFormState` (React 18 / Next 14) returning `{ ok, error, fieldErrors, values }` so input is preserved and errors appear next to fields; plus native constraints (`required`, `type=email`, `minLength`) for instant feedback.

Dates/numbers/currency formatted with the active locale (`useFormatter` / `getFormatter` from next-intl, or `Intl` with the locale) — replaces hardcoded `en-US`.

## Functional fixes in scope (from the audit)

User-facing:
1. Dashboard KPI links use `?status=`; counts match the filter they link to.
2. Setup / Settings / Join: preserve input, field-level errors, `required` on party.
3. Content wizard: real *Scheduled* state (shows time in campaign tz, Unschedule → back to approved, Reschedule); AI items not marked `scheduled` before a time exists; Reject path for approvers (wire existing `decideAction`); unsaved-edit guard before Approve; clickable completed steps where valid; per-step error clearing; date picker via `<input type="datetime-local">` + tz select with validation; revalidate `/content` and `/dashboard` after schedule/publish.
4. Every imperative action call wrapped in try/catch/finally → no stuck `busy`, error toast.
5. Silent `return`s in server actions replaced with translated `{ ok:false, error }` / redirects with meaningful messages (pricing checkout, billing portal, monitoring add, settings saves). Pricing explains to non-owners that an owner must subscribe; handles `?checkout=canceled`; polls/refreshes while awaiting webhook; billing portal returns to `/billing`.
6. Confirmations: delete avatar, remove teammate, role change, plan switch (shows proration note), regenerate draft over edits, dismiss monitoring (with undo toast), admin impersonate/remove/delete plan.
7. Content list rows are real links; `<a>` → `Link`; status param validated.
8. Team: copy-invite-link button, success toasts, revalidate `/team`.
9. Avatars: polling scoped (no whole-page refresh loops), accessible dialogs, aspect-ratio setting reachable for new users; remove dead `VoiceLibrary`, `GateStrip`, `SkeletonRow` if truly unused.
10. Monitoring: manual-entry validation (http/https URL), errors surfaced, rebuttal uses `generateFromMonitoringAction` path or passes id instead of 200-char excerpt in URL.
11. Landing: CTAs explain invite-only access ("Request access" mailto/contact, "Sign in"); footer dead `#` links removed or pointed at real anchors/mailto; landing CSS dead code removed.
12. Translate remaining raw strings (provider errors → friendly messages, audit action labels, parties, roles, platform names, 'Untitled', voice preview text).

Admin / backend:
13. `assignPlanAction`: pending button, Stripe idempotency keys, conditional update, `throwOnError` — no double subscriptions.
14. `/api/elevenlabs/voices` scoped to the caller's campaign (or admin only) — no cross-tenant voice leak.
15. `removeUserAction` / `impersonateAction`: scope checks, cannot remove/impersonate super_admins or the last owner, audit entry for impersonation.
16. `requireAdmin()` in each admin page (defense in depth).
17. Admin campaign "Recent activity" queries by campaign, not `entity_id`.
18. Admin actions return messages instead of silent `void`; role values validated against an allow-list; email validated.
19. Silent writes wrapped with `throwOnError` where a failure would mislead the user.
20. Cron: constant-time bearer compare; due items ordered by `scheduled_at`; `sync-analytics` `maxDuration`.
21. Stripe webhook idempotency: claim the event row first (insert, unique conflict = already processed).
22. Monitoring ingest: validate campaign exists, http(s) URL, length limits.
23. Admin tables: search + sort + pagination where lists are unbounded (users, content, audit, campaigns).

Out of scope (flag to user, do not change): cron frequency vs Vercel plan for exact-time publishing (needs a product/plan decision); login throttle redesign; session revocation; DB query performance rewrites beyond trivial fixes.

## Work breakdown & file ownership

Wave 1 (single agent, sequential): **Foundation** — tokens, theme (cookie + toggle + no-flash), reorganised `globals.css` primitives, icons module, Dialog/ConfirmDialog/useConfirm, Field, PageHeader, EmptyState, Toast restyle, error/not-found pages, app shell + mobile drawer, admin shell, logo swap. Keeps legacy class aliases so untouched pages still render.

Wave 2 (parallel agents, disjoint page/component ownership; shared files `actions.ts`, `en.json`, `es.json`, `globals.css` edited surgically — re-read before every edit; page-specific CSS goes in its own commented section):
- **A — Pre-auth & onboarding:** landing, login, join, setup, pricing (+ `pricing/actions.ts`, `setup/actions.ts`, login/join actions).
- **B — Content:** dashboard, content list, content/new (ContentEditor), content/[id] (ContentWizard) + their actions.
- **C — Assets & insights:** channels, avatars (AvatarManager, AvatarLibrary, VoiceCloneManager), monitoring (MonitoringTable), analytics + their actions, `/api/elevenlabs/voices`, monitoring ingest.
- **D — Account:** settings, team (TeamManager), billing + their actions.
- **E — Admin:** all `/admin/**` pages, CampaignsTable, admin actions, admin billing actions, `data.ts` admin helpers, crons, stripe webhook.

Wave 3: whole-branch review (cross-cutting consistency, a11y, i18n parity, tests/typecheck/build), then visual QA in a browser in both themes, EN/ES, desktop + mobile.
