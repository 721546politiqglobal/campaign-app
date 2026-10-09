import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateManualEntry, excerptForBrief } from './validation';

const session = { userId: 'u-1', name: 'Owner', role: 'owner', campaignId: 'c-1', locale: 'en', exp: 9_999_999_999 };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => session) }));
const insert = vi.fn(async () => ({ data: null, error: null }));
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: (table: string) => { if (table !== 'monitoring_results') throw new Error(`unexpected table ${table}`); return { insert }; } },
  throwOnError: async (q: Promise<{ error: { message: string } | null }>) => { const r = await q; if (r.error) throw new Error(r.error.message); },
}));
vi.mock('@/lib/store', () => ({ uid: vi.fn(() => 'mr-1') }));
vi.mock('@/lib/credibility', () => ({ scoreCredibility: vi.fn(() => 'medium'), categorizeSource: vi.fn(() => 'news') }));

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => { vi.clearAllMocks(); insert.mockResolvedValue({ data: null, error: null }); });

describe('validateManualEntry', () => {
  it('requires headline and source', () => {
    expect(validateManualEntry({ headline: '', source: '', url: '' })).toEqual({ headline: 'headlineRequired', source: 'sourceRequired' });
  });
  it('accepts http and https urls only', () => {
    expect(validateManualEntry({ headline: 'h', source: 's', url: 'https://e.com/a' })).toEqual({});
    expect(validateManualEntry({ headline: 'h', source: 's', url: 'http://e.com/a' })).toEqual({});
    expect(validateManualEntry({ headline: 'h', source: 's', url: 'javascript:alert(1)' })).toEqual({ url: 'urlInvalid' });
    expect(validateManualEntry({ headline: 'h', source: 's', url: 'e.com/a' })).toEqual({ url: 'urlInvalid' });
  });
  it('treats an empty url as optional', () => {
    expect(validateManualEntry({ headline: 'h', source: 's', url: '' })).toEqual({});
  });
  it('enforces length limits', () => {
    expect(validateManualEntry({ headline: 'h'.repeat(1001), source: 's'.repeat(201), url: '' }))
      .toEqual({ headline: 'headlineTooLong', source: 'sourceTooLong' });
  });
});

describe('excerptForBrief', () => {
  it('leaves short excerpts alone and collapses whitespace', () => {
    expect(excerptForBrief('  Smith   said\nthis ')).toBe('Smith said this');
  });
  it('cuts at a word boundary under the limit', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const out = excerptForBrief(words, 200);
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, -1)).toMatch(/word\d+$/);
  });
});

describe('addManualEntryAction', () => {
  it('returns translated field errors and preserves the submitted values', async () => {
    const { addManualEntryAction } = await import('./actions');
    const r = await addManualEntryAction({ ok: false }, form({ headline: '', source: 'TV', url: 'nope' }));
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.headline).toMatch(/headline/i);
    expect(r.fieldErrors?.url).toMatch(/http/);
    expect(r.fieldErrors?.source).toBeUndefined();
    expect(r.values).toEqual({ headline: '', source: 'TV', url: 'nope' });
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a row scoped to the caller's campaign and reports success", async () => {
    const { addManualEntryAction } = await import('./actions');
    const r = await addManualEntryAction({ ok: false }, form({ headline: 'Smith claimed X', source: 'Local TV', url: 'https://tv.example/x' }));
    expect(r.ok).toBe(true);
    expect(r.savedAt).toEqual(expect.any(Number));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mr-1', campaign_id: 'c-1', source: 'Local TV', excerpt: 'Smith claimed X', url: 'https://tv.example/x',
    }));
  });

  it('returns a translated error (never the raw DB message) when the insert fails', async () => {
    insert.mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value violates unique constraint' } } as never);
    const { addManualEntryAction } = await import('./actions');
    const r = await addManualEntryAction({ ok: false }, form({ headline: 'h', source: 's', url: '' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).not.toMatch(/duplicate key/);
    expect(r.values?.headline).toBe('h');
  });
});
