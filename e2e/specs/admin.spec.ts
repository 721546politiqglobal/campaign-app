import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect, allowConsole } from '../fixtures';
import {
  createThrowawayCampaign, addThrowawayUser, deleteThrowawayCampaign, must, type Throwaway,
} from '../helpers/throwaway-campaign';

// Super-admin console. Every mutation targets throwaway campaigns/users
// (helpers/throwaway-campaign.ts) — seeded tenants are shared with concurrent
// specs. Counts are never asserted globally except on the dashboard, where the
// UI value is bracketed by db counts read before and after the render.

const testKey = () => test.info().testId.split('-').pop()!;

/** Runs `body` with fresh throwaway campaigns, always deleting them afterwards. */
async function withCampaigns(db: SupabaseClient,
  specs: Parameters<typeof createThrowawayCampaign>[2][],
  body: (ts: Throwaway[]) => Promise<void>) {
  const ts: Throwaway[] = [];
  try {
    for (const s of specs) ts.push(await createThrowawayCampaign(db, testKey(), s));
    await body(ts);
  } finally {
    for (const t of ts) await deleteThrowawayCampaign(db, t.campaignId);
  }
}

const dialog = (page: Page) => page.getByRole('dialog');
const rowWith = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });
const toInt = (s: string | null) => Number((s ?? '').replace(/[^\d]/g, ''));

async function dbStats(db: SupabaseClient) {
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    expect(r.error).toBeNull();
    return r.count ?? 0;
  };
  return {
    Campaigns: await count(db.from('campaigns').select('id', { count: 'exact', head: true })),
    Users: await count(db.from('users').select('id', { count: 'exact', head: true }).neq('role', 'super_admin')),
    'Content items': await count(db.from('content_items').select('id', { count: 'exact', head: true })),
    'Awaiting review': await count(db.from('content_items').select('id', { count: 'exact', head: true }).eq('status', 'in_review')),
  };
}

test('dashboard stat cards match the database counts', async ({ asRole, db }) => {
  const page = await asRole('admin');
  await withCampaigns(db, [{}], async () => {
    // Other specs insert/delete rows concurrently, so each displayed value must
    // lie between the db counts read just before and just after the render.
    await expect(async () => {
      const before = await dbStats(db);
      await page.goto('/admin');
      const shown: Record<string, number> = {};
      for (const label of Object.keys(before)) {
        const card = page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: new RegExp(`^${label}$`) }) });
        shown[label] = toInt(await card.locator('.stat-value').textContent());
      }
      const after = await dbStats(db);
      for (const [label, b] of Object.entries(before)) {
        const a = after[label as keyof typeof after];
        expect(shown[label], label).toBeGreaterThanOrEqual(Math.min(a, b));
        expect(shown[label], label).toBeLessThanOrEqual(Math.max(a, b));
      }
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
});

