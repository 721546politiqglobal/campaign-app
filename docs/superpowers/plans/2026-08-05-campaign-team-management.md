# Campaign-Owner Team Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let campaign `owner`/`manager` roles invite, remove, and change the role of their own teammates directly from `/settings`, without needing a platform `super_admin`.

**Architecture:** Add one new permission (`manage_team`) to the existing `can()` matrix; port the admin's invite/remove logic (`src/app/admin/actions.ts`) into three new campaign-scoped server actions in `src/app/settings/team-actions.ts`; build a client component (`src/components/TeamManager.tsx`, following the same direct-action-call pattern as `VoiceCloneManager.tsx`) that replaces the read-only Team card on `/settings`. No schema changes, no email integration — invites remain copyable `/join?code=...` links, exactly as they work today for admin-created invites.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres via `adminDb` service-role client, no RLS in app code), Vitest for tests, custom cookie-based session auth (`src/lib/session.ts`).

## Global Constraints

- Every new/modified server action must call `requireSession()` (never `requireAdmin()`) and scope all queries to the caller's own `s.campaignId` — never trust a client-supplied campaign id.
- The invite role ceiling is exactly `manager | staff | approver` — `owner` and `super_admin` must never be assignable from this UI.
- No user with role `owner` may ever be removed or have their role changed via these new actions, regardless of the caller's role.
- No email sending — invites are copyable `/join?code=...` links only, per the approved spec (`docs/superpowers/specs/2026-08-04-campaign-team-management-design.md`).
- Test runner is Vitest (`npm test` = `vitest run`); mirror the mocking conventions already used in `src/app/actions.avatar-digital-twin.test.ts` and `src/lib/permissions.test.ts`.
- Run `npm run typecheck` before committing any task that touches `.ts`/`.tsx` files.

---

### Task 1: Add the `manage_team` permission

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/lib/permissions.test.ts`

**Interfaces:**
- Produces: `can(role: Role, action: 'manage_team'): boolean`, added alongside the existing `Action` union in `src/lib/permissions.ts`.

- [ ] **Step 1: Write the failing tests**

Add this block to the end of `src/lib/permissions.test.ts` (after the existing `describe('can – manage_avatars', ...)` block, before the `super_admin` denial block):

```ts
describe('can – manage_team', () => {
  it('allows owner',    () => expect(can('owner',    'manage_team')).toBe(true));
  it('allows manager',  () => expect(can('manager',  'manage_team')).toBe(true));
  it('denies approver', () => expect(can('approver', 'manage_team')).toBe(false));
  it('denies staff',    () => expect(can('staff',    'manage_team')).toBe(false));
});
```

Also add `'manage_team'` to the `actions` array in the existing `super_admin` denial block so it's covered there too:

```ts
const actions = ['approve', 'schedule', 'publish', 'edit_settings', 'manage_avatars', 'manage_team'] as const;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/permissions.test.ts`
Expected: FAIL — `'manage_team'` is not assignable to the `Action` type / `can` throws or the new assertions fail, since `PERMISSIONS` has no `manage_team` key yet.

- [ ] **Step 3: Implement the permission**

Update `src/lib/permissions.ts` to:

```ts
import type { Role } from '@/domain/types';

type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings' | 'manage_avatars' | 'manage_team';

