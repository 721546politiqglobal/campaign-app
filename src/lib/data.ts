// Async data-fetching helpers for server components.
// All functions use the admin client — server-side only.

import { adminDb } from './supabase';
import { ContentStatus, ContentType } from '@/domain/types';

export interface Campaign {
  id: string; name: string; jurisdictions: string[]; monthlyCostCapCents: number;
}
export interface User { id: string; name: string; role: string; campaignId: string; }
export interface MonitoringResult {
  id: string; campaignId: string; source: string; opponent?: string; excerpt: string; url: string; capturedAt: string;
}

export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  const { data } = await adminDb.from('campaigns').select('*').eq('id', campaignId).single();
  if (!data) return null;
  return { id: data.id, name: data.name, jurisdictions: data.jurisdictions, monthlyCostCapCents: data.monthly_cost_cap_cents };
}

export async function getUser(userId: string): Promise<User | null> {
  const { data } = await adminDb.from('users').select('*').eq('id', userId).single();
  if (!data) return null;
  return { id: data.id, name: data.name, role: data.role, campaignId: data.campaign_id };
}

export async function getUsers(campaignId: string): Promise<User[]> {
  const { data } = await adminDb.from('users').select('*').eq('campaign_id', campaignId);
  return (data ?? []).map(r => ({ id: r.id, name: r.name, role: r.role, campaignId: r.campaign_id }));
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
    .eq('campaign_id', campaignId).order('captured_at', { ascending: false });
  return (data ?? []).map(r => ({
    id: r.id, campaignId: r.campaign_id, source: r.source,
    opponent: r.opponent, excerpt: r.excerpt, url: r.url, capturedAt: r.captured_at,
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
    .eq('campaign_id', campaignId).gte('created_at', start.toISOString());
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

export async function getAllCampaigns(): Promise<CampaignWithStats[]> {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const [c, u, ci, ue] = await Promise.all([
    adminDb.from('campaigns').select('*').order('created_at', { ascending: false }),
    adminDb.from('users').select('id, campaign_id'),
    adminDb.from('content_items').select('id, campaign_id, status'),
    adminDb.from('usage_events').select('campaign_id, cost_cents').gte('created_at', start.toISOString()),
  ]);
  const campaigns = c.data ?? [];
  const users = u.data ?? [];
  const items = ci.data ?? [];
  const spend = ue.data ?? [];
  return campaigns.map(camp => ({
    id: camp.id, name: camp.name, jurisdictions: camp.jurisdictions,
    monthlyCostCapCents: camp.monthly_cost_cap_cents, createdAt: camp.created_at,
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
    adminDb.from('usage_events').select('cost_cents'),
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
