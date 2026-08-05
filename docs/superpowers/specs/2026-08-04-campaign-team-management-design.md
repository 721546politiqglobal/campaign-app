# Campaign-Owner Team Management — Design Spec

**Date:** 2026-08-04
**Status:** Approved

---

## Overview

Today, only a `super_admin` can add, invite, or remove a campaign's teammates, via `/admin/campaigns/[id]` (`src/app/admin/actions.ts`). The campaign-facing `/settings` page shows a **read-only** "Team" table with the note *"To add a team member, contact your platform administrator."* (`src/app/settings/page.tsx:243-245`).

This is the last "campaign owner has to go through the admin" gap — self-service avatar creation and voice cloning already exist for `owner`/`manager` roles via `manage_avatars`. This spec closes the gap for team management: campaign owners and managers get their own invite/remove/role-change UI on `/settings`, reusing the same `invite_codes`/`users` tables and `/join` acceptance flow the admin path already uses. No email sending is added — invites remain copyable `/join?code=...` links, matching how admin invites work today.

---

## Current State vs. New State

| | Today | After this spec |
|---|---|---|
| Who can invite a teammate | Only `super_admin`, via `/admin/campaigns/[id]` | Also `owner`/`manager`, via `/settings` |
| Who can remove/change a teammate's role | Only `super_admin` | Also `owner`/`manager` (except touching an `owner`) |
| Invite delivery | Copyable `/join?code=...` link, shared manually | Same — no email integration added |
| `/settings` Team card | Read-only table + "contact your admin" message | Interactive: roster with role-change/remove, invite form, pending-invites list |
| Admin panel (`/admin`) | Full invite/remove/role control | Unchanged — remains available as a fallback/override path |

---

## Permissions

New action added to the existing matrix in `src/lib/permissions.ts`:

```ts
type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings' | 'manage_avatars' | 'manage_team';
const PERMISSIONS: Record<Action, Role[]> = {
  ...
  manage_team: ['owner', 'manager'],
};
```

Two additional rules are enforced **inside the server actions themselves** (not just hidden in the UI), since they're not expressible as a flat role gate:

1. **Invite role ceiling** — the invite form only offers `manager | staff | approver`. `super_admin` is never assignable (no admin bootstrap happens from this UI), and neither is `owner` — there is exactly one owner per campaign, and creating a second (or letting an inviter hand off their own role) is out of scope. Enforced by validating the submitted role against a fixed `INVITABLE_ROLES = ['manager', 'staff', 'approver']` list, both in the form's `<select>` options and server-side in `inviteTeammateAction`/`changeTeammateRoleAction`.
2. **Owner is untouchable from this UI** — `removeTeammateAction` and `changeTeammateRoleAction` both reject if the *target* user's current role is `owner`, regardless of whether the caller is `owner` or `manager`. Owner reassignment/removal remains an admin-only operation via `/admin` — out of scope here.

`manager`-vs-`manager` note: a `manager` **can** remove or change the role of another `manager` (and of `staff`/`approver`) — the only role the `manage_team` gate protects is `owner`. This matches the discussed design: managers can fully manage the team short of touching the owner.

---

## Data Model

No schema changes. Reuses tables and columns exactly as they exist today:

- `invite_codes` (`code`, `campaign_id`, `role`, `created_by`, `expires_at`, `used_by`, `used_at`) — already generic, not admin-specific.
- `users` (`id`, `campaign_id`, `name`, `email`, `role`) — already campaign-scoped.
- `billing_plans.seat_limit` via the existing `getCampaignSeatUsage(campaignId)` (`src/lib/data.ts:413-422`) — already campaign-scoped, reused as-is for seat-limit enforcement on invites.
- `getUsers(campaignId)` (`src/lib/data.ts:44-47`) and `getInviteCodes(campaignId)` (`src/lib/data.ts:347-362`) — already campaign-scoped, reused as-is for listing the roster and pending invites.

---

## Backend

New file `src/app/settings/team-actions.ts` (`'use server'` at the top, mirroring the structure of `src/app/admin/actions.ts`), containing three actions. All three call `requireSession()` first (never `requireAdmin()`), then gate on `can(s.role, 'manage_team')`, and scope every query to `s.campaignId` — never a client-supplied campaign id:

1. **`inviteTeammateAction(formData): Promise<{ ok: boolean; error?: string }>`**
   - Validates `role` is one of `INVITABLE_ROLES`.
   - Checks `getCampaignSeatUsage(s.campaignId)`; if `limit !== null && used >= limit`, returns `{ ok: false, error: '...' }` (surfaced in the UI with a link to `/pricing`) instead of admin's current silent bail — this path is user-facing, not an internal tool.
   - Inserts into `invite_codes` (`code: inviteCode()`, `campaign_id: s.campaignId`, `role`, `created_by: s.userId`, 7-day `expires_at`) — identical shape to `generateInviteAction` (`src/app/admin/actions.ts:25-46`).
   - `revalidatePath('/settings')`; returns `{ ok: true }`. The new invite then simply appears in the pending-invites list (same pattern as admin — no special "here's your new code" return path needed).

