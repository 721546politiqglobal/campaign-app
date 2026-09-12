# Session Handoff — UI Internationalization (i18n)

**Date:** 2026-09-10
**Branch:** `ui-i18n` (created from `origin/main`)
**Status:** Implementation complete, reviewed, and verified. **Nothing is committed** — the user reviews and commits everything themselves (standing preference, not a mistake).

Read this first, then the two docs it references, before doing anything else.

## Read these next

- **Spec:** `docs/superpowers/specs/2026-09-08-ui-i18n-design.md` — what was built and why.
- **Plan:** `docs/superpowers/plans/2026-09-08-ui-i18n.md` — the 24-task implementation plan, already fully executed.

## What this feature does

Full English/Spanish UI translation for this Next.js 14 App Router campaign-management app, using `next-intl` **without URL-based locale routing** (no `/es/...` prefixes). Locale is a per-user account setting.

**How locale is resolved** (`src/lib/locale.ts`'s `getLocale()`), in priority order:
1. The signed-in user's session cookie (`peekSessionLocale()` in `src/lib/session.ts` — decodes the cookie's `locale` field with zero DB calls, HMAC-verified).
2. A `locale` cookie set by the pre-auth language toggle (login/join/landing pages).
3. The browser's `Accept-Language` header.
4. Default: `'en'`.

