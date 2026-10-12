import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { test, expect } from '../fixtures';
import { USERS, CAMPAIGN_A, PASSWORD } from '../helpers/users';
import { fakeRequests } from '../helpers/ayrshare';

const testKey = () => test.info().testId.split('-').pop()!;
const card = (page: Page, network: string) => page.getByRole('region', { name: network, exact: true });
// The page quietly re-reads Ayrshare on load; reloading mid-request aborts that
// fetch and logs a console error, so let it finish first.
const settle = (page: Page) => page.waitForLoadState('networkidle');
const NETWORK_NAME: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube' };
// X isn't linkable through Ayrshare, so /channels doesn't show it.
const NETWORKS = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube'];

async function must(r: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await r;
  expect(error?.message ?? null).toBeNull();
}

// Per-run nonce in campaign names: the app's Ayrshare profile title is
// "<name> · <id>", and the shared fake keeps profiles across E2E_SKIP_RESET
// runs, so a stable name would hit "title already exists" (code 146) on rerun.
const RUN_NONCE = Date.now().toString(36);

/** A private campaign + owner (no Ayrshare profile yet), so linking is free of cross-spec effects. */
async function makeCampaign(db: SupabaseClient, key: string, socialAccounts?: unknown[]) {
  const camp = `e2e-chan-${key}-camp`;
  const owner = { id: `e2e-chan-${key}-owner`, email: `chan-${key}@e2e.test` };
  await dropCampaign(db, camp, owner); // leftovers from an aborted earlier run (stable ids)
  await must(db.from('campaigns').insert({
    id: camp, name: `E2E channels ${key} ${RUN_NONCE}`, jurisdictions: ['US-TX'],
    // AppFrame redirects a campaign without a plan to /pricing.
    plan_id: 'enterprise', subscription_status: 'active', current_period_end: new Date(Date.now() + 20 * 864e5).toISOString(),
    ...(socialAccounts ? { social_accounts: socialAccounts } : {}),
  }));
  // AppFrame redirects a campaign without a candidate profile to /setup.
  await must(db.from('candidate_profiles').insert({
    id: `e2e-chan-${key}-profile`, campaign_id: camp, full_name: 'Channels Candidate', preferred_name: 'Chan',
    office: 'City Council', district: 'Ward 1', party: 'Independent', content_locale: 'en',
  }));
  await must(db.from('users').insert({
    id: owner.id, campaign_id: camp, name: 'Channels Owner', role: 'owner', email: owner.email,
    password_hash: bcrypt.hashSync(PASSWORD, 4), locale: 'en',
  }));
  return { camp, owner };
}

