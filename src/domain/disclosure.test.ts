import { describe, it, expect } from 'vitest';
import { DisclosureEngine, combineDisclosureText } from './disclosure';
import type { DisclosureRule, DisclosureRulesRepo } from './disclosure';

const DEFAULT_LABEL = 'This content was generated or substantially altered using AI.';

function rule(over: Partial<DisclosureRule>): DisclosureRule {
  return {
    jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: null, placement: 'overlay',
    blackoutDaysBeforeElection: null, needsLegalReview: false, ...over,
  };
}

function repoWith(map: Record<string, DisclosureRule>): DisclosureRulesRepo {
  return {
    async get(j) { return map[j] ?? null; },
    async all() { return Object.values(map); },
  };
}

describe('DisclosureEngine.requiredFor', () => {
  it('returns nothing for non-AI content regardless of jurisdiction', async () => {
    const engine = new DisclosureEngine(repoWith({ 'US-CA': rule({}) }));
    expect(await engine.requiredFor(['US-CA'], false)).toEqual([]);
  });

  it('still skips a jurisdiction whose rule explicitly says no AI label is required', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: 'CA text' }),
      'US-TX': rule({ jurisdiction: 'US-TX', requiresAiLabel: false }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-TX'], true);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ jurisdiction: 'US-CA', disclosureText: 'CA text', placement: 'overlay', needsLegalReview: false });
  });

  it('falls back to a generic default disclosure for a jurisdiction with no rule row at all, instead of skipping it', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: 'CA text' }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-NOWHERE'], true);
    expect(out).toHaveLength(2);
    expect(out.find(o => o.jurisdiction === 'US-NOWHERE')).toEqual({
      jurisdiction: 'US-NOWHERE',
      disclosureText: DEFAULT_LABEL,
      placement: 'overlay',
      needsLegalReview: true,
    });
  });

  it('falls back to the DEFAULT_LABEL when a required rule has no required text', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-FEDERAL': rule({ jurisdiction: 'US-FEDERAL', requiresAiLabel: true, requiredText: null }),
    }));
    const out = await engine.requiredFor(['US-FEDERAL'], true);
    expect(out[0].disclosureText).toBe(DEFAULT_LABEL);
  });

  it('aggregates a distinct required disclosure per matching jurisdiction and propagates needsLegalReview', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiredText: 'CA', placement: 'overlay', needsLegalReview: true }),
      'US-NY': rule({ jurisdiction: 'US-NY', requiredText: 'NY', placement: 'caption', needsLegalReview: false }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-NY'], true);
    expect(out.map(o => o.jurisdiction)).toEqual(['US-CA', 'US-NY']);
    expect(out.find(o => o.jurisdiction === 'US-CA')!.needsLegalReview).toBe(true);
  });

  it('deduplicates duplicate jurisdictions in the input to avoid duplicate disclosure records', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: 'CA text' }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-CA', 'US-CA'], true);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ jurisdiction: 'US-CA', disclosureText: 'CA text', placement: 'overlay', needsLegalReview: false });
  });

  it('defaults needsLegalReview to true for jurisdictions with no rule row', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: 'CA text', needsLegalReview: false }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-NOWHERE'], true);
    const nowhereRule = out.find(o => o.jurisdiction === 'US-NOWHERE');
    expect(nowhereRule?.needsLegalReview).toBe(true);
  });
});

describe('combineDisclosureText', () => {
  it('joins distinct disclosure texts with a blank line', () => {
    expect(combineDisclosureText([{ disclosureText: 'A' }, { disclosureText: 'B' }])).toBe('A\n\nB');
  });
  it('deduplicates identical texts and drops empty ones', () => {
    expect(combineDisclosureText([{ disclosureText: 'A' }, { disclosureText: 'A' }, { disclosureText: '' }])).toBe('A');
  });
  it('returns an empty string for no records', () => {
    expect(combineDisclosureText([])).toBe('');
  });
});
