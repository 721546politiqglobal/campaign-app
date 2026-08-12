import { describe, it, expect } from 'vitest';
import { isCampaignActive, filterCampaigns } from './campaign-filters';

function camp(over: { subscriptionStatus?: string | null; tags?: string[] }) {
  return { id: 'c', subscriptionStatus: over.subscriptionStatus ?? null, tags: over.tags ?? [] };
}

describe('isCampaignActive', () => {
  it('treats active and trialing as active', () => {
    expect(isCampaignActive('active')).toBe(true);
    expect(isCampaignActive('trialing')).toBe(true);
  });
  it('treats past_due, canceled, unpaid, incomplete, and null as inactive', () => {
    for (const s of ['past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', null]) {
      expect(isCampaignActive(s)).toBe(false);
    }
  });
});

describe('filterCampaigns', () => {
  const campaigns = [
    camp({ subscriptionStatus: 'active', tags: ['midterm'] }),
    camp({ subscriptionStatus: 'past_due', tags: ['midterm', 'statewide'] }),
    camp({ subscriptionStatus: null, tags: ['statewide'] }),
  ];

  it('"all" with no tag filter returns everything', () => {
    expect(filterCampaigns(campaigns, 'all', [])).toHaveLength(3);
  });

  it('"active" keeps only active/trialing campaigns', () => {
    expect(filterCampaigns(campaigns, 'active', [])).toEqual([campaigns[0]]);
  });

  it('"inactive" keeps everything else', () => {
    expect(filterCampaigns(campaigns, 'inactive', [])).toEqual([campaigns[1], campaigns[2]]);
  });

  it('a tag filter keeps campaigns carrying ANY selected tag (OR semantics)', () => {
    expect(filterCampaigns(campaigns, 'all', ['midterm'])).toEqual([campaigns[0], campaigns[1]]);
  });

  it('status and tag filters combine', () => {
    expect(filterCampaigns(campaigns, 'inactive', ['midterm'])).toEqual([campaigns[1]]);
  });
});