async function loginAs(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function dropCampaign(db: SupabaseClient, camp: string, owner: { id: string; email: string }) {
  await must(db.from('audit_entries').delete().eq('campaign_id', camp));
  await must(db.from('login_attempts').delete().eq('key', `email:${owner.email}`));
  await must(db.from('users').delete().eq('id', owner.id));
  await must(db.from('campaigns').delete().eq('id', camp)); // content + approvals cascade
}

const account = (platform: string, refreshRequired = false) => ({
  platform, name: `Throwaway ${platform}`, handle: null, profileUrl: null, avatarUrl: null, refreshRequired,
});

test('owner sees campaign A\'s seeded connections and they persist after reload', async ({ asRole }) => {
  const page = await asRole('owner');
  await page.goto('/channels');
  await expect(page.getByRole('heading', { name: 'Channels', level: 1 })).toBeVisible();
  // Seed (and the fake behind it) links X + Facebook; X has no card here (not
  // linkable through Ayrshare). Other networks are not asserted on beyond
  // TikTok/YouTube: other specs briefly link Instagram/LinkedIn.
  await expect(card(page, 'Facebook').getByText('Connected', { exact: true })).toBeVisible();
  await expect(card(page, 'Facebook').getByRole('button', { name: 'Disconnect Facebook' })).toBeVisible();
  await expect(card(page, 'X')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Connect X$|Disconnect X$/ })).toHaveCount(0);
  for (const n of ['TikTok', 'YouTube']) {
    await expect(card(page, n).getByText('Not connected', { exact: true })).toBeVisible();
    await expect(card(page, n).getByRole('button', { name: `Connect ${n}` })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Connect accounts' })).toBeEnabled();

  await settle(page);
  await page.reload();
  await expect(card(page, 'Facebook').getByText('Connected', { exact: true })).toBeVisible();
  await expect(card(page, 'TikTok').getByText('Not connected', { exact: true })).toBeVisible();
});

test('connect adds a platform, disconnect removes it, and state persists after reload', async ({ page, db }) => {
  const key = testKey();
  const { camp, owner } = await makeCampaign(db, key);
  const readAccounts = async () => {
    const { data, error } = await db.from('campaigns').select('social_accounts').eq('id', camp).single();
    expect(error).toBeNull();
    return (data?.social_accounts ?? []) as { platform: string }[];
  };
  try {
    await loginAs(page, owner.email);
    await page.goto('/channels');
    await expect(page.getByText('0 of 5 connected')).toBeVisible();
    for (const n of NETWORKS) await expect(card(page, n).getByText('Not connected', { exact: true })).toBeVisible();

    // Connect: the app creates the campaign's profile lazily, opens the (fake)
    // linking page in a popup, which links a network and bounces back.
    const popupP = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Connect accounts' }).click();
    const popup = await popupP;
    await popup.waitForURL(/\/channels/).catch(() => { /* closed itself first */ });
    if (!popup.isClosed()) await popup.close();

    // Link rules in other specs are scoped to their own profile keys, so this
    // fresh profile gets the fake's default: Instagram.
    await expect.poll(async () => (await readAccounts()).map((a) => a.platform)).toEqual(['instagram']);
    const linked = 'instagram';
    const net = NETWORK_NAME[linked];
    await expect(card(page, net).getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByText(`${net} connected`)).toBeVisible();
    await expect(page.getByText('1 of 5 connected')).toBeVisible();
    const stored = (await db.from('campaigns').select('ayrshare_profile_key').eq('id', camp).single()).data?.ayrshare_profile_key as string;
    expect(stored).toMatch(/^fake-profile-\d+$/);
    expect((await fakeRequests({ path: '/api/profiles/generateJWT', profileKey: undefined })).some(
      (r) => (r.body as { profileKey?: string })?.profileKey === stored)).toBe(true);

    await settle(page);
    await page.reload();
    await expect(card(page, net).getByText('Connected', { exact: true })).toBeVisible();

    await card(page, net).getByRole('button', { name: `Disconnect ${net}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByText(`${net} disconnected`)).toBeVisible();
    await expect(card(page, net).getByText('Not connected', { exact: true })).toBeVisible();
    await expect(page.getByText('0 of 5 connected')).toBeVisible();
    await expect.poll(async () => await readAccounts()).toEqual([]);
    const unlink = (await fakeRequests({ path: '/api/profiles/social', profileKey: stored })).at(-1);
    expect(unlink).toMatchObject({ method: 'DELETE', body: { platform: linked } });

    await settle(page);
    await page.reload();
    await expect(card(page, net).getByText('Not connected', { exact: true })).toBeVisible();
    await expect(page.getByText('0 of 5 connected')).toBeVisible();
  } finally {
    await dropCampaign(db, camp, owner);
  }
});

test('publish panel only offers connected platforms for an approved item', async ({ page, db }) => {
  const key = testKey();
  // LinkedIn connected; Facebook needs reconnecting (cannot post); X is never offered.
  const { camp, owner } = await makeCampaign(db, key, [account('linkedin'), account('facebook', true)]);
  const id = `e2e-chan-${key}-item`;
  try {
    await must(db.from('content_items').insert({
      id, campaign_id: camp, type: 'social_post', title: `E2E channels ${id}`, body: `Channels publish ${key}`,
      status: 'approved', is_ai_generated: false, target_jurisdictions: ['US-TX'], created_by: owner.id, platforms: ['linkedin', 'facebook'],
    }));
    await must(db.from('approval_records').insert({
      content_item_id: id, campaign_id: camp, approver_user_id: owner.id, decision: 'approve',
    }));
    await loginAs(page, owner.email);
    await page.goto(`/content/${id}`);

    const platforms = page.getByRole('group', { name: 'Platforms' });
    await expect(platforms.getByRole('checkbox', { name: 'LinkedIn' })).toBeChecked();
    await expect(platforms.getByRole('checkbox', { name: 'LinkedIn' })).toBeEnabled();
    await expect(platforms.getByRole('checkbox', { name: 'Facebook' })).toBeDisabled();
    await expect(platforms.getByRole('checkbox', { name: 'Facebook' })).not.toBeChecked();
    await expect(platforms.getByRole('checkbox', { name: 'X' })).toHaveCount(0);
    await expect(page.getByText('Only connected channels can be selected.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish to 1 platform', exact: true })).toBeEnabled();

    // No connected channel at all: nothing selectable, publishing blocked, pointer to /channels.
    await must(db.from('campaigns').update({ social_accounts: [] }).eq('id', camp));
    await settle(page);
    await page.reload();
    await expect(page.getByText('No channels connected yet')).toBeVisible();
    for (const n of ['Facebook', 'LinkedIn']) await expect(platforms.getByRole('checkbox', { name: n })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Publish to \d+ platforms?$/ })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Manage channels' })).toHaveAttribute('href', '/channels');
  } finally {
    await must(db.from('audit_entries').delete().eq('entity_id', id));
    await dropCampaign(db, camp, owner);
  }
});

for (const role of ['approver', 'staff'] as const) {
  test(`${role} sees connections read-only`, async ({ asRole }) => {
    const page = await asRole(role);
    await page.goto('/channels');
    await expect(card(page, 'Facebook').getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByText('Only owners and managers can change connections.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect accounts' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Connect|Disconnect|Reconnect) / })).toHaveCount(0);
  });
}

test('a campaign with no Ayrshare profile sees the not-connected empty state', async ({ page, db }) => {
  const { camp, owner } = await makeCampaign(db, testKey());
  try {
    await loginAs(page, owner.email);
    await page.goto('/channels');
    await expect(page.getByText('0 of 5 connected')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Get set up in a minute' })).toBeVisible();
    for (const n of NETWORKS) {
      await expect(card(page, n).getByText('Not connected', { exact: true })).toBeVisible();
      await expect(card(page, n).getByRole('button', { name: `Connect ${n}` })).toBeVisible();
    }
    await expect(page.getByText('@e2e_camp_a')).toHaveCount(0); // A's connections never leak in
  } finally {
    await dropCampaign(db, camp, owner);
  }
});

// Seeded campaign B has no candidate profile and no plan (e2e/seed.e2e.sql);
// AppFrame checks the profile first (src/components/AppFrame.tsx), so ownerB is
// sent to /setup and can never see A's connections.
test('campaign B owner never sees campaign A\'s channels', async ({ asRole }) => {
  const page = await asRole('ownerB');
  await page.goto('/channels');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText('E2E Campaign A')).toHaveCount(0);
  await expect(page.getByText('@e2e_camp_a')).toHaveCount(0);
});
