import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { sumUsageCents, buildSyncKey } from '@/lib/billing-sync';
import { METER_EVENT_NAME } from '@/lib/billing-catalog';

// Keep `until` behind the wall clock so a usage_events row whose DB-side
// created_at lands just after this run reads can't fall into the gap between
// `until` and the next run's `since` (= this until) and be skipped forever (BILL-8).
const SYNC_SAFETY_LAG_MS = 60_000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!stripe) return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });

  // 'incomplete' is deliberately allowed through BillingGate as a pre-payment
  // grace window right after plan assignment (see domain/billing.test.ts) — but
  // that means usage incurred during the window must still be synced here, or
  // it's tracked internally (counts against monthly_cost_cap_cents) and never
  // actually billed to Stripe once the subscription completes payment.
  const { data: campaigns } = await adminDb
    .from('campaigns')
    .select('id, stripe_customer_id, subscription_status')
    .not('stripe_customer_id', 'is', null)
    .in('subscription_status', ['trialing', 'active', 'past_due', 'incomplete']);

  const results: { campaignId: string; synced: boolean; error?: string }[] = [];

  for (const campaign of campaigns ?? []) {
    // Single-flight: only one run may sync a campaign at a time. A contended
    // lease (another run holds it) is skipped, not double-billed (BILL-4).
    const { data: claimed } = await adminDb.rpc('claim_usage_sync', {
      p_campaign_id: campaign.id,
      p_ttl_seconds: 300,
    });
    if (!claimed) {
      results.push({ campaignId: campaign.id, synced: false, error: 'sync already in progress' });
      continue;
    }
    try {
      const { data: cursorRow } = await adminDb
        .from('usage_sync_cursor')
        .select('last_synced_at, pending_key, pending_until')
        .eq('campaign_id', campaign.id)
        .maybeSingle();

      // A subscribed campaign with no cursor row (pre-dates the seed fix, or a
      // race) must not retro-bill from epoch — fall back to now, not 1970.
      const since = cursorRow?.last_synced_at ?? new Date().toISOString();
      let until: string;
      let key: string;

      if (cursorRow?.pending_key && cursorRow?.pending_until) {
        // A previous attempt persisted intent but we don't know whether
        // Stripe received it — retry with the EXACT same range/key so
        // Stripe's idempotency dedupes if it already landed.
        until = cursorRow.pending_until;
        key = cursorRow.pending_key;
      } else {
        until = new Date(Date.now() - SYNC_SAFETY_LAG_MS).toISOString();
        key = buildSyncKey(campaign.id, since, until);
      }

      // Exclude in-flight `_reserved` rows (UsageMeter's atomic cap check) —
      // they're not final spend yet and get replaced by a real row once the
      // request finishes, which would otherwise risk billing Stripe twice.
      const { data: events } = await adminDb
        .from('usage_events')
        .select('cost_cents')
        .eq('campaign_id', campaign.id)
        .neq('kind', '_reserved')
        .gt('created_at', since)
        .lte('created_at', until);

      const totalCents = sumUsageCents((events ?? []).map(e => ({ costCents: e.cost_cents })));

      if (totalCents === 0) {
        results.push({ campaignId: campaign.id, synced: false });
        continue;
      }

      // Persist intent BEFORE calling Stripe, so a crash/DB-failure right
      // after a successful Stripe call still lets the next run retry with
      // this same key instead of computing a new, differently-keyed range.
      await adminDb.from('usage_sync_cursor').upsert({
        campaign_id: campaign.id,
        last_synced_at: since,
        pending_key: key,
        pending_until: until,
      });

      await stripe.billing.meterEvents.create({
        event_name: METER_EVENT_NAME,
        payload: { stripe_customer_id: campaign.stripe_customer_id!, value: String(totalCents) },
        identifier: key,
      });

      await adminDb.from('usage_sync_cursor').upsert({
        campaign_id: campaign.id,
        last_synced_at: until,
        pending_key: null,
        pending_until: null,
      });

      results.push({ campaignId: campaign.id, synced: true });
    } catch (e) {
      results.push({ campaignId: campaign.id, synced: false, error: String(e) });
    } finally {
      await adminDb.rpc('release_usage_sync', { p_campaign_id: campaign.id });
    }
  }

  return NextResponse.json({
    synced: results.filter(r => r.synced).length,
    failed: results.filter(r => r.error).length,
    results,
  });
}
