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

// Pick the real adapter when its key is present, otherwise fall back to the
// Mock adapter — in every environment, including production. This file is
// reached by every page (transitively via `@/app/actions`), so a missing key
// must never throw here: that would crash the whole app rather than just the
// one feature that needed the key. Demo/staging deployments are expected to
// run with only a subset of keys configured; unconfigured integrations mock
// instead of erroring.
function realOrMock<R, M>(key: string | undefined, real: () => R, mock: () => M): R | M {
  return key ? real() : mock();
}

export const contentGenerator = realOrMock(
  process.env.LLM_API_KEY,
  () => new ClaudeContentGenerator(process.env.LLM_API_KEY!),
  () => new MockContentGenerator());

export const videoProvider = realOrMock(
  process.env.HEYGEN_API_KEY,
  () => new HeyGenVideoProvider(process.env.HEYGEN_API_KEY!),
  () => new MockVideoProvider());

export const photoAvatarProvider: PhotoAvatarProvider = realOrMock(
  process.env.HEYGEN_API_KEY,
  () => new HeyGenPhotoAvatarProvider(process.env.HEYGEN_API_KEY!),
  () => new MockPhotoAvatarProvider());

export const voiceProvider = realOrMock(
  process.env.ELEVENLABS_API_KEY,
  () => new ElevenLabsVoiceProvider(process.env.ELEVENLABS_API_KEY!),
  () => new MockVoiceProvider());

export const publisher: Publisher = realOrMock(
  process.env.AYRSHARE_API_KEY,
  () => new AyrsharePublisher(process.env.AYRSHARE_API_KEY!),
  () => new MockPublisher());

export const monitoringSource = realOrMock(
  process.env.NEWSDATA_API_KEY,
  () => new NewsDataMonitoringSource(process.env.NEWSDATA_API_KEY!),
  () => new MockMonitoringSource());
