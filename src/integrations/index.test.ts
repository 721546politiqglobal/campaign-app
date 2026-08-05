import { describe, it, expect, vi, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { HeyGenPhotoAvatarProvider, MockPhotoAvatarProvider, ClaudeContentGenerator, HeyGenAccessDeniedError, HeyGenVoiceCloneLimitError } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(function AnthropicMock() {
      return { messages: { create: vi.fn() } };
    }),
  };
});

function makeGenerator(): { generator: ClaudeContentGenerator; create: ReturnType<typeof vi.fn> } {
  const generator = new ClaudeContentGenerator('test-key');
  const MockedAnthropic = Anthropic as unknown as ReturnType<typeof vi.fn>;
  const instance = MockedAnthropic.mock.results[MockedAnthropic.mock.results.length - 1].value;
  return { generator, create: instance.messages.create };
}

describe('ClaudeContentGenerator.draft', () => {
  it('parses the title and body out of a normal text response', async () => {
    const { generator, create } = makeGenerator();
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'Title: A great headline\n\nBody line one.\nBody line two.' }],
    });

    const out = await generator.draft({ instruction: 'write something', type: 'social_post' });

    expect(out.title).toBe('A great headline');
    expect(out.text).toBe('Body line one.\nBody line two.');
  });

  it('throws a clear error instead of crashing when the response has no text block', async () => {
    const { generator, create } = makeGenerator();
    // e.g. Claude refuses the request — content comes back empty.
    create.mockResolvedValue({ content: [], stop_reason: 'refusal' });

    await expect(generator.draft({ instruction: 'write something', type: 'social_post' }))
      .rejects.toThrow(/refusal/);
  });
});

describe('HeyGenPhotoAvatarProvider.uploadAsset', () => {
  it('posts multipart form data and returns the asset id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { asset_id: 'asset_123' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.uploadAsset(Buffer.from('fake-image-bytes'), 'image/jpeg');

    expect(result).toEqual({ assetId: 'asset_123' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/assets');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Api-Key']).toBe('test-key');
  });

  it('throws with the HeyGen error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'bad file' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.uploadAsset(Buffer.from('x'), 'image/jpeg')).rejects.toThrow('bad file');
  });
});

describe('HeyGenPhotoAvatarProvider.createAvatarLook', () => {
  it('creates a new group when avatarGroupId is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_1', group_id: 'group_1' }, avatar_group: { id: 'group_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.createAvatarLook({ name: 'Studio look', assetId: 'asset_123' });

    expect(result).toEqual({ lookId: 'look_1', groupId: 'group_1' });
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.type).toBe('photo');
    expect(body.file).toEqual({ type: 'asset_id', asset_id: 'asset_123' });
    expect(body.avatar_group_id).toBeUndefined();
  });

  it('adds a look to an existing group when avatarGroupId is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_2', group_id: 'group_1' }, avatar_group: { id: 'group_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await provider.createAvatarLook({ name: 'Studio look', assetId: 'asset_456', avatarGroupId: 'group_1' });

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.avatar_group_id).toBe('group_1');
  });
});

describe('HeyGenPhotoAvatarProvider.createPromptLook', () => {
  it('conditions generation on an existing look id, not a group id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_3', group_id: 'group_1' }, avatar_group: { id: 'group_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.createPromptLook({
      name: 'Studio look',
      prompt: 'studio lighting, navy suit, American flag backdrop',
      avatarId: 'look_1',
    });

    expect(result).toEqual({ lookId: 'look_3', groupId: 'group_1' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/avatars');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      type: 'prompt',
      name: 'Studio look',
      prompt: 'studio lighting, navy suit, American flag backdrop',
      avatar_id: 'look_1',
    });
  });

  it('throws with the HeyGen error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'avatar not found' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.createPromptLook({ name: 'n', prompt: 'p', avatarId: 'missing' }))
      .rejects.toThrow('avatar not found');
  });
});

