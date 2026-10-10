import type { SupabaseClient } from '@supabase/supabase-js';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, allowConsole } from '../fixtures';
import { ingest } from '../helpers/api';
import { createSecondTenant } from '../helpers/second-tenant';
import { CAMPAIGN_A } from '../helpers/users';
import { createThrowawayCampaign, deleteThrowawayCampaign, uiLogin } from '../helpers/throwaway-campaign';

const testKey = () => test.info().testId.split('-').pop()!;
const must = async (q: PromiseLike<{ error: { message: string } | null }>) => {
  const { error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
};

// Ingests a throwaway story for campaign A (unique url/excerpt per test) and
// returns it with a cleanup that deletes the row.
async function throwaway(request: APIRequestContext, db: SupabaseClient, tag: string) {
  const key = `${testKey()}-${tag}`;
  const item = {
    campaign_id: CAMPAIGN_A, source: `E2E Wire ${key}`, opponent: 'Pat Opponent',
    excerpt: `E2E-MON-${key} throwaway story`, url: `https://news.e2e.test/mon/${key}`,
  };
  const res = await ingest(request, item);
  expect(res.ok(), await res.text()).toBeTruthy();
  return {
    ...item,
    cleanup: () => must(db.from('monitoring_results').delete().eq('campaign_id', CAMPAIGN_A).eq('url', item.url)),
  };
}
const card = (page: import('@playwright/test').Page, text: string) =>
  page.getByRole('listitem').filter({ hasText: text });

test.describe('feed rendering', () => {
  test('seeded results render with credibility and category indicators', async ({ asRole }) => {
    const page = await asRole('owner');
    await page.goto('/monitoring');
    await expect(page.getByRole('heading', { level: 1, name: 'Opponent monitoring' })).toBeVisible();

    const high = card(page, 'announced a new transit position');
    await expect(high.getByText('High credibility')).toBeVisible();
    await expect(high.getByText('News', { exact: true })).toBeVisible();
    await expect(high.getByText('NewsData')).toBeVisible();
    await expect(high.getByRole('link', { name: 'Read article' })).toHaveAttribute('href', 'https://news.e2e.test/a/transit');

    const low = card(page, 'Opinion blog discusses Pat Opponent water policy');
    await expect(low.getByText('Low credibility')).toBeVisible();
    await expect(low.getByText('Blog', { exact: true })).toBeVisible();
    await expect(card(page, 'Local coverage compares the two candidates').getByText('Medium credibility')).toBeVisible();

    await expect(page.getByText(/\d+ stor(y|ies)/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('B-ONLY-');
  });
});

test.describe('dismiss and restore', () => {
  test('dismiss removes the story (persisted); undo brings it back', async ({ asRole, request, db }) => {
    const item = await throwaway(request, db, 'dismiss');
    try {
      const page = await asRole('owner');
      await page.goto('/monitoring');
      const c = card(page, item.excerpt);
      await expect(c).toBeVisible();

      await c.getByRole('button', { name: 'Dismiss' }).click();
      await expect(c).toHaveCount(0);
      await expect(page.getByText('Story dismissed.')).toBeVisible();
      await expect.poll(async () => {
        const { data } = await db.from('monitoring_results').select('dismissed_at').eq('campaign_id', CAMPAIGN_A).eq('url', item.url).single();
        return data?.dismissed_at ?? null;
      }).not.toBeNull();

      await page.reload();
      await expect(page.getByText('Opponent monitoring').first()).toBeVisible();
      await expect(card(page, item.excerpt)).toHaveCount(0);

      // Undo is on the toast shown right after dismissing; dismiss again to get one.
      await must(db.from('monitoring_results').update({ dismissed_at: null }).eq('campaign_id', CAMPAIGN_A).eq('url', item.url));
      await page.reload();
      await card(page, item.excerpt).getByRole('button', { name: 'Dismiss' }).click();
      await expect(card(page, item.excerpt)).toHaveCount(0);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText('Story restored.')).toBeVisible();
      await expect(card(page, item.excerpt)).toBeVisible();
      await expect.poll(async () => {
        const { data } = await db.from('monitoring_results').select('dismissed_at').eq('campaign_id', CAMPAIGN_A).eq('url', item.url).single();
        return data?.dismissed_at ?? null;
      }).toBeNull();
      await page.reload();
      await expect(card(page, item.excerpt)).toBeVisible();
    } finally {
      await item.cleanup();
    }
  });

  test('staff can view the feed and dismiss (no role gate in dismissMonitoringAction)', async ({ asRole, request, db }) => {
    const item = await throwaway(request, db, 'staff');
    try {
      const page = await asRole('staff');
      await page.goto('/monitoring');
      const c = card(page, item.excerpt);
      await expect(c).toBeVisible();
      await expect(c.getByText(/credibility/)).toBeVisible();
      await c.getByRole('button', { name: 'Dismiss' }).click();
      await expect(c).toHaveCount(0);
      await expect.poll(async () => {
        const { data } = await db.from('monitoring_results').select('dismissed_at').eq('campaign_id', CAMPAIGN_A).eq('url', item.url).single();
        return data?.dismissed_at ?? null;
      }).not.toBeNull();
    } finally {
      await item.cleanup();
    }
  });

  test('ingested story shows in A and never in a second subscribed tenant (and vice versa)', async ({ asRole, request, db, page }) => {
    const item = await throwaway(request, db, 'tenant');
    const t2 = await createSecondTenant(db, testKey());
    try {
      const own = `E2E-MON-T2-${testKey()} second tenant story`;
      const res = await ingest(request, { campaign_id: t2.campaignId, source: 'E2E Wire', excerpt: own, url: `https://news.e2e.test/mon/t2-${testKey()}` });
      expect(res.ok()).toBeTruthy();

      const a = await asRole('owner');
      await a.goto('/monitoring');
      await expect(card(a, item.excerpt)).toBeVisible();
      await expect(a.locator('body')).not.toContainText(own);
      await expect(a.locator('body')).not.toContainText('B-ONLY-');

      await t2.login(page);
      await page.goto('/monitoring');
      await expect(card(page, own)).toBeVisible();
      await expect(page.locator('body')).not.toContainText(item.excerpt);
      await expect(page.locator('body')).not.toContainText('Pat Opponent');
    } finally {
      try { await t2.cleanup(); } finally { await item.cleanup(); }
    }
  });
});

test.describe('add form', () => {
  test('valid add appears in the feed', async ({ asRole, db }) => {
    const key = testKey();
    const headline = `E2E-MON-manual-${key} flyer claims`;
    const url = `https://news.e2e.test/manual/${key}`;
    try {
      const page = await asRole('owner');
      await page.goto('/monitoring');
      await page.getByLabel('Headline / description').fill(headline);
      await page.getByLabel('Source name').fill(`E2E Flyer ${key}`);
      await page.getByLabel(/^URL/).fill(url);
      await page.getByRole('button', { name: 'Add to monitoring' }).click();
      await expect(page.getByText('Story added to monitoring.')).toBeVisible();
      await expect(card(page, headline)).toBeVisible();
      await expect(card(page, headline).getByText(/credibility/)).toBeVisible();
      await expect(page.getByLabel('Headline / description')).toHaveValue('');
    } finally {
      await must(db.from('monitoring_results').delete().eq('campaign_id', CAMPAIGN_A).eq('url', url));
    }
  });

  test('empty and invalid input show validation errors and nothing is saved', async ({ asRole, db }) => {
    const key = testKey();
    const page = await asRole('owner');
    await page.goto('/monitoring');
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add to monitoring' }) });
    // `required` fields are enforced by the browser first; bypass so the server validation (src/app/monitoring/validation.ts) is exercised.
    await form.evaluate((f) => { (f as HTMLFormElement).noValidate = true; });

    await page.getByRole('button', { name: 'Add to monitoring' }).click();
    await expect(page.getByText('Add a headline or short description.')).toBeVisible();
    await expect(page.getByText('Add a source name.')).toBeVisible();

    await page.getByLabel('Headline / description').fill(`E2E-MON-bad-${key}`);
    await page.getByLabel('Source name').fill(`E2E Bad ${key}`);
    await page.getByLabel(/^URL/).fill('not a url');
    await page.getByRole('button', { name: 'Add to monitoring' }).click();
    await expect(page.getByText('Enter a full URL starting with http:// or https://.')).toBeVisible();
    // typed values are kept
    await expect(page.getByLabel('Headline / description')).toHaveValue(`E2E-MON-bad-${key}`);
    await expect(page.getByLabel(/^URL/)).toHaveValue('not a url');

    const { data, error } = await db.from('monitoring_results').select('id').eq('campaign_id', CAMPAIGN_A).like('excerpt', `E2E-MON-bad-${key}%`);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

test.describe('opponent config and dashboard', () => {
  test('opponent aliases/keywords edit persists after reload', async ({ page, db }) => {
    // The /settings save writes the whole candidate profile, so it runs on a
    // private campaign: editing seeded campaign A here would race other specs.
    const key = testKey();
    const t = await createThrowawayCampaign(db, key, { suffix: 'mon' });
    const aliases = `Opp Alias ${key}`;
    const keywords = `kw-${key}`;
    try {
      await uiLogin(page, t.owner.email);
      await page.goto('/settings');
      await page.getByLabel('Opponent aliases (comma-separated)').fill(aliases);
      await page.getByLabel('Extra keywords to track (comma-separated)').fill(keywords);
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.getByText('Profile saved.')).toBeVisible();

      await page.reload();
      await expect(page.getByLabel('Opponent aliases (comma-separated)')).toHaveValue(aliases);
      await expect(page.getByLabel('Extra keywords to track (comma-separated)')).toHaveValue(keywords);
      const { data: after, error } = await db.from('candidate_profiles')
        .select('opponent_aliases, monitoring_keywords').eq('campaign_id', t.campaignId).single();
      expect(error).toBeNull();
      expect(after?.opponent_aliases).toEqual([aliases]);
      expect(after?.monitoring_keywords).toEqual([keywords]);
    } finally {
      await deleteThrowawayCampaign(db, t.campaignId);
    }
  });

  test('dashboard Opponent pulse shows the top monitoring items for the campaign', async ({ asRole, db }) => {
    // The poll reloads the page, aborting in-flight link prefetches (client-side noise only).
    allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/\S+\. Falling back to browser navigation/);
    const page = await asRole('owner');
    await page.goto('/dashboard');
    const pulse = page.getByRole('region', { name: 'Opponent pulse' });
    await expect(pulse).toBeVisible();
    await expect(pulse.getByText('LIVE')).toBeVisible();
    // Concurrent specs ingest campaign A rows, so re-read both the page and the
    // DB's current top 4 on every attempt instead of trusting one snapshot.
    await expect.poll(async () => {
      await page.reload();
      const shown = await pulse.locator('.dash-pulse-excerpt').allInnerTexts();
      const { data } = await db.from('monitoring_results').select('excerpt')
        .eq('campaign_id', CAMPAIGN_A).is('dismissed_at', null).order('captured_at', { ascending: false }).limit(4);
      return JSON.stringify(shown) === JSON.stringify((data ?? []).map((r) => r.excerpt.replace(/\s+/g, ' ')));
    }, { timeout: 20_000 }).toBe(true);
    expect(await pulse.locator('.dash-pulse-item').count()).toBeGreaterThan(0);
    await expect(pulse).not.toContainText('B-ONLY-');
    await pulse.getByRole('link', { name: /See full feed/ }).click();
    await expect(page).toHaveURL(/\/monitoring$/);
  });
});
