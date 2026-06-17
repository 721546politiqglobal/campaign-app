import { adminDb } from './supabase';
import {
  ContentItem, ContentStatus, ContentRepo, ApprovalRepo, DisclosureRepo, AuditRepo,
} from '@/domain/types';
import { DisclosureRule, DisclosureRulesRepo } from '@/domain/disclosure';
import { UsageRepo } from '@/domain/usage';

// ── row → domain mappers ─────────────────────────────────────────────────────

function toContentItem(r: Record<string, unknown>): ContentItem {
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    type: r.type as ContentItem['type'],
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

function toDisclosureRule(r: Record<string, unknown>): DisclosureRule {
  return {
    jurisdiction: r.jurisdiction as string,
    requiresAiLabel: r.requires_ai_label as boolean,
    requiredText: r.required_text as string | null,
    placement: r.placement as string,
    blackoutDaysBeforeElection: r.blackout_days_before_election as number | null,
    needsLegalReview: r.needs_legal_review as boolean,
  };
}

// ── repo implementations ─────────────────────────────────────────────────────

export const contentRepo: ContentRepo = {
  async get(id) {
    const { data } = await adminDb.from('content_items').select('*').eq('id', id).single();
    return data ? toContentItem(data) : null;
  },
  async setStatus(id, status: ContentStatus) {
    await adminDb.from('content_items')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
  },
};

export const approvalRepo: ApprovalRepo = {
  async add(rec) {
    await adminDb.from('approval_records').insert({
      content_item_id: rec.contentItemId,
      campaign_id: rec.campaignId,
      approver_user_id: rec.approverUserId,
      decision: rec.decision,
      note: rec.note ?? null,
    });
  },
  async hasApproval(contentItemId) {
    const { data } = await adminDb.from('approval_records')
      .select('id')
      .eq('content_item_id', contentItemId)
      .eq('decision', 'approve')
      .limit(1);
    return (data?.length ?? 0) > 0;
  },
};

export const disclosureRepo: DisclosureRepo = {
  async add(rec) {
    await adminDb.from('disclosure_records').insert({
      content_item_id: rec.contentItemId,
      campaign_id: rec.campaignId,
      jurisdiction: rec.jurisdiction,
      disclosure_text: rec.disclosureText,
      placement: rec.placement,
    });
  },
  async listFor(contentItemId) {
    const { data } = await adminDb.from('disclosure_records')
      .select('*')
      .eq('content_item_id', contentItemId);
    return (data ?? []).map(r => ({
      id: r.id,
      contentItemId: r.content_item_id,
      campaignId: r.campaign_id,
      jurisdiction: r.jurisdiction,
      disclosureText: r.disclosure_text,
      placement: r.placement,
      appliedAt: r.applied_at,
    }));
  },
};

export const auditRepo: AuditRepo = {
  async append(entry) {
    await adminDb.from('audit_entries').insert({
      campaign_id: entry.campaignId,
      actor_user_id: entry.actorUserId ?? null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      details: entry.details ?? null,
    });
  },
};

export const rulesRepo: DisclosureRulesRepo = {
  async get(jurisdiction) {
    const { data } = await adminDb.from('disclosure_rules')
      .select('*').eq('jurisdiction', jurisdiction).single();
    return data ? toDisclosureRule(data) : null;
  },
  async all() {
    const { data } = await adminDb.from('disclosure_rules').select('*');
    return (data ?? []).map(toDisclosureRule);
  },
};

export const usageRepo: UsageRepo = {
  async monthToDateCents(campaignId) {
    const start = new Date();
    start.setDate(1); start.setHours(0, 0, 0, 0);
    const { data } = await adminDb.from('usage_events')
      .select('cost_cents')
      .eq('campaign_id', campaignId)
      .gte('created_at', start.toISOString());
    return (data ?? []).reduce((n, r) => n + (r.cost_cents as number), 0);
  },
  async record(campaignId, kind, _quantity, costCents) {
    await adminDb.from('usage_events').insert({ campaign_id: campaignId, kind, cost_cents: costCents });
  },
};

export type { ContentItem, DisclosureRule };
