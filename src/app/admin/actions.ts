'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin, type Session } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { prefixedId, inviteCode } from '@/lib/store';
import { inviteExpiresAt } from '@/lib/invites';

// Every admin action reports back instead of silently returning: the UI shows
// `error` inline / as a toast, and `values` lets a form keep what was typed.
export type AdminActionResult =
  | { ok: true; error?: undefined; values?: undefined }
  | { ok: false; error: string; values?: Record<string, string> };

// Roles a super_admin may hand out. `owner` is included on purpose (a brand-new
// campaign needs its first owner); `super_admin` never is.
const ASSIGNABLE_ROLES = ['owner', 'manager', 'staff', 'approver'] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const LIST_ITEM_MAX = 40;
const LIST_MAX = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PG_UNIQUE_VIOLATION = '23505';

function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

function parseList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

async function adminT(s: Session) {
  return getTranslations({ locale: s.locale, namespace: 'errors.admin' });
}

async function writeAdminAudit(entry: {
  campaignId: string; actorUserId: string; action: string; entityType: string; entityId: string | null;
  details?: Record<string, unknown>;
}) {
  await throwOnError(
    adminDb.from('audit_entries').insert({
      campaign_id: entry.campaignId,
      actor_user_id: entry.actorUserId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      details: entry.details ?? null,
    }),
    `audit_entries.${entry.action}`,
  );
}

export async function impersonateAction(userId: string): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  const { setSessionCookie } = await import('@/lib/session');

  const { data: user, error } = await adminDb.from('users').select('*').eq('id', userId).maybeSingle();
  if (error) {
    console.error('impersonateAction: lookup failed', error);
    return { ok: false, error: t('genericError') };
  }
  if (!user) return { ok: false, error: t('userNotFound') };
  // Impersonation is for stepping into a tenant; it must never mint another
  // super_admin session (that would also let a stolen admin cookie hop admins).
  if (user.role === 'super_admin') return { ok: false, error: t('cannotImpersonateSuperAdmin') };
  if (!user.campaign_id) return { ok: false, error: t('userHasNoCampaign') };

  // Record who stepped into whose account before the session changes hands.
  try {
    await writeAdminAudit({
      campaignId: user.campaign_id, actorUserId: s.userId,
      action: 'admin_impersonate', entityType: 'user', entityId: user.id,
      details: { admin_user_id: s.userId, target_role: user.role },
    });
  } catch (e) {
    console.error('impersonateAction: audit write failed', e);
    return { ok: false, error: t('genericError') };
  }

  setSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role,
    campaignId: user.campaign_id,
    locale: user.locale,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });
  redirect('/dashboard');
}

export async function generateInviteAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const role = String(formData.get('role') ?? 'staff');
  if (!campaignId) return { ok: false, error: t('campaignIdRequired') };
  if (!isAssignableRole(role)) return { ok: false, error: t('invalidRole') };

  // An unused invite is a reserved seat — count it against the plan limit too.
  const { getCampaignSeatUsage } = await import('@/lib/data');
  const seats = await getCampaignSeatUsage(campaignId);
  if (seats.limit !== null && seats.used >= seats.limit) {
    return { ok: false, error: t('seatLimitReached', { limit: seats.limit }) };
  }

  try {
    await throwOnError(
      adminDb.from('invite_codes').insert({
        code: inviteCode(),
        campaign_id: campaignId,
        role,
        created_by: s.userId,
        expires_at: inviteExpiresAt(),
      }),
      'invite_codes.generate',
    );
  } catch (e) {
    console.error('generateInviteAction failed', e);
    return { ok: false, error: t('genericError') };
  }
  revalidatePath(`/admin/campaigns/${campaignId}`);
  return { ok: true };
}

