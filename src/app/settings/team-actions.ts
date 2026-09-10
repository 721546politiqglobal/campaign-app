'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { adminDb, throwOnError } from '@/lib/supabase';
import { inviteCode } from '@/lib/store';
import { getCampaignSeatUsage } from '@/lib/data';
import { isInvitableRole } from '@/lib/team-roles';

export async function inviteTeammateAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.team' });
  if (!can(s.role, 'manage_team')) return { ok: false, error: t('permissionDenied') };

  const role = String(formData.get('role') ?? '');
  if (!isInvitableRole(role)) return { ok: false, error: t('invalidRole') };

  // Blocks new invites once the campaign already has `limit` members — matches
  // the admin's existing generateInviteAction check. Note: this counts current
  // users only, not other pending unused invites, so it's possible to still
  // exceed the seat limit once several pending invites are all redeemed (same
  // limitation the admin flow has today).
  const seats = await getCampaignSeatUsage(s.campaignId);
  if (seats.limit !== null && seats.used >= seats.limit) {
    return { ok: false, error: t('memberLimitReached') };
  }

  await throwOnError(
    adminDb.from('invite_codes').insert({
      code: inviteCode(),
      campaign_id: s.campaignId,
      role,
      created_by: s.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    'invite_codes.invite_teammate',
  );

  revalidatePath('/settings');
  return { ok: true };
}

export async function removeTeammateAction(userId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.team' });
  if (!can(s.role, 'manage_team')) return { ok: false, error: t('permissionDenied') };

  const { data: target } = await adminDb.from('users').select('id, role, campaign_id').eq('id', userId).maybeSingle();
  if (!target || target.campaign_id !== s.campaignId) return { ok: false, error: t('userNotFound') };
  if (target.role === 'owner') return { ok: false, error: t('ownerCannotBeRemoved') };

  try {
    await throwOnError(adminDb.from('users').delete().eq('id', userId), 'users.remove_teammate');
  } catch {
    return { ok: false, error: t('teammateHasContentCannotRemove') };
  }
  revalidatePath('/settings');
  return { ok: true };
}

export async function changeTeammateRoleAction(userId: string, newRole: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.team' });
  if (!can(s.role, 'manage_team')) return { ok: false, error: t('permissionDenied') };
  if (!isInvitableRole(newRole)) return { ok: false, error: t('invalidRole') };

  const { data: target } = await adminDb.from('users').select('id, role, campaign_id').eq('id', userId).maybeSingle();
  if (!target || target.campaign_id !== s.campaignId) return { ok: false, error: t('userNotFound') };
  if (target.role === 'owner') return { ok: false, error: t('ownerRoleCannotBeChanged') };

  await throwOnError(adminDb.from('users').update({ role: newRole }).eq('id', userId), 'users.change_teammate_role');
  revalidatePath('/settings');
  return { ok: true };
}
