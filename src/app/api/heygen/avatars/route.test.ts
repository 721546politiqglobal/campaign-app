import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSession = vi.fn();
vi.mock('@/lib/session', () => ({ getSession }));

describe('heygen avatars proxy auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null);
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest('http://x/api/heygen/avatars?baseId=b1'));
    expect(res.status).toBe(401);
  });
});
