// src/lib/avatars.ts
import { adminDb } from './supabase';
import { Avatar, AvatarStatus } from '@/domain/types';

function toAvatar(r: Record<string, unknown>): Avatar {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    name: r.name as string,
    status: r.status as AvatarStatus,
    heygenGroupId: (r.heygen_group_id as string | null) ?? null,
    sourcePhotoUrls: (r.source_photo_urls as string[]) ?? [],
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
  heygenGroupId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await adminDb.from('avatars').insert({
    id: input.id,
    campaign_id: input.campaignId,
    name: input.name,
    status: input.status ?? 'training',
    heygen_group_id: input.heygenGroupId ?? null,
    source_photo_urls: input.sourcePhotoUrls,
    error_message: input.errorMessage ?? null,
    consent_confirmed_by: input.consentConfirmedBy,
    created_by: input.createdBy,
  });
}

export async function updateAvatarStatus(
  id: string,
  status: AvatarStatus,
  opts?: { heygenGroupId?: string | null; errorMessage?: string | null },
): Promise<void> {
  await adminDb.from('avatars').update({
    status,
    ...(opts?.heygenGroupId !== undefined && { heygen_group_id: opts.heygenGroupId }),
    ...(opts?.errorMessage !== undefined && { error_message: opts.errorMessage }),
  }).eq('id', id);
}

export async function deleteAvatarRow(id: string): Promise<void> {
  await adminDb.from('avatars').delete().eq('id', id);
}
