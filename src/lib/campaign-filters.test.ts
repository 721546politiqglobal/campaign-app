import { describe, it, expect } from 'vitest';
import { isCampaignActive } from './campaign-filters';

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
