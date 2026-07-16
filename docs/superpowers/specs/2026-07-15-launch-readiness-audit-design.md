# Launch-Readiness Audit — Design

**Date:** 2026-07-15
**Status:** Approved (Option A — multi-dimension audit)

## Goal

The app is heading for a public launch. Before fixing anything, run a
comprehensive audit across correctness, security, functional gaps, and
design/UX, producing a single prioritized findings report. Fixes happen
afterward in phases, each planned and approved separately.

## Context

- Next.js 14 App Router, Supabase (14 migrations), Stripe billing,
  role-based permissions, HeyGen/ElevenLabs avatars & voice, Ayrshare
  publishing, NewsData monitoring, Claude content generation.
- Integrations activate per env key with mock fallbacks (`src/lib/services.ts`).
- Real credentials exist for all or most services.
- README is outdated (describes the in-memory demo era); code has moved on.

## Constraints

- **No external side effects during the audit.** Allowed: run the app
  locally, browse everything, create/edit draft content and test data.
  Forbidden: publishing to real social accounts, triggering real Stripe
  charges, sending anything external (emails, webhooks to third parties).
- No fixes during the audit — findings only. (Exception: nothing. Even
  one-line fixes wait for the fix phases.)
- No autonomous git commits; the user commits.

## Audit dimensions

1. **Security & auth** — session handling (`src/lib/session.ts`), permission
   gates on every server action (`src/app/actions.ts`, `src/app/setup/actions.ts`,
   `src/app/admin/actions.ts`) and API route (`src/app/api/**`), Supabase RLS
   posture, invite/join flow, Stripe webhook signature verification, secret
   handling.
2. **Data integrity** — migrations vs. code assumptions, race conditions
   (usage guard, approval flow), orphaned/unreachable content-lifecycle
   states, referential integrity, what happens on partial failure.
3. **Billing correctness** — Stripe webhook event coverage, usage metering
   accuracy, spend caps and gating, failed payments, plan changes,
   `usage_sync_pending` reconciliation, cron `billing-sync`.
4. **Integration robustness** — failure/timeout/unexpected-shape handling
   for HeyGen, ElevenLabs, Ayrshare, NewsData, Claude; polling and retry
   behavior; behavior at the mock-vs-real seams; cron `publish` route.
5. **Core flows end-to-end (browser)** — setup → content creation →
   AI draft → submit → approve → disclosure → schedule → publish gate
   (stop before real publish); monitoring → instant reply generation;
   avatar/voice creation; billing management; admin flows; join/invite;
   role-switching to verify gates.
6. **Design/UX heuristic review (browser)** — every screen: visual
   hierarchy, consistency, spacing/typography, empty states, loading
   states, error states, form validation feedback, mobile/responsive,
   copy quality, perceived professionalism.
7. **Test & build health** — `npm run typecheck`, `npm test`, build;
   coverage gaps on critical paths (lifecycle gates, billing, permissions).

## Execution

- Dimensions 1–4 and 7: parallel subagent code reviews, each scoped to its
  dimension with explicit file entry points. Findings come back structured.
- Dimensions 5–6: performed directly in the browser against the local dev
  server, screen by screen, role by role.
- Every subagent finding is verified against the actual code before it
  enters the report (no unverified speculation in the final report).

## Deliverable

One findings report at `docs/audit/2026-07-15-launch-readiness-findings.md`:

- Each finding: **ID, severity, dimension, location (file:line or screen),
  what's wrong, how it fails (concrete scenario), proposed fix, estimated
  effort (S/M/L)**.
- Severity rubric:
  - **P0** — launch blocker: security hole, data loss/corruption, money
    handled wrong, core flow broken.
  - **P1** — must fix before launch: incorrect behavior users will hit,
    missing error handling on likely failures, misleading UI.
  - **P2** — should fix: rough edges, inconsistencies, weak validation,
    missing empty/loading states.
  - **P3** — polish: visual refinement, copy, nice-to-haves.
- A summary table up front, ranked by severity.

## After the audit

Review the report together, group accepted findings into fix phases
(likely: P0 security/data first, then billing/integrations, then UX
overhaul), and each phase gets its own implementation plan via the
writing-plans process.

## Success criteria

- Every dimension has been examined and says so explicitly in the report
  (including "nothing found" if applicable).
- Every finding is verified and reproducible/pointable.
- The user can make an informed go/no-go call on each finding without
  re-deriving the analysis.
