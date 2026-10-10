import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect, allowConsole } from '../fixtures';
import { USERS } from '../helpers/users';
import { createDraft, approve } from '../helpers/content';
import { createThrowawayCampaign, deleteThrowawayCampaign, uiLogin, must, type Throwaway } from '../helpers/throwaway-campaign';

// Avatars and avatar limits are campaign-level state, so every mutating test
// runs in its own throwaway campaign + owner (helpers/throwaway-campaign.ts);
// campaign A's seeded avatar (e2e-avatar-a) is only ever read. HeyGen is the
// app's Mock providers in this build: photo avatars train instantly, video
// avatars get consent 'approved', and the first status poll reports ready.

const testKey = () => test.info().testId.split('-').pop()!;
const CLIP = join(process.cwd(), 'e2e/fixtures/task-9/clip.mp4');

const L = {
  fromPhotos: 'From photos', fromVideo: 'From video', next: 'Next', createAvatar: 'Create Avatar',
  createVideoAvatar: 'Create Video Avatar', setActive: 'Set active', generateLook: 'Generate look',
  creationStarted: 'Avatar creation started — this can take a few minutes.',
  videoCreationStarted: 'Video avatar creation started — send the candidate the consent link shown on this avatar.',
  deleted: 'Avatar deleted.', lookGenerated: /^New look generated/,
  photoConsent: /I confirm I have the candidate's permission to use these photos/,
  videoConsent: /I confirm I have the candidate's permission to record and use this video/,
  onlyImages: 'Only image files are allowed.', tooLarge: 'Each photo must be under 10 MB.',
  onlyMp4: 'Only MP4 or QuickTime video files are allowed.',
  planLimit: 'Your plan includes up to 2 avatars. Delete one or upgrade your plan to create another.',
  settingsSaved: 'Video settings saved.', saveSettings: 'Save video settings',
  noAvatar: 'No avatar is set up for this campaign yet. Add one on the Avatars page first.',
  generateVideo: 'Generate avatar video', continueVideo: 'Video looks good — Continue →',
};

