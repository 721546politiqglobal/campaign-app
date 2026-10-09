# UI/UX Revamp — Wave 2 shared brief

Read the spec first: `docs/superpowers/specs/2026-10-09-ui-ux-revamp-design.md`. Wave 1 (foundation) is done and reviewed. This brief is the contract every Wave 2 agent follows.

## Ground rules

- Branch `feat/ui-ux-revamp` is checked out. **Never** git commit / stash / checkout / reset / switch branches. The user commits.
- Never write to production data. `.env` points at the production Supabase project. Don't run scripts or curl against it. **Do not use the browser/Playwright tools** — five agents share one browser; visual QA happens in Wave 3.
- Five agents edit this repo **at the same time**. You own only the files in your scope. Shared files — `src/app/actions.ts`, `src/messages/en.json`, `src/messages/es.json`, `src/app/globals.css`, `src/lib/data.ts` — may be edited **surgically** (small, targeted Edit calls touching only your functions / your keys / your CSS section). Always re-Read the relevant region right before each edit; if an edit fails because the file changed, re-read and retry. Never rewrite or reformat a shared file wholesale. Never revert changes you didn't make.
- `typecheck`/`vitest` may transiently show failures from another agent's in-progress work. Fix everything in your files; for failures elsewhere, re-run once later and mention them in your report if they persist.
- Keep tests green. When you change an action's behavior or DB call chain, update its colocated `*.test.ts` (hand-rolled `adminDb.from` mocks throw on unexpected tables). Add tests for new action behavior (follow the existing patterns, e.g. `src/app/settings/locale-actions.test.ts`, `src/app/actions.publish.test.ts`).
- i18n: every user-visible string via next-intl, new keys in **both** `en.json` and `es.json` (natural Spanish), parity test `src/messages/parity.test.ts`. Server actions use `getTranslations({ locale: s.locale, namespace })`. Never show raw provider/Stripe/DB error text — `console.error` it and return a translated message.
- Dates/numbers/currency: format with the active locale (`useFormatter()` in client components, `getFormatter()` / `getLocale()` in server components) — no hardcoded `'en-US'`.
- Match the surrounding code style. No new dependencies.

## Design system API (Wave 1)

Theme: light default + dark (`<html data-theme>`), tokens in `globals.css` §1. Use tokens (`var(--surface)`, `var(--text-2)`, `var(--border)`, `var(--accent)`, `var(--ok)`, `var(--s-4)`, `var(--r-lg)` …), never hardcoded colors (no `#fff`, `rgba(255,255,255,…)`, old orange `rgba(249,115,22,…)`). **Goal: remove inline `style={{}}` objects from your pages** — replace with classes. Add page-specific CSS in your own clearly commented section near the end of `globals.css` (before the responsive section), prefixed with your area (e.g. `/* ── Content wizard ── */`, classes like `.wizard-*`).

Classes:
- Typography: `h1`–`h4` (real headings), `.eyebrow`, `.lead`, `.muted`, `.subtle`, `.text-sm`, `.text-xs`, `.mono`, `.num` (tabular), `.link`, `.kbd`, `.sr-only`.
- Layout: `.stack` (vertical gap), `.row-between`, `.grid .cols-2 / .cols-4` (collapse on mobile), `.spacer-y`, `.divider`, `.section-header`, `.form-actions`, `.btnrow`.
- Buttons: `.btn` + `.btn-primary | .btn-secondary(default) | .btn-ghost | .btn-danger | .btn-danger-soft`, sizes `.btn-sm | .btn-lg`, `.btn-icon`, `.btn-block`. `aria-busy="true"` shows a spinner. Always set `type=`.
- Cards: `.card`, `.card-sm`, `.card-header` (`.card-header-text` > title + `.card-header-desc`, `.card-header-actions`), `.card-body`, `.card-footer`.
- Stats: `.stat` > `.stat-header` (`.stat-label`, `.stat-icon`), `.stat-value` (+`.num`), `.stat-hint`, `.stat-delta`.
- Forms: `.field`, `.field-label`, `.field-hint`, `.field-error`, `.field-required`, `.field-label-optional`, `.field-row`, `.input`, `.input-sm`, `.input-group`, `.checkrow`. Native inputs/selects/textareas are styled automatically.
- Tables: wrap in `.table-wrap`; `table` styled globally; `.table-num`, `.table-actions`, `.table-empty`, `.table-sticky`, `.row-hover`, `.row-link` (put a real `<Link>` in the primary cell; the class stretches it over the row).
- Badges: `.badge .badge-{neutral|accent|ok|warn|bad|info|purple}` `.badge-dot` `.badge-sm`; legacy `.pill.<status>` and `.tag` still work.
- Alerts: `.alert .alert-{info|ok|warn|bad}` > icon + `.alert-body` (`.alert-title`, `.alert-text`) + `.alert-actions`. (`.banner`, `.banner.ok|warn|bad|info` are aliases.)
- Nav-ish: `.tabs` (links/buttons; active via `aria-current="page"` or `aria-selected`), `.segmented` / `.segmented-sm`, `.breadcrumb`, `.stepper`.
- Misc: `.skeleton`, `.spinner`, `.empty-state`, `.dialog*`, `.toast*`.