export async function updateCampaignAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  const id = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const jurisdictions = parseList(formData.get('jurisdictions'));
  const tags = parseList(formData.get('tags'));
  const values = { name, jurisdictions: jurisdictions.join(', '), tags: tags.join(', ') };

  if (!id) return { ok: false, error: t('campaignIdRequired'), values };
  if (!name) return { ok: false, error: t('campaignNameRequired'), values };
  if (name.length > NAME_MAX) return { ok: false, error: t('campaignNameTooLong', { max: NAME_MAX }), values };
  for (const list of [jurisdictions, tags]) {
    if (list.length > LIST_MAX || list.some(v => v.length > LIST_ITEM_MAX)) {
      return { ok: false, error: t('listTooLong', { items: LIST_MAX, chars: LIST_ITEM_MAX }), values };
    }
  }

  // Jurisdictions are informational metadata now, so clearing the field is a
  // legitimate edit — always write the parsed list (empty included).
  try {
    const rows = await throwOnError(
      adminDb.from('campaigns').update({ name, jurisdictions, tags }).eq('id', id).select('id'),
      'campaigns.update',
    );
    // supabase-js does not error on an update that matched zero rows.
    if (!rows || rows.length === 0) return { ok: false, error: t('campaignNotFound'), values };
  } catch (e) {
    console.error('updateCampaignAction failed', e);
    return { ok: false, error: t('genericError'), values };
  }

  revalidatePath(`/admin/campaigns/${id}`);
  revalidatePath('/admin');
  revalidatePath('/admin/campaigns');
  return { ok: true };
}

export async function createCampaignAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  const name = String(formData.get('name') ?? '').trim();
  const jurisdictionsInput = parseList(formData.get('jurisdictions'));
  // Jurisdictions no longer drive disclosure requirements (that's now a single
  // campaign-level default in Settings) — this is just informational metadata,
  // so default it rather than leaving it empty.
  const jurisdictions = jurisdictionsInput.length ? jurisdictionsInput : ['US-FEDERAL'];
  const values = { name, jurisdictions: jurisdictionsInput.join(', ') };

  if (!name) return { ok: false, error: t('campaignNameRequired'), values };
  if (name.length > NAME_MAX) return { ok: false, error: t('campaignNameTooLong', { max: NAME_MAX }), values };
  if (jurisdictions.length > LIST_MAX || jurisdictions.some(v => v.length > LIST_ITEM_MAX)) {
    return { ok: false, error: t('listTooLong', { items: LIST_MAX, chars: LIST_ITEM_MAX }), values };
  }

  const id = prefixedId('camp-');
  try {
    await throwOnError(
      adminDb.from('campaigns').insert({ id, name, jurisdictions }),
      'campaigns.create',
    );
  } catch (e) {
    console.error('createCampaignAction failed', e);
    return { ok: false, error: t('genericError'), values };
  }
  revalidatePath('/admin');
  revalidatePath('/admin/campaigns');
  redirect(`/admin/campaigns/${id}`);
}

