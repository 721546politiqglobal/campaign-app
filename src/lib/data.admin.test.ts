import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable, thenable query-builder stand-in. Every filter/order method
// records its call and returns the chain; awaiting the chain yields `result`.
function chain(result: unknown) {
  const calls: { method: string; args: unknown[] }[] = [];
  const c: any = { calls };
  for (const m of ['select', 'eq', 'neq', 'is', 'in', 'or', 'gt', 'ilike', 'contains', 'order', 'range', 'limit']) {
    c[m] = vi.fn((...args: unknown[]) => { calls.push({ method: m, args }); return c; });
  }
  c.single = vi.fn(async () => result);
  c.maybeSingle = vi.fn(async () => result);
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

const tables: Record<string, () => any> = {};
vi.mock('./supabase', () => ({
  adminDb: { from: vi.fn((table: string) => { if (!tables[table]) throw new Error('unexpected table ' + table); return tables[table](); }) },
  throwOnError: async (q: any) => (await q).data,
}));

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; });

describe('likePattern', () => {
  it('escapes LIKE wildcards and strips characters that would break the .or() filter syntax', async () => {
    const { likePattern } = await import('./data');
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
    expect(likePattern('a,b(c)')).toBe('%a b c%');
    expect(likePattern('  smith ')).toBe('%smith%');
  });
});

describe('getCampaignSeatUsage', () => {
  function setup(opts: { planId?: string | null; seatLimit?: number | null; members: number; unactivated: number; invites: number }) {
    tables.campaigns = () => chain({ data: { plan_id: 'planId' in opts ? opts.planId : 'plan-1' } });
    tables.billing_plans = () => chain({ data: { seat_limit: opts.seatLimit ?? 5 } });
    let userCalls = 0;
    tables.users = () => {
      // first head-count call = members, second = unactivated (has .is('password_hash', null))
      const c = chain({ count: userCalls++ === 0 ? opts.members : opts.unactivated, error: null });
      return c;
    };
    tables.invite_codes = () => chain({ count: opts.invites, error: null });
  }

  it('counts members plus pending invites toward the limit', async () => {
    setup({ members: 2, unactivated: 0, invites: 2 });
    const { getCampaignSeatUsage } = await import('./data');
    const r = await getCampaignSeatUsage('c-1');
    expect(r).toEqual({ used: 4, limit: 5, members: 2, pendingInvites: 2 });
  });

  it('offsets pending invites by pre-provisioned members who have not activated yet (no double count)', async () => {
    // Admin used "Add & invite" twice: 2 users rows without a password + 2 pending invites.
    setup({ members: 2, unactivated: 2, invites: 2 });
    const { getCampaignSeatUsage } = await import('./data');
    const r = await getCampaignSeatUsage('c-1');
    expect(r.used).toBe(2);
    expect(r.pendingInvites).toBe(0);
  });

  it('only counts unredeemed, unexpired invites', async () => {
    setup({ members: 1, unactivated: 0, invites: 1 });
    const { getCampaignSeatUsage } = await import('./data');
    await getCampaignSeatUsage('c-1');
    const inviteChain = tables.invite_codes();
    // The real chain was built inside the call; assert the filter shape via a fresh chain of the same factory.
    expect(inviteChain.calls).toEqual([]);
    // Re-run against a recording chain to inspect filters.
    const recorded = chain({ count: 1, error: null });
    tables.invite_codes = () => recorded;
    await getCampaignSeatUsage('c-1');
    const methods = recorded.calls.map((c: { method: string; args: unknown[] }) => [c.method, c.args[0]]);
    expect(methods).toEqual(expect.arrayContaining([['is', 'used_at'], ['gt', 'expires_at'], ['eq', 'campaign_id']]));
  });

  it('reports an unlimited plan as limit null', async () => {
    setup({ planId: null, members: 3, unactivated: 0, invites: 0 });
    const { getCampaignSeatUsage } = await import('./data');
    const r = await getCampaignSeatUsage('c-1');
    expect(r).toEqual({ used: 3, limit: null, members: 3, pendingInvites: 0 });
  });
});

describe('getAdminUsersPage', () => {
  it('searches server-side with ilike, paginates with range, and counts exactly', async () => {
    const users = chain({ data: [{ id: 'u-1', name: 'Ann', role: 'staff', campaign_id: 'c-1', email: 'a@x.com', created_at: '2026-01-01' }], count: 51 });
    tables.users = () => users;
    tables.campaigns = () => chain({ data: [{ id: 'c-1', name: 'Camp' }] });
    const { getAdminUsersPage } = await import('./data');
    const page = await getAdminUsersPage({ q: 'an', page: 2, pageSize: 25, sort: 'email', dir: 'desc' });
    expect(page).toMatchObject({ total: 51, page: 2, pageSize: 25, pageCount: 3 });
    expect(page.rows[0]).toMatchObject({ id: 'u-1', campaignName: 'Camp' });
    expect(users.select).toHaveBeenCalledWith('*', { count: 'exact' });
    expect(users.neq).toHaveBeenCalledWith('role', 'super_admin');
    expect(users.or).toHaveBeenCalledWith('name.ilike.%an%,email.ilike.%an%');
    expect(users.order).toHaveBeenCalledWith('email', { ascending: false });
    expect(users.range).toHaveBeenCalledWith(25, 49);
  });
});

describe('getAdminCampaignsPage', () => {
  it('filters inactive campaigns server-side and scopes the count queries to the page ids', async () => {
    const campaigns = chain({ data: [{ id: 'c-1', name: 'A', jurisdictions: [], tags: ['x'], created_at: '2026-01-01' }], count: 1 });
    const users = chain({ data: [{ campaign_id: 'c-1' }, { campaign_id: 'c-1' }] });
    const items = chain({ data: [{ campaign_id: 'c-1', status: 'in_review' }, { campaign_id: 'c-1', status: 'draft' }] });
    tables.campaigns = () => campaigns;
    tables.users = () => users;
    tables.content_items = () => items;
    const { getAdminCampaignsPage } = await import('./data');
    const page = await getAdminCampaignsPage({ status: 'inactive', tag: 'x', sort: 'name' });
    expect(page.rows[0]).toMatchObject({ id: 'c-1', userCount: 2, contentCount: 2, inReviewCount: 1 });
    expect(campaigns.or).toHaveBeenCalledWith('subscription_status.is.null,subscription_status.not.in.(active,trialing)');
    expect(campaigns.contains).toHaveBeenCalledWith('tags', ['x']);
    expect(campaigns.order).toHaveBeenCalledWith('name', { ascending: true });
    expect(users.in).toHaveBeenCalledWith('campaign_id', ['c-1']);
    expect(items.in).toHaveBeenCalledWith('campaign_id', ['c-1']);
  });
});

describe('getSystemStats', () => {
  it('uses head-only exact counts and never loads rows', async () => {
    const made: any[] = [];
    const mk = (count: number) => { const c = chain({ count, error: null }); made.push(c); return c; };
    tables.campaigns = () => mk(3);
    tables.users = () => mk(10);
    let ci = 0;
    tables.content_items = () => mk(ci++ === 0 ? 40 : 4);
    const { getSystemStats } = await import('./data');
    const stats = await getSystemStats();
    expect(stats).toEqual({ campaignCount: 3, userCount: 10, contentCount: 40, inReviewCount: 4 });
    for (const c of made) expect(c.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });
});
