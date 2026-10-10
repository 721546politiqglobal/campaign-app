import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures';
import { USERS, CAMPAIGN_A } from '../helpers/users';
import { addFakeRule, fakeRequests, removeFakeRule } from '../helpers/ayrshare';
import { E2E_SECRETS, FAKE_AYRSHARE_URL } from '../env';

// Smoke for the Ayrshare test seam: the E2E server's real Ayrshare adapters
// talk to e2e/fake-ayrshare/server.ts (AYRSHARE_BASE_URL), never to Ayrshare.

const SEEDED_PROFILE_KEY = 'e2e-profile-a'; // e2e/seed.e2e.sql, campaign A

/** A throwaway approved, human-written X post in campaign A (needs no disclosure). */
async function insertApproved(db: SupabaseClient, id: string, marker: string) {
  const { error } = await db.from('content_items').insert({
    id, campaign_id: CAMPAIGN_A, type: 'social_post', title: `E2E fake ${id}`,
    body: `Fake Ayrshare smoke ${marker}`, status: 'approved', is_ai_generated: false,
    target_jurisdictions: ['US-FEDERAL'], created_by: USERS.staff.id, platforms: ['x'],
  });
  expect(error).toBeNull();
  const { error: e2 } = await db.from('approval_records').insert({
    content_item_id: id, campaign_id: CAMPAIGN_A, approver_user_id: USERS.approver.id, decision: 'approve',
  });
  expect(e2).toBeNull();
}

async function cleanup(db: SupabaseClient, id: string) {
  const { error: e1 } = await db.from('audit_entries').delete().eq('entity_id', id);
  expect(e1).toBeNull();
  const { error: e2 } = await db.from('content_items').delete().eq('id', id); // approvals cascade
  expect(e2).toBeNull();
}

