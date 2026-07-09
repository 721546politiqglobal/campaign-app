// Async data-fetching helpers for server components.
// All functions use the admin client — server-side only.

import { adminDb } from './supabase';
import { ContentStatus, ContentType } from '@/domain/types';

export interface Campaign {
  id: string; name: string; jurisdictions: string[]; monthlyCostCapCents: number;
  planId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  gracePeriodEndsAt: string | null;
  currentPeriodEnd: string | null;
}
export interface User { id: string; name: string; role: string; campaignId: string; email: string | null; }
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
    id: data.id, name: data.name, jurisdictions: data.jurisdictions, monthlyCostCapCents: data.monthly_cost_cap_cents,
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
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const { data } = await adminDb.from('usage_events').select('cost_cents')
    .eq('campaign_id', campaignId).neq('kind', '_reserved').gte('created_at', start.toISOString());
  return (data ?? []).reduce((n, r) => n + (r.cost_cents as number), 0);
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
  id: string; name: string; monthlyPriceCents: number; seatLimit: number | null;
  includedUsageCents: number; overageMultiplier: number;
  stripeProductId: string; stripeFlatPriceId: string; stripeMeteredPriceId: string;
  isActive: boolean;
}

function toBillingPlan(r: Record<string, unknown>): BillingPlan {
  return {
    id: r.id as string, name: r.name as string,
    monthlyPriceCents: r.monthly_price_cents as number,
    seatLimit: (r.seat_limit as number | null) ?? null,
    includedUsageCents: r.included_usage_cents as number,
    overageMultiplier: r.overage_multiplier as number,
    stripeProductId: r.stripe_product_id as string,
    stripeFlatPriceId: r.stripe_flat_price_id as string,
    stripeMeteredPriceId: r.stripe_metered_price_id as string,
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
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const [c, u, ci, ue] = await Promise.all([
    adminDb.from('campaigns').select('*').order('created_at', { ascending: false }),
    adminDb.from('users').select('id, campaign_id'),
    adminDb.from('content_items').select('id, campaign_id, status'),
    adminDb.from('usage_events').select('campaign_id, cost_cents').neq('kind', '_reserved').gte('created_at', start.toISOString()),
  ]);
  const campaigns = c.data ?? [];
  const users = u.data ?? [];
  const items = ci.data ?? [];
  const spend = ue.data ?? [];
  return campaigns.map(camp => ({
    id: camp.id, name: camp.name, jurisdictions: camp.jurisdictions,
    monthlyCostCapCents: camp.monthly_cost_cap_cents, createdAt: camp.created_at,
    planId: camp.plan_id ?? null,
    stripeCustomerId: camp.stripe_customer_id ?? null,
    stripeSubscriptionId: camp.stripe_subscription_id ?? null,
    subscriptionStatus: camp.subscription_status ?? null,
    gracePeriodEndsAt: camp.grace_period_ends_at ?? null,
    currentPeriodEnd: camp.current_period_end ?? null,
    userCount: users.filter(u => u.campaign_id === camp.id).length,
    contentCount: items.filter(i => i.campaign_id === camp.id).length,
    inReviewCount: items.filter(i => i.campaign_id === camp.id && i.status === 'in_review').length,
    monthlySpendCents: spend.filter(e => e.campaign_id === camp.id).reduce((n, e) => n + e.cost_cents, 0),
  }));
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
