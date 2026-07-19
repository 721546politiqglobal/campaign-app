import {
  ContentItem, ContentStatus,
  ContentRepo, ApprovalRepo, DisclosureRepo, AuditRepo,
} from './types';

const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft:     ['in_review', 'archived'],
  in_review: ['approved', 'rejected', 'draft'],
  approved:  ['scheduled', 'draft'],
  scheduled: ['publishing', 'published', 'approved'],
  publishing: ['published', 'approved'],
  published: ['archived'],
  rejected:  ['draft', 'archived'],
  archived:  [],
};

export class GateError extends Error {}

export class ContentLifecycle {
  constructor(
    private content: ContentRepo,
    private approvals: ApprovalRepo,
    private disclosures: DisclosureRepo,
    private audit: AuditRepo,
  ) {}

  async submitForReview(itemId: string, actorUserId: string): Promise<void> {
    const item = await this.require(itemId);
    this.assertTransition(item.status, 'in_review');
    await this.content.setStatus(itemId, 'in_review');
    await this.log(item, actorUserId, 'submit_for_review');
  }

  async approve(itemId: string, approverUserId: string, note?: string): Promise<void> {
    const item = await this.require(itemId);
    this.assertTransition(item.status, 'approved');
    await this.approvals.add({ contentItemId: itemId, campaignId: item.campaignId, approverUserId, decision: 'approve', note });
    await this.content.setStatus(itemId, 'approved');
    await this.log(item, approverUserId, 'approve', { note });
  }

  async reject(itemId: string, approverUserId: string, note?: string): Promise<void> {
    const item = await this.require(itemId);
    this.assertTransition(item.status, 'rejected');
    await this.approvals.add({ contentItemId: itemId, campaignId: item.campaignId, approverUserId, decision: 'reject', note });
    await this.content.setStatus(itemId, 'rejected');
    await this.log(item, approverUserId, 'reject', { note });
  }

  // HARD GATE: requires an approval on record, and a disclosure for AI content.
  async schedule(itemId: string, actorUserId: string): Promise<void> {
    const item = await this.require(itemId);
    this.assertTransition(item.status, 'scheduled');
    if (!(await this.approvals.hasApproval(itemId))) {
      throw new GateError('Can\u2019t schedule: no human approval on record.');
    }
    if (item.isAiGenerated && (await this.disclosures.listFor(itemId)).length === 0) {
      throw new GateError('Can\u2019t schedule: AI content needs a disclosure attached first.');
    }
    await this.content.setStatus(itemId, 'scheduled');
    await this.log(item, actorUserId, 'schedule');
  }

  async markPublished(itemId: string, actorUserId: string): Promise<void> {
    const item = await this.require(itemId);
    this.assertTransition(item.status, 'published');
    await this.content.setStatus(itemId, 'published');
    await this.log(item, actorUserId, 'publish');
  }

  private assertTransition(from: ContentStatus, to: ContentStatus): void {
    if (!TRANSITIONS[from].includes(to)) {
      throw new GateError(`Can\u2019t move content from ${from} to ${to}.`);
    }
  }

  private async require(itemId: string): Promise<ContentItem> {
    const item = await this.content.get(itemId);
    if (!item) throw new GateError(`Content item ${itemId} not found.`);
    return item;
  }

  private async log(item: ContentItem, actorUserId: string, action: string, details?: Record<string, unknown>) {
    await this.audit.append({ campaignId: item.campaignId, actorUserId, action, entityType: 'content_item', entityId: item.id, details });
  }
}
