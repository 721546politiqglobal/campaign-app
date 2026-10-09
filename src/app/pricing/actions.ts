'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { stripe } from '@/lib/stripe';
import { adminDb } from '@/lib/supabase';
import { getCampaign, getBillingPlan } from '@/lib/data';
import { can } from '@/lib/permissions';
import type { ActionFormState } from '@/lib/form-state';

// Bound per plan (`startCheckoutAction.bind(null, plan.id)`) and driven by
// `useFormState` on /pricing: every refusal comes back as a translated
// `{ ok: false, error }` the card renders inline; success redirects to Stripe
// Checkout. Raw Stripe errors are logged, never shown.
export async function startCheckoutAction(planId: string, _prev: ActionFormState, _formData: FormData): Promise<ActionFormState> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.pricing' });
  // Server actions are directly callable — the button being hidden in the UI is
  // not a permission check. Only roles that can manage billing may subscribe.
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('permissionDenied') };
  if (!stripe) return { ok: false, error: t('stripeNotConfigured') };

  const [campaign, plan] = await Promise.all([getCampaign(s.campaignId), getBillingPlan(planId)]);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };
  if (!plan) return { ok: false, error: t('planNotFound') };

  // Never open a second Checkout for a campaign that already has a live
  // subscription — that would create a duplicate Stripe subscription (and
  // double-bill). Plan switches go through changePlanAction instead. This also
  // covers the window right after paying, before the webhook has landed.
  if (campaign.stripeSubscriptionId) redirect('/billing');

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: s.campaignId,
      // Reuse the existing Stripe Customer (e.g. from a previously canceled,
      // admin-assigned plan) so Checkout doesn't mint a duplicate one.
      ...(campaign.stripeCustomerId ? { customer: campaign.stripeCustomerId } : {}),
      line_items: [{ price: plan.stripeFlatPriceId, quantity: 1 }],
      // Land back on /pricing, not /dashboard: /pricing is not wrapped in
      // AppFrame, so it renders immediately (no race with the webhook that sets
      // plan_id) and shows the "Payment received — activating your plan" state,
      // which polls until the webhook lands.
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/pricing?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/pricing?checkout=canceled`,
    });
  } catch (e) {
    // A bad/unsynced Stripe price id or a wrong-mode API key surfaces here as
    // a StripeInvalidRequestError. Log the real reason; show a friendly one.
    console.error('startCheckoutAction: Stripe checkout session failed', e);
    return { ok: false, error: t('couldNotStartCheckout') };
  }
  if (!session.url) {
    console.error('startCheckoutAction: Stripe returned a checkout session without a url', session.id);
    return { ok: false, error: t('couldNotStartCheckout') };
  }
  redirect(session.url);
}

export async function changePlanAction(planId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.pricing' });
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('permissionDenied') };
  if (!stripe) return { ok: false, error: t('stripeNotConfigured') };

  const [campaign, plan] = await Promise.all([getCampaign(s.campaignId), getBillingPlan(planId)]);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };
  if (!plan) return { ok: false, error: t('planNotFound') };
  if (!campaign.stripeSubscriptionId) return { ok: false, error: t('noActiveSubscription') };

  try {
    const subscription = await stripe.subscriptions.retrieve(campaign.stripeSubscriptionId);
    const currentItemId = subscription.items.data[0]?.id;
    if (!currentItemId) return { ok: false, error: t('subscriptionItemNotFound') };

    await stripe.subscriptions.update(campaign.stripeSubscriptionId, {
      items: [{ id: currentItemId, price: plan.stripeFlatPriceId }],
      // The UI confirms this with the user first: the difference for the rest
      // of the current period is invoiced immediately.
      proration_behavior: 'always_invoice',
    });
  } catch (e) {
    // A bad/unsynced Stripe price id, a canceled subscription, or a wrong-mode
    // API key surfaces here as a Stripe error. Log the real reason; show a
    // friendly, translated one.
    console.error('changePlanAction: Stripe subscription update failed', e);
    return { ok: false, error: t('couldNotChangePlan') };
  }

  // The Stripe subscription's price is updated above, but nothing else in the
  // app knows the plan changed until this is written — without it, /billing
  // (and every quota check) kept reading the OLD plan forever even though
  // Stripe had genuinely switched.
  await adminDb.from('campaigns').update({ plan_id: plan.id }).eq('id', s.campaignId);

  return { ok: true };
}
