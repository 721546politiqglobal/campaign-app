import { describe, it, expect } from 'vitest';
import {
  cleanText, sourceDisplayName, matchOpponent, relevanceTermsFor, excerptFingerprint, presentMonitoringItems,
} from './monitoring-normalize';

describe('cleanText', () => {
  it('decodes HTML entities YouTube/RSS feeds leave in titles', () => {
    expect(cleanText('&quot;I think it&#39;s time&quot; — F&amp;M Bank')).toBe('"I think it\'s time" — F&M Bank');
    expect(cleanText('caf&eacute; &lt;3 &#x2014; ok&nbsp;now')).toBe('café <3 — ok now');
  });
  it('strips HTML tags and collapses whitespace', () => {
    expect(cleanText('<p>Hello <b>world</b></p>\n\n  again ')).toBe('Hello world again');
  });
  it('leaves already-clean text unchanged', () => {
    expect(cleanText('Rivera slams transit plan')).toBe('Rivera slams transit plan');
  });
});

describe('sourceDisplayName', () => {
  it('keeps our own integration labels', () => {
    expect(sourceDisplayName('YouTube', 'https://www.youtube.com/watch?v=1')).toBe('YouTube');
    expect(sourceDisplayName('Twitter/X', 'https://x.com/a/status/1')).toBe('Twitter/X');
  });
  it('maps well-known outlets by domain', () => {
    expect(sourceDisplayName('bostonglobe', 'https://www.bostonglobe.com/x')).toBe('The Boston Globe');
    expect(sourceDisplayName('cnn', 'https://www.cnn.com/x')).toBe('CNN');
    expect(sourceDisplayName('nypost', 'https://nypost.com/x')).toBe('New York Post');
  });
  it('humanizes NewsData-style slugs it does not know', () => {
    expect(sourceDisplayName('yourvalley_net', 'https://yourvalley.net/x')).toBe('Yourvalley.net');
    expect(sourceDisplayName('wsws_org', 'https://wsws.org/x')).toBe('Wsws.org');
    expect(sourceDisplayName('lehighvalleylive', 'https://www.lehighvalleylive.com/x')).toBe('Lehighvalleylive');
  });
  it('leaves human-entered names alone', () => {
    expect(sourceDisplayName('Sun Journal', 'https://sunjournal.com/x')).toBe('Sun Journal');
    expect(sourceDisplayName('GDELT', 'https://example.com/x')).toBe('GDELT');
  });
  it('shows the real outlet instead of an aggregator label when the domain is known', () => {
    expect(sourceDisplayName('NewsData', 'https://apnews.com/x')).toBe('AP News');
    expect(sourceDisplayName('Google Alerts', 'https://www.cnn.com/x')).toBe('CNN');
  });
});

describe('matchOpponent', () => {
  const profile = { opponentName: 'Donald J. Trump', aliases: ['The Donald'] };
  it('matches the full name, an alias, or the surname', () => {
    expect(matchOpponent('Donald J. Trump rallies in TN', profile)).toBe('Donald J. Trump');
    expect(matchOpponent('Critics of The Donald react', profile)).toBe('Donald J. Trump');
    expect(matchOpponent('Trump calls for new Ukrainian president', profile)).toBe('Donald J. Trump');
  });
  it('matches whole words only and ignores short surnames', () => {
    expect(matchOpponent('A trumpet solo opened the event', profile)).toBeNull();
    expect(matchOpponent('Ed Li visits', { opponentName: 'Ed Li', aliases: [] })).toBe('Ed Li');
    expect(matchOpponent('Li-ion batteries', { opponentName: 'Ed Li', aliases: [] })).toBeNull();
  });
  it('returns null with no opponent configured', () => {
    expect(matchOpponent('anything', { opponentName: null, aliases: [] })).toBeNull();
  });
});

describe('relevanceTermsFor', () => {
  it('uses the opponent, aliases, surname and keywords', () => {
    expect(relevanceTermsFor({ opponentName: 'Susan Collins', aliases: ['Sen. Collins'], keywords: ['Maine housing'] }))
      .toEqual(['Susan Collins', 'Sen. Collins', 'Maine housing', 'Collins']);
  });
  it('is empty when nothing is configured (keeps everything)', () => {
    expect(relevanceTermsFor({ opponentName: null, aliases: [], keywords: [] })).toEqual([]);
  });
});

describe('excerptFingerprint', () => {
  it('is identical for the same story syndicated with different punctuation/case', () => {
    expect(excerptFingerprint('Sen. Susan Collins is no longer Maine’s senator.'))
      .toBe(excerptFingerprint('sen susan collins is no longer maine\'s senator'));
  });
  it('differs for different stories', () => {
    const a = excerptFingerprint('Senator Collins backs the new housing bill today');
    const b = excerptFingerprint('Senator Collins opposes the new housing bill today');
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
  });
  it('ignores very short excerpts (too generic to dedupe on)', () => {
    expect(excerptFingerprint('Crime is down')).toBeNull();
  });
});