// ── tiny assets generated in-test ───────────────────────────────────────────
const CRC = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A valid 64×64 RGB PNG (solid colour from `seed`). */
function png(seed: number) {
  const w = 64, h = 64;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [seed * 40 % 256, 120, 200]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const photos = (n = 4) => Array.from({ length: n }, (_, i) => ({ name: `p${i + 1}.png`, mimeType: 'image/png', buffer: png(i + 1) }));

// ── throwaway tenant ────────────────────────────────────────────────────────
async function removeStorage(db: SupabaseClient, campaignId: string) {
  const bucket = db.storage.from('media');
  const { data: dirs, error } = await bucket.list(`avatars/${campaignId}`);
  if (error) throw new Error(`storage list failed: ${error.message}`);
  for (const d of dirs ?? []) {
    const { data: files, error: e2 } = await bucket.list(`avatars/${campaignId}/${d.name}`);
    if (e2) throw new Error(`storage list failed: ${e2.message}`);
    if (files?.length) {
      const { error: e3 } = await bucket.remove(files.map((f) => `avatars/${campaignId}/${d.name}/${f.name}`));
      if (e3) throw new Error(`storage remove failed: ${e3.message}`);
    }
  }
}

async function withTenant(db: SupabaseClient, page: Page, body: (t: Throwaway) => Promise<void>,
  opts: Parameters<typeof createThrowawayCampaign>[2] = {}) {
  const t = await createThrowawayCampaign(db, testKey(), { suffix: 't9', ...opts });
  try {
    await uiLogin(page, t.owner.email);
    await body(t);
  } finally {
    try { await removeStorage(db, t.campaignId); } finally { await deleteThrowawayCampaign(db, t.campaignId); }
  }
}

async function seedAvatar(db: SupabaseClient, t: Throwaway, id: string, name: string, extra: Record<string, unknown> = {}) {
  await must(db.from('avatars').insert({
    id, campaign_id: t.campaignId, name, status: 'ready', heygen_group_id: `grp-${id}`, heygen_look_id: `look-${id}`,
    source_photo_urls: [], source_type: 'photo', consent_confirmed_by: t.owner.id, created_by: t.owner.id, ...extra,
  }));
}

/** A select that always yields an array (must() throws on error). */
const rows = async (q: PromiseLike<{ data: any[] | null; error: { message: string } | null }>) => (await must(q)) ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
const avatarRows = async (db: SupabaseClient, campaignId: string) =>
  rows(db.from('avatars').select('*').eq('campaign_id', campaignId));
const row = (page: Page, name: string) => page.locator('.av-row', { hasText: name });
const dialog = (page: Page) => page.getByRole('dialog');
const toast = (page: Page, text: string | RegExp) => page.locator('.toast-stack').getByText(text);

/** Photo wizard through to the Create button, leaving the dialog on step 3. */
async function fillPhotoWizard(page: Page, name: string, files = photos()) {
  await page.getByRole('button', { name: L.fromPhotos }).first().click();
  await dialog(page).getByRole('checkbox', { name: L.photoConsent }).check();
  await dialog(page).getByRole('button', { name: L.next }).click();
  await dialog(page).locator('input[type="file"]').setInputFiles(files);
  await dialog(page).getByRole('button', { name: L.next }).click();
  await dialog(page).getByLabel('Avatar name').fill(name);
}

async function fillVideoWizard(page: Page, name: string, file: string | { name: string; mimeType: string; buffer: Buffer } = CLIP) {
  await page.getByRole('button', { name: L.fromVideo }).first().click();
  await dialog(page).getByRole('checkbox', { name: L.videoConsent }).check();
  await dialog(page).getByRole('button', { name: L.next }).click();
  await dialog(page).locator('input[type="file"]').setInputFiles(file);
  await dialog(page).getByRole('button', { name: L.next }).click();
  await dialog(page).getByLabel('Avatar name').fill(name);
}

test.describe('avatars', () => {
  test('photo avatar: upload, finalize, status poll to ready, set active', async ({ page, db }) => {
    // Nav-link prefetches aborted at navigation/teardown (tenant deleted in finally); seen under parallel load.
    allowConsole(/Failed to fetch RSC payload for http:\/\/localhost:3100\/\S*\. Falling back to browser navigation/);
    await withTenant(db, page, async (t) => {
      await page.goto('/avatars');
      await expect(page.getByText('No avatars yet')).toBeVisible();
      await fillPhotoWizard(page, 'Photo twin');
      await dialog(page).getByRole('button', { name: L.createAvatar }).click();
      await expect(toast(page, L.creationStarted)).toBeVisible({ timeout: 30_000 });

      // Row appears; finalize leaves it 'training' and the page's status poll
      // (checkAvatarStatusAction) moves it to ready against the mock provider.
      await expect(row(page, 'Photo twin')).toBeVisible();
      await expect(row(page, 'Photo twin').getByText('Ready')).toBeVisible({ timeout: 30_000 });
      const [a] = await avatarRows(db, t.campaignId);
      expect(a).toMatchObject({ name: 'Photo twin', status: 'ready', source_type: 'photo', heygen_group_id: 'mock-group-id', heygen_look_id: 'mock-look-id', consent_confirmed_by: t.owner.id });
      expect(a.source_photo_urls).toHaveLength(4);

      await row(page, 'Photo twin').getByRole('button', { name: L.setActive }).click();
      await expect(toast(page, 'Active avatar updated.')).toBeVisible();
      await expect(row(page, 'Photo twin').getByText('Active', { exact: true })).toBeVisible();
      const [p] = await rows(db.from('candidate_profiles').select('active_avatar_id, heygen_base_avatar_id, heygen_avatar_id').eq('campaign_id', t.campaignId));
      expect(p).toEqual({ active_avatar_id: a.id, heygen_base_avatar_id: 'mock-group-id', heygen_avatar_id: 'mock-look-id' });
    });
  });

  test('prompt look generation on an existing avatar replaces its look', async ({ page, db }) => {
    await withTenant(db, page, async (t) => {
      await seedAvatar(db, t, `${t.campaignId}-av1`, 'Look target');
      await page.goto('/avatars');
      await row(page, 'Look target').getByRole('button', { name: L.generateLook }).click();
      const d = dialog(page);
      await d.getByLabel('Name').fill('Studio look');
      const gen = d.getByRole('button', { name: L.generateLook });
      await expect(gen).toBeDisabled(); // prompt is required
      await d.getByLabel(/^Prompt/).fill('studio lighting, navy suit');
      await gen.click();
      await expect(toast(page, L.lookGenerated)).toBeVisible({ timeout: 30_000 });
      await expect(dialog(page)).toHaveCount(0);
      const [a] = await avatarRows(db, t.campaignId);
      expect(a.heygen_look_id).toBe('mock-prompt-look-id');
    });
  });

  test('video avatar (digital twin): upload clip, finalize, consent approved, ready', async ({ page, db }) => {
    await withTenant(db, page, async (t) => {
      await page.goto('/avatars');
      await fillVideoWizard(page, 'Video twin');
      // The clip is ~2s, under HeyGen's 30s recommendation (only a warning). Headless Chromium has no H.264
      // decoder, so the metadata probe never fires and the warning is not asserted.
      await dialog(page).getByRole('button', { name: L.createVideoAvatar }).click();
      await expect(toast(page, L.videoCreationStarted)).toBeVisible({ timeout: 30_000 });

      await expect(row(page, 'Video twin')).toBeVisible();
      await expect(row(page, 'Video twin').getByText('Ready')).toBeVisible({ timeout: 30_000 });
      const [a] = await avatarRows(db, t.campaignId);
      // Consent state recorded by the mock: approved (so no consent-link step remains).
      expect(a).toMatchObject({
        name: 'Video twin', status: 'ready', source_type: 'digital_twin', consent_status: 'approved',
        consent_url: 'https://app.heygen.com/mock-consent', heygen_group_id: 'mock-video-group-id', heygen_look_id: 'mock-video-look-id',
      });
      expect(a.source_video_url).toContain(`/avatars/${t.campaignId}/${a.id}/training.mp4`);
      await expect(row(page, 'Video twin').getByRole('button', { name: 'Copy consent link' })).toHaveCount(0);
    });
  });

  test('delete avatar removes it from the list and the db; deleting the active one clears the profile', async ({ page, db }) => {
    await withTenant(db, page, async (t) => {
      await seedAvatar(db, t, `${t.campaignId}-keep`, 'Keeper');
      await seedAvatar(db, t, `${t.campaignId}-gone`, 'Doomed');
      await seedAvatar(db, t, `${t.campaignId}-act`, 'Active one');
      await must(db.from('candidate_profiles').update({ active_avatar_id: `${t.campaignId}-act`, heygen_base_avatar_id: 'g', heygen_avatar_id: 'l' }).eq('campaign_id', t.campaignId));
      await page.goto('/avatars');

      await row(page, 'Doomed').getByRole('button', { name: 'Delete Doomed' }).click();
      await page.getByRole('alertdialog').or(dialog(page)).getByRole('button', { name: 'Cancel' }).click();
      await expect(row(page, 'Doomed')).toBeVisible(); // cancelling keeps it
      await row(page, 'Doomed').getByRole('button', { name: 'Delete Doomed' }).click();
      await page.getByRole('button', { name: 'Delete avatar' }).click();
      await expect(toast(page, L.deleted)).toBeVisible();
      await expect(row(page, 'Doomed')).toHaveCount(0);
      expect((await avatarRows(db, t.campaignId)).map((a) => a.name).sort()).toEqual(['Active one', 'Keeper']);

      await row(page, 'Active one').getByRole('button', { name: 'Delete Active one' }).click();
      await page.getByRole('button', { name: 'Delete avatar' }).click();
      await expect(row(page, 'Active one')).toHaveCount(0);
      const [p] = await rows(db.from('candidate_profiles').select('active_avatar_id, heygen_base_avatar_id, heygen_avatar_id').eq('campaign_id', t.campaignId));
      expect(p).toEqual({ active_avatar_id: null, heygen_base_avatar_id: null, heygen_avatar_id: null });
      await expect(row(page, 'Keeper')).toBeVisible();
    });
  });

  test('plan avatar limit blocks creation (photo and video) with the limit message', async ({ page, db }) => {
    // Starter allows 2 avatars; the cap counts avatar rows (quotaGate.checkAvatarCap),
    // not feature_usage_counters, so the throwaway campaign is filled to the limit.
    await withTenant(db, page, async (t) => {
      await seedAvatar(db, t, `${t.campaignId}-a1`, 'Slot one');
      await seedAvatar(db, t, `${t.campaignId}-a2`, 'Slot two');
      await page.goto('/avatars');
      await fillPhotoWizard(page, 'Over limit');
      await dialog(page).getByRole('button', { name: L.createAvatar }).click();
      await expect(toast(page, L.planLimit)).toBeVisible({ timeout: 30_000 });
      await dialog(page).getByRole('button', { name: 'Back' }).click(); // keep dialog state; close it
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toHaveCount(0);
      // Let the photo attempt's toast auto-dismiss (5s), so the next one can only come from the video attempt.
      await expect(toast(page, L.planLimit)).toHaveCount(0);

      await fillVideoWizard(page, 'Over limit video');
      await dialog(page).getByRole('button', { name: L.createVideoAvatar }).click();
      await expect(toast(page, L.planLimit)).toHaveCount(1, { timeout: 30_000 });
      await expect(toast(page, L.planLimit)).toBeVisible();
      expect(await avatarRows(db, t.campaignId)).toHaveLength(2);
    }, { plan: 'starter' });
  });

  test('upload validation: non-image, oversized image, non-mp4 video are rejected', async ({ page, db }) => {
    await withTenant(db, page, async (t) => {
      await page.goto('/avatars');

      // Fewer than the 4-photo minimum keeps Next disabled.
      await page.getByRole('button', { name: L.fromPhotos }).first().click();
      await dialog(page).getByRole('checkbox', { name: L.photoConsent }).check();
      await dialog(page).getByRole('button', { name: L.next }).click();
      await dialog(page).locator('input[type="file"]').setInputFiles(photos(3));
      await expect(dialog(page).getByRole('button', { name: L.next })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toHaveCount(0);

      // A non-image among the photos.
      const withText = [...photos(3), { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') }];
      await fillPhotoWizard(page, 'Bad type', withText);
      await dialog(page).getByRole('button', { name: L.createAvatar }).click();
      await expect(toast(page, L.onlyImages)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toHaveCount(0);

      // An 11 MB image (limit is 10 MB per photo).
      const big = [...photos(3), { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(11 * 1024 * 1024, 1) }];
      await fillPhotoWizard(page, 'Too big', big);
      await dialog(page).getByRole('button', { name: L.createAvatar }).click();
      await expect(toast(page, L.tooLarge)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toHaveCount(0);

      // A video file that is not mp4/quicktime.
      await fillVideoWizard(page, 'Bad video', { name: 'clip.webm', mimeType: 'video/webm', buffer: readFileSync(CLIP) });
      await dialog(page).getByRole('button', { name: L.createVideoAvatar }).click();
      await expect(toast(page, L.onlyMp4)).toBeVisible();

      expect(await avatarRows(db, t.campaignId)).toHaveLength(0);
    });
  });

  test('staff and approver see avatars read-only: no create, set-active, look or delete controls', async ({ asRole, db }) => {
    const { data } = await db.from('avatars').select('name').eq('id', 'e2e-avatar-a').single();
    for (const role of ['staff', 'approver'] as const) {
      const page = await asRole(role);
      await page.goto('/avatars');
      await expect(row(page, data!.name)).toBeVisible();
      await expect(page.getByRole('button', { name: L.fromPhotos })).toHaveCount(0);
      await expect(page.getByRole('button', { name: L.fromVideo })).toHaveCount(0);
      await expect(page.getByRole('button', { name: L.setActive })).toHaveCount(0);
      await expect(page.getByRole('button', { name: L.generateLook })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
      // Video settings are owner/manager-only too.
      await expect(page.getByRole('button', { name: L.saveSettings })).toHaveCount(0);
    }
    void USERS;
  });
});

test.describe('video', () => {
  test('video settings: aspect ratio saves and persists', async ({ page, db }) => {
    await withTenant(db, page, async (t) => {
      await page.goto('/avatars');
      const ratio = page.getByRole('radio', { name: '9:16' });
      await expect(page.getByRole('radio', { name: '16:9' })).toBeChecked();
      await ratio.click();
      await page.getByRole('button', { name: L.saveSettings }).click();
      await expect(toast(page, L.settingsSaved)).toBeVisible();
      const [p] = await rows(db.from('candidate_profiles').select('video_aspect_ratio').eq('campaign_id', t.campaignId));
      expect(p.video_aspect_ratio).toBe('9:16');
      await page.reload();
      await expect(page.getByRole('radio', { name: '9:16' })).toBeChecked();
    });
  });

  test('generating a video with no avatar configured is blocked with a clear message', async ({ page, db }) => {
    await withTenant(db, page, async (t) => {
      const id = await createDraft(page, `T9 no avatar ${testKey()}`, 'Script body', { type: 'reel' });
      await approve(page, id);
      await page.getByRole('button', { name: L.generateVideo }).click();
      await expect(page.locator('.wizard-error')).toContainText(L.noAvatar);
      const [c] = await rows(db.from('content_items').select('video_status, video_job_id').eq('id', id));
      expect(c).toEqual({ video_status: null, video_job_id: null });
      void t;
    });
  });

  test('reel: generate video -> processing -> completed via status poll -> confirm attaches media', async ({ page, db }) => {
    await withTenant(db, page, async (t) => {
      await must(db.from('candidate_profiles').update({ heygen_avatar_id: 'mock-look-id', heygen_voice_id: 'mock-voice' }).eq('campaign_id', t.campaignId));
      const id = await createDraft(page, `T9 reel ${testKey()}`, 'Reel script body', { type: 'reel' });
      await approve(page, id); // video types go back to in_review for the video step
      await expect(page.getByRole('button', { name: L.generateVideo })).toBeVisible();

      await page.getByRole('button', { name: L.generateVideo }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Generating your video' })).toBeVisible();
      const [processing] = await rows(db.from('content_items').select('video_status, video_job_id, media_url').eq('id', id));
      expect(processing).toMatchObject({ video_status: 'processing', video_job_id: 'mock-video-id', media_url: null });

      // The wizard polls getVideoStatusAction every 5s; the mock reports completed.
      const confirm = page.getByRole('button', { name: L.continueVideo });
      await expect(confirm).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('video.wizard-video')).toHaveAttribute('src', 'https://example.com/demo-video.mp4');
      const [done] = await rows(db.from('content_items').select('video_status, media_url').eq('id', id));
      expect(done).toEqual({ video_status: 'completed', media_url: 'https://example.com/demo-video.mp4' });

      await confirm.click();
      await expect.poll(async () => (await rows(db.from('content_items').select('status').eq('id', id)))[0].status, { timeout: 20_000 }).toBe('approved');
      const [final] = await rows(db.from('content_items').select('status, media_url').eq('id', id));
      expect(final).toEqual({ status: 'approved', media_url: 'https://example.com/demo-video.mp4' });
      const audits = await rows(db.from('audit_entries').select('action').eq('entity_id', id));
      expect(audits.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['generate_video', 'confirm_video']));
    });
  });
});
