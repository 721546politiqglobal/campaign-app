'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { prefixedId, inviteCode } from '@/lib/store';

export async function impersonateAction(userId: string) {
  await requireAdmin();
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
  const s = await requireAdmin();
  const campaignId = String(formData.get('campaignId'));
  const role = String(formData.get('role') ?? 'staff');
  if (!campaignId) return;
  // An unused invite is a reserved seat — count it against the plan limit too.
  const { getCampaignSeatUsage } = await import('@/lib/data');
  const seats = await getCampaignSeatUsage(campaignId);
  if (seats.limit !== null && seats.used >= seats.limit) return;
  const code = inviteCode();
  await throwOnError(
    adminDb.from('invite_codes').insert({
      code,
      campaign_id: campaignId,
      role,
      created_by: s.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    'invite_codes.generate',
  );
  revalidatePath(`/admin/campaigns/${campaignId}`);
}

export async function updateCampaignAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id'));
  const name = String(formData.get('name') ?? '').trim();
  const jurisdictions = String(formData.get('jurisdictions') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const tags = String(formData.get('tags') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!name) return;
  await adminDb.from('campaigns').update({
    name,
    ...(jurisdictions.length ? { jurisdictions } : {}),
    tags,
  }).eq('id', id);

  revalidatePath(`/admin/campaigns/${id}`);
  revalidatePath('/admin');
  revalidatePath('/admin/campaigns');
}

export async function createCampaignAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const jurisdictionsInput = String(formData.get('jurisdictions') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  // Jurisdictions no longer drive disclosure requirements (that's now a single
  // campaign-level default in Settings) — this is just informational metadata,
  // so default it rather than leaving it empty.
  const jurisdictions = jurisdictionsInput.length ? jurisdictionsInput : ['US-FEDERAL'];

  if (!name) return;
  const id = prefixedId('camp-');
  await throwOnError(
    adminDb.from('campaigns').insert({ id, name, jurisdictions }),
    'campaigns.create',
  );
  revalidatePath('/admin');
  revalidatePath('/admin/campaigns');
  redirect(`/admin/campaigns/${id}`);
}

export async function assignPlanAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
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
  // invoice_now finalizes an invoice for un-reported metered usage on the old
  // sub (otherwise that overage revenue is lost); prorate credits the unused
  // portion of the flat fee so the customer isn't charged twice for the period.
  if (campaign.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(campaign.stripeSubscriptionId, { invoice_now: true, prorate: true });
    } catch (err) {
      // Already canceled (e.g. a prior plan change canceled it but failed
      // before saving the replacement, or it was canceled independently) —
      // Stripe reports this as "no such subscription" rather than a
      // clearer "already canceled" error. Nothing left to cancel; proceed.
      if ((err as { code?: string }).code !== 'resource_missing') throw err;
    }
  }

  // With no payment method on the customer yet, Stripe would otherwise
  // error on subscription creation ("no attached payment source").
  // payment_behavior: 'default_incomplete' creates it in 'incomplete'
  // status instead; it becomes 'active' once the campaign pays via the
  // billing portal, and the webhook (Task 9) syncs that status here.
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: plan.stripeFlatPriceId }],
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
    grace_period_ends_at: null,
    current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
  }).eq('id', campaignId);

  revalidatePath(`/admin/campaigns/${campaignId}`);
  return { ok: true };
}

export async function openBillingPortalForCampaignAction(formData: FormData): Promise<void> {
  await requireAdmin();
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
  const s = await requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenGroupId = String(formData.get('heygen_base_avatar_id') ?? '').trim();
  if (!campaignId || !heygenGroupId) return;

  // Same explicit-attestation requirement as createAvatarAction — a
  // super_admin linking a pre-existing HeyGen group must confirm consent was
  // actually obtained; it must never be auto-stamped just because they hit submit.
  const consentConfirmed = formData.get('consent') === 'on';
  if (!consentConfirmed) return;

  const { insertAvatar } = await import('@/lib/avatars');
  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');

  const avatarId = prefixedId('av-');
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

export async function assignVoiceAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenVoiceId = String(formData.get('heygen_voice_id') ?? '').trim();
  if (!campaignId || !heygenVoiceId) return;

  // Same explicit-attestation requirement as assignAvatarAction — a
  // super_admin linking a pre-cloned HeyGen voice must confirm consent was
  // actually obtained; it must never be auto-stamped just because they hit submit.
  const consentConfirmed = formData.get('consent') === 'on';
  if (!consentConfirmed) return;

  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');

  // Same guard as assignAvatarAction: upsertCandidateProfile's insert path
  // requires full_name/preferred_name/office/district (not-null, no defaults)
  // this action doesn't have. Only update when a profile already exists.
  const existingProfile = await getCandidateProfile(campaignId);
  if (existingProfile) {
    await upsertCandidateProfile(campaignId, { heygenVoiceId });
  }

  revalidatePath(`/admin/campaigns/${campaignId}`);
}

export async function addUserAction(formData: FormData) {
  const s = await requireAdmin();
  const campaignId = String(formData.get('campaignId'));
  const name      = String(formData.get('name')  ?? '').trim();
  const email     = String(formData.get('email') ?? '').trim().toLowerCase();
  const role      = String(formData.get('role')  ?? 'staff');
  if (!name || !email || !campaignId) return;

  // Enforce the plan's seat limit (null = unlimited). Bail silently, matching
  // this action's existing duplicate-email failure style (audit finding BILL-10).
  const { getCampaignSeatUsage } = await import('@/lib/data');
  const seats = await getCampaignSeatUsage(campaignId);
  if (seats.limit !== null && seats.used >= seats.limit) return;

  const userId = prefixedId('u-');
  const { error } = await adminDb.from('users').insert({
    id: userId, campaign_id: campaignId, name, email, role,
  });
  // If email already exists the unique index fires — don't throw, just bail
  if (error) return;

  // Auto-generate an invite so the new user can set their password
  const code = inviteCode();
  await throwOnError(
    adminDb.from('invite_codes').insert({
      code,
      campaign_id: campaignId,
      role,
      created_by: s.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
    'invite_codes.auto',
  );

  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/admin/users');
}

export async function removeUserAction(userId: string, campaignId: string) {
  await requireAdmin();
  // A user who authored an avatar (avatars.created_by / consent_confirmed_by →
  // users(id)) cannot be hard-deleted; surface that instead of a silent no-op
  // that leaves a "removed" user still able to log in (audit finding DATA-12).
  await throwOnError(
    adminDb.from('users').delete().eq('id', userId),
    'users.remove',
  );
  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/admin/users');
}

export async function adminLogoutAction() {
  const { signOut } = await import('@/lib/session');
  signOut();
  redirect('/login');
}
