import { test, expect } from '../fixtures';

test('server is wired to the e2e test database', async ({ asRole }) => {
  const page = await asRole('owner');
  await page.goto('/dashboard');
  // Campaign name exists only in e2e/seed.e2e.sql.
  await expect(page.getByText(/E2E Campaign A/).first()).toBeVisible();
});

test('vendors are mocked (AI draft returns the mock generator output)', async ({ asRole }) => {
  const page = await asRole('owner');
  await page.goto('/content/new');
  await page.getByLabel('What should this say?').fill('Write a post about the e2e canary park cleanup');
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  // Sentence produced only by MockContentGenerator (src/integrations/index.ts);
  // a real LLM would never echo it verbatim.
  await expect(page.getByLabel('Body')).toHaveValue(
    /We'll keep costs down, protect what works, and fix what doesn't\./,
  );
  await expect(page.getByLabel('Title')).toHaveValue('Post about the e2e canary park cleanup');
});
