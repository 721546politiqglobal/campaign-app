import { describe, it, expect, vi } from 'vitest';

const single = vi.fn(async () => ({
  data: { id: 'camp-1', name: 'Camp', jurisdictions: ['US-CA'], monthly_cost_cap_cents: 100000, tags: ['midterm', 'statewide'] },
}));
const eq = vi.fn(() => ({ single }));
const select = vi.fn(() => ({ eq }));
vi.mock('./supabase', () => ({ adminDb: { from: vi.fn(() => ({ select })) } }));

describe('getCampaign', () => {
  it('maps tags onto Campaign.tags', async () => {
    const { getCampaign } = await import('./data');
    const campaign = await getCampaign('camp-1');
    expect(campaign?.tags).toEqual(['midterm', 'statewide']);
  });
});
