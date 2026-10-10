import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { test, expect } from '../fixtures';
import { E2E_ENV } from '../env';
import { PASSWORD } from '../helpers/users';
import { captureAction, replayAction, actionResult } from '../helpers/server-action';
import { event, sendWebhook } from '../helpers/stripe-webhook';

// Every test that changes a plan / subscription works on a THROWAWAY campaign
// (own owner, profile and cus_/sub_ ids) so campaign A and B stay exactly as
// seeded for the specs running alongside this one. Campaign A / staff A are
// only ever read.

const HAS_STRIPE_KEY = !!E2E_ENV.STRIPE_TEST_SECRET_KEY;
const NEEDS_KEY = 'needs STRIPE_TEST_SECRET_KEY';

// Seeded in e2e/seed.e2e.sql (monthly interval only).
const PLANS = [
  { id: 'starter', name: 'Starter', price: '$49', seats: '3 team members', avatars: '2 avatars', content: '15 content pieces per period', videos: '1 video per day' },
  { id: 'pro', name: 'Pro', price: '$149', seats: '10 team members', avatars: '5 avatars', content: '50 content pieces per period', videos: '3 videos per day' },
  { id: 'enterprise', name: 'Enterprise', price: '$499', seats: 'Unlimited team members', avatars: '20 avatars', content: 'Unlimited content per period', videos: '10 videos per day' },
] as const;
const PRICE = (plan: string) => `price_e2e_${plan}_month`;

const L = {
  subscribe: 'Subscribe',
  switchPlan: 'Switch to this plan',
  notAllowed: 'Ask your campaign owner to choose a plan',
  couldNotStartCheckout: 'Could not start checkout. Please try again or contact support.',
  pricingPermissionDenied: 'Only campaign owners and managers can manage billing.',
  paymentReceived: 'Payment received',
  activating: 'Activating your plan — this usually takes a few seconds.',
  planActive: 'Your plan is active',
  checkoutCanceled: 'Checkout canceled',
  manageBilling: 'Manage billing',
  portalFailed: "Couldn't open the billing portal. Please try again.",
  billingInactive: 'Billing inactive',
  pastDue: 'Payment past due',
  generate: 'Generate with AI',
  inactiveBlocked: "This campaign's subscription is inactive.",
  stripeError: 'Stripe rejected the request. Check the server logs for details.',
};

const testKey = () => test.info().testId.split('-').pop()!;
async function must(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(`db write failed: ${error.message}`);
}

type Throwaway = { camp: string; ownerId: string; email: string; cus: string; sub: string; key: string };
type CampOpts = {
  plan?: string | null; status?: string | null; stripe?: boolean; locale?: 'en' | 'es';
  /**
   * Per-run campaign id (`e2e-bill-<testKey>-<run>`). Use it when the app derives a
   * Stripe idempotency key from the campaign id (assignPlanAction:
   * `campaign-customer:<id>`). Otherwise a rerun within Stripe's 24h window
   * replays the previous run's, now deleted, customer.
   */
  perRunId?: boolean;
};

function ids(key: string): Throwaway {
  return { key, camp: `e2e-bill-${key}`, ownerId: `e2e-bill-owner-${key}`, email: `bill-owner-${key}@e2e.test`,
    cus: `cus_e2e_${key}`, sub: `sub_e2e_${key}` };
}

async function cleanup(db: SupabaseClient, t: Throwaway) {
  await must(db.from('billing_events').delete().eq('campaign_id', t.camp));
  await must(db.from('billing_events').delete().like('id', `evt_e2e_${t.key}_%`));
  await must(db.from('content_items').delete().eq('campaign_id', t.camp));
  await must(db.from('audit_entries').delete().eq('actor_user_id', t.ownerId));
  await must(db.from('login_attempts').delete().eq('key', `email:${t.email}`));
  await must(db.from('users').delete().eq('id', t.ownerId));
  await must(db.from('candidate_profiles').delete().eq('campaign_id', t.camp));
  await must(db.from('feature_usage_counters').delete().eq('campaign_id', t.camp));
  await must(db.from('campaigns').delete().eq('id', t.camp));
}

