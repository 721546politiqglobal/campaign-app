import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import enMessages from '../../src/messages/en.json';
import { test, expect, allowConsole } from '../fixtures';
import { USERS, CONTENT, CAMPAIGN_A, CAMPAIGN_B } from '../helpers/users';
import { createSecondTenant } from '../helpers/second-tenant';
import { captureAction, replayAction, retarget, actionResult } from '../helpers/server-action';

// Campaign B's seed rows carry these strings (e2e/seed.e2e.sql). None may ever
// show up in a campaign A session; the mirror test checks A's strings in B's.
const B_STRINGS = ['B-ONLY-content', 'B-ONLY-body', 'B-ONLY-opponent', 'B-ONLY-monitoring', 'B-ONLY-avatar',
  'E2E Campaign B', 'Ben Owner', USERS.ownerB.email];
const A_STRINGS = ['E2E Draft post', 'E2E In-review post', 'E2E Approved post', 'Pat Opponent', 'Olivia Avatar',
  'E2E Campaign A', 'Olivia Owner', USERS.owner.email];

const testKey = () => test.info().testId.split('-').pop()!;
async function must(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
}

async function expectNoneVisible(page: Page, strings: string[]) {
  const text = await page.locator('body').innerText();
  // Also the raw HTML: catches data serialized into the RSC payload or hidden DOM.
  const html = await page.content();
  for (const s of strings) {
    expect(text, `"${s}" leaked onto ${page.url()}`).not.toContain(s);
    expect(html, `"${s}" leaked into the HTML/RSC payload of ${page.url()}`).not.toContain(s);
  }
}

// notFound() renders the 404 page (Next streams it with a 200 status here), so
// assert on the page itself; a redirect away from the path is also acceptable.
async function expectNotFoundOrRedirected(page: Page, path: string) {
  if (new URL(page.url()).pathname === path) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(enMessages.system.notFound.title);
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────
test.describe('owner of campaign A cannot read campaign B', () => {
  test('/content/<B item> is not found and shows no B text', async ({ asRole }) => {
    const page = await asRole('owner');
    await page.goto(`/content/${CONTENT.campaignB}`);
    await expectNotFoundOrRedirected(page, `/content/${CONTENT.campaignB}`);
    await expectNoneVisible(page, B_STRINGS);
  });

  for (const path of ['/content', '/monitoring', '/avatars', '/analytics', '/team', '/channels', '/billing']) {
    test(`${path} lists no campaign B data`, async ({ asRole }) => {
      const page = await asRole('owner');
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoneVisible(page, B_STRINGS);
    });
  }

  test('lists do show campaign A data (guards the checks above against empty pages)', async ({ asRole }) => {
    // Navigating away aborts in-flight Next link prefetches on the content list.
    allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/\S+\. Falling back to browser navigation/);
    const page = await asRole('owner');
    await page.goto('/content');
    await expect(page.getByText('E2E Draft post').first()).toBeVisible();
    await page.goto('/monitoring');
    await expect(page.getByText(/transit position/).first()).toBeVisible();
    await page.goto('/avatars');
    await expect(page.getByText('Olivia Avatar')).toBeVisible();
    await page.goto('/team');
    await expect(page.getByText('Olivia Owner').first()).toBeVisible();
  });
});

test.describe('owner of campaign B cannot read campaign A', () => {
  test('/content/<A item> is not found and shows no A text', async ({ asRole }) => {
    const page = await asRole('ownerB');
    await page.goto(`/content/${CONTENT.draft}`);
    await expectNotFoundOrRedirected(page, `/content/${CONTENT.draft}`);
    await expectNoneVisible(page, A_STRINGS);
  });

  // Campaign B has no plan in the seed, so ownerB is gated to /pricing: explicit gate check.
  test('seeded owner B is gated (no plan/profile) and sees no A data there', async ({ asRole }) => {
    const page = await asRole('ownerB');
    await page.goto('/content');
    await expect(page).toHaveURL(/\/(pricing|setup)/); // seed B has no plan and no profile, so the gate lands on /setup
    await expectNoneVisible(page, A_STRINGS);
  });
});

