# Launch-Readiness Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to run this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 2–3 dispatch code-audit subagents; Tasks 4–5 are performed by the main agent in the browser and CANNOT be delegated.

**Goal:** Produce one verified, prioritized findings report at `docs/audit/2026-07-15-launch-readiness-findings.md` covering all seven audit dimensions from the spec.

**Architecture:** Five code dimensions run as parallel read-only subagent audits with structured findings; every finding is then adversarially verified against the actual code before entering the report. Two browser dimensions (E2E flows, UX heuristics) run in the main session against the local dev server. Results merge into a single severity-ranked report.

**Tech Stack:** Next.js 14 App Router, Supabase, Stripe, Vitest; Claude Code Agent tool for subagents; Chrome browser tools for E2E/UX.

## Global Constraints

- **No external side effects:** never publish to social accounts, never trigger a real Stripe charge, never send anything to a third party. Do not complete Stripe checkout/portal flows past the app's own pages.
- **Local dev may share the production Supabase project.** Any test row created must be prefixed `[AUDIT TEST]` and deleted (or moved to a terminal non-schedulable state) before the task ends. **Never leave content in a `scheduled` state** — a production cron could publish it.
- **Findings only, zero fixes** — not even one-liners.
- **No git commits** — the user commits themselves.
- All subagents are read-only: they may Read/Grep/Glob but must not edit files or run mutating commands.
- Severity rubric (from spec): **P0** launch blocker (security hole, data loss, money mishandled, core flow broken) · **P1** must-fix pre-launch · **P2** should-fix · **P3** polish.
- Finding format (used by every task):

```markdown
### <ID> — <one-line summary>
- **Severity:** P0 | P1 | P2 | P3
- **Dimension:** security | data | billing | integrations | flows | ux | tests
- **Location:** path/to/file.ts:123 (or screen + role for browser findings)
- **What's wrong:** <1–3 sentences>
- **How it fails:** <concrete scenario: inputs/state → wrong outcome>
- **Proposed fix:** <1–3 sentences>
- **Effort:** S | M | L
```

---

### Task 1: Baseline build & test health (dimension 7, part 1)

**Files:**
- Create: `docs/audit/worksheets/07-tests.md` (raw results; worksheets are scratch inputs to the final report)

**Interfaces:**
- Produces: worksheet with pass/fail status of typecheck, tests, and production build, consumed by Task 6.

- [ ] **Step 1: Ensure deps are installed and run typecheck**

Run: `npm install --no-audit --no-fund && npm run typecheck`
Expected: exit 0. If errors: record each error verbatim in the worksheet as a finding candidate (typecheck errors are at least P1).

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: all tests pass. Record total count, failures verbatim. A failing existing test is P1 minimum.

- [ ] **Step 3: Run a production build**

Run: `npm run build`
Expected: exit 0. Record any build errors (P0 — cannot ship) or warnings (assess).

- [ ] **Step 4: Write `docs/audit/worksheets/07-tests.md`**

Record: command outputs (trimmed to relevant lines), pass/fail per check, and finding-format entries for every failure. Also list which test files exist (`src/**/*.test.ts`) vs. which critical modules have none — coverage-gap analysis itself happens in Task 2's tests subagent.

### Task 2: Parallel code-audit subagents (dimensions 1–4, 7 part 2)

**Files:**
- Create: `docs/audit/worksheets/01-security.md`, `02-data.md`, `03-billing.md`, `04-integrations.md`, `07-coverage.md`

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces: five worksheets of *candidate* findings in the standard finding format, consumed by Task 3 (verification). Candidates are NOT yet trusted.

- [ ] **Step 1: Dispatch all five subagents in one message (parallel), each with the shared preamble plus its dimension prompt**

Shared preamble for every subagent prompt:

> You are auditing a Next.js 14 + Supabase + Stripe campaign app at /Users/yahyashah/Downloads/campaign-app for launch readiness. You are READ-ONLY: use Read/Grep/Glob only; do not edit files or run mutating commands. Report *candidate findings* in exactly this markdown format, one block per finding, nothing else in your final message: [insert finding format from Global Constraints]. Severity rubric: P0 launch blocker (security hole, data loss/corruption, money mishandled, core flow broken); P1 must-fix pre-launch; P2 should-fix; P3 polish. Only report what you can point to in code — cite file:line for every claim. If a dimension area is clean, say "CLEAN: <area>" so coverage is provable.