/** Throwaway campaign + owner + minimal profile. Defaults: Starter, active, with Stripe ids. */
async function createCampaign(db: SupabaseClient, opts: CampOpts = {}): Promise<Throwaway> {
  const base = testKey();
  await cleanup(db, ids(base)); // leftovers from an interrupted earlier run
  if (opts.perRunId) {
    // Earlier per-run ids for this test (testIds are hex, so the trailing '-' is unambiguous).
    const { data, error } = await db.from('campaigns').select('id').like('id', `e2e-bill-${base}-%`);
    if (error) throw new Error(error.message);
    for (const { id } of data ?? []) await cleanup(db, ids((id as string).slice('e2e-bill-'.length)));
  }
  const t = opts.perRunId ? ids(`${base}-${Date.now().toString(36)}`) : ids(base);
  const plan = opts.plan === undefined ? 'starter' : opts.plan;
  const stripe = opts.stripe ?? plan !== null;
  await must(db.from('campaigns').insert({
    id: t.camp, name: `E2E Billing ${t.key}`, jurisdictions: ['US-TX'],
    plan_id: plan,
    stripe_customer_id: stripe ? t.cus : null,
    stripe_subscription_id: stripe ? t.sub : null,
    subscription_status: opts.status === undefined ? (plan ? 'active' : null) : opts.status,
    current_period_end: plan ? new Date(Date.now() + 20 * 86_400_000).toISOString() : null,
  }));
  await must(db.from('users').insert({
    id: t.ownerId, campaign_id: t.camp, name: 'Billing Owner', role: 'owner', email: t.email,
    password_hash: bcrypt.hashSync(PASSWORD, 4), locale: opts.locale ?? 'en',
  }));
  await must(db.from('candidate_profiles').insert({
    id: `e2e-bill-prof-${t.key}`, campaign_id: t.camp, full_name: 'Billing Candidate', preferred_name: 'Billing',
    office: 'City Council', district: 'Ward 7', party: 'Independent', bio: 'Billing spec throwaway.',
    key_positions: ['Budgets'], voice_tone: 'conversational', target_audience: 'Voters', tagline: 'Billing',
    opponent_name: 'Nobody', opponent_aliases: [], monitoring_keywords: [], content_locale: 'en',
  }));
  return t;
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login$/);
}

function subscription(t: Throwaway, opts: { status?: string; plan?: string | null } = {}) {
  const plan = opts.plan === undefined ? 'pro' : opts.plan;
  return {
    id: t.sub, object: 'subscription', customer: t.cus, status: opts.status ?? 'active',
    items: { object: 'list', data: plan ? [{
      id: `si_e2e_${t.key}`, object: 'subscription_item',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
      price: { id: PRICE(plan), object: 'price' },
    }] : [] },
  };
}

/** event() with an id carrying the test key, so cleanup can find unlinked rows. */
let evtSeq = 0;
function keyedEvent(t: Throwaway, type: string, object: Record<string, unknown>, created?: number) {
  return { ...event(type, object, created), id: `evt_e2e_${t.key}_${Date.now()}_${evtSeq++}` };
}

async function campaignRow(db: SupabaseClient, camp: string) {
  const { data, error } = await db.from('campaigns')
    .select('plan_id, subscription_status, grace_period_ends_at, subscription_event_created, current_period_end, stripe_customer_id, stripe_subscription_id')
    .eq('id', camp).single();
  if (error) throw new Error(error.message);
  return data;
}

/** Real test-mode Stripe client (only in key-gated tests). */
async function realStripe() {
  const { default: Stripe } = await import('stripe');
  return new Stripe(E2E_ENV.STRIPE_TEST_SECRET_KEY);
}

/**
 * Throwaway billing_plans row backed by a real test-mode price, so key-gated
 * tests never touch (or sync) the shared seeded plans.
 */
