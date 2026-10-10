import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export const BASE_URL = 'http://localhost:3100';
export const E2E_SECRETS = {
  cron: 'e2e-cron-secret',
  monitoring: 'e2e-monitoring-secret',
  stripeWebhook: 'whsec_e2e_test_secret',
  // src/lib/session.ts imposes no length rule; kept long anyway (HMAC key).
  session: 'e2e-session-secret-at-least-32-characters-long',
  // Only ever accepted by the fake Ayrshare (e2e/fake-ayrshare/server.ts).
  ayrshareKey: 'e2e-fake-ayrshare-key',
} as const;
// The fake Ayrshare the E2E server talks to (AYRSHARE_BASE_URL, see src/integrations/ayrshare-base.ts).
export const FAKE_AYRSHARE_URL = 'http://127.0.0.1:3199';

// The only Supabase project the suite may ever talk to (mirrors ALLOWED_REFS in reset-db.ts).
const E2E_PROJECT_REF = 'pckrdspetqcdbmcrqapx';

const ROOT = resolve(__dirname, '..');

// Same line grammar as `dotenv.parse` (dotenv v16, which @next/env bundles): optional
// `export ` prefix, leading whitespace, `=` or `: ` separator, single/double/backtick
// quotes (multi-line allowed), `#` comments, and \n / \r escapes inside double quotes.
const DOTENV_LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]*)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;

export function parseDotEnvText(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = src.replace(/\r\n?/gm, '\n');
  for (const m of lines.matchAll(DOTENV_LINE)) {
    const key = m[1];
    let value = (m[2] || '').trim();
    const quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, '$2');
    if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    out[key] = value;
  }
  return out;
}

function parseDotEnv(p: string): Record<string, string> {
  if (!existsSync(p)) return {};
  return parseDotEnvText(readFileSync(p, 'utf8'));
}

// Values from .env.e2e, overridden by real process env (CI secrets).
export const E2E_ENV: Record<string, string> = { ...parseDotEnv(resolve(ROOT, '.env.e2e')), ...process.env as Record<string, string> };

const VENDOR_KEYS = ['LLM_API_KEY', 'HEYGEN_API_KEY', 'HEYGEN_AVATAR_ID', 'HEYGEN_VOICE_ID',
  'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'NEWSDATA_API_KEY'];

// Files `next build` / `next start` auto-load in production mode. @next/env never
// overrides a variable that is already set (even to ''), so every key named in
// these files is blanked below unless serverEnv() sets it explicitly — a key
// added to the owner's `.env` later can therefore never leak into the e2e server.
const NEXT_PROD_ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local'];

function nextEnvFileKeys(): string[] {
  return NEXT_PROD_ENV_FILES.flatMap((f) => Object.keys(parseDotEnv(resolve(ROOT, f))));
}

export function assertTestProject(url: string | undefined): string {
  let host = '';
  try { host = new URL(url ?? '').hostname; } catch { /* handled below */ }
  if (host !== `${E2E_PROJECT_REF}.supabase.co`) {
    throw new Error(`[e2e] NEXT_PUBLIC_SUPABASE_URL must point at the e2e project ${E2E_PROJECT_REF} (got host "${host || 'none'}"). Check .env.e2e.`);
  }
  return url!;
}

// An Ayrshare key must never be paired with a non-loopback URL (or no URL,
// which means the real Ayrshare).
function assertFakeAyrshare(env: Record<string, string>) {
  if (!env.AYRSHARE_API_KEY) return;
  let host = '';
  try { host = new URL(env.AYRSHARE_BASE_URL ?? '').hostname; } catch { /* handled below */ }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error('[e2e] AYRSHARE_API_KEY is set but AYRSHARE_BASE_URL is not a loopback URL — refusing to talk to real Ayrshare.');
  }
}

export function serverEnv(): Record<string, string> {
  const e = E2E_ENV;
  const stripeKey = e.STRIPE_TEST_SECRET_KEY;
  if (stripeKey && !stripeKey.startsWith('sk_test_')) {
    throw new Error('[e2e] STRIPE_TEST_SECRET_KEY must be a test-mode key (sk_test_…).');
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!e[k]) throw new Error(`[e2e] ${k} is missing — copy e2e/.env.e2e.example to .env.e2e.`);
  }
  const explicit: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NODE_ENV: 'production',
    PORT: '3100',
    // Separate build dir (see next.config.mjs) so the owner's `next dev` in .next survives.
    NEXT_DIST_DIR: '.next-e2e',
    ALLOW_MOCK_PROVIDERS: 'true',
    NEXT_PUBLIC_SITE_URL: BASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: assertTestProject(e.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_ANON_KEY: e.SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SERVICE_ROLE_KEY,
    SESSION_SECRET: E2E_SECRETS.session,
    CRON_SECRET: E2E_SECRETS.cron,
    MONITORING_INGEST_SECRET: E2E_SECRETS.monitoring,
    STRIPE_SECRET_KEY: stripeKey || 'sk_test_e2e_dummy_key',
    STRIPE_PUBLISHABLE_KEY: '',
    STRIPE_WEBHOOK_SECRET: E2E_SECRETS.stripeWebhook,
    NEXT_PUBLIC_CONTACT_EMAIL: 'support@e2e.test',
    ...Object.fromEntries(VENDOR_KEYS.map((k) => [k, ''])),
    // Real Ayrshare adapters, pointed at the local fake.
    AYRSHARE_API_KEY: E2E_SECRETS.ayrshareKey,
    AYRSHARE_BASE_URL: FAKE_AYRSHARE_URL,
  };
  const blanked = Object.fromEntries(nextEnvFileKeys().map((k) => [k, '']));
  const out = { ...blanked, ...explicit };
  assertFakeAyrshare(out);
  return out;
}