async function publishNow(page: Page, id: string) {
  await page.goto(`/content/${id}`);
  await page.getByRole('button', { name: /^Publish to 1 platform$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
}

// The fake's request log survives E2E_SKIP_RESET reruns, so markers carry a
// per-run nonce: a stable testId-only marker would match the previous run's posts.
const RUN_NONCE = Date.now().toString(36);
const ids = () => {
  const key = `${test.info().testId.split('-').pop()!}-${RUN_NONCE}`;
  return { id: `e2e-fake-${key}`, marker: `marker-${key}` };
};
const postsWith = async (marker: string) =>
  (await fakeRequests({ path: '/api/post', profileKey: SEEDED_PROFILE_KEY }))
    .filter((r) => String((r.body as { post?: string })?.post ?? '').includes(marker));

test('Publish now reaches the fake Ayrshare with the campaign profile key', async ({ asRole, db }) => {
  const { id, marker } = ids();
  try {
    await insertApproved(db, id, marker);
    await publishNow(await asRole('owner'), id);

    await expect.poll(async () => (await db.from('content_items').select('status').eq('id', id).single()).data?.status)
      .toBe('published');
    const [req, ...more] = await postsWith(marker);
    expect(more).toHaveLength(0);
    expect(req).toMatchObject({
      host: 'app', method: 'POST',
      headers: { authorization: `Bearer ${E2E_SECRETS.ayrshareKey}`, 'profile-key': SEEDED_PROFILE_KEY },
      body: { platforms: ['twitter'] },
    });
    // The fake's post id is stored for analytics sync — in a second write after the status
    // flips to published (src/app/actions.ts publishAction), so poll for it.
    await expect.poll(async () =>
      (await db.from('content_items').select('ayrshare_post_ids').eq('id', id).single()).data?.ayrshare_post_ids)
      .toEqual({ x: expect.stringMatching(/^fake-post-\d+$/) });
  } finally {
    await cleanup(db, id);
  }
});

test('a platform failure from Ayrshare surfaces as a failed publish', async ({ asRole, db }) => {
  const { id, marker } = ids();
  try {
    await insertApproved(db, id, marker);
    // Scoped to this test's post, so parallel publishes elsewhere still succeed.
    await addFakeRule(marker, { failPlatforms: ['x'], match: { textIncludes: marker } });
    const page = await asRole('owner');
    await publishNow(page, id);

    await expect(page.getByText('Publishing failed: X')).toBeVisible();
    expect(await postsWith(marker)).toHaveLength(1);
    const { data } = await db.from('content_items').select('status').eq('id', id).single();
    expect(data?.status).toBe('approved');
  } finally {
    await removeFakeRule(marker);
    await cleanup(db, id);
  }
});

test('fake rules are additive and owner-keyed: removing one leaves the other active', async () => {
  const a = `${ids().marker}-a`;
  const b = `${ids().marker}-b`;
  const post = (text: string, platform: string) => fetch(`${FAKE_AYRSHARE_URL}/app/api/post`, {
    method: 'POST',
    headers: { authorization: `Bearer ${E2E_SECRETS.ayrshareKey}`, 'content-type': 'application/json', 'profile-key': SEEDED_PROFILE_KEY },
    body: JSON.stringify({ post: text, platforms: [platform] }),
  });
  try {
    await addFakeRule(a, { failPlatforms: ['x'], match: { textIncludes: a } });
    await addFakeRule(b, { failPlatforms: ['facebook'], match: { textIncludes: b } });
    expect((await post(a, 'twitter')).status).toBe(400);
    expect((await post(b, 'facebook')).status).toBe(400);
    expect((await post(b, 'twitter')).status).toBe(200); // A's rule is scoped to marker A
    await removeFakeRule(a);
    expect((await post(a, 'twitter')).status).toBe(200); // A is gone...
    expect((await post(b, 'facebook')).status).toBe(400); // ...B is untouched
  } finally {
    await removeFakeRule(a);
    await removeFakeRule(b);
  }
});

test('the fake rejects calls without the e2e bearer key', async () => {
  const marker = ids().marker;
  const body = JSON.stringify({ post: marker, platforms: ['twitter'] });
  for (const headers of [{}, { authorization: 'Bearer wrong-key' }] as Record<string, string>[]) {
    const res = await fetch(`${FAKE_AYRSHARE_URL}/app/api/post`, {
      method: 'POST', body, headers: { ...headers, 'content-type': 'application/json', 'profile-key': SEEDED_PROFILE_KEY },
    });
    expect(res.status).toBe(401);
  }
  // Rejected calls are not recorded, and every recorded call carried the key.
  expect(await postsWith(marker)).toHaveLength(0);
  for (const r of await fakeRequests()) expect(r.headers.authorization).toBe(`Bearer ${E2E_SECRETS.ayrshareKey}`);
});

test('the fake refuses posts for an unknown profile or an unlinked network', async () => {
  const marker = ids().marker;
  const post = (profileKey: string, platform: string) => fetch(`${FAKE_AYRSHARE_URL}/app/api/post`, {
    method: 'POST',
    headers: { authorization: `Bearer ${E2E_SECRETS.ayrshareKey}`, 'content-type': 'application/json', 'profile-key': profileKey },
    body: JSON.stringify({ post: marker, platforms: [platform] }),
  });
  const unknown = await post(`no-such-profile-${marker}`, 'twitter');
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toMatchObject({ status: 'error', errors: [{ message: expect.any(String) }] });
  // TikTok: linked by nobody in the seed, and no spec links it.
  expect((await post(SEEDED_PROFILE_KEY, 'tiktok')).status).toBe(400);
});

// Connect + disconnect through /channels, on campaign A's real (fake-backed)
// profile. LinkedIn is used by no other spec, so parallel publishes to
// x/facebook on campaign A are unaffected; it is unlinked again in finally.
test('owner connects LinkedIn through the linking page, then disconnects it', async ({ asRole, db }) => {
  const readAccounts = async () => {
    const { data, error } = await db.from('campaigns').select('social_accounts').eq('id', CAMPAIGN_A).single();
    expect(error).toBeNull();
    return (data?.social_accounts ?? []) as { platform: string }[];
  };
  const card = (page: Page) => page.getByRole('region', { name: 'LinkedIn', exact: true });
  const ruleId = ids().marker;
  try {
    // Scoped to campaign A's profile so concurrent throwaway tenants' /link calls keep the default.
    await addFakeRule(ruleId, { linkPlatforms: ['linkedin'], match: { profileKey: SEEDED_PROFILE_KEY } });
    const page = await asRole('owner');
    await page.goto('/channels');
    await expect(card(page).getByText('Not connected', { exact: true })).toBeVisible();

    // The app opens the linking page in a popup; the fake links LinkedIn and
    // redirects back to /channels, which tells the opener and closes itself.
    const popupP = page.waitForEvent('popup');
    await card(page).getByRole('button', { name: 'Connect LinkedIn' }).click();
    const popup = await popupP;
    await popup.waitForURL(/\/channels/).catch(() => { /* closed itself first */ });
    if (!popup.isClosed()) await popup.close(); // as a user would, if it lingers

    await expect(card(page).getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByText('LinkedIn connected')).toBeVisible();
    await expect.poll(async () => (await readAccounts()).map((a) => a.platform).sort()).toEqual(['facebook', 'linkedin', 'x']);
    const link = await fakeRequests({ path: '/api/profiles/generateJWT' });
    expect(link.at(-1)?.body).toMatchObject({ profileKey: SEEDED_PROFILE_KEY, redirect: expect.stringMatching(/\/channels\?linked=1$/) });

    await card(page).getByRole('button', { name: 'Disconnect LinkedIn' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByText('LinkedIn disconnected')).toBeVisible();
    await expect(card(page).getByText('Not connected', { exact: true })).toBeVisible();
    await expect.poll(async () => (await readAccounts()).map((a) => a.platform).sort()).toEqual(['facebook', 'x']);
    const unlink = (await fakeRequests({ path: '/api/profiles/social', profileKey: SEEDED_PROFILE_KEY })).at(-1);
    expect(unlink).toMatchObject({ method: 'DELETE', body: { platform: 'linkedin' } });
  } finally {
    await removeFakeRule(ruleId);
    // Restore campaign A to the seed if the test stopped half-way.
    const unlinkRes = await fetch(`${FAKE_AYRSHARE_URL}/api/api/profiles/social`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${E2E_SECRETS.ayrshareKey}`, 'content-type': 'application/json', 'profile-key': SEEDED_PROFILE_KEY },
      body: JSON.stringify({ platform: 'linkedin' }),
    });
    expect(unlinkRes.ok, `fake unlink restore: HTTP ${unlinkRes.status}`).toBe(true);
    const accounts = await readAccounts();
    if (accounts.some((a) => a.platform === 'linkedin')) {
      const { error } = await db.from('campaigns')
        .update({ social_accounts: accounts.filter((a) => a.platform !== 'linkedin') }).eq('id', CAMPAIGN_A);
      expect(error).toBeNull();
    }
  }
});
