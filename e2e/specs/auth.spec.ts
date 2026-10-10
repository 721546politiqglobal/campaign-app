import type { Page } from '@playwright/test';
import { test, expect, allowConsole } from '../fixtures';
import { BASE_URL } from '../env';
import { USERS, AUTH_ONLY, INVITES, PASSWORD, type SeedRole } from '../helpers/users';

// loginAction throttles on BOTH `ip:<first x-forwarded-for>` and `email:<email>`
// (src/app/actions.ts). Without a header every test shares `ip:unknown`, so a
// few failed logins here would lock out every other spec (and global setup).
// Failing-login tests therefore send a unique X-Forwarded-For per test, which
// gives them a private IP bucket; the email-keyed buckets use dedicated or
// non-seeded addresses.
const MAX_ATTEMPTS = 5; // src/lib/login-throttle.ts

async function isolateIp(page: Page) {
  const n = Math.floor(Math.random() * 250) + 1;
  const ip = `10.${n}.${Date.now() % 250}.${Math.floor(Math.random() * 250) + 1}`;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
  return ip;
}

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
}

/** Fails loudly if a cleanup/setup write errored. */
async function must(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
}

/** Removes a joined/created user (and its audit rows) by email. */
async function deleteUserByEmail(db: import('@supabase/supabase-js').SupabaseClient, email: string) {
  const { data, error } = await db.from('users').select('id').eq('email', email);
  if (error) throw new Error(`user lookup failed: ${error.message}`);
  for (const r of data ?? []) await must(db.from('audit_entries').delete().eq('actor_user_id', r.id));
  await must(db.from('users').delete().eq('email', email));
}

const BAD_CREDS = 'Incorrect email or password.';
const LOCKED = 'Too many attempts. Try again in about 15 minutes.';

