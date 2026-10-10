import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures';
import { USERS, CAMPAIGN_A } from '../helpers/users';
import { cronGet } from '../helpers/api';
import { addFakeRule, fakeRequests, removeFakeRule } from '../helpers/ayrshare';

// The publish cron publishes EVERY due item, and other specs run in parallel
// against the same DB, so every test here creates its own throwaway items
// (unique title/marker) and asserts on those only.

const PUBLISH = '/api/cron/publish';
const PROFILE_KEY = 'e2e-profile-a';

const key = () => `${test.info().testId.split("-").pop()}${Date.now().toString(36)}`;

type Spec = { id: string; marker: string; due: boolean; platforms?: string[] };

async function insertScheduled(db: SupabaseClient, s: Spec) {
  const scheduledAt = new Date(Date.now() + (s.due ? -5 * 60_000 : 7 * 86_400_000)).toISOString();
  const { error } = await db.from('content_items').insert({
    id: s.id, campaign_id: CAMPAIGN_A, type: 'social_post', title: `E2E cron ${s.id}`,
    body: `Cron e2e body ${s.marker}`, status: 'scheduled', is_ai_generated: true,
    target_jurisdictions: ['US-FEDERAL'], created_by: USERS.staff.id,
    scheduled_at: scheduledAt, platforms: s.platforms ?? ['x', 'facebook'],
  });
  expect(error).toBeNull();
  const { error: e2 } = await db.from('approval_records').insert({
    content_item_id: s.id, campaign_id: CAMPAIGN_A, approver_user_id: USERS.approver.id, decision: 'approve',
  });
  expect(e2).toBeNull();
  const { error: e3 } = await db.from('disclosure_records').insert({
    content_item_id: s.id, campaign_id: CAMPAIGN_A, jurisdiction: 'US-FEDERAL',
    disclosure_text: 'This content was created with the help of AI.', placement: 'end',
  });
  expect(e3).toBeNull();
}

async function cleanup(db: SupabaseClient, id: string) {
  const { error: e1 } = await db.from('audit_entries').delete().eq('entity_id', id);
  expect(e1).toBeNull();
  const { error: e2 } = await db.from('content_items').delete().eq('id', id); // approvals/disclosures cascade
  expect(e2).toBeNull();
}

const statusOf = async (db: SupabaseClient, id: string) =>
  (await db.from('content_items').select('status').eq('id', id).single()).data?.status;

const audits = async (db: SupabaseClient, id: string, action: string) =>
  (await db.from('audit_entries').select('details').eq('entity_id', id).eq('action', action)).data ?? [];

const postsWith = async (marker: string) =>
  (await fakeRequests({ path: '/api/post', profileKey: PROFILE_KEY }))
    .filter((r) => String((r.body as { post?: string })?.post ?? '').includes(marker));

test.describe('cron auth', () => {
  for (const path of [PUBLISH, '/api/cron/sync-analytics']) {
    test(`${path}: no secret -> 401`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(401);
    });
    test(`${path}: wrong secret -> 401`, async ({ request }) => {
      expect((await cronGet(request, path, 'not-the-secret')).status()).toBe(401);
    });
    test(`${path}: non-bearer scheme -> 401`, async ({ request }) => {
      expect((await request.get(path, { headers: { authorization: 'e2e-cron-secret' } })).status()).toBe(401);
    });
  }
});