test('users: search, sign in as a user (audited), remove a user, last owner protected', async ({ asRole, db }) => {
  const page = await asRole('admin');
  await withCampaigns(db, [{}], async ([t]) => {
    const staff = await addThrowawayUser(db, t.campaignId, 'staff', 'staff');

    // Search matches name or email; the campaign id is in every throwaway email.
    await page.goto('/admin/users');
    await page.getByRole('searchbox', { name: 'Search' }).fill(t.campaignId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/users\\?q=${t.campaignId}`));
    await expect(page.getByText('2 users across all campaigns')).toBeVisible();
    await expect(rowWith(page, staff.email)).toContainText('Staff');
    await expect(rowWith(page, staff.email)).toContainText(t.campaignName);
    await expect(rowWith(page, t.owner.email)).toContainText('Owner');

    // The only owner cannot be removed (server refuses, user stays).
    await rowWith(page, t.owner.email).getByRole('button', { name: 'Remove' }).click();
    await expect(dialog(page)).toContainText(`Remove ${t.owner.name}?`);
    await dialog(page).getByRole('button', { name: 'Remove user' }).click();
    await expect(page.getByText("This is the campaign's only owner. Add another owner before removing them.")).toBeVisible();
    expect((await db.from('users').select('id').eq('id', t.owner.id)).data).toHaveLength(1);

    // Removing the staff member deletes them and writes an audit entry.
    await rowWith(page, staff.email).getByRole('button', { name: 'Remove' }).click();
    await dialog(page).getByRole('button', { name: 'Remove user' }).click();
    await expect(page.getByText('User removed.')).toBeVisible();
    await expect(rowWith(page, staff.email)).toHaveCount(0);
    expect((await db.from('users').select('id').eq('id', staff.id)).data).toEqual([]);
    const { data: removedAudit } = await db.from('audit_entries').select('actor_user_id, details')
      .eq('campaign_id', t.campaignId).eq('action', 'admin_user_removed').eq('entity_id', staff.id);
    expect(removedAudit).toEqual([{ actor_user_id: 'e2e-admin', details: { role: 'staff' } }]);

    // "Sign in as" records an audit entry, then switches this context's session.
    await rowWith(page, t.owner.email).getByRole('button', { name: 'Sign in as' }).click();
    await expect(dialog(page)).toContainText(`Sign in as ${t.owner.name}?`);
    await dialog(page).getByRole('button', { name: 'Sign in as user' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('.rolebadge')).toHaveText('Owner');
    const { data: imp } = await db.from('audit_entries').select('actor_user_id, details')
      .eq('campaign_id', t.campaignId).eq('action', 'admin_impersonate').eq('entity_id', t.owner.id);
    expect(imp).toEqual([{ actor_user_id: 'e2e-admin', details: { admin_user_id: 'e2e-admin', target_role: 'owner' } }]);
    // The impersonated session is a tenant session: the admin console is closed to it.
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin/);
  });
});

test('campaigns: search, status filter and tag filter; tags edited on the detail page', async ({ asRole, db }) => {
  // Viewport prefetches of the table's links are aborted by the next page.goto.
  allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/admin\/\S+\. Falling back to browser navigation/);
  const page = await asRole('admin');
  const k = testKey();
  const tag = `t17-${k}`.toLowerCase().slice(0, 40);
  await withCampaigns(db, [
    { suffix: 'act', name: `T17 Filter ${k} Active`, tags: [tag] },
    { suffix: 'ina', name: `T17 Filter ${k} Lapsed`, tags: [tag], subscriptionStatus: 'canceled' },
    { suffix: 'unt', name: `T17 Filter ${k} Untagged` },
  ], async ([active, lapsed, untagged]) => {
    const names = (p: Page) => p.locator('tbody tr .row-link');

    await page.goto('/admin/campaigns');
    await page.getByRole('searchbox', { name: 'Search' }).fill(`T17 Filter ${k}`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const sortedNames = async () => (await names(page).allTextContents()).sort();
    await expect.poll(sortedNames).toEqual([active.campaignName, lapsed.campaignName, untagged.campaignName].sort());
    await expect(rowWith(page, active.campaignName)).toContainText('Active');
    await expect(rowWith(page, lapsed.campaignName)).toContainText('Inactive');

    // Status tabs keep the search.
    const tabs = page.getByRole('navigation', { name: 'Status' });
    await tabs.getByRole('link', { name: 'Inactive' }).click();
    await expect(page).toHaveURL(/status=inactive/);
    await expect(tabs.getByRole('link', { name: 'Inactive' })).toHaveAttribute('aria-current', 'page');
    await expect(names(page)).toHaveText([lapsed.campaignName]);
    await tabs.getByRole('link', { name: 'Active', exact: true }).click();
    await expect(page).toHaveURL(/status=active/);
    await expect.poll(sortedNames).toEqual([active.campaignName, untagged.campaignName].sort());
    await tabs.getByRole('link', { name: 'All', exact: true }).click();
    await expect(names(page)).toHaveCount(3);

    // Tag chip filters to campaigns carrying that tag (search cleared).
    await page.goto('/admin/campaigns');
    const chips = page.getByRole('group', { name: 'Filter by tag' });
    await chips.getByRole('link', { name: tag, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`tag=${tag}`));
    await expect(chips.getByRole('link', { name: tag, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(sortedNames).toEqual([active.campaignName, lapsed.campaignName].sort());

    // Detail page: add the tag to the untagged campaign → it joins the tag filter.
    await rowWith(page, active.campaignName).getByRole('link', { name: 'Manage' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/campaigns/${active.campaignId}$`));
    await page.goto(`/admin/campaigns/${untagged.campaignId}`);
    await expect(page.getByRole('heading', { level: 1, name: untagged.campaignName })).toBeVisible();
    await page.getByRole('textbox', { name: 'Tags' }).fill(`${tag}, extra-${k}`.toLowerCase());
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Campaign settings saved.')).toBeVisible();
    const { data } = await db.from('campaigns').select('tags').eq('id', untagged.campaignId).single();
    expect(data?.tags).toEqual([tag, `extra-${k}`.toLowerCase()]);
    await page.goto(`/admin/campaigns?tag=${tag}`);
    await expect.poll(sortedNames).toEqual([active.campaignName, lapsed.campaignName, untagged.campaignName].sort());
  });
});

