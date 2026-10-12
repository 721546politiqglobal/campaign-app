import type { Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, allowConsole } from '../fixtures';
import { CAMPAIGN_A, USERS } from '../helpers/users';
import { E2E_ENV, assertTestProject } from '../env';
import {
  createDraft, submitForReview, approve, attachDisclosure, schedule,
  editorForm, pickType, zonedLocalInput, LABELS,
} from '../helpers/content';
import { captureAction, replayAction, retarget, actionResult, type CapturedAction } from '../helpers/server-action';
import { fakeRequests } from '../helpers/ayrshare';
import { zonedNaiveToUtc } from '../../src/lib/timezone';

// The core flow: draft → submit → approve → disclosure → schedule → publish
// (src/domain/content-lifecycle.ts, src/app/actions.ts, ContentWizard.tsx).
// Every item is created through the UI with this test's key in its title, and
// removed again by that key; seeded CONTENT rows are never touched.

const SEEDED_PROFILE_KEY = 'e2e-profile-a';
const L = {
  publishButton: /^Publish to \d+ platforms?$/,
  reviewHeading: 'Ready to continue?',
  disclosureHeading: 'Required AI disclosure',
  approvalDenied: 'Approval requires manager or approver access.',
  publishDenied: 'Publishing requires manager access.',
  scheduleDenied: 'Scheduling requires manager access.',
};

/** Per-test part of Playwright's testId (`<fileHash>-<testHash>`). */
const testKey = () => test.info().testId.split('-').pop()!;

async function must(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
}

