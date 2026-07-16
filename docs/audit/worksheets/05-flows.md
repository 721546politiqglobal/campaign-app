
# Browser E2E flow walkthrough — findings

Environment: local dev on :3002 against the real `.env` / Supabase. Logged in as
alex@example.com (owner, camp-1). No paid mutations triggered and nothing scheduled
(safety constraint) — so happy-path publish was NOT exercised live; the publish/gate
correctness rests on the code-level findings (INT-2/DATA-2/DATA-6 etc.).

## Per-flow results
| Flow | Result | Notes |
|---|---|---|
| Landing page | PASS | Polished marketing page, clear CTAs |
| Login | PASS | Valid creds → dashboard; session persists across navigations |
| Dashboard | PASS (see FLOW-1) | Needs Attention + Opponent Pulse + spend meter render |
| Content list | PASS | Filters + status pills render; junk/test rows present in DB |
| Content detail/wizard | PASS | 4-step wizard renders; did NOT click paid "Generate avatar video" |
| Monitoring | PASS (see UX) | Feed renders; off-topic items + mid-word truncation |
| Avatars | PASS (see UX) | 5 avatars render; did NOT click Delete (destructive) |
| Billing | PASS | "Billing inactive" banner + over-allowance usage shown correctly |
| Settings | PASS (see UX) | Profile form renders/populated; no field validation |
| Admin (as non-admin) | PASS (security) | Direct URL /admin → redirect to /login; server-side enforced |
| Mobile 390px | PASS | Sidebar → bottom tab bar; dashboard stacks; table no h-overflow |

## Findings

### FLOW-1 — Non-admin visiting /admin is redirected to /login, appearing to log the user out
- **Severity:** P2
- **Dimension:** flows
- **Location:** screen /admin (as owner/staff/manager); requireAdminSession in src/lib/session.ts
- **What's wrong:** A logged-in non-super_admin who hits an /admin URL directly is bounced to the login page (session actually stays valid). It reads as an unexpected logout rather than an authorization block.
- **How it fails:** Owner clicks a stale /admin link → lands on "Welcome back" login form → believes they were signed out, may re-enter credentials.
- **Proposed fix:** Redirect non-admins to /dashboard (or show a 403 page) instead of /login when a valid non-admin session exists.
- **Effort:** S

### FLOW-2 — Happy-path publish/scheduling not verifiable without real side effects
- **Severity:** (process note, not a defect)
- **Dimension:** flows
- **Location:** content wizard → schedule/publish
- **What's wrong:** Because the live DB is shared with production cron and paid providers, the schedule→publish path could not be exercised end-to-end during the audit without risking a real post or charge. The gate logic and its bypasses are covered by code findings (DATA-2, DATA-3, INT-2, DATA-6).
- **Proposed fix:** Stand up a dedicated staging Supabase + Ayrshare/HeyGen sandbox so the full publish path can be regression-tested safely. (Ties to INT-3: prod must not silently fall back to mocks.)
- **Effort:** M

Note: No `[AUDIT TEST]` rows were created; no cleanup required. Pre-existing junk
rows ("Ufdsdfghjhgfd", duplicate "Standing With Venezuela", several SCHEDULED items)
predate this audit and were left untouched.
