'use server';

import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { stripe } from '@/lib/stripe';
import { getCampaign, getBillingPlan } from '@/lib/data';
import { can } from '@/lib/permissions';

export async function startCheckoutAction(planId: string): Promise<void> {
  const s = await requireSession();
  if (!stripe) return;
  const plan = await getBillingPlan(planId);
  if (!plan) return;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    client_reference_id: s.campaignId,
    line_items: [{ price: plan.stripeFlatPriceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/dashboard?checkout=success`,
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
