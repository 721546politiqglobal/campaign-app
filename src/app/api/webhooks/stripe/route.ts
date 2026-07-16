import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { computeSubscriptionUpdate, isNewerEvent, type StripeSubscriptionStatus } from '@/lib/billing-webhook';

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
        const { error: updateError } = await adminDb.from('campaigns').update({
          subscription_status: update.subscriptionStatus,
          grace_period_ends_at: update.gracePeriodEndsAt,
          subscription_event_created: event.created,
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
