'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { PLAN_DEFINITIONS, METER_EVENT_NAME } from '@/lib/billing-catalog';

export async function syncBillingPlansAction(): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

  const meters = await stripe.billing.meters.list({ limit: 100 });
  let meter = meters.data.find(m => m.event_name === METER_EVENT_NAME);
  if (!meter) {
    meter = await stripe.billing.meters.create({
      display_name: 'Platform usage (cents)',
      event_name: METER_EVENT_NAME,
      default_aggregation: { formula: 'sum' },
      customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
      value_settings: { event_payload_key: 'value' },
    });
  }

  const { data: existingPlans } = await adminDb.from('billing_plans').select('id');
  const existingIds = new Set((existingPlans ?? []).map(p => p.id));

  for (const def of PLAN_DEFINITIONS) {
    if (existingIds.has(def.id)) continue;

    const product = await stripe.products.create({ name: `${def.name} plan` });

    const flatPrice = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: def.monthlyPriceCents,
      recurring: { interval: 'month' },
    });

    // Meter reports usage in cents. Tier 1 is free up to the plan's included
    // allowance (also in cents); tier 2 charges overageMultiplier cents per
    // 1 cent of underlying vendor cost beyond that.
    const meteredPrice = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      recurring: { interval: 'month', meter: meter.id, usage_type: 'metered' },
      billing_scheme: 'tiered',
      tiers_mode: 'graduated',
      tiers: [
        { up_to: def.includedUsageCents, unit_amount: 0 },
        { up_to: 'inf', unit_amount_decimal: stripe.Decimal.from(def.overageMultiplier.toFixed(4)) },
      ],
    });

    await adminDb.from('billing_plans').insert({
      id: def.id,
      name: def.name,
      monthly_price_cents: def.monthlyPriceCents,
      seat_limit: def.seatLimit,
      included_usage_cents: def.includedUsageCents,
      overage_multiplier: def.overageMultiplier,
      stripe_product_id: product.id,
      stripe_flat_price_id: flatPrice.id,
      stripe_metered_price_id: meteredPrice.id,
      is_active: true,
    });
  }

  revalidatePath('/admin/billing');
  return { ok: true };
}
