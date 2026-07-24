// src/lib/avatars.ts
import { adminDb, throwOnError } from './supabase';
import { Avatar, AvatarStatus, AvatarSourceType, AvatarConsentStatus } from '@/domain/types';

function toAvatar(r: Record<string, unknown>): Avatar {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    name: r.name as string,
    status: r.status as AvatarStatus,
    sourceType: (r.source_type as AvatarSourceType | null) ?? 'photo',
    heygenGroupId: (r.heygen_group_id as string | null) ?? null,
    heygenLookId: (r.heygen_look_id as string | null) ?? null,
    sourcePhotoUrls: (r.source_photo_urls as string[]) ?? [],
    sourceVideoUrl: (r.source_video_url as string | null) ?? null,
    consentStatus: (r.consent_status as AvatarConsentStatus | null) ?? null,
    consentUrl: (r.consent_url as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    consentConfirmedBy: r.consent_confirmed_by as string,
    consentConfirmedAt: r.consent_confirmed_at as string,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
  };
}

export async function listAvatars(campaignId: string): Promise<Avatar[]> {
  const { data } = await adminDb
    .from('avatars')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  return (data ?? []).map(toAvatar);
}

export async function getAvatar(id: string): Promise<Avatar | null> {
  const { data } = await adminDb.from('avatars').select('*').eq('id', id).single();
  return data ? toAvatar(data) : null;
}

export async function insertAvatar(input: {
  id: string;
  campaignId: string;
  name: string;
  sourcePhotoUrls: string[];
  consentConfirmedBy: string;
  createdBy: string;
  status?: AvatarStatus;
  sourceType?: AvatarSourceType;
  sourceVideoUrl?: string | null;
  consentStatus?: AvatarConsentStatus | null;
  consentUrl?: string | null;
  heygenGroupId?: string | null;
  heygenLookId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await throwOnError(
    adminDb.from('avatars').insert({
      id: input.id,
      campaign_id: input.campaignId,
      name: input.name,
      status: input.status ?? 'training',
      source_type: input.sourceType ?? 'photo',
      heygen_group_id: input.heygenGroupId ?? null,
      heygen_look_id: input.heygenLookId ?? null,
      source_photo_urls: input.sourcePhotoUrls,
      source_video_url: input.sourceVideoUrl ?? null,
      consent_status: input.consentStatus ?? null,
      consent_url: input.consentUrl ?? null,
      error_message: input.errorMessage ?? null,
      consent_confirmed_by: input.consentConfirmedBy,
      created_by: input.createdBy,
    }),
    'avatars.insert',
  );
}

export async function updateAvatarStatus(
  id: string,
  status: AvatarStatus,
  opts?: {
    heygenGroupId?: string | null;
    heygenLookId?: string | null;
    errorMessage?: string | null;
    consentStatus?: AvatarConsentStatus | null;
    consentUrl?: string | null;
  },
): Promise<void> {
  await throwOnError(
    adminDb.from('avatars').update({
      status,
      ...(opts?.heygenGroupId !== undefined && { heygen_group_id: opts.heygenGroupId }),
      ...(opts?.heygenLookId !== undefined && { heygen_look_id: opts.heygenLookId }),
      ...(opts?.errorMessage !== undefined && { error_message: opts.errorMessage }),
      ...(opts?.consentStatus !== undefined && { consent_status: opts.consentStatus }),
      ...(opts?.consentUrl !== undefined && { consent_url: opts.consentUrl }),
    }).eq('id', id),
    'avatars.updateStatus',
  );
}

export async function deleteAvatarRow(id: string): Promise<void> {
  await throwOnError(
    adminDb.from('avatars').delete().eq('id', id),
    'avatars.delete',
  );
}
