import bcrypt from 'bcryptjs';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BASE_URL } from '../env';

// Throwaway tenants for specs that must mutate team/settings state (Task 17).
// Seeded users and campaign A are shared with concurrent specs and must never
// have their role, membership or settings changed — so these tests build a
// private campaign + users, keyed by the test's id, and delete it afterwards
// (campaign delete cascades to users, profile, content, invites, audit, avatars).

export const THROWAWAY_PASSWORD = 'e2e-t17-pass-123';
// Cost 4 keeps per-test setup fast; bcrypt.compare accepts any cost.
const HASH = bcrypt.hashSync(THROWAWAY_PASSWORD, 4);

export type TRole = 'owner' | 'manager' | 'approver' | 'staff';
export type TUser = { id: string; email: string; name: string; role: TRole };
export type Throwaway = { key: string; campaignId: string; campaignName: string; owner: TUser };

/** Await a supabase write and fail loudly if it errored. */
export async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
  return data;
}

export const campaignIdFor = (key: string, suffix = '') => `e2e-t17-${key}${suffix ? `-${suffix}` : ''}`;

export async function deleteThrowawayCampaign(db: SupabaseClient, campaignId: string) {
  await must(db.from('campaigns').delete().eq('id', campaignId));
  // Users cascade with the campaign; prove nothing was left behind.
  const { count, error } = await db.from('users').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
  if (error) throw new Error(`cleanup check failed: ${error.message}`);
  if (count) throw new Error(`cleanup left ${count} user(s) in ${campaignId}`);
}

/**
 * Creates a campaign (default: enterprise plan, unlimited seats, with a
 * candidate profile so AppFrame does not bounce to /setup) and its owner.
 * Re-runnable: any leftover from an aborted earlier run is removed first.
 */
export async function createThrowawayCampaign(db: SupabaseClient, key: string, opts: {
  suffix?: string; plan?: string | null; profile?: boolean; name?: string;
  tags?: string[]; subscriptionStatus?: string | null; defaultDisclosure?: string | null;
} = {}): Promise<Throwaway> {
  const campaignId = campaignIdFor(key, opts.suffix);
  const campaignName = opts.name ?? `E2E T17 ${key}${opts.suffix ? ` ${opts.suffix}` : ''}`;
  await deleteThrowawayCampaign(db, campaignId);
  await must(db.from('campaigns').insert({
    id: campaignId, name: campaignName, jurisdictions: ['US-FEDERAL'],
    plan_id: opts.plan === undefined ? 'enterprise' : opts.plan,
    subscription_status: opts.subscriptionStatus === undefined ? 'active' : opts.subscriptionStatus,
    tags: opts.tags ?? [],
    default_disclosure_text: opts.defaultDisclosure ?? null,
  }));
  if (opts.profile !== false) {
    await must(db.from('candidate_profiles').insert({
      id: `${campaignId}-profile`, campaign_id: campaignId,
      full_name: 'Tess Throwaway', preferred_name: 'Tess', office: 'City Council', district: 'Ward 9',
      party: 'Independent', bio: 'Throwaway candidate for team/settings tests.',
      key_positions: ['Parks'], voice_tone: 'conversational', target_audience: 'Ward 9 residents',
      tagline: 'Tess for Ward 9', content_locale: 'en',
    }));
  }
  const owner = await addThrowawayUser(db, campaignId, 'owner', 'owner');
  return { key, campaignId, campaignName, owner };
}

export async function addThrowawayUser(db: SupabaseClient, campaignId: string, role: TRole, label: string,
  opts: { locale?: string; name?: string } = {}): Promise<TUser> {
  const id = `${campaignId}-${label}`;
  const email = `${id}@e2e.test`;
  const name = opts.name ?? `T17 ${label} ${campaignId.slice(-6)}`;
  await must(db.from('users').insert({
    id, campaign_id: campaignId, name, role, email, password_hash: HASH, locale: opts.locale ?? 'en',
  }));
  return { id, email, name, role };
}

/** A private x-forwarded-for so logins never share the `ip:unknown` throttle bucket. */
export function isolatedIp() {
  const r = () => Math.floor(Math.random() * 250) + 1;
  return `10.${r()}.${r()}.${r()}`;
}

/** Logs in through /login on `page` (its context must not already hold a session). */
export async function uiLogin(page: Page, email: string, password = THROWAWAY_PASSWORD) {
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': isolatedIp() });
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

/** A fresh, signed-in browser context for a throwaway user. Caller closes it. */
export async function loginInNewContext(browser: Browser, email: string, password = THROWAWAY_PASSWORD):
  Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  await uiLogin(page, email, password);
  return { ctx, page };
}
