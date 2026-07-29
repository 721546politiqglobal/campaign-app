import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { computeSubscriptionUpdate, isNewerEvent, planIdFromPriceId, type StripeSubscriptionStatus } from '@/lib/billing-webhook';
import { getBillingPlans } from '@/lib/data';

export async function POST(req: NextRequest) {
  if (!stripe) return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });

  const signature = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    return NextResponse.json({ error: `Invalid signature: ${e}` }, { status: 400 });
  }

  const { data: alreadyProcessed, error: alreadyProcessedError } = await adminDb
    .from('billing_events')
    .select('id')
    .eq('id', event.id)
    .maybeSingle();
  if (alreadyProcessedError) {
    console.error(
      `Stripe webhook: failed to check idempotency for event ${event.id} (${event.type}): ${alreadyProcessedError.message}`
    );
  }
  if (alreadyProcessed) return NextResponse.json({ received: true, duplicate: true });

  let campaignId: string | null = null;

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const { data: campaign } = await adminDb
      .from('campaigns')
      .select('id, grace_period_ends_at, subscription_event_created')
      .eq('stripe_subscription_id', sub.id)
      .maybeSingle();

    if (campaign) {
      campaignId = campaign.id;
      if (!isNewerEvent(event.created, campaign.subscription_event_created ?? null)) {
        // Stale/replayed event — record it for idempotency (below) but do not
        // touch status, so a late `active` can't regress a newer `past_due`
        // or clear the grace period (BILL-7).
        console.warn(`Stripe webhook: ignoring stale event ${event.id} (created ${event.created}) for campaign ${campaign.id}`);
      } else {
        const status: StripeSubscriptionStatus =
          event.type === 'customer.subscription.deleted' ? 'canceled' : (sub.status as StripeSubscriptionStatus);
        const update = computeSubscriptionUpdate(status, new Date(), campaign.grace_period_ends_at);
        // Stripe SDK v22.3.0 moved current_period_end off Subscription and onto
        // each SubscriptionItem.
        const currentPeriodEnd = sub.items.data[0]?.current_period_end;
        const priceId = sub.items.data[0]?.price?.id;
        const plans = await getBillingPlans();
        const planId = planIdFromPriceId(priceId, plans);
        const { error: updateError } = await adminDb.from('campaigns').update({
          subscription_status: update.subscriptionStatus,
          grace_period_ends_at: update.gracePeriodEndsAt,
          subscription_event_created: event.created,
          plan_id: planId ?? undefined,
          current_period_end: event.type === 'customer.subscription.deleted'
            ? null
            : currentPeriodEnd
              ? new Date(currentPeriodEnd * 1000).toISOString()
              : null,
        }).eq('id', campaign.id);

        // Supabase-js reports failures via `error`, not by throwing. Bail out
        // before marking the event processed so Stripe retries delivery.
        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      }
    } else {
      console.error(
        `Stripe webhook: no campaign found for stripe_subscription_id ${sub.id} (event ${event.id}, type ${event.type})`
      );
      // Do NOT record this event as processed. Returning non-2xx makes Stripe
      // redeliver, so a campaign row created in a race still gets its
      // transition. Recording it here would permanently drop the transition (BILL-6).
      return NextResponse.json({ error: 'No matching campaign; will retry' }, { status: 409 });
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const newCampaignId = session.client_reference_id;
    if (newCampaignId && session.subscription && session.customer) {
      campaignId = newCampaignId;
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      const priceId = sub.items.data[0]?.price?.id;
      const plans = await getBillingPlans();
      const planId = planIdFromPriceId(priceId, plans);
      // Writing plan_id: null here would leave a paying customer with no plan —
      // which the billing gate treats as "never subscribed" and blocks. Fail
      // loudly instead so Stripe retries once billing_plans is in sync
      // (e.g. after syncBillingPlansAction has been run for this price).
      if (!planId) {
        console.error(
          `Stripe webhook: checkout.session.completed ${event.id} could not resolve a plan for price ${priceId ?? 'unknown'} (campaign ${newCampaignId}); refusing to write plan_id: null — will retry`
        );
        return NextResponse.json({ error: 'Unknown price; will retry' }, { status: 500 });
      }
      const currentPeriodEnd = sub.items.data[0]?.current_period_end;
      const { data: updatedRows, error: updateError } = await adminDb.from('campaigns').update({
        plan_id: planId,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: sub.id,
        subscription_status: sub.status,
        subscription_event_created: event.created,
        current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
      }).eq('id', newCampaignId).select('id');
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
      // Supabase does not error on an update that matched zero rows. Without
      // this check a paid checkout whose campaign row doesn't exist yet (or was
      // deleted) would be silently marked processed and never retried.
      if (!updatedRows || updatedRows.length === 0) {
        console.error(
          `Stripe webhook: checkout.session.completed ${event.id} matched no campaign row for id ${newCampaignId} (subscription ${sub.id})`
        );
        return NextResponse.json({ error: 'No matching campaign; will retry' }, { status: 409 });
      }
    } else {
      console.error(`Stripe webhook: checkout.session.completed ${event.id} missing client_reference_id/subscription/customer`);
    }
  }

  const { error: billingEventInsertError } = await adminDb.from('billing_events').insert({
    id: event.id,
    type: event.type,
    campaign_id: campaignId,
    payload: event as unknown as Record<string, unknown>,
  });

  if (billingEventInsertError) {
    console.error(
      `Stripe webhook: failed to insert billing_events row for event ${event.id} (${event.type}): ${billingEventInsertError.message}`
    );
  }

  return NextResponse.json({ received: true });
}
