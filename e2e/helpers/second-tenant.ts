import type { SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { expect, type Page } from '@playwright/test';
import { PASSWORD } from './users';

// A throwaway SUBSCRIBED second tenant (seeded campaign B has no plan, so its
// owner is gated to /pricing). Returns ids plus a cleanup that deletes everything.
// Re-runnable without a DB reset: leftovers from an aborted earlier run (same
// testId-derived ids) are removed before inserting.
export async function createSecondTenant(db: SupabaseClient, k: string) {
  const camp = `e2e-t12-b-${k}`;
  const owner = { id: `e2e-t12-owner-${k}`, email: `t12-${k}@e2e.test` };
  const must = async (q: PromiseLike<{ error: unknown }>) => expect((await q).error).toBeNull();
  const cleanup = async () => {
    await must(db.from('monitoring_results').delete().eq('campaign_id', camp));
    await must(db.from('audit_entries').delete().eq('actor_user_id', owner.id));
    await must(db.from('login_attempts').delete().eq('key', `email:${owner.email}`));
    await must(db.from('users').delete().eq('id', owner.id));
    await must(db.from('candidate_profiles').delete().eq('campaign_id', camp));
    await must(db.from('campaigns').delete().eq('id', camp));
  };
  await cleanup();
  await must(db.from('campaigns').insert({ id: camp, name: `T12 tenant ${k}`, jurisdictions: ['US-TX'], plan_id: 'enterprise' }));
  await must(db.from('candidate_profiles').insert({
    id: `${camp}-profile`, campaign_id: camp, full_name: 'T12 Candidate', preferred_name: 'T12', office: 'City Council',
    district: 'Ward 1', party: 'Independent', bio: 'bio', key_positions: ['p'], voice_tone: 'conversational',
    target_audience: 'everyone', tagline: 'tag', opponent_name: 'Opp', opponent_aliases: [], monitoring_keywords: ['t12'], content_locale: 'en',
  }));
  await must(db.from('users').insert({
    id: owner.id, campaign_id: camp, name: 'T12 Owner', role: 'owner', email: owner.email,
    password_hash: bcrypt.hashSync(PASSWORD, 4), locale: 'en',
  }));
  return {
    campaignId: camp, owner,
    async login(page: Page) {
      await page.goto('/login');
      await page.locator('input[name="email"]').fill(owner.email);
      await page.locator('input[name="password"]').fill(PASSWORD);
      await page.locator('form button[type="submit"]').click();
      await expect(page).not.toHaveURL(/\/login$/);
    },
    cleanup,
  };
}
