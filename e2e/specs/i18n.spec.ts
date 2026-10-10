import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect, allowConsole } from '../fixtures';
import { CAMPAIGN_A, USERS } from '../helpers/users';
import { createSecondTenant } from '../helpers/second-tenant';
import es from '../../src/messages/es.json';

const testKey = () => test.info().testId.split('-').pop()!;

async function removeContent(db: SupabaseClient, id: string) {
  const { error } = await db.from('content_items').delete().eq('id', id);
  expect(error, `cleanup content_items ${id}`).toBeNull();
}

// ── Every authenticated page renders Spanish for a Spanish user ──────────────
const ES_PAGES: { path: string; h1: string }[] = [
  { path: '/dashboard', h1: es.dashboard.today },
  { path: '/content', h1: es.content.pageTitle },
  { path: '/content/new', h1: es.content.newContent },
  { path: '/avatars', h1: es.avatars.title },
  { path: '/monitoring', h1: es.monitoring.title },
  { path: '/analytics', h1: es.analytics.pageTitle },
  { path: '/settings', h1: es.settings.title },
  { path: '/channels', h1: es.channels.title },
  { path: '/billing', h1: es.billing.title },
  { path: '/team', h1: es.team.title },
];

test.describe('Spanish user (staffEs)', () => {
  for (const { path, h1 } of ES_PAGES) {
    test(`${path} is Spanish`, async ({ asRole }) => {
      const page = await asRole('staffEs');
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.getByRole('heading', { level: 1, name: h1, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: es.common.nav.content, exact: true }).first()).toBeVisible();
    });
  }

  test('content detail is Spanish', async ({ asRole, db }) => {
    const id = `e2e-i18n-detail-${testKey()}`;
    const { error } = await db.from('content_items').insert({
      id, campaign_id: CAMPAIGN_A, type: 'social_post', title: `i18n detail ${testKey()}`, body: 'Cuerpo de prueba.',
      status: 'draft', is_ai_generated: true, target_jurisdictions: ['US-FEDERAL'], created_by: USERS.staffEs.id,
      platforms: ['x'], locale: 'es',
    });
    expect(error).toBeNull();
    try {
      const page = await asRole('staffEs');
      await page.goto(`/content/${id}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await expect(page.getByRole('button', { name: es.contentWizard.review.submitForReview })).toBeVisible();
    } finally { await removeContent(db, id); }
  });
});

// ── Pre-auth language toggle ─────────────────────────────────────────────────
const TO_ES = 'Switch to Español';
const TO_EN = 'Cambiar a English';

for (const path of ['/', '/login', '/join']) {
  test(`pre-auth toggle on ${path} switches language and persists in the cookie`, async ({ page, context }) => {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: TO_ES }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('button', { name: TO_EN })).toBeVisible();
    expect((await context.cookies()).find((c) => c.name === 'locale')?.value).toBe('es');

    await page.reload();                                   // persists across navigation
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: es.login.welcomeBack })).toBeVisible();

    await page.getByRole('button', { name: TO_EN }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect((await context.cookies()).find((c) => c.name === 'locale')?.value).toBe('en');
  });
}

// Intentional behaviour (src/app/locale-actions.ts): the toggle stays on the public pages for
// signed-in visitors and the choice is saved to their account. Uses a throwaway tenant owner.
test('signed-in toggle persists the choice to the account', async ({ page, db }) => {
  // Prefetches aborted by the deliberate full navigations below are not app errors.
  allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/\S+\. Falling back to browser navigation/);
  const tenant = await createSecondTenant(db, testKey());
  const userId = tenant.owner.id;
  try {
    await tenant.login(page);
    await page.goto('/login');
    await page.getByRole('button', { name: TO_ES }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect.poll(async () => (await db.from('users').select('locale').eq('id', userId).single()).data?.locale).toBe('es');
    await page.goto('/dashboard');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  } finally {
    await tenant.cleanup();
  }
});

test('toggle is not offered inside the signed-in app shell', async ({ asRole }) => {
  const page = await asRole('owner');
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: /^(Switch to Español|Cambiar a English)$/ })).toHaveCount(0);
});

// ── Spanish happy path ───────────────────────────────────────────────────────
async function openEditorAsEs(page: Page) {
  await page.goto('/content/new');
  await page.getByRole('button', { name: es.content.editor.writeItMyself }).click();
}

test('Spanish: create a draft, submit it, and the approver (en) sees it', async ({ asRole, db }) => {
  const title = `Borrador e2e ${testKey()}`;
  const page = await asRole('staffEs');
  await page.goto('/content/new');
  // The language is captured when the draft is created, so pick it first.
  await page.getByLabel(es.content.editor.language).selectOption('es');
  await page.getByRole('button', { name: es.content.editor.writeItMyself }).click();
  await page.getByLabel(es.content.titleLabel).fill(title);
  await page.getByLabel(es.content.editor.bodyLabel).fill('Cuerpo del borrador en español.');
  await page.getByRole('button', { name: es.content.editor.saveDraft }).click();
  let id: string | undefined;
  try {
    await page.waitForURL(/\/content\/(?!new)[^/?]+$/);
    id = page.url().split('/').pop()!;
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await page.getByRole('button', { name: es.contentWizard.review.submitForReview }).click();
    await expect(page.getByText(es.contentWizard.review.submittedToast).first()).toBeVisible();

    const { data, error } = await db.from('content_items').select('status, locale').eq('id', id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ status: 'in_review', locale: 'es' });

    const approver = await asRole('approver');
    await approver.goto(`/content/${id}`);
    await expect(approver.locator('html')).toHaveAttribute('lang', 'en');
    await expect(approver.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(approver.getByText('In review').first()).toBeVisible();
    await expect(approver.getByText('Cuerpo del borrador en español.').first()).toBeVisible();
    await approver.goto('/content?status=in_review');
    await expect(approver.getByText(title).first()).toBeVisible();
  } finally {
    if (id) await removeContent(db, id);
    else {
      // Draft may exist even if the redirect never happened: delete by title.
      const { error } = await db.from('content_items').delete().eq('title', title);
      expect(error, 'cleanup content_items by title').toBeNull();
    }
  }
});

test('Spanish: server-action validation errors are Spanish', async ({ asRole, db }) => {
  const key = testKey();
  const page = await asRole('staffEs');
  await openEditorAsEs(page);
  await page.getByLabel(es.content.titleLabel).fill(`Validación ${key}`);
  // Whitespace passes the browser's `required`, but the server trims it to empty.
  await page.getByLabel(es.content.editor.bodyLabel).fill('   ');
  await page.getByRole('button', { name: es.content.editor.saveDraft }).click();
  await expect(page.getByRole('alert').filter({ hasText: es.errors.actions.contentBodyRequired })).toBeVisible();
  await expect(page).toHaveURL(/\/content\/new/);
  const { data, error } = await db.from('content_items').select('id').eq('title', `Validación ${key}`);
  expect(error).toBeNull();
  expect(data).toEqual([]);
});

test('approver sees a locale badge on Spanish content', async ({ asRole, db }) => {
  const id = `e2e-i18n-badge-${testKey()}`;
  const title = `Badge ${testKey()}`;
  const { error } = await db.from('content_items').insert({
    id, campaign_id: CAMPAIGN_A, type: 'social_post', title, body: 'Cuerpo.', status: 'in_review',
    is_ai_generated: true, target_jurisdictions: ['US-FEDERAL'], created_by: USERS.staffEs.id, platforms: ['x'], locale: 'es',
  });
  expect(error).toBeNull();
  try {
    const approver = await asRole('approver');
    await approver.goto(`/content/${id}`);
    await expect(approver.getByRole('heading', { name: title, level: 1 })).toBeVisible(); // the item really loaded
    // Declared after setup, so a setup failure is a real failure, not the expected one.
    test.fail(true, 'E2E-010: content language is stored but never shown to reviewers');
    await expect(approver.locator('main').getByText(/^(ES|Spanish|Español)$/).first()).toBeVisible({ timeout: 3_000 });
  } finally { await removeContent(db, id); }
});

// ── Date / number formatting ─────────────────────────────────────────────────
test('scheduled item shows a Spanish date', async ({ asRole, db }) => {
  const id = `e2e-i18n-sched-${testKey()}`;
  const { error } = await db.from('content_items').insert({
    id, campaign_id: CAMPAIGN_A, type: 'social_post', title: `Programado ${testKey()}`, body: 'Cuerpo.', status: 'scheduled',
    is_ai_generated: true, target_jurisdictions: ['US-FEDERAL'], created_by: USERS.staffEs.id, platforms: ['x'],
    scheduled_at: '2027-03-15T15:00:00Z', timezone: 'America/New_York',
  });
  expect(error).toBeNull();
  try {
    const page = await asRole('staffEs');
    await page.goto(`/content/${id}`);
    await expect(page.getByText(/lunes,? 15 de marzo de 2027/)).toBeVisible();
    await expect(page.getByText(/March|Monday/)).toHaveCount(0);
  } finally { await removeContent(db, id); }
});

test('billing uses Spanish date and currency format; English stays English', async ({ asRole }) => {
  const esPage = await asRole('staffEs');
  await esPage.goto('/billing');
  await expect(esPage.getByText(/Se renueva el \d{1,2} de [a-záéíóú]+ de \d{4}/)).toBeVisible();
  await expect(esPage.getByText(/499,00\s*US\$/)).toBeVisible();

  const enPage = await asRole('owner');
  await enPage.goto('/billing');
  await expect(enPage.getByText(/Renews on [A-Z][a-z]+ \d{1,2}, \d{4}/)).toBeVisible();
  await expect(enPage.getByText('$499.00')).toBeVisible();
});

test('content list dates use Spanish format', async ({ asRole }) => {
  const page = await asRole('staffEs');
  await page.goto('/content');
  const cell = page.locator('td.num').filter({ hasText: /\d{4}/ }).first();
  await expect(cell).toHaveText(/^\d{1,2} [a-z]{3,4}\.? \d{4}$/);
});