describe('HeyGenPhotoAvatarProvider.createVideoAvatar', () => {
  it('creates a digital_twin avatar from an uploaded asset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { avatar_item: { id: 'look_dt_1', group_id: 'group_dt_1' }, avatar_group: { id: 'group_dt_1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.createVideoAvatar({ name: 'Candidate twin', assetId: 'asset_video_1' });

    expect(result).toEqual({ lookId: 'look_dt_1', groupId: 'group_dt_1' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/avatars');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ type: 'digital_twin', name: 'Candidate twin', file: { type: 'asset_id', asset_id: 'asset_video_1' } });
  });

  it('throws a generic error with the HeyGen message for a non-access failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'invalid training footage' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.createVideoAvatar({ name: 'n', assetId: 'a' }))
      .rejects.toThrow('invalid training footage');
  });

  it('throws HeyGenAccessDeniedError specifically on a 403 (account not enabled for Digital Twin)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'digital twin not enabled for this account' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.createVideoAvatar({ name: 'n', assetId: 'a' }))
      .rejects.toBeInstanceOf(HeyGenAccessDeniedError);
  });

  it('throws HeyGenAccessDeniedError specifically on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid api key' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    await expect(provider.createVideoAvatar({ name: 'n', assetId: 'a' }))
      .rejects.toBeInstanceOf(HeyGenAccessDeniedError);
  });
});

describe('HeyGenPhotoAvatarProvider.requestConsent', () => {
  it('requests Level 1 (hosted webcam) consent and returns the url + status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { url: 'https://app.heygen.com/consent/abc', avatar_group: { id: 'group_dt_1', consent_status: 'pending' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.requestConsent({ groupId: 'group_dt_1', rerouteUrl: 'https://app.test/avatars' });

    expect(result).toEqual({ consentUrl: 'https://app.heygen.com/consent/abc', consentStatus: 'pending' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/avatars/group_dt_1/consent');
    expect(JSON.parse(opts.body)).toEqual({ reroute_url: 'https://app.test/avatars' });
  });

  it('falls back to "pending" when HeyGen returns an unrecognized consent_status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { url: 'https://app.heygen.com/consent/abc', avatar_group: { consent_status: 'something_new' } } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.requestConsent({ groupId: 'group_dt_1' });

    expect(result.consentStatus).toBe('pending');
  });
});

describe('HeyGenPhotoAvatarProvider.getAvatarGroupStatus', () => {
  it('polls the single-resource endpoint and normalizes a completed group', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: 'group_1', status: 'completed', preview_image_url: 'https://example.com/1.jpg', looks_count: 4 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.getAvatarGroupStatus('group_1');

    expect(result).toEqual({ status: 'completed', previewImageUrl: 'https://example.com/1.jpg', error: undefined, consentStatus: null });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.heygen.com/v3/avatars/group_1');
  });

  it('normalizes a failed group', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: 'group_2', status: 'failed', error: { code: 'training_failed', message: 'bad photo' } },
      }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.getAvatarGroupStatus('group_2');

    expect(result).toEqual({
      status: 'failed', previewImageUrl: undefined, error: { code: 'training_failed', message: 'bad photo' }, consentStatus: null,
    });
  });

  it('surfaces consent_status for a digital twin group awaiting the candidate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'group_dt_1', status: 'pending_consent', consent_status: 'pending' } }),
    }));

    const provider = new HeyGenPhotoAvatarProvider('test-key');
    const result = await provider.getAvatarGroupStatus('group_dt_1');

    expect(result).toEqual({ status: 'pending_consent', previewImageUrl: undefined, error: undefined, consentStatus: 'pending' });
  });
});

describe('HeyGenPhotoAvatarProvider.cloneVoice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /v3/voices/clone and returns the voice_clone_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { voice_clone_id: 'clone-123' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    const result = await provider.cloneVoice({ name: 'My voice', assetId: 'asset-1' });

    expect(result).toEqual({ voiceCloneId: 'clone-123' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.heygen.com/v3/voices/clone', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Api-Key': 'test-key' }),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ voice_name: 'My voice', audio: { type: 'asset_id', asset_id: 'asset-1' }, remove_background_noise: true });
  });

  it('throws with the HeyGen error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'clone limit reached' } }),
    }));
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.cloneVoice({ name: 'x', assetId: 'a' })).rejects.toThrow(/clone limit reached/);
  });

  // HeyGen doesn't document a stable error code for the platform-wide
  // 10-voice-clone cap, so detection is a best-effort heuristic: a 400
  // response whose message plausibly mentions a limit.
  it('throws HeyGenVoiceCloneLimitError specifically on a 400 whose message mentions a limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'voice clone limit reached for this account' } }),
    }));
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.cloneVoice({ name: 'x', assetId: 'a' })).rejects.toBeInstanceOf(HeyGenVoiceCloneLimitError);
  });

  it('throws a generic error (not the limit error) for an unrelated 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'invalid audio format' } }),
    }));
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.cloneVoice({ name: 'x', assetId: 'a' }))
      .rejects.not.toBeInstanceOf(HeyGenVoiceCloneLimitError);
  });
});

