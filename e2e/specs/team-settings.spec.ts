import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect, allowConsole } from '../fixtures';
import { USERS } from '../helpers/users';
import { captureAction, replayAction, retarget, actionResult } from '../helpers/server-action';
import {
  createThrowawayCampaign, addThrowawayUser, deleteThrowawayCampaign, uiLogin, loginInNewContext, must,
  isolatedIp, THROWAWAY_PASSWORD, type Throwaway,
} from '../helpers/throwaway-campaign';

// Every mutating test runs in its own throwaway campaign with throwaway users
// (helpers/throwaway-campaign.ts): seeded users are logged in by other specs
// concurrently, and campaign A's settings are shared — neither is touched here.

const testKey = () => test.info().testId.split('-').pop()!;

const L = {
  generateInvite: 'Generate invite link',
  inviteCreated: 'Invite link created. Copy it from the pending invites and send it to your teammate.',
  roleChanged: 'Role updated.',
  removed: 'Teammate removed.',
  confirmRoleChange: 'Change role',
  confirmRemove: 'Remove',
  readOnlyNote: 'Only campaign owners and managers can invite teammates or change roles.',
  inviteHeading: 'Invite a teammate',
  ownerRoleCannotBeChanged: "The campaign owner's role can't be changed here.",
  ownerCannotBeRemoved: "The campaign owner can't be removed.",
  saveProfile: 'Save profile',
  profileSaved: 'Profile saved.',
  fixErrors: 'Fix the highlighted fields and try again.',
  required: 'This field is required.',
  badUrl: 'Enter a valid http(s) URL.',
  saveDisclosure: 'Save disclosure',
  disclosureSaved: 'Disclosure saved.',
};

/** Runs `body` against a fresh throwaway campaign, always deleting it afterwards. */
async function withCampaign(db: SupabaseClient, body: (t: Throwaway) => Promise<void>, opts?: Parameters<typeof createThrowawayCampaign>[2]) {
  const t = await createThrowawayCampaign(db, testKey(), opts);
  try { await body(t); } finally { await deleteThrowawayCampaign(db, t.campaignId); }
}

const roleBadge = (page: Page) => page.locator('.rolebadge');
const confirmDialog = (page: Page) => page.getByRole('dialog');

