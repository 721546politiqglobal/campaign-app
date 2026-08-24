import { describe, it, expect } from 'vitest';
import { ContentLifecycle, GateError } from './content-lifecycle';
import type { RequiredDisclosure } from './disclosure';
import type {
  ContentItem, ContentStatus, DisclosureRecord,
  ContentRepo, ApprovalRepo, DisclosureRepo, AuditRepo,
} from './types';

function makeItem(over: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 'ci-1', campaignId: 'c-1', type: 'social_post', title: 't', body: 'b',
    status: 'approved', isAiGenerated: false, targetJurisdictions: ['US-CA'],
    mediaUrl: null, createdBy: 'u-1', createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
    ...over,
  };
}

// A stand-in for the real DisclosureEngine: `required` simulates what
// jurisdiction rules actually demand, independent of what's been attached —
// exactly the distinction the schedule() gate needs to get right.
function fakeEngine(required: RequiredDisclosure[] = []) {
  return { async requiredFor() { return required; } };
}

function fakes(item: ContentItem, opts: { approved?: boolean; disclosures?: DisclosureRecord[]; required?: RequiredDisclosure[] } = {}) {
  const state = { status: item.status };
  const audit: string[] = [];
  const content: ContentRepo = {
    async get(id) { return id === item.id ? { ...item, status: state.status } : null; },
    async setStatus(_id, status) { state.status = status; },
  };
  const approvals: ApprovalRepo = {
    async add() {},
    async hasApproval() { return opts.approved ?? false; },
  };
  const disclosures: DisclosureRepo = {
    async add() {},
    async listFor() { return opts.disclosures ?? []; },
  };
  const auditRepo: AuditRepo = { async append(e) { audit.push(e.action); } };
  const lifecycle = new ContentLifecycle(content, approvals, disclosures, auditRepo, fakeEngine(opts.required) as never);
  return { lifecycle, state, audit };
}

const A_REQUIRED_DISCLOSURE: RequiredDisclosure = {
  jurisdiction: 'US-CA', disclosureText: 'AI disclosure', placement: 'overlay', needsLegalReview: false,
};