const PERMISSIONS: Record<Action, Role[]> = {
  approve:        ['owner', 'manager', 'approver'],
  schedule:       ['owner', 'manager'],
  publish:        ['owner', 'manager'],
  edit_settings:  ['owner', 'manager'],
  manage_avatars: ['owner', 'manager'],
  manage_team:    ['owner', 'manager'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/permissions.test.ts`
Expected: PASS, all tests including the new `manage_team` block and the updated `super_admin` denial block.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "feat(permissions): add manage_team action for owner/manager"
```

---

### Task 2: Shared invitable-roles constant

**Why a separate file:** `src/app/settings/team-actions.ts` (Task 3) will start with the `'use server'` directive, which restricts that file to exporting only async functions — it cannot also export a plain constant array. `src/components/TeamManager.tsx` (Task 4) also needs the same role list for its `<select>` options. So the list lives in its own plain module both can import.

**Files:**
- Create: `src/lib/team-roles.ts`
- Test: `src/lib/team-roles.test.ts`

**Interfaces:**
- Produces: `INVITABLE_ROLES: readonly ['manager', 'staff', 'approver']`, `type InvitableRole = 'manager' | 'staff' | 'approver'`, `isInvitableRole(value: string): value is InvitableRole` — all imported by Task 3 (`team-actions.ts`) and Task 4 (`TeamManager.tsx`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/team-roles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { INVITABLE_ROLES, isInvitableRole } from './team-roles';

describe('INVITABLE_ROLES', () => {
  it('is exactly manager, staff, approver — never owner or super_admin', () => {
    expect(INVITABLE_ROLES).toEqual(['manager', 'staff', 'approver']);
  });
});

describe('isInvitableRole', () => {
  it('accepts manager, staff, approver', () => {
    expect(isInvitableRole('manager')).toBe(true);
    expect(isInvitableRole('staff')).toBe(true);
    expect(isInvitableRole('approver')).toBe(true);
  });

  it('rejects owner, super_admin, and garbage input', () => {
    expect(isInvitableRole('owner')).toBe(false);
    expect(isInvitableRole('super_admin')).toBe(false);
    expect(isInvitableRole('')).toBe(false);
    expect(isInvitableRole('OWNER')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/team-roles.test.ts`
Expected: FAIL — `src/lib/team-roles.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/team-roles.ts`:

```ts
export const INVITABLE_ROLES = ['manager', 'staff', 'approver'] as const;

export type InvitableRole = typeof INVITABLE_ROLES[number];

export function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/team-roles.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/team-roles.ts src/lib/team-roles.test.ts
git commit -m "feat: add shared INVITABLE_ROLES constant for team management"
```

---

### Task 3: Campaign-scoped team management server actions

**Files:**
- Create: `src/app/settings/team-actions.ts`
- Test: `src/app/settings/team-actions.test.ts`

**Interfaces:**
- Consumes: `can(role, action)` from `src/lib/permissions.ts` (Task 1); `INVITABLE_ROLES`, `isInvitableRole` from `src/lib/team-roles.ts` (Task 2); `requireSession(): Promise<Session & { campaignId: string }>` from `src/lib/session.ts` (existing, `Session` has `userId: string`, `role: Role`, `campaignId: string`); `getCampaignSeatUsage(campaignId: string): Promise<{ used: number; limit: number | null }>` and `inviteCode(): string` (existing, from `src/lib/data.ts` and `src/lib/store.ts`); `adminDb`, `throwOnError` from `src/lib/supabase.ts` (existing).
- Produces: `inviteTeammateAction(formData: FormData): Promise<{ ok: boolean; error?: string }>`, `removeTeammateAction(userId: string): Promise<{ ok: boolean; error?: string }>`, `changeTeammateRoleAction(userId: string, newRole: string): Promise<{ ok: boolean; error?: string }>` — all consumed by `src/components/TeamManager.tsx` (Task 4) and `src/app/settings/page.tsx` (Task 5).

- [ ] **Step 1: Write the failing tests**

Create `src/app/settings/team-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session: { userId: string; name: string; role: string; campaignId: string; exp: number } = {
  userId: 'u-owner', name: 'Owner', role: 'owner', campaignId: 'c-1', exp: 9_999_999_999,
};
let targetUser: { id: string; role: string; campaign_id: string } | null = null;
let seatUsage: { used: number; limit: number | null } = { used: 1, limit: null };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => Promise.resolve(session)),
}));

vi.mock('@/lib/data', () => ({
  getCampaignSeatUsage: vi.fn(() => Promise.resolve(seatUsage)),
}));

vi.mock('@/lib/store', () => ({ inviteCode: vi.fn(() => 'inv_test123') }));

const insertInviteCode = vi.fn(() => Promise.resolve({ data: null, error: null }));
const updateUser = vi.fn(() => Promise.resolve({ data: null, error: null }));
const deleteUser = vi.fn(() => Promise.resolve({ data: null, error: null }));

vi.mock('@/lib/supabase', () => ({
  adminDb: {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: targetUser, error: null })),
            })),
          })),
          update: vi.fn((patch: unknown) => ({
            eq: (...args: unknown[]) => updateUser(patch, ...args),
          })),
          delete: vi.fn(() => ({
            eq: (...args: unknown[]) => deleteUser(...args),
          })),
        };
      }
      if (table === 'invite_codes') {
        return { insert: vi.fn((row: unknown) => insertInviteCode(row)) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  },
  throwOnError: vi.fn(async (query: Promise<{ data: unknown; error: unknown }>) => {
    const { error } = await query;
    if (error) throw error;
  }),
}));

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.role = 'owner';
  session.userId = 'u-owner';
  session.campaignId = 'c-1';
  targetUser = { id: 'u-2', role: 'staff', campaign_id: 'c-1' };
  seatUsage = { used: 1, limit: null };
});

