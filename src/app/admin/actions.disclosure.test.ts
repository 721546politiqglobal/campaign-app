import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ userId: 'u-admin' })) }));
vi.mock('@/lib/stripe', () => ({ stripe: null }));
vi.mock('@/lib/store', () => ({ prefixedId: vi.fn(), inviteCode: vi.fn() }));

const updateEq = vi.fn(async () => ({ error: null }));
const update = vi.fn(() => ({ eq: updateEq }));
vi.mock('@/lib/supabase', () => ({ adminDb: { from: vi.fn(() => ({ update })) }, throwOnError: async (q: any) => (await q).data ?? (await q) }));

function form() {
  const fd = new FormData();
  fd.set('jurisdiction', 'US-CA');
  fd.set('requiredText', 'AI notice');
  fd.set('placement', 'overlay');
  fd.set('blackoutDays', '60'); // still posted by a stale client — must be ignored
  fd.set('requiresAiLabel', 'on');
  return fd;
}

describe('updateDisclosureRuleAction no longer touches blackout days', () => {
  beforeEach(() => vi.clearAllMocks());

  it('omits blackout_days_before_election from the update payload', async () => {
    const { updateDisclosureRuleAction } = await import('./actions');
    await updateDisclosureRuleAction(form());
    const payload = (update.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('blackout_days_before_election');
    expect(payload).toMatchObject({ required_text: 'AI notice', placement: 'overlay' });
  });
});