test('campaign detail: avatar + voice assignment and plan seat limits', async ({ asRole, db }) => {
  const page = await asRole('admin');
  const k = testKey();
  // Starter plan: 3 seats (members + pending invites).
  await withCampaigns(db, [{ plan: 'starter' }], async ([t]) => {
    await page.goto(`/admin/campaigns/${t.campaignId}`);
    await expect(page.getByRole('heading', { level: 1, name: t.campaignName })).toBeVisible();
    await expect(page.getByText('1 of 3 seats used')).toBeVisible();

    // Avatar: consent is required before the form submits.
    const groupId = `grp-t17-${k}`;
    await page.getByRole('textbox', { name: 'HeyGen avatar group ID' }).fill(groupId);
    await page.getByRole('checkbox', { name: /consent for this HeyGen avatar/ }).check();
    await page.getByRole('button', { name: 'Assign avatar' }).click();
    await expect(page.getByText('Avatar assigned.')).toBeVisible();
    await expect(page.getByText('Active avatar assigned')).toBeVisible();
    await expect(page.locator('code', { hasText: groupId })).toBeVisible();
    const { data: av } = await db.from('avatars').select('id, status, heygen_group_id, consent_confirmed_by').eq('campaign_id', t.campaignId);
    expect(av).toHaveLength(1);
    expect(av![0]).toMatchObject({ status: 'ready', heygen_group_id: groupId, consent_confirmed_by: 'e2e-admin' });
    const { data: prof } = await db.from('candidate_profiles').select('active_avatar_id, heygen_base_avatar_id').eq('campaign_id', t.campaignId).single();
    expect(prof).toEqual({ active_avatar_id: av![0].id, heygen_base_avatar_id: groupId });

    // Re-assigning the same group reuses the row (no quota burn).
    await page.getByRole('textbox', { name: 'HeyGen avatar group ID' }).fill(groupId);
    await page.getByRole('checkbox', { name: /consent for this HeyGen avatar/ }).check();
    await page.getByRole('button', { name: 'Assign avatar' }).click();
    await expect(page.getByText('Avatar assigned.').first()).toBeVisible();
    await expect.poll(async () => (await db.from('avatars').select('id').eq('campaign_id', t.campaignId)).data?.length).toBe(1);

    const voiceId = `voice-t17-${k}`;
    await page.getByRole('textbox', { name: 'HeyGen voice ID' }).fill(voiceId);
    await page.getByRole('checkbox', { name: /consent for this HeyGen voice/ }).check();
    await page.getByRole('button', { name: 'Assign voice' }).click();
    await expect(page.getByText('Voice assigned.')).toBeVisible();
    await expect(page.locator('code', { hasText: voiceId })).toBeVisible();
    await expect.poll(async () => (await db.from('candidate_profiles').select('heygen_voice_id').eq('campaign_id', t.campaignId).single()).data?.heygen_voice_id).toBe(voiceId);

    // Seats: add a user (2 of 3), generate an invite (3 of 3), then both are refused.
    const email = `${t.campaignId}-added@e2e.test`;
    const addForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add & invite' }) });
    await addForm.getByRole('textbox', { name: 'Name' }).fill(`T17 Added ${k}`);
    await addForm.getByRole('textbox', { name: 'Email' }).fill(email);
    await addForm.getByRole('button', { name: 'Add & invite' }).click();
    await expect(page.getByText('User added and invite link generated.')).toBeVisible();
    await expect(page.getByText('2 of 3 seats used')).toBeVisible();
    await expect(rowWith(page, email)).toContainText('Staff');

    await page.getByRole('button', { name: 'Generate invite link' }).click();
    await expect(page.getByText('Invite link generated.')).toBeVisible();
    await expect(page.getByText('3 of 3 seats used')).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'Active' }).locator('code')).toHaveCount(2);

    const full = "This campaign's plan allows 3 seats and they're all taken (members plus pending invites).";
    await page.getByRole('button', { name: 'Generate invite link' }).click();
    await expect(page.getByRole('alert').filter({ hasText: full })).toBeVisible();
    await addForm.getByRole('textbox', { name: 'Name' }).fill(`T17 Overflow ${k}`);
    await addForm.getByRole('textbox', { name: 'Email' }).fill(`${t.campaignId}-overflow@e2e.test`);
    await addForm.getByRole('button', { name: 'Add & invite' }).click();
    await expect(page.getByRole('alert').filter({ hasText: full })).toHaveCount(2);
    const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('campaign_id', t.campaignId);
    expect(count).toBe(2);
    const { count: inv } = await db.from('invite_codes').select('code', { count: 'exact', head: true }).eq('campaign_id', t.campaignId);
    expect(inv).toBe(2);
  });
});

