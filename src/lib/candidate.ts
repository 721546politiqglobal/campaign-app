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
    opponentAliases: (r.opponent_aliases as string[]) ?? [],
    monitoringKeywords: (r.monitoring_keywords as string[]) ?? [],
    opponentTwitterHandle: (r.opponent_twitter_handle as string | null) ?? null,
    opponentInstagramHandle: (r.opponent_instagram_handle as string | null) ?? null,
    opponentFacebookPage: (r.opponent_facebook_page as string | null) ?? null,
    googleAlertsRssUrl: (r.google_alerts_rss_url as string | null) ?? null,
    heygenBaseAvatarId: (r.heygen_base_avatar_id as string | null) ?? null,
    heygenAvatarId: (r.heygen_avatar_id as string | null) ?? null,
    activeAvatarId: (r.active_avatar_id as string | null) ?? null,
    elevenLabsVoiceId: (r.elevenlabs_voice_id as string | null) ?? null,
    videoAspectRatio: (r.video_aspect_ratio as '16:9' | '9:16' | '1:1') ?? '16:9',
    videoBackground: (r.video_background as string) ?? 'plain',
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
  data: Partial<Omit<CandidateProfile, 'id' | 'campaignId' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  const payload = {
    campaign_id:     campaignId,
    ...(data.fullName       !== undefined && { full_name:       data.fullName }),
    ...(data.preferredName  !== undefined && { preferred_name:  data.preferredName }),
    ...(data.office         !== undefined && { office:          data.office }),
    ...(data.district       !== undefined && { district:        data.district }),
    ...(data.party          !== undefined && { party:           data.party }),
    ...(data.bio            !== undefined && { bio:             data.bio }),
    ...(data.keyPositions   !== undefined && { key_positions:   data.keyPositions }),
    ...(data.voiceTone      !== undefined && { voice_tone:      data.voiceTone }),
    ...(data.targetAudience !== undefined && { target_audience: data.targetAudience }),
    ...(data.tagline        !== undefined && { tagline:         data.tagline }),
    ...(data.photoUrl       !== undefined && { photo_url:       data.photoUrl ?? null }),
    ...(data.opponentName   !== undefined && { opponent_name:   data.opponentName ?? null }),
    ...(data.opponentAliases          !== undefined && { opponent_aliases:           data.opponentAliases }),
    ...(data.monitoringKeywords       !== undefined && { monitoring_keywords:        data.monitoringKeywords }),
    ...(data.opponentTwitterHandle    !== undefined && { opponent_twitter_handle:    data.opponentTwitterHandle ?? null }),
    ...(data.opponentInstagramHandle  !== undefined && { opponent_instagram_handle:  data.opponentInstagramHandle ?? null }),
    ...(data.opponentFacebookPage     !== undefined && { opponent_facebook_page:     data.opponentFacebookPage ?? null }),
    ...(data.googleAlertsRssUrl       !== undefined && { google_alerts_rss_url:      data.googleAlertsRssUrl ?? null }),
    ...(data.heygenBaseAvatarId !== undefined && { heygen_base_avatar_id: data.heygenBaseAvatarId ?? null }),
    ...(data.heygenAvatarId    !== undefined && { heygen_avatar_id:    data.heygenAvatarId ?? null }),
    ...(data.activeAvatarId    !== undefined && { active_avatar_id:    data.activeAvatarId ?? null }),
    ...(data.elevenLabsVoiceId !== undefined && { elevenlabs_voice_id: data.elevenLabsVoiceId ?? null }),
    ...(data.videoAspectRatio  !== undefined && { video_aspect_ratio:  data.videoAspectRatio }),
    ...(data.videoBackground   !== undefined && { video_background:    data.videoBackground }),
    updated_at:      new Date().toISOString(),
  };

  const existing = await getCandidateProfile(campaignId);
  if (existing) {
    await adminDb.from('candidate_profiles').update(payload).eq('campaign_id', campaignId);
  } else {
    await adminDb.from('candidate_profiles').insert({ id: uid(), ...payload });
  }
}
