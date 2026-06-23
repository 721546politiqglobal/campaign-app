// src/lib/credibility.test.ts
import { describe, it, expect } from 'vitest';
import { scoreCredibility, categorizeSource } from './credibility';

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

  it('returns medium for malformed URLs', () => {
    expect(scoreCredibility('not-a-url')).toBe('medium');
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