async function createRealPlan(db: SupabaseClient, stripe: Awaited<ReturnType<typeof realStripe>>, seatLimit = 4) {
  const key = testKey();
  const price = await stripe.prices.create({ currency: 'usd', unit_amount: 100, recurring: { interval: 'month' },
    product_data: { name: `E2E plan ${key}` } });
  const plan = { id: `e2e-plan-${key}`, name: `E2E Plan ${key}`, priceId: price.id };
  await must(db.from('billing_plans').delete().eq('id', plan.id));
  await must(db.from('billing_plans').insert({ id: plan.id, name: plan.name, monthly_price_cents: 100,
    seat_limit: seatLimit, avatar_limit: 1, content_limit_monthly: 1, video_limit_daily: 1,
    stripe_product_id: price.product as string, stripe_flat_price_id: price.id, billing_interval: 'month', is_active: true }));
  return {
    ...plan,
    async remove() {
      await must(db.from('billing_plans').delete().eq('id', plan.id));
      await stripe.prices.update(price.id, { active: false });
    },
  };
}

function planCard(page: Page, name: string) {
  return page.locator('article.plan-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

// ── Pricing page ─────────────────────────────────────────────────────────────
test.describe('pricing page', () => {
  test('logged out: /pricing requires login', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('lists every seeded plan with its monthly price and limits', async ({ asRole }) => {
    const page = await asRole('owner');
    await page.goto('/pricing');
    for (const p of PLANS) {
      const card = planCard(page, p.name);
      await expect(card).toHaveCount(1);
      await expect(card.locator('.plan-price-amount')).toHaveText(p.price);
      await expect(card.locator('.plan-price-interval')).toHaveText('per mo');
      for (const f of [p.seats, p.avatars, p.content, p.videos]) await expect(card.getByText(f, { exact: true })).toBeVisible();
    }
    // Owner A is on Enterprise: that card is current, the others offer a switch.
    await expect(planCard(page, 'Enterprise')).toHaveAttribute('aria-current', 'true');
    await expect(planCard(page, 'Enterprise').getByRole('button', { name: 'Current plan' })).toBeDisabled();
    await expect(planCard(page, 'Starter').getByRole('button', { name: L.switchPlan })).toBeVisible();
  });

  test('staff sees plans read-only, with no subscribe/switch controls', async ({ asRole }) => {
    const page = await asRole('staff');
    await page.goto('/pricing');
    await expect(page.getByText(L.notAllowed)).toBeVisible();
    await expect(planCard(page, 'Starter')).toHaveCount(1);
    await expect(page.getByRole('button', { name: L.subscribe })).toHaveCount(0);
    await expect(page.getByRole('button', { name: L.switchPlan })).toHaveCount(0);
  });
});

// ── Checkout ─────────────────────────────────────────────────────────────────
test.describe('checkout', () => {
  test('without a real Stripe key: Subscribe shows a handled error (no 500), staff replay is refused', async ({ page, db, asRole }) => {
    test.skip(HAS_STRIPE_KEY, 'real key present — covered by the redirect test');
    const t = await createCampaign(db, { plan: null });
    try {
      await login(page, t.email);
      await page.goto('/pricing');
      await expect(page.getByRole('heading', { name: 'Choose a plan to get started' })).toBeVisible();
      const card = planCard(page, 'Starter');
      const action = await captureAction(page, () => card.getByRole('button', { name: L.subscribe }).click());
      await expect(card.getByRole('alert')).toHaveText(L.couldNotStartCheckout);
      await expect(page).toHaveURL(/\/pricing$/);

      // Positive control: the owner's own replay reaches Stripe and is handled.
      expect(await actionResult(await replayAction(page, action))).toEqual({ ok: false, error: L.couldNotStartCheckout });
      // Staff (campaign A) replaying the same action is refused before Stripe.
      const staff = await asRole('staff');
      await staff.goto('/billing');
      const res = await replayAction(staff, action);
      expect(res.status()).toBeLessThan(500);
      expect(await actionResult(res)).toEqual({ ok: false, error: L.pricingPermissionDenied });
      expect((await campaignRow(db, t.camp)).plan_id).toBeNull();
    } finally {
      await cleanup(db, t);
    }
  });

  test('with a real Stripe key: Subscribe redirects to checkout.stripe.com', async ({ page, db }) => {
    test.skip(!HAS_STRIPE_KEY, NEEDS_KEY);
    // Seeded prices (price_e2e_*) do not exist in Stripe: runs against a
    // throwaway plan row pointing at a real test-mode price.
    const stripe = await realStripe();
    const t = await createCampaign(db, { plan: null });
    let plan: Awaited<ReturnType<typeof createRealPlan>> | undefined;
    try {
      plan = await createRealPlan(db, stripe);
      await login(page, t.email);
      await page.goto('/pricing');
      await planCard(page, plan.name).getByRole('button', { name: L.subscribe }).click();
      await page.waitForURL(/checkout\.stripe\.com/);
    } finally {
      await cleanup(db, t);
      await plan?.remove();
    }
  });

  test('CheckoutStatus: success polls until the plan lands; canceled shows the canceled banner', async ({ page, db }) => {
    const t = await createCampaign(db, { plan: null });
    try {
      await login(page, t.email);
      await page.goto('/pricing?checkout=canceled');
      await expect(page.getByText(L.checkoutCanceled)).toBeVisible();

      await page.goto('/pricing?checkout=success');
      await expect(page.getByText(L.paymentReceived)).toBeVisible();
      await expect(page.getByText(L.activating)).toBeVisible();
      await expect(page.getByText(L.checkoutCanceled)).toHaveCount(0);
      // The webhook landing (simulated) flips the polled banner to "active".
      await must(db.from('campaigns').update({ plan_id: 'starter', subscription_status: 'active' }).eq('id', t.camp));
      await expect(page.getByText(L.planActive)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('status').getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
    } finally {
      await cleanup(db, t);
    }
  });

  test('CheckoutStatus with a plan already active: success is "active", canceled shows nothing', async ({ asRole }) => {
    const page = await asRole('owner');
    await page.goto('/pricing?checkout=success');
    await expect(page.getByText(L.planActive)).toBeVisible();
    await page.goto('/pricing?checkout=canceled');
    await expect(page.getByRole('heading', { name: 'Change your plan' })).toBeVisible();
    await expect(page.getByText(L.checkoutCanceled)).toHaveCount(0);
  });
});

// ── Webhook ──────────────────────────────────────────────────────────────────
test.describe('stripe webhook', () => {
  test('missing or bad signature → 400', async ({ request, db }) => {
    const t = ids(testKey());
    const evt = keyedEvent(t, 'customer.subscription.updated', subscription(t));
    try {
      const none = await request.post('/api/webhooks/stripe', { headers: { 'content-type': 'application/json' }, data: JSON.stringify(evt) });
      expect(none.status()).toBe(400);
      const bad = await sendWebhook(request, evt, 'whsec_not_the_secret');
      expect(bad.status()).toBe(400);
      const { data } = await db.from('billing_events').select('id').eq('id', evt.id);
      expect(data, 'rejected events are not recorded').toEqual([]);
    } finally {
      await must(db.from('billing_events').delete().like('id', `evt_e2e_${t.key}_%`));
    }
  });

  test('subscription.updated for an unknown subscription → 409 and the claim is released', async ({ request, db }) => {
    const t = { ...ids(testKey()), sub: `sub_e2e_nomatch_${testKey()}` };
    const evt = keyedEvent(t, 'customer.subscription.updated', subscription(t));
    try {
      const res = await sendWebhook(request, evt);
      expect(res.status()).toBe(409);
      const { data } = await db.from('billing_events').select('id').eq('id', evt.id);
      expect(data, 'claim released so Stripe can retry').toEqual([]);
    } finally {
      await must(db.from('billing_events').delete().like('id', `evt_e2e_${t.key}_%`));
    }
  });

  test('valid subscription.updated changes the plan; /billing shows it', async ({ request, page, db }) => {
    const t = await createCampaign(db);
    try {
      const evt = keyedEvent(t, 'customer.subscription.updated', subscription(t, { plan: 'pro' }));
      const res = await sendWebhook(request, evt);
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ received: true });
      const row = await campaignRow(db, t.camp);
      expect(row.plan_id).toBe('pro');
      expect(row.subscription_status).toBe('active');
      expect(Number(row.subscription_event_created)).toBe(evt.created);
      const { data: rec } = await db.from('billing_events').select('campaign_id').eq('id', evt.id).single();
      expect(rec?.campaign_id).toBe(t.camp);

      await login(page, t.email);
      await page.goto('/billing');
      await expect(page.locator('#billing-plan-heading')).toHaveText('Pro');
      await expect(page.locator('.billing-price')).toHaveText('$149.00 per month');
      await expect(page.getByText('Active', { exact: true })).toBeVisible();
    } finally {
      await cleanup(db, t);
    }
  });

  test('duplicate event id acks as duplicate and is not re-applied', async ({ request, db }) => {
    const t = await createCampaign(db);
    try {
      const evt = keyedEvent(t, 'customer.subscription.updated', subscription(t, { plan: 'pro' }));
      expect((await sendWebhook(request, evt)).status()).toBe(200);
      expect((await campaignRow(db, t.camp)).plan_id).toBe('pro');

      // Rewind the campaign (incl. the ordering high-water mark) so a re-apply
      // would be visible — only the idempotency claim can stop it now.
      await must(db.from('campaigns').update({ plan_id: 'starter', subscription_event_created: null }).eq('id', t.camp));
      const again = await sendWebhook(request, evt);
      expect(again.status()).toBe(200);
      expect(await again.json()).toEqual({ received: true, duplicate: true });
      expect((await campaignRow(db, t.camp)).plan_id, 'duplicate not re-applied').toBe('starter');
      const { data } = await db.from('billing_events').select('id').eq('id', evt.id);
      expect(data).toHaveLength(1);
    } finally {
      await cleanup(db, t);
    }
  });

  test('out-of-order: an older event arriving after a newer one is ignored', async ({ request, page, db }) => {
    const t = await createCampaign(db);
    try {
      const now = Math.floor(Date.now() / 1000);
      const newer = keyedEvent(t, 'customer.subscription.updated', subscription(t, { status: 'past_due', plan: 'pro' }), now);
      const older = keyedEvent(t, 'customer.subscription.updated', subscription(t, { status: 'active', plan: 'enterprise' }), now - 120);

      expect((await sendWebhook(request, newer)).status()).toBe(200);
      const afterNewer = await campaignRow(db, t.camp);
      expect(afterNewer).toMatchObject({ plan_id: 'pro', subscription_status: 'past_due' });
      expect(afterNewer.grace_period_ends_at).toBeTruthy();

      const res = await sendWebhook(request, older);
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ received: true, stale: true });
      const afterOlder = await campaignRow(db, t.camp);
      expect(afterOlder).toMatchObject({ plan_id: 'pro', subscription_status: 'past_due',
        grace_period_ends_at: afterNewer.grace_period_ends_at });
      expect(Number(afterOlder.subscription_event_created)).toBe(now);

      await login(page, t.email);
      await page.goto('/billing');
      await expect(page.getByRole('alert').filter({ hasText: L.pastDue })).toBeVisible();
    } finally {
      await cleanup(db, t);
    }
  });

  test('subscription.deleted cancels the campaign and blocks paid features', async ({ request, page, db }) => {
    const t = await createCampaign(db);
    try {
      await login(page, t.email);
      const evt = keyedEvent(t, 'customer.subscription.deleted', subscription(t, { status: 'canceled', plan: 'starter' }));
      const res = await sendWebhook(request, evt);
      expect(res.status()).toBe(200);
      const row = await campaignRow(db, t.camp);
      expect(row.subscription_status).toBe('canceled');
      expect(row.current_period_end).toBeNull();

      await page.goto('/billing');
      await expect(page.getByRole('alert').filter({ hasText: L.billingInactive })).toBeVisible();

      // AI drafting is a paid feature: the billing gate refuses it with the reason.
      await page.goto('/content/new');
      await page.getByLabel('What should this say?').fill(`Billing gate check ${t.key}`);
      await page.getByRole('button', { name: L.generate }).click();
      await expect(page.getByText(L.inactiveBlocked)).toBeVisible();
      const { data } = await db.from('feature_usage_counters').select('count').eq('campaign_id', t.camp);
      expect(data, 'blocked request consumed no quota').toEqual([]);
    } finally {
      await cleanup(db, t);
    }
  });
});

