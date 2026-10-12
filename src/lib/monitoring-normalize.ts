// Cleans and enriches monitoring items. Used at ingest (new rows) and when the
// feed is read (existing rows), so stale data written by older workflows still
// displays cleanly without a backfill.

import { scoreCredibility, categorizeSource, isRelevant } from './credibility';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', uacute: 'ú', iacute: 'í', ntilde: 'ñ', ccedil: 'ç',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

export function cleanText(input: string): string {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Display names for outlets whose NewsData `source_id` slug reads badly.
const OUTLET_NAMES: Record<string, string> = {
  'cnn.com': 'CNN', 'foxnews.com': 'Fox News', 'nbcnews.com': 'NBC News', 'cbsnews.com': 'CBS News',
  'abcnews.go.com': 'ABC News', 'abcnews.com': 'ABC News', 'nytimes.com': 'The New York Times',
  'washingtonpost.com': 'The Washington Post', 'wsj.com': 'The Wall Street Journal', 'usatoday.com': 'USA Today',
  'bostonglobe.com': 'The Boston Globe', 'nypost.com': 'New York Post', 'latimes.com': 'Los Angeles Times',
  'politico.com': 'Politico', 'thehill.com': 'The Hill', 'apnews.com': 'AP News', 'reuters.com': 'Reuters',
  'bbc.com': 'BBC', 'bbc.co.uk': 'BBC', 'npr.org': 'NPR', 'pbs.org': 'PBS', 'axios.com': 'Axios',
  'bloomberg.com': 'Bloomberg', 'theguardian.com': 'The Guardian', 'newsweek.com': 'Newsweek', 'time.com': 'TIME',
  'forbes.com': 'Forbes', 'yahoo.com': 'Yahoo News', 'msnbc.com': 'MSNBC', 'cnbc.com': 'CNBC',
  'washingtonexaminer.com': 'Washington Examiner', 'thedailybeast.com': 'The Daily Beast', 'huffpost.com': 'HuffPost',
  'independent.co.uk': 'The Independent', 'theindependent.com': 'The Independent', 'mediaite.com': 'Mediaite',
  'newsbreak.com': 'NewsBreak', 'headtopics.com': 'Head Topics', 'prnewswire.com': 'PR Newswire',
  'businesswire.com': 'Business Wire', 'globenewswire.com': 'GlobeNewswire', 'patch.com': 'Patch',
  'pressherald.com': 'Portland Press Herald', 'sunjournal.com': 'Sun Journal', 'nysun.com': 'The New York Sun',
  'theintercept.com': 'The Intercept', 'americanthinker.com': 'American Thinker', 'themirror.com': 'The Mirror',
  'financialcontent.com': 'FinancialContent', 'journalstar.com': 'Lincoln Journal Star', 'bundle.app': 'Bundle',
  'wvnews.com': 'WV News', 'yoursun.com': 'Your Sun', 'mankatofreepress.com': 'Mankato Free Press',
  'rutlandherald.com': 'Rutland Herald', 'timesargus.com': 'Times Argus', 'griffindailynews.com': 'Griffin Daily News',
  'herald-dispatch.com': 'The Herald-Dispatch', 'mychesco.com': 'MyChesCo', 'naturalnews.com': 'NaturalNews',
  'washingtontimes.com': 'The Washington Times', 'nationalreview.com': 'National Review', 'dailywire.com': 'The Daily Wire',
  'theepochtimes.com': 'The Epoch Times', 'rawstory.com': 'Raw Story', 'motherjones.com': 'Mother Jones',
  'slate.com': 'Slate', 'vox.com': 'Vox', 'thebulwark.com': 'The Bulwark', 'semafor.com': 'Semafor',
  'theatlantic.com': 'The Atlantic', 'newyorker.com': 'The New Yorker', 'businessinsider.com': 'Business Insider',
};
// Labels our own integrations write. Platform labels are never rewritten;
// aggregator labels give way to the real outlet when its domain is known.
const PLATFORM_LABELS = new Set(['YouTube', 'Instagram', 'Facebook', 'Twitter/X']);
const AGGREGATOR_LABELS = new Set(['GDELT', 'Google Alerts', 'NewsData']);
const OWN_LABELS = new Set([...PLATFORM_LABELS, ...AGGREGATOR_LABELS]);

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}
function knownOutlet(domain: string | null): string | undefined {
  if (!domain) return undefined;
  // match the registrable tail too (e.g. sports.yahoo.com → yahoo.com)
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const hit = OUTLET_NAMES[parts.slice(i).join('.')];
    if (hit) return hit;
  }
  return undefined;
}

export function sourceDisplayName(source: string, url: string): string {
  const s = source.trim();
  if (PLATFORM_LABELS.has(s)) return s;
  const outlet = knownOutlet(domainOf(url));
  if (outlet) return outlet;
  if (AGGREGATOR_LABELS.has(s)) return s;
  // NewsData `source_id` slugs: lowercase, no spaces, `_net`-style TLD suffixes.
  if (/^[a-z0-9_]+$/.test(s)) {
    const withTld = s.replace(/_(net|org|com|co|io|tv|fm|us|news)$/, '.$1').replace(/_/g, ' ');
    return withTld.charAt(0).toUpperCase() + withTld.slice(1);
  }
  return s;
}

