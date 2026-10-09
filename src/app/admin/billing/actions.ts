'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import { PLAN_DEFINITIONS } from '@/lib/billing-catalog';
import { prefixedId } from '@/lib/store';
import type { AdminActionResult } from '../actions';

const CORE_PLAN_IDS = new Set(PLAN_DEFINITIONS.map(d => d.id));

export async function syncBillingPlansAction(): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.adminBilling' });
  if (!stripe) return { ok: false, error: t('stripeNotConfigured') };

  try {
    // A transient read failure must not look like "no plans yet" — that would
    // mint duplicate Stripe products for every core plan.
    const existingPlans = await throwOnError(adminDb.from('billing_plans').select('id'), 'billing_plans.select');
    const existingIds = new Set((existingPlans ?? []).map(p => p.id));

    for (const def of PLAN_DEFINITIONS) {
      if (existingIds.has(def.id)) continue;

      // A previous run may have created the Stripe objects and then failed on
      // the DB insert. Check-then-create by metadata so a retry reuses them,
      // and pin idempotency keys so even a concurrent double-submit can't
      // mint duplicates.
      const productId = await findProductByPlanId(def.id)
        ?? (await stripe.products.create(
          { name: `${def.name} plan`, metadata: { plan_id: def.id } },
          { idempotencyKey: `billing-plan-product:${def.id}` },
        )).id;

      const flatPrice = await stripe.prices.create(
        {
          product: productId,
          currency: 'usd',
          unit_amount: def.monthlyPriceCents,
          recurring: { interval: 'month' },
          metadata: { plan_id: def.id },
        },
        { idempotencyKey: `billing-plan-price:${def.id}:${def.monthlyPriceCents}:month` },
      );

      await throwOnError(
        adminDb.from('billing_plans').insert({
          id: def.id,
          name: def.name,
          monthly_price_cents: def.monthlyPriceCents,
          seat_limit: def.seatLimit,
          avatar_limit: def.avatarLimit,
          content_limit_monthly: def.contentLimitMonthly,
          video_limit_daily: def.videoLimitDaily,
          stripe_product_id: productId,
          stripe_flat_price_id: flatPrice.id,
          is_active: true,
        }),
        'billing_plans.insert',
      );
    }
  } catch (e) {
    console.error('syncBillingPlansAction failed', e);
    return { ok: false, error: t('couldNotSyncPlans') };
  }

  revalidatePath('/admin/billing');
  return { ok: true };
}

// Active Stripe product previously created for this plan id (metadata set by
// the sync above). Search is best-effort: if it's unavailable, fall through to
// create and rely on the idempotency key.
async function findProductByPlanId(planId: string): Promise<string | null> {
  if (!stripe || typeof stripe.products.search !== 'function') return null;
  try {
    const found = await stripe.products.search({ query: `active:'true' AND metadata['plan_id']:'${planId}'`, limit: 1 });
    return found.data[0]?.id ?? null;
  } catch (e) {
    console.error('syncBillingPlansAction: products.search failed', e);
    return null;
  }
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
  { field: 'seatLimit', column: 'seat_limit', labelKey: 'limitLabels.seatLimit' },
  { field: 'avatarLimit', column: 'avatar_limit', labelKey: 'limitLabels.avatarLimit' },
  { field: 'contentLimitMonthly', column: 'content_limit_monthly', labelKey: 'limitLabels.contentLimit' },
  { field: 'videoLimitDaily', column: 'video_limit_daily', labelKey: 'limitLabels.videoLimitDaily' },
] as const;

export async function upsertBillingPlanAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.adminBilling' });
  if (!stripe) return { ok: false, error: t('stripeNotConfigured') };

  const existingId = String(formData.get('id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const priceDollarsRaw = String(formData.get('priceDollars') ?? '').trim();
  const priceCents = Math.round(Number(priceDollarsRaw) * 100);
  const billingInterval = String(formData.get('billingInterval') ?? 'month');

  if (!name) return { ok: false, error: t('planNameRequired') };
  if (!priceDollarsRaw || !Number.isFinite(priceCents) || priceCents < 0) {
    return { ok: false, error: t('priceNonNegative') };
  }
  if (billingInterval !== 'week' && billingInterval !== 'month') {
    return { ok: false, error: t('billingIntervalInvalid') };
  }

  const limits: Record<string, number | null> = {};
  for (const { field, column, labelKey } of LIMIT_FIELDS) {
    const parsed = parseLimit(formData.get(field));
    if (!parsed.ok) {
      return { ok: false, error: t('limitInvalid', { label: t(labelKey) }) };
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
    // otherwise surface as an unhandled 500. Log the raw provider/DB message
    // server-side; the admin sees a translated one.
    console.error('upsertBillingPlanAction failed', e);
    return { ok: false, error: t('couldNotSavePlan') };
  }

  revalidatePath('/admin/billing');
  return { ok: true };
}

export async function deleteBillingPlanAction(formData: FormData): Promise<AdminActionResult> {
  const s = await requireAdmin();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.adminBilling' });
  if (!stripe) return { ok: false, error: t('stripeNotConfigured') };

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: t('planIdRequired') };
  // Starter, Pro, and Enterprise are the baseline catalog (re-created by
  // syncBillingPlansAction) — deleting one would just have it reappear
  // confusingly on the next sync, so only plans added beyond those are
  // eligible for deletion.
  if (CORE_PLAN_IDS.has(id)) {
    return { ok: false, error: t('corePlansCannotBeDeleted') };
  }

  try {
    const { count, error: countError } = await adminDb.from('campaigns')
      .select('id', { count: 'exact', head: true }).eq('plan_id', id);
    // A failed count must not read as "nobody is on this plan".
    if (countError) throw new Error(`campaigns.count_by_plan: ${countError.message}`);
    if ((count ?? 0) > 0) {
      return { ok: false, error: t('cannotDeleteInUse', { count }) };
    }

    const plan = await throwOnError(
      adminDb.from('billing_plans').select('*').eq('id', id).maybeSingle(),
      'billing_plans.select',
    );
    if (!plan) return { ok: false, error: t('planNotFound') };

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
    console.error('deleteBillingPlanAction failed', e);
    return { ok: false, error: t('couldNotDeletePlan') };
  }

  revalidatePath('/admin/billing');
  return { ok: true };
}