test('canceled campaign, Spanish session: the billing-gate refusal is shown in Spanish', async ({ request, page, db }) => {
  const t = await createCampaign(db, { locale: 'es' });
  try {
    await login(page, t.email);
    const evt = keyedEvent(t, 'customer.subscription.deleted', subscription(t, { status: 'canceled', plan: 'starter' }));
    expect((await sendWebhook(request, evt)).status()).toBe(200);
    await page.goto('/content/new');
    await page.getByLabel('¿Qué debería decir esto?').fill(`Billing gate es ${t.key}`);
    await page.getByRole('button', { name: 'Generar con IA' }).click();
    const err = page.locator('.field-error[role="alert"]'); // Field error under the prompt box
    await expect(err).toBeVisible();
    // Declared after setup, so a setup failure is a real failure, not the expected one.
    test.fail(true, 'E2E-011: billing/quota gate refusals are hard-coded English');
    // Correct behaviour: the refusal is localized. Today the English
    // BillingBlocked message from src/domain/billing.ts is shown verbatim.
    await expect(err).not.toContainText(L.inactiveBlocked);
  } finally {
    await cleanup(db, t);
  }
});

// ── checkout.session.completed ──────────────────────────────────────────────
function checkoutSession(t: Throwaway, over: Record<string, unknown> = {}) {
  return { id: `cs_e2e_${t.key}`, object: 'checkout.session', mode: 'subscription',
    client_reference_id: t.camp, customer: t.cus, subscription: t.sub, ...over };
}
async function eventRows(db: SupabaseClient, id: string) {
  const { data, error } = await db.from('billing_events').select('id, campaign_id').eq('id', id);
  if (error) throw new Error(error.message);
  return data;
}

