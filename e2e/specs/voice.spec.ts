import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { test, expect } from '../fixtures';
import { PASSWORD } from '../helpers/users';

// Voice state lives on the campaign's candidate profile, so every test runs on
// its own throwaway campaign (plan + active subscription so the billing gate
// passes) with its own owner/staff, and removes all of it in `finally`.
// Seeded campaign A is only touched read-only. Vendors are the app's Mock
// providers: cloneVoice -> 'mock-voice-clone-id', status 'ready'.

const testKey = () => test.info().testId.split('-').pop()!;

async function must(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
}

type Scoped = { camp: string; owner: { id: string; email: string }; staff: { id: string; email: string } };

function scoped(): Scoped {
  const base = `e2e-voice-${testKey()}`;
  return {
    camp: `${base}-camp`,
    owner: { id: `${base}-owner`, email: `${base}-owner@e2e.test` },
    staff: { id: `${base}-staff`, email: `${base}-staff@e2e.test` },
  };
}

async function createCampaign(db: SupabaseClient, s: Scoped, voice?: { status: 'ready' | 'training' | 'failed'; name?: string }) {
  await cleanup(db, s); // leftovers from an aborted earlier run (stable testId-derived ids)
  await must(db.from('campaigns').insert({
    id: s.camp, name: `E2E voice ${s.camp}`, jurisdictions: ['US-TX'], plan_id: 'enterprise',
    subscription_status: 'active', current_period_end: new Date(Date.now() + 20 * 864e5).toISOString(),
  }));
  const hash = bcrypt.hashSync(PASSWORD, 4);
  await must(db.from('users').insert([
    { id: s.owner.id, campaign_id: s.camp, name: 'Voice Owner', role: 'owner', email: s.owner.email, password_hash: hash, locale: 'en' },
    { id: s.staff.id, campaign_id: s.camp, name: 'Voice Staff', role: 'staff', email: s.staff.email, password_hash: hash, locale: 'en' },
  ]));
  await must(db.from('candidate_profiles').insert({
    id: `${s.camp}-profile`, campaign_id: s.camp, full_name: 'Voice Candidate', preferred_name: 'Voice', office: 'City Council',
    district: 'Ward 1', party: 'Independent', bio: 'Voice spec throwaway.', key_positions: ['Roads'],
    voice_tone: 'conversational', target_audience: 'Residents', tagline: 'Voice tagline', opponent_name: 'Opp',
    opponent_aliases: [], monitoring_keywords: ['roads'], content_locale: 'en',
    ...(voice && { self_voice_clone_status: voice.status, self_voice_clone_id: 'e2e-voice-id', self_voice_name: voice.name ?? 'Seeded voice' }),
  }));
}

async function cleanup(db: SupabaseClient, s: Scoped) {
  const ids = [s.owner.id, s.staff.id];
  const { data: files, error: listErr } = await db.storage.from('media').list(`voices/${s.camp}`);
  if (listErr) throw new Error(`storage list failed: ${listErr.message}`);
  for (const dir of files ?? []) {
    const { data: inner, error: innerErr } = await db.storage.from('media').list(`voices/${s.camp}/${dir.name}`);
    if (innerErr) throw new Error(`storage list failed: ${innerErr.message}`);
    const paths = (inner ?? []).map((f) => `voices/${s.camp}/${dir.name}/${f.name}`);
    if (paths.length) {
      const { error } = await db.storage.from('media').remove(paths);
      if (error) throw new Error(`storage cleanup failed: ${error.message}`);
    }
  }
  await must(db.from('audit_entries').delete().in('actor_user_id', ids));
  await must(db.from('login_attempts').delete().in('key', [`email:${s.owner.email}`, `email:${s.staff.email}`]));
  await must(db.from('candidate_profiles').delete().eq('campaign_id', s.camp)); // FK: consent_confirmed_by -> users
  await must(db.from('users').delete().in('id', ids));
  await must(db.from('campaigns').delete().eq('id', s.camp)); // profile cascades
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** 1-second silent 16-bit mono PCM WAV at 8 kHz. */
function silentWav(seconds = 1, rate = 8000): Buffer {
  const data = rate * seconds * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

async function openCloneDialog(page: Page, buttonName: string) {
  await page.goto('/avatars');
  await page.getByRole('button', { name: buttonName }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /I confirm I have permission/ }).check();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'Provide an audio sample' })).toBeVisible();
  return dialog;
}

