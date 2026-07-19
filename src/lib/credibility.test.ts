// src/lib/credibility.test.ts
import { describe, it, expect } from 'vitest';
import { scoreCredibility, categorizeSource, isRelevant } from './credibility';

describe('scoreCredibility', () => {
  it('returns high for major news domains', () => {
    expect(scoreCredibility('https://www.nytimes.com/article')).toBe('high');
    expect(scoreCredibility('https://apnews.com/story')).toBe('high');
    expect(scoreCredibility('https://latimes.com/politics')).toBe('high');
  });

  it('returns high for .gov domains', () => {
    expect(scoreCredibility('https://ca.gov/press')).toBe('high');
  });

  it('returns low for known misinformation domains', () => {
    expect(scoreCredibility('https://infowars.com/article')).toBe('low');
    expect(scoreCredibility('https://naturalnews.com/post')).toBe('low');
  });

  it('returns medium for unknown domains', () => {
    expect(scoreCredibility('https://somelocalblog.com/post')).toBe('medium');
  });

  it('rates a bare/malformed url as low, not medium', () => {
    expect(scoreCredibility('')).toBe('low');
    expect(scoreCredibility('not a url')).toBe('low');
  });

  it('rates .edu as high and a social domain below a generic news blog', () => {
    expect(scoreCredibility('https://berkeley.edu/x')).toBe('high');
    expect(scoreCredibility('https://x.com/someone/status/1')).toBe('low');
    expect(scoreCredibility('https://some-local-paper.com/story')).toBe('medium');
  });
});

describe('isRelevant', () => {
  const terms = ['Rivera', 'District 12', 'transit'];
  it('keeps items mentioning a campaign entity', () => {
    expect(isRelevant('Rivera slams transit plan', terms)).toBe(true);
  });
  it('drops items mentioning none of the terms', () => {
    expect(isRelevant('Unrelated celebrity gossip', terms)).toBe(false);
  });
  it('is case-insensitive and keeps everything when no terms are configured', () => {
    expect(isRelevant('RIVERA', ['rivera'])).toBe(true);
    expect(isRelevant('anything', [])).toBe(true);
  });
});

describe('categorizeSource', () => {
  it('categorizes social media URLs as social', () => {
    expect(categorizeSource('https://x.com/user/status/123', 'x')).toBe('social');
    expect(categorizeSource('https://twitter.com/user', 'Twitter')).toBe('social');
    expect(categorizeSource('https://facebook.com/post', 'Facebook')).toBe('social');
  });

  it('categorizes major news as news', () => {
    expect(categorizeSource('https://politico.com/story', 'Politico')).toBe('news');
  });

  it('categorizes press release sources correctly', () => {
    expect(categorizeSource('https://prnewswire.com/release', 'PR Newswire')).toBe('press_release');
  });

  it('categorizes unknown sources as blog', () => {
    expect(categorizeSource('https://randomblog.com', 'Random Blog')).toBe('blog');
  });
});
