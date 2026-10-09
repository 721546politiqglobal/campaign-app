import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSession = vi.fn();
vi.mock('@/lib/session', () => ({ getSession }));
const getCandidateProfile = vi.fn();
vi.mock('@/lib/candidate', () => ({ getCandidateProfile }));

const upstream = [
  { voice_id: 'v-ours', name: 'Rivera clone' },
  { voice_id: 'v-theirs', name: 'Other campaign clone' },
  { voice_id: 'v-stock', name: 'Stock voice' },
];
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ voices: upstream }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('ELEVENLABS_API_KEY', 'test-key');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('GET /api/elevenlabs/voices — tenant scoping', () => {
  it('rejects unauthenticated callers', async () => {
    getSession.mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns only the caller's own campaign voice, never other tenants' clones", async () => {
    getSession.mockResolvedValue({ userId: 'u-1', role: 'owner', campaignId: 'c-1' });
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: 'v-ours' });
    const { GET } = await import('./route');
    const body = await (await GET()).json();
    expect(getCandidateProfile).toHaveBeenCalledWith('c-1');
    expect(body.voices.map((v: { voice_id: string }) => v.voice_id)).toEqual(['v-ours']);
  });

  it('returns an empty list (without calling ElevenLabs) when the campaign has no voice assigned', async () => {
    getSession.mockResolvedValue({ userId: 'u-1', role: 'manager', campaignId: 'c-1' });
    getCandidateProfile.mockResolvedValue({ elevenLabsVoiceId: null });
    const { GET } = await import('./route');
    const body = await (await GET()).json();
    expect(body.voices).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives super_admin the full account list (they assign voices to campaigns)', async () => {
    getSession.mockResolvedValue({ userId: 'admin', role: 'super_admin', campaignId: null });
    const { GET } = await import('./route');
    const body = await (await GET()).json();
    expect(body.voices).toHaveLength(3);
    expect(getCandidateProfile).not.toHaveBeenCalled();
  });

  it('degrades to an empty list without leaking the upstream status text', async () => {
    getSession.mockResolvedValue({ userId: 'admin', role: 'super_admin', campaignId: null });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as never);
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.voices).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('503');
  });
});
