// src/lib/candidate.ts
import { adminDb } from './supabase';
import { CandidateProfile, VoiceTone } from '@/domain/types';
import { uid } from './store';

function toProfile(r: Record<string, unknown>): CandidateProfile {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    fullName: r.full_name as string,
    preferredName: r.preferred_name as string,
    office: r.office as string,
    district: r.district as string,
    party: (r.party as string) ?? '',
    bio: (r.bio as string) ?? '',
    keyPositions: (r.key_positions as string[]) ?? [],
    voiceTone: (r.voice_tone as VoiceTone) ?? 'conversational',
    targetAudience: (r.target_audience as string) ?? '',
    tagline: (r.tagline as string) ?? '',
    photoUrl: (r.photo_url as string | null) ?? null,
    opponentName: (r.opponent_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function getCandidateProfile(campaignId: string): Promise<CandidateProfile | null> {
  const { data } = await adminDb
    .from('candidate_profiles')
    .select('*')
    .eq('campaign_id', campaignId)
    .single();
  return data ? toProfile(data) : null;
}

export async function upsertCandidateProfile(
  campaignId: string,
  data: Omit<CandidateProfile, 'id' | 'campaignId' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const payload = {
    campaign_id:     campaignId,
    full_name:       data.fullName,
    preferred_name:  data.preferredName,
    office:          data.office,
    district:        data.district,
    party:           data.party,
    bio:             data.bio,
    key_positions:   data.keyPositions,
    voice_tone:      data.voiceTone,
    target_audience: data.targetAudience,
    tagline:         data.tagline,
    photo_url:       data.photoUrl ?? null,
    opponent_name:   data.opponentName ?? null,
    updated_at:      new Date().toISOString(),
  };

  const existing = await getCandidateProfile(campaignId);
  if (existing) {
    await adminDb.from('candidate_profiles').update(payload).eq('campaign_id', campaignId);
  } else {
    await adminDb.from('candidate_profiles').insert({ id: uid(), ...payload });
  }
}
