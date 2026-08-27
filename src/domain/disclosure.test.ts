import { describe, it, expect } from 'vitest';
import { DisclosureEngine, combineDisclosureText } from './disclosure';

const DEFAULT_LABEL = 'This content was generated or substantially altered using AI.';

describe('DisclosureEngine.requiredFor', () => {
  it('returns null for non-AI content regardless of the campaign default', async () => {
    const engine = new DisclosureEngine();
    expect(await engine.requiredFor(false, 'Some campaign default')).toBeNull();
  });

  it('returns the campaign default disclosure text for AI-generated content', async () => {
    const engine = new DisclosureEngine();
    const out = await engine.requiredFor(true, 'Our custom AI disclosure.');
    expect(out).toEqual({ disclosureText: 'Our custom AI disclosure.', placement: 'overlay' });
  });

  it('falls back to the generic default label when the campaign has no default set', async () => {
    const engine = new DisclosureEngine();
    expect(await engine.requiredFor(true, null)).toEqual({ disclosureText: DEFAULT_LABEL, placement: 'overlay' });
  });

  it('falls back to the generic default label when the campaign default is blank', async () => {
    const engine = new DisclosureEngine();
    expect(await engine.requiredFor(true, '   ')).toEqual({ disclosureText: DEFAULT_LABEL, placement: 'overlay' });
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