// The mirror check needs a WORKING (subscribed) second tenant, not the gated seed B.
test.describe('a working second tenant cannot read or write campaign A', () => {
  test('reads: A item 404s and no list leaks A data', async ({ page, db }) => {
    allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/\S+\. Falling back to browser navigation/); // aborted prefetches on navigation
    const t = await createSecondTenant(db, testKey());
    try {
      await t.login(page);
      await page.goto('/content');
      expect(new URL(page.url()).pathname, 'tenant must not be bounced').toBe('/content');
      await expect(page.getByRole('main').first()).toBeVisible();

      await page.goto(`/content/${CONTENT.draft}`);
      await expectNotFoundOrRedirected(page, `/content/${CONTENT.draft}`);
      await expectNoneVisible(page, A_STRINGS);

      for (const path of ['/content', '/monitoring', '/avatars', '/team', '/analytics', '/channels']) {
        await page.goto(path);
        expect(new URL(page.url()).pathname, `${path} must not bounce`).toBe(path);
        await expect(page.getByRole('main').first()).toBeVisible();
        await expectNoneVisible(page, A_STRINGS);
      }
    } finally {
      await t.cleanup();
    }
  });

  test('writes: saveBodyAction replayed from the tenant onto an A record is refused', async ({ page, db }) => {
    const k = testKey();
    const t = await createSecondTenant(db, k);
    const own = `e2e-iso-t2-${k}-own`, own2 = `e2e-iso-t2-${k}-own2`, aId = `e2e-iso-t2-${k}-a`;
    const insert = (id: string, campaign: string, by: string) => must(db.from('content_items').insert({
      id, campaign_id: campaign, type: 'social_post', title: `E2E iso ${id}`, body: 'Isolation throwaway body.',
      status: 'in_review', is_ai_generated: false, target_jurisdictions: ['US-FEDERAL'], created_by: by, platforms: ['x'],
    }));
    const cleanupRows = async () => {
      await must(db.from('audit_entries').delete().in('entity_id', [own, own2, aId]));
      await must(db.from('content_items').delete().in('id', [own, own2, aId]));
    };
    try {
      await cleanupRows();
      await insert(own, t.campaignId, t.owner.id);
      await insert(own2, t.campaignId, t.owner.id);
      await insert(aId, CAMPAIGN_A, USERS.staff.id);
      const read = async (id: string) => (await db.from('content_items').select('body, status, title, updated_at').eq('id', id).single()).data;
      const [ownBefore, own2Before, aBefore] = await Promise.all([own, own2, aId].map(read));

      await t.login(page);
      const action = await captureAction(page, async () => {
        await page.goto(`/content/${own}`);
        await page.locator('textarea').first().fill(`Edited by tenant 2 ${k}`);
        await page.getByRole('button', { name: 'Save edits' }).click();
      });
      await expect.poll(() => read(own)).not.toEqual(ownBefore);

      const okRes = await replayAction(page, retarget(action, own, own2));
      expect(await actionResult(okRes), 'own-record replay').toMatchObject({ ok: true });
      await expect.poll(() => read(own2)).not.toEqual(own2Before);

      const res = await replayAction(page, retarget(action, own, aId));
      expect(res.status()).toBe(200);
      expect(await actionResult(res), 'cross-tenant replay').toMatchObject({ ok: false });
      expect(await read(aId), 'BREACH: tenant 2 changed campaign A content').toEqual(aBefore);
    } finally {
      await cleanupRows();
      await t.cleanup();
    }
  });
});

// ── Writes: replay owner A's server action against campaign B's ids ──────────
type Snapshot = Record<string, unknown>;
type Case = {
  label: string;
  /** Throwaway A record the UI acts on; also used as the positive-control target. */
  setupA: (db: SupabaseClient, id: string) => Promise<void>;
  trigger: (page: Page, id: string) => Promise<void>;
  /** Campaign B record the replay aims at (seeded, or a throwaway created here). */
  targetB: { id?: string; setup?: (db: SupabaseClient, id: string) => Promise<void> };
  state: (db: SupabaseClient, id: string) => Promise<Snapshot>;
  cleanup: (db: SupabaseClient, ids: string[]) => Promise<void>;
  /** Content actions return a not-found error; the monitoring dismiss is a silent no-op. */
  rejects: boolean;
  /** Session that performs and replays the action (default owner). */
  role?: 'owner' | 'staff';
};

async function insertContent(db: SupabaseClient, id: string, campaign: string, status: 'draft' | 'in_review') {
  await must(db.from('content_items').insert({
    id, campaign_id: campaign, type: 'social_post', title: `E2E iso ${id}`, body: 'Isolation throwaway body.',
    status, is_ai_generated: false, target_jurisdictions: ['US-FEDERAL'],
    created_by: campaign === CAMPAIGN_A ? USERS.staff.id : USERS.ownerB.id, platforms: ['x'],
  }));
}
const contentState = async (db: SupabaseClient, id: string): Promise<Snapshot> => {
  const { data } = await db.from('content_items').select('status, body, title, updated_at').eq('id', id).single();
  const { data: appr } = await db.from('approval_records').select('decision').eq('content_item_id', id);
  return { ...data, approvals: (appr ?? []).length };
};
const cleanupContent = async (db: SupabaseClient, ids: string[]) => {
  await must(db.from('audit_entries').delete().in('entity_id', ids));
  await must(db.from('content_items').delete().in('id', ids));
};

