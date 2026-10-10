import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createThrowawayCampaign, deleteThrowawayCampaign, isolatedIp, must, THROWAWAY_PASSWORD } from '../helpers/throwaway-campaign';

const testKey = () => test.info().testId.split('-').pop()!;

// Landing page + first-run onboarding. Accessibility/landmark/contrast issues on
// the public pages are covered (and logged) by the page-sweep spec.

const demoDialog = (page: Page) => page.getByRole('dialog', { name: /See PolitIQ in action|Mira PolitIQ en acción/ });

async function expectVideo(page: Page, locale: 'en' | 'es', key: 'commercial' | 'walkthrough') {
  const video = demoDialog(page).locator('video');
  await expect(video.locator('source')).toHaveAttribute('src', `/videos/${locale}/${key}.mp4`);
  await expect(video).toHaveAttribute('poster', `/videos/${locale}/${key}-poster.jpg`);
  // Never autoplays.
  expect(await video.evaluate((v: HTMLVideoElement) => v.autoplay)).toBe(false);
  // Both assets are actually served.
  for (const [path, type] of [[`/videos/${locale}/${key}.mp4`, 'video/mp4'], [`/videos/${locale}/${key}-poster.jpg`, 'image/jpeg']]) {
    const res = await page.request.head(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type'], path).toContain(type);
  }
}

test.describe('landing', () => {
  test('renders for a visitor and its CTAs lead to sign-in, join and email', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The communications platform for modern campaigns.');
    await expect(page.locator('#features')).toBeVisible();
    await expect(page.locator('#workflow')).toBeVisible();

    // "Request access" CTAs are mailto links with a subject.
    const requestAccess = page.getByRole('link', { name: 'Request access' });
    await expect(requestAccess).toHaveCount(4); // nav, hero, bottom CTA, footer
    for (const href of await requestAccess.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
      expect(href).toMatch(/^mailto:[^?]+@[^?]+\?subject=Request%20access$/);
    }
    await expect(page.getByRole('link', { name: 'Open dashboard' })).toHaveCount(0);

    // In-page anchors.
    await page.locator('.lp-navlinks').getByRole('link', { name: 'How it works' }).click();
    await expect(page).toHaveURL(/#workflow$/);

    await page.getByRole('link', { name: 'Join your campaign' }).click();
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByLabel('Invite code')).toBeVisible();

    await page.goto('/');
    await page.locator('.lp-nav').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('input[name="email"]')).toBeVisible();

    await page.goto('/');
    await page.locator('.lp-cta-section').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a signed-in visitor gets "Open dashboard" instead of sign-in', async ({ asRole }) => {
    const p = await asRole('staff');
    await p.goto('/');
    await p.getByRole('link', { name: 'Open dashboard' }).click();
    await expect(p).toHaveURL(/\/dashboard$/);
  });

  test('demo video modal opens, switches videos and closes (English)', async ({ page }) => {
    await page.goto('/');
    await expect(demoDialog(page)).toBeHidden();
    await page.locator('.lp-hero').getByRole('button', { name: 'Watch the demo' }).click();
    await expect(demoDialog(page)).toBeVisible();
    const tabs = demoDialog(page).getByRole('tablist', { name: 'Demo videos' });
    await expect(tabs.getByRole('tab')).toHaveText(['Commercial1:21', 'Platform walkthrough1:46']);
    await expect(tabs.getByRole('tab', { name: /Commercial/ })).toHaveAttribute('aria-selected', 'true');
    await expectVideo(page, 'en', 'commercial');

    await tabs.getByRole('tab', { name: /Platform walkthrough/ }).click();
    await expect(tabs.getByRole('tab', { name: /Platform walkthrough/ })).toHaveAttribute('aria-selected', 'true');
    await expect(demoDialog(page).getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'lp-demo-tab-walkthrough');
    await expectVideo(page, 'en', 'walkthrough');

    // Close button, and Escape, both close it; it reopens from the workflow section.
    await demoDialog(page).getByRole('button', { name: 'Close video' }).click();
    await expect(demoDialog(page)).toBeHidden();
    await page.locator('#workflow').getByRole('button', { name: 'Watch the demo' }).click();
    await expect(demoDialog(page)).toBeVisible();
    await expect(demoDialog(page).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    await expect(demoDialog(page).getByRole('link', { name: 'Request a demo' })).toHaveAttribute('href', /^mailto:.+\?subject=Request%20a%20demo$/);
    await page.keyboard.press('Escape');
    await expect(demoDialog(page)).toBeHidden();
  });

  test('switching the landing page to Español serves the Spanish demo videos', async ({ page }) => {
    await page.goto('/');
    // Visitor (no session): the toggle only sets the locale cookie for this browser context.
    await page.getByRole('button', { name: 'Switch to Español' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('La plataforma de comunicación para campañas modernas.');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    await page.locator('.lp-hero').getByRole('button', { name: 'Ver la demostración' }).click();
    await expect(demoDialog(page)).toBeVisible();
    const tabs = demoDialog(page).getByRole('tablist', { name: 'Videos de demostración' });
    await expect(tabs.getByRole('tab')).toHaveText(['Comercial1:29', 'Recorrido por la plataforma1:46']);
    await expectVideo(page, 'es', 'commercial');
    await tabs.getByRole('tab', { name: /Recorrido por la plataforma/ }).click();
    await expectVideo(page, 'es', 'walkthrough');
    await demoDialog(page).getByRole('button', { name: 'Cerrar video' }).click();
    await expect(demoDialog(page)).toBeHidden();

    // Persists across reload, and switches back.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await page.getByRole('button', { name: 'Cambiar a English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.lp-hero').getByRole('button', { name: 'Watch the demo' })).toBeVisible();
  });
});

test.describe('setup', () => {
  test('a freshly joined user without a profile is sent to /setup, sees validation errors, then lands on the dashboard', async ({ page, db }) => {
    const t = await createThrowawayCampaign(db, testKey(), { profile: false });
    try {
      const code = `T17-SETUP-${t.key.slice(-8)}`.toUpperCase();
      await must(db.from('invite_codes').insert({
        code, campaign_id: t.campaignId, role: 'manager', created_by: t.owner.id,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }));

      // Join with the invite in a clean context.
      await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': isolatedIp() });
      await page.goto(`/join?code=${code}`);
      await page.getByLabel('Full name').fill('Setup Joiner');
      await page.getByLabel('Email').fill(`${t.campaignId}-setup@e2e.test`);
      await page.getByLabel('Password').fill(THROWAWAY_PASSWORD);
      await page.getByRole('button', { name: 'Create account' }).click();

      // No candidate profile yet → onboarding.
      await expect(page).toHaveURL(/\/setup$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Set up your campaign' })).toBeVisible();
      await page.goto('/content');
      await expect(page).toHaveURL(/\/setup$/);

      const field = (name: string | RegExp) => page.getByRole('textbox', { name, exact: typeof name === 'string' });
      // Whitespace passes the browser's `required` but not the server's trim; ftp:// passes type=url but not http(s).
      await field('Full name').fill('   ');
      await field('Preferred name').fill('Sam');
      await field('Running for').fill('Mayor');
      await field('District / jurisdiction').fill('Springfield');
      await page.getByRole('combobox', { name: 'Party' }).selectOption('Independent');
      await field(/^Candidate photo URL/).fill('ftp://photos.e2e.test/sam.jpg');
      await field('Campaign tagline').fill('Sam for Springfield');
      await page.getByRole('textbox', { name: 'Key policy positions' }).fill('Parks\nTransit');
      await page.getByRole('radio', { name: /Inspirational/ }).check();
      await page.getByRole('button', { name: 'Continue to plan' }).click();

      await expect(page.getByRole('alert').filter({ hasText: 'Check the highlighted fields' })).toContainText('A few details are missing or invalid.');
      await expect(field('Full name')).toHaveAttribute('aria-invalid', 'true');
      await expect(field('Full name')).toHaveAccessibleDescription('This field is required.');
      await expect(field(/^Candidate photo URL/)).toHaveAccessibleDescription('Enter a valid http(s) URL.');
      // Typed values survive the failed submit.
      await expect(field('Campaign tagline')).toHaveValue('Sam for Springfield');
      await expect(page.getByRole('combobox', { name: 'Party' })).toHaveValue('Independent');
      await expect(page.getByRole('radio', { name: /Inspirational/ })).toBeChecked();
      expect((await db.from('candidate_profiles').select('id').eq('campaign_id', t.campaignId)).data).toEqual([]);

      await field('Full name').fill('Sam Setup');
      await field(/^Candidate photo URL/).fill('https://photos.e2e.test/sam.jpg');
      await page.getByRole('button', { name: 'Continue to plan' }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      const { data } = await db.from('candidate_profiles')
        .select('full_name, preferred_name, office, district, party, tagline, key_positions, voice_tone, photo_url')
        .eq('campaign_id', t.campaignId).single();
      expect(data).toEqual({
        full_name: 'Sam Setup', preferred_name: 'Sam', office: 'Mayor', district: 'Springfield', party: 'Independent',
        tagline: 'Sam for Springfield', key_positions: ['Parks', 'Transit'], voice_tone: 'inspirational',
        photo_url: 'https://photos.e2e.test/sam.jpg',
      });
      // Setup is one-time: /setup now bounces to the dashboard.
      await page.goto('/setup');
      await expect(page).toHaveURL(/\/dashboard$/);
    } finally {
      await deleteThrowawayCampaign(db, t.campaignId);
    }
  });
});