/** Removes every campaign-A item whose title carries `key` (approvals/disclosures cascade). */
async function cleanupByKey(db: SupabaseClient, key: string) {
  const { data, error } = await db.from('content_items').select('id').eq('campaign_id', CAMPAIGN_A).like('title', `%${key}%`);
  if (error) throw new Error(`cleanup lookup failed: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length === 0) return;
  await must(db.from('audit_entries').delete().in('entity_id', ids));
  await must(db.from('content_items').delete().in('id', ids));
}

const serviceDb = () => createClient(assertTestProject(E2E_ENV.NEXT_PUBLIC_SUPABASE_URL), E2E_ENV.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

async function item(db: SupabaseClient, id: string) {
  const { data, error } = await db.from('content_items')
    .select('status, body, title, is_ai_generated, scheduled_at, timezone, platforms, locale').eq('id', id).single();
  if (error) throw new Error(`read ${id}: ${error.message}`);
  return data;
}

const statusOf = async (db: SupabaseClient, id: string) => (await item(db, id)).status;

/** Fake-Ayrshare posts whose text contains `marker`. */
const postsWith = async (marker: string) =>
  (await fakeRequests({ path: '/api/post', profileKey: SEEDED_PROFILE_KEY }))
    .filter((r) => String((r.body as { post?: string })?.post ?? '').includes(marker));

/** Collapses whitespace (incl. the narrow no-break space ICU puts before AM/PM). */
const norm = (s: string) => s.replace(/[\s  ]+/g, ' ').trim();

/** Tomorrow (in `tz`) at `hhmm` wall-clock time there, as a UTC instant. */
function tomorrowAt(tz: string, hhmm: string, days = 1): Date {
  const day = zonedLocalInput(new Date(Date.now() + days * 86400_000), tz).slice(0, 10);
  return zonedNaiveToUtc(`${day}T${hhmm}`, tz);
}

/** The scheduled card's "Goes out" value. */
const goesOut = (page: Page) => page.locator('dl.wizard-facts > div').filter({ hasText: 'Goes out' }).locator('dd');

/** Activity timeline as [label, actor] pairs, as displayed (newest first). */
async function activity(page: Page): Promise<[string, string][]> {
  const items = page.getByRole('region', { name: 'Activity' }).locator('li.timeline-item');
  const out: [string, string][] = [];
  for (const li of await items.all()) {
    const label = norm(await li.locator('.timeline-title').innerText());
    const by = norm(await li.locator('.timeline-meta span').first().innerText()).replace(/^by /, '');
    out.push([label, by]);
  }
  return out;
}

/** Publish-step platform chips: select exactly `names` (chips' inputs are visually hidden, so click labels). */
async function selectPlatforms(page: Page, names: string[]) {
  for (const name of ['Facebook', 'X', 'LinkedIn']) {
    const box = page.getByRole('checkbox', { name, exact: true });
    if (!(await box.count()) || await box.isDisabled()) continue;
    if ((await box.isChecked()) !== names.includes(name)) {
      await page.locator('label.chip').filter({ has: box }).click();
    }
    await expect(box).toBeChecked({ checked: names.includes(name) });
  }
}

/** An approved, human-written item (no disclosure needed) created through the UI. */
async function approvedHumanItem(owner: Page, title: string, body: string): Promise<string> {
  const id = await createDraft(owner, title, body, { aiGenerated: false });
  await approve(owner, id);
  return id;
}

/** Owner schedules a throwaway approved item; returns the captured scheduleWithTimeAction and its target id. */
async function captureSchedule(owner: Page, key: string): Promise<{ action: CapturedAction; id: string }> {
  const id = await approvedHumanItem(owner, `E2E capture schedule ${key}`, `Capture schedule ${key}`);
  await owner.goto(`/content/${id}`);
  await owner.getByRole('button', { name: LABELS.scheduleLater }).click();
  await owner.getByLabel(/^Date & time/).fill(zonedLocalInput(new Date(Date.now() + 3 * 86400_000), 'America/New_York'));
  await owner.getByLabel('Time zone').selectOption('America/New_York');
  const action = await captureAction(owner, () => owner.getByRole('button', { name: LABELS.scheduleButton }).click());
  await expect(owner.getByRole('heading', { name: 'Scheduled', exact: true })).toBeVisible();
  return { action, id };
}

// ── Happy path ───────────────────────────────────────────────────────────────

test.describe('happy path across roles', () => {
  test.describe.configure({ mode: 'serial' });
  let key = '';
  let id = '';
  let when: Date;
  const tz = 'America/Los_Angeles';
  const disclosure = () => `Paid for by E2E happy ${key}.`;

  test.afterAll(async () => { if (key) await cleanupByKey(serviceDb(), key); });

  test('staff drafts and submits, approver approves, owner attaches the disclosure', async ({ asRole, db }) => {
    // Run-unique (testKey alone repeats across runs, and fake-Ayrshare's log isn't reset).
    key = `${testKey()}${Date.now().toString(36)}`;
    const staff = await asRole('staff');
    id = await createDraft(staff, `E2E happy ${key}`, `Happy path body ${key}`);
    expect(await item(db, id)).toMatchObject({ status: 'draft', is_ai_generated: true, body: `Happy path body ${key}` });

    await submitForReview(staff, id);
    await expect(staff.getByText(L.approvalDenied)).toBeVisible();
    expect(await statusOf(db, id)).toBe('in_review');

    await approve(await asRole('approver'), id);
    expect(await statusOf(db, id)).toBe('approved');

    const owner = await asRole('owner');
    await attachDisclosure(owner, id, disclosure());
    await expect(owner.getByRole('button', { name: L.publishButton })).toBeVisible();
    const { data: discs } = await db.from('disclosure_records').select('disclosure_text').eq('content_item_id', id);
    expect(discs).toEqual([{ disclosure_text: disclosure() }]);
  });

  test('owner schedules for tomorrow 09:00 Pacific; the item shows that time in Los Angeles time', async ({ asRole, db }) => {
    when = tomorrowAt(tz, '09:00');
    const owner = await asRole('owner');
    await schedule(owner, id, when, tz);

    const expected = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(when);
    await expect.poll(async () => norm(await goesOut(owner).innerText())).toContain(norm(expected));
    await expect(goesOut(owner)).toContainText('Pacific — Los Angeles');
    expect(await item(db, id)).toMatchObject({ status: 'scheduled', timezone: tz });
    expect(new Date((await item(db, id)).scheduled_at).toISOString()).toBe(when.toISOString());

    // Same instant, same zone after a reload (not the browser's zone).
    await owner.reload();
    await expect.poll(async () => norm(await goesOut(owner).innerText())).toContain(norm(expected));
  });

  test('owner unschedules, then publishes now: published, platforms listed, disclosure in the post', async ({ asRole, db }) => {
    const owner = await asRole('owner');
    await owner.goto(`/content/${id}`);
    await owner.getByRole('button', { name: 'Unschedule', exact: true }).click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Unschedule', exact: true }).click();
    await expect(owner.getByRole('button', { name: L.publishButton })).toBeVisible();
    expect(await item(db, id)).toMatchObject({ status: 'approved', scheduled_at: null });

    // X isn't offered (not linkable through Ayrshare); campaign A's other linked network is Facebook.
    await expect(owner.getByRole('group', { name: 'Platforms' }).getByRole('checkbox', { name: 'X' })).toHaveCount(0);
    await selectPlatforms(owner, ['Facebook']);
    await owner.getByRole('button', { name: 'Publish to 1 platform' }).click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();

    await expect(owner.getByRole('heading', { name: 'Published', exact: true })).toBeVisible();
    const postedTo = owner.locator('.wizard-platform-list');
    await expect(postedTo).toContainText('Posted to');
    await expect(postedTo.locator('.badge')).toHaveCount(1);
    expect(await postedTo.locator('.badge').allInnerTexts()).toEqual(['Facebook']);
    expect(await statusOf(db, id)).toBe('published');

    // One request per platform, each carrying the body with the disclosure appended.
    const posts = await postsWith(`Happy path body ${key}`);
    expect(posts.map((p) => (p.body as { platforms: string[] }).platforms).flat()).toEqual(['facebook']);
    for (const p of posts) {
      expect((p.body as { post: string }).post).toBe(`Happy path body ${key}\n\n${disclosure()}`);
    }
  });

  // Newest first, as the page shows it. Scheduling currently writes two
  // entries (see the next test), collapsed here so the order check stands alone.
  const STEPS: [string, string][] = [
    ['Published', USERS.owner.name],
    ['Unscheduled', USERS.owner.name],
    ['Scheduled', USERS.owner.name],
    ['AI disclosure attached', USERS.owner.name],
    ['Approved', USERS.approver.name],
    ['Submitted for review', USERS.staff.name],
  ];

  test('activity log lists each step with actor names, newest first', async ({ asRole }) => {
    const page = await asRole('staff');
    await page.goto(`/content/${id}`);
    const log = await activity(page);
    const collapsed = log.filter((e, i) => i === 0 || e.join() !== log[i - 1].join());
    expect(collapsed).toEqual(STEPS);
  });

  test('activity log shows the schedule step once', async ({ asRole }) => {
    test.fail(true, 'E2E-008: scheduling writes two "Scheduled" activity entries');
    const page = await asRole('staff');
    await page.goto(`/content/${id}`);
    expect(await activity(page)).toEqual(STEPS);
  });
});

// ── AI draft ─────────────────────────────────────────────────────────────────

test('AI draft: generated body, AI flag on the item, disclosure required before publishing', async ({ asRole, db }) => {
  const key = testKey();
  try {
    const staff = await asRole('staff');
    await staff.goto('/content/new');
    const form = editorForm(staff);
    await pickType(staff, 'social_post');
    const instruction = `Announce the ${key} town hall on Saturday`;
    await form.getByLabel('What should this say?').fill(instruction);
    await form.getByRole('button', { name: 'Generate with AI' }).click();

    await expect(form.getByLabel(/^Body/)).toHaveValue(new RegExp(instruction));
    await expect(form.getByLabel(/^Title/)).toHaveValue(new RegExp(key));
    await expect(form.getByRole('checkbox', { name: LABELS.aiCheckbox })).toBeChecked();
    await form.getByRole('button', { name: LABELS.saveDraft }).click();
    await staff.waitForURL(/\/content\/[0-9a-f-]{36}$/);
    const id = staff.url().split('/').pop()!;

    expect(await item(db, id)).toMatchObject({ status: 'draft', is_ai_generated: true });
    await expect(staff.getByText('Social post · AI-generated')).toBeVisible();
    await expect(staff.getByRole('list', { name: 'Progress' })).toContainText('Disclosure');

    await staff.goto('/content');
    const row = staff.getByRole('row').filter({ has: staff.getByRole('link', { name: new RegExp(key) }) });
    await expect(row.getByRole('cell', { name: 'AI-generated', exact: true })).toBeVisible();

    await approve(await asRole('approver'), id);
    const owner = await asRole('owner');
    await owner.goto(`/content/${id}`);
    await expect(owner.getByRole('heading', { name: L.disclosureHeading })).toBeVisible();
    await expect(owner.locator('textarea.wizard-disclosure-text')).toHaveValue('Paid for by E2E Campaign A.');
    await expect(owner.getByRole('button', { name: L.publishButton })).toHaveCount(0);
    await expect(owner.getByRole('button', { name: LABELS.scheduleLater })).toHaveCount(0);
  } finally {
    await cleanupByKey(db, key);
  }
});

// ── Gates ────────────────────────────────────────────────────────────────────

test.describe('gates', () => {
  test('schedule before approval is blocked', async ({ asRole, db }) => {
    const key = testKey();
    try {
      const staff = await asRole('staff');
      const id = await createDraft(staff, `E2E gate sched ${key}`, `Gate schedule ${key}`, { aiGenerated: false });
      await submitForReview(staff, id);

      const owner = await asRole('owner');
      await owner.goto(`/content/${id}`);
      await expect(owner.getByRole('heading', { name: L.reviewHeading })).toBeVisible();
      await expect(owner.getByRole('button', { name: LABELS.scheduleLater })).toHaveCount(0);

      // The server refuses it too, with the lifecycle's reason.
      const cap = await captureSchedule(owner, key);
      const res = await replayAction(owner, retarget(cap.action, cap.id, id));
      expect(await actionResult(res)).toEqual({ ok: false, error: 'Can’t move content from in_review to scheduled.' });
      expect(await item(db, id)).toMatchObject({ status: 'in_review', scheduled_at: null });
    } finally {
      await cleanupByKey(db, key);
    }
  });

  test('schedule after approval but without the AI disclosure is blocked', async ({ asRole, db }) => {
    // Nav-link prefetches (/billing, /settings) aborted at navigation/teardown; seen under parallel load.
    allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/\S*\. Falling back to browser navigation/);
    const key = testKey();
    try {
      const owner = await asRole('owner');
      const id = await createDraft(owner, `E2E gate disc ${key}`, `Gate disclosure ${key}`);
      await approve(owner, id);
      await owner.goto(`/content/${id}`);
      await expect(owner.getByRole('heading', { name: L.disclosureHeading })).toBeVisible();
      await expect(owner.getByRole('button', { name: LABELS.scheduleLater })).toHaveCount(0);

      const cap = await captureSchedule(owner, key);
      const res = await replayAction(owner, retarget(cap.action, cap.id, id));
      expect(await actionResult(res)).toEqual({ ok: false, error: 'Can’t schedule: AI content needs a disclosure attached first.' });
      expect(await item(db, id)).toMatchObject({ status: 'approved', scheduled_at: null });
    } finally {
      await cleanupByKey(db, key);
    }
  });

  test('publish before approval is blocked', async ({ asRole, db }) => {
    const key = testKey();
    try {
      const staff = await asRole('staff');
      const id = await createDraft(staff, `E2E gate pub ${key}`, `Gate publish target ${key}`, { aiGenerated: false });
      await submitForReview(staff, id);
      const owner = await asRole('owner');
      await owner.goto(`/content/${id}`);
      await expect(owner.getByRole('heading', { name: L.reviewHeading })).toBeVisible();
      await expect(owner.getByRole('button', { name: L.publishButton })).toHaveCount(0);

      // Capture a real publish of a throwaway approved item, aim it at the unapproved one.
      const ok = await approvedHumanItem(owner, `E2E capture pub ${key}`, `Capture publish ${key}`);
      await owner.goto(`/content/${ok}`);
      await selectPlatforms(owner, ['Facebook']);
      await owner.getByRole('button', { name: 'Publish to 1 platform' }).click();
      const action = await captureAction(owner, () =>
        owner.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click());
      await expect(owner.getByRole('heading', { name: 'Published', exact: true })).toBeVisible();

      const res = await replayAction(owner, retarget(action, ok, id));
      expect(await actionResult(res)).toEqual({ ok: false, error: 'Can’t move content from in_review to published.' });
      expect(await statusOf(db, id)).toBe('in_review');
      expect(await postsWith(`Gate publish target ${key}`)).toHaveLength(0);
    } finally {
      await cleanupByKey(db, key);
    }
  });

  test('staff sees no approve control', async ({ asRole, db }) => {
    const key = testKey();
    try {
      const staff = await asRole('staff');
      const id = await createDraft(staff, `E2E gate staff ${key}`, `Gate staff ${key}`);
      await staff.goto(`/content/${id}`);
      await expect(staff.getByRole('button', { name: LABELS.submit })).toBeVisible();
      await expect(staff.getByRole('button', { name: LABELS.approve })).toHaveCount(0);
      await expect(staff.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);

      await submitForReview(staff, id);
      await expect(staff.getByText(L.approvalDenied)).toBeVisible();
      await expect(staff.getByRole('button', { name: LABELS.approve })).toHaveCount(0);
      await expect(staff.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
    } finally {
      await cleanupByKey(db, key);
    }
  });

  test('approver cannot schedule (or publish)', async ({ asRole, db }) => {
    const key = testKey();
    try {
      const approver = await asRole('approver');
      const id = await createDraft(approver, `E2E gate approver ${key}`, `Gate approver ${key}`, { aiGenerated: false });
      await approve(approver, id);
      await approver.goto(`/content/${id}`);
      await expect(approver.getByText(L.publishDenied)).toBeVisible();
      await expect(approver.getByRole('button', { name: L.publishButton })).toHaveCount(0);
      await approver.getByRole('button', { name: LABELS.scheduleLater }).click();
      await expect(approver.getByText(L.scheduleDenied)).toBeVisible();
      await expect(approver.getByRole('button', { name: LABELS.scheduleButton })).toHaveCount(0);
      await expect(approver.getByRole('button', { name: 'Pick a time above' })).toHaveCount(0);
      expect(await statusOf(db, id)).toBe('approved');
    } finally {
      await cleanupByKey(db, key);
    }
  });
});

// ── Reject → revise → resubmit ───────────────────────────────────────────────

test('approver rejects with a reason; staff sees it, revises and resubmits', async ({ asRole, db }) => {
  const key = testKey();
  const reason = `Needs a source for the claim ${key}`;
  try {
    const staff = await asRole('staff');
    const id = await createDraft(staff, `E2E reject ${key}`, `Reject me ${key}`, { aiGenerated: false });
    await submitForReview(staff, id);

    const approver = await asRole('approver');
    await approver.goto(`/content/${id}`);
    await approver.getByRole('button', { name: 'Reject', exact: true }).click();
    const dialog = approver.getByRole('dialog');
    await dialog.getByLabel('Reason').fill(reason);
    await dialog.getByRole('button', { name: 'Reject draft' }).click();
    await expect(approver.getByRole('heading', { name: 'Rejected', exact: true })).toBeVisible();
    expect(await statusOf(db, id)).toBe('rejected');

    await staff.goto(`/content/${id}`);
    await expect(staff.getByRole('heading', { name: 'Rejected', exact: true })).toBeVisible();
    await expect(staff.getByText(`Reason: ${reason}`)).toBeVisible();
    const rejectedEntry = staff.getByRole('region', { name: 'Activity' }).locator('li').filter({ hasText: 'Rejected' });
    await expect(rejectedEntry).toContainText(USERS.approver.name);
    await expect(rejectedEntry.locator('blockquote')).toHaveText(reason);

    await staff.getByRole('button', { name: 'Revise draft' }).click();
    await expect(staff.getByRole('button', { name: LABELS.submit })).toBeVisible();
    expect(await statusOf(db, id)).toBe('draft');

    const revised = `Revised with a source ${key}`;
    await staff.getByLabel('Content').fill(revised);
    await staff.getByRole('button', { name: 'Save edits' }).click();
    await expect(staff.getByRole('button', { name: 'Save edits' })).toBeDisabled();
    await submitForReview(staff, id);
    expect(await item(db, id)).toMatchObject({ status: 'in_review', body: revised });
  } finally {
    await cleanupByKey(db, key);
  }
});

// ── Edit after approval ──────────────────────────────────────────────────────
// saveBodyAction only edits draft / in_review / rejected items: approved text
// is locked (actions.ts saveBodyAction), so unapproved wording can't reach publish.

test('the body of an approved item cannot be edited', async ({ asRole, db }) => {
  const key = testKey();
  try {
    const owner = await asRole('owner');
    const id = await approvedHumanItem(owner, `E2E locked ${key}`, `Approved wording ${key}`);
    await owner.goto(`/content/${id}`);
    await owner.getByRole('button', { name: /Review draft/ }).click();
    await expect(owner.getByText('This text was approved and can no longer be edited.')).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Save edits' })).toHaveCount(0);
    await expect(owner.locator('.wizard').getByRole('textbox')).toHaveCount(0);

    // Server: a captured "Save edits" on a draft, replayed at the approved item.
    const draft = await createDraft(owner, `E2E locked capture ${key}`, `Draft wording ${key}`, { aiGenerated: false });
    await owner.goto(`/content/${draft}`);
    await owner.getByLabel('Content').fill(`Sneaky edit ${key}`);
    const action = await captureAction(owner, () => owner.getByRole('button', { name: 'Save edits' }).click());
    const res = await replayAction(owner, retarget(action, draft, id));
    expect(await actionResult(res)).toEqual({ ok: false, error: 'This content can no longer be edited. Move it back to draft first.' });
    expect(await item(db, id)).toMatchObject({ status: 'approved', body: `Approved wording ${key}` });
  } finally {
    await cleanupByKey(db, key);
  }
});

// ── Validation ───────────────────────────────────────────────────────────────

test('a draft needs a title and a body', async ({ asRole, db }) => {
  const key = testKey();
  try {
    const page = await asRole('staff');
    await page.goto('/content/new');
    const form = editorForm(page);
    await pickType(page, 'social_post');
    await form.getByRole('button', { name: LABELS.writeMyself }).click();
    const title = form.getByLabel(/^Title/);
    const body = form.getByLabel(/^Body/);

    await body.fill(`Body without title ${key}`);
    await form.getByRole('button', { name: LABELS.saveDraft }).click();
    expect(await title.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    await expect(page).toHaveURL(/\/content\/new$/);

    await title.fill(`E2E validation ${key}`);
    await body.fill('');
    await form.getByRole('button', { name: LABELS.saveDraft }).click();
    expect(await body.evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
    await expect(page).toHaveURL(/\/content\/new$/);

    // Server: the same form posted with a blank body is refused (no row).
    await body.fill(`Server body ${key}`);
    const action = await captureAction(page, () => form.getByRole('button', { name: LABELS.saveDraft }).click());
    await page.waitForURL(/\/content\/[0-9a-f-]{36}$/);
    const res = await replayAction(page, retarget(action, `Server body ${key}`, '   '));
    expect(await actionResult(res)).toEqual({ ok: false, error: 'Write or generate the content before saving.' });
    const { data } = await db.from('content_items').select('id').like('title', `%${key}%`);
    expect(data).toHaveLength(1);
  } finally {
    await cleanupByKey(db, key);
  }
});

test('a 10,000-character body saves and renders in full', async ({ asRole, db }) => {
  const key = testKey();
  try {
    const page = await asRole('staff');
    const long = `Long ${key} ` + 'x'.repeat(10_000 - `Long ${key} `.length - 4) + ' end';
    expect(long).toHaveLength(10_000);
    const id = await createDraft(page, `E2E long ${key}`, long, { aiGenerated: false });
    expect((await item(db, id)).body).toBe(long);
    await expect(page.getByLabel('Content')).toHaveValue(long);
  } finally {
    await cleanupByKey(db, key);
  }
});

// ── Content list ─────────────────────────────────────────────────────────────

test('content list: new item appears and the status filter narrows the list', async ({ asRole, db }) => {
  const key = testKey();
  try {
    const page = await asRole('staff');
    await createDraft(page, `E2E list ${key}`, `List body ${key}`, { aiGenerated: false });
    const link = page.getByRole('link', { name: `E2E list ${key}`, exact: true });

    await page.goto('/content');
    await expect(link).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Status' });
    await tabs.getByRole('link', { name: /^Draft/ }).click();
    await expect(page).toHaveURL(/\/content\?status=draft$/);
    await expect(link).toBeVisible();
    await tabs.getByRole('link', { name: /^Approved/ }).click();
    await expect(page).toHaveURL(/\/content\?status=approved$/);
    await expect(link).toHaveCount(0);
    await tabs.getByRole('link', { name: /^All/ }).click();
    await expect(link).toBeVisible();
  } finally {
    await cleanupByKey(db, key);
  }
});

test('content list: search narrows results', async ({ asRole, db }) => {
  test.fail(true, 'E2E-009: the content list has no search');
  const key = testKey();
  try {
    const page = await asRole('staff');
    await createDraft(page, `E2E search ${key}`, `Search body ${key}`, { aiGenerated: false });
    await page.goto('/content');
    const search = page.getByRole('searchbox');
    await expect(search).toBeVisible(); // fail fast (an action would wait out the test timeout)
    await search.fill(key);
    await expect(page.getByRole('link', { name: `E2E search ${key}`, exact: true })).toBeVisible();
    await expect(page.getByRole('table').getByRole('link')).toHaveCount(1);
  } finally {
    await cleanupByKey(db, key);
  }
});

test('content list: a Spanish-language item shows its language badge', async ({ asRole, db }) => {
  const key = testKey();
  try {
    const page = await asRole('staff');
    const id = await createDraft(page, `E2E spanish ${key}`, `Hola ${key}`, { aiGenerated: false, locale: 'es' });
    expect((await item(db, id)).locale).toBe('es');
    await page.goto('/content');
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: `E2E spanish ${key}` }) });
    await expect(row).toBeVisible();
    // Declared after setup, so a setup failure is a real failure, not the expected one.
    test.fail(true, 'E2E-010: content language is not shown on the list');
    await expect(row).toContainText(/Spanish|Español|\bES\b/);
  } finally {
    await cleanupByKey(db, key);
  }
});

// ── Timezone edge ────────────────────────────────────────────────────────────

test('scheduling in a non-default time zone stores the correct UTC instant', async ({ asRole, db }) => {
  const key = testKey();
  const tz = 'Pacific/Honolulu'; // UTC−10, no DST: 23:30 local is 09:30Z the next day
  try {
    const owner = await asRole('owner');
    const id = await approvedHumanItem(owner, `E2E tz ${key}`, `Timezone body ${key}`);
    const when = tomorrowAt(tz, '23:30', 3);
    await schedule(owner, id, when, tz);
    const row = await item(db, id);
    expect(row).toMatchObject({ status: 'scheduled', timezone: tz });
    expect(new Date(row.scheduled_at).toISOString()).toBe(when.toISOString());
    expect(when.getUTCHours()).toBe(9);
    expect(when.getUTCMinutes()).toBe(30);
    await expect(goesOut(owner)).toContainText('Hawaii — Honolulu');
  } finally {
    await cleanupByKey(db, key);
  }
});