test.describe('stripe webhook: checkout.session.completed', () => {
  test('missing client_reference_id → acked as ignored', async ({ request, db }) => {
    const t = ids(testKey());
    try {
      const evt = keyedEvent(t, 'checkout.session.completed', checkoutSession(t, { client_reference_id: null }));
      const res = await sendWebhook(request, evt);
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ received: true, ignored: true });
    } finally {
      await must(db.from('billing_events').delete().like('id', `evt_e2e_${t.key}_%`));
    }
  });

  test('unknown campaign id → 409 and the claim is released', async ({ request, db }) => {
    const t = ids(testKey()); // campaign row never created
    try {
      const evt = keyedEvent(t, 'checkout.session.completed', checkoutSession(t));
      const res = await sendWebhook(request, evt);
      expect(res.status()).toBe(409);
      expect(await eventRows(db, evt.id), 'claim released so Stripe can retry').toEqual([]);
    } finally {
      await must(db.from('billing_events').delete().like('id', `evt_e2e_${t.key}_%`));
    }
  });

  test('campaign already has a newer subscription event → stale, campaign unchanged', async ({ request, db }) => {
    const t = await createCampaign(db, { plan: null });
    try {
      const now = Math.floor(Date.now() / 1000);
      await must(db.from('campaigns').update({ subscription_event_created: now + 300 }).eq('id', t.camp));
      const before = await campaignRow(db, t.camp);
      const evt = keyedEvent(t, 'checkout.session.completed', checkoutSession(t), now);
      const res = await sendWebhook(request, evt);
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ received: true, stale: true });
      expect(await campaignRow(db, t.camp)).toEqual(before);
      expect(await eventRows(db, evt.id)).toEqual([{ id: evt.id, campaign_id: t.camp }]);
    } finally {
      await cleanup(db, t);
    }
  });

  test('without a real Stripe key: valid session → 500, claim released, campaign unchanged (Stripe retries)', async ({ request, db }) => {
    test.skip(HAS_STRIPE_KEY, 'real key present — covered by the activation test');
    const t = await createCampaign(db, { plan: null });
    try {
      const before = await campaignRow(db, t.camp);
      const evt = keyedEvent(t, 'checkout.session.completed', checkoutSession(t));
      // subscriptions.retrieve fails against the dummy key.
      const res = await sendWebhook(request, evt);
      expect(res.status()).toBe(500);
      expect(await eventRows(db, evt.id), 'claim released, not silently consumed').toEqual([]);
      expect(await campaignRow(db, t.camp)).toEqual(before);
    } finally {
      await cleanup(db, t);
    }
  });

  test('with a real Stripe key: valid session activates the plan; /billing shows it', async ({ request, page, db }) => {
    test.skip(!HAS_STRIPE_KEY, NEEDS_KEY);
    const stripe = await realStripe();
    const t = await createCampaign(db, { plan: null });
    let plan: Awaited<ReturnType<typeof createRealPlan>> | undefined;
    let customer: { id: string } | undefined;
    try {
      plan = await createRealPlan(db, stripe);
      customer = await stripe.customers.create({ name: `E2E checkout-completed ${testKey()}` });
      const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
      const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: plan.priceId }],
        default_payment_method: pm.id });
      expect(sub.status).toBe('active');
      const evt = keyedEvent(t, 'checkout.session.completed',
        checkoutSession(t, { customer: customer.id, subscription: sub.id }));
      const res = await sendWebhook(request, evt);
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ received: true });
      expect(await campaignRow(db, t.camp)).toMatchObject({ plan_id: plan.id, subscription_status: 'active',
        stripe_customer_id: customer.id, stripe_subscription_id: sub.id });

      await login(page, t.email);
      await page.goto('/billing');
      await expect(page.locator('#billing-plan-heading')).toHaveText(plan.name);
    } finally {
      await cleanup(db, t);
      await plan?.remove();
      if (customer) await stripe.customers.del(customer.id); // also cancels its subscriptions
    }
  });
});

