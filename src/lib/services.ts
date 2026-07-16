// Each service activates automatically when its env key is present.
// No code changes needed — just add the key to .env.

import { ContentLifecycle } from '@/domain/content-lifecycle';
import { DisclosureEngine } from '@/domain/disclosure';
import { UsageMeter } from '@/domain/usage';
import { BillingGate } from '@/domain/billing';
import { contentRepo, approvalRepo, disclosureRepo, auditRepo, rulesRepo, usageRepo, billingRepo } from './repos';
import {
  ClaudeContentGenerator, MockContentGenerator,
  HeyGenVideoProvider, MockVideoProvider,
  HeyGenPhotoAvatarProvider, MockPhotoAvatarProvider,
  ElevenLabsVoiceProvider, MockVoiceProvider,
  AyrsharePublisher, MockPublisher,
  NewsDataMonitoringSource, MockMonitoringSource,
} from '@/integrations';
import type { PhotoAvatarProvider, Publisher } from '@/integrations';

export const lifecycle = new ContentLifecycle(contentRepo, approvalRepo, disclosureRepo, auditRepo);
export const disclosureEngine = new DisclosureEngine(rulesRepo);
export const usageMeter = new UsageMeter(usageRepo);
export const billingGate = new BillingGate(billingRepo);

// Pick the real adapter when its key is present. Outside production, fall back
// to the Mock adapter (dev/test convenience). IN PRODUCTION a missing key
// THROWS instead of silently mocking — a mock reports "published"/"video ready"
// while nothing happened, so we refuse to boot rather than fake success (INT-3).
function realOrMock<R, M>(
  key: string | undefined,
  envVar: string,
  real: () => R,
  mock: () => M,
): R | M {
  if (key) return real();
  // Fail closed at runtime in production, but NOT during `next build` (which
  // imports this module for page-data collection and never calls a provider) —
  // otherwise a missing key would abort the build instead of the running server.
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
    throw new Error(`${envVar} is not configured. Refusing to start with a mock provider in production.`);
  }
  return mock();
}

export const contentGenerator = realOrMock(
  process.env.LLM_API_KEY, 'LLM_API_KEY',
  () => new ClaudeContentGenerator(process.env.LLM_API_KEY!),
  () => new MockContentGenerator());

export const videoProvider = realOrMock(
  process.env.HEYGEN_API_KEY, 'HEYGEN_API_KEY',
  () => new HeyGenVideoProvider(process.env.HEYGEN_API_KEY!),
  () => new MockVideoProvider());

export const photoAvatarProvider: PhotoAvatarProvider = realOrMock(
  process.env.HEYGEN_API_KEY, 'HEYGEN_API_KEY',
  () => new HeyGenPhotoAvatarProvider(process.env.HEYGEN_API_KEY!),
  () => new MockPhotoAvatarProvider());

export const voiceProvider = realOrMock(
  process.env.ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY',
  () => new ElevenLabsVoiceProvider(process.env.ELEVENLABS_API_KEY!),
  () => new MockVoiceProvider());

export const publisher: Publisher = realOrMock(
  process.env.AYRSHARE_API_KEY, 'AYRSHARE_API_KEY',
  () => new AyrsharePublisher(process.env.AYRSHARE_API_KEY!),
  () => new MockPublisher());

export const monitoringSource = realOrMock(
  process.env.NEWSDATA_API_KEY, 'NEWSDATA_API_KEY',
  () => new NewsDataMonitoringSource(process.env.NEWSDATA_API_KEY!),
  () => new MockMonitoringSource());
