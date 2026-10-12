// Async data-fetching helpers for server components.
// All functions use the admin client — server-side only.

import { adminDb } from './supabase';
import { presentMonitoringItems, type PresentedMonitoringItem, type StoredMonitoringRow } from './monitoring-normalize';
import { ContentStatus, ContentType, Platform } from '@/domain/types';
import type { Locale } from '@/lib/locale';
import { ACTIVE_SUBSCRIPTION_STATUSES, type CampaignStatusFilter } from '@/lib/campaign-filters';

export interface Campaign {
  id: string; name: string; jurisdictions: string[]; tags: string[];
  defaultDisclosureText: string | null;
  planId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
}
export interface User { id: string; name: string; role: string; campaignId: string | null; email: string | null; }
export type MonitoringResult = PresentedMonitoringItem;

export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  const { data } = await adminDb.from('campaigns').select('*').eq('id', campaignId).single();
  if (!data) return null;
  return {
    id: data.id, name: data.name, jurisdictions: data.jurisdictions, tags: data.tags ?? [],
    defaultDisclosureText: data.default_disclosure_text ?? null,
    planId: data.plan_id ?? null,
    stripeCustomerId: data.stripe_customer_id ?? null,
    stripeSubscriptionId: data.stripe_subscription_id ?? null,
    subscriptionStatus: data.subscription_status ?? null,
    gracePeriodEndsAt: data.grace_period_ends_at ?? null,
    currentPeriodEnd: data.current_period_end ?? null,
  };
}

export async function getUsers(campaignId: string): Promise<User[]> {
  const { data } = await adminDb.from('users').select('*').eq('campaign_id', campaignId);
  return (data ?? []).map(r => ({ id: r.id, name: r.name, role: r.role, campaignId: r.campaign_id, email: r.email ?? null }));
}

export async function getContentItems(campaignId: string, filter?: ContentStatus) {
  let q = adminDb.from('content_items').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: false });
  if (filter) q = q.eq('status', filter);
  const { data } = await q;
  return (data ?? []).map(toItem);
}

export async function getContentItem(id: string) {
  const { data } = await adminDb.from('content_items').select('*').eq('id', id).single();
  return data ? toItem(data) : null;
}

export async function getDisclosuresForItem(contentItemId: string) {
  const { data } = await adminDb.from('disclosure_records').select('*').eq('content_item_id', contentItemId);
  return (data ?? []).map(r => ({
    id: r.id, contentItemId: r.content_item_id, campaignId: r.campaign_id,
    jurisdiction: r.jurisdiction, disclosureText: r.disclosure_text,
    placement: r.placement, appliedAt: r.applied_at,
  }));
}

export async function getAuditEntries(entityId: string) {
  const { data } = await adminDb.from('audit_entries').select('*')
    .eq('entity_id', entityId).order('created_at', { ascending: false });
  return (data ?? []).map(r => ({
    id: r.id, campaignId: r.campaign_id, actorUserId: r.actor_user_id,
    action: r.action, entityType: r.entity_type, entityId: r.entity_id,
    details: r.details, createdAt: r.created_at,
  }));
}

export interface AuditEntry {
  id: string; campaignId: string; actorUserId: string | null;
  action: string; entityType: string; entityId: string | null;
  details: Record<string, unknown> | null; createdAt: string;
}

// Latest activity for a whole campaign (admin campaign detail). Unlike
// getAuditEntries, which is keyed on a single entity (a content item), this
// matches on campaign_id so user joins, channel changes, cron runs and
// impersonations all show up.
export async function getCampaignAuditEntries(campaignId: string, limit = 10): Promise<AuditEntry[]> {
  const { data } = await adminDb.from('audit_entries').select('*')
    .eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(limit);
  return (data ?? []).map(r => ({
    id: r.id, campaignId: r.campaign_id, actorUserId: r.actor_user_id ?? null,
    action: r.action, entityType: r.entity_type, entityId: r.entity_id ?? null,
    details: r.details ?? null, createdAt: r.created_at,
  }));
}