// ── Billing portal ───────────────────────────────────────────────────────────
test.describe('billing portal', () => {
  test('without a real Stripe key: Manage billing shows a handled error (no 500); staff replay refused', async ({ page, db, asRole }) => {
    test.skip(HAS_STRIPE_KEY, 'real key present — covered by the redirect test');
    const t = await createCampaign(db);
    try {
      await login(page, t.email);
      await page.goto('/billing');
      const action = await captureAction(page, () => page.getByRole('button', { name: L.manageBilling }).click());
      await expect(page.locator('.billing-portal').getByRole('alert')).toHaveText(L.portalFailed);
      await expect(page).toHaveURL(/\/billing$/);

      const staff = await asRole('staff');
      await staff.goto('/billing');
      await expect(staff.getByText('View only')).toBeVisible();
      await expect(staff.getByRole('button', { name: L.manageBilling })).toHaveCount(0);
      const res = await replayAction(staff, action);
      expect(res.status()).toBeLessThan(500);
      expect(await actionResult(res)).toEqual({ ok: false, error: L.pricingPermissionDenied });
    } finally {
      await cleanup(db, t);
    }
  });

  test('with a real Stripe key: Manage billing redirects to billing.stripe.com', async ({ page, db }) => {
    test.skip(!HAS_STRIPE_KEY, NEEDS_KEY);
    const stripe = await realStripe();
    const t = await createCampaign(db);
    let customer: { id: string } | undefined;
    try {
      customer = await stripe.customers.create({ name: `E2E portal ${testKey()}` });
      await must(db.from('campaigns').update({ stripe_customer_id: customer.id }).eq('id', t.camp));
      await login(page, t.email);
      await page.goto('/billing');
      await page.getByRole('button', { name: L.manageBilling }).click();
      await page.waitForURL(/billing\.stripe\.com/);
    } finally {
      await cleanup(db, t);
      if (customer) await stripe.customers.del(customer.id);
    }
  });
});

