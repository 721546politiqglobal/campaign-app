import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { E2E_ENV, BASE_URL, assertTestProject } from './env';
import type { SeedRole } from './helpers/users';
import enMessages from '../src/messages/en.json';

type Guard = { errors: string[]; allow: RegExp[] };

function attachGuard(page: Page, guard: Guard) {
  page.on('console', (m) => { if (m.type() === 'error') guard.errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => guard.errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().startsWith(BASE_URL) && r.status() >= 500) guard.errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
}

// next-intl renders a missing message as its full dotted path, e.g.
// "content.editor.saveDraft". Tuned to avoid false positives on real content
// (hostnames like "news.e2e.test", file names, "v1.2"): a line is only flagged
// when it is *entirely* a dotted path whose first segment is one of the
// top-level namespaces in src/messages/en.json.
const NAMESPACES = Object.keys(enMessages).join('|');
const RAW_KEY_LINE = new RegExp(`^(?:${NAMESPACES})(?:\\.[a-zA-Z0-9_]+){1,6}$`);

async function assertNoMissingTranslations(page: Page) {
  if (page.isClosed()) return;
  const text = await page.locator('body').innerText().catch(() => '');
  const bad = text.split('\n').map((l) => l.trim()).filter((l) => RAW_KEY_LINE.test(l));
  expect(bad, `raw translation keys on ${page.url()}`).toEqual([]);
}

let currentAllow: RegExp[] = [];
/** Allow-list a console error / 5xx (matched against the guard's message) for the current test only. */
export function allowConsole(re: RegExp) { currentAllow.push(re); }

type Fixtures = {
  asRole: (role: SeedRole) => Promise<Page>;
  db: SupabaseClient;
  axeCheck: (page: Page) => Promise<void>;
  _guard: Guard;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  _guard: async ({}, use) => {
    currentAllow = [];
    const g: Guard = { errors: [], allow: currentAllow };
    await use(g);
    const real = g.errors.filter((e) => !g.allow.some((re) => re.test(e)));
    expect(real, 'console errors / 5xx during test').toEqual([]);
  },
  page: async ({ page, _guard }, use) => {
    attachGuard(page, _guard);
    await use(page);
    await assertNoMissingTranslations(page);
  },
  asRole: async ({ browser, _guard }, use) => {
    const ctxs: BrowserContext[] = [];
    const pages: Page[] = [];
    await use(async (role) => {
      const ctx = await browser.newContext({ storageState: `e2e/.auth/${role}.json`, baseURL: BASE_URL });
      ctxs.push(ctx);
      const p = await ctx.newPage();
      attachGuard(p, _guard);
      pages.push(p);
      return p;
    });
    try {
      for (const p of pages) await assertNoMissingTranslations(p);
    } finally {
      for (const c of ctxs) await c.close();
    }
  },
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    await use(createClient(assertTestProject(E2E_ENV.NEXT_PUBLIC_SUPABASE_URL), E2E_ENV.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }));
  },
  // eslint-disable-next-line no-empty-pattern
  axeCheck: async ({}, use) => {
    await use(async (page) => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`), `axe on ${page.url()}`).toEqual([]);
    });
  },
});
export { expect };