describe('HeyGenPhotoAvatarProvider.getVoiceCloneStatus', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps HeyGen "complete" to "ready"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { status: 'complete' } }),
    }));
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    const result = await provider.getVoiceCloneStatus('clone-123');

    expect(result).toEqual({ status: 'ready' });
  });

  it('maps an unrecognized status to "training" rather than propagating it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { status: 'something-new' } }),
    }));
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    const result = await provider.getVoiceCloneStatus('clone-123');

    expect(result).toEqual({ status: 'training' });
  });
});

describe('HeyGenPhotoAvatarProvider.deleteVoiceClone', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls DELETE /v3/voices/{id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { voice_id: 'clone-123' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await provider.deleteVoiceClone('clone-123');

    expect(fetchMock).toHaveBeenCalledWith('https://api.heygen.com/v3/voices/clone-123', expect.objectContaining({ method: 'DELETE' }));
  });

  it('treats a 404 voice_not_found response as success, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: 'voice_not_found' } }),
    }));
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.deleteVoiceClone('already-gone')).resolves.toBeUndefined();
  });

  it('throws on any other error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: { message: 'server error' } }),
    }));
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.deleteVoiceClone('clone-123')).rejects.toThrow(/server error/);
  });
});

describe('HeyGenPhotoAvatarProvider.synthesizeSpeech', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to /v3/voices/speech and returns the audio_url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { audio_url: 'https://heygen.test/preview.mp3', duration: 3.2 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    const result = await provider.synthesizeSpeech({ voiceId: 'clone-123', text: 'Hello, this is a preview.' });

    expect(result).toEqual({ audioUrl: 'https://heygen.test/preview.mp3' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.heygen.com/v3/voices/speech', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Api-Key': 'test-key' }),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ text: 'Hello, this is a preview.', voice_id: 'clone-123' });
  });

  it('throws if HeyGen does not return an audio_url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.synthesizeSpeech({ voiceId: 'clone-123', text: 'x' })).rejects.toThrow(/did not return an audio/i);
  });

  it('throws if audio_url is not a string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { audio_url: 12345 } }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.synthesizeSpeech({ voiceId: 'clone-123', text: 'x' })).rejects.toThrow(/did not return an audio/i);
  });

  it('throws with the HeyGen error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'invalid voice_id' } }),
    }));
    const { HeyGenPhotoAvatarProvider } = await import('./index');
    const provider = new HeyGenPhotoAvatarProvider('test-key');

    await expect(provider.synthesizeSpeech({ voiceId: 'bad-id', text: 'x' })).rejects.toThrow(/invalid voice_id/);
  });
});

describe('MockPhotoAvatarProvider', () => {
  it('returns immediately-completed mock data', async () => {
    const provider = new MockPhotoAvatarProvider();
    const { assetId } = await provider.uploadAsset(Buffer.from('x'), 'image/jpeg');
    const { groupId } = await provider.createAvatarLook({ name: 'n', assetId });
    const result = await provider.getAvatarGroupStatus(groupId);
    expect(result).toEqual({ status: 'completed', previewImageUrl: 'https://example.com/mock-avatar.jpg' });
  });

  it('creates a mock digital twin and returns instantly-approved consent', async () => {
    const provider = new MockPhotoAvatarProvider();
    const { assetId } = await provider.uploadAsset(Buffer.from('x'), 'video/mp4');
    const { groupId } = await provider.createVideoAvatar({ name: 'n', assetId });
    const { consentStatus } = await provider.requestConsent({ groupId });
    expect(consentStatus).toBe('approved');
  });
});