const CASES: Case[] = [
  {
    label: 'saveBodyAction', rejects: true,
    setupA: (db, id) => insertContent(db, id, CAMPAIGN_A, 'in_review'),
    trigger: async (page, id) => {
      await page.goto(`/content/${id}`);
      await page.locator('textarea').first().fill(`Edited by isolation test ${id.slice(-12)}`);
      await page.getByRole('button', { name: 'Save edits' }).click();
    },
    targetB: { id: CONTENT.campaignB },
    state: contentState, cleanup: cleanupContent,
  },
  {
    // Owners see "Looks good - Continue" (approveTextAction) on drafts; the plain submit button is staff-only.
    label: 'submitAction', rejects: true, role: 'staff',
    setupA: (db, id) => insertContent(db, id, CAMPAIGN_A, 'draft'),
    trigger: async (page, id) => {
      await page.goto(`/content/${id}`);
      await page.getByRole('button', { name: 'Submit for review' }).click();
    },
    // Seeded B item is already in_review (submit would fail on the FSM even
    // without a tenant check), so aim at a throwaway B draft instead.
    targetB: { setup: (db, id) => insertContent(db, id, CAMPAIGN_B, 'draft') },
    state: contentState, cleanup: cleanupContent,
  },
  {
    label: 'approveTextAction', rejects: true,
    setupA: (db, id) => insertContent(db, id, CAMPAIGN_A, 'in_review'),
    trigger: async (page, id) => {
      await page.goto(`/content/${id}`);
      await page.getByRole('button', { name: 'Looks good — Continue →' }).click();
    },
    targetB: { id: CONTENT.campaignB },
    state: contentState, cleanup: cleanupContent,
  },
  {
    label: 'deleteAvatarAction', rejects: true,
    setupA: (db, id) => must(db.from('avatars').insert({
      id, campaign_id: CAMPAIGN_A, name: `Iso ${id}`, status: 'ready', heygen_group_id: `hg-${id}`,
      source_photo_urls: [], source_type: 'photo', consent_confirmed_by: USERS.owner.id, created_by: USERS.owner.id,
    })),
    trigger: async (page, id) => {
      await page.goto('/avatars');
      await page.getByRole('button', { name: `Delete Iso ${id}` }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete avatar' }).click();
    },
    targetB: { id: 'e2e-avatar-b' },
    state: async (db, id) => {
      const { data } = await db.from('avatars').select('id, name, status').eq('id', id);
      return { rows: data ?? [] };
    },
    cleanup: async (db, ids) => { await must(db.from('avatars').delete().in('id', ids)); },
  },
  {
    label: 'dismissMonitoringAction', rejects: false,
    setupA: (db, id) => must(db.from('monitoring_results').insert({
      id, campaign_id: CAMPAIGN_A, source: 'NewsData', opponent: 'Pat Opponent',
      excerpt: `Isolation throwaway story ${id}.`, url: `https://news.e2e.test/iso/${id}`,
      credibility: 'high', category: 'news',
    })),
    trigger: async (page, id) => {
      await page.goto('/monitoring');
      await page.locator('li', { hasText: `Isolation throwaway story ${id}` }).getByRole('button', { name: 'Dismiss' }).click();
    },
    targetB: { id: 'e2e-mon-b-1' },
    state: async (db, id) => {
      const { data } = await db.from('monitoring_results').select('id, excerpt, dismissed_at').eq('id', id);
      return { rows: data ?? [] };
    },
    cleanup: async (db, ids) => { await must(db.from('monitoring_results').delete().in('id', ids)); },
  },
];

for (const c of CASES) {
  test(`server refuses ${c.label} replayed by ${c.role ?? 'owner'} A against campaign B's record`, async ({ asRole, db }) => {
    const base = `e2e-iso-${testKey()}`;
    const ids = { cap: `${base}-cap`, ok: `${base}-ok` };
    // No id → a throwaway B record created (and cleaned up) by this test.
    const bId = c.targetB.id ?? `${base}-b`;
    const cleanupIds = [ids.cap, ids.ok, ...(c.targetB.id ? [] : [bId])];
    try {
      await c.cleanup(db, cleanupIds); // clear leftovers from an aborted earlier run (ids are stable per test)
      await c.setupA(db, ids.cap);
      await c.setupA(db, ids.ok);
      await c.targetB.setup?.(db, bId);
      const [capBefore, okBefore, bBefore] = await Promise.all([ids.cap, ids.ok, bId].map((id) => c.state(db, id)));

      // 1. Owner A does it in the UI on their own record; capture the POST.
      const owner = await asRole(c.role ?? 'owner');
      const action = await captureAction(owner, () => c.trigger(owner, ids.cap));
      await expect.poll(() => c.state(db, ids.cap), { message: 'UI action took effect' }).not.toEqual(capBefore);

      // 2. Positive control: replay at another A record works (so the replay is valid).
      const okRes = await replayAction(owner, retarget(action, ids.cap, ids.ok));
      expect(okRes.status(), 'own-record replay status').toBe(200);
      expect(await actionResult(okRes), 'own-record replay result').toMatchObject({ ok: true });
      await expect.poll(() => c.state(db, ids.ok), { message: 'own-record replay took effect' }).not.toEqual(okBefore);

      // 3. Same replay aimed at B's record: refused, and B is untouched.
      const res = await replayAction(owner, retarget(action, ids.cap, bId));
      expect(res.status(), 'cross-tenant replay status').toBe(200);
      if (c.rejects) expect(await actionResult(res), 'cross-tenant replay result').toMatchObject({ ok: false });
      expect(await c.state(db, bId), `BREACH: ${c.label} changed campaign B's record`).toEqual(bBefore);
    } finally {
      await c.cleanup(db, cleanupIds);
    }
  });
}
