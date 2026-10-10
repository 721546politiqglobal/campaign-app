import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures';
import { createSecondTenant } from '../helpers/second-tenant';
import { createThrowawayCampaign, deleteThrowawayCampaign } from '../helpers/throwaway-campaign';
import { E2E_SECRETS } from '../env';
import { bearer, ingest } from '../helpers/api';
import { CAMPAIGN_A, CAMPAIGN_B } from '../helpers/users';

const testKey = () => test.info().testId.split('-').pop()!;
const urlFor = (tag: string) => `https://news.e2e.test/api/${testKey()}-${tag}`;
const payload = (tag: string, extra: Record<string, unknown> = {}) => ({
  campaign_id: CAMPAIGN_A, source: 'E2E API', opponent: 'Pat Opponent',
  excerpt: `E2E-API-${testKey()}-${tag} excerpt`, url: urlFor(tag), ...extra,
});
async function rowsFor(db: SupabaseClient, url: string) {
  const { data, error } = await db.from('monitoring_results').select('*').eq('url', url);
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function cleanup(db: SupabaseClient, ...urls: string[]) {
  const { error } = await db.from('monitoring_results').delete().in('url', urls);
  if (error) throw new Error(`cleanup failed: ${error.message}`);
}

test.describe('POST /api/monitoring/ingest', () => {
  test('rejects missing and wrong bearer with 401 and writes nothing', async ({ request, db }) => {
    const p = payload('auth');
    try {
      const none = await request.post('/api/monitoring/ingest', { data: p });
      expect(none.status()).toBe(401);
      const wrong = await ingest(request, p, 'not-the-secret');
      expect(wrong.status()).toBe(401);
      const cron = await ingest(request, p, E2E_SECRETS.cron);
      expect(cron.status()).toBe(401);
      const noScheme = await request.post('/api/monitoring/ingest', { headers: { authorization: E2E_SECRETS.monitoring }, data: p });
      expect(noScheme.status()).toBe(401);
      expect(await rowsFor(db, p.url)).toHaveLength(0);
    } finally { await cleanup(db, p.url); }
  });

  test('valid payload returns 2xx and stores a scored row', async ({ request, db }) => {
    const p = payload('valid');
    try {
      const res = await ingest(request, p);
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      const rows = await rowsFor(db, p.url);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ campaign_id: CAMPAIGN_A, source: 'E2E API', opponent: 'Pat Opponent', excerpt: p.excerpt, dismissed_at: null });
      expect(['high', 'medium', 'low']).toContain(rows[0].credibility);
      expect(['news', 'social', 'blog', 'press_release']).toContain(rows[0].category);
    } finally { await cleanup(db, p.url); }
  });

  test('same payload twice yields one row; same url in another campaign is separate', async ({ request, db }) => {
    const p = payload('dedupe');
    try {
      expect((await ingest(request, p)).status()).toBe(200);
      expect((await ingest(request, p)).status()).toBe(200);
      expect(await rowsFor(db, p.url)).toHaveLength(1);
      // a repeat with different text but the same (campaign, url) is still deduped
      expect((await ingest(request, { ...p, excerpt: 'changed text' })).status()).toBe(200);
      const rows = await rowsFor(db, p.url);
      expect(rows).toHaveLength(1);
      expect(rows[0].excerpt).toBe(p.excerpt);
      // dedupe key is (campaign_id, url): campaign B may hold the same url
      expect((await ingest(request, { ...p, campaign_id: CAMPAIGN_B })).status()).toBe(200);
      const both = await rowsFor(db, p.url);
      expect(both.map((r) => r.campaign_id).sort()).toEqual([CAMPAIGN_A, CAMPAIGN_B]);
    } finally { await cleanup(db, p.url); }
  });

  test('re-ingesting the seeded duplicate-candidate url adds no row', async ({ request, db }) => {
    const url = 'https://news.e2e.test/a/duplicate-candidate';
    const before = await rowsFor(db, url);
    expect(before.filter((r) => r.campaign_id === CAMPAIGN_A)).toHaveLength(1);
    const res = await ingest(request, payload('seeddup', { url }));
    expect(res.status()).toBe(200);
    expect((await rowsFor(db, url)).filter((r) => r.campaign_id === CAMPAIGN_A)).toHaveLength(1);
  });

  const bad: [string, (tag: string) => unknown, number][] = [
    ['missing campaign_id', (t) => { const p = payload(t) as Record<string, unknown>; delete p.campaign_id; return p; }, 400],
    ['missing source', (t) => { const p = payload(t) as Record<string, unknown>; delete p.source; return p; }, 400],
    ['missing excerpt', (t) => { const p = payload(t) as Record<string, unknown>; delete p.excerpt; return p; }, 400],
    ['missing url', (t) => { const p = payload(t) as Record<string, unknown>; delete p.url; return p; }, 400],
    ['non-string excerpt', (t) => payload(t, { excerpt: 42 }), 400],
    ['non-string source', (t) => payload(t, { source: { a: 1 } }), 400],
    ['blank (whitespace) excerpt', (t) => payload(t, { excerpt: '   ' }), 400],
    ['non-http url scheme', (t) => payload(t, { url: 'ftp://news.e2e.test/x' }), 400],
    ['malformed url', (t) => payload(t, { url: 'not a url' }), 400],
    ['url over 2048 chars', (t) => payload(t, { url: `https://news.e2e.test/${'a'.repeat(2100)}` }), 400],
    ['source over 200 chars', (t) => payload(t, { source: 'S'.repeat(201) }), 400],
    ['opponent over 200 chars', (t) => payload(t, { opponent: 'O'.repeat(201) }), 400],
    ['campaign_id over 64 chars', (t) => payload(t, { campaign_id: 'c'.repeat(65) }), 400],
    ['unknown campaign_id', (t) => payload(t, { campaign_id: 'e2e-no-such-campaign' }), 404],
    ['array body (batch of items)', (t) => [payload(t), payload(`${t}2`)], 400],
    ['JSON null body', () => null, 400],
  ];
  for (const [name, build, status] of bad) {
    test(`invalid payload: ${name} -> ${status}, no row`, async ({ request, db }) => {
      const tag = 'bad';
      const p = build(tag);
      const res = await ingest(request, p);
      expect(res.status()).toBe(status);
      expect(await res.json()).toHaveProperty('error');
      // nothing stored under the test's unique url / excerpt marker
      const { data, error } = await db.from('monitoring_results').select('id').like('excerpt', `E2E-API-${testKey()}-%`);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }

  test('invalid JSON text -> 400', async ({ request }) => {
    const res = await request.post('/api/monitoring/ingest', {
      headers: { ...bearer(E2E_SECRETS.monitoring), 'content-type': 'application/json' },
      data: '{not json',
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
  });

  test('oversized excerpt is truncated to 1000 chars, not rejected', async ({ request, db }) => {
    const p = payload('long', { excerpt: `E2E-API-${testKey()}-long ${'x'.repeat(3000)}` });
    try {
      expect((await ingest(request, p)).status()).toBe(200);
      const rows = await rowsFor(db, p.url);
      expect(rows).toHaveLength(1);
      expect(rows[0].excerpt).toHaveLength(1000);
    } finally { await cleanup(db, p.url); }
  });

  test('items outside relevance_terms are skipped; matching terms are stored', async ({ request, db }) => {
    const off = payload('offtopic', { relevance_terms: ['zzz-never-matches-qqq'] });
    const on = payload('ontopic', { relevance_terms: ['throwaway-nope', 'excerpt'] });
    try {
      const r1 = await ingest(request, off);
      expect(r1.status()).toBe(200);
      expect(await r1.json()).toEqual({ ok: true, skipped: true, reason: 'off_topic' });
      expect(await rowsFor(db, off.url)).toHaveLength(0);
      expect((await ingest(request, on)).status()).toBe(200);
      expect(await rowsFor(db, on.url)).toHaveLength(1);
    } finally { await cleanup(db, off.url, on.url); }
  });

  test('ingested item appears in /monitoring for campaign A only', async ({ request, db, asRole, page }) => {
    const p = payload('ui');
    const t2 = await createSecondTenant(db, testKey());
    try {
      expect((await ingest(request, p)).status()).toBe(200);
      const a = await asRole('owner');
      await a.goto('/monitoring');
      await expect(a.getByRole('listitem').filter({ hasText: p.excerpt })).toBeVisible();
      await t2.login(page);
      await page.goto('/monitoring');
      await expect(page.getByRole('heading', { level: 1, name: 'Opponent monitoring' })).toBeVisible();
      await expect(page.locator('body')).not.toContainText(p.excerpt);
      await expect(page.locator('body')).not.toContainText('Pat Opponent');
    } finally { try { await t2.cleanup(); } finally { await cleanup(db, p.url); } }
  });
});

test.describe('GET /api/monitoring/campaigns', () => {
  test('401 without a valid monitoring bearer', async ({ request }) => {
    expect((await request.get('/api/monitoring/campaigns')).status()).toBe(401);
    expect((await request.get('/api/monitoring/campaigns', { headers: bearer('nope') })).status()).toBe(401);
    expect((await request.get('/api/monitoring/campaigns', { headers: bearer(E2E_SECRETS.cron) })).status()).toBe(401);
  });

  test('returns campaigns with opponent config only (exact key set, no secrets or user data)', async ({ request, db }) => {
    // Other workers create/delete throwaway tenants concurrently, so the global
    // set is never compared; this test's own tenants pin both directions.
    const withOpp = await createSecondTenant(db, testKey()); // profile has opponent_name 'Opp'
    const noOpp = await createThrowawayCampaign(db, testKey(), { suffix: 'mon-api' }); // profile without opponent
    try {
      const res = await request.get('/api/monitoring/campaigns', { headers: bearer(E2E_SECRETS.monitoring) });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);

      const KEYS = ['campaign_id', 'campaign_name', 'opponent_name', 'opponent_aliases', 'monitoring_keywords',
        'opponent_twitter_handle', 'opponent_instagram_handle', 'opponent_facebook_page', 'google_alerts_rss_url'].sort();
      for (const row of body) expect(Object.keys(row).sort()).toEqual(KEYS);

      const a = body.find((r: { campaign_id: string }) => r.campaign_id === CAMPAIGN_A);
      expect(a).toBeTruthy();
      expect(a.campaign_name).toBe('E2E Campaign A');
      expect(a.opponent_name).toBe('Pat Opponent');
      expect(Array.isArray(a.opponent_aliases)).toBe(true);
      expect(Array.isArray(a.monitoring_keywords)).toBe(true);

      const ids: string[] = body.map((r: { campaign_id: string }) => r.campaign_id);
      expect(ids).toContain(withOpp.campaignId);
      expect(ids).not.toContain(noOpp.campaignId);
      // Every returned campaign has an opponent set, in the response and in the DB
      // (rows deleted by another worker since the request are simply absent here).
      for (const row of body) expect(row.opponent_name, row.campaign_id).toBeTruthy();
      const { data, error } = await db.from('candidate_profiles').select('campaign_id, opponent_name').in('campaign_id', ids);
      expect(error).toBeNull();
      for (const r of data ?? []) expect(r.opponent_name, r.campaign_id).not.toBeNull();

      const text = JSON.stringify(body);
      for (const leak of ['@e2e.test', 'password', 'service_role', E2E_SECRETS.monitoring, E2E_SECRETS.cron,
        'ayrshare', 'stripe', 'full_name', 'Olivia', 'api_key', 'token']) {
        expect(text.toLowerCase(), `leak: ${leak}`).not.toContain(leak.toLowerCase());
      }
    } finally {
      try { await withOpp.cleanup(); } finally { await deleteThrowawayCampaign(db, noOpp.campaignId); }
    }
  });
});
