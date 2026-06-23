// src/lib/credibility.ts

const HIGH_CREDIBILITY_DOMAINS = new Set([
  'nytimes.com', 'washingtonpost.com', 'latimes.com', 'politico.com',
  'thehill.com', 'apnews.com', 'reuters.com', 'bbc.com', 'npr.org',
  'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'pbs.org',
  'sfgate.com', 'sacbee.com', 'sfchronicle.com', 'calmatters.org',
]);

// Maintained manually — update as needed
const LOW_CREDIBILITY_DOMAINS = new Set([
  'infowars.com', 'naturalnews.com', 'breitbart.com', 'beforeitsnews.com',
  'worldnewsdailyreport.com', 'thedailybuzzer.com', 'empirenews.net',
  'yournewswire.com', 'abcnews.com.co', 'newslo.com',
]);

const SOCIAL_DOMAINS = new Set([
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'youtube.com', 'linkedin.com',
]);

const PRESS_RELEASE_KEYWORDS = ['prnewswire', 'businesswire', 'globenewswire', 'prlog', 'press release'];

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function scoreCredibility(url: string): 'high' | 'medium' | 'low' {
  const domain = getDomain(url);
  if (!domain) return 'medium';
  if (domain.endsWith('.gov')) return 'high';
  if (HIGH_CREDIBILITY_DOMAINS.has(domain)) return 'high';
  if (LOW_CREDIBILITY_DOMAINS.has(domain)) return 'low';
  return 'medium';
}

export function categorizeSource(
  url: string,
  source: string,
): 'news' | 'social' | 'blog' | 'press_release' {
  const domain = getDomain(url) ?? '';
  const sourceLower = source.toLowerCase();

  if ([...SOCIAL_DOMAINS].some(d => domain.includes(d))) return 'social';
  if (PRESS_RELEASE_KEYWORDS.some(k => sourceLower.includes(k) || domain.includes(k))) return 'press_release';
  if (HIGH_CREDIBILITY_DOMAINS.has(domain)) return 'news';
  return 'blog';
}