// The feed shows the most recent items only; campaigns accumulate thousands.
export const MONITORING_FEED_LIMIT = 200;
// Fetch extra so syndicated copies and off-topic items hidden by
// presentMonitoringItems don't leave the feed short.
const MONITORING_FETCH_LIMIT = 600;

export async function getMonitoringResults(campaignId: string): Promise<MonitoringResult[]> {
  const [{ data }, { data: profile }] = await Promise.all([
    adminDb.from('monitoring_results').select('*')
      .eq('campaign_id', campaignId)
      .is('dismissed_at', null)
      .order('captured_at', { ascending: false })
      .limit(MONITORING_FETCH_LIMIT),
    adminDb.from('candidate_profiles').select('opponent_name, opponent_aliases, monitoring_keywords')
      .eq('campaign_id', campaignId).maybeSingle(),
  ]);
  const opp = {
    opponentName: (profile?.opponent_name as string | null) ?? null,
    aliases: ((profile?.opponent_aliases as string[] | null) ?? []).filter(Boolean),
    keywords: ((profile?.monitoring_keywords as string[] | null) ?? []).filter(Boolean),
  };
  return presentMonitoringItems((data ?? []) as StoredMonitoringRow[], opp).slice(0, MONITORING_FEED_LIMIT);
}

// One story from the caller's own campaign (for "Draft rebuttal"); null when
// the id is unknown or belongs to another campaign.
export async function getMonitoringItemForCampaign(campaignId: string, id: string): Promise<MonitoringResult | null> {
  const [{ data }, { data: profile }] = await Promise.all([
    adminDb.from('monitoring_results').select('*').eq('campaign_id', campaignId).eq('id', id).maybeSingle(),
    adminDb.from('candidate_profiles').select('opponent_name, opponent_aliases').eq('campaign_id', campaignId).maybeSingle(),
  ]);
  if (!data) return null;
  const opp = {
    opponentName: (profile?.opponent_name as string | null) ?? null,
    aliases: ((profile?.opponent_aliases as string[] | null) ?? []).filter(Boolean),
  };
  // No relevance/dedupe filtering for a single explicitly chosen story.
  return presentMonitoringItems([data as StoredMonitoringRow], { ...opp, keywords: [] })[0]
    ?? presentMonitoringItems([data as StoredMonitoringRow], { opponentName: null, aliases: [], keywords: [] })[0]
    ?? null;
}

// Exact number of active (not dismissed) items, for count tiles.
export async function getMonitoringCount(campaignId: string): Promise<number> {
  const { count } = await adminDb.from('monitoring_results')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .is('dismissed_at', null);
  return count ?? 0;
}

export async function getContentUsageThisPeriod(campaignId: string, currentPeriodEnd: string | null): Promise<number> {
  const { contentPeriodStart } = await import('@/domain/quota');
  const periodStart = contentPeriodStart(currentPeriodEnd).toISOString();
  const { data } = await adminDb.from('feature_usage_counters')
    .select('count').eq('campaign_id', campaignId).eq('feature', 'content').eq('period_start', periodStart).maybeSingle();
  return (data?.count as number | undefined) ?? 0;
}

export async function getVideoUsageToday(campaignId: string): Promise<number> {
  const { videoPeriodStart } = await import('@/domain/quota');
  const periodStart = videoPeriodStart().toISOString();
  const { data } = await adminDb.from('feature_usage_counters')
    .select('count').eq('campaign_id', campaignId).eq('feature', 'video').eq('period_start', periodStart).maybeSingle();
  return (data?.count as number | undefined) ?? 0;
}

export async function getAvatarCount(campaignId: string): Promise<number> {
  const { count } = await adminDb.from('avatars').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
  return count ?? 0;
}

// ── Admin-only data functions ─────────────────────────────────────────────────
//
// Lists are unbounded (users, content, audit, campaigns), so every list helper
// here is server-side paginated: search via ilike, sort via order(), and
// count: 'exact' with .range() — nothing loads the whole table into memory.

export const ADMIN_PAGE_SIZE = 25;