export async function assignPlanAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  if (!stripe) return { ok: false, error: t('stripeNotConfigured') };

  const campaignId = String(formData.get('campaignId') ?? '');
  const planId = String(formData.get('planId') ?? '');
  if (!campaignId || !planId) return { ok: false, error: t('campaignAndPlanRequired') };

  const { getCampaign, getBillingPlan } = await import('@/lib/data');
  const [campaign, plan] = await Promise.all([getCampaign(campaignId), getBillingPlan(planId)]);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };
  if (!plan) return { ok: false, error: t('planNotFound') };

  const previousSubscriptionId = campaign.stripeSubscriptionId;

  let customerId = campaign.stripeCustomerId;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create(
        { name: campaign.name, metadata: { campaign_id: campaignId } },
        // A double-submit (or a retry after the DB write below failed) replays
        // the same customer instead of minting a second one.
        { idempotencyKey: `campaign-customer:${campaignId}` },
      );
      customerId = customer.id;
    } catch (err) {
      console.error('assignPlanAction: customers.create failed', err);
      return { ok: false, error: t('stripeError') };
    }
  }

  // Changing plans cancels the old subscription and starts a fresh one —
  // simpler than diffing subscription items, and plan changes are an
  // infrequent admin action, not a self-serve upgrade flow.
  // invoice_now finalizes an invoice for un-reported metered usage on the old
  // sub (otherwise that overage revenue is lost); prorate credits the unused
  // portion of the flat fee so the customer isn't charged twice for the period.
  if (previousSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(previousSubscriptionId, { invoice_now: true, prorate: true });
    } catch (err) {
      // Already canceled (e.g. a prior plan change canceled it but failed
      // before saving the replacement, or it was canceled independently) —
      // Stripe reports this as "no such subscription" rather than a
      // clearer "already canceled" error. Nothing left to cancel; proceed.
      if ((err as { code?: string }).code !== 'resource_missing') {
        console.error('assignPlanAction: subscriptions.cancel failed', err);
        return { ok: false, error: t('stripeError') };
      }
    }
  }

  // With no payment method on the customer yet, Stripe would otherwise
  // error on subscription creation ("no attached payment source").
  // payment_behavior: 'default_incomplete' creates it in 'incomplete'
  // status instead; it becomes 'active' once the campaign pays via the
  // billing portal, and the webhook syncs that status here.
  //
  // The idempotency key is deterministic for "this campaign, this plan/price,
  // replacing this subscription": a double-click or a retry after a failed DB
  // write gets the SAME subscription back from Stripe instead of a duplicate
  // that bills the customer twice.
  const idempotencyKey = `assign-plan:${campaignId}:${plan.id}:${plan.stripeFlatPriceId}:${previousSubscriptionId ?? 'none'}`;
  let subscription;
  try {
    subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: plan.stripeFlatPriceId }],
        payment_behavior: 'default_incomplete',
        metadata: { campaign_id: campaignId, plan_id: plan.id },
      },
      { idempotencyKey },
    );
  } catch (err) {
    console.error('assignPlanAction: subscriptions.create failed', err);
    if (previousSubscriptionId) {
      // The old subscription is gone but nothing replaced it. Don't leave the
      // row claiming an active subscription that no longer exists — record
      // the cancellation so the billing gate reflects reality and the admin
      // can retry.
      const { error } = await adminDb.from('campaigns').update({
        stripe_customer_id: customerId,
        stripe_subscription_id: null,
        subscription_status: 'canceled',
        current_period_end: null,
      }).eq('id', campaignId);
      if (error) console.error('assignPlanAction: failed to record canceled subscription', error);
      revalidatePath(`/admin/campaigns/${campaignId}`);
      return { ok: false, error: t('planChangeFailedAfterCancel') };
    }
    return { ok: false, error: t('stripeError') };
  }

  // Stripe SDK v22 moved current_period_end off the Subscription object and
  // onto each SubscriptionItem — pull it from the first item instead.
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;

  // Conditional write: only replace the subscription we actually read at the
  // top. If another admin changed the row meanwhile, zero rows match and we
  // must not clobber their assignment.
  let update = adminDb.from('campaigns').update({
    plan_id: plan.id,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    grace_period_ends_at: null,
    current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
  }).eq('id', campaignId);
  update = previousSubscriptionId
    ? update.eq('stripe_subscription_id', previousSubscriptionId)
    : update.is('stripe_subscription_id', null);

  let updated: { id: string }[] | null;
  try {
    updated = await throwOnError(update.select('id'), 'campaigns.assign_plan');
  } catch (e) {
    console.error('assignPlanAction: campaign update failed', e);
    return { ok: false, error: t('genericError') };
  }

  if (!updated || updated.length === 0) {
    // Someone else re-pointed the row while we were talking to Stripe. If it
    // already points at the subscription we just (idempotently) created, this
    // was a concurrent double-submit and the work is done; otherwise our new
    // subscription is an orphan — cancel it so the customer isn't billed twice.
    const fresh = await getCampaign(campaignId);
    if (fresh?.stripeSubscriptionId !== subscription.id) {
      try {
        await stripe.subscriptions.cancel(subscription.id);
      } catch (err) {
        console.error('assignPlanAction: failed to cancel orphaned subscription', subscription.id, err);
      }
      return { ok: false, error: t('campaignChangedRetry') };
    }
  }

  revalidatePath(`/admin/campaigns/${campaignId}`);
  return { ok: true };
}

export async function openBillingPortalForCampaignAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  const campaignId = String(formData.get('campaignId') ?? '');
  if (!stripe) return { ok: false, error: t('stripeNotConfigured') };
  if (!campaignId) return { ok: false, error: t('campaignIdRequired') };

  const { getCampaign } = await import('@/lib/data');
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };
  if (!campaign.stripeCustomerId) return { ok: false, error: t('noStripeCustomer') };

  let url: string;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: campaign.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/admin/campaigns/${campaignId}`,
    });
    url = session.url;
  } catch (err) {
    console.error('openBillingPortalForCampaignAction failed', err);
    return { ok: false, error: t('stripeError') };
  }
  redirect(url);
}

const DEFAULT_AVATAR_NAME = 'Default avatar';

export async function assignAvatarAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenGroupId = String(formData.get('heygen_base_avatar_id') ?? '').trim();
  if (!campaignId) return { ok: false, error: t('campaignIdRequired') };
  if (!heygenGroupId) return { ok: false, error: t('avatarIdRequired') };
  if (heygenGroupId.length > NAME_MAX) return { ok: false, error: t('avatarIdInvalid') };

  // Same explicit-attestation requirement as createAvatarAction — a
  // super_admin linking a pre-existing HeyGen group must confirm consent was
  // actually obtained; it must never be auto-stamped just because they hit submit.
  if (formData.get('consent') !== 'on') return { ok: false, error: t('consentRequired') };

  const { insertAvatar } = await import('@/lib/avatars');
  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');

  try {
    // Re-submitting must not mint another avatar row each time (each row
    // consumes the plan's avatar quota). Reuse a row already linked to this
    // HeyGen group, else re-point the admin-created default row, else insert.
    const sameGroup = await throwOnError(
      adminDb.from('avatars').select('id').eq('campaign_id', campaignId).eq('heygen_group_id', heygenGroupId).limit(1),
      'avatars.lookup_group',
    );
    const defaultRow = sameGroup?.length ? null : await throwOnError(
      adminDb.from('avatars').select('id').eq('campaign_id', campaignId).eq('name', DEFAULT_AVATAR_NAME).limit(1),
      'avatars.lookup_default',
    );
    const match = sameGroup?.[0] ?? defaultRow?.[0] ?? null;

    let avatarId: string;
    if (match) {
      avatarId = match.id;
      await throwOnError(
        adminDb.from('avatars').update({
          heygen_group_id: heygenGroupId,
          status: 'ready',
          error_message: null,
          consent_confirmed_by: s.userId,
        }).eq('id', avatarId),
        'avatars.assign',
      );
    } else {
      avatarId = prefixedId('av-');
      await insertAvatar({
        id: avatarId,
        campaignId,
        name: DEFAULT_AVATAR_NAME,
        status: 'ready',
        heygenGroupId,
        sourcePhotoUrls: [],
        consentConfirmedBy: s.userId,
        createdBy: s.userId,
      });
    }

    // upsertCandidateProfile's insert path requires full_name/preferred_name/office/
    // district (not-null, no defaults) — fields this action doesn't have. If the
    // campaign hasn't been through /setup yet, there's no row to update, and
    // inserting a placeholder one would silently skip that onboarding flow (its
    // redirect is gated purely on row existence). So: only activate the avatar
    // when a profile already exists. Otherwise the avatar row is still ready
    // for the owner to activate themselves once they've set up.
    const existingProfile = await getCandidateProfile(campaignId);
    if (existingProfile) {
      await upsertCandidateProfile(campaignId, {
        activeAvatarId: avatarId,
        heygenBaseAvatarId: heygenGroupId,
        heygenAvatarId: null,
      });
    }
  } catch (e) {
    console.error('assignAvatarAction failed', e);
    return { ok: false, error: t('genericError') };
  }

  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/avatars');
  return { ok: true };
}

export async function assignVoiceAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const heygenVoiceId = String(formData.get('heygen_voice_id') ?? '').trim();
  if (!campaignId) return { ok: false, error: t('campaignIdRequired') };
  if (!heygenVoiceId) return { ok: false, error: t('voiceIdRequired') };
  if (heygenVoiceId.length > NAME_MAX) return { ok: false, error: t('voiceIdInvalid') };

  // Same explicit-attestation requirement as assignAvatarAction — a
  // super_admin linking a pre-cloned HeyGen voice must confirm consent was
  // actually obtained; it must never be auto-stamped just because they hit submit.
  if (formData.get('consent') !== 'on') return { ok: false, error: t('consentRequired') };

  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');

  // Same guard as assignAvatarAction: upsertCandidateProfile's insert path
  // requires full_name/preferred_name/office/district (not-null, no defaults)
  // this action doesn't have. Only update when a profile already exists.
  const existingProfile = await getCandidateProfile(campaignId);
  if (!existingProfile) return { ok: false, error: t('profileNotSetUp') };

  try {
    await upsertCandidateProfile(campaignId, { heygenVoiceId });
  } catch (e) {
    console.error('assignVoiceAction failed', e);
    return { ok: false, error: t('genericError') };
  }

  revalidatePath(`/admin/campaigns/${campaignId}`);
  return { ok: true };
}

export async function addUserAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const name      = String(formData.get('name')  ?? '').trim();
  const email     = String(formData.get('email') ?? '').trim().toLowerCase();
  const role      = String(formData.get('role')  ?? 'staff');
  const values = { name, email, role };

  if (!campaignId) return { ok: false, error: t('campaignIdRequired'), values };
  if (!name) return { ok: false, error: t('nameRequired'), values };
  if (name.length > NAME_MAX) return { ok: false, error: t('nameTooLong', { max: NAME_MAX }), values };
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return { ok: false, error: t('invalidEmail'), values };
  if (!isAssignableRole(role)) return { ok: false, error: t('invalidRole'), values };

  // Enforce the plan's seat limit (null = unlimited).
  const { getCampaignSeatUsage } = await import('@/lib/data');
  const seats = await getCampaignSeatUsage(campaignId);
  if (seats.limit !== null && seats.used >= seats.limit) {
    return { ok: false, error: t('seatLimitReached', { limit: seats.limit }), values };
  }

  const userId = prefixedId('u-');
  const { error } = await adminDb.from('users').insert({
    id: userId, campaign_id: campaignId, name, email, role,
  });
  if (error) {
    // The email unique index fires → tell the admin instead of silently bailing.
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: t('emailInUse'), values };
    }
    console.error('addUserAction: users.insert failed', error);
    return { ok: false, error: t('genericError'), values };
  }

  // Auto-generate an invite so the new user can set their password.
  try {
    await throwOnError(
      adminDb.from('invite_codes').insert({
        code: inviteCode(),
        campaign_id: campaignId,
        role,
        created_by: s.userId,
        expires_at: inviteExpiresAt(),
      }),
      'invite_codes.auto',
    );
    await writeAdminAudit({
      campaignId, actorUserId: s.userId,
      action: 'admin_user_added', entityType: 'user', entityId: userId,
      details: { role },
    });
  } catch (e) {
    console.error('addUserAction: invite/audit write failed', e);
    revalidatePath(`/admin/campaigns/${campaignId}`);
    return { ok: false, error: t('userAddedInviteFailed'), values };
  }

  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function removeUserAction(userId: string, campaignId: string): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await adminT(s);
  if (!userId || !campaignId) return { ok: false, error: t('userNotFound') };
  if (userId === s.userId) return { ok: false, error: t('cannotRemoveSelf') };

  const { data: target, error } = await adminDb.from('users')
    .select('id, role, campaign_id').eq('id', userId).maybeSingle();
  if (error) {
    console.error('removeUserAction: lookup failed', error);
    return { ok: false, error: t('genericError') };
  }
  // Scope to the campaign the admin is looking at — a stale page must not
  // delete a user who has since moved elsewhere.
  if (!target || target.campaign_id !== campaignId) return { ok: false, error: t('userNotFound') };
  if (target.role === 'super_admin') return { ok: false, error: t('cannotRemoveSuperAdmin') };
  if (target.role === 'owner') {
    const { count, error: countError } = await adminDb.from('users')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).eq('role', 'owner').neq('id', userId);
    if (countError) {
      console.error('removeUserAction: owner count failed', countError);
      return { ok: false, error: t('genericError') };
    }
    if ((count ?? 0) === 0) return { ok: false, error: t('lastOwnerCannotBeRemoved') };
  }

  // A user who authored an avatar (avatars.created_by / consent_confirmed_by →
  // users(id)) cannot be hard-deleted; surface that instead of a silent no-op
  // that leaves a "removed" user still able to log in (audit finding DATA-12).
  try {
    await throwOnError(
      adminDb.from('users').delete().eq('id', userId).eq('campaign_id', campaignId),
      'users.remove',
    );
  } catch (e) {
    console.error('removeUserAction: delete failed', e);
    return { ok: false, error: t('userHasContentCannotRemove') };
  }

  try {
    await writeAdminAudit({
      campaignId, actorUserId: s.userId,
      action: 'admin_user_removed', entityType: 'user', entityId: userId,
      details: { role: target.role },
    });
  } catch (e) {
    // The removal itself succeeded — don't report it as failed over the log line.
    console.error('removeUserAction: audit write failed', e);
  }

  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function adminLogoutAction() {
  const { signOut } = await import('@/lib/session');
  signOut();
  redirect('/login');
}
