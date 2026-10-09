# UI/UX Revamp — Wave 3 fix list (in progress)

Waves 1–2 are complete. A whole-branch review and a logged-in visual QA pass (light/dark, desktop/390px) produced the list below. A fix agent was **paused mid-way** on 2026-10-09: some items are done, some partial. On resume, re-verify **every** item against the code — don't trust this list's status.

**State at pause:** `npx vitest run` passes 699/699 (dead-code tests were removed). `tsc` has 2 errors from half-finished edits:
- `src/app/dashboard/page.tsx:162` — `signalsN` is undefined (item 13, shared capped-count helper, partly applied).
- `src/lib/markdown-lite.ts:53` — `kind` on `never` (item 12, renderer written but not finished; test file and analytics wiring not done yet).

Rules: follow `2026-10-09-ui-ux-revamp-wave2-brief.md` (no commits, no prod writes, en+es i18n, tests green).

## From the code review
1. **Must fix:** `src/app/admin/_components/ActionForm.tsx`. A server action that redirects resolves to `undefined` on the client, so `result.ok` throws and a generic error flashes before navigation (create campaign, admin billing portal). Guard against `!result`, drop the dead `isRedirectError` branch, and check other client callers of redirecting actions.
2. Audit labels: add `revise`, `reschedule`, `unschedule` and `confirm_disclosure` to `admin.audit.actions` (en+es) and `admin/_components/audit-labels.ts`. Share one known-actions list with `content/[id]/page.tsx`.
3. Merge `src/app/settings/form-state.ts` into `src/lib/form-state.ts`. Rename the admin `ActionFormState` type.
4. `settings/actions.ts` should import `PROFILE_MAX_LENGTHS` from `lib/profile-validation.ts`.
5. Delete dead code (grep first):
   - `synthesizeVoiceAction` and `generateFromMonitoringAction`
   - the `monitoring=<id>` URL param in `MonitoringTable`
   - `getMonthlySpend`, `getUser`, `getApprovals`, `getDisclosures` in `data.ts`
   - `lib/formatDate.ts` and its test
   - `ICON_NAMES` and the unused named icon wrappers
   - unreferenced legacy CSS: `.btn.primary`, `.btn.danger`, `.banner*`, `.pagehead`, `.pill.*`, and the duplicate `.rolebadge` rule
6. Fix the stale seat-usage comment in `settings/team-actions.ts`.
7. `layout.tsx` metadata should use `generateMetadata` with translations.
8. Breakpoints in `globals.css`: change 900px to 899px and 600px to 640px.
9. Inline styles:
   - `AppShell.tsx` skeleton objects → `.sk-*` classes
   - `PageHeader.tsx` layout object → a class
   - `.btn-danger` `#fff` → a token
10. Add `.playwright-mcp/` to `.gitignore`, and delete that untracked folder (it holds QA screenshots).
11. Share the invite TTL constant between team and admin.

## From visual QA
12. The analytics AI insight shows raw `**markdown**`. Use a safe subset renderer (no `dangerouslySetInnerHTML`) with unit tests.
13. Analytics "versus 1,000 tracked mentions" should read `1,000+` when the count is capped. Share the helper with the dashboard.
14. Analytics overflows horizontally at 390px (`section.card > h2`, `ul.an-top-list > li`).
15. KPI stat grids on dashboard and analytics should be 2 columns at ≤640px.
16. `/content/new` has no gap between the Language select and the next field.
17. Team: split active Pending invites from Expired ones (put Expired in a collapsed group that keeps Revoke).
18. ICU plurals for plan-limit strings ("1 videos per day") on pricing, billing and admin billing.
19. The landing footer logo is stretched; fix its aspect ratio and check every `Logo` usage.
20. The landing hero h1 wraps to 4 lines at 1440px. Aim for about 3.

## Then
Run `tsc`, `vitest` and `next build`. Re-screenshot analytics, dashboard (390px), team, pricing, landing and content/new with the test account (ask the user for credentials again; never store them).

## Open product decisions (for the user)
- Exact-time scheduled publishing: the cron only runs daily at 06:00 UTC.
- Landing hero copy; the removed Privacy/Terms/FEC links; the `NEXT_PUBLIC_CONTACT_EMAIL` fallback `ceo@ivac.org`.
- The landing "Spend controls" feature card advertises cost caps the app no longer tracks.
- Monitoring dismiss uses Undo instead of a confirm dialog.
- Billing shows "Renews on Sep 3, 2026" (past date). The subscription data may be stale on the Stripe side.
- Publish-now confirmation dialog: keep it, or drop it as friction?
