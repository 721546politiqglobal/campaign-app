// src/lib/credibility.ts

const HIGH_CREDIBILITY_DOMAINS = new Set([
  'nytimes.com', 'washingtonpost.com', 'latimes.com', 'politico.com',
  'thehill.com', 'apnews.com', 'reuters.com', 'bbc.com', 'bbc.co.uk', 'npr.org',
  'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'abcnews.com', 'pbs.org',
  'sfgate.com', 'sacbee.com', 'sfchronicle.com', 'calmatters.org',
  // major national outlets with professional newsrooms
  'cnn.com', 'foxnews.com', 'wsj.com', 'usatoday.com', 'bostonglobe.com',
  'theguardian.com', 'yahoo.com', 'axios.com', 'bloomberg.com', 'cnbc.com',
  'msnbc.com', 'time.com', 'newsweek.com', 'forbes.com', 'economist.com',
  'ft.com', 'theatlantic.com', 'newyorker.com', 'propublica.org', 'chicagotribune.com',
]);

// Maintained manually — update as needed
const LOW_CREDIBILITY_DOMAINS = new Set([
  'infowars.com', 'naturalnews.com', 'breitbart.com', 'beforeitsnews.com',
  'worldnewsdailyreport.com', 'thedailybuzzer.com', 'empirenews.net',
  'yournewswire.com', 'abcnews.com.co', 'newslo.com',
]);

const SOCIAL_DOMAINS = new Set([
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'threads.net', 'reddit.com',
]);

const BLOG_PLATFORM_DOMAINS = new Set([
  'substack.com', 'medium.com', 'blogspot.com', 'wordpress.com', 'tumblr.com', 'ghost.io',
]);

// True when `domain` is `entry` or a subdomain of it (sports.yahoo.com → yahoo.com),
// but not a lookalike (cnn.com.evil.io).
function inSet(domain: string, set: Set<string>): boolean {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) if (set.has(parts.slice(i).join('.'))) return true;
  return false;
}

const PRESS_RELEASE_KEYWORDS = ['prnewswire', 'businesswire', 'globenewswire', 'prlog', 'press release'];

function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return ''; }
}

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
  if (inSet(domain, HIGH_CREDIBILITY_DOMAINS)) return 'high';
  if (inSet(domain, LOW_CREDIBILITY_DOMAINS)) return 'low';
  if (inSet(domain, SOCIAL_DOMAINS)) return 'low'; // unattributed social posts
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

  if (inSet(domain, SOCIAL_DOMAINS)) return 'social';
  if (PRESS_RELEASE_KEYWORDS.some(k => sourceLower.includes(k) || domain.includes(k))) return 'press_release';
  if (inSet(domain, BLOG_PLATFORM_DOMAINS) || /\/blogs?\//i.test(pathOf(url))) return 'blog';
  // Everything else is an editorial outlet (NewsData/GDELT only index news sites).
  return 'news';
}
