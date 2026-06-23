'use server';

import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { upsertCandidateProfile } from '@/lib/candidate';
import type { VoiceTone } from '@/domain/types';

export async function upsertProfileAction(formData: FormData) {
  const s = requireSession();

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

  if (!fullName || !preferredName || !office || !district) {
    redirect('/setup?error=required');
  }

  await upsertCandidateProfile(s.campaignId, {
    fullName, preferredName, office, district, party, bio, keyPositions,
    voiceTone, targetAudience, tagline, photoUrl, opponentName,
  });

  redirect('/dashboard');
}
