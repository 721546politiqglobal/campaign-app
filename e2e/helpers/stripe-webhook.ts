import Stripe from 'stripe';
import type { APIRequestContext } from '@playwright/test';
import { E2E_SECRETS } from '../env';

// Only used to sign payloads locally (generateTestHeaderString makes no API call).
const stripe = new Stripe('sk_test_e2e_dummy_key');
let seq = 0;

export function event(type: string, object: Record<string, unknown>, created = Math.floor(Date.now() / 1000)) {
  return { id: `evt_e2e_${Date.now()}_${seq++}`, object: 'event', type, created, api_version: '2025-01-27.acacia',
    data: { object }, livemode: false, pending_webhooks: 0, request: { id: null, idempotency_key: null } };
}

export async function sendWebhook(r: APIRequestContext, evt: object, secret: string = E2E_SECRETS.stripeWebhook) {
  const payload = JSON.stringify(evt);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return r.post('/api/webhooks/stripe', { headers: { 'stripe-signature': header, 'content-type': 'application/json' }, data: payload });
}