React components:
- `@/components/ui/PageHeader` — `{ title, description?, eyebrow?, actions?, breadcrumb?: {label, href?}[], meta? }`. Every page starts with one.
- `@/components/ui/EmptyState` — `{ icon?: IconName|node, title, description?, action?, plain? }`.
- `@/components/ui/Field` — `{ label, hint?, error?, required?, htmlFor?, optionalLabel?, children: node | (p)=>node }`; render-prop `p` = `{ id, aria-describedby, aria-invalid }`. Labels must always be associated.
- `@/components/ui/Badge` — `{ tone?, dot?, size? }`. `@/components/StatusPill` for content status.
- `@/components/ui/Dialog` — native `<dialog>`: `{ open, onClose, title, description?, footer?, size?: 'sm'|'md'|'lg', closeOnBackdrop?, hideClose?, initialFocusRef? }`. Replace every `.modal-backdrop` div modal with this.
- `@/components/ui/ConfirmDialog` — `const confirm = useConfirm(); if (!(await confirm({ title, description, confirmLabel, cancelLabel, tone: 'danger' }))) return;` (provider already mounted). Use it for every destructive / billing / irreversible action.
- `@/components/SubmitButton` — `{ pendingText?, variant?, size?, block?, disabled?, name?, value?, formAction? }`. **Use on every `<form action>`.**
- `@/components/Toast` — `const { toast } = useToast(); toast(msg, 'success'|'error'|'info')`.
- `@/components/icons` — `<Icon name="plus" size={16} />` or named exports (`PlusIcon`…). Names: dashboard, content, monitoring, analytics, channels, avatars, team, billing, settings, users, audit, campaign, plus, check, x, chevron-left/right/down/up, arrow-right/left, external, copy, trash, edit, refresh, search, filter, calendar, clock, sun, moon, monitor, menu, logout, globe, alert, info, success, error, video, mic, play, upload, sparkles, shield, eye, more, download, send, lock, mail, link, image, home, inbox, pause. No emoji or unicode glyphs as icons.
- `@/components/Logo`, `@/components/ThemeToggle`, `@/components/PreAuthLanguageToggle`.
- Shell: authenticated pages render inside `<AppFrame>` (sidebar, mobile drawer, max-width content). Admin pages inside `AdminFrame` via `admin/layout.tsx`. Don't rebuild the shell.

## UX standards (every page/component in your scope)

1. `PageHeader` at the top; consistent spacing via `.stack`.
2. `loading.tsx` matching the page layout (wrap in `AppShellSkeleton`; use `.skeleton` blocks, no inline-style soup).
3. Designed `EmptyState` with a CTA where lists can be empty.
4. Every mutation shows pending state and success feedback (toast or inline “Saved”), and errors inline/toast in translated text.
5. Client handlers calling server actions: `try { … } catch { toast(t('genericError'),'error') } finally { setBusy(false) }` — never a stuck busy state; check `result.ok`.
6. Forms with server validation: `useFormState` (from `react-dom`, React 18) returning `{ ok, error?, fieldErrors?, values? }` so input survives errors; native constraints (`required`, `type`, `minLength`) too. No `?error=` query-string round-trips for validation.
7. Destructive/billing actions go through `useConfirm()`.
8. Keyboard accessible: real `<button>`/`<Link>`, labels associated, focus visible, dialogs via `Dialog`. `<a href>` to internal routes → `next/link`.
9. Responsive down to 360px: no horizontal page scroll (tables scroll inside `.table-wrap`; grids collapse).
10. Remove dead code you find in your scope (verify with grep).

## Report back (≤600 words)

Files changed; functional fixes made (map to spec item numbers); new i18n keys namespaces; tests added; typecheck + vitest result; anything you deliberately left out or that needs a product decision.
