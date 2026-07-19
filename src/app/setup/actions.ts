'use server';

import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { getCandidateProfile, upsertCandidateProfile } from '@/lib/candidate';
import { can } from '@/lib/permissions';
import { validateCandidateProfile } from '@/lib/profile-validation';
import type { VoiceTone } from '@/domain/types';

export async function upsertProfileAction(formData: FormData) {
  const s = await requireSession();

  // Anyone can complete the one-time initial setup (mirrors the /setup page,
  // which any session without a profile yet gets redirected to). But once a
  // profile exists, only owner/manager may overwrite it — same gate every
  // other settings action uses. Without this, a staff/approver account could
  // call this action directly and rewrite the profile driving every AI draft.
  const existing = await getCandidateProfile(s.campaignId);
  if (existing && !can(s.role, 'edit_settings')) {
    redirect('/dashboard');
  }

  const fullName       = String(formData.get('full_name')       ?? '').trim();
  const preferredName  = String(formData.get('preferred_name')  ?? '').trim();
  const office         = String(formData.get('office')          ?? '').trim();
  const district       = String(formData.get('district')        ?? '').trim();
  const party          = String(formData.get('party')           ?? '').trim();
  const bio            = String(formData.get('bio')             ?? '').trim();
  const keyPositions   = String(formData.get('key_positions')   ?? '')
    .split('\n').map(p => p.trim()).filter(Boolean);
  const voiceTone      = (String(formData.get('voice_tone') ?? 'conversational')) as VoiceTone;
  const targetAudience = String(formData.get('target_audience') ?? '').trim();
  const tagline        = String(formData.get('tagline')         ?? '').trim();
  const photoUrl       = String(formData.get('photo_url')       ?? '').trim() || null;
  const opponentName   = String(formData.get('opponent_name')   ?? '').trim() || null;

  // Validate against the shared rules so garbage (e.g. party 'congress') can't
  // reach the AI-drafting prompts (UX-3).
  const check = validateCandidateProfile({
    fullName, preferredName, office, district, party, bio, tagline, targetAudience,
    voiceTone, googleAlertsRssUrl: '', photoUrl: photoUrl ?? '',
  });
  if (!check.ok) {
    redirect(check.errors.party ? '/setup?error=party' : '/setup?error=required');
  }

  await upsertCandidateProfile(s.campaignId, {
    fullName, preferredName, office, district, party, bio, keyPositions,
    voiceTone, targetAudience, tagline, photoUrl, opponentName,
  });

  redirect('/dashboard');
}
