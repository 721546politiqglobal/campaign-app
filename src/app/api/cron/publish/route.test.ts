import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn() } }));
vi.mock('@/lib/services', () => ({ publisher: { publish: vi.fn() } }));
vi.mock('@/lib/repos', () => ({ disclosureRepo: { listFor: vi.fn(() => []) } }));

describe('cron publish auth fails closed', () => {
  it('rejects when CRON_SECRET is unset even with "Bearer undefined"', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('./route');
    const res = await GET(new Request('http://x', { headers: { authorization: 'Bearer undefined' } }) as any);
    expect(res.status).toBe(401);
  });
});
