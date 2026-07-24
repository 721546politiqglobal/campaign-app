import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('provider seam mocks missing keys instead of crashing', () => {
  it('uses mocks (no throw) when keys are missing in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AYRSHARE_API_KEY', '');
    vi.stubEnv('HEYGEN_API_KEY', '');
    vi.stubEnv('LLM_API_KEY', '');
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    vi.stubEnv('NEWSDATA_API_KEY', '');
    const mod = await import('./services');
    const out = await mod.publisher.publish({ platforms: ['x'], text: 't', disclosureText: '' } as never);
    expect(out).toEqual([{ platform: 'x', status: 'scheduled' }]);
  });

  it('uses mocks (no throw) when keys are missing outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AYRSHARE_API_KEY', '');
    const mod = await import('./services');
    const out = await mod.publisher.publish({ platforms: ['x'], text: 't', disclosureText: '' } as never);
    expect(out).toEqual([{ platform: 'x', status: 'scheduled' }]);
  });

  it('uses the real adapter when the key is present, in any environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AYRSHARE_API_KEY', 'k');
    vi.stubEnv('HEYGEN_API_KEY', 'k');
    vi.stubEnv('LLM_API_KEY', 'k');
    vi.stubEnv('ELEVENLABS_API_KEY', 'k');
    vi.stubEnv('NEWSDATA_API_KEY', 'k');
    const mod = await import('./services');
    const { AyrsharePublisher } = await import('@/integrations');
    expect(mod.publisher).toBeInstanceOf(AyrsharePublisher);
  });
});