Dimension prompts (append to preamble):

1. **security** → "Audit security & auth. Entry points: src/lib/session.ts, src/lib/permissions.ts and its use in src/app/actions.ts, src/app/setup/actions.ts, src/app/admin/actions.ts; every route under src/app/api/ (cron/billing-sync, cron/publish, elevenlabs/voices, heygen/avatars, monitoring/campaigns, monitoring/ingest, webhooks/stripe); supabase/migrations/003_auth.sql and RLS across all 14 migrations; the join/invite flow (src/app/join/). Check: every server action and API route enforces auth + role permission; cron and ingest routes can't be invoked by the public; Stripe webhook verifies signatures; session cookies are signed/httpOnly/secure; no secrets leak to the client (grep NEXT_PUBLIC_ and client components); SQL injection/RLS bypass via the supabase client usage in src/lib/data.ts and src/lib/repos.ts; password handling (bcryptjs) in the auth flow."

2. **data** → "Audit data integrity. Entry points: all 14 files in supabase/migrations/ read in order; src/lib/repos.ts, src/lib/data.ts, src/lib/store.ts; src/domain/content-lifecycle.ts, src/domain/types.ts. Check: does the code's expected schema match the migrations (column names, enums, nullability); race conditions in approval and usage metering (compare 013_atomic_usage_guard.sql against the code paths that consume it); content-lifecycle states that can be entered but never exited or that skip required gates; partial-failure handling (e.g., external call succeeds but DB write fails, or vice versa); referential integrity when campaigns/users/content are deleted; whether the in-memory store.ts still backs anything in production paths."

3. **billing** → "Audit billing correctness. Entry points: src/lib/stripe.ts, src/lib/billing-webhook.ts, src/lib/billing-sync.ts, src/lib/billing-catalog.ts, src/domain/billing.ts, src/domain/usage.ts, src/app/api/webhooks/stripe/, src/app/api/cron/billing-sync/, src/app/billing/page.tsx, migrations 010_billing.sql, 011_usage_sync_pending.sql, 013_atomic_usage_guard.sql. Check: which Stripe webhook events are handled vs. needed (subscription created/updated/deleted, payment failed, invoice events) and what happens on unhandled ones; idempotency of webhook processing (replay/duplicate events); usage metering accuracy (can usage be double-counted or lost between the guard and sync); spend caps actually blocking the metered actions; failed payment → what does the user see and what gets blocked; plan change proration/limits; billing-sync cron failure recovery."

4. **integrations** → "Audit integration robustness. Entry points: src/integrations/index.ts (whole file), src/lib/services.ts, src/lib/avatars.ts, src/lib/prompt.ts, src/lib/credibility.ts, src/app/api/heygen/avatars/, src/app/api/elevenlabs/voices/, src/app/api/monitoring/ingest/, src/app/api/cron/publish/, n8n-opposition-monitoring.json. For each provider (Claude/LLM, HeyGen video + photo avatar, ElevenLabs, Ayrshare, NewsData): what happens on non-200, timeout, malformed JSON, rate limit; are responses validated before use; polling loops (video generation) — do they terminate, what happens if the job stays pending forever; hardcoded IDs (grep the default HEYGEN_AVATAR_ID/VOICE_ID fallbacks — do real users get someone else's avatar/voice); does a mock silently activate in production if an env key is missing, and would the user know; does cron/publish retry or drop failed publishes, and can it double-publish."

5. **coverage** → "Audit test coverage of critical paths. Entry points: every *.test.ts file under src/, vitest.config.ts, and the modules they test. Map which of these critical behaviors have real assertions: content lifecycle gate enforcement (cannot schedule without approval + disclosure), permission matrix (every role × action), usage cap blocking, Stripe webhook idempotency, disclosure engine jurisdiction rules, avatar billing (src/app/actions.avatar-billing.test.ts — what does it actually cover). Report untested critical behaviors as findings (severity by risk: untested money/security paths are P1). Do not count a test that merely calls a function without asserting the guarded behavior."

- [ ] **Step 2: Save each subagent's output verbatim to its worksheet file**

Create `docs/audit/worksheets/<nn>-<dimension>.md` with a header line (`# Candidate findings — <dimension> — unverified`) followed by the subagent output.

- [ ] **Step 3: Sanity-check coverage**