describe('inviteTeammateAction', () => {
  it('denies staff', async () => {
    session.role = 'staff';
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'manager' }));
    expect(result).toEqual({ ok: false, error: 'Permission denied.' });
    expect(insertInviteCode).not.toHaveBeenCalled();
  });

  it('rejects role "owner"', async () => {
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'owner' }));
    expect(result.ok).toBe(false);
    expect(insertInviteCode).not.toHaveBeenCalled();
  });

  it('blocks when the seat limit is reached', async () => {
    seatUsage = { used: 3, limit: 3 };
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'manager' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/seat limit/i);
    expect(insertInviteCode).not.toHaveBeenCalled();
  });

  it("creates an invite scoped to the caller's own campaign", async () => {
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'manager' }));
    expect(result).toEqual({ ok: true });
    expect(insertInviteCode).toHaveBeenCalledWith(expect.objectContaining({
      campaign_id: 'c-1', role: 'manager', created_by: 'u-owner', code: 'inv_test123',
    }));
  });

  it('allows a manager to invite too', async () => {
    session.role = 'manager';
    const { inviteTeammateAction } = await import('./team-actions');
    const result = await inviteTeammateAction(formData({ role: 'staff' }));
    expect(result).toEqual({ ok: true });
  });
});

describe('removeTeammateAction', () => {
  it('denies approver', async () => {
    session.role = 'approver';
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-2');
    expect(result).toEqual({ ok: false, error: 'Permission denied.' });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('refuses to remove the owner', async () => {
    targetUser = { id: 'u-owner-2', role: 'owner', campaign_id: 'c-1' };
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-owner-2');
    expect(result.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('refuses to remove a user from a different campaign', async () => {
    targetUser = { id: 'u-2', role: 'staff', campaign_id: 'c-other' };
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-2');
    expect(result.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("removes a staff teammate in the caller's own campaign", async () => {
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-2');
    expect(result).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith('id', 'u-2');
  });

  it('allows a manager to remove another manager', async () => {
    session.role = 'manager';
    targetUser = { id: 'u-3', role: 'manager', campaign_id: 'c-1' };
    const { removeTeammateAction } = await import('./team-actions');
    const result = await removeTeammateAction('u-3');
    expect(result).toEqual({ ok: true });
  });
});

describe('changeTeammateRoleAction', () => {
  it('denies staff', async () => {
    session.role = 'staff';
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-2', 'manager');
    expect(result).toEqual({ ok: false, error: 'Permission denied.' });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid target role', async () => {
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-2', 'owner');
    expect(result.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses to change the owner's role", async () => {
    targetUser = { id: 'u-owner-2', role: 'owner', campaign_id: 'c-1' };
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-owner-2', 'manager');
    expect(result.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('refuses to change a user in a different campaign', async () => {
    targetUser = { id: 'u-2', role: 'staff', campaign_id: 'c-other' };
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-2', 'manager');
    expect(result.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('updates the role for a valid target', async () => {
    const { changeTeammateRoleAction } = await import('./team-actions');
    const result = await changeTeammateRoleAction('u-2', 'approver');
    expect(result).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ role: 'approver' }, 'id', 'u-2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/settings/team-actions.test.ts`
Expected: FAIL — `src/app/settings/team-actions.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement the actions**

Create `src/app/settings/team-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { adminDb, throwOnError } from '@/lib/supabase';
import { inviteCode } from '@/lib/store';
import { getCampaignSeatUsage } from '@/lib/data';
import { isInvitableRole } from '@/lib/team-roles';

export async function inviteTeammateAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_team')) return { ok: false, error: 'Permission denied.' };

  const role = String(formData.get('role') ?? '');
  if (!isInvitableRole(role)) return { ok: false, error: 'Invalid role.' };

  // An unused invite is a reserved seat — count it against the plan limit too,
  // same rule the admin's generateInviteAction already enforces.
  const seats = await getCampaignSeatUsage(s.campaignId);
  if (seats.limit !== null && seats.used >= seats.limit) {
    return { ok: false, error: "Your plan's seat limit is reached. Upgrade your plan to add more teammates." };
  }

  await throwOnError(
    adminDb.from('invite_codes').insert({
      code: inviteCode(),
      campaign_id: s.campaignId,
      role,
      created_by: s.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    'invite_codes.invite_teammate',
  );

  revalidatePath('/settings');
  return { ok: true };
}

export async function removeTeammateAction(userId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_team')) return { ok: false, error: 'Permission denied.' };

  const { data: target } = await adminDb.from('users').select('id, role, campaign_id').eq('id', userId).maybeSingle();
  if (!target || target.campaign_id !== s.campaignId) return { ok: false, error: 'User not found.' };
  if (target.role === 'owner') return { ok: false, error: "The campaign owner can't be removed." };

  await throwOnError(adminDb.from('users').delete().eq('id', userId), 'users.remove_teammate');
  revalidatePath('/settings');
  return { ok: true };
}

export async function changeTeammateRoleAction(userId: string, newRole: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_team')) return { ok: false, error: 'Permission denied.' };
  if (!isInvitableRole(newRole)) return { ok: false, error: 'Invalid role.' };

  const { data: target } = await adminDb.from('users').select('id, role, campaign_id').eq('id', userId).maybeSingle();
  if (!target || target.campaign_id !== s.campaignId) return { ok: false, error: 'User not found.' };
  if (target.role === 'owner') return { ok: false, error: "The campaign owner's role can't be changed here." };

  await throwOnError(adminDb.from('users').update({ role: newRole }).eq('id', userId), 'users.change_teammate_role');
  revalidatePath('/settings');
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/settings/team-actions.test.ts`
Expected: PASS, all cases in all three `describe` blocks.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/app/settings/team-actions.ts src/app/settings/team-actions.test.ts
git commit -m "feat(settings): add campaign-scoped invite/remove/role-change actions"
```

---

### Task 4: `TeamManager` client component

**Files:**
- Create: `src/components/TeamManager.tsx`

**Interfaces:**
- Consumes: `inviteTeammateAction`, `removeTeammateAction`, `changeTeammateRoleAction` from `src/app/settings/team-actions.ts` (Task 3); `INVITABLE_ROLES` from `src/lib/team-roles.ts` (Task 2).
- Produces: `TeamManager` React component with props `{ members: TeamMember[], invites: PendingInvite[], seatUsage: { used: number; limit: number | null }, canManage: boolean }`, where `TeamMember = { id: string; name: string; email: string | null; role: string }` and `PendingInvite = { code: string; role: string; expiresAt: string; usedAt: string | null; shareUrl: string }` — both types exported from this file for `src/app/settings/page.tsx` (Task 5) to construct props against.

No automated test for this file — matches the existing convention: `VoiceCloneManager.tsx`/`AvatarManager.tsx` have no component-level tests either; only the server actions they call are unit tested (already covered by Task 3). This component is verified manually in Task 6.

- [ ] **Step 1: Create the component**

Create `src/components/TeamManager.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  inviteTeammateAction, removeTeammateAction, changeTeammateRoleAction,
} from '@/app/settings/team-actions';
import { INVITABLE_ROLES } from '@/lib/team-roles';

export interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

export interface PendingInvite {
  code: string;
  role: string;
  expiresAt: string;
  usedAt: string | null;
  shareUrl: string;
}

export function TeamManager({
  members, invites, seatUsage, canManage,
}: {
  members: TeamMember[];
  invites: PendingInvite[];
  seatUsage: { used: number; limit: number | null };
  canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    const formData = new FormData(e.currentTarget);
    const result = await inviteTeammateAction(formData);
    setInviting(false);
    if (!result.ok) {
      setError(result.error ?? 'Failed to create invite.');
      return;
    }
    router.refresh();
  }

  async function handleRoleChange(userId: string, newRole: string) {
    setError(null);
    const result = await changeTeammateRoleAction(userId, newRole);
    if (!result.ok) {
      setError(result.error ?? 'Failed to change role.');
      return;
    }
    router.refresh();
  }

  async function handleRemove(userId: string) {
    setError(null);
    const result = await removeTeammateAction(userId);
    if (!result.ok) {
      setError(result.error ?? 'Failed to remove teammate.');
      return;
    }
    router.refresh();
  }

  const seatLimitReached = seatUsage.limit !== null && seatUsage.used >= seatUsage.limit;

  return (
    <div className="card">
      <h2>Team</h2>

      {error && (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          <div className="b">{error}</div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Name</th><th>Email</th><th>Role</th>{canManage && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {members.map(u => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td className="muted">{u.email ?? '—'}</td>
              <td className="muted">{u.role}</td>
              {canManage && (
                <td>
                  {u.role === 'owner' ? (
                    <span className="muted" style={{ fontSize: 12 }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        className="input"
                        style={{ width: 110 }}
                        defaultValue={u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value)}
                      >
                        {INVITABLE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="admin-delete-btn" type="button" onClick={() => handleRemove(u.id)}>
                        Remove
                      </button>
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {canManage && (
        <>
          <div className="spacer-y" />
          <h2>Pending invites</h2>
          <table>
            <thead><tr><th>Role</th><th>Expires</th><th>Status</th><th>Link</th></tr></thead>
            <tbody>
              {invites.map(inv => {
                const expired = new Date(inv.expiresAt) < new Date();
                return (
                  <tr key={inv.code}>
                    <td className="muted">{inv.role}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{new Date(inv.expiresAt).toLocaleDateString()}</td>
                    <td>
                      {inv.usedAt
                        ? <span className="tag cred-high">Used</span>
                        : expired
                          ? <span className="tag">Expired</span>
                          : <span className="tag trending">Active</span>}
                    </td>
                    <td>
                      {!inv.usedAt && !expired && (
                        <code style={{ fontSize: 11, userSelect: 'all' }} title={inv.shareUrl}>{inv.shareUrl}</code>
                      )}
                    </td>
                  </tr>
                );
              })}
              {invites.length === 0 && (
                <tr><td colSpan={4} className="muted" style={{ padding: 20 }}>No pending invites.</td></tr>
              )}
            </tbody>
          </table>

          <div className="spacer-y" />
          {seatLimitReached ? (
            <div className="banner warn">
              <div className="t">Seat limit reached</div>
              <div className="b">
                Your plan doesn&rsquo;t have room for more teammates. <a href="/pricing">Upgrade your plan</a> to invite more.
              </div>
            </div>
          ) : (
            <form onSubmit={handleInvite} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div>
                <label className="field-label">Role</label>
                <select name="role" className="input" style={{ width: 140 }} defaultValue="staff">
                  {INVITABLE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button className="btn primary" type="submit" disabled={inviting}>
                {inviting ? 'Generating…' : 'Generate invite link'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes once Task 5 wires this component in (it's unused until then, so a strict "unused export" lint may warn but `tsc --noEmit` itself should still succeed — if your linter fails on unused exports, that's expected to clear after Task 5).

- [ ] **Step 3: Commit**

```bash
git add src/components/TeamManager.tsx
git commit -m "feat(settings): add TeamManager client component"
```

---

### Task 5: Wire `TeamManager` into `/settings`

**Files:**
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `getInviteCodes(campaignId: string): Promise<InviteCode[]>` and `getCampaignSeatUsage(campaignId: string): Promise<{ used: number; limit: number | null }>` from `src/lib/data.ts` (existing); `can(role, 'manage_team')` from Task 1; `TeamManager` component + `TeamMember`/`PendingInvite` types from Task 4.

- [ ] **Step 1: Update imports**

In `src/app/settings/page.tsx`, change:

```ts
import { getCampaign, getDisclosureRules, getUsers } from '@/lib/data';
```

to:

```ts
import { getCampaign, getDisclosureRules, getUsers, getInviteCodes, getCampaignSeatUsage } from '@/lib/data';
```

Add a new import below the existing `import { can } from '@/lib/permissions';` line:

```ts
import { TeamManager } from '@/components/TeamManager';
```

- [ ] **Step 2: Fetch invite codes and seat usage, compute the new permission**

Replace:

```ts
  const s = await requireSession();
  const [campaign, rules, users, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getDisclosureRules(),
    getUsers(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  const canEdit = can(s.role, 'edit_settings');
```

with:

```ts
  const s = await requireSession();
  const [campaign, rules, users, profile, inviteCodes, seatUsage] = await Promise.all([
    getCampaign(s.campaignId),
    getDisclosureRules(),
    getUsers(s.campaignId),
    getCandidateProfile(s.campaignId),
    getInviteCodes(s.campaignId),
    getCampaignSeatUsage(s.campaignId),
  ]);
  const canEdit = can(s.role, 'edit_settings');
  const canManageTeam = can(s.role, 'manage_team');
  const invitesWithShareUrl = inviteCodes.map(inv => ({
    code: inv.code,
    role: inv.role,
    expiresAt: inv.expiresAt,
    usedAt: inv.usedAt,
    shareUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/join?code=${inv.code}`,
  }));
```

- [ ] **Step 3: Replace the static Team card**

Replace the existing Team card block:

```tsx
      <div className="spacer-y" />
      <div className="card">
        <h2>Team</h2>
        <table>
          <thead><tr><th>Name</th><th>Role</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="muted">{u.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          To add a team member, contact your platform administrator.
        </p>
      </div>
```

with:

```tsx
      <div className="spacer-y" />
      <TeamManager
        members={users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
        invites={invitesWithShareUrl}
        seatUsage={seatUsage}
        canManage={canManageTeam}
      />
```

- [ ] **Step 4: Run the full test suite and typecheck**

Run: `npm test`
Expected: PASS — no existing test covers `/settings` page rendering directly (Server Components without an existing test file aren't broken by this), and all of Tasks 1–3's tests still pass.

Run: `npm run typecheck`
Expected: PASS — no type errors from the new imports/props.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat(settings): replace read-only Team card with self-service TeamManager"
```

---

### Task 6: Manual end-to-end verification

Per project convention, UI-facing changes must be exercised in a real browser before being called done — type checks and unit tests verify the logic, not the actual feature.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the owner/manager path**

Log in as a campaign `owner` (or `manager`) test account and open `/settings`. Confirm:
- The Team card now shows the roster with a Role `<select>` and "Remove" button per non-owner row, and no dropdown/button on the owner's own row.
- A "Pending invites" table and an invite form (Role select + "Generate invite link") are visible.
- Submitting the invite form with role `staff` adds a new row to "Pending invites" with status "Active" and a copyable `/join?code=...` link, with no page reload/navigation (confirms `router.refresh()` is working).
- Open the copied link in a new incognito window and confirm `/join` shows the expected campaign name and role, matching the existing join flow.
- Changing a non-owner teammate's role via the dropdown updates their row's role after the page refresh.
- Clicking "Remove" on a non-owner teammate removes them from the roster.

- [ ] **Step 3: Verify the staff/approver path**

Log in as a `staff` or `approver` test account and open `/settings`. Confirm:
- The Team card shows the roster (read-only: name/email/role columns, no "Actions" column).
- No "Pending invites" table and no invite form are rendered.

- [ ] **Step 4: Verify the admin path is untouched**

Log in as `super_admin`, open `/admin/campaigns/[id]`, and confirm the existing Users/Invite-links tables and Add-user/Generate-invite forms still work exactly as before — this feature must not have altered any admin behavior.

- [ ] **Step 5: Report status**

If any step fails, treat it as a bug in Tasks 1–5 (not a new task) — fix it in the relevant task's file and re-run that task's tests before re-verifying here.
