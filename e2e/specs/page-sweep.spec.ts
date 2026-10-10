import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures';
import { CONTENT, type SeedRole } from '../helpers/users';

// Page guards (src/app/<page>/page.tsx): every campaign page uses requireSession()
// only; billing / channels / team / settings / avatars render read-only views for
// roles without edit rights (hidden controls are covered by permissions.spec).
// So all four campaign roles may reach them. Admin pages use requireAdmin().
const ALL: SeedRole[] = ['owner', 'manager', 'approver', 'staff'];
const PAGES: Record<string, SeedRole[]> = {
  '/dashboard': ALL, '/content': ALL, '/content/new': ALL, '/avatars': ALL,
  '/billing': ALL, '/channels': ALL, '/monitoring': ALL, '/analytics': ALL,
  '/settings': ALL, '/team': ALL,
  [`/content/${CONTENT.published}`]: ALL,
  '/admin': ['admin'], '/admin/users': ['admin'], '/admin/campaigns': ['admin'], '/admin/content': ['admin'],
  '/admin/billing': ['admin'], '/admin/audit': ['admin'], '/admin/campaigns/e2e-camp-a': ['admin'],
};

// Known axe findings (docs/e2e/findings/task-18.md): path -> rule id + finding. Only that single
// rule is excluded from the main sweep; a separate test.fail test per rule asserts its absence.
const AXE_KNOWN: Record<string, { rule: string; id: string }> = {
  '/channels': { rule: 'aria-progressbar-name', id: 'E2E-013: /channels progress bar (role=progressbar) has no accessible name' },
  'out:/': { rule: 'color-contrast', id: 'E2E-014: landing page has color-contrast violations' },
};
// Only at phone width: the admin campaign table overflows into a scroll container.
const AXE_KNOWN_MOBILE: Record<string, { rule: string; id: string }> = {
  '/admin/campaigns/e2e-camp-a': { rule: 'scrollable-region-focusable', id: 'E2E-015: admin campaign detail scrollable table is not keyboard-focusable on mobile' },
};

type P = import('@playwright/test').Page;
async function seriousAxe(page: P, excludeRule?: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return r.violations
    .filter((v) => (v.impact === 'serious' || v.impact === 'critical') && v.id !== excludeRule)
    .map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

async function sweep(page: P, path: string, known?: { rule: string }) {
  const res = await page.goto(path);
  expect(res?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[/.]/g, '\\$&')}(\\?.*)?$`));
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, 'horizontal overflow').toBe(false);
  expect(await seriousAxe(page, known?.rule), `axe on ${page.url()}`).toEqual([]);
}

for (const [path, roles] of Object.entries(PAGES)) {
  for (const role of roles) {
    test(`${path} as ${role}`, async ({ asRole }) => {
      const mobile = test.info().project.name === 'mobile';
      await sweep(await asRole(role), path, AXE_KNOWN[path] ?? (mobile ? AXE_KNOWN_MOBILE[path] : undefined));
    });
  }
}

test('/admin/campaigns/e2e-camp-a on mobile: scrollable region is keyboard-focusable', async ({ asRole }) => {
  test.skip(test.info().project.name !== 'mobile', 'violation only occurs at phone width');
  const known = AXE_KNOWN_MOBILE['/admin/campaigns/e2e-camp-a'];
  test.fail(true, known.id);
  const page = await asRole('admin');
  await page.goto('/admin/campaigns/e2e-camp-a');
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.id === known.rule)).toEqual([]);
});

for (const role of ALL) {
  test(`/channels as ${role}: progressbar has an accessible name`, async ({ asRole }) => {
    test.fail(true, AXE_KNOWN['/channels'].id);
    const page = await asRole(role);
    await page.goto('/channels');
    await expect(page.locator('main, [role="main"]').first()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.id === AXE_KNOWN['/channels'].rule)).toEqual([]);
  });
}

test.describe('logged out', () => {
  for (const path of ['/', '/login', '/join']) {
    test(`${path} renders`, async ({ page }) => {
      const known = AXE_KNOWN[`out:${path}`];
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, 'horizontal overflow').toBe(false);
      expect(await seriousAxe(page, known?.rule), `axe on ${page.url()}`).toEqual([]);
    });
  }

  test('/ has sufficient colour contrast', async ({ page }) => {
    test.fail(true, AXE_KNOWN['out:/'].id);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.id === AXE_KNOWN['out:/'].rule)).toEqual([]);
  });

  for (const path of ['/', '/login', '/join']) {
    test(`${path} has a main landmark`, async ({ page }) => {
      test.fail(true, 'E2E-012: public pages (/, /login, /join) have no <main> landmark');
      await page.goto(path);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 3_000 });
    });
  }

  // /pricing requires a session (known): logged-out visitors are sent to /login.
  test('/pricing redirects to /login', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

const ADMIN_PATHS = Object.keys(PAGES).filter((p) => p.startsWith('/admin'));
test('non-admin roles are bounced from every /admin page to their dashboard', async ({ asRole }) => {
  for (const role of ALL) {
    const page = await asRole(role);
    for (const path of ADMIN_PATHS) {
      await page.goto(path);
      await expect(page, `${role} on ${path}`).toHaveURL(/\/dashboard$/);
    }
  }
});

// Lower roles reach the pages above but get read-only views (notice text from en.json);
// owners/managers get the editable view (no notice).
const READ_ONLY_NOTICE: Record<string, string> = {
  '/settings': 'Only campaign owners and managers can change these settings.',
  '/billing': 'Only campaign owners and managers can change the plan or payment details.',
  '/channels': 'Only owners and managers can change connections.',
  '/team': 'Only campaign owners and managers can invite teammates or change roles.',
};
for (const [path, notice] of Object.entries(READ_ONLY_NOTICE)) {
  for (const role of ALL) {
    const lower = role === 'approver' || role === 'staff';
    test(`${path} is ${lower ? 'read-only' : 'editable'} for ${role}`, async ({ asRole }) => {
      const page = await asRole(role);
      await page.goto(path);
      const n = page.getByText(notice);
      if (lower) await expect(n).toBeVisible();
      else await expect(n).toHaveCount(0);
    });
  }
}
