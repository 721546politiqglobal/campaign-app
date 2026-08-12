// Async data-fetching helpers for server components.
// All functions use the admin client — server-side only.

import { adminDb } from './supabase';
import { ContentStatus, ContentType } from '@/domain/types';

export interface Campaign {
  id: string; name: string; jurisdictions: string[]; tags: string[];
  planId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
}
export interface User { id: string; name: string; role: string; campaignId: string | null; email: string | null; }
export interface MonitoringResult {
  id: string; campaignId: string; source: string; opponent?: string;
  excerpt: string; url: string; capturedAt: string;
  credibility: 'high' | 'medium' | 'low';
  category: 'news' | 'social' | 'blog' | 'press_release';
}

export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  const { data } = await adminDb.from('campaigns').select('*').eq('id', campaignId).single();
  if (!data) return null;
  return {
    id: data.id, name: data.name, jurisdictions: data.jurisdictions, tags: data.tags ?? [],
    planId: data.plan_id ?? null,
    stripeCustomerId: data.stripe_customer_id ?? null,
    stripeSubscriptionId: data.stripe_subscription_id ?? null,
    subscriptionStatus: data.subscription_status ?? null,
    gracePeriodEndsAt: data.grace_period_ends_at ?? null,
    currentPeriodEnd: data.current_period_end ?? null,
  };
}