test('content: cross-campaign list with search and campaign filter', async ({ asRole, db }) => {
  // Viewport prefetches of the table's links are aborted by the next page.goto.
  allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/(content|admin)\/\S+\. Falling back to browser navigation/);
  const page = await asRole('admin');
  const k = testKey();
  await withCampaigns(db, [{ suffix: 'one' }, { suffix: 'two' }], async ([a, b]) => {
    const rows = [
      { id: `${a.campaignId}-c`, campaign_id: a.campaignId, title: `T17 xcamp ${k} alpha`, status: 'in_review', created_by: a.owner.id, is_ai_generated: true },
      { id: `${b.campaignId}-c`, campaign_id: b.campaignId, title: `T17 xcamp ${k} beta`, status: 'draft', created_by: b.owner.id, is_ai_generated: false },
    ];
    await must(db.from('content_items').insert(rows.map((r) => ({
      ...r, type: 'social_post', body: 'Admin content list test.', target_jurisdictions: ['US-FEDERAL'], platforms: ['x'],
    }))));

    await page.goto('/admin/content');
    await page.getByRole('searchbox', { name: 'Search' }).fill(`T17 xcamp ${k}`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('2 items')).toBeVisible();
    await expect(rowWith(page, rows[0].title)).toContainText(a.campaignName);
    await expect(rowWith(page, rows[0].title)).toContainText('AI');
    await expect(rowWith(page, rows[1].title)).toContainText(b.campaignName);

    // Status tab keeps the search.
    await page.getByRole('navigation', { name: 'Status' }).getByRole('link', { name: 'In review' }).click();
    await expect(page.getByText('1 item', { exact: true })).toBeVisible();
    await expect(rowWith(page, rows[0].title)).toBeVisible();
    await expect(rowWith(page, rows[1].title)).toHaveCount(0);

    // The campaign link narrows to that tenant.
    await page.goto(`/admin/content?campaign=${b.campaignId}`);
    await expect(page.getByText(`Showing content for ${b.campaignName}`)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(rowWith(page, rows[1].title)).toBeVisible();
  });
});

test('audit log shows the entry an admin action just created', async ({ asRole, db }) => {
  const page = await asRole('admin');
  await withCampaigns(db, [{}], async ([t]) => {
    const staff = await addThrowawayUser(db, t.campaignId, 'staff', 'staff');
    await page.goto(`/admin/campaigns/${t.campaignId}`);
    await rowWith(page, staff.email).getByRole('button', { name: 'Remove' }).click();
    await dialog(page).getByRole('button', { name: 'Remove user' }).click();
    await expect(page.getByText('User removed.')).toBeVisible();

    // Campaign detail → "Full log" → filtered audit page.
    await page.reload();
    await expect(rowWith(page, staff.id)).toContainText('Admin removed a user');
    await page.getByRole('link', { name: 'Full log' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/audit\\?campaign=${t.campaignId}`));
    const entry = rowWith(page, staff.id);
    await expect(entry).toContainText('Admin removed a user');
    await expect(entry).toContainText('admin_user_removed');
    await expect(entry).toContainText(t.campaignName);
    await expect(entry).toContainText('E2E Admin');

    // Global search by entity id finds it too.
    await page.goto('/admin/audit');
    await page.getByRole('searchbox', { name: 'Search' }).fill(staff.id);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('1 entry · append-only')).toBeVisible();
    await expect(rowWith(page, staff.id)).toContainText('Admin removed a user');
  });
});