**Key files:**
- `src/lib/locale.ts` — `SUPPORTED_LOCALES`, `getLocale()`, `setLocaleCookie()`, `isSupportedLocale()`.
- `src/lib/session.ts` — `Session.locale` field, `peekSessionLocale()`, `hasValidSession()` (added late, see below).
- `src/i18n/request.ts` — next-intl's request config (fixed during final review to actually honor an explicitly-passed locale — see Rulings).
- `src/messages/en.json` / `es.json` — ~19 top-level namespaces, ~838 keys each, kept in exact parity.
- `src/components/LanguageSwitcher.tsx` — the dropdown in **Settings** for logged-in users.
- `src/components/PreAuthLanguageToggle.tsx` — the globe-icon toggle on the landing/login/join pages for logged-out visitors (hides itself if you're logged in — see "Post-plan polish" below).
- `supabase/migrations/040_user_locale.sql` — adds `users.locale` (no CHECK constraint by design — a third language later is a code-only change).

## What happened this session (chronological)

1. **Brainstorming → spec.** Classified as architectural work, wrote and got approval on `docs/superpowers/specs/2026-09-08-ui-i18n-design.md`.
2. **Plan.** Wrote `docs/superpowers/plans/2026-09-08-ui-i18n.md`, 24 tasks across 6 stages (foundation → shared chrome → core pages → remaining pages → pre-auth pages → server-action errors → final smoke test).
3. **Subagent-driven execution.** All 24 tasks implemented and reviewed (task-scoped reviewer per task, several fix rounds for real findings). **Process note:** per the user's "no autonomous commits" preference, nothing was committed per-task — instead the controller used `git stash create` + `git update-ref refs/sdd/task-N <sha>` to get diffable checkpoints without touching the branch. **These refs still exist** — `git diff refs/sdd/task-9 refs/sdd/task-10` shows just Task 10's changes, etc. (`git for-each-ref refs/sdd` lists them all). The `.superpowers/sdd/2026-09-08-ui-i18n/` scratch workspace (task briefs, review packages, the execution ledger) was deleted per the finishing skill's cleanup step — it's gone, this file is now the record.
4. **Final whole-branch review** (dispatched on Opus, since single-task reviews can't see cross-task issues). Found 6 real Important-severity bugs invisible to any one task's diff:
   - `src/i18n/request.ts` silently ignored the explicit locale argument next-intl passed it, so every `getTranslations({locale, namespace})` call in server actions (Tasks 22/23) fell back to the ambient cookie locale instead of the one it was explicitly given. **Fixed** — now honors `requestLocale`.
   - `joinAction` hardcoded `locale: 'en'`, discarding the pre-auth language toggle choice. **Fixed** — now resolves via `getLocale()`.
   - `content.types` message-catalog keys didn't match the `ContentType` enum's actual values, forcing 3+1 duplicated lookup maps and leaving 4 sites rendering raw English. **Fixed** — rekeyed to the enum, maps deleted.
   - The shared `next-intl/server` test mock (`src/test-setup.ts`) did regex substitution instead of real ICU MessageFormat, and silently returned a missing key instead of throwing. **Fixed** — rebuilt on `use-intl/core`'s `createTranslator` (real ICU, loud failure on a missing key).
   - `settings/locale-actions.test.ts` never actually asserted cookie re-signing or own-row DB scoping — the two properties the spec named as requirements. **Fixed** — added real assertions (decodes the signed cookie payload).
   - The whole app is now dynamically rendered (no static prerendering) because `getLocale()` calls `cookies()` in the root layout. This is an **inherent, accepted consequence** of the no-URL-routing design (the spec explicitly ruled out URL routing) — documented here, not "fixed," since there's no fix that doesn't reintroduce URL routing or drop the cookie-based approach.
5. **One fix wave** addressed all 6 Important findings plus 4 bundled cheap Minor fixes (LanguageSwitcher swallowing a failed action, StatusPill's hardcoded "Status:" aria-label prefix, an unchecked locale cast in Settings, missing cookie flags on `setLocaleCookie`). The fix agent was killed mid-run by an API rate limit right at the last item, but independent verification confirmed all 9 fixes had actually already landed correctly before the crash. Re-reviewed clean.
6. **Ran the pending Supabase migrations** against the **production** database (project `campaign project`, ref `dltahrjljptsmvksgqjl`):
   - Investigated all 40 migration files against live schema state (not just trusted the numbering) and found migrations aren't always applied in strict order — two were missing: `037_drop_campaign_monthly_cap.sql` and `040_user_locale.sql`.
   - **`040` — APPLIED.** Required for this feature (`users.locale` now exists in production).
   - **`037` — NOT applied.** It's a `DROP COLUMN` (removing a long-dead, unused `campaigns.monthly_cost_cap_cents` field) — unrelated to i18n, pure cleanup. The harness's safety classifier blocked automated execution of a destructive schema change against production twice, even after the user asked to run it. **This is still pending** — either run it yourself in the Supabase SQL editor, or leave it (it's inert, nothing reads that column):
     ```sql
     alter table campaigns drop column if exists monthly_cost_cap_cents;
     ```
7. **Post-plan polish** (triggered by the user asking how locale resolution actually behaves): found that the `PreAuthLanguageToggle` on the landing page was silently non-functional for logged-in users (session locale always wins over the pre-auth cookie it sets). Fixed:
   - Added `hasValidSession()` to `src/lib/session.ts` (cheap, DB-free, cosmetic-only check).
   - `src/app/page.tsx` now passes `isLoggedIn` down to `LandingPageClient`, which only renders the toggle when logged out.
   - Redesigned `PreAuthLanguageToggle.tsx`: globe icon (SVG, matches the app's existing icon style) + current language code (EN/ES), styled with a new `.lang-toggle` CSS class in `globals.css` matching the app's dark theme.
   - Verified via typecheck (clean), full test suite (465/465), and a simulated signed-cookie request confirming the toggle disappears when logged in. **Not yet visually confirmed in a live browser** — the Chrome extension was disconnected when this was done. Worth a quick look.

## Rulings made (why some things are the way they are)

- **No worktree** — plain branch in the main checkout, per explicit user override of the default SDD workflow.
- **No per-task git commits** — user's standing "no autonomous commits" preference; see the `refs/sdd/task-N` note above for how review-diffing worked instead.
- **`'use server'` functions use `getTranslations({locale, namespace})`** (explicit form), not the ambient `getTranslations(namespace)` form — required because this codebase unit-tests server actions directly via Vitest with no real Next.js request in flight.
- **`next-intl/server` is mocked globally** in `src/test-setup.ts` rather than changing Vitest's module resolution — a project-wide `resolve.conditions` change was rejected as too risky (React itself has a `react-server` condition that could silently break unrelated tests).
- **Locale lives in the signed session cookie**, not re-derived via a DB call in the root layout — this project's React (`18.3.1`) doesn't have React 19's `cache()`, so a naive "just cache the session lookup" fix wasn't available; the cookie-based approach avoids the extra DB round-trip entirely.
- **`pricing`/`setup` pages are authenticated, not pre-auth** — corrected mid-plan after the implementer flagged it; they render via the normal session-locale path like any other authenticated page, no toggle.

## What's NOT done / needs your attention

1. **Migration `037`** — optional, see above. Not required for anything to work.
2. **Live Spanish-locale verification of every authenticated page** — dashboard, content, settings, monitoring, analytics, avatars, team, billing, the whole admin section, pricing, setup. Every translation task in this plan was verified by reading code, typechecking, and building — never by an actual logged-in browser session, because this sandbox never had real Supabase login credentials. Static analysis can't catch things like a Spanish string overflowing a button. **Do a real click-through pass.**
3. **Visually confirm the redesigned language toggle** in a real browser (see item 7 above).
4. **Date/currency/number formatting stays hardcoded to `en-US`** regardless of locale — explicitly out of scope for this plan (the spec scoped it to UI text only), but it's the single largest remaining visible gap for a Spanish-speaking user (e.g. `$1,234.56`, `Sep 10, 2026`).
5. **~20 minor Spanish copy nits** scattered across various tasks — all grammatically correct, some could read more naturally. The landing page (5 of them) is worth a native-speaker pass since it's the highest-visibility surface.
6. A handful of small deferred items: `PARTIES` dropdown values (Democratic/Republican/etc.) render untranslated in Settings; a few error-message strings are near-duplicated across namespaces instead of shared; a Spanish gender/wording inconsistency between `admin.campaigns.detail.invite*` and `team.inviteStatus.*` for the identical "invite status" concept.

## Unrelated, pre-existing issue (do not confuse with this work)

`src/app/actions.scheduleWithTime.test.ts` has a **pre-existing, unrelated** test flake: it constructs a "scheduled time" using noon on a future calendar date rather than an actual N-hours-from-now timestamp, so it fails whenever the test suite runs after roughly noon Eastern time. Confirmed via `git diff` that this file (and the code it tests, `scheduleWithTimeAction`) was never touched by any task in this plan. Not something to fix as part of this work.

## Current repo state

```
git branch --show-current   # ui-i18n
git status --short          # ~69 files changed, all uncommitted
git diff --stat             # full change summary
git for-each-ref refs/sdd   # per-task diff checkpoints (git diff refs/sdd/task-N refs/sdd/task-N+1)
```

No branch has been merged and no PR has been opened. The next step is entirely up to the user: review the diff (in whole or per-task via the `refs/sdd/*` refs), commit it however they like, then decide on merge/PR/keep via the normal workflow.
