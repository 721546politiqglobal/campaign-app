import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { can } from '../../src/lib/permissions';
import type { Role } from '../../src/domain/types';
import bcrypt from 'bcryptjs';
import { USERS, CONTENT, CAMPAIGN_A, PASSWORD, type SeedRole } from '../helpers/users';
import { captureAction, replayAction, retarget, actionResult, actionRedirect } from '../helpers/server-action';

// ── Permission table ─────────────────────────────────────────────────────────
// A copy of PERMISSIONS in src/lib/permissions.ts. The first test checks it
// against the real `can()`, so a change there fails loudly here instead of
// silently testing the old matrix.
type Action = 'approve' | 'schedule' | 'publish' | 'edit_settings' | 'manage_avatars' | 'manage_team';
const PERMISSIONS: Record<Action, string[]> = {
  approve:        ['owner', 'manager', 'approver'],
  schedule:       ['owner', 'manager'],
  publish:        ['owner', 'manager'],
  edit_settings:  ['owner', 'manager'],
  manage_avatars: ['owner', 'manager'],
  manage_team:    ['owner', 'manager'],
};
const ACTIONS = Object.keys(PERMISSIONS) as Action[];
const ROLES = ['owner', 'manager', 'approver', 'staff'] as const;
type CampaignRole = (typeof ROLES)[number];
const allowed = (role: CampaignRole, a: Action) => PERMISSIONS[a].includes(role);

// Compile-time drift guard: adding/removing an action or role in src makes these
// exhaustive records fail `npm run typecheck`.
const _ACTIONS_EXHAUSTIVE: Record<Parameters<typeof can>[1], true> =
  { approve: true, schedule: true, publish: true, edit_settings: true, manage_avatars: true, manage_team: true };
const _ROLES_EXHAUSTIVE: Record<Role, true> = { owner: true, manager: true, approver: true, staff: true, super_admin: true };
void _ACTIONS_EXHAUSTIVE; void _ROLES_EXHAUSTIVE;