2. **`removeTeammateAction(userId: string): Promise<{ ok: boolean; error?: string }>`**
   - Fetches the target user, confirms `target.campaign_id === s.campaignId` (rejects otherwise — can't reach into another tenant), confirms `target.role !== 'owner'`.
   - Deletes the `users` row (same as `removeUserAction`, `src/app/admin/actions.ts:287-298`); `revalidatePath('/settings')`.

3. **`changeTeammateRoleAction(userId: string, newRole: string): Promise<{ ok: boolean; error?: string }>`**
   - New action — no admin equivalent exists today (admin has no role-change UI, only remove + re-invite). Same target-scoping/owner-immunity checks as above, plus `newRole` validated against `INVITABLE_ROLES`.
   - Updates `users.role`; `revalidatePath('/settings')`.

All three return `{ ok, error? }` (matching `assignPlanAction`'s existing shape, `src/app/admin/actions.ts:93`) rather than the void-return/silent-bail style of the older admin actions, since these are called from an interactive client component that needs to display the failure inline, not from a bare `<form action={...}>`.

---

## UI/UX

`src/app/settings/page.tsx` changes:
- Add `getInviteCodes(s.campaignId)` and `getCampaignSeatUsage(s.campaignId)` to the existing `Promise.all(...)` (alongside `getCampaign`, `getDisclosureRules`, `getUsers`, `getCandidateProfile`).
- Compute `canManageTeam = can(s.role, 'manage_team')`.
- Build each invite's shareable URL server-side (`` `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/join?code=${code}` ``, matching `src/app/admin/campaigns/[id]/page.tsx:374`) so the client component never needs the env var itself.
- Replace the static Team card (lines 230-246) with `<TeamManager users={users} inviteCodes={inviteCodesWithShareUrl} seatUsage={seatUsage} canManage={canManageTeam} />`.

New client component `src/components/TeamManager.tsx` (mirrors the self-contained pattern of `AvatarManager`/`VoiceCloneManager` — calls server actions directly and holds its own local error/pending state, rather than a bare `<form action={...}>`, because it needs to display `{ ok, error }` results inline):

- **Roster table**: Name, Email, Role. If `canManage`: a role `<select>` (options: current role + `INVITABLE_ROLES`, disabled/absent entirely for the row where `role === 'owner'`) and a "Remove" button (same owner-row exclusion). Calls `changeTeammateRoleAction`/`removeTeammateAction` directly; shows the returned error inline on failure.
- **Pending invites table** (only rendered if `canManage`, since non-managers have no use for it): Role, Expires, Status (`used` / `expired` / `active`, derived the same way admin's table already derives it), and the copyable share link.
- **Invite form** (only if `canManage`): role `<select>` over `INVITABLE_ROLES` + "Generate invite link" button, calling `inviteTeammateAction`. If `seatUsage.limit !== null && seatUsage.used >= seatUsage.limit`, the form is replaced with a banner: *"Your plan's seat limit is reached."* + a link to `/pricing` (confirmed to exist at `src/app/pricing/page.tsx`).
- Non-`canManage` users (staff/approver) see the roster table only, no pending-invites list, no invite form, no owner-contact message (removed entirely — self-service replaces it).

---

## Error Handling

Same defense-in-depth precedent as `manage_avatars`: the UI hides invite/remove/role-change controls for non-owner/manager roles and for the owner's own row, but every action independently re-checks `can(s.role, 'manage_team')`, campaign ownership of the target user, and owner-immunity — so a direct action call (bypassing the UI) can't do anything the UI wouldn't allow. Seat-limit and owner-immunity failures return `{ ok: false, error: string }`, rendered inline by `TeamManager` exactly like `AvatarManager`/`VoiceCloneManager` already render their own action failures — no new error-handling pattern introduced.

---

## Testing

New `src/app/settings/team-actions.test.ts`, following the conventions of `src/app/actions.avatar-digital-twin.test.ts`:
- Permission denial for `staff`/`approver` on all three actions.
- `inviteTeammateAction`: rejects an invitable-role list violation (e.g. `role: 'owner'`); rejects when seat limit is reached; succeeds and inserts a correctly-shaped `invite_codes` row otherwise.
- `removeTeammateAction` / `changeTeammateRoleAction`: rejects when target is `owner`; rejects when target belongs to a different `campaign_id` than the caller; succeeds otherwise.
- No changes needed to `joinAction` or its existing tests — acceptance is already generic over who created the invite.

---

## Alternatives Considered

1. **Chosen — campaign-scoped ports of the admin's existing actions, plus one new `manage_team` permission and one new role-change action.** Minimal new surface area; reuses `invite_codes`/`users`/`/join` exactly as they exist; consistent with how `manage_avatars` already made avatars/voice self-service without touching the admin path.
2. **Add real email delivery for invites.** Rejected for this spec: no email provider exists anywhere in the codebase today (admin invites are link-only), and adding one is a separate, larger scope (provider selection, deliverability, templates) than the actual gap (campaign owners currently can't invite at all). Link-only matches the existing admin pattern exactly and ships immediately.
3. **Flat `manage_team` gate with no owner-immunity carve-out** (i.e., let a `manager` remove or reassign the `owner`). Rejected: would let a manager lock out or demote the person ultimately accountable for the campaign; owner changes stay an explicit admin-only operation.
4. **Let managers manage everyone except themselves and the owner** (i.e., prevent manager-on-manager removal). Considered and rejected per discussion — managers are trusted with full team control short of the owner, keeping the permission model to a single flat gate (`manage_team`) plus one carve-out (owner-immunity), rather than a second peer-protection rule.

---

## Out of Scope

- Email sending / invite notifications (see Alternative 2).
- Owner reassignment or removal (remains admin-only via `/admin`).
- Multi-campaign users / many-to-many user↔campaign relationships (the schema is single-tenant-per-user today; unrelated to this feature).
- Any change to the admin panel's own invite/user UI — it remains untouched and fully functional as a fallback.
- Bulk invite (CSV/multiple emails at once) — one role-scoped link at a time, matching the existing admin flow.