export type OpponentProfile = { opponentName: string | null; aliases: string[] };

function surnameOf(name: string): string | null {
  const last = name.trim().split(/\s+/).pop() ?? '';
  return last.length >= 4 && last !== name.trim() ? last : null;
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function mentions(text: string, term: string): boolean {
  // whole words only, so "Trump" doesn't match "trumpet"
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term)}($|[^\\p{L}\\p{N}-])`, 'iu').test(text);
}

export function matchOpponent(text: string, p: OpponentProfile): string | null {
  if (!p.opponentName) return null;
  const surname = surnameOf(p.opponentName);
  const terms = [p.opponentName, ...p.aliases, ...(surname ? [surname] : [])].filter(t => t && t.trim());
  return terms.some(t => mentions(text, t.trim())) ? p.opponentName : null;
}

export function relevanceTermsFor(p: OpponentProfile & { keywords: string[] }): string[] {
  const surname = p.opponentName ? surnameOf(p.opponentName) : null;
  const all = [p.opponentName, ...p.aliases, ...p.keywords, surname]
    .filter((t): t is string => !!t && !!t.trim()).map(t => t.trim());
  return Array.from(new Set(all));
}

// Same story syndicated across outlets → same fingerprint. Null for excerpts
// too short to be distinctive ("Crime is down").
// Wire stories are republished with a byline/dateline prefix
// ("By Betsy Klein, CNN (CNN) —", "WASHINGTON (AP) —") — drop it before comparing.
const BYLINE_PREFIX = /^\s*(?:[Bb][Yy]\s+[^—–]{2,90}?\s*[—–]\s*|[A-Z][A-Z .,'-]{1,40}\s*\([A-Za-z .]{1,20}\)\s*[—–]\s*)/;

export function excerptFingerprint(excerpt: string): string | null {
  const norm = cleanText(excerpt).replace(BYLINE_PREFIX, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  if (norm.split(' ').length < 6) return null;
  return norm.slice(0, 160);
}

export type TriageLevel = 'attack' | 'opponent_statement' | 'relevant' | 'noise';
const TRIAGE_LEVEL_SET = new Set<string>(['attack', 'opponent_statement', 'relevant', 'noise']);

export type StoredMonitoringRow = {
  id: string; campaign_id: string; source: string; opponent: string | null; excerpt: string;
  url: string; captured_at: string; credibility?: string | null; category?: string | null;
  triage_level?: string | null; triage_reason?: string | null;
};
export type PresentedMonitoringItem = {
  id: string; campaignId: string; source: string; opponent?: string; excerpt: string; url: string; capturedAt: string;
  credibility: 'high' | 'medium' | 'low'; category: 'news' | 'social' | 'blog' | 'press_release';
  // Rows captured before triage existed count as 'relevant'.
  triageLevel: TriageLevel; triageReason?: string;
};

// Rows written by our integrations (own labels or raw NewsData slugs), as
// opposed to a human-typed source on a manual entry.
function looksAutomated(source: string): boolean {
  return OWN_LABELS.has(source) || /^[a-z0-9_]+$/.test(source);
}

// Normalizes stored rows for display: older workflows wrote raw slugs, HTML
// entities, "blog" for mainstream outlets and no opponent, and never applied
// the relevance filter. Rows arrive newest first; syndicated copies of the same
// story collapse to the newest; automated off-topic items are hidden (manual
// entries never are).
export function presentMonitoringItems(
  rows: StoredMonitoringRow[],
  opp: OpponentProfile & { keywords?: string[] },
): PresentedMonitoringItem[] {
  const terms = relevanceTermsFor({ ...opp, keywords: opp.keywords ?? [] });
  const seen = new Set<string>();
  const out: PresentedMonitoringItem[] = [];
  const sorted = [...rows].sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  for (const r of sorted) {
    const excerpt = cleanText(r.excerpt ?? '');
    const fp = excerptFingerprint(excerpt);
    if (fp) { if (seen.has(fp)) continue; seen.add(fp); }
    const rawSource = cleanText(r.source ?? '');
    if (terms.length && looksAutomated(rawSource) && !isRelevant(`${excerpt} ${rawSource} ${r.opponent ?? ''}`, terms)) continue;
    out.push({
      id: r.id, campaignId: r.campaign_id,
      source: sourceDisplayName(rawSource, r.url),
      opponent: r.opponent ?? matchOpponent(`${excerpt} ${rawSource}`, opp) ?? undefined,
      excerpt, url: r.url, capturedAt: r.captured_at,
      credibility: scoreCredibility(r.url),
      category: categorizeSource(r.url, rawSource),
      triageLevel: r.triage_level && TRIAGE_LEVEL_SET.has(r.triage_level) ? r.triage_level as TriageLevel : 'relevant',
      triageReason: r.triage_reason ?? undefined,
    });
  }
  return out;
}