/** String-literal members of `type <name> = 'a' | 'b' …` in a source file. */
function unionMembers(src: string, name: string): string[] {
  const m = new RegExp(`type ${name}\\s*=\\s*([^;]+);`).exec(src);
  if (!m) throw new Error(`type ${name} not found`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

test('permission table mirrors src/lib/permissions.ts', () => {
  // Runtime drift guard (PERMISSIONS is not exported): same action keys and role list as the source.
  const permSrc = readFileSync(resolve(__dirname, '../../src/lib/permissions.ts'), 'utf8');
  const table = /const PERMISSIONS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(permSrc);
  expect(table, 'PERMISSIONS table found in src/lib/permissions.ts').toBeTruthy();
  const srcKeys = [...table![1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((x) => x[1]).sort();
  expect(srcKeys).toEqual([...ACTIONS].sort());
  expect(unionMembers(permSrc, 'Action')).toEqual([...ACTIONS].sort());
  const roleSrc = readFileSync(resolve(__dirname, '../../src/domain/types.ts'), 'utf8');
  expect(unionMembers(roleSrc, 'Role')).toEqual([...ROLES, 'super_admin'].sort());

  for (const role of [...ROLES, 'super_admin'] as const) {
    for (const a of ACTIONS) {
      expect(can(role, a), `can(${role}, ${a})`).toBe(PERMISSIONS[a].includes(role));
    }
  }
});

// ── UI layer: controls shown iff the role may use them ───────────────────────
const L = {
  approve: 'Looks good — Continue →',
  reject: 'Reject',
  approveDenied: 'Approval requires manager or approver access.',
  publishButton: /^Publish to \d+ platforms?$/,
  publishDenied: 'Publishing requires manager access.',
  scheduleLater: 'Schedule for later',
  scheduleButton: 'Pick a time above',
  scheduleDenied: 'Scheduling requires manager access.',
  saveProfile: 'Save profile',
  settingsReadOnly: 'View only',
  fromPhotos: 'From photos',
  fromVideo: 'From video',
  inviteHeading: 'Invite a teammate',
  teamReadOnly: 'Only campaign owners and managers can invite teammates or change roles.',
};

async function expectShown(page: Page, shown: boolean, controls: ReturnType<Page['getByRole']>[], deniedText?: string) {
  if (!shown && deniedText) await expect(page.getByText(deniedText).first()).toBeVisible();
  for (const c of controls) {
    if (shown) await expect(c).toBeVisible();
    else await expect(c).toHaveCount(0);
  }
}

for (const role of ROLES) {
  test.describe(`UI as ${role}`, () => {
    test(`approve/reject controls ${allowed(role, 'approve') ? 'shown' : 'hidden'}`, async ({ asRole }) => {
      const page = await asRole(role);
      await page.goto(`/content/${CONTENT.inReview}`);
      await expect(page.getByRole('heading', { name: 'Ready to continue?' })).toBeVisible();
      await expectShown(page, allowed(role, 'approve'), [
        page.getByRole('button', { name: L.approve }),
        page.getByRole('button', { name: L.reject, exact: true }),
      ], L.approveDenied);
    });

    test(`publish/schedule controls ${allowed(role, 'publish') ? 'shown' : 'hidden'}`, async ({ asRole }) => {
      const page = await asRole(role);
      await page.goto(`/content/${CONTENT.approved}`);
      await expectShown(page, allowed(role, 'publish'), [page.getByRole('button', { name: L.publishButton })], L.publishDenied);
      await page.getByRole('button', { name: L.scheduleLater }).click();
      await expectShown(page, allowed(role, 'schedule'), [page.getByRole('button', { name: L.scheduleButton })], L.scheduleDenied);
    });

    test(`settings ${allowed(role, 'edit_settings') ? 'editable' : 'read-only'}`, async ({ asRole }) => {
      const page = await asRole(role);
      await page.goto('/settings');
      const ok = allowed(role, 'edit_settings');
      await expectShown(page, ok, [page.getByRole('button', { name: L.saveProfile })], L.settingsReadOnly);
      if (ok) await expect(page.getByText(L.settingsReadOnly, { exact: true })).toHaveCount(0);
    });

    test(`avatar create controls ${allowed(role, 'manage_avatars') ? 'shown' : 'hidden'}`, async ({ asRole }) => {
      const page = await asRole(role);
      await page.goto('/avatars');
      await expect(page.getByText('Olivia Avatar')).toBeVisible(); // seeded row rendered
      await expectShown(page, allowed(role, 'manage_avatars'), [
        page.getByRole('button', { name: L.fromPhotos }),
        page.getByRole('button', { name: L.fromVideo }),
        page.getByRole('button', { name: 'Delete Olivia Avatar' }),
      ]);
    });

    test(`team invite/role controls ${allowed(role, 'manage_team') ? 'shown' : 'hidden'}`, async ({ asRole }) => {
      const page = await asRole(role);
      await page.goto('/team');
      await expect(page.getByRole('cell', { name: USERS.owner.email, exact: true })).toBeVisible(); // members table rendered
      await expectShown(page, allowed(role, 'manage_team'), [
        page.getByRole('heading', { name: L.inviteHeading }),
        page.getByRole('combobox', { name: `Role for ${USERS.staff.name}` }),
        page.getByRole('button', { name: `Remove ${USERS.staff.name}` }),
      ], L.teamReadOnly);
    });
  });
}

// ── Server layer: forbidden roles replaying a captured server action ────────
// Each case: the owner performs the action in the UI on a throwaway record
// (captured), an ALLOWED role replays it against a second throwaway record
// (positive control — proves the replay itself is well-formed), then the
// FORBIDDEN role replays it against a third. The forbidden replay must come
// back as a handled permission error and leave the record untouched.
const PERMISSION_DENIED = 'Permission denied.';

type Snapshot = Record<string, unknown>;

/** Per-test part of Playwright's testId (`<fileHash>-<testHash>`). */
const testKey = () => test.info().testId.split('-').pop()!;

/** Await a supabase write and fail loudly if it errored (e.g. a cleanup that silently left rows). */
async function must(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
}
type ServerCase = {
  label: string;
  perm: Action;
  /** Allowed (non-owner) role used for the positive-control replay. */
  control: SeedRole;
  /** Creates a fresh target; returns its id. */
  setup: (db: SupabaseClient, id: string) => Promise<void>;
  /** Performs the action in the UI as the owner on target `id`. */
  trigger: (page: Page, id: string) => Promise<void>;
  state: (db: SupabaseClient, id: string) => Promise<Snapshot>;
  cleanup: (db: SupabaseClient, ids: string[]) => Promise<void>;
};

async function insertContent(db: SupabaseClient, id: string, status: 'in_review' | 'approved' | 'scheduled') {
  // Human-written so an approved item needs only the approval to be publishable
  // (AI content would also need a disclosure record).
  const { error } = await db.from('content_items').insert({
    id, campaign_id: CAMPAIGN_A, type: 'social_post', title: `E2E perm ${id}`,
    body: 'Permission matrix throwaway.', status, is_ai_generated: false,
    target_jurisdictions: ['US-FEDERAL'], created_by: USERS.staff.id, platforms: ['x'],
    scheduled_at: status === 'scheduled' ? new Date(Date.now() + 7 * 86400_000).toISOString() : null,
  });
  expect(error).toBeNull();
  if (status !== 'in_review') {
    const { error: e2 } = await db.from('approval_records').insert({
      content_item_id: id, campaign_id: CAMPAIGN_A, approver_user_id: USERS.approver.id, decision: 'approve',
    });
    expect(e2).toBeNull();
  }
}

async function contentState(db: SupabaseClient, id: string): Promise<Snapshot> {
  const { data: item } = await db.from('content_items').select('status, scheduled_at').eq('id', id).single();
  const { data: appr } = await db.from('approval_records').select('decision').eq('content_item_id', id);
  return { ...item, approvals: (appr ?? []).map((a) => a.decision).sort() };
}

async function cleanupContent(db: SupabaseClient, ids: string[]) {
  await must(db.from('audit_entries').delete().in('entity_id', ids));
  await must(db.from('content_items').delete().in('id', ids)); // approvals/disclosures cascade
}

function tomorrowLocal(): string {
  const d = new Date(Date.now() + 26 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00`;
}

const SERVER_CASES: ServerCase[] = [
  {
    label: 'approve (approveTextAction)', perm: 'approve', control: 'approver',
    setup: (db, id) => insertContent(db, id, 'in_review'),
    trigger: async (page, id) => {
      await page.goto(`/content/${id}`);
      await page.getByRole('button', { name: L.approve }).click();
    },
    state: contentState, cleanup: cleanupContent,
  },
  {
    label: 'reject (decideAction)', perm: 'approve', control: 'approver',
    setup: (db, id) => insertContent(db, id, 'in_review'),
    trigger: async (page, id) => {
      await page.goto(`/content/${id}`);
      await page.getByRole('button', { name: L.reject, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Reject draft' }).click();
    },
    state: contentState, cleanup: cleanupContent,
  },
  {
    label: 'schedule (scheduleWithTimeAction)', perm: 'schedule', control: 'manager',
    setup: (db, id) => insertContent(db, id, 'approved'),
    trigger: async (page, id) => {
      await page.goto(`/content/${id}`);
      await page.getByRole('button', { name: L.scheduleLater }).click();
      await page.getByLabel(/^Date & time/).fill(tomorrowLocal());
      await page.getByRole('button', { name: /^Schedule for (?!later)/ }).click();
    },
    state: contentState, cleanup: cleanupContent,
  },
  {
    label: 'unschedule (unscheduleAction)', perm: 'schedule', control: 'manager',
    setup: (db, id) => insertContent(db, id, 'scheduled'),
    trigger: async (page, id) => {
      await page.goto(`/content/${id}`);
      await page.getByRole('button', { name: 'Unschedule', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Unschedule', exact: true }).click();
    },
    state: contentState, cleanup: cleanupContent,
  },
  {
    // Publishing goes to the fake Ayrshare (e2e/fake-ayrshare/server.ts), so
    // an allowed publish succeeds and the item becomes 'published'.
    label: 'publish (publishAction)', perm: 'publish', control: 'manager',
    setup: (db, id) => insertContent(db, id, 'approved'),
    trigger: async (page, id) => {
      await page.goto(`/content/${id}`);
      await page.getByRole('button', { name: L.publishButton }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
    },
    state: contentState, cleanup: cleanupContent,
  },
  {
    label: 'delete avatar (deleteAvatarAction)', perm: 'manage_avatars', control: 'manager',
    setup: async (db, id) => {
      const { error } = await db.from('avatars').insert({
        id, campaign_id: CAMPAIGN_A, name: `Perm ${id}`, status: 'ready', heygen_group_id: `hg-${id}`,
        source_photo_urls: [], source_type: 'photo', consent_confirmed_by: USERS.owner.id, created_by: USERS.owner.id,
      });
      expect(error).toBeNull();
    },
    trigger: async (page, id) => {
      await page.goto('/avatars');
      await page.getByRole('button', { name: `Delete Perm ${id}` }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete avatar' }).click();
    },
    state: async (db, id) => {
      const { data } = await db.from('avatars').select('id').eq('id', id);
      return { exists: (data ?? []).length === 1 };
    },
    cleanup: async (db, ids) => { await must(db.from('avatars').delete().in('id', ids)); },
  },
  {
    label: 'change teammate role (changeTeammateRoleAction)', perm: 'manage_team', control: 'manager',
    setup: async (db, id) => {
      const { error } = await db.from('users').insert({
        id, campaign_id: CAMPAIGN_A, name: `Perm ${id}`, role: 'staff', email: `${id}@e2e.test`, locale: 'en',
      });
      expect(error).toBeNull();
    },
    trigger: async (page, id) => {
      await page.goto('/team');
      await page.getByRole('combobox', { name: `Role for Perm ${id}` }).selectOption('approver');
      await page.getByRole('dialog').getByRole('button', { name: 'Change role' }).click();
    },
    state: async (db, id) => {
      const { data } = await db.from('users').select('role').eq('id', id).single();
      return { role: data?.role };
    },
    cleanup: async (db, ids) => {
      await must(db.from('audit_entries').delete().in('actor_user_id', ids));
      await must(db.from('users').delete().in('id', ids));
    },
  },
];

for (const c of SERVER_CASES) {
  for (const forbidden of ROLES.filter((r) => !allowed(r, c.perm))) {
    test(`server rejects ${c.label} replayed as ${forbidden}`, async ({ asRole, db }) => {
      // Unique per test (unlike a prefix of testId, which is the per-FILE hash),
      // and no id is a prefix of another (retarget is a plain string replace).
      const base = `e2e-perm-${testKey()}`;
      const ids = { cap: `${base}-cap`, ok: `${base}-ok`, deny: `${base}-deny` };
      const all = Object.values(ids);
      try {
        for (const id of all) await c.setup(db, id);
        const [capBefore, okBefore, denyBefore] = await Promise.all(all.map((id) => c.state(db, id)));

        // 1. Owner performs it in the UI; capture the POST.
        const owner = await asRole('owner');
        const action = await captureAction(owner, () => c.trigger(owner, ids.cap));
        await expect.poll(() => c.state(db, ids.cap), { message: 'UI action took effect' }).not.toEqual(capBefore);

        // 2. Positive control: an allowed role's replay is accepted for a fresh target.
        const control = await asRole(c.control);
        const okRes = await replayAction(control, retarget(action, ids.cap, ids.ok));
        expect(okRes.status(), 'allowed replay status').toBe(200);
        expect(await actionResult(okRes), 'allowed replay result').toMatchObject({ ok: true });
        await expect.poll(() => c.state(db, ids.ok), { message: 'allowed replay took effect' }).not.toEqual(okBefore);

        // 3. Forbidden role: handled permission error, record untouched.
        const denied = await asRole(forbidden);
        const res = await replayAction(denied, retarget(action, ids.cap, ids.deny));
        expect(res.status(), 'forbidden replay status').toBe(200);
        expect(await actionResult(res), 'forbidden replay result').toMatchObject({ ok: false, error: PERMISSION_DENIED });
        expect(await c.state(db, ids.deny), 'forbidden replay left the record unchanged').toEqual(denyBefore);
      } finally {
        await c.cleanup(db, all);
      }
    });
  }
}

// Campaign settings have no per-record target: the forbidden replay swaps the
// tagline in the captured form body and the stored tagline must not change.
for (const forbidden of ROLES.filter((r) => !allowed(r, 'edit_settings'))) {
  test(`server rejects saving the campaign profile (saveProfileAction) replayed as ${forbidden}`, async ({ asRole, db }) => {
    const readTagline = async () =>
      (await db.from('candidate_profiles').select('tagline').eq('campaign_id', CAMPAIGN_A).single()).data?.tagline;
    const tagline = await readTagline();
    expect(tagline).toBeTruthy();

    const owner = await asRole('owner');
    await owner.goto('/settings');
    // Saves the unchanged profile (no-op for the shared seed data).
    const action = await captureAction(owner, () => owner.getByRole('button', { name: L.saveProfile }).click());

    // Positive control: the same unchanged save replayed by a manager succeeds.
    const okRes = await replayAction(await asRole('manager'), action);
    expect(okRes.status()).toBe(200);
    expect(await actionResult(okRes)).toMatchObject({ ok: true });

    const res = await replayAction(await asRole(forbidden), retarget(action, tagline!, `Hijacked ${test.info().testId}`));
    expect(res.status()).toBe(200);
    expect(await actionResult(res)).toMatchObject({ ok: false, error: 'Only campaign owners and managers can change settings.' });
    expect(await readTagline()).toBe(tagline);
  });
}

// upsertProfileAction (/setup) is the one gated action with a conditional
// guard: anyone may create the FIRST profile, but once one exists only
// owner/manager may overwrite it, and a refused call redirects to /dashboard
// instead of returning an error (src/app/setup/actions.ts:27-35). Before that
// guard, staff could rewrite the profile that drives every AI draft.
// /setup only renders for a campaign with no profile, so the capture runs in a
// private throwaway campaign whose owner logs in through the UI.
const PROFILE_FIELDS = 'full_name, preferred_name, office, district, party, bio, tagline, target_audience, key_positions, voice_tone';

for (const forbidden of ROLES.filter((r) => !allowed(r, 'edit_settings'))) {
  test(`server rejects overwriting the profile via setup (upsertProfileAction) replayed as ${forbidden}`, async ({ page, asRole, db }) => {
    const key = testKey();
    const camp = `e2e-perm-${key}-camp`;
    const ownerT = { id: `e2e-perm-${key}-owner`, email: `perm-${key}@e2e.test` };
    const tagline = `Setup tagline ${key}`;
    const readProfile = async (campaignId: string) =>
      (await db.from('candidate_profiles').select(PROFILE_FIELDS).eq('campaign_id', campaignId).maybeSingle()).data;
    const dropThrowaway = async () => {
      await must(db.from('audit_entries').delete().eq('actor_user_id', ownerT.id));
      await must(db.from('login_attempts').delete().eq('key', `email:${ownerT.email}`));
      await must(db.from('users').delete().eq('id', ownerT.id));
      await must(db.from('campaigns').delete().eq('id', camp)); // profile cascades
    };
    try {
      await dropThrowaway(); // leftovers from an aborted earlier run (stable testId-derived ids)
      await must(db.from('campaigns').insert({ id: camp, name: `E2E perm ${key}`, jurisdictions: ['US-TX'] }));
      await must(db.from('users').insert({
        id: ownerT.id, campaign_id: camp, name: 'Perm Setup Owner', role: 'owner', email: ownerT.email,
        password_hash: bcrypt.hashSync(PASSWORD, 4), locale: 'en',
      }));

      // 1. Throwaway owner completes /setup in the UI; capture the POST.
      await page.goto('/login');
      await page.locator('input[name="email"]').fill(ownerT.email);
      await page.locator('input[name="password"]').fill(PASSWORD);
      await page.locator('form button[type="submit"]').click();
      await expect(page).not.toHaveURL(/\/login$/);
      await page.goto('/setup');
      await expect(page).toHaveURL(/\/setup$/);
      await page.locator('input[name="full_name"]').fill('Perm Setup Candidate');
      await page.locator('input[name="preferred_name"]').fill('Perm');
      await page.locator('input[name="office"]').fill('City Council');
      await page.locator('input[name="district"]').fill('Ward 9');
      await page.locator('select[name="party"]').selectOption('Independent');
      await page.locator('input[name="tagline"]').fill(tagline);
      const action = await captureAction(page, () => page.getByRole('button', { name: 'Continue to plan' }).click());
      await expect.poll(async () => (await readProfile(camp))?.tagline, { message: 'setup created the profile' }).toBe(tagline);

      // 2. Positive control: the campaign's owner (allowed) replays it over the
      //    now-EXISTING profile — the guarded branch — and the overwrite lands.
      const changed = `Owner overwrite ${key}`;
      const okRes = await replayAction(page, retarget(action, tagline, changed));
      // Next 14.2 answers an action redirect with 303 + `x-action-redirect`
      // (no Location, so it isn't followed); either way not a 5xx.
      expect(okRes.status()).toBe(303);
      expect(actionRedirect(okRes)).toBe('/dashboard');
      await expect.poll(async () => (await readProfile(camp))?.tagline, { message: 'allowed overwrite took effect' }).toBe(changed);

      // 3. Forbidden role in campaign A (which has a profile): redirected, profile untouched.
      const before = await readProfile(CAMPAIGN_A);
      expect(before).toBeTruthy();
      const res = await replayAction(await asRole(forbidden), retarget(action, tagline, `Hijacked ${key}`));
      expect(res.status()).toBe(303);
      expect(actionRedirect(res), 'refused overwrite redirects to /dashboard').toBe('/dashboard');
      expect(await readProfile(CAMPAIGN_A), 'campaign A profile unchanged').toEqual(before);
    } finally {
      await dropThrowaway();
    }
  });
}

// ── Admin area ───────────────────────────────────────────────────────────────
const ADMIN_ROUTES = ['/admin', '/admin/users', '/admin/campaigns', `/admin/campaigns/${CAMPAIGN_A}`,
  '/admin/content', '/admin/billing', '/admin/audit'];

for (const role of ROLES) {
  test(`admin pages are closed to ${role}`, async ({ asRole }) => {
    const page = await asRole(role);
    for (const route of ADMIN_ROUTES) {
      await page.goto(route);
      await expect(page, `${route} as ${role}`).toHaveURL(/\/dashboard$/);
    }
    await expect(page.getByRole('navigation').first()).toBeVisible();
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  });
}

test('admin can open every admin page', async ({ asRole }) => {
  const page = await asRole('admin');
  for (const route of ADMIN_ROUTES) {
    // Let the page's link prefetches finish: navigating away mid-prefetch aborts
    // them and Next logs "Failed to fetch RSC payload" (a harness artefact).
    const res = await page.goto(route, { waitUntil: 'networkidle' });
    expect(res?.status(), `${route} status`).toBeLessThan(400);
    await expect(page, route).toHaveURL(new RegExp(`${route}$`));
    await expect(page.locator('a[href="/admin/campaigns"]').first()).toBeVisible();
  }
});
