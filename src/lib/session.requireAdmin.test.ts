import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.SESSION_SECRET = 'test-secret';

function signCookie(payloadObj: object): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = createHmac('sha256', 'test-secret').update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => cookieStore }));

const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
vi.mock('next/navigation', () => ({ redirect }));

const maybeSingle = vi.fn();
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}));

const future = Math.floor(Date.now() / 1000) + 10_000;

describe('requireAdmin redirect target', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends a logged-in NON-admin to /dashboard (not /login)', async () => {
    cookieStore.get.mockReturnValue({ value: signCookie({ userId: 'u-1', name: 'O', role: 'owner', campaignId: 'c-1', exp: future }) });
    maybeSingle.mockResolvedValue({ data: { id: 'u-1', name: 'O', role: 'owner', campaign_id: 'c-1' } });
    const { requireAdmin } = await import('./session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('sends an anonymous visitor to /login', async () => {
    cookieStore.get.mockReturnValue(undefined);
    const { requireAdmin } = await import('./session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT:/login');
  });

  it('allows a super_admin through', async () => {
    cookieStore.get.mockReturnValue({ value: signCookie({ userId: 'u-a', name: 'A', role: 'super_admin', campaignId: 'c-1', exp: future }) });
    maybeSingle.mockResolvedValue({ data: { id: 'u-a', name: 'A', role: 'super_admin', campaign_id: 'c-1' } });
    const { requireAdmin } = await import('./session');
    const s = await requireAdmin();
    expect(s.role).toBe('super_admin');
  });
});