test.describe('team', () => {
  test('owner generates an invite; joining with it adds the member to /team', async ({ page, db, browser }) => {
    await withCampaign(db, async (t) => {
      await uiLogin(page, t.owner.email);
      await page.goto('/team');
      await page.getByLabel('Role', { exact: true }).selectOption('staff');
      await page.getByRole('button', { name: L.generateInvite }).click();
      await expect(page.getByText(L.inviteCreated)).toBeVisible();

      const link = page.getByRole('region', { name: 'Pending invites' }).locator('code');
      await expect(link).toHaveCount(1);
      const shareUrl = new URL((await link.textContent())!);
      const code = shareUrl.searchParams.get('code')!;
      expect(code).toBeTruthy();

      const joiner = { name: `T17 Joiner ${t.key.slice(-6)}`, email: `${t.campaignId}-joiner@e2e.test` };
      const ctx = await browser.newContext();
      try {
        const p = await ctx.newPage();
        await p.goto(`${shareUrl.pathname}${shareUrl.search}`);
        await expect(p.getByLabel('Invite code')).toHaveValue(code);
        await p.getByLabel('Full name').fill(joiner.name);
        await p.getByLabel('Email').fill(joiner.email);
        await p.getByLabel('Password').fill(THROWAWAY_PASSWORD);
        await p.getByRole('button', { name: 'Create account' }).click();
        await expect(p).toHaveURL(/\/dashboard$/);
        await expect(roleBadge(p)).toHaveText('Staff');
      } finally {
        await ctx.close();
      }

      await page.reload();
      const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: joiner.email, exact: true }) });
      await expect(row).toContainText(joiner.name);
      await expect(row).toContainText('Staff');
      // The redeemed invite leaves the pending list.
      await expect(page.getByRole('region', { name: 'Pending invites' }).locator('code')).toHaveCount(0);
      const { data: u } = await db.from('users').select('campaign_id, role').eq('email', joiner.email).single();
      expect(u).toEqual({ campaign_id: t.campaignId, role: 'staff' });
    });
  });

  test("changing a member's role takes effect on their very next request", async ({ page, db, browser }) => {
    // The member's nav prefetches are aborted when their context closes at the end.
    allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/\w+\. Falling back to browser navigation/);
    await withCampaign(db, async (t) => {
      const member = await addThrowawayUser(db, t.campaignId, 'staff', 'staff');
      const m = await loginInNewContext(browser, member.email);
      try {
        await expect(roleBadge(m.page)).toHaveText('Staff');
        await m.page.goto('/team');
        await expect(m.page.getByText(L.readOnlyNote)).toBeVisible();

        await uiLogin(page, t.owner.email);
        await page.goto('/team');
        await page.getByRole('combobox', { name: `Role for ${member.name}` }).selectOption('approver');
        await expect(confirmDialog(page)).toContainText(`Change ${member.name}'s role?`);
        await confirmDialog(page).getByRole('button', { name: L.confirmRoleChange }).click();
        await expect(page.getByText(L.roleChanged)).toBeVisible();
        await expect(page.getByRole('combobox', { name: `Role for ${member.name}` })).toHaveValue('approver');

        // Same cookie, no re-login: getSession() re-reads the role from the DB.
        await m.page.reload();
        await expect(roleBadge(m.page)).toHaveText('Approver');
        const { data } = await db.from('users').select('role').eq('id', member.id).single();
        expect(data?.role).toBe('approver');
      } finally {
        await m.ctx.close();
      }
    });
  });

  test("a removed member's existing session is rejected on their next navigation", async ({ page, db, browser }) => {
    await withCampaign(db, async (t) => {
      const member = await addThrowawayUser(db, t.campaignId, 'staff', 'staff');
      const m = await loginInNewContext(browser, member.email);
      try {
        await expect(m.page).toHaveURL(/\/dashboard$/);

        await uiLogin(page, t.owner.email);
        await page.goto('/team');
        await page.getByRole('button', { name: `Remove ${member.name}` }).click();
        await expect(confirmDialog(page)).toContainText(`Remove ${member.name} from the team?`);
        await confirmDialog(page).getByRole('button', { name: L.confirmRemove, exact: true }).click();
        await expect(page.getByText(L.removed)).toBeVisible();
        await expect(page.getByRole('cell', { name: member.email, exact: true })).toHaveCount(0);

        await m.page.goto('/content');
        await expect(m.page).toHaveURL(/\/login$/);
        const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('id', member.id);
        expect(count).toBe(0);
      } finally {
        await m.ctx.close();
      }
    });
  });

  test('the owner cannot demote or remove themselves (UI and server)', async ({ page, db }) => {
    await withCampaign(db, async (t) => {
      const staff = await addThrowawayUser(db, t.campaignId, 'staff', 'staff');
      await uiLogin(page, t.owner.email);
      await page.goto('/team');

      // UI: the owner's own row has no role select / remove button.
      const ownRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: t.owner.email, exact: true }) });
      await expect(ownRow).toContainText('You');
      await expect(ownRow).toContainText('Owner');
      await expect(ownRow.getByRole('combobox')).toHaveCount(0);
      await expect(ownRow.getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: `Role for ${t.owner.name}` })).toHaveCount(0);

      // Server: capture the owner's real role-change + remove actions on the
      // staff member, then replay them aimed at the owner's own id.
      const roleChange = await captureAction(page, async () => {
        await page.getByRole('combobox', { name: `Role for ${staff.name}` }).selectOption('approver');
        await confirmDialog(page).getByRole('button', { name: L.confirmRoleChange }).click();
      });
      await expect(page.getByText(L.roleChanged)).toBeVisible();
      const remove = await captureAction(page, async () => {
        await page.getByRole('button', { name: `Remove ${staff.name}` }).click();
        await confirmDialog(page).getByRole('button', { name: L.confirmRemove, exact: true }).click();
      });
      await expect(page.getByText(L.removed)).toBeVisible();

      const demote = await actionResult(await replayAction(page, retarget(roleChange, staff.id, t.owner.id)));
      expect(demote).toEqual({ ok: false, error: L.ownerRoleCannotBeChanged });
      const removeSelf = await actionResult(await replayAction(page, retarget(remove, staff.id, t.owner.id)));
      expect(removeSelf).toEqual({ ok: false, error: L.ownerCannotBeRemoved });

      const { data } = await db.from('users').select('role, campaign_id').eq('id', t.owner.id).single();
      expect(data).toEqual({ role: 'owner', campaign_id: t.campaignId });
    });
  });

  test('a manager can manage the team; approver and staff see it read-only', async ({ page, db, asRole }) => {
    // Read-only checks on the seeded roles (no mutation).
    for (const role of ['approver', 'staff'] as const) {
      const p = await asRole(role);
      await p.goto('/team');
      await expect(p.getByRole('cell', { name: USERS.owner.email, exact: true })).toBeVisible();
      await expect(p.getByText(L.readOnlyNote)).toBeVisible();
      await expect(p.getByRole('heading', { name: L.inviteHeading })).toHaveCount(0);
      await expect(p.getByRole('combobox', { name: /^Role for / })).toHaveCount(0);
      await expect(p.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    }
    // The manager actually manages: in a throwaway campaign, invites + changes a role.
    await withCampaign(db, async (t) => {
      const manager = await addThrowawayUser(db, t.campaignId, 'manager', 'manager');
      const staff = await addThrowawayUser(db, t.campaignId, 'staff', 'staff');
      await uiLogin(page, manager.email);
      await page.goto('/team');
      await expect(page.getByText(L.readOnlyNote)).toHaveCount(0);
      await page.getByRole('button', { name: L.generateInvite }).click();
      await expect(page.getByText(L.inviteCreated)).toBeVisible();
      await expect(page.getByRole('region', { name: 'Pending invites' }).locator('code')).toHaveCount(1);

      await page.getByRole('combobox', { name: `Role for ${staff.name}` }).selectOption('manager');
      await confirmDialog(page).getByRole('button', { name: L.confirmRoleChange }).click();
      await expect(page.getByText(L.roleChanged)).toBeVisible();
      const { data } = await db.from('users').select('role').eq('id', staff.id).single();
      expect(data?.role).toBe('manager');
      // …but cannot touch the owner.
      await expect(page.getByRole('combobox', { name: `Role for ${t.owner.name}` })).toHaveCount(0);
      await expect(page.getByRole('button', { name: `Remove ${t.owner.name}` })).toHaveCount(0);
    });
  });
});

