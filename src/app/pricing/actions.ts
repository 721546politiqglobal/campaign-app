'use server';

import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { stripe } from '@/lib/stripe';
import { getCampaign, getBillingPlan } from '@/lib/data';
import { can } from '@/lib/permissions';

export async function startCheckoutAction(planId: string): Promise<void> {
  const s = await requireSession();
  // Server actions are directly callable — the button being hidden in the UI is
  // not a permission check. Only roles that can manage billing may subscribe.
  if (!can(s.role, 'edit_settings')) return;
  if (!stripe) return;

  const [campaign, plan] = await Promise.all([getCampaign(s.campaignId), getBillingPlan(planId)]);
  if (!campaign) return;
  if (!plan) return;

  // Never open a second Checkout for a campaign that already has a live
  // subscription — that would create a duplicate Stripe subscription (and
  // double-bill). Plan switches go through changePlanAction instead. This also
  // covers the window right after paying, before the webhook has landed.
  if (campaign.stripeSubscriptionId) redirect('/billing');

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    client_reference_id: s.campaignId,
    // Reuse the existing Stripe Customer (e.g. from a previously canceled,
    // admin-assigned plan) so Checkout doesn't mint a duplicate one.
    ...(campaign.stripeCustomerId ? { customer: campaign.stripeCustomerId } : {}),
    line_items: [{ price: plan.stripeFlatPriceId, quantity: 1 }],
    // Land back on /pricing, not /dashboard: /pricing is not wrapped in
    // AppFrame, so it renders immediately (no race with the webhook that sets
    // plan_id) and shows the "Payment received — activating your plan" banner.
    success_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/pricing?checkout=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/pricing?checkout=canceled`,
  });
  if (!session.url) return;
  redirect(session.url);
}

export async function changePlanAction(planId: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'edit_settings')) return { ok: false, error: 'Permission denied.' };
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

  const [campaign, plan] = await Promise.all([getCampaign(s.campaignId), getBillingPlan(planId)]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  if (!plan) return { ok: false, error: 'Plan not found.' };
  if (!campaign.stripeSubscriptionId) return { ok: false, error: 'No active subscription to change. Subscribe to a plan first.' };

  const subscription = await stripe.subscriptions.retrieve(campaign.stripeSubscriptionId);
  const currentItemId = subscription.items.data[0]?.id;
  if (!currentItemId) return { ok: false, error: 'Could not find the current subscription item to update.' };

  await stripe.subscriptions.update(campaign.stripeSubscriptionId, {
    items: [{ id: currentItemId, price: plan.stripeFlatPriceId }],
    proration_behavior: 'always_invoice',
  });

  return { ok: true };
}