async function nameAndSubmit(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel('Voice name').fill(name);
  await dialog.getByRole('button', { name: 'Clone voice' }).click();
  await expect(page.getByText('Voice cloning started', { exact: false })).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

async function profileVoice(db: SupabaseClient, camp: string) {
  const { data, error } = await db.from('candidate_profiles')
    .select('self_voice_clone_status, self_voice_clone_id, self_voice_name, self_voice_consent_confirmed_by')
    .eq('campaign_id', camp).single();
  expect(error).toBeNull();
  return data!;
}

test('owner clones a voice from an uploaded WAV file', async ({ page, db }) => {
  const s = scoped();
  try {
    await createCampaign(db, s);
    await login(page, s.owner.email);
    await page.goto('/avatars');
    await expect(page.getByText('No cloned voice yet')).toBeVisible();

    const dialog = await openCloneDialog(page, 'Clone your voice');
    await dialog.getByLabel('Audio file').setInputFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: silentWav() });
    await expect(dialog.getByLabel('Sample preview')).toHaveAttribute('src', /^blob:/);
    await nameAndSubmit(page, 'Upload Voice');

    // Mock HeyGen answers 'training' state first; the profile row proves begin -> upload -> finalize all ran.
    await expect.poll(async () => (await profileVoice(db, s.camp)).self_voice_name).toBe('Upload Voice');
    expect(await profileVoice(db, s.camp)).toMatchObject({
      self_voice_clone_id: 'mock-voice-clone-id', self_voice_consent_confirmed_by: s.owner.id,
    });
    // Sample is removed after cloning.
    const { data: dirs } = await db.storage.from('media').list(`voices/${s.camp}`);
    for (const d of dirs ?? []) {
      const { data: files } = await db.storage.from('media').list(`voices/${s.camp}/${d.name}`);
      expect(files, 'uploaded sample cleaned up after clone').toEqual([]);
    }
  } finally {
    await cleanup(db, s);
  }
});

test('consent is required before the audio step', async ({ page, db }) => {
  const s = scoped();
  try {
    await createCampaign(db, s);
    await login(page, s.owner.email);
    await page.goto('/avatars');
    await page.getByRole('button', { name: 'Clone your voice' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Next' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /I confirm I have permission/ }).check();
    await expect(dialog.getByRole('button', { name: 'Next' })).toBeEnabled();
  } finally {
    await cleanup(db, s);
  }
});

// The fake microphone relies on the desktop project's launch flags in playwright.config.ts
// (incl. --disable-features=AudioServiceOutOfProcess, needed for headless getUserMedia on macOS).

test('owner clones a voice by recording from the (fake) microphone', async ({ page, db }) => {
  const s = scoped();
  try {
    await createCampaign(db, s);
    await page.context().grantPermissions(['microphone']);
    await login(page, s.owner.email);

    const dialog = await openCloneDialog(page, 'Clone your voice');
    await dialog.getByRole('radio', { name: 'Record' }).click();
    await dialog.getByRole('button', { name: 'Start recording' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'Recording' })).toBeVisible();
    const stop = dialog.getByRole('button', { name: 'Stop recording' });
    await expect(stop).toBeEnabled(); // enabled once the clock reaches 1s
    await stop.click();

    await expect(dialog.getByLabel('Sample preview')).toHaveAttribute('src', /^blob:/);
    await expect(dialog.getByRole('button', { name: 'Re-record' })).toBeVisible();
    await expect(dialog.getByText(/shorter than 30 seconds/)).toBeVisible();
    await nameAndSubmit(page, 'Recorded Voice');

    await expect.poll(async () => (await profileVoice(db, s.camp)).self_voice_name).toBe('Recorded Voice');
    expect(await profileVoice(db, s.camp)).toMatchObject({ self_voice_clone_id: 'mock-voice-clone-id' });
  } finally {
    await cleanup(db, s);
  }
});


test('status check moves a training clone to ready and sample preview plays', async ({ page, db }) => {
  const s = scoped();
  try {
    await createCampaign(db, s, { status: 'training', name: 'Training Voice' });
    // The preview audio URL comes from the mock provider (example.com): serve a real WAV so playback can succeed,
    // and record what the app's `new Audio(...)` element was given.
    await page.route('https://example.com/mock-voice-preview.mp3', (r) =>
      r.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(1) }));
    await page.addInitScript(() => {
      const w = window as unknown as { __audio: { src: string; ok: boolean; err?: string }[] };
      w.__audio = [];
      const orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        const rec: { src: string; ok: boolean; err?: string } = { src: this.src, ok: false };
        w.__audio.push(rec);
        const p = orig.call(this);
        p.then(() => { rec.ok = true; }, (e: Error) => { rec.err = String(e); });
        return p;
      };
    });
    await login(page, s.owner.email);
    await page.goto('/avatars');
    await expect(page.getByText('Cloning your voice')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace voice' })).toHaveCount(0); // locked while training

    // The page polls every 5s via checkVoiceCloneStatusAction; mock reports ready.
    await expect(page.getByText('Ready — "Training Voice"')).toBeVisible({ timeout: 20_000 });
    expect((await profileVoice(db, s.camp)).self_voice_clone_status).toBe('ready');

    await page.getByRole('button', { name: 'Play sample' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __audio: unknown[] }).__audio.length)).toBe(1);
    const rec = await page.evaluate(() => (window as unknown as { __audio: { src: string; ok: boolean; err?: string }[] }).__audio[0]);
    expect(rec.src).toBe('https://example.com/mock-voice-preview.mp3');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __audio: { ok: boolean; err?: string }[] }).__audio[0].ok),
      'audio.play() resolved').toBe(true);
    await expect(page.getByText("Couldn't play the sample")).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Play sample' })).toBeEnabled();
  } finally {
    await cleanup(db, s);
  }
});

