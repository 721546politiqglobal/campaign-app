import { test, expect } from '../fixtures';
import { ingest } from '../helpers/api';
import { CAMPAIGN_A } from '../helpers/users';

// AI triage (mock triager in E2E: a story naming our candidate is an "attack")
// and the rebuttal flow from a monitored story into the content editor.

const testKey = () => test.info().testId.split('-').pop()!;
const must = async (q: PromiseLike<{ error: { message: string } | null }>) => {
  const { error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
};
const card = (page: import('@playwright/test').Page, text: string) =>
  page.getByRole('listitem').filter({ hasText: text });

test('a story attacking our candidate is flagged with a reason, and the response options carry the story into the editor', async ({ asRole, request, db }) => {
  const key = `${testKey()}-${Date.now().toString(36)}`;
  // Seeded campaign A: candidate "Olivia Example", opponent "Pat Opponent".
  const story = {
    campaign_id: CAMPAIGN_A, source: 'NewsData', opponent: 'Pat Opponent',
    excerpt: `E2E-TRIAGE-${key} Pat Opponent says Olivia Example voted against transit funding`,
    url: `https://apnews.com/e2e/triage-${key}`,
  };
  try {
    const res = await ingest(request, story);
    expect(res.ok(), await res.text()).toBeTruthy();
    const { data } = await db.from('monitoring_results').select('triage_level, triage_reason').eq('campaign_id', CAMPAIGN_A).eq('url', story.url).single();
    expect(data).toMatchObject({ triage_level: 'attack', triage_reason: 'Mentions our candidate directly.' });

    const page = await asRole('owner');
    await page.goto('/monitoring');
    const c = card(page, story.excerpt);
    await expect(c.getByText('Attack on candidate')).toBeVisible();
    await expect(c.getByText('Why it matters:')).toBeVisible();
    await expect(c.getByText('Mentions our candidate directly.')).toBeVisible();

    // Priority-only filter keeps it.
    await page.getByRole('button', { name: 'Priority only' }).click();
    await expect(c).toBeVisible();

    // "Talking points" opens the editor with the story attached (loaded server-side by id).
    await c.getByRole('link', { name: 'Talking points' }).click();
    await expect(page).toHaveURL(/\/content\/new\?.*respondTo=/);
    await expect(page.getByText('Responding to AP News')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the story' })).toHaveAttribute('href', story.url);
    await expect(page.getByRole('radio', { name: 'Talking points' })).toBeChecked();

    await page.getByRole('button', { name: /generate/i }).first().click();
    // Mock generator marks rebuttal drafts so we can see the context reached it.
    await expect(page.locator('textarea').filter({ hasText: 'Responding to AP News' })).toBeVisible({ timeout: 20_000 });
  } finally {
    await must(db.from('monitoring_results').delete().eq('campaign_id', CAMPAIGN_A).eq('url', story.url));
  }
});

test("a story id from another campaign can't be used to draft a rebuttal", async ({ asRole, db }) => {
  const { data: other } = await db.from('monitoring_results').select('id').eq('campaign_id', 'e2e-camp-b').limit(1).single();
  expect(other?.id).toBeTruthy();
  const page = await asRole('owner');
  await page.goto(`/content/new?respondTo=${other!.id}&type=social_post&brief=x`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/Responding to/)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('B-ONLY-');
});
