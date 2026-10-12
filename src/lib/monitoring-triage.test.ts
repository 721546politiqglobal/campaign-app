import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildTriagePrompt, parseTriage, MockMonitoringTriager, ClaudeMonitoringTriager, TRIAGE_LEVELS } from './monitoring-triage';

const ctx = { candidateName: 'Ernesto Ackerman', office: 'State Senate', district: 'District 24', opponentName: 'Donald J Trump', aliases: ['DJT'], keywords: ['Doral'] };
const item = { source: 'CNN', excerpt: 'Trump attacks Ackerman over Doral zoning vote', url: 'https://cnn.com/x', opponent: 'Donald J Trump' };

describe('buildTriagePrompt', () => {
  it('includes the race context and the story, delimited as untrusted data', () => {
    const p = buildTriagePrompt(item, ctx);
    expect(p).toContain('Ernesto Ackerman');
    expect(p).toContain('District 24');
    expect(p).toContain('Donald J Trump');
    expect(p).toContain('<story>');
    expect(p).toContain('Trump attacks Ackerman over Doral zoning vote');
  });
});

describe('parseTriage', () => {
  it('accepts a valid level and trims the reason', () => {
    expect(parseTriage('{"level":"attack","reason":"  Directly criticizes our candidate. "}'))
      .toEqual({ level: 'attack', reason: 'Directly criticizes our candidate.' });
  });
  it('falls back to relevant on malformed or unknown output', () => {
    expect(parseTriage('not json')).toEqual({ level: 'relevant', reason: null });
    expect(parseTriage('{"level":"urgent","reason":"x"}')).toEqual({ level: 'relevant', reason: null });
  });
  it('caps the reason length', () => {
    const r = parseTriage(JSON.stringify({ level: 'noise', reason: 'x'.repeat(500) }));
    expect(r.reason!.length).toBeLessThanOrEqual(200);
  });
});

describe('MockMonitoringTriager', () => {
  const t = new MockMonitoringTriager();
  it('flags stories naming our candidate as attacks', async () => {
    expect((await t.triage(item, ctx)).level).toBe('attack');
  });
  it('flags the opponent\'s own social posts as opponent statements', async () => {
    expect((await t.triage({ ...item, source: 'Instagram', excerpt: 'Big rally tonight' }, ctx)).level).toBe('opponent_statement');
  });
  it('marks other stories relevant', async () => {
    expect((await t.triage({ ...item, excerpt: 'Trump tariffs rise' }, ctx)).level).toBe('relevant');
  });
  it('only returns known levels', async () => {
    expect(TRIAGE_LEVELS).toContain((await t.triage(item, ctx)).level);
  });
});

describe('ClaudeMonitoringTriager', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns relevant (never throws) when the API call fails', async () => {
    const t = new ClaudeMonitoringTriager('k');
    vi.spyOn((t as any).client.messages, 'create').mockRejectedValue(new Error('boom'));
    expect(await t.triage(item, ctx)).toEqual({ level: 'relevant', reason: null });
  });
  it('parses the model JSON from the first text block', async () => {
    const t = new ClaudeMonitoringTriager('k');
    const create = vi.spyOn((t as any).client.messages, 'create').mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"level":"attack","reason":"Names our candidate."}' }],
    } as any);
    expect(await t.triage(item, ctx)).toEqual({ level: 'attack', reason: 'Names our candidate.' });
    const args = create.mock.calls[0][0] as any;
    expect(args.model).toBe('claude-haiku-5-5');
    expect(args.output_config.format.type).toBe('json_schema');
  });
  it('treats a refusal as relevant', async () => {
    const t = new ClaudeMonitoringTriager('k');
    vi.spyOn((t as any).client.messages, 'create').mockResolvedValue({ stop_reason: 'refusal', content: [] } as any);
    expect(await t.triage(item, ctx)).toEqual({ level: 'relevant', reason: null });
  });
});