export async function getUser(userId: string): Promise<User | null> {
  const { data } = await adminDb.from('users').select('*').eq('id', userId).single();
  if (!data) return null;
  return { id: data.id, name: data.name, role: data.role, campaignId: data.campaign_id, email: data.email ?? null };
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

export async function getApprovals(campaignId: string) {
  const { data } = await adminDb.from('approval_records').select('*').eq('campaign_id', campaignId);
  return (data ?? []).map(r => ({
    id: r.id, contentItemId: r.content_item_id, campaignId: r.campaign_id,
    approverUserId: r.approver_user_id, decision: r.decision as 'approve' | 'reject',
    note: r.note, createdAt: r.created_at,
  }));
}

export async function getDisclosures(campaignId: string) {
  const { data } = await adminDb.from('disclosure_records').select('*').eq('campaign_id', campaignId);
  return (data ?? []).map(r => ({
    id: r.id, contentItemId: r.content_item_id, campaignId: r.campaign_id,
    jurisdiction: r.jurisdiction, disclosureText: r.disclosure_text,
    placement: r.placement, appliedAt: r.applied_at,
  }));
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

export async function getMonitoringResults(campaignId: string): Promise<MonitoringResult[]> {
  const { data } = await adminDb.from('monitoring_results').select('*')
    .eq('campaign_id', campaignId)
    .is('dismissed_at', null)
    .order('captured_at', { ascending: false });
  return (data ?? []).map(r => ({
    id: r.id, campaignId: r.campaign_id, source: r.source,
    opponent: r.opponent, excerpt: r.excerpt, url: r.url, capturedAt: r.captured_at,
    credibility: (r.credibility as 'high' | 'medium' | 'low') ?? 'medium',
    category: (r.category as 'news' | 'social' | 'blog' | 'press_release') ?? 'news',
  }));
}

export async function getDisclosureRules() {
  const { data } = await adminDb.from('disclosure_rules').select('*');
  return (data ?? []).map(r => ({
    jurisdiction: r.jurisdiction, requiresAiLabel: r.requires_ai_label,
    requiredText: r.required_text, placement: r.placement,
    blackoutDaysBeforeElection: r.blackout_days_before_election,
    needsLegalReview: r.needs_legal_review,
  }));
}

export async function getMonthlySpend(campaignId: string): Promise<number> {
  // Window on the Stripe billing period (falling back to UTC month) so this
  // matches the cap guard (reserve_usage) and both spend displays (BILL-11/UX-1).
  const { billingPeriodStart } = await import('./billing-period');
  const { data: camp } = await adminDb.from('campaigns').select('current_period_end').eq('id', campaignId).single();
  const start = billingPeriodStart((camp?.current_period_end as string | null) ?? null);
  const { data } = await adminDb.from('usage_events').select('cost_cents')
    .eq('campaign_id', campaignId).neq('kind', '_reserved').gte('created_at', start.toISOString());
  return (data ?? []).reduce((n, r) => n + (r.cost_cents as number), 0);
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

export interface CampaignWithStats extends Campaign {
  createdAt: string;
  userCount: number;
  contentCount: number;
  inReviewCount: number;
  monthlySpendCents: number;
}

export interface UserWithCampaign extends User {
  campaignName: string | null;
  email: string | null;
}

export interface ContentItemWithCampaign {
  id: string; campaignId: string; campaignName: string;
  type: string; title: string; status: string;
  isAiGenerated: boolean; createdAt: string;
}

export interface DisclosureRule {
  jurisdiction: string; requiresAiLabel: boolean; requiredText: string | null;
  placement: string; blackoutDaysBeforeElection: number | null; needsLegalReview: boolean;
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

export async function getAllCampaigns(): Promise<CampaignWithStats[]> {
  const { billingPeriodStart } = await import('./billing-period');

  const [c, u, ci] = await Promise.all([
    adminDb.from('campaigns').select('*').order('created_at', { ascending: false }),
    adminDb.from('users').select('id, campaign_id'),
    adminDb.from('content_items').select('id, campaign_id, status'),
  ]);
  const campaigns = c.data ?? [];
  const users = u.data ?? [];
  const items = ci.data ?? [];

  // Each campaign's spend window is anchored on its own Stripe billing period
  // (matching the cap guard and the campaign's own dashboard/billing page —
  // see billing-period.ts), not a shared calendar month. Fetch the union of
  // all windows in one query, then re-filter per campaign below.
  const windowStarts = new Map(
    campaigns.map(camp => [camp.id, billingPeriodStart((camp.current_period_end as string | null) ?? null)]),
  );
  const earliestStart = windowStarts.size > 0
    ? new Date(Math.min(...Array.from(windowStarts.values(), d => d.getTime())))
    : new Date(0);

  const { data: usageData } = await adminDb.from('usage_events')
    .select('campaign_id, cost_cents, created_at')
    .neq('kind', '_reserved')
    .gte('created_at', earliestStart.toISOString());
  const spend = usageData ?? [];

  return campaigns.map(camp => {
    const campaignStart = windowStarts.get(camp.id)!;
    return {
      id: camp.id, name: camp.name, jurisdictions: camp.jurisdictions, tags: camp.tags ?? [],
      createdAt: camp.created_at,
      planId: camp.plan_id ?? null,
      stripeCustomerId: camp.stripe_customer_id ?? null,
      stripeSubscriptionId: camp.stripe_subscription_id ?? null,
      subscriptionStatus: camp.subscription_status ?? null,
      gracePeriodEndsAt: camp.grace_period_ends_at ?? null,
      currentPeriodEnd: camp.current_period_end ?? null,
      userCount: users.filter(u => u.campaign_id === camp.id).length,
      contentCount: items.filter(i => i.campaign_id === camp.id).length,
      inReviewCount: items.filter(i => i.campaign_id === camp.id && i.status === 'in_review').length,
      monthlySpendCents: spend
        .filter(e => e.campaign_id === camp.id && new Date(e.created_at as string) >= campaignStart)
        .reduce((n, e) => n + (e.cost_cents as number), 0),
    };
  });
}

export async function getCampaignWithStats(id: string): Promise<CampaignWithStats | null> {
  const all = await getAllCampaigns();
  return all.find(c => c.id === id) ?? null;
}

export async function getAllUsersAdmin(): Promise<UserWithCampaign[]> {
  const [u, c] = await Promise.all([
    adminDb.from('users').select('*').order('name'),
    adminDb.from('campaigns').select('id, name'),
  ]);
  const campMap = Object.fromEntries((c.data ?? []).map(c => [c.id, c.name]));
  return (u.data ?? []).map(r => ({
    id: r.id, name: r.name, role: r.role,
    campaignId: r.campaign_id, campaignName: campMap[r.campaign_id] ?? null,
    email: (r.email as string | null) ?? null,
  }));
}

export async function getAllContentAdmin(filter?: string): Promise<ContentItemWithCampaign[]> {
  const [ci, c] = await Promise.all([
    (() => {
      let q = adminDb.from('content_items').select('*').order('created_at', { ascending: false });
      if (filter) q = q.eq('status', filter);
      return q;
    })(),
    adminDb.from('campaigns').select('id, name'),
  ]);
  const campMap = Object.fromEntries((c.data ?? []).map(c => [c.id, c.name]));
  return (ci.data ?? []).map(r => ({
    id: r.id, campaignId: r.campaign_id, campaignName: campMap[r.campaign_id] ?? r.campaign_id,
    type: r.type, title: r.title, status: r.status,
    isAiGenerated: r.is_ai_generated, createdAt: r.created_at,
  }));
}

export async function getAllAuditEntries(limit = 100) {
  const [ae, c, u] = await Promise.all([
    adminDb.from('audit_entries').select('*').order('created_at', { ascending: false }).limit(limit),
    adminDb.from('campaigns').select('id, name'),
    adminDb.from('users').select('id, name'),
  ]);
  const campMap = Object.fromEntries((c.data ?? []).map(c => [c.id, c.name]));
  const userMap = Object.fromEntries((u.data ?? []).map(u => [u.id, u.name]));
  return (ae.data ?? []).map(r => ({
    id: r.id, campaignId: r.campaign_id, campaignName: campMap[r.campaign_id] ?? r.campaign_id,
    actorUserId: r.actor_user_id, actorName: userMap[r.actor_user_id] ?? r.actor_user_id ?? 'system',
    action: r.action, entityType: r.entity_type, entityId: r.entity_id,
    details: r.details, createdAt: r.created_at,
  }));
}

export async function getAllDisclosureRules(): Promise<DisclosureRule[]> {
  const { data } = await adminDb.from('disclosure_rules').select('*').order('jurisdiction');
  return (data ?? []).map(r => ({
    jurisdiction: r.jurisdiction, requiresAiLabel: r.requires_ai_label,
    requiredText: r.required_text, placement: r.placement,
    blackoutDaysBeforeElection: r.blackout_days_before_election, needsLegalReview: r.needs_legal_review,
  }));
}

export async function getSystemStats() {
  const [c, u, ci, ue] = await Promise.all([
    adminDb.from('campaigns').select('id', { count: 'exact' }),
    adminDb.from('users').select('id', { count: 'exact' }).neq('role', 'super_admin'),
    adminDb.from('content_items').select('id, status', { count: 'exact' }),
    adminDb.from('usage_events').select('cost_cents').neq('kind', '_reserved'),
  ]);
  const items = ci.data ?? [];
  return {
    campaignCount: c.count ?? 0,
    userCount: u.count ?? 0,
    contentCount: items.length,
    inReviewCount: items.filter(i => i.status === 'in_review').length,
    totalSpendCents: (ue.data ?? []).reduce((n, e) => n + e.cost_cents, 0),
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
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

// Seat usage for a campaign: how many non-super_admin members it has vs the
// seat_limit of its plan (null = unlimited). Enforced on add-user/invite so a
// plan's paid seat count is meaningful (audit finding BILL-10).
export async function getCampaignSeatUsage(campaignId: string): Promise<{ used: number; limit: number | null }> {
  const { data: camp } = await adminDb.from('campaigns').select('plan_id').eq('id', campaignId).single();
  let limit: number | null = null;
  if (camp?.plan_id) {
    const { data: plan } = await adminDb.from('billing_plans').select('seat_limit').eq('id', camp.plan_id).single();
    limit = (plan?.seat_limit as number | null) ?? null;
  }
  const { data: users } = await adminDb.from('users').select('id').eq('campaign_id', campaignId).neq('role', 'super_admin');
  return { used: users?.length ?? 0, limit };
}
