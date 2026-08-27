'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { PLAN_DEFINITIONS } from '@/lib/billing-catalog';
import { prefixedId } from '@/lib/store';

const CORE_PLAN_IDS = new Set(PLAN_DEFINITIONS.map(d => d.id));

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

// A blank limit field legitimately means "unlimited" (null). Anything non-blank that
// isn't a valid non-negative number is a validation error, NOT a silent fall-through
// to unlimited — these are quota ceilings posted straight to a server action, so
// "0abc" must be rejected rather than quietly lifting the cap.
type ParsedLimit = { ok: true; value: number | null } | { ok: false };

function parseLimit(value: FormDataEntryValue | null): ParsedLimit {
  const s = String(value ?? '').trim();
  if (!s) return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: Math.round(n) };
}

const LIMIT_FIELDS = [
  { field: 'seatLimit', column: 'seat_limit', label: 'Seat limit' },
  { field: 'avatarLimit', column: 'avatar_limit', label: 'Avatar limit' },
  { field: 'contentLimitMonthly', column: 'content_limit_monthly', label: 'Content limit' },
  { field: 'videoLimitDaily', column: 'video_limit_daily', label: 'Daily video limit' },
] as const;

export async function upsertBillingPlanAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

  const existingId = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const priceDollarsRaw = String(formData.get('priceDollars') ?? '').trim();
  const priceCents = Math.round(Number(priceDollarsRaw) * 100);
  const billingInterval = String(formData.get('billingInterval') ?? 'month');

  if (!name) return { ok: false, error: 'Plan name is required.' };
  if (!priceDollarsRaw || !Number.isFinite(priceCents) || priceCents < 0) {
    return { ok: false, error: 'Price must be a non-negative number.' };
  }
  if (billingInterval !== 'week' && billingInterval !== 'month') {
    return { ok: false, error: 'Billing interval must be week or month.' };
  }

  const limits: Record<string, number | null> = {};
  for (const { field, column, label } of LIMIT_FIELDS) {
    const parsed = parseLimit(formData.get(field));
    if (!parsed.ok) {
      return { ok: false, error: `${label} must be blank (unlimited) or a non-negative number.` };
    }
    limits[column] = parsed.value;
  }

  const id = existingId || prefixedId('plan-');

  try {
    // maybeSingle + throwOnError: a transient DB failure must not read as "no such
    // plan", which would mint a duplicate Stripe product and leave the previous price
    // un-archived.
    const existing = await throwOnError(
      adminDb.from('billing_plans').select('*').eq('id', id).maybeSingle(),
      'billing_plans.select',
    );

    let stripeProductId = existing?.stripe_product_id as string | undefined;
    let stripeFlatPriceId = existing?.stripe_flat_price_id as string | undefined;
    const retiredPriceIds: string[] = (existing?.retired_stripe_price_ids as string[] | undefined) ?? [];
    let priceOrIntervalChanged =
      !existing || existing.monthly_price_cents !== priceCents || existing.billing_interval !== billingInterval;

    // The stored product id can belong to a different Stripe mode/account than
    // whatever key is active right now (e.g. synced once against a test-mode
    // key, now running with a live key) — verify it still exists before
    // reusing it, otherwise prices.create below fails with "No such product"
    // and this action can never repair itself. Force a price rotation too:
    // the stored price belongs to that same stale product.
    if (stripeProductId) {
      try {
        await stripe.products.retrieve(stripeProductId);
      } catch {
        stripeProductId = undefined;
        priceOrIntervalChanged = true;
      }
    }

    if (!stripeProductId) {
      const product = await stripe.products.create({ name: `${name} plan` });
      stripeProductId = product.id;
    }

    // Stripe prices are immutable — rotate to a new one rather than editing it.
    // Campaigns already on the old price keep billing there until reassigned via
    // assignPlanAction.
    let rotatedFromPriceId: string | undefined;
    if (priceOrIntervalChanged) {
      const newPrice = await stripe.prices.create({
        product: stripeProductId,
        currency: 'usd',
        unit_amount: priceCents,
        recurring: { interval: billingInterval as 'week' | 'month' },
      });
      if (stripeFlatPriceId) rotatedFromPriceId = stripeFlatPriceId;
      stripeFlatPriceId = newPrice.id;
    }

    await throwOnError(
      adminDb.from('billing_plans').upsert({
        id,
        name,
        monthly_price_cents: priceCents,
        billing_interval: billingInterval,
        seat_limit: limits.seat_limit,
        avatar_limit: limits.avatar_limit,
        content_limit_monthly: limits.content_limit_monthly,
        video_limit_daily: limits.video_limit_daily,
        stripe_product_id: stripeProductId,
        stripe_flat_price_id: stripeFlatPriceId,
        // Remember the id we rotated away from so the Stripe webhook can still map a
        // checkout/subscription created against it back to this plan.
        retired_stripe_price_ids: rotatedFromPriceId ? [...retiredPriceIds, rotatedFromPriceId] : retiredPriceIds,
      }),
      'billing_plans.upsert',
    );

    // Only archive the old price once the DB row safely points at the new one — if
    // the upsert above throws, the old price stays active and nothing is left
    // inconsistent (a row pointing at an already-archived price would break
    // checkout for that plan).
    if (rotatedFromPriceId) {
      await stripe.prices.update(rotatedFromPriceId, { active: false });
    }
  } catch (e) {
    // A wrong-mode Stripe key, an archived/invalid price id, or a DB failure would
    // otherwise surface as an unhandled 500 instead of the error banner
    // /admin/billing already renders for `{ ok: false, error }`.
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save plan.' };
  }

  revalidatePath('/admin/billing');
  return { ok: true };
}

export async function deleteBillingPlanAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!stripe) return { ok: false, error: 'STRIPE_SECRET_KEY is not configured on this server.' };

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Plan id is required.' };
  // Starter, Pro, and Enterprise are the baseline catalog (re-created by
  // syncBillingPlansAction) — deleting one would just have it reappear
  // confusingly on the next sync, so only plans added beyond those are
  // eligible for deletion.
  if (CORE_PLAN_IDS.has(id)) {
    return { ok: false, error: 'Starter, Pro, and Enterprise are core plans and can’t be deleted.' };
  }

  try {
    const { count } = await adminDb.from('campaigns').select('id', { count: 'exact', head: true }).eq('plan_id', id);
    if ((count ?? 0) > 0) {
      return { ok: false, error: `Cannot delete: ${count} campaign${count === 1 ? ' is' : 's are'} still on this plan.` };
    }

    const plan = await throwOnError(
      adminDb.from('billing_plans').select('*').eq('id', id).maybeSingle(),
      'billing_plans.select',
    );
    if (!plan) return { ok: false, error: 'Plan not found.' };

    await throwOnError(
      adminDb.from('billing_plans').delete().eq('id', id),
      'billing_plans.delete',
    );

    // Best-effort: archive the Stripe objects so they stop showing as active
    // in the Stripe dashboard. Never fail the delete over this — the plan is
    // already gone from our own catalog, which is the part that matters.
    try {
      if (plan.stripe_flat_price_id) await stripe.prices.update(plan.stripe_flat_price_id as string, { active: false });
      if (plan.stripe_product_id) await stripe.products.update(plan.stripe_product_id as string, { active: false });
    } catch {
      // ignored — see comment above
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete plan.' };
  }

  revalidatePath('/admin/billing');
  return { ok: true };
}