describe('ContentLifecycle.schedule — the hard gate', () => {
  it('blocks scheduling when there is no human approval on record', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: false });
    const { lifecycle, state } = fakes(item, { approved: false });
    await expect(lifecycle.schedule('ci-1', 'u-1')).rejects.toThrow(/no human approval/);
    expect(state.status).toBe('approved');
  });

  it('blocks scheduling AI content that has no disclosure attached, even when approved', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: true });
    const { lifecycle, state } = fakes(item, { approved: true, disclosures: [], required: [A_REQUIRED_DISCLOSURE] });
    await expect(lifecycle.schedule('ci-1', 'u-1')).rejects.toThrow(/needs a disclosure/);
    expect(state.status).toBe('approved');
  });

  it('schedules AI content once approved AND a disclosure is attached', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: true });
    const disc: DisclosureRecord = {
      id: 'd-1', contentItemId: 'ci-1', campaignId: 'c-1', jurisdiction: 'US-CA',
      disclosureText: 'AI disclosure', placement: 'overlay', appliedAt: '2026-07-15T00:00:00Z',
    };
    const { lifecycle, state, audit } = fakes(item, { approved: true, disclosures: [disc], required: [A_REQUIRED_DISCLOSURE] });
    await lifecycle.schedule('ci-1', 'u-1');
    expect(state.status).toBe('scheduled');
    expect(audit).toContain('schedule');
  });

  // Regression: a jurisdiction can legitimately require zero disclosures
  // (requiresAiLabel: false, or simply unconfigured-as-exempt). In that case
  // confirmDisclosureAction never inserts any row — there's nothing required
  // to attach — so gating on "any row exists" made AI content in such a
  // jurisdiction permanently unschedulable, even after the disclosure step
  // correctly reported "no disclosure required" and was confirmed. Verified
  // live: this happened for real with the shipped US-FEDERAL/US-CA config.
  it('schedules AI content with zero disclosure rows when the jurisdiction genuinely requires none', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: true });
    const { lifecycle, state } = fakes(item, { approved: true, disclosures: [], required: [] });
    await lifecycle.schedule('ci-1', 'u-1');
    expect(state.status).toBe('scheduled');
  });

  // Regression: confirmDisclosureAction (actions.ts) routes AI-generated
  // content through schedule() as soon as the disclosure gate clears — before
  // any platforms or a real time have been picked. The wizard's "Schedule for
  // later" submit then calls schedule() again once those are set. Rejecting
  // the second call as an illegal transition made every AI-generated item
  // permanently unschedulable with a real date. Verified live.
  it('allows scheduling an already-scheduled item again (the disclosure-then-pick-a-time flow)', async () => {
    const item = makeItem({ status: 'scheduled', isAiGenerated: true });
    const { lifecycle, state } = fakes(item, { approved: true, disclosures: [], required: [] });
    await lifecycle.schedule('ci-1', 'u-1');
    expect(state.status).toBe('scheduled');
  });

  it('schedules non-AI approved content without requiring a disclosure', async () => {
    const item = makeItem({ status: 'approved', isAiGenerated: false });
    const { lifecycle, state } = fakes(item, { approved: true, disclosures: [] });
    await lifecycle.schedule('ci-1', 'u-1');
    expect(state.status).toBe('scheduled');
  });

  it('rejects an illegal draft → scheduled jump before any gate check', async () => {
    const item = makeItem({ status: 'draft', isAiGenerated: false });
    const { lifecycle, state } = fakes(item, { approved: true });
    await expect(lifecycle.schedule('ci-1', 'u-1')).rejects.toThrow(/from draft to scheduled/);
    expect(state.status).toBe('draft');
  });
});

describe('ContentLifecycle transition guards', () => {
  it('approve records an approval and moves in_review → approved', async () => {
    const item = makeItem({ status: 'in_review' });
    let added = 0;
    const content: ContentRepo = { async get() { return item; }, async setStatus(_i, s) { item.status = s as ContentStatus; } };
    const approvals: ApprovalRepo = { async add() { added++; }, async hasApproval() { return true; } };
    const disclosures: DisclosureRepo = { async add() {}, async listFor() { return []; } };
    const audit: AuditRepo = { async append() {} };
    const lifecycle = new ContentLifecycle(content, approvals, disclosures, audit, fakeEngine() as never);
    await lifecycle.approve('ci-1', 'u-approver', 'lgtm');
    expect(added).toBe(1);
    expect(item.status).toBe('approved');
  });

  it('refuses to approve content that is not in_review', async () => {
    const item = makeItem({ status: 'published' });
    const content: ContentRepo = { async get() { return item; }, async setStatus() {} };
    const lifecycle = new ContentLifecycle(
      content,
      { async add() {}, async hasApproval() { return false; } },
      { async add() {}, async listFor() { return []; } },
      { async append() {} },
      fakeEngine() as never,
    );
    await expect(lifecycle.approve('ci-1', 'u-1')).rejects.toThrow(GateError);
  });

  // The "Publish now" button (ContentWizard → publishAction) calls markPublished
  // directly while the item is still 'approved' — it never goes through
  // 'scheduled' first. That path was missing from TRANSITIONS, so every
  // immediate publish actually posted live to real social platforms via
  // Ayrshare and then unconditionally threw here, leaving the item stuck
  // showing 'approved' forever.
  it('marks published directly from approved (the "Publish now" path)', async () => {
    const item = makeItem({ status: 'approved' });
    const { lifecycle, state, audit } = fakes(item);
    await lifecycle.markPublished('ci-1', 'u-1');
    expect(state.status).toBe('published');
    expect(audit).toContain('publish');
  });
});