// ── Usage counters ───────────────────────────────────────────────────────────
test.describe('usage', () => {
  test('generating a draft increments the content counter; /billing shows usage against the plan', async ({ page, db }) => {
    const t = await createCampaign(db); // Starter: 15 content / 1 video / 2 avatars / 3 seats
    try {
      await login(page, t.email);
      await page.goto('/billing');
      const meter = (label: string) => page.locator('.billing-meter').filter({ hasText: label }).locator('.billing-meter-value');
      await expect(meter('Content pieces this period')).toHaveText('0 of 15');
      await expect(meter('Videos today')).toHaveText('0 of 1');
      await expect(meter('Avatars')).toHaveText('0 of 2');
      await expect(meter('Team seats')).toHaveText('1 of 3');

      await page.goto('/content/new');
      await page.getByLabel('What should this say?').fill(`Usage counter ${t.key}`);
      await page.getByRole('button', { name: L.generate }).click();
      await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible();
      await expect.poll(async () => {
        const { data } = await db.from('feature_usage_counters').select('count').eq('campaign_id', t.camp).eq('feature', 'content');
        return (data ?? []).reduce((n, r) => n + (r.count as number), 0);
      }).toBe(1);

      // Video counter: generation itself needs a HeyGen avatar/voice (video
      // spec); here only the meter is checked, from a counter row for today.
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      await must(db.from('feature_usage_counters').insert({ campaign_id: t.camp, feature: 'video', period_start: today.toISOString(), count: 1 }));

      await page.goto('/billing');
      await expect(meter('Content pieces this period')).toHaveText('1 of 15');
      await expect(meter('Videos today')).toHaveText('1 of 1');
      await expect(page.locator('.billing-meter.over').filter({ hasText: 'Videos today' })).toHaveCount(1);
    } finally {
      await cleanup(db, t);
    }
  });
});

