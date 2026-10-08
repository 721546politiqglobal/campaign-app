// Each service activates automatically when its env key is present.
// No code changes needed — just add the key to .env.

import { ContentLifecycle } from '@/domain/content-lifecycle';
import { DisclosureEngine } from '@/domain/disclosure';
import { QuotaGate } from '@/domain/quota';
import { BillingGate } from '@/domain/billing';
import { contentRepo, approvalRepo, disclosureRepo, auditRepo, quotaRepo, billingRepo } from './repos';
import {
  ClaudeContentGenerator, MockContentGenerator,
  HeyGenVideoProvider, MockVideoProvider,
  HeyGenPhotoAvatarProvider, MockPhotoAvatarProvider,
  ElevenLabsVoiceProvider, MockVoiceProvider,
  AyrsharePublisher, MockPublisher, MissingKeyPublisher,
  NewsDataMonitoringSource, MockMonitoringSource,
  AyrshareAnalyticsProvider, MockAnalyticsProvider,
} from '@/integrations';
import type { PhotoAvatarProvider, Publisher, AnalyticsProvider } from '@/integrations';
import {
  AyrshareSocialAccountsProvider, MockSocialAccountsProvider,
  type SocialAccountsProvider,
} from '@/integrations/social-accounts';

export const disclosureEngine = new DisclosureEngine();
export const lifecycle = new ContentLifecycle(contentRepo, approvalRepo, disclosureRepo, auditRepo);
export const quotaGate = new QuotaGate(quotaRepo);
export const billingGate = new BillingGate(billingRepo);

// Pick the real adapter when its key is present. Without a key, local dev and
// tests get the Mock adapter; a production build gets a stand-in that fails
// each call with a clear "X is not configured" error (INT-3) — a fake
// "completed" example.com video or canned draft looks like real output and can
// end up attached and published. This file is reached by every page
// (transitively via `@/app/actions`), so a missing key must never throw HERE:
// that would crash the whole app rather than just the one feature that needed
// the key. Demo/staging deployments running a production build opt back into
// mocks with ALLOW_MOCK_PROVIDERS=true.
const mocksAllowed =
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_MOCK_PROVIDERS === 'true';

function realOrMock<R, M>(envVar: string, real: () => R, mock: () => M): R | M {
  if (process.env[envVar]) return real();
  return mocksAllowed ? mock() : missingKeyProvider<M>(envVar);
}

export class MissingProviderKeyError extends Error {
  constructor(envVar: string) {
    super(`${envVar} is not configured. This feature is unavailable until it is set.`);
  }
}

// Every method rejects with MissingProviderKeyError. `then` stays undefined so
// the object isn't mistaken for a thenable if it is ever awaited.
function missingKeyProvider<T>(envVar: string): T {
  return new Proxy({}, {
    get: (_target, prop) => prop === 'then'
      ? undefined
      : async () => { throw new MissingProviderKeyError(envVar); },
  }) as T;
}

export const contentGenerator = realOrMock(
  'LLM_API_KEY',
  () => new ClaudeContentGenerator(process.env.LLM_API_KEY!),
  () => new MockContentGenerator());

export const videoProvider = realOrMock(
  'HEYGEN_API_KEY',
  () => new HeyGenVideoProvider(process.env.HEYGEN_API_KEY!),
  () => new MockVideoProvider());

export const photoAvatarProvider: PhotoAvatarProvider = realOrMock(
  'HEYGEN_API_KEY',
  () => new HeyGenPhotoAvatarProvider(process.env.HEYGEN_API_KEY!),
  () => new MockPhotoAvatarProvider());

export const voiceProvider = realOrMock(
  'ELEVENLABS_API_KEY',
  () => new ElevenLabsVoiceProvider(process.env.ELEVENLABS_API_KEY!),
  () => new MockVoiceProvider());

// Publishing gets its own fallback instead of realOrMock: a fake success is
// harmless for every other integration (a demo video/voice/draft), but a fake
// *publish* means campaign staff believe real content went out to real social
// accounts when nothing was posted anywhere. Mock locally/in tests for the
// normal no-keys-configured dev experience; refuse to fake it in production.
export const publisher: Publisher = process.env.AYRSHARE_API_KEY
  ? new AyrsharePublisher(process.env.AYRSHARE_API_KEY)
  : process.env.NODE_ENV === 'production'
    ? new MissingKeyPublisher()
    : new MockPublisher();

// Analytics has nothing to fake — the mock just reports no metrics — so it
// stays a mock in every environment rather than failing the sync cron.
export const analyticsProvider: AnalyticsProvider = process.env.AYRSHARE_API_KEY
  ? new AyrshareAnalyticsProvider(process.env.AYRSHARE_API_KEY)
  : new MockAnalyticsProvider();

export const monitoringSource = realOrMock(
  'NEWSDATA_API_KEY',
  () => new NewsDataMonitoringSource(process.env.NEWSDATA_API_KEY!),
  () => new MockMonitoringSource());

// Per-campaign social connections (Ayrshare User Profiles). Stricter than
// realOrMock: never the mock in a production build, even with
// ALLOW_MOCK_PROVIDERS — the mock writes a 'mock-' profile key into the
// campaign row, which would poison a real database. Without the key a
// production build errors on use instead of pretending accounts are linked.
export const socialAccounts: SocialAccountsProvider = process.env.AYRSHARE_API_KEY
  ? new AyrshareSocialAccountsProvider(process.env.AYRSHARE_API_KEY)
  : process.env.NODE_ENV !== 'production'
    ? new MockSocialAccountsProvider()
    : missingKeyProvider<SocialAccountsProvider>('AYRSHARE_API_KEY');
