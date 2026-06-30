'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/session';
import { adminDb } from '@/lib/supabase';

export async function impersonateAction(userId: string) {
  requireAdmin();
  const { setSessionCookie } = await import('@/lib/session');
  const { data: user } = await adminDb.from('users').select('*').eq('id', userId).single();
  if (!user) return;
  setSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role,
    campaignId: user.campaign_id,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });
  redirect('/dashboard');
}

export async function generateInviteAction(formData: FormData) {
  const s = requireAdmin();
  const campaignId = String(formData.get('campaignId'));
  const role = String(formData.get('role') ?? 'staff');
  if (!campaignId) return;
  const code = 'inv_' + Math.random().toString(36).slice(2, 14);
  await adminDb.from('invite_codes').insert({
    code,
    campaign_id: campaignId,
    role,
    created_by: s.userId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  revalidatePath(`/admin/campaigns/${campaignId}`);
}

export async function updateCampaignAction(formData: FormData) {
  requireAdmin();
  const id = String(formData.get('id'));
  const name = String(formData.get('name') ?? '').trim();
  const capDollars = Number(formData.get('cap'));
  const jurisdictions = String(formData.get('jurisdictions') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!name) return;
  await adminDb.from('campaigns').update({
    name,
    monthly_cost_cap_cents: Number.isFinite(capDollars) && capDollars >= 0
      ? Math.round(capDollars * 100) : undefined,
    ...(jurisdictions.length ? { jurisdictions } : {}),
  }).eq('id', id);

  revalidatePath(`/admin/campaigns/${id}`);
  revalidatePath('/admin');
}

export async function assignAvatarAction(formData: FormData) {
  requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenBaseAvatarId = String(formData.get('heygen_base_avatar_id') ?? '').trim() || null;
  if (!campaignId) return;
  const { upsertCandidateProfile } = await import('@/lib/candidate');
  await upsertCandidateProfile(campaignId, { heygenBaseAvatarId });
  revalidatePath(`/admin/campaigns/${campaignId}`);
}

export async function createCampaignAction(formData: FormData) {
  requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const capDollars = Number(formData.get('cap') || 1000);
  const jurisdictions = String(formData.get('jurisdictions') ?? 'US-FEDERAL')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!name) return;
  const id = 'camp-' + Math.random().toString(36).slice(2, 8);
  await adminDb.from('campaigns').insert({
    id, name, jurisdictions,
    monthly_cost_cap_cents: Math.round(capDollars * 100),
  });
  revalidatePath('/admin');
  revalidatePath('/admin/campaigns');
  redirect(`/admin/campaigns/${id}`);
}

export async function addUserAction(formData: FormData) {
  const s = requireAdmin();
  const campaignId = String(formData.get('campaignId'));
  const name      = String(formData.get('name')  ?? '').trim();
  const email     = String(formData.get('email') ?? '').trim().toLowerCase();
  const role      = String(formData.get('role')  ?? 'staff');
  if (!name || !email || !campaignId) return;

  const userId = 'u-' + Math.random().toString(36).slice(2, 9);
  const { error } = await adminDb.from('users').insert({
    id: userId, campaign_id: campaignId, name, email, role,
  });
  // If email already exists the unique index fires — don't throw, just bail
  if (error) return;

  // Auto-generate an invite so the new user can set their password
  const code = 'inv_' + Math.random().toString(36).slice(2, 14);
  await adminDb.from('invite_codes').insert({
    code,
    campaign_id: campaignId,
    role,
    created_by: s.userId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/admin/users');
}

export async function removeUserAction(userId: string, campaignId: string) {
  requireAdmin();
  await adminDb.from('users').delete().eq('id', userId);
  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/admin/users');
}

export async function updateDisclosureRuleAction(formData: FormData) {
  requireAdmin();
  const jurisdiction = String(formData.get('jurisdiction'));
  const requiredText = String(formData.get('requiredText') ?? '').trim() || null;
  const placement = String(formData.get('placement') ?? 'overlay');
  const blackoutDays = formData.get('blackoutDays')
    ? Number(formData.get('blackoutDays')) : null;

  await adminDb.from('disclosure_rules').update({
    requires_ai_label: formData.get('requiresAiLabel') === 'on',
    required_text: requiredText,
    placement,
    blackout_days_before_election: blackoutDays,
    needs_legal_review: formData.get('needsLegalReview') === 'on',
  }).eq('jurisdiction', jurisdiction);

  revalidatePath('/admin/disclosure-rules');
}

export async function adminLogoutAction() {
  const { signOut } = await import('@/lib/session');
  signOut();
  redirect('/login');
}
