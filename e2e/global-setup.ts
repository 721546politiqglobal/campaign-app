import { chromium, request, type FullConfig } from '@playwright/test';
import { existsSync, mkdirSync, renameSync, statSync } from 'fs';
import { resetDb } from './reset-db';
import { BASE_URL, E2E_ENV, FAKE_AYRSHARE_URL } from './env';
import { USERS, PASSWORD, type SeedRole } from './helpers/users';

export default async function globalSetup(_config: FullConfig) {
  Object.assign(process.env, {
    E2E_DATABASE_URL: E2E_ENV.E2E_DATABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: E2E_ENV.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: E2E_ENV.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!process.env.E2E_SKIP_RESET) {
    await resetDb();
    // The fake Ayrshare is reused across runs locally (reuseExistingServer) and keeps its
    // profiles; reset it together with the DB so both start from the seed (otherwise a
    // re-created throwaway campaign hits "Profile title already exists", code 146).
    // Only here: under E2E_SKIP_RESET other runs may be sharing the fake.
    const res = await fetch(`${FAKE_AYRSHARE_URL}/__reset`, { method: 'POST' });
    if (!res.ok) throw new Error(`[e2e] fake Ayrshare reset failed: HTTP ${res.status}`);
  }

  mkdirSync('e2e/.auth', { recursive: true });
  const roles = Object.keys(USERS) as SeedRole[];

  // Concurrent runs (E2E_SKIP_RESET) reuse fresh saved logins instead of re-logging in.
  const MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const authFresh = roles.every((r) => {
    const f = `e2e/.auth/${r}.json`;
    return existsSync(f) && Date.now() - statSync(f).mtimeMs < MAX_AGE_MS;
  });
  if (process.env.E2E_SKIP_RESET && authFresh) {
    console.log('[e2e] E2E_SKIP_RESET set and saved logins are < 6h old — skipping browser logins');
    // Safety: still prove the server is on the TEST db using the owner's saved session.
    const api = await request.newContext({ storageState: `e2e/.auth/owner.json`, baseURL: BASE_URL });
    try {
      const res = await api.get('/dashboard');
      const body = await res.text();
      if (!body.includes('E2E Campaign A')) {
        throw new Error('[e2e] saved owner session did not show "E2E Campaign A" on /dashboard — is the server using the TEST database?');
      }
    } finally {
      await api.dispose();
    }
    return;
  }

  const browser = await chromium.launch();
  try {
    for (const role of roles) {
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      const page = await ctx.newPage();
      await page.goto('/login');
      await page.locator('input[name="email"]').fill(USERS[role].email);
      await page.locator('input[name="password"]').fill(PASSWORD);
      await page.locator('form button[type="submit"]').click();
      // Safety: these users exist ONLY in the e2e seed. If login fails the server
      // is not talking to the test DB — abort before any spec mutates data.
      // loginAction redirects super_admin → /admin, everyone else → /dashboard.
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
        .catch(() => { throw new Error(`[e2e] login as ${role} failed — is the server using the TEST database?`); });
      const final = `e2e/.auth/${role}.json`;
      const tmp = `${final}.tmp-${process.pid}`;
      await ctx.storageState({ path: tmp });
      renameSync(tmp, final); // atomic: concurrent readers never see a partial file
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}
