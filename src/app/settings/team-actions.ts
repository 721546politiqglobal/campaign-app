'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { adminDb, throwOnError } from '@/lib/supabase';
import { inviteCode } from '@/lib/store';
import { getCampaignSeatUsage } from '@/lib/data';
import { isInvitableRole } from '@/lib/team-roles';

export async function inviteTeammateAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_team')) return { ok: false, error: 'Permission denied.' };

  const role = String(formData.get('role') ?? '');
  if (!isInvitableRole(role)) return { ok: false, error: 'Invalid role.' };

  // An unused invite is a reserved seat — count it against the plan limit too,
  // same rule the admin's generateInviteAction already enforces.
  const seats = await getCampaignSeatUsage(s.campaignId);
  if (seats.limit !== null && seats.used >= seats.limit) {
    return { ok: false, error: "Your plan's seat limit is reached. Upgrade your plan to add more teammates." };
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
  if (!can(s.role, 'manage_team')) return { ok: false, error: 'Permission denied.' };

  const { data: target } = await adminDb.from('users').select('id, role, campaign_id').eq('id', userId).maybeSingle();
  if (!target || target.campaign_id !== s.campaignId) return { ok: false, error: 'User not found.' };
  if (target.role === 'owner') return { ok: false, error: "The campaign owner can't be removed." };

  await throwOnError(adminDb.from('users').delete().eq('id', userId), 'users.remove_teammate');
  revalidatePath('/settings');
  return { ok: true };
}

export async function changeTeammateRoleAction(userId: string, newRole: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_team')) return { ok: false, error: 'Permission denied.' };
  if (!isInvitableRole(newRole)) return { ok: false, error: 'Invalid role.' };

  const { data: target } = await adminDb.from('users').select('id, role, campaign_id').eq('id', userId).maybeSingle();
  if (!target || target.campaign_id !== s.campaignId) return { ok: false, error: 'User not found.' };
  if (target.role === 'owner') return { ok: false, error: "The campaign owner's role can't be changed here." };

  await throwOnError(adminDb.from('users').update({ role: newRole }).eq('id', userId), 'users.change_teammate_role');
  revalidatePath('/settings');
  return { ok: true };
}