For each worksheet confirm every area named in its dimension prompt is either covered by a finding or an explicit "CLEAN" line. If a subagent skipped an area, re-dispatch a follow-up subagent scoped to just that area and append its output.

### Task 3: Adversarial verification of candidate findings

**Files:**
- Modify: the five worksheets from Task 2 (annotate each finding)

**Interfaces:**
- Consumes: candidate findings in standard format from Task 2 worksheets.
- Produces: each finding annotated with `**Verdict:** CONFIRMED | REJECTED | DOWNGRADED-to-P<n> | UPGRADED-to-P<n>` plus a one-line justification citing file:line. Only CONFIRMED/adjusted findings flow to Task 6.

- [ ] **Step 1: Dispatch verification subagents (read-only), batching ~5 findings per subagent, in parallel**

Per-batch prompt:

> You are verifying candidate audit findings against the code at /Users/yahyashah/Downloads/campaign-app. READ-ONLY. For each finding below, your job is to REFUTE it: read the cited file and surrounding code, check whether the claimed failure scenario can actually occur (is there a guard elsewhere? is the claim based on a misread?). Return for each: the finding ID, verdict CONFIRMED / REJECTED / DOWNGRADED-to-P<n> / UPGRADED-to-P<n>, and 1–2 sentences citing file:line that prove the verdict. Default to REJECTED if you cannot reproduce the reasoning from the code. [paste the batch of findings]

- [ ] **Step 2: Annotate worksheets with verdicts**

Edit each worksheet: add the `**Verdict:**` line to every finding. Where verifier and finder disagree and the verifier's citation is wrong, the main agent reads the disputed code itself and makes the final call, noting "adjudicated" in the verdict line.

- [ ] **Step 3: Duplicate sweep**

Findings citing the same root cause across dimensions (e.g., a missing auth check found by both security and billing) are merged: keep the highest-severity copy, note merged IDs.

### Task 4: Browser E2E flow walkthrough (dimension 5)

**Files:**
- Create: `docs/audit/worksheets/05-flows.md`

**Interfaces:**
- Consumes: nothing (independent of Tasks 1–3).
- Produces: findings in standard format with **Location** = screen + role + step; consumed by Task 6.

- [ ] **Step 1: Start the dev server and connect the browser**

Run: `npm run dev` in background; wait for `http://localhost:3000` to respond.
Load Chrome tools via ToolSearch in one call (tabs_context_mcp, tabs_create_mcp, navigate, computer, read_page, read_console_messages, read_network_requests, form_input). Create a new tab; do not reuse existing tabs.

- [ ] **Step 2: Walk each flow, per role, recording a finding for every break, dead end, wrong-role leak, or console/network error**

Flow script (each numbered item is exercised and its outcome recorded, pass or fail):

1. **Login** — each demo/seed role (staff, approver/manager, candidate, super_admin as available on the login page): wrong password rejected with sane message; session persists on refresh; logout works.
2. **Join/invite** — visit /join with no code, an invalid code, and (if creatable without side effects) a valid code; registration validation.
3. **Setup** — /setup as a fresh candidate: complete the wizard; every required field validated; opponent monitoring config saves and reloads.
4. **Content lifecycle** — as staff: create `[AUDIT TEST] draft`, generate AI draft, save, submit for review; verify staff CANNOT approve (button absent or action rejected). As approver: approve. Attach disclosure. Attempt schedule BEFORE disclosure attached in a second item to confirm the gate blocks with a clear reason. **Immediately unschedule/delete anything that reaches `scheduled`.** Verify activity log recorded each transition.
5. **Publish gate** — verify the publish action is gated (do NOT execute a real publish; stop at the confirmation and record what the UI claims will happen).
6. **Monitoring** — /monitoring: items render; credibility indicators make sense; "generate reply" produces a draft tied to the monitoring item; the draft lands in the normal review queue (no approval bypass).
7. **Avatars/voice** — /avatars: library renders; creating an avatar reaches the point of calling HeyGen (record request via network tab) — cancel/stop before incurring avoidable cost if the UI allows; voice selection persists to the candidate profile.
8. **Billing** — /billing: current plan and usage render and match seeded reality; upgrade flow stops at the app boundary (do not complete checkout); spend-cap display consistent with dashboard.
9. **Admin** — /admin as super_admin: dashboards render; as a non-admin, /admin URLs redirect or 403 (test by direct URL entry, not just hidden nav).
10. **Settings** — every field saves, reloads correctly, and rejects invalid input.