test.describe('publish cron', () => {
  test('publishes my due item once, leaves the future item alone, never double-publishes', async ({ request, db }) => {
    const k = key();
    const due: Spec = { id: `e2e-cron-due-${k}`, marker: `cron-due-${k}`, due: true };
    const future: Spec = { id: `e2e-cron-fut-${k}`, marker: `cron-fut-${k}`, due: false };
    try {
      await insertScheduled(db, due);
      await insertScheduled(db, future);

      const res = await cronGet(request, PUBLISH);
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({ published: expect.any(Number) });

      expect(await statusOf(db, due.id)).toBe('published');
      const { data } = await db.from('content_items').select('ayrshare_post_ids').eq('id', due.id).single();
      expect(Object.keys(data?.ayrshare_post_ids ?? {}).sort()).toEqual(['facebook', 'x']);
      expect(await statusOf(db, future.id)).toBe('scheduled');

      // Second run: nothing more for this item.
      expect((await cronGet(request, PUBLISH)).status()).toBe(200);
      expect(await statusOf(db, due.id)).toBe('published');
      expect(await audits(db, due.id, 'cron_publish')).toHaveLength(1);
      expect(await statusOf(db, future.id)).toBe('scheduled');

      // One Ayrshare call per platform, with the disclosure appended, from the first run only.
      const posts = await postsWith(due.marker);
      expect(posts).toHaveLength(2);
      expect(String((posts[0].body as { post: string }).post)).toContain('created with the help of AI');
      expect(await postsWith(future.marker)).toHaveLength(0);
    } finally {
      await cleanup(db, due.id);
      await cleanup(db, future.id);
    }
  });

  test('a platform failing on one of two still publishes, recording the failure', async ({ request, db }) => {
    const k = key();
    const s: Spec = { id: `e2e-cron-part-${k}`, marker: `cron-part-${k}`, due: true };
    try {
      await insertScheduled(db, s);
      await addFakeRule(s.marker, { failPlatforms: ['x'], match: { textIncludes: s.marker } });
      expect((await cronGet(request, PUBLISH)).status()).toBe(200);

      expect(await statusOf(db, s.id)).toBe('published');
      const [entry] = await audits(db, s.id, 'cron_publish');
      expect((entry.details as { failed: string[] }).failed).toEqual(['x']);
      const { data } = await db.from('content_items').select('ayrshare_post_ids').eq('id', s.id).single();
      expect(Object.keys(data?.ayrshare_post_ids ?? {})).toEqual(['facebook']);
    } finally {
      await removeFakeRule(s.marker);
      await cleanup(db, s.id);
    }
  });

  test('every platform failing returns the item to approved with a cron_publish_failed audit', async ({ request, db }) => {
    const k = key();
    const s: Spec = { id: `e2e-cron-fail-${k}`, marker: `cron-fail-${k}`, due: true };
    try {
      await insertScheduled(db, s);
      await addFakeRule(s.marker, { failPlatforms: ['x', 'facebook'], match: { textIncludes: s.marker } });
      expect((await cronGet(request, PUBLISH)).status()).toBe(200);

      expect(await statusOf(db, s.id)).toBe('approved');
      expect(await audits(db, s.id, 'cron_publish')).toHaveLength(0);
      const failed = await audits(db, s.id, 'cron_publish_failed');
      expect(failed).toHaveLength(1);
      expect((failed[0].details as { errors: unknown[] }).errors).toHaveLength(2);

      // Back to approved means it is not retried by the next run.
      expect((await cronGet(request, PUBLISH)).status()).toBe(200);
      expect(await audits(db, s.id, 'cron_publish_failed')).toHaveLength(1);
    } finally {
      await removeFakeRule(s.marker);
      await cleanup(db, s.id);
    }
  });

  test('an item for an unlinked platform is not published and is sent back to approved', async ({ request, db }) => {
    const k = key();
    const s: Spec = { id: `e2e-cron-unl-${k}`, marker: `cron-unl-${k}`, due: true, platforms: ['tiktok'] };
    try {
      await insertScheduled(db, s);
      expect((await cronGet(request, PUBLISH)).status()).toBe(200);
      expect(await statusOf(db, s.id)).toBe('approved');
      expect(await audits(db, s.id, 'cron_publish_not_connected')).toHaveLength(1);
      expect(await postsWith(s.marker)).toHaveLength(0);
    } finally {
      await cleanup(db, s.id);
    }
  });
});

test.describe('vendor proxy routes', () => {
  for (const path of ['/api/heygen/avatars', '/api/elevenlabs/voices']) {
    test(`${path}: logged out -> 401`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });
  }

  test('/api/heygen/avatars: owner without baseId gets an empty list (no vendor key)', async ({ asRole }) => {
    const page = await asRole('owner');
    const res = await page.request.get('/api/heygen/avatars');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ avatars: [] });
  });

  test('/api/elevenlabs/voices: campaign owner gets a voices list shape', async ({ asRole }) => {
    const page = await asRole('owner');
    const res = await page.request.get('/api/elevenlabs/voices');
    expect(res.status()).toBe(200);
    expect(Array.isArray((await res.json()).voices)).toBe(true);
  });

  test('/api/elevenlabs/voices: super_admin gets the list, "not configured" with a blank key', async ({ asRole }) => {
    const page = await asRole('admin');
    const res = await page.request.get('/api/elevenlabs/voices');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ voices: [], message: 'ELEVENLABS_API_KEY not configured' });
  });
});