describe('presentMonitoringItems', () => {
  const opp = { opponentName: 'Susan Collins', aliases: [] };
  const row = (o: Partial<Record<string, unknown>>) => ({
    id: 'r', campaign_id: 'c', source: 'cnn', opponent: null, excerpt: 'x',
    url: 'https://www.cnn.com/a', captured_at: '2026-10-10T10:00:00Z', credibility: 'medium', category: 'blog', ...o,
  });
  it('re-derives category/credibility, cleans text and source, and fills the opponent for stored rows', () => {
    const [r] = presentMonitoringItems([row({ excerpt: 'Collins &amp; allies &#39;win&#39;' })], opp);
    expect(r).toMatchObject({ source: 'CNN', category: 'news', credibility: 'high', excerpt: "Collins & allies 'win'", opponent: 'Susan Collins' });
  });
  it('keeps a stored opponent', () => {
    const [r] = presentMonitoringItems([row({ opponent: 'Someone Else', excerpt: 'Collins speaks' })], opp);
    expect(r.opponent).toBe('Someone Else');
  });
  it('collapses syndicated copies, keeping the newest', () => {
    const story = 'Senator Susan Collins announced a new housing plan for Maine families today';
    const out = presentMonitoringItems([
      row({ id: 'new', excerpt: story, url: 'https://a.example/1', captured_at: '2026-10-10T12:00:00Z' }),
      row({ id: 'old', excerpt: story.toUpperCase(), url: 'https://b.example/1', captured_at: '2026-10-10T08:00:00Z' }),
    ], opp);
    expect(out.map(r => r.id)).toEqual(['new']);
  });
});

describe('presentMonitoringItems relevance', () => {
  const opp = { opponentName: 'Donald Trump', aliases: ['realDonaldTrump'], keywords: [] as string[] };
  const row = (o: Partial<Record<string, unknown>>) => ({
    id: 'r', campaign_id: 'c', source: 'washingtonexaminer', opponent: null, excerpt: 'x',
    url: 'https://washingtonexaminer.com/a', captured_at: '2026-10-10T10:00:00Z', ...o,
  });
  it('hides automated off-topic items when the campaign has relevance terms', () => {
    const out = presentMonitoringItems([
      row({ id: 'off', excerpt: 'Strategic ambiguity on Taiwan is no longer safe for anyone' }),
      row({ id: 'on', excerpt: 'Trump calls for a new Ukrainian president' }),
      row({ id: 'yt-off', source: 'YouTube', url: 'https://www.youtube.com/watch?v=1', excerpt: 'Cooking pasta tutorial' }),
    ], opp);
    expect(out.map(r => r.id)).toEqual(['on']);
  });
  it('never hides manually entered items (human-typed source names)', () => {
    const out = presentMonitoringItems([row({ id: 'manual', source: 'Daily Bugle', url: '', excerpt: 'Local fundraiser' })], opp);
    expect(out.map(r => r.id)).toEqual(['manual']);
  });
  it('keeps everything when no terms are configured', () => {
    const out = presentMonitoringItems([row({ excerpt: 'Taiwan story' })], { opponentName: null, aliases: [], keywords: [] });
    expect(out).toHaveLength(1);
  });
});

describe('excerptFingerprint bylines', () => {
  it('ignores a leading byline/dateline so syndicated copies match', () => {
    const cnn = 'The Trump administration has spent $19 million in taxpayer money on the controversial ad campaign';
    expect(excerptFingerprint(`By Betsy Klein, CNN (CNN) — ${cnn}`)).toBe(excerptFingerprint(cnn));
    expect(excerptFingerprint(`By KEVIN FREKING WASHINGTON (AP) — ${cnn}`)).toBe(excerptFingerprint(cnn));
    expect(excerptFingerprint(`WASHINGTON (AP) — ${cnn}`)).toBe(excerptFingerprint(cnn));
  });
});

describe('presentMonitoringItems triage', () => {
  const opp = { opponentName: 'Donald Trump', aliases: [], keywords: [] as string[] };
  it('passes through triage, treating untriaged rows as relevant', () => {
    const base = { campaign_id: 'c', source: 'CNN', opponent: null, url: 'https://cnn.com/a', captured_at: '2026-10-10T10:00:00Z' };
    const out = presentMonitoringItems([
      { ...base, id: 'a', excerpt: 'Trump attacks the senator over housing', triage_level: 'attack', triage_reason: 'Names our candidate.' },
      { ...base, id: 'b', excerpt: 'Trump tariffs rise again this week', url: 'https://cnn.com/b' },
    ], opp);
    expect(out.find(r => r.id === 'a')).toMatchObject({ triageLevel: 'attack', triageReason: 'Names our candidate.' });
    expect(out.find(r => r.id === 'b')).toMatchObject({ triageLevel: 'relevant', triageReason: undefined });
  });
});