test.describe('settings', () => {
  test('profile form shows server validation errors and keeps typed values', async ({ page, db }) => {
    await withCampaign(db, async (t) => {
      await uiLogin(page, t.owner.email);
      await page.goto('/settings');
      const tagline = `Validation tagline ${t.key.slice(-6)}`;
      // Whitespace passes the browser's `required` check but not the server's trim.
      await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('   ');
      await page.getByLabel('Tagline', { exact: true }).fill(tagline);
      // A syntactically valid URL the browser accepts, but not http(s).
      await page.getByLabel('Google Alerts RSS feed URL').fill('ftp://alerts.e2e.test/feed');
      await page.getByRole('button', { name: L.saveProfile }).click();

      await expect(page.locator('.alert-bad')).toHaveText(L.fixErrors);
      const fullName = page.getByRole('textbox', { name: 'Full name', exact: true });
      await expect(fullName).toHaveAttribute('aria-invalid', 'true');
      await expect(fullName).toHaveAccessibleDescription(new RegExp(L.required.replace('.', '\\.')));
      await expect(page.getByLabel('Google Alerts RSS feed URL')).toHaveAccessibleDescription(new RegExp(L.badUrl.replace(/[.()]/g, '\\$&')));
      await expect(page.getByLabel('Tagline', { exact: true })).toHaveValue(tagline);
      await expect(page.getByLabel('Google Alerts RSS feed URL')).toHaveValue('ftp://alerts.e2e.test/feed');

      // Nothing was written.
      const { data } = await db.from('candidate_profiles').select('full_name, tagline').eq('campaign_id', t.campaignId).single();
      expect(data).toEqual({ full_name: 'Tess Throwaway', tagline: 'Tess for Ward 9' });

      // Fix and save.
      await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Tess Validated');
      await page.getByLabel('Google Alerts RSS feed URL').fill('https://alerts.e2e.test/feed');
      await page.getByRole('button', { name: L.saveProfile }).click();
      await expect(page.getByText(L.profileSaved)).toBeVisible();
      await page.reload();
      await expect(page.getByRole('textbox', { name: 'Full name', exact: true })).toHaveValue('Tess Validated');
      await expect(page.getByLabel('Tagline', { exact: true })).toHaveValue(tagline);
    });
  });

  test('candidate profile edits persist across reload', async ({ page, db }) => {
    await withCampaign(db, async (t) => {
      await uiLogin(page, t.owner.email);
      await page.goto('/settings');
      const bio = `Edited bio ${t.key}.`;
      await page.getByRole('textbox', { name: 'Preferred name', exact: true }).fill('Tessie');
      await page.getByLabel('Running for').fill('State Senate');
      await page.getByRole('textbox', { name: 'District', exact: true }).fill('District 4');
      await page.getByLabel('Party').selectOption('Green');
      await page.getByLabel('Primary opponent').fill('Rory Rival');
      await page.getByLabel('Bio (2–3 sentences)').fill(bio);
      await page.getByLabel('Key positions').fill('Bike lanes\nLibraries');
      await page.getByLabel('Voice tone').selectOption('urgent');
      await page.getByLabel('Opponent aliases (comma-separated)').fill('R. Rival, Rival');
      await page.getByLabel('Opponent Twitter/X handle').fill('@roryrival');
      await page.getByRole('button', { name: L.saveProfile }).click();
      await expect(page.getByText(L.profileSaved)).toBeVisible();

      await page.reload();
      await expect(page.getByRole('textbox', { name: 'Preferred name', exact: true })).toHaveValue('Tessie');
      await expect(page.getByLabel('Running for')).toHaveValue('State Senate');
      await expect(page.getByRole('textbox', { name: 'District', exact: true })).toHaveValue('District 4');
      await expect(page.getByLabel('Party')).toHaveValue('Green');
      await expect(page.getByLabel('Primary opponent')).toHaveValue('Rory Rival');
      await expect(page.getByLabel('Bio (2–3 sentences)')).toHaveValue(bio);
      await expect(page.getByLabel('Key positions')).toHaveValue('Bike lanes\nLibraries');
      await expect(page.getByLabel('Voice tone')).toHaveValue('urgent');
      await expect(page.getByLabel('Opponent aliases (comma-separated)')).toHaveValue('R. Rival, Rival');
      // Leading @ is stripped on save.
      await expect(page.getByLabel('Opponent Twitter/X handle')).toHaveValue('roryrival');

      const { data } = await db.from('candidate_profiles')
        .select('preferred_name, office, district, party, opponent_name, bio, key_positions, voice_tone, opponent_aliases, opponent_twitter_handle')
        .eq('campaign_id', t.campaignId).single();
      expect(data).toEqual({
        preferred_name: 'Tessie', office: 'State Senate', district: 'District 4', party: 'Green',
        opponent_name: 'Rory Rival', bio, key_positions: ['Bike lanes', 'Libraries'], voice_tone: 'urgent',
        opponent_aliases: ['R. Rival', 'Rival'], opponent_twitter_handle: 'roryrival',
      });
    });
  });

  test('default disclosure saves and new AI content picks it up', async ({ page, db }) => {
    await withCampaign(db, async (t) => {
      const text = `Paid for by T17 ${t.key}. Made with AI.`;
      await uiLogin(page, t.owner.email);
      await page.goto('/settings');
      await page.getByLabel('Default AI disclosure').fill(text);
      await page.getByRole('button', { name: L.saveDisclosure }).click();
      await expect(page.getByText(L.disclosureSaved)).toBeVisible();
      await page.reload();
      await expect(page.getByLabel('Default AI disclosure')).toHaveValue(text);
      const { data: camp } = await db.from('campaigns').select('default_disclosure_text').eq('id', t.campaignId).single();
      expect(camp?.default_disclosure_text).toBe(text);

      // A new approved AI item (no disclosure attached yet) lands on the
      // disclosure step pre-filled with the campaign default.
      const contentId = `${t.campaignId}-content`;
      await must(db.from('content_items').insert({
        id: contentId, campaign_id: t.campaignId, type: 'social_post', title: `T17 disclosure ${t.key}`,
        body: 'Body for the disclosure default test.', status: 'approved', is_ai_generated: true,
        target_jurisdictions: ['US-FEDERAL'], created_by: t.owner.id, platforms: ['x'],
      }));
      await page.goto(`/content/${contentId}`);
      await expect(page.getByLabel('overlay')).toHaveValue(text);
    });
  });

  test('switching the interface to Español persists across reload and logout/login', async ({ page, db }) => {
    await withCampaign(db, async (t) => {
      await uiLogin(page, t.owner.email);
      await page.goto('/settings');
      await page.getByLabel('Language', { exact: true }).selectOption('es');
      await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect.poll(async () => (await db.from('users').select('locale').eq('id', t.owner.id).single()).data?.locale).toBe('es');

      // Sign out and back in: the language comes from the account, not the cookie.
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': isolatedIp() });
      await page.locator('input[name="email"]').fill(t.owner.email);
      await page.locator('input[name="password"]').fill(THROWAWAY_PASSWORD);
      await page.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole('link', { name: 'Configuración' })).toBeVisible();

      // Switch back.
      await page.goto('/settings');
      await page.getByLabel('Idioma', { exact: true }).selectOption('en');
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });
  });

  test('theme choice persists in a cookie across reload', async ({ page, db }) => {
    // ThemeToggle calls router.refresh() after saving the cookie; reloading aborts that refresh.
    allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/settings\. Falling back to browser navigation/);
    await withCampaign(db, async (t) => {
      await uiLogin(page, t.owner.email);
      await page.goto('/settings');
      const prefs = page.getByRole('region', { name: 'Language & appearance' });
      const theme = prefs.getByRole('radiogroup', { name: 'Theme' });
      await theme.getByRole('radio', { name: 'Dark' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === 'theme')?.value).toBe('dark');

      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(theme.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

      await theme.getByRole('radio', { name: 'Light' }).click();
      await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === 'theme')?.value).toBe('light');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });
  });
});
