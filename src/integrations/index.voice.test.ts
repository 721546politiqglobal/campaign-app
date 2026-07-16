import { describe, it, expect, afterEach, vi } from 'vitest';
import { ElevenLabsVoiceProvider } from './index';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('ElevenLabsVoiceProvider.synthesize', () => {
  it('throws when no voice id is provided and none is in the env', async () => {
    vi.stubEnv('ELEVENLABS_VOICE_ID', '');
    const p = new ElevenLabsVoiceProvider('k');
    await expect(p.synthesize({ text: 'hi' })).rejects.toThrow(/voice/i);
  });

  it('throws when the storage upload fails instead of returning a dead url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }));
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        storage: { from: () => ({
          upload: async () => ({ error: { message: 'bucket unavailable' } }),
          getPublicUrl: () => ({ data: { publicUrl: 'http://dead/url.mp3' } }),
        }) },
      }),
    }));
    const { ElevenLabsVoiceProvider: P } = await import('./index');
    const p = new P('k');
    await expect(p.synthesize({ text: 'hi', voiceId: 'v1' })).rejects.toThrow(/upload|bucket/i);
  });
});
