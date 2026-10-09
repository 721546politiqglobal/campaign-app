'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { getCandidateProfile, upsertCandidateProfile } from '@/lib/candidate';
import { can } from '@/lib/permissions';
import { validateCandidateProfile, PROFILE_MAX_LENGTHS } from '@/lib/profile-validation';
import type { ActionFormState } from '@/lib/form-state';
import type { VoiceTone } from '@/domain/types';

// validator key → form input name
const FIELD_NAMES: Record<string, string> = {
  fullName: 'full_name', preferredName: 'preferred_name', office: 'office', district: 'district',
  party: 'party', bio: 'bio', tagline: 'tagline', targetAudience: 'target_audience',
  photoUrl: 'photo_url', voiceTone: 'voice_tone',
};

// Driven by `useFormState` on /setup: validation failures come back as
// field-level, translated messages plus the submitted values so nothing the
// user typed is lost; success redirects into the app (which sends a campaign
// without a plan on to /pricing).
export async function upsertProfileAction(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'setup.errors' });

  // Anyone can complete the one-time initial setup (mirrors the /setup page,
  // which any session without a profile yet gets redirected to). But once a
  // profile exists, only owner/manager may overwrite it — same gate every
  // other settings action uses. Without this, a staff/approver account could
  // call this action directly and rewrite the profile driving every AI draft.
  const existing = await getCandidateProfile(s.campaignId);
  if (existing && !can(s.role, 'edit_settings')) {
    redirect('/dashboard');
  }

  const str = (k: string) => String(formData.get(k) ?? '').trim();
  const fullName       = str('full_name');
  const preferredName  = str('preferred_name');
  const office         = str('office');
  const district       = str('district');
  const party          = str('party');
  const bio            = str('bio');
  const keyPositionsRaw = String(formData.get('key_positions') ?? '');
  const keyPositions   = keyPositionsRaw.split('\n').map(p => p.trim()).filter(Boolean);
  const voiceToneRaw   = String(formData.get('voice_tone') ?? 'conversational');
  const targetAudience = str('target_audience');
  const tagline        = str('tagline');
  const photoUrlRaw    = str('photo_url');
  const opponentName   = str('opponent_name') || null;

  // Never echo anything sensitive here — this is all public campaign profile data.
  const values: Record<string, string> = {
    full_name: fullName, preferred_name: preferredName, office, district, party,
    bio, key_positions: keyPositionsRaw, voice_tone: voiceToneRaw, target_audience: targetAudience,
    tagline, photo_url: photoUrlRaw, opponent_name: opponentName ?? '',
  };

  // Validate against the shared rules so garbage (e.g. party 'congress') can't
  // reach the AI-drafting prompts (UX-3).
  const input = {
    fullName, preferredName, office, district, party, bio, tagline, targetAudience,
    voiceTone: voiceToneRaw, googleAlertsRssUrl: '', photoUrl: photoUrlRaw,
  };
  const check = validateCandidateProfile(input);
  if (!check.ok) {
    const fieldErrors: Record<string, string> = {};
    for (const key of Object.keys(check.errors)) {
      const name = FIELD_NAMES[key] ?? key;
      if (key === 'party') fieldErrors[name] = t('party');
      else if (key === 'photoUrl') fieldErrors[name] = t('url');
      else if (key === 'voiceTone') fieldErrors[name] = t('tone');
      else if (key in PROFILE_MAX_LENGTHS) {
        const value = input[key as keyof typeof PROFILE_MAX_LENGTHS];
        fieldErrors[name] = value.trim()
          ? t('tooLong', { max: PROFILE_MAX_LENGTHS[key as keyof typeof PROFILE_MAX_LENGTHS] })
          : t('required');
      } else fieldErrors[name] = t('required');
    }
    return { ok: false, fieldErrors, values };
  }

  try {
    await upsertCandidateProfile(s.campaignId, {
      fullName, preferredName, office, district, party, bio, keyPositions,
      voiceTone: voiceToneRaw as VoiceTone, targetAudience, tagline,
      photoUrl: photoUrlRaw || null, opponentName,
    });
  } catch (e) {
    console.error('upsertProfileAction: failed to save candidate profile', e);
    return { ok: false, error: t('generic'), values };
  }

  redirect('/dashboard');
}
