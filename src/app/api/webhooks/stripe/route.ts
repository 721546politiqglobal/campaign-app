import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { computeSubscriptionUpdate, isNewerEvent, planIdFromPriceId, type StripeSubscriptionStatus } from '@/lib/billing-webhook';
import { getBillingPlans } from '@/lib/data';

const PG_UNIQUE_VIOLATION = '23505';

// Outcome of processing one event. `status` 2xx = done; anything else is
// returned to Stripe so it redelivers.
interface Outcome { status: number; body: Record<string, unknown>; campaignId?: string | null }

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

  // Claim the event FIRST. billing_events.id is the primary key, so two
  // concurrent deliveries of the same event race on the insert and exactly one
  // wins; the loser sees a unique violation and acks as a duplicate. The old
  // select-then-insert had a window where both could process.
  const { error: claimError } = await adminDb.from('billing_events').insert({
    id: event.id,
    type: event.type,
    campaign_id: null,
    payload: event as unknown as Record<string, unknown>,
  });
  if (claimError) {
    if (claimError.code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error(`Stripe webhook: failed to claim event ${event.id} (${event.type}): ${claimError.message}`);
    return NextResponse.json({ error: 'Could not record event; will retry' }, { status: 500 });
  }

  let outcome: Outcome;
  try {
    outcome = await processEvent(stripe, event);
  } catch (e) {
    console.error(`Stripe webhook: processing ${event.id} (${event.type}) threw`, e);
    outcome = { status: 500, body: { error: 'Processing failed; will retry' } };
  }

  if (outcome.status >= 300) {
    // Processing did not complete — release the claim so Stripe's retry gets
    // a clean attempt instead of being treated as a duplicate.
    const { error: releaseError } = await adminDb.from('billing_events').delete().eq('id', event.id);
    if (releaseError) {
      console.error(`Stripe webhook: failed to release claim for ${event.id}: ${releaseError.message}`);
    }
    return NextResponse.json(outcome.body, { status: outcome.status });
  }

  if (outcome.campaignId) {
    const { error: linkError } = await adminDb.from('billing_events')
      .update({ campaign_id: outcome.campaignId }).eq('id', event.id);
    if (linkError) {
      // The event is processed and recorded; the campaign link is informational.
      console.error(`Stripe webhook: failed to link event ${event.id} to campaign ${outcome.campaignId}: ${linkError.message}`);
    }
  }

  return NextResponse.json(outcome.body, { status: outcome.status });
}

async function processEvent(client: NonNullable<typeof stripe>, event: Stripe.Event): Promise<Outcome> {
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const { data: campaign, error: lookupError } = await adminDb
      .from('campaigns')
      .select('id, grace_period_ends_at, subscription_event_created')
      .eq('stripe_subscription_id', sub.id)
      .maybeSingle();
    if (lookupError) {
      console.error(`Stripe webhook: campaign lookup failed for ${sub.id} (event ${event.id}): ${lookupError.message}`);
      return { status: 500, body: { error: 'Lookup failed; will retry' } };
    }

    if (!campaign) {
      console.error(
        `Stripe webhook: no campaign found for stripe_subscription_id ${sub.id} (event ${event.id}, type ${event.type})`
      );
      // Returning non-2xx makes Stripe redeliver, so a campaign row created in
      // a race still gets its transition (BILL-6).
      return { status: 409, body: { error: 'No matching campaign; will retry' } };
    }

    if (!isNewerEvent(event.created, campaign.subscription_event_created ?? null)) {
      // Stale/replayed event — keep the claim (idempotency) but do not touch
      // status, so a late `active` can't regress a newer `past_due` or clear
      // the grace period (BILL-7).
      console.warn(`Stripe webhook: ignoring stale event ${event.id} (created ${event.created}) for campaign ${campaign.id}`);
      return { status: 200, body: { received: true, stale: true }, campaignId: campaign.id };
    }

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

    // Supabase-js reports failures via `error`, not by throwing. Bail out so
    // the claim is released and Stripe retries delivery.
    if (updateError) {
      console.error(`Stripe webhook: campaign update failed for ${campaign.id} (event ${event.id}): ${updateError.message}`);
      return { status: 500, body: { error: 'Update failed; will retry' } };
    }
    return { status: 200, body: { received: true }, campaignId: campaign.id };
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const newCampaignId = session.client_reference_id;
    if (!newCampaignId || !session.subscription || !session.customer) {
      console.error(`Stripe webhook: checkout.session.completed ${event.id} missing client_reference_id/subscription/customer`);
      return { status: 200, body: { received: true, ignored: true } };
    }

    // Same high-water mark as the subscription events: a replayed checkout
    // must not overwrite a newer subscription.updated (e.g. past_due) that
    // already landed for this campaign.
    const { data: campaign, error: lookupError } = await adminDb
      .from('campaigns')
      .select('id, subscription_event_created')
      .eq('id', newCampaignId)
      .maybeSingle();
    if (lookupError) {
      console.error(`Stripe webhook: campaign lookup failed for ${newCampaignId} (event ${event.id}): ${lookupError.message}`);
      return { status: 500, body: { error: 'Lookup failed; will retry' } };
    }
    if (!campaign) {
      console.error(
        `Stripe webhook: checkout.session.completed ${event.id} matched no campaign row for id ${newCampaignId} (subscription ${session.subscription})`
      );
      return { status: 409, body: { error: 'No matching campaign; will retry' } };
    }
    if (!isNewerEvent(event.created, campaign.subscription_event_created ?? null)) {
      console.warn(`Stripe webhook: ignoring stale checkout event ${event.id} (created ${event.created}) for campaign ${campaign.id}`);
      return { status: 200, body: { received: true, stale: true }, campaignId: campaign.id };
    }

    const sub = await client.subscriptions.retrieve(session.subscription as string);
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
      return { status: 500, body: { error: 'Unknown price; will retry' } };
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
      console.error(`Stripe webhook: checkout update failed for ${newCampaignId} (event ${event.id}): ${updateError.message}`);
      return { status: 500, body: { error: 'Update failed; will retry' } };
    }
    // Supabase does not error on an update that matched zero rows (the row
    // was deleted between the lookup and the write).
    if (!updatedRows || updatedRows.length === 0) {
      console.error(
        `Stripe webhook: checkout.session.completed ${event.id} matched no campaign row for id ${newCampaignId} (subscription ${sub.id})`
      );
      return { status: 409, body: { error: 'No matching campaign; will retry' } };
    }
    return { status: 200, body: { received: true }, campaignId: newCampaignId };
  }

  // Unhandled event types are acknowledged (and kept as a claim so a replay
  // doesn't re-run anything if handling is added later).
  return { status: 200, body: { received: true } };
}
