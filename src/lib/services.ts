// Each service activates automatically when its env key is present.
// No code changes needed — just add the key to .env.

import { ContentLifecycle } from '@/domain/content-lifecycle';
import { DisclosureEngine } from '@/domain/disclosure';
import { UsageMeter } from '@/domain/usage';
import { contentRepo, approvalRepo, disclosureRepo, auditRepo, rulesRepo, usageRepo } from './repos';
import {
  ClaudeContentGenerator, MockContentGenerator,
  HeyGenVideoProvider, MockVideoProvider,
  HeyGenPhotoAvatarProvider, MockPhotoAvatarProvider,
  ElevenLabsVoiceProvider, MockVoiceProvider,
  AyrsharePublisher, MockPublisher,
  NewsDataMonitoringSource, MockMonitoringSource,
} from '@/integrations';
import type { PhotoAvatarProvider } from '@/integrations';

export const lifecycle = new ContentLifecycle(contentRepo, approvalRepo, disclosureRepo, auditRepo);
export const disclosureEngine = new DisclosureEngine(rulesRepo);
export const usageMeter = new UsageMeter(usageRepo);

export const contentGenerator = process.env.LLM_API_KEY
  ? new ClaudeContentGenerator(process.env.LLM_API_KEY)
  : new MockContentGenerator();

export const videoProvider = process.env.HEYGEN_API_KEY
  ? new HeyGenVideoProvider(process.env.HEYGEN_API_KEY)
  : new MockVideoProvider();

export const photoAvatarProvider: PhotoAvatarProvider = process.env.HEYGEN_API_KEY
  ? new HeyGenPhotoAvatarProvider(process.env.HEYGEN_API_KEY)
  : new MockPhotoAvatarProvider();

export const voiceProvider = process.env.ELEVENLABS_API_KEY
  ? new ElevenLabsVoiceProvider(process.env.ELEVENLABS_API_KEY)
  : new MockVoiceProvider();

export const publisher = process.env.AYRSHARE_API_KEY
  ? new AyrsharePublisher(process.env.AYRSHARE_API_KEY)
  : new MockPublisher();

export const monitoringSource = process.env.NEWSDATA_API_KEY
  ? new NewsDataMonitoringSource(process.env.NEWSDATA_API_KEY)
  : new MockMonitoringSource();