test('admin assigns a HeyGen voice to a campaign; the profile and admin page show it', async ({ asRole, db }) => {
  const s = scoped();
  const voiceId = `e2e-heygen-voice-${testKey()}`;
  try {
    await createCampaign(db, s);
    const admin = await asRole('admin');
    await admin.goto(`/admin/campaigns/${s.camp}`);
    await expect(admin.getByText('No voice assigned yet')).toBeVisible();

    const form = admin.locator('form').filter({ has: admin.getByRole('button', { name: 'Assign voice' }) });
    await form.getByLabel('HeyGen voice ID').fill(voiceId);
    // consent attestation is required: without it the action refuses. The checkbox is `required`, so bypass
    // the browser check to exercise the server-side refusal, and wait for it before reading the DB.
    await form.evaluate((f) => { (f as HTMLFormElement).noValidate = true; });
    await form.getByRole('button', { name: 'Assign voice' }).click();
    await expect(admin.getByText("Confirm the candidate's consent before assigning.")).toBeVisible();
    const refused = await db.from('candidate_profiles').select('heygen_voice_id').eq('campaign_id', s.camp).single();
    expect(refused.error).toBeNull();
    expect(refused.data?.heygen_voice_id).toBeNull();
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Assign voice' }).click();
    await expect(admin.getByText('Voice assigned.')).toBeVisible();
    await expect(admin.getByText('Voice assigned', { exact: true })).toBeVisible();
    await expect(admin.locator('code', { hasText: voiceId })).toBeVisible();

    // Owner side: the app has no UI surface for the assigned (admin) voice ID; it is used as the
    // video-generation fallback. Verify the persisted state the owner's campaign reads.
    expect((await db.from('candidate_profiles').select('heygen_voice_id').eq('campaign_id', s.camp).single()).data?.heygen_voice_id)
      .toBe(voiceId);
  } finally {
    await cleanup(db, s);
  }
});

test('staff sees the voice status but no clone controls', async ({ page, db }) => {
  const s = scoped();
  try {
    await createCampaign(db, s, { status: 'ready', name: 'Ready Voice' });
    await login(page, s.staff.email);
    await page.goto('/avatars');
    await expect(page.getByRole('heading', { name: 'Your voice' }).or(page.getByText('Your voice', { exact: true })).first()).toBeVisible();
    await expect(page.getByText('Ready — "Ready Voice"')).toBeVisible();
    for (const name of ['Clone your voice', 'Replace voice', 'Play sample']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
  } finally {
    await cleanup(db, s);
  }
});

test('staff on a campaign with no voice sees the read-only message and no clone button', async ({ asRole }) => {
  // Seeded campaign A has no self-voice; read-only, nothing is mutated.
  const page = await asRole('staff');
  await page.goto('/avatars');
  await expect(page.getByText('No voice has been cloned for this campaign yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clone your voice' })).toHaveCount(0);
});
