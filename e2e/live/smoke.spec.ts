import { existsSync } from 'fs';
import { test, expect } from '@playwright/test';
import Anthropic from '@anthropic-ai/sdk';
import Stripe from 'stripe';

// Real vendor keys from the owner's `.env` (node --env-file semantics).
// Read-only / cheap calls only: no video renders, no posts, no charges.
// Key values are never logged.
if (existsSync('.env')) process.loadEnvFile('.env');

test('Claude: a tiny draft round-trips', async () => {
  const key = process.env.LLM_API_KEY;
  test.skip(!key, 'LLM_API_KEY not set');
  const client = new Anthropic({ apiKey: key! });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 50,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  });
  expect(msg.content.some((b) => b.type === 'text' && b.text.length > 0)).toBe(true);
});

test('ElevenLabs: GET /v1/voices lists voices', async () => {
  const key = process.env.ELEVENLABS_API_KEY;
  test.skip(!key, 'ELEVENLABS_API_KEY not set');
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key! } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.voices)).toBe(true);
});

// /v2/avatars returns the whole public catalogue (~1,300 avatars, ~40s), so the
// key is checked against the fast remaining-quota endpoint instead.
test('HeyGen: the API key authenticates (remaining quota)', async () => {
  const key = process.env.HEYGEN_API_KEY;
  test.skip(!key, 'HEYGEN_API_KEY not set');
  const res = await fetch('https://api.heygen.com/v2/user/remaining_quota', { headers: { 'X-Api-Key': key!, accept: 'application/json' } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.error ?? null).toBeNull();
});

test('Ayrshare: GET /api/user returns the account', async () => {
  const key = process.env.AYRSHARE_API_KEY;
  test.skip(!key, 'AYRSHARE_API_KEY not set');
  const res = await fetch('https://api.ayrshare.com/api/user', { headers: { Authorization: `Bearer ${key}` } });
  expect(res.status).toBe(200);
});

test('Stripe: prices.list works (test-mode keys only)', async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  test.skip(!key?.startsWith('sk_test_'), 'STRIPE_SECRET_KEY absent or not a test-mode key');
  const stripe = new Stripe(key!);
  const prices = await stripe.prices.list({ limit: 1 });
  expect(Array.isArray(prices.data)).toBe(true);
});
