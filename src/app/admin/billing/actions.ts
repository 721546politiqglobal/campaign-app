'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { adminDb } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { PLAN_DEFINITIONS } from '@/lib/billing-catalog';

export async function syncBillingPlansAction(): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

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

    await adminDb.from('billing_plans').insert({
      id: def.id,
      name: def.name,
      monthly_price_cents: def.monthlyPriceCents,
      seat_limit: def.seatLimit,
      avatar_limit: def.avatarLimit,
      content_limit_monthly: def.contentLimitMonthly,
      video_limit_daily: def.videoLimitDaily,
      stripe_product_id: product.id,
      stripe_flat_price_id: flatPrice.id,
      is_active: true,
    });
  }

  revalidatePath('/admin/billing');
  return { ok: true };
}
