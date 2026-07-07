'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/session';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';

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

export async function assignPlanAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  requireAdmin();
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

  const campaignId = String(formData.get('campaignId') ?? '');
  const planId = String(formData.get('planId') ?? '');
  if (!campaignId || !planId) return { ok: false, error: 'Campaign and plan are required.' };

  const { getCampaign, getBillingPlan } = await import('@/lib/data');
  const [campaign, plan] = await Promise.all([getCampaign(campaignId), getBillingPlan(planId)]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  if (!plan) return { ok: false, error: 'Plan not found.' };

  let customerId = campaign.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: campaign.name,
      metadata: { campaign_id: campaignId },
    });
    customerId = customer.id;
  }

  // Changing plans cancels the old subscription and starts a fresh one —
  // simpler than diffing subscription items, and plan changes are an
  // infrequent admin action, not a self-serve upgrade flow.
  if (campaign.stripeSubscriptionId) {
    await stripe.subscriptions.cancel(campaign.stripeSubscriptionId);
  }

  // With no payment method on the customer yet, Stripe would otherwise
  // error on subscription creation ("no attached payment source").
  // payment_behavior: 'default_incomplete' creates it in 'incomplete'
  // status instead; it becomes 'active' once the campaign pays via the
  // billing portal, and the webhook (Task 9) syncs that status here.
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: plan.stripeFlatPriceId }, { price: plan.stripeMeteredPriceId }],
    payment_behavior: 'default_incomplete',
  });

  // Stripe SDK v22 moved current_period_end off the Subscription object and
  // onto each SubscriptionItem — pull it from the first item instead.
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;

  await adminDb.from('campaigns').update({
    plan_id: plan.id,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    monthly_cost_cap_cents: plan.includedUsageCents,
    grace_period_ends_at: null,
    current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
  }).eq('id', campaignId);

  revalidatePath(`/admin/campaigns/${campaignId}`);
  return { ok: true };
}

export async function openBillingPortalForCampaignAction(formData: FormData): Promise<void> {
  requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '');
  if (!stripe || !campaignId) return;

  const { getCampaign } = await import('@/lib/data');
  const campaign = await getCampaign(campaignId);
  if (!campaign?.stripeCustomerId) return;

  const session = await stripe.billingPortal.sessions.create({
    customer: campaign.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/admin/campaigns/${campaignId}`,
  });
  redirect(session.url);
}

export async function assignAvatarAction(formData: FormData) {
  const s = requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenGroupId = String(formData.get('heygen_base_avatar_id') ?? '').trim();
  if (!campaignId || !heygenGroupId) return;

  const { insertAvatar } = await import('@/lib/avatars');
  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');

  const avatarId = 'av-' + Math.random().toString(36).slice(2, 9);
  await insertAvatar({
    id: avatarId,
    campaignId,
    name: 'Default avatar',
    status: 'ready',
    heygenGroupId,
    sourcePhotoUrls: [],
    consentConfirmedBy: s.userId,
    createdBy: s.userId,
  });

  // upsertCandidateProfile's insert path requires full_name/preferred_name/office/
  // district (not-null, no defaults) — fields this action doesn't have. If the
  // campaign hasn't been through /setup yet, there's no row to update, and
  // inserting a placeholder one would silently skip that onboarding flow (its
  // redirect is gated purely on row existence). So: only activate the avatar
  // when a profile already exists. Otherwise the avatar row still gets created
  // here, ready for the owner to activate themselves once they've set up.
  const existingProfile = await getCandidateProfile(campaignId);
  if (existingProfile) {
    await upsertCandidateProfile(campaignId, {
      activeAvatarId: avatarId,
      heygenBaseAvatarId: heygenGroupId,
      heygenAvatarId: null,
    });
  }

  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/avatars');
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
