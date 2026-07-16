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
  if (!domain) return 'low';                        // a missing/broken URL is not trustworthy (was 'medium')
  if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 'high';
  if (HIGH_CREDIBILITY_DOMAINS.has(domain)) return 'high';
  if (LOW_CREDIBILITY_DOMAINS.has(domain)) return 'low';
  if ([...SOCIAL_DOMAINS].some(d => domain.includes(d))) return 'low'; // unattributed social posts
  if (PRESS_RELEASE_KEYWORDS.some(k => domain.includes(k))) return 'medium';
  return 'medium';                                  // unknown editorial site — neutral, distinct from social/broken
}

// Keep an item only if it mentions at least one campaign entity/geo term.
// No terms configured → keep everything (don't silently blackhole a feed) (UX-5).
export function isRelevant(text: string, terms: string[]): boolean {
  const cleaned = terms.map(t => t.trim().toLowerCase()).filter(Boolean);
  if (cleaned.length === 0) return true;
  const hay = text.toLowerCase();
  return cleaned.some(t => hay.includes(t));
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