test.describe('login', () => {
  for (const role of Object.keys(USERS) as SeedRole[]) {
    test(`login as ${role} lands on its home`, async ({ page }) => {
      await login(page, USERS[role].email);
      const home = USERS[role].role === 'super_admin' ? /\/admin$/ : /\/dashboard$/;
      await expect(page).toHaveURL(home);
    });
  }

  test('wrong password shows error and stays on /login', async ({ page }) => {
    await isolateIp(page);
    await login(page, USERS.staff.email, 'definitely-wrong-pw');
    await expect(page.locator('.alert-bad')).toHaveText(BAD_CREDS);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('input[name="email"]')).toHaveValue(USERS.staff.email);
  });

  test('unknown email shows the same generic error', async ({ page }) => {
    await isolateIp(page);
    await login(page, `nobody-${test.info().testId}@e2e.test`, 'whatever-pw-123');
    await expect(page.locator('.alert-bad')).toHaveText(BAD_CREDS);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('throttle locks out after N failures', async ({ page, db }) => {
    const ip = await isolateIp(page);
    const keys = [`ip:${ip}`, `email:${AUTH_ONLY.throttle.email}`];
    try {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await login(page, AUTH_ONLY.throttle.email, `wrong-pw-${i}`);
        await expect(page.locator('.alert-bad')).toHaveText(BAD_CREDS);
      }
      // Locked: even the correct password is refused.
      await login(page, AUTH_ONLY.throttle.email, PASSWORD);
      await expect(page.locator('.alert-bad')).toHaveText(LOCKED);
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      // Leave no lockout behind (re-runs without a DB reset, other specs).
      await must(db.from('login_attempts').delete().in('key', keys));
    }
  });

  // E2E-005: the IP bucket counts failures across ALL emails, so one shared IP
  // (office NAT) that fails MAX_ATTEMPTS times blocks a different, correct account.
  test('failed logins from a shared IP do not block another account with the right password', async ({ page, db }) => {
    const ip = await isolateIp(page);
    const strangers = Array.from({ length: MAX_ATTEMPTS }, (_, i) => `nobody${i}-${test.info().testId}@e2e.test`);
    const keys = [`ip:${ip}`, `email:${AUTH_ONLY.logout.email}`, ...strangers.map((e) => `email:${e}`)];
    try {
      for (const e of strangers) {
        await login(page, e, 'wrong-pw');
        await expect(page.locator('.alert-bad')).toHaveText(BAD_CREDS);
      }
      // Declared only now, so a setup failure above is a real failure, not the expected one.
      test.fail(true, 'E2E-005: IP-bucket lockout blocks unrelated accounts behind the same IP');
      await login(page, AUTH_ONLY.logout.email, PASSWORD);
      await expect(page).toHaveURL(/\/dashboard$/);
    } finally {
      await must(db.from('login_attempts').delete().in('key', keys));
    }
  });

  test('logout clears the session', async ({ page }) => {
    // Sign-out navigates away while link prefetches (/, /join) are in flight; seen under parallel load.
    allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/\S*\. Falling back to browser navigation/);
    await login(page, AUTH_ONLY.logout.email);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);

    // Back must not resurrect dashboard data.
    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('E2E Campaign A')).toHaveCount(0);
  });

  test('tampered session cookie is rejected', async ({ page, context }) => {
    await login(page, USERS.staff.email);
    await expect(page).toHaveURL(/\/dashboard$/);
    const cookie = (await context.cookies()).find((c) => c.name === 'cc_session');
    expect(cookie, 'cc_session cookie').toBeTruthy();
    const v = cookie!.value;
    const i = Math.floor(v.length / 2);
    const flipped = v.slice(0, i) + (v[i] === 'A' ? 'B' : 'A') + v.slice(i + 1);
    await context.addCookies([{ ...cookie!, value: flipped }]);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('access control', () => {
  test('protected pages redirect when logged out', async ({ page }) => {
    const paths = ['/dashboard', '/content', '/content/new', '/avatars', '/billing', '/channels', '/monitoring',
      '/analytics', '/settings', '/team', '/setup', '/admin', '/admin/users', '/admin/campaigns',
      '/admin/content', '/admin/billing', '/admin/audit'];
    for (const p of paths) {
      await page.goto(p);
      await expect(page, `${p} should redirect to /login`).toHaveURL(/\/login$/);
    }
  });

  // The brief listed /pricing as public, but it is the authenticated plan step.
  test('/pricing requires a session', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('public pages render logged out', async ({ page }) => {
    for (const p of ['/', '/login', '/join']) {
      const res = await page.goto(p);
      expect(res?.status(), `${p} status`).toBeLessThan(400);
      await expect(page, `${p} should not bounce to login`).toHaveURL(new RegExp(`${p === '/' ? '/$' : p + '$'}`));
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });
});

test.describe('join', () => {
  async function fillJoin(page: Page, f: { code?: string; name?: string; email?: string; password?: string }) {
    await page.locator('input[name="code"]').fill(f.code ?? '');
    await page.locator('input[name="name"]').fill(f.name ?? '');
    await page.locator('input[name="email"]').fill(f.email ?? '');
    await page.locator('input[name="password"]').fill(f.password ?? '');
    await page.locator('form button[type="submit"]').click();
  }
  // Skip native browser validation (required/minLength/type=email) to exercise the server checks.
  async function noValidate(page: Page) {
    await page.locator('form.auth-form').evaluate((f) => f.setAttribute('novalidate', ''));
  }

  test('join with valid invite creates account and logs in', async ({ page, db, browser }) => {
    const tid = test.info().testId;
    const email = `join-${tid}@e2e.test`;
    // Private single-use invite (the seeded codes are shared and never consumed here).
    const code = `E2E-JOIN-${tid}`;
    const dropLeftovers = async () => {
      await deleteUserByEmail(db, email);
      await deleteUserByEmail(db, `again-${email}`);
      await must(db.from('invite_codes').delete().eq('code', code));
    };
    await dropLeftovers(); // an aborted earlier run (stable testId-derived ids)
    await must(db.from('invite_codes').insert({ code, campaign_id: 'e2e-camp-a', role: 'staff', created_by: 'e2e-owner-a' }));
    try {
      await page.goto(`/join?code=${code}`);
      await expect(page.getByText('Join your campaign').first()).toBeVisible();
      await fillJoin(page, { code, name: 'Joined Person', email, password: 'join-pass-123' });
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByText('E2E Campaign A').first()).toBeVisible();

      const { data: u } = await db.from('users').select('campaign_id, role, name').eq('email', email).single();
      expect(u).toMatchObject({ campaign_id: 'e2e-camp-a', role: 'staff', name: 'Joined Person' });

      // Same code again -> already used.
      const second = await browser.newContext({ baseURL: BASE_URL });
      try {
        const p2 = await second.newPage();
        await p2.goto(`/join?code=${code}`);
        await expect(p2.getByText('This invite link is invalid or has already been used.')).toBeVisible();
        await p2.goto('/join'); // link now hides the form; type the code in by hand
        await fillJoin(p2, { code, name: 'Second Person', email: `again-${email}`, password: 'join-pass-123' });
        await expect(p2.locator('.alert-bad')).toHaveText('This invite link has already been used.');
        const { data: none } = await db.from('users').select('id').eq('email', `again-${email}`);
        expect(none).toEqual([]);
      } finally {
        await second.close();
      }
    } finally {
      await dropLeftovers();
    }
  });

  // A used / expired / unknown code in the link hides the form and shows a notice;
  // typing the same code into the bare /join form reaches joinAction's own error.
  const BROKEN_LINK = 'This invite link is invalid or has already been used.';
  const cases = [
    { name: 'used', code: INVITES.used, error: 'This invite link has already been used.' },
    { name: 'expired', code: INVITES.expired, error: 'This invite link has expired. Ask for a new one.' },
    { name: 'garbage', code: 'NOT-A-REAL-CODE', error: 'This invite link is not valid.' },
  ];
  for (const c of cases) {
    test(`join with a ${c.name} code shows error`, async ({ page, db }) => {
      const email = `${c.name}-${test.info().testId}@e2e.test`;
      await page.goto(`/join?code=${c.code}`);
      await expect(page.getByText(BROKEN_LINK)).toBeVisible();
      await expect(page.locator('input[name="code"]')).toHaveCount(0);

      await page.goto('/join');
      await fillJoin(page, { code: c.code, name: 'X Person', email, password: 'join-pass-123' });
      await expect(page.locator('.alert-bad')).toHaveText(c.error);
      await expect(page).toHaveURL(/\/join/);
      const { data } = await db.from('users').select('id').eq('email', email);
      expect(data).toEqual([]);
    });
  }

  test('join validates fields', async ({ page, db }) => {
    const tid = test.info().testId;
    const email = `val-${tid}@e2e.test`;
    // Private invite so a (buggy) successful join can't consume the shared seeded codes.
    const code = `E2E-VAL-${tid}`;
    await deleteUserByEmail(db, email); // leftovers from an aborted earlier run
    await must(db.from('invite_codes').delete().eq('code', code));
    await must(db.from('invite_codes').insert({ code, campaign_id: 'e2e-camp-a', role: 'staff', created_by: 'e2e-owner-a' }));
    try {
      await page.goto(`/join?code=${code}`);
      await noValidate(page);

      // Empty name / email / password.
      await fillJoin(page, { code });
      await expect(page.locator('.alert-bad')).toHaveText('All fields are required.');
      await expect(page.getByText('This field is required.').first()).toBeVisible();

      // Short password.
      await noValidate(page);
      await fillJoin(page, { code, name: 'Val Person', email, password: 'short' });
      await expect(page.locator('.alert-bad')).toHaveText('Password must be at least 8 characters.');
      const { data: shortPw } = await db.from('users').select('id').eq('email', email);
      expect(shortPw).toEqual([]);

      // Bad email in the browser: native validation blocks the submit.
      await page.locator('input[name="name"]').fill('Val Person');
      await page.locator('input[name="email"]').fill('not-an-email');
      await page.locator('input[name="password"]').fill('join-pass-123');
      expect(await page.locator('input[name="email"]').evaluate((i: HTMLInputElement) => i.validity.typeMismatch)).toBe(true);
    } finally {
      await deleteUserByEmail(db, email);
      await must(db.from('invite_codes').delete().eq('code', code));
    }
  });

  // E2E-004: joinAction never validates the email format server-side.
  test('join rejects a malformed email server-side', async ({ page, db }) => {
    const tid = test.info().testId;
    const bad = `not-an-email-${tid}`;
    const code = `E2E-BADMAIL-${tid}`;
    await deleteUserByEmail(db, bad); // leftovers from an aborted earlier run
    await must(db.from('invite_codes').delete().eq('code', code));
    await must(db.from('invite_codes').insert({ code, campaign_id: 'e2e-camp-a', role: 'staff', created_by: 'e2e-owner-a' }));
    try {
      await page.goto(`/join?code=${code}`);
      await noValidate(page); // bypass the browser check to reach the server
      // Declared after setup, so only the server's handling of the malformed email is the expected failure.
      test.fail(true, 'E2E-004: joinAction accepts a malformed email and creates the account');
      await fillJoin(page, { code, name: 'Val Person', email: bad, password: 'join-pass-123' });
      // Correct behaviour: an error is shown and no account exists.
      await expect(page.locator('.alert-bad')).toBeVisible();
      const { data } = await db.from('users').select('id').eq('email', bad);
      expect(data, 'account created for a malformed email').toEqual([]);
    } finally {
      await deleteUserByEmail(db, bad);
      await must(db.from('invite_codes').delete().eq('code', code));
    }
  });

  test('join with an email that already exists is refused', async ({ page }) => {
    await page.goto(`/join?code=${INVITES.validB}`);
    await fillJoin(page, { code: INVITES.validB, name: 'Dup Person', email: USERS.owner.email, password: 'join-pass-123' });
    await expect(page.locator('.alert-bad')).toHaveText('An account with that email already exists.');
    await expect(page).toHaveURL(/\/join/);
  });
});