- [ ] **Step 3: Direct-URL permission probes**

While logged in as staff, directly visit: /admin, /admin/content, and fire one privileged server action if reachable via UI manipulation; record whether server-side enforcement (not just hidden buttons) blocks it.

- [ ] **Step 4: Clean up test data**

Delete every `[AUDIT TEST]` row via the UI (or note precisely what remains and why). Confirm nothing is left in `scheduled`.

- [ ] **Step 5: Write `docs/audit/worksheets/05-flows.md`** with findings in standard format; include a per-flow PASS/FAIL table so coverage is provable.

### Task 5: UX heuristic review (dimension 6)

**Files:**
- Create: `docs/audit/worksheets/06-ux.md`

**Interfaces:**
- Consumes: the same running dev server and tab from Task 4.
- Produces: findings in standard format; consumed by Task 6.

- [ ] **Step 1: Screen-by-screen heuristic pass at desktop width (1440px)**

Screens: login, join, setup wizard (each step), dashboard, content list, content editor/wizard, monitoring, avatars, billing, settings, admin, admin/content. For each screen score against this checklist and record a finding for each miss: visual hierarchy (is the primary action obvious); consistency (buttons/spacing/typography match across screens); empty state (log out of data or filter to none — is there guidance, not a blank void); loading state (throttle network via CDP or observe slow calls — spinner/skeleton vs layout jump); error state (submit invalid input — inline message vs silent failure or raw error); copy quality (jargon, placeholder text, inconsistent capitalization); information density (dashboard answers "what needs my attention" in 5 seconds).

- [ ] **Step 2: Mobile pass at 390px width**

Resize window to 390px. Re-check: navigation usable (the mobile sidebar from commit b4a7c90), tables don't overflow the viewport, forms usable, touch targets adequate.

- [ ] **Step 3: Cross-cutting pass**

Record findings for: focus states and keyboard navigation on the two most important forms (login, content editor); color contrast on status pills and gate strips (spot-check obvious failures); toast behavior (do errors persist long enough to read).

- [ ] **Step 4: Write `docs/audit/worksheets/06-ux.md`** with findings plus a screen × checklist coverage table.

### Task 6: Assemble the findings report

**Files:**
- Create: `docs/audit/2026-07-15-launch-readiness-findings.md`
- Consumes: all eight worksheets (01-security, 02-data, 03-billing, 04-integrations, 05-flows, 06-ux, 07-tests, 07-coverage)

**Interfaces:**
- Produces: the final deliverable defined in the spec.

- [ ] **Step 1: Merge all CONFIRMED (and adjudicated) findings, assign final IDs**

ID scheme: `SEC-1…`, `DATA-1…`, `BILL-1…`, `INT-1…`, `FLOW-1…`, `UX-1…`, `TEST-1…`, ordered by severity within each prefix.

- [ ] **Step 2: Write the report** with this structure:

```markdown
# Launch-Readiness Findings — 2026-07-15
## Summary
<counts by severity; one-paragraph overall assessment; go/no-go framing>
## Findings table
| ID | Sev | Dimension | Summary | Effort |
<ranked P0 → P3>
## Findings detail
<every finding in the standard format, including verdict justification>
## Dimension coverage statement
<per dimension: what was examined, what was CLEAN — explicit, per spec success criteria>
## Suggested fix phases
<grouping: Phase 1 P0 security/data, Phase 2 billing/integrations P1, Phase 3 flows/UX, Phase 4 polish — adjusted to actual findings>
```

- [ ] **Step 3: Self-check against spec success criteria**

Every dimension has an explicit coverage statement; every finding has location + concrete failure + fix + effort; rejected candidates are listed in an appendix with rejection reasons (so nothing silently vanishes).

- [ ] **Step 4: Present the summary to the user** — severity counts, the P0/P1 list inline in chat, link to the report file. Do not commit anything.

---

## Execution notes

- Task order: 1 → 2 → 3 can overlap with 4 → 5 (code audits run while browser work proceeds), but Task 3 must finish before Task 6. Task 4 must precede Task 5 only in sharing server/tab setup.
- If the dev server fails to start or login is impossible, that is itself a P0 finding — record it and continue with the code dimensions rather than stalling.
- If a subagent returns findings without file:line citations, re-dispatch rather than accept vague claims.