export interface AdminPage<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export type SortDir = 'asc' | 'desc';

export interface AdminListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  dir?: SortDir;
}

// Escape a user-typed search string for use inside an ilike pattern. `%` and
// `_` are LIKE wildcards; commas/parens would break the `.or()` filter syntax.
export function likePattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, c => `\\${c}`).replace(/[,()]/g, ' ').trim();
  return `%${escaped}%`;
}

function pageWindow(page: number | undefined, pageSize: number | undefined) {
  const size = Math.min(100, Math.max(1, pageSize ?? ADMIN_PAGE_SIZE));
  const p = Math.max(1, Math.floor(page ?? 1));
  return { page: p, pageSize: size, from: (p - 1) * size, to: p * size - 1 };
}

function toPage<T>(rows: T[], count: number | null, page: number, pageSize: number): AdminPage<T> {
  const total = count ?? rows.length;
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface CampaignWithStats extends Campaign {
  createdAt: string;
  userCount: number;
  contentCount: number;
  inReviewCount: number;
}

export interface UserWithCampaign extends User {
  campaignName: string | null;
  email: string | null;
  createdAt: string | null;
}

export interface ContentItemWithCampaign {
  id: string; campaignId: string; campaignName: string;
  type: string; title: string; status: string;
  isAiGenerated: boolean; createdAt: string;
}

export interface AuditEntryWithNames extends AuditEntry {
  campaignName: string;
  actorName: string;
}

export interface BillingPlan {
  id: string; name: string; monthlyPriceCents: number; billingInterval: 'week' | 'month'; seatLimit: number | null;
  avatarLimit: number | null; contentLimitMonthly: number | null; videoLimitDaily: number | null;
  stripeProductId: string; stripeFlatPriceId: string;
  // Stripe price ids this plan has rotated away from (price/interval edits archive
  // the old price). Kept so the Stripe webhook can still resolve a checkout or
  // subscription created against an old price id — see planIdFromPriceId.
  retiredStripePriceIds: string[];
  isActive: boolean;
}

function toBillingPlan(r: Record<string, unknown>): BillingPlan {
  return {
    id: r.id as string, name: r.name as string,
    monthlyPriceCents: r.monthly_price_cents as number,
    billingInterval: (r.billing_interval as 'week' | 'month') ?? 'month',
    seatLimit: (r.seat_limit as number | null) ?? null,
    avatarLimit: (r.avatar_limit as number | null) ?? null,
    contentLimitMonthly: (r.content_limit_monthly as number | null) ?? null,
    videoLimitDaily: (r.video_limit_daily as number | null) ?? null,
    stripeProductId: r.stripe_product_id as string,
    stripeFlatPriceId: r.stripe_flat_price_id as string,
    retiredStripePriceIds: (r.retired_stripe_price_ids as string[] | null) ?? [],
    isActive: r.is_active as boolean,
  };
}

export async function getBillingPlans(): Promise<BillingPlan[]> {
  const { data } = await adminDb.from('billing_plans').select('*').order('monthly_price_cents');
  return (data ?? []).map(toBillingPlan);
}

export async function getBillingPlan(id: string): Promise<BillingPlan | null> {
  const { data } = await adminDb.from('billing_plans').select('*').eq('id', id).single();
  return data ? toBillingPlan(data) : null;
}

function toCampaignWithStats(
  camp: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  counts: { users: number; content: number; inReview: number },
): CampaignWithStats {
  return {
    id: camp.id, name: camp.name, jurisdictions: camp.jurisdictions ?? [], tags: camp.tags ?? [],
    defaultDisclosureText: camp.default_disclosure_text ?? null,
    createdAt: camp.created_at,
    planId: camp.plan_id ?? null,
    stripeCustomerId: camp.stripe_customer_id ?? null,
    stripeSubscriptionId: camp.stripe_subscription_id ?? null,
    subscriptionStatus: camp.subscription_status ?? null,
    gracePeriodEndsAt: camp.grace_period_ends_at ?? null,
    currentPeriodEnd: camp.current_period_end ?? null,
    userCount: counts.users, contentCount: counts.content, inReviewCount: counts.inReview,
  };
}

// Per-campaign member / content counts for one page of campaigns: two queries
// scoped to the page's ids, never a full-table scan.
async function countsForCampaigns(ids: string[]) {
  const counts = new Map(ids.map(id => [id, { users: 0, content: 0, inReview: 0 }]));
  if (ids.length === 0) return counts;
  const [u, ci] = await Promise.all([
    adminDb.from('users').select('campaign_id').in('campaign_id', ids).neq('role', 'super_admin'),
    adminDb.from('content_items').select('campaign_id, status').in('campaign_id', ids),
  ]);
  for (const row of u.data ?? []) {
    const c = counts.get(row.campaign_id); if (c) c.users += 1;
  }
  for (const row of ci.data ?? []) {
    const c = counts.get(row.campaign_id);
    if (!c) continue;
    c.content += 1;
    if (row.status === 'in_review') c.inReview += 1;
  }
  return counts;
}

export type CampaignSort = 'created' | 'name';

export interface AdminCampaignsQuery extends AdminListQuery {
  status?: CampaignStatusFilter;
  tag?: string;
  sort?: CampaignSort;
}

export async function getAdminCampaignsPage(query: AdminCampaignsQuery = {}): Promise<AdminPage<CampaignWithStats>> {
  const { page, pageSize, from, to } = pageWindow(query.page, query.pageSize);
  let q = adminDb.from('campaigns').select('*', { count: 'exact' });
  if (query.q) q = q.ilike('name', likePattern(query.q));
  if (query.status === 'active') q = q.in('subscription_status', [...ACTIVE_SUBSCRIPTION_STATUSES]);
  if (query.status === 'inactive') {
    q = q.or(`subscription_status.is.null,subscription_status.not.in.(${ACTIVE_SUBSCRIPTION_STATUSES.join(',')})`);
  }
  if (query.tag) q = q.contains('tags', [query.tag]);
  const sortCol = query.sort === 'name' ? 'name' : 'created_at';
  const ascending = query.dir ? query.dir === 'asc' : sortCol === 'name';
  const { data, count } = await q.order(sortCol, { ascending }).range(from, to);
  const rows = data ?? [];
  const counts = await countsForCampaigns(rows.map(c => c.id));
  return toPage(rows.map(c => toCampaignWithStats(c, counts.get(c.id)!)), count, page, pageSize);
}

// Distinct tags across all campaigns (for the tag filter chips). Tags are a
// small text[] per row, so this is cheap even with many campaigns.
export async function getCampaignTags(): Promise<string[]> {
  const { data } = await adminDb.from('campaigns').select('tags');
  return [...new Set((data ?? []).flatMap(c => (c.tags as string[] | null) ?? []))].sort();
}

export async function getCampaignWithStats(id: string): Promise<CampaignWithStats | null> {
  const { data } = await adminDb.from('campaigns').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  const counts = await countsForCampaigns([id]);
  return toCampaignWithStats(data, counts.get(id)!);
}

export type UserSort = 'name' | 'email' | 'role' | 'created';

export interface AdminUsersQuery extends AdminListQuery {
  sort?: UserSort;
}

export async function getAdminUsersPage(query: AdminUsersQuery = {}): Promise<AdminPage<UserWithCampaign>> {
  const { page, pageSize, from, to } = pageWindow(query.page, query.pageSize);
  let q = adminDb.from('users').select('*', { count: 'exact' }).neq('role', 'super_admin');
  if (query.q) {
    const pattern = likePattern(query.q);
    q = q.or(`name.ilike.${pattern},email.ilike.${pattern}`);
  }
  const sortCol = query.sort === 'email' ? 'email' : query.sort === 'role' ? 'role' : query.sort === 'created' ? 'created_at' : 'name';
  const ascending = query.dir ? query.dir === 'asc' : sortCol !== 'created_at';
  const { data, count } = await q.order(sortCol, { ascending }).range(from, to);
  const rows = data ?? [];
  const campaignIds = [...new Set(rows.map(r => r.campaign_id).filter(Boolean))] as string[];
  const campMap = await campaignNames(campaignIds);
  return toPage(rows.map(r => ({
    id: r.id, name: r.name, role: r.role,
    campaignId: r.campaign_id, campaignName: r.campaign_id ? campMap[r.campaign_id] ?? null : null,
    email: (r.email as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  })), count, page, pageSize);
}

async function campaignNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await adminDb.from('campaigns').select('id, name').in('id', ids);
  return Object.fromEntries((data ?? []).map(c => [c.id, c.name]));
}

export type ContentSort = 'created' | 'title' | 'status';

export interface AdminContentQuery extends AdminListQuery {
  status?: string;
  campaignId?: string;
  sort?: ContentSort;
}

export async function getAdminContentPage(query: AdminContentQuery = {}): Promise<AdminPage<ContentItemWithCampaign>> {
  const { page, pageSize, from, to } = pageWindow(query.page, query.pageSize);
  let q = adminDb.from('content_items').select('*', { count: 'exact' });
  if (query.status) q = q.eq('status', query.status);
  if (query.campaignId) q = q.eq('campaign_id', query.campaignId);
  if (query.q) q = q.ilike('title', likePattern(query.q));
  const sortCol = query.sort === 'title' ? 'title' : query.sort === 'status' ? 'status' : 'created_at';
  const ascending = query.dir ? query.dir === 'asc' : sortCol !== 'created_at';
  const { data, count } = await q.order(sortCol, { ascending }).range(from, to);
  const rows = data ?? [];
  const campMap = await campaignNames([...new Set(rows.map(r => r.campaign_id as string))]);
  return toPage(rows.map(r => ({
    id: r.id, campaignId: r.campaign_id, campaignName: campMap[r.campaign_id] ?? r.campaign_id,
    type: r.type, title: r.title, status: r.status,
    isAiGenerated: r.is_ai_generated, createdAt: r.created_at,
  })), count, page, pageSize);
}

export interface AdminAuditQuery extends AdminListQuery {
  campaignId?: string;
}

export async function getAdminAuditPage(query: AdminAuditQuery = {}): Promise<AdminPage<AuditEntryWithNames>> {
  const { page, pageSize, from, to } = pageWindow(query.page, query.pageSize);
  let q = adminDb.from('audit_entries').select('*', { count: 'exact' });
  if (query.campaignId) q = q.eq('campaign_id', query.campaignId);
  if (query.q) {
    const pattern = likePattern(query.q);
    q = q.or(`action.ilike.${pattern},entity_type.ilike.${pattern},entity_id.ilike.${pattern}`);
  }
  const { data, count } = await q.order('created_at', { ascending: query.dir === 'asc' }).range(from, to);
  const rows = data ?? [];
  const campaignIds = [...new Set(rows.map(r => r.campaign_id as string))];
  const actorIds = [...new Set(rows.map(r => r.actor_user_id as string | null).filter(Boolean))] as string[];
  const [campMap, users] = await Promise.all([
    campaignNames(campaignIds),
    actorIds.length ? adminDb.from('users').select('id, name').in('id', actorIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const userMap = Object.fromEntries((users.data ?? []).map(u => [u.id, u.name]));
  return toPage(rows.map(r => ({
    id: r.id, campaignId: r.campaign_id, campaignName: campMap[r.campaign_id] ?? r.campaign_id,
    actorUserId: r.actor_user_id ?? null, actorName: userMap[r.actor_user_id] ?? r.actor_user_id ?? 'system',
    action: r.action, entityType: r.entity_type, entityId: r.entity_id ?? null,
    details: r.details ?? null, createdAt: r.created_at,
  })), count, page, pageSize);
}

export async function getSystemStats() {
  const [c, u, ci, ir] = await Promise.all([
    adminDb.from('campaigns').select('id', { count: 'exact', head: true }),
    adminDb.from('users').select('id', { count: 'exact', head: true }).neq('role', 'super_admin'),
    adminDb.from('content_items').select('id', { count: 'exact', head: true }),
    adminDb.from('content_items').select('id', { count: 'exact', head: true }).eq('status', 'in_review'),
  ]);
  return {
    campaignCount: c.count ?? 0,
    userCount: u.count ?? 0,
    contentCount: ci.count ?? 0,
    inReviewCount: ir.count ?? 0,
  };
}

export interface InviteCode {
  code: string;
  campaignId: string;
  role: string;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export async function getInviteCodes(campaignId: string): Promise<InviteCode[]> {
  const { data } = await adminDb
    .from('invite_codes')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  return (data ?? []).map(r => ({
    code: r.code,
    campaignId: r.campaign_id,
    role: r.role,
    createdBy: r.created_by,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    createdAt: r.created_at,
  }));
}

export interface ScheduledItem {
  id: string; title: string; type: string;
  scheduledAt: string; platforms: string[]; status: string;
}

export async function getScheduledToday(campaignId: string): Promise<ScheduledItem[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const { data } = await adminDb
    .from('content_items')
    .select('id, title, type, scheduled_at, platforms, status')
    .eq('campaign_id', campaignId)
    .in('status', ['scheduled', 'published'])
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', start.toISOString())
    .lte('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true });

  return (data ?? []).map(r => ({
    id: r.id, title: r.title, type: r.type,
    scheduledAt: r.scheduled_at, platforms: r.platforms ?? [], status: r.status,
  }));
}

// ── internal mapper ──────────────────────────────────────────────────────────

function toItem(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    type: r.type as ContentType,
    title: r.title as string,
    body: r.body as string,
    status: r.status as ContentStatus,
    isAiGenerated: r.is_ai_generated as boolean,
    targetJurisdictions: r.target_jurisdictions as string[],
    mediaUrl: r.media_url as string | null,
    videoJobId: (r.video_job_id as string | null) ?? null,
    videoStatus: (r.video_status as 'processing' | 'completed' | 'failed' | null) ?? null,
    scheduledAt: (r.scheduled_at as string | null) ?? null,
    timezone: (r.timezone as string | null) ?? null,
    platforms: (r.platforms as Platform[] | null) ?? [],
    locale: (r.locale as Locale) ?? 'en',
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

// Seat usage for a campaign vs the seat_limit of its plan (null = unlimited).
// Enforced on add-user/invite so a plan's paid seat count is meaningful (audit
// finding BILL-10).
//
// `used` = current non-super_admin members + pending invites (unredeemed and
// unexpired), so a batch of open invite links can't blow past the limit once
// they are all redeemed. Members the admin pre-provisioned (a users row with
// no password yet) redeem one of those pending invites to activate, so each
// such member offsets one pending invite — otherwise "Add & invite" would
// count the same seat twice until the person signs up.
export interface SeatUsage {
  used: number;
  limit: number | null;
  members: number;
  pendingInvites: number;
}

export async function getCampaignSeatUsage(campaignId: string): Promise<SeatUsage> {
  const { data: camp } = await adminDb.from('campaigns').select('plan_id').eq('id', campaignId).single();
  let limit: number | null = null;
  if (camp?.plan_id) {
    const { data: plan } = await adminDb.from('billing_plans').select('seat_limit').eq('id', camp.plan_id).single();
    limit = (plan?.seat_limit as number | null) ?? null;
  }
  const nowIso = new Date().toISOString();
  const [members, unactivated, invites] = await Promise.all([
    adminDb.from('users').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).neq('role', 'super_admin'),
    adminDb.from('users').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).neq('role', 'super_admin').is('password_hash', null),
    adminDb.from('invite_codes').select('code', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).is('used_at', null).gt('expires_at', nowIso),
  ]);
  const memberCount = members.count ?? 0;
  const pendingInvites = Math.max(0, (invites.count ?? 0) - (unactivated.count ?? 0));
  return { used: memberCount + pendingInvites, limit, members: memberCount, pendingInvites };
}
