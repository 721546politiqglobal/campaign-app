# Role-Based Permission Gates — Design Spec

**Date:** 2026-06-30  
**Status:** Approved

---

## Overview

Add enforced permission gates for the four campaign-level roles (`owner`, `manager`, `approver`, `staff`). Currently all four roles have identical access. This spec covers a centralized permission utility, server-side enforcement in actions, and UI-level hiding/disabling of restricted controls.

`super_admin` is unaffected — it already has its own `requireAdmin()` gate.

---

## Permission Matrix

| Action | owner | manager | approver | staff |
|---|---|---|---|---|
| Create content | ✅ | ✅ | ✅ | ✅ |
| Edit content body | ✅ | ✅ | ✅ | ✅ |
| Submit for review | ✅ | ✅ | ✅ | ✅ |
| Approve content (text + video) | ✅ | ✅ | ✅ | ❌ |
| Schedule content | ✅ | ✅ | ❌ | ❌ |
| Publish content | ✅ | ✅ | ❌ | ❌ |
| Edit settings | ✅ | ✅ | ❌ | ❌ |

Actions not in the matrix (create, edit body, submit for review) require no gate — every role can perform them.

---

## Architecture

### 1. Core utility — `src/lib/permissions.ts` (new file)

Exports two functions:

```ts
type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings'

function can(role: Role, action: Action): boolean
function assertCan(role: Role, action: Action): void  // throws PermissionError if denied
```

- `can()` is a pure function — a plain object lookup. Both server actions and UI components import it.
- `assertCan()` wraps `can()` and throws a `PermissionError` (extends `Error`) when denied.
- The permission map is a single object literal in this file — the entire matrix is visible at a glance.

### 2. Server action enforcement — `src/app/actions.ts` and `src/app/settings/page.tsx`

Each restricted action uses an early-return guard immediately after `requireSession()`:

```ts
if (!can(s.role, 'approve')) return { ok: false, error: 'Permission denied.' };
```

| Action function | Gate |
|---|---|
| `approveTextAction` | `can(s.role, 'approve')` |
| `confirmVideoAction` | `can(s.role, 'approve')` |
| `scheduleAction` | `can(s.role, 'schedule')` |
| `publishAction` | `can(s.role, 'publish')` |
| `setCapAction` | `can(s.role, 'edit_settings')` |
| `saveProfileAction` | `can(s.role, 'edit_settings')` |

Early return (not throw) is used because the existing `guard()` wrapper only catches `GateError` and `CapExceeded` — a thrown `PermissionError` would propagate unhandled. The early-return pattern is consistent with how the actions already handle not-found cases and works regardless of whether the action uses `guard()`.

`saveProfileAction` is a void server action (no `Result` return). It uses `redirect('/settings')` after checking — the UI never shows the form to restricted roles anyway, so this is defense-in-depth only.

### 3. UI enforcement

**Content detail page** (`src/app/content/[id]/page.tsx`):
- `s.role` is passed into `ContentEditor` as a new `role` prop.
- `ContentEditor` imports `can()` and conditionally renders:
  - Approve button — hidden when `!can(role, 'approve')`
  - Schedule / Publish buttons — hidden when `!can(role, 'schedule')` / `!can(role, 'publish')`

**Settings page** (`src/app/settings/page.tsx`):
- `approver` and `staff` see settings as **read-only** (inputs have `disabled`, save buttons are hidden).
- The page is not blocked — they can still view the candidate profile and campaign info.
- A single `canEdit` boolean (`can(s.role, 'edit_settings')`) controls all disabled/hidden states on the page.

---

## Error Handling

- Server: early `return { ok: false, error: 'Permission denied.' }` before any side effects — consistent shape with all other action errors.
- UI: action buttons are hidden (not just disabled) so restricted users never see controls they can't use. Settings inputs are disabled (read-only) rather than hidden, so lower roles can still see the current configuration.

---

## Files Changed

| File | Change |
|---|---|
| `src/lib/permissions.ts` | **New** — `can()` |
| `src/app/actions.ts` | Add `assertCan()` to 4 actions |
| `src/app/settings/page.tsx` | Add `canEdit` flag, disable inputs + hide save buttons |
| `src/app/content/[id]/page.tsx` | Pass `role` to `ContentEditor` |
| `src/components/ContentEditor.tsx` | Accept `role` prop, conditionally render action buttons |

---

## Out of Scope

- Monitoring page — read-only by nature, no restricted actions.
- Dashboard — no restricted actions.
- Admin panel — already gated by `requireAdmin()` / `super_admin`.
- Audit log — already read-only.