// ── Admin billing ────────────────────────────────────────────────────────────
test.describe('admin billing', () => {
  test('/admin/billing lists every seeded plan', async ({ asRole }) => {
    const page = await asRole('admin');
    await page.goto('/admin/billing');
    for (const p of PLANS) await expect(page.getByRole('heading', { name: p.name, exact: true })).toBeVisible();
  });

  test('without a real Stripe key: assigning a plan fails with a handled error and changes nothing', async ({ asRole, db }) => {
    test.skip(HAS_STRIPE_KEY, 'real key present — covered by the assignment test');
    const t = await createCampaign(db, { plan: null });
    try {
      const page = await asRole('admin');
      await page.goto(`/admin/campaigns/${t.camp}`);
      await expect(page.getByText('No plan assigned')).toBeVisible();
      await page.locator('select[name="planId"]').selectOption('starter');
      await page.getByRole('button', { name: 'Assign plan' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Assign plan' }).click();
      await expect(page.getByText(L.stripeError)).toBeVisible();
      expect(await campaignRow(db, t.camp)).toMatchObject({ plan_id: null, stripe_customer_id: null, stripe_subscription_id: null });
    } finally {
      await cleanup(db, t);
    }
  });

  test('with a real Stripe key: assigning a plan updates seats; the owner sees it', async ({ asRole, page, db }) => {
    test.skip(!HAS_STRIPE_KEY, NEEDS_KEY);
    const stripe = await realStripe();
    const t = await createCampaign(db, { plan: null, perRunId: true }); // see CampOpts.perRunId
    let plan: Awaited<ReturnType<typeof createRealPlan>> | undefined;
    try {
      plan = await createRealPlan(db, stripe, 4);
      const admin = await asRole('admin');
      await admin.goto(`/admin/campaigns/${t.camp}`);
      await admin.locator('select[name="planId"]').selectOption(plan.id);
      await admin.getByRole('button', { name: 'Assign plan' }).click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Assign plan' }).click();
      await expect(admin.getByText('Plan assigned.', { exact: false })).toBeVisible();
      const row = await campaignRow(db, t.camp);
      expect(row.plan_id).toBe(plan.id);
      expect(row.stripe_customer_id).toMatch(/^cus_/);
      expect(row.stripe_subscription_id).toMatch(/^sub_/);

      await login(page, t.email);
      await page.goto('/billing');
      await expect(page.locator('#billing-plan-heading')).toHaveText(plan.name);
      await expect(page.locator('.billing-meter').filter({ hasText: 'Team seats' }).locator('.billing-meter-value')).toHaveText('1 of 4');
    } finally {
      const { data } = await db.from('campaigns').select('stripe_customer_id').eq('id', t.camp).maybeSingle();
      await cleanup(db, t);
      await plan?.remove();
      if (data?.stripe_customer_id) await stripe.customers.del(data.stripe_customer_id);
    }
  });
});
