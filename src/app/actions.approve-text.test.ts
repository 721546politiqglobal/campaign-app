import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { userId: 'u-1', name: 'Owner', role: 'owner' as const, campaignId: 'c-1', exp: 9_999_999_999 };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session) }));

// Deliberately NOT mocking @/lib/services or @/lib/repos — this test exercises
// the REAL ContentLifecycle FSM (via the real contentRepo/approvalRepo/auditRepo),
// backed only by a fake Supabase client, so it actually reproduces the
// "can't move content from draft to approved" gate error instead of asserting
// against a mocked lifecycle that would hide it.
let status: string = 'draft';
const row = () => ({
  id: 'x', campaign_id: 'c-1', type: 'reel', title: 'Reel', body: 'Some script',
  status, is_ai_generated: true, target_jurisdictions: [], media_url: null,
  video_job_id: null, video_status: null, created_by: 'u-1',
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
});
const from = vi.fn((table: string) => {
  if (table === 'content_items') {
    return {
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: row(), error: null }) }) }),
      update: (patch: { status?: string }) => ({
        eq: () => { if (patch.status) status = patch.status; return Promise.resolve({ error: null }); },
      }),
    };
  }
  if (table === 'approval_records' || table === 'audit_entries' || table === 'disclosure_records') {
    return { insert: () => Promise.resolve({ error: null }) };
  }
  throw new Error(`unexpected table: ${table}`);
});
vi.mock('@/lib/supabase', () => ({
  adminDb: { from },
  throwOnError: async (q: Promise<{ data: unknown; error: { message: string } | null }>) => {
    const r = await q;
    if (r?.error) throw new Error(r.error.message);
    return r?.data;
  },
}));

describe('approveTextAction on a freshly generated draft', () => {
  beforeEach(() => { vi.clearAllMocks(); status = 'draft'; });

  it('approves a draft reel in one step instead of throwing the draft->approved gate error', async () => {
    const { approveTextAction } = await import('./actions');
    const r = await approveTextAction('x');
    expect(r).toEqual({ ok: true });
    expect(status).toBe('in_review'); // video content routes back to in_review pending video generation
  });
});
