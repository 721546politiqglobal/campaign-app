import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('provider seam mocks missing keys instead of crashing', () => {
  // INT-3: a fake "completed" example.com video / canned draft / stock voice in
  // production looks like real output and can end up attached and published.
  // Importing must still never throw (every page reaches this module), so the
  // failure surfaces only when the feature is actually used.
  it('in production, a missing key fails the call loudly instead of faking output', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AYRSHARE_API_KEY', 'k');
    vi.stubEnv('HEYGEN_API_KEY', '');
    vi.stubEnv('LLM_API_KEY', '');
    vi.stubEnv('ELEVENLABS_API_KEY', '');
    vi.stubEnv('NEWSDATA_API_KEY', '');
    const mod = await import('./services');
    await expect(mod.videoProvider.generateAvatarVideo({ script: 's' })).rejects.toThrow(/HEYGEN_API_KEY/);
    await expect(mod.photoAvatarProvider.getAvatarGroupStatus('g')).rejects.toThrow(/HEYGEN_API_KEY/);
    await expect(mod.voiceProvider.synthesize({ text: 't' })).rejects.toThrow(/ELEVENLABS_API_KEY/);
    await expect(mod.contentGenerator.draft({} as never)).rejects.toThrow(/LLM_API_KEY/);
    await expect(mod.monitoringSource.poll({ keywords: [], opponents: [] })).rejects.toThrow(/NEWSDATA_API_KEY/);
    // Analytics has nothing to fake — the mock just returns no metrics.
    expect(await mod.analyticsProvider.getPostAnalytics([{ platform: 'x', postId: 'p1' }], 'pk-test')).toEqual([]);
  });

  it('ALLOW_MOCK_PROVIDERS=true keeps mocks for demo deployments running a production build', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_MOCK_PROVIDERS', 'true');
    vi.stubEnv('HEYGEN_API_KEY', '');
    const mod = await import('./services');
    const { MockVideoProvider } = await import('@/integrations');
    expect(mod.videoProvider).toBeInstanceOf(MockVideoProvider);
  });

  it('publisher refuses to fake a successful publish when the key is missing in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AYRSHARE_API_KEY', '');
    const mod = await import('./services');
    const { MissingKeyPublisher } = await import('@/integrations');
    expect(mod.publisher).toBeInstanceOf(MissingKeyPublisher);
    const out = await mod.publisher.publish({ platforms: ['x'], text: 't', disclosureText: '' } as never);
    expect(out).toEqual([{ platform: 'x', status: 'failed', error: expect.stringContaining('AYRSHARE_API_KEY') }]);
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

  it('analyticsProvider uses the mock (empty array, no throw) when the key is missing', async () => {
    vi.stubEnv('AYRSHARE_API_KEY', '');
    const mod = await import('./services');
    const out = await mod.analyticsProvider.getPostAnalytics([{ platform: 'x', postId: 'p1' }], 'pk-test');
    expect(out).toEqual([]);
  });

  it('analyticsProvider uses the real adapter when the key is present', async () => {
    vi.stubEnv('AYRSHARE_API_KEY', 'k');
    const mod = await import('./services');
    const { AyrshareAnalyticsProvider } = await import('@/integrations');
    expect(mod.analyticsProvider).toBeInstanceOf(AyrshareAnalyticsProvider);
  });

  it('socialAccounts fails loudly in production without AYRSHARE_API_KEY and is real with it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AYRSHARE_API_KEY', '');
    let mod = await import('./services');
    await expect(mod.socialAccounts.getConnectedAccounts('pk')).rejects.toThrow(/AYRSHARE_API_KEY/);
    vi.resetModules();
    vi.stubEnv('AYRSHARE_API_KEY', 'k');
    mod = await import('./services');
    const { AyrshareSocialAccountsProvider } = await import('@/integrations/social-accounts');
    expect(mod.socialAccounts).toBeInstanceOf(AyrshareSocialAccountsProvider);
  });

  // A mock profile key stored in a real DB would later be sent to Ayrshare as
  // if real, so production builds never get the mock — even for demos.
  it('socialAccounts ignores ALLOW_MOCK_PROVIDERS in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_MOCK_PROVIDERS', 'true');
    vi.stubEnv('AYRSHARE_API_KEY', '');
    const mod = await import('./services');
    const { MockSocialAccountsProvider } = await import('@/integrations/social-accounts');
    expect(mod.socialAccounts).not.toBeInstanceOf(MockSocialAccountsProvider);
    await expect(mod.socialAccounts.getConnectedAccounts('pk')).rejects.toThrow(/AYRSHARE_API_KEY/);
  });

  it('socialAccounts is the mock outside production without a key', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AYRSHARE_API_KEY', '');
    const mod = await import('./services');
    const { MockSocialAccountsProvider } = await import('@/integrations/social-accounts');
    expect(mod.socialAccounts).toBeInstanceOf(MockSocialAccountsProvider);
  });
});
