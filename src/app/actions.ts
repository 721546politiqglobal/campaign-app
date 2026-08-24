'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession, signInAs, signOut } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';
import { uid, prefixedId } from '@/lib/store';
import { getCampaign, getBillingPlan } from '@/lib/data';
import { lifecycle, disclosureEngine, quotaGate, billingGate, contentGenerator, publisher, videoProvider, voiceProvider, photoAvatarProvider } from '@/lib/services';
import { HeyGenAccessDeniedError, HeyGenVoiceCloneLimitError } from '@/integrations';
import { contentRepo, approvalRepo, disclosureRepo, auditRepo } from '@/lib/repos';
import { ContentType, ContentStatus, ContentItem, Platform, VIDEO_CONTENT_TYPES, isContentType } from '@/domain/types';
import { GateError } from '@/domain/content-lifecycle';
import { combineDisclosureText } from '@/domain/disclosure';
import { zonedNaiveToUtc } from '@/lib/timezone';
import { QuotaExceeded, contentPeriodStart, videoPeriodStart } from '@/domain/quota';
import { BillingBlocked } from '@/domain/billing';
import { can } from '@/lib/permissions';

type Result = { ok: true } | { ok: false; error: string };

function guard<T>(fn: () => Promise<T>): Promise<Result> {
  return fn().then(() => ({ ok: true as const })).catch((e: unknown) => {
    if (e instanceof GateError || e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false as const, error: e.message };
    throw e;
  });
}

// Run a provider call that a quota slot has already been consumed for, and give
// the slot back if the call fails (audit finding BILL-9, re-broken by the move
// to per-feature counters). `periodStart` must be the same value passed to the
// preceding `checkAndIncrement`. A failure to release is logged, never allowed
// to mask the underlying provider error.
async function withQuotaRelease<T>(
  campaignId: string,
  feature: 'content' | 'video',
  periodStart: Date,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    try {
      await quotaGate.release(campaignId, feature, periodStart);
    } catch (releaseError) {
      console.error(
        `Failed to release ${feature} quota for campaign ${campaignId} after a provider failure: ${releaseError}`,
      );
    }
    throw e;
  }
}

// Every content server action must confirm the item belongs to the caller's
// campaign before acting on it — the DB has no RLS, so this is the tenant boundary.
async function requireOwnedItem(id: string, campaignId: string): Promise<ContentItem | null> {
  const item = await contentRepo.get(id);
  if (!item || item.campaignId !== campaignId) return null;
  return item;
}

const NOT_FOUND = { ok: false as const, error: 'Content not found.' };

// super_admin sessions carry no campaign (campaignId === null). Tenant-scoped
// actions must refuse rather than silently query `campaign_id = null`
// (audit finding DATA-18).
function tenantId(s: { campaignId: string | null }): string | null {
  return s.campaignId ?? null;
}

const DUMMY_HASH = '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk';

export async function loginAction(formData: FormData) {
  const bcrypt = await import('bcryptjs');
  const { setSessionCookie } = await import('@/lib/session');
  const { headers } = await import('next/headers');
  const { isLockedOut, getAttempts, recordFailure, clearAttempts } = await import('@/lib/login-throttle');

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) redirect('/login?error=1');

  const now = Date.now();
  const ip = (headers().get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipKey = `ip:${ip}`;
  const emailKey = `email:${email}`;

  // Fail closed on lockout before touching bcrypt (SEC-10).
  const [ipState, emailState] = await Promise.all([getAttempts(ipKey), getAttempts(emailKey)]);
  if (isLockedOut(ipState, now) || isLockedOut(emailState, now)) {
    redirect('/login?error=locked');
  }

  const { data: user } = await adminDb
    .from('users')
    .select('id, name, role, campaign_id, password_hash')
    .eq('email', email)
    .single();

  // Always run bcrypt to prevent timing-based email enumeration
  const hash = user?.password_hash ?? DUMMY_HASH;
  const valid = await bcrypt.default.compare(password, hash);

  if (!valid || !user) {
    await Promise.all([recordFailure(ipKey, now), recordFailure(emailKey, now)]);
    redirect('/login?error=1');
  }

  await Promise.all([clearAttempts(ipKey), clearAttempts(emailKey)]);
  setSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role,
    campaignId: user.campaign_id,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });

  redirect(user.role === 'super_admin' ? '/admin' : '/dashboard');
}

export async function joinAction(formData: FormData) {
  const bcrypt = await import('bcryptjs');
  const { setSessionCookie } = await import('@/lib/session');

  const code     = String(formData.get('code')     ?? '').trim();
  const name     = String(formData.get('name')     ?? '').trim();
  const email    = String(formData.get('email')    ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  const base = `/join?code=${encodeURIComponent(code)}`;

  if (!code || !name || !email || !password) redirect(`${base}&error=fields`);
  if (password.length < 8)                   redirect(`${base}&error=password`);

  const { data: invite } = await adminDb
    .from('invite_codes')
    .select('*')
    .eq('code', code)
    .single();

  if (!invite)                                      redirect(`${base}&error=invalid`);
  if (invite.used_at)                               redirect(`${base}&error=used`);
  if (new Date(invite.expires_at) < new Date())     redirect(`${base}&error=expired`);

  // A user row may already exist here as a placeholder created by addUserAction
  // (name/email/role set, no password_hash yet). Only a row that already has a
  // password_hash represents a real, already-claimed account.
  const { data: existing } = await adminDb
    .from('users')
    .select('id, password_hash')
    .eq('email', email)
    .maybeSingle();
  if (existing?.password_hash) redirect(`${base}&error=email`);

  const password_hash = await bcrypt.default.hash(password, 10);
  const userId = existing?.id ?? prefixedId('u-');

  // Atomically claim the invite: only one concurrent redemption can flip
  // used_at from null. If no row comes back, someone else already claimed it
  // (audit finding DATA-11) — bail before creating any user.
  const { data: claimed } = await adminDb.from('invite_codes')
    .update({ used_by: userId, used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .select()
    .maybeSingle();
  if (!claimed) redirect(`${base}&error=used`);

  if (existing) {
    await throwOnError(
      adminDb.from('users').update({
        name, password_hash, campaign_id: invite.campaign_id, role: invite.role,
      }).eq('id', existing.id),
      'users.join.update',
    );
  } else {
    await throwOnError(
      adminDb.from('users').insert({
        id: userId, campaign_id: invite.campaign_id, name, email, password_hash, role: invite.role,
      }),
      'users.join.insert',
    );
  }

  await throwOnError(
    adminDb.from('audit_entries').insert({
      campaign_id: invite.campaign_id, actor_user_id: userId,
      action: 'user_joined', entity_type: 'user', entity_id: userId,
      details: { via_invite: code },
    }),
    'audit_entries.join',
  );

  setSessionCookie({
    userId,
    name,
    role: invite.role,
    campaignId: invite.campaign_id,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });

  redirect('/dashboard');
}

export async function logoutAction() {
  signOut();
  redirect('/login');
}

export async function createContentAction(formData: FormData) {
  const s = await requireSession();
  const campaign = await getCampaign(s.campaignId);
  if (!campaign) throw new Error('Campaign not found');
  const rawType = String(formData.get('type') ?? '');
  const type: ContentType = isContentType(rawType) ? rawType : 'reel';
  const id = uid();
  await throwOnError(
    adminDb.from('content_items').insert({
      id,
      campaign_id: s.campaignId,
      type,
      title: String(formData.get('title') || 'Untitled'),
      body: String(formData.get('body') || ''),
      status: 'draft',
      is_ai_generated: formData.get('isAiGenerated') === 'on',
      target_jurisdictions: campaign.jurisdictions,
      created_by: s.userId,
    }),
    'content_items.create',
  );
  redirect(`/content/${id}`);
}

export type DraftResult = { ok: true; title: string; text: string } | { ok: false; error: string };

export async function generateDraftAction(instruction: string, type: string): Promise<DraftResult> {
  const s = await requireSession();
  const { getCandidateProfile } = await import('@/lib/candidate');

  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) throw new Error('Campaign not found');

  // Quota/billing refusals are returned, not thrown: Next.js redacts thrown
  // server-action errors in production, so a thrown QuotaExceeded would reach
  // the browser as an opaque digest and the user would never learn why their
  // draft was refused (finding I6).
  try {
    await billingGate.check(s.campaignId);
    const plan = campaign.planId ? await getBillingPlan(campaign.planId) : null;
    const periodStart = contentPeriodStart(campaign.currentPeriodEnd);
    await quotaGate.checkAndIncrement(s.campaignId, 'content', periodStart, plan?.contentLimitMonthly ?? null);
    const out = await withQuotaRelease(s.campaignId, 'content', periodStart, () =>
      contentGenerator.draft({ instruction, type, candidateProfile: profile ?? undefined }));
    return { ok: true, title: out.title, text: out.text };
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
}

export async function submitAction(id: string): Promise<Result> {
  const s = await requireSession();
  if (!(await requireOwnedItem(id, s.campaignId))) return NOT_FOUND;
  const r = await guard(() => lifecycle.submitForReview(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}

export async function decideAction(id: string, decision: 'approve' | 'reject', note: string): Promise<Result> {
  const s = await requireSession();
  if (decision === 'approve' && !can(s.role, 'approve')) return { ok: false, error: 'Permission denied.' };
  if (!(await requireOwnedItem(id, s.campaignId))) return NOT_FOUND;
  const r = await guard(() =>
    decision === 'approve'
      ? lifecycle.approve(id, s.userId, note)
      : lifecycle.reject(id, s.userId, note));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}

export async function attachDisclosureAction(id: string): Promise<Result> {
  const s = await requireSession();
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
  const required = await disclosureEngine.requiredFor(item.targetJurisdictions, item.isAiGenerated);
  for (const req of required) {
    await disclosureRepo.add({
      contentItemId: id, campaignId: s.campaignId,
      jurisdiction: req.jurisdiction, disclosureText: req.disclosureText, placement: req.placement,
    });
  }
  revalidatePath(`/content/${id}`);
  return { ok: true };
}

export async function scheduleAction(id: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'schedule')) return { ok: false, error: 'Permission denied.' };
  if (!(await requireOwnedItem(id, s.campaignId))) return NOT_FOUND;
  const r = await guard(() => lifecycle.schedule(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/');
  return r;
}

export async function publishAction(id: string, platforms: Platform[]): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'publish')) return { ok: false, error: 'Permission denied.' };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
  const disc = await disclosureRepo.listFor(id);
  // Publish first, inspect the per-platform results, and only mark the item
  // published if at least one platform actually accepted the post.
  const results = await publisher.publish({
    platforms, title: item.title, text: item.body,
    disclosureText: combineDisclosureText(disc),
    mediaUrl: item.mediaUrl ?? undefined,
  });
  const failed = results.filter(r => r.status === 'failed');
  if (failed.length === results.length) {
    return { ok: false, error: `Publishing failed: ${failed.map(f => `${f.platform} (${f.error ?? 'unknown'})`).join(', ')}` };
  }
  const r = await guard(() => lifecycle.markPublished(id, s.userId));
  // Capture per-platform post ids the same way the cron publish path does —
  // without this, analytics sync can never find this item's posts (it only
  // looks up ayrshare_post_ids), so metrics silently never populate for
  // anything published via the immediate "Publish now" button.
  const postIds: Record<string, string> = {};
  for (const res of results) {
    if (res.status === 'scheduled' && res.postId) postIds[res.platform] = res.postId;
  }
  if (r.ok && Object.keys(postIds).length > 0) {
    await adminDb.from('content_items').update({ ayrshare_post_ids: postIds }).eq('id', id);
  }
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  if (r.ok && failed.length) return { ok: false, error: `Published, but failed on: ${failed.map(f => f.platform).join(', ')}` };
  return r;
}

export async function openMyBillingPortalAction(): Promise<void> {
  const s = await requireSession();
  if (!can(s.role, 'edit_settings')) return;
  const { stripe } = await import('@/lib/stripe');
  if (!stripe) return;
  const campaign = await getCampaign(s.campaignId);
  if (!campaign?.stripeCustomerId) return;
  const session = await stripe.billingPortal.sessions.create({
    customer: campaign.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/settings`,
  });
  redirect(session.url);
}

// ── Video generation ──────────────────────────────────────────────────────────

export async function generateVideoAction(
  contentId: string,
  script: string,
  overrides?: { avatarId?: string; voiceId?: string; background?: string; aspectRatio?: '16:9' | '9:16' | '1:1' },
): Promise<Result & { videoId?: string }> {
  const s = await requireSession();
  const { getCandidateProfile } = await import('@/lib/candidate');
  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  const avatarId = overrides?.avatarId ?? profile?.heygenAvatarId ?? undefined;
  // Never fall through to the provider's own HEYGEN_AVATAR_ID env default here —
  // that's a single global avatar shared across every tenant, so silently using
  // it would generate video of the wrong (possibly non-consented) candidate.
  if (!avatarId) return { ok: false, error: 'No avatar is set up for this campaign yet. Add one on the Avatars page first.' };
  const heygenVoiceId = overrides?.voiceId
    // A ready self-clone takes precedence over the admin-assigned heygen_voice_id
    // — self-service is the primary path once it exists, admin assignment is
    // the fallback for campaigns that haven't cloned their own voice.
    ?? (profile?.selfVoiceCloneStatus === 'ready' ? profile?.selfVoiceCloneId ?? undefined : undefined)
    ?? profile?.heygenVoiceId
    ?? undefined;
  // Do not fall back to the global HEYGEN_VOICE_ID — that narrates every
  // tenant's video with one shared voice. And never pass the ElevenLabs id
  // here: HeyGen uses a different voice-id namespace and 400s on it (INT-7).
  if (!heygenVoiceId) return { ok: false, error: 'No video voice is set up for this campaign yet. Contact your platform admin to assign one.' };
  try {
    await billingGate.check(s.campaignId);
    const plan = campaign.planId ? await getBillingPlan(campaign.planId) : null;
    // Reuse the same instant for the increment and any release below, so the
    // release can never land on a different period bucket than the increment.
    const periodStart = videoPeriodStart();
    await quotaGate.checkAndIncrement(s.campaignId, 'video', periodStart, plan?.videoLimitDaily ?? null);
    // The quota slot is consumed before the provider call, so a provider failure
    // has to give it back — otherwise one HeyGen 500 costs a Starter campaign
    // its entire day (video_limit_daily = 1) with nothing to show for it.
    // Scoped to the provider call only: once HeyGen has accepted the job the
    // video exists and the slot is legitimately spent, even if the DB writes
    // below fail.
    const { videoId } = await withQuotaRelease(s.campaignId, 'video', periodStart, () =>
      videoProvider.generateAvatarVideo({
        script,
        avatarId,
        voiceId: heygenVoiceId,
        background: overrides?.background ?? profile?.videoBackground ?? 'plain',
        aspectRatio: overrides?.aspectRatio ?? profile?.videoAspectRatio ?? '16:9',
      }));
    await throwOnError(
      adminDb.from('content_items')
        .update({ video_job_id: videoId, video_status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', contentId),
      'content_items.video_job',
    );
    await throwOnError(
      adminDb.from('audit_entries').insert({
        campaign_id: s.campaignId, actor_user_id: s.userId,
        action: 'generate_video', entity_type: 'content_item', entity_id: contentId,
        details: { videoId },
      }),
      'audit_entries.generate_video',
    );
    return { ok: true, videoId };
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
}

export async function getVideoStatusAction(videoId: string): Promise<{ status: string; url?: string }> {
  const s = await requireSession(); // was unauthenticated — anyone could probe HeyGen job status (INT-10)
  const result = await videoProvider.getVideoStatus(videoId);
  // Reconcile the persisted job so a resumed poll lands the final state on the
  // content row (INT-5). Scoped to the caller's campaign.
  if (result.status === 'completed' && result.url) {
    await adminDb.from('content_items')
      .update({ video_status: 'completed', media_url: result.url, updated_at: new Date().toISOString() })
      .eq('video_job_id', videoId).eq('campaign_id', s.campaignId);
  } else if (result.status === 'failed') {
    await adminDb.from('content_items')
      .update({ video_status: 'failed', updated_at: new Date().toISOString() })
      .eq('video_job_id', videoId).eq('campaign_id', s.campaignId);
  }
  return result;
}

// ── Voice synthesis ───────────────────────────────────────────────────────────

export async function synthesizeVoiceAction(text: string): Promise<Result & { audioUrl?: string }> {
  const s = await requireSession();
  const { getCandidateProfile } = await import('@/lib/candidate');
  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  // Use the campaign's configured voice; never fall back to a global/stock
  // voice that could be another tenant's cloned voice (INT-6). Refuse (and
  // don't bill) when none is set.
  const voiceId = profile?.elevenLabsVoiceId ?? undefined;
  if (!voiceId) {
    return { ok: false, error: 'No voice is configured for this campaign yet. Set one in Settings → Avatar.' };
  }
  try {
    await billingGate.check(s.campaignId);
    const plan = campaign.planId ? await getBillingPlan(campaign.planId) : null;
    const periodStart = videoPeriodStart();
    await quotaGate.checkAndIncrement(s.campaignId, 'video', periodStart, plan?.videoLimitDaily ?? null);
    // As in generateVideoAction: a failed ElevenLabs call must not cost the
    // caller the quota slot it consumed.
    const { audioUrl } = await withQuotaRelease(s.campaignId, 'video', periodStart, () =>
      voiceProvider.synthesize({ text, voiceId }));
    return { ok: true, audioUrl };
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
}

// ── Wizard actions ────────────────────────────────────────────────────────────

export async function saveBodyAction(id: string, body: string): Promise<Result> {
  const s = await requireSession();
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
  // Editing after approval would let unapproved text reach publish — only allow pre-approval states.
  if (!['draft', 'in_review', 'rejected'].includes(item.status)) {
    return { ok: false, error: 'This content can no longer be edited. Move it back to draft first.' };
  }
  const { error } = await adminDb.from('content_items')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: 'Save failed.' };
  revalidatePath(`/content/${id}`);
  return { ok: true };
}

export async function approveTextAction(id: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'approve')) return { ok: false, error: 'Permission denied.' };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;

  // The wizard presents "review + approve" as one click, but the lifecycle FSM
  // requires in_review before approved — so a freshly generated draft needs the
  // submit_for_review transition first (also keeps the audit trail complete).
  if (item.status === 'draft') {
    const submitResult = await guard(() => lifecycle.submitForReview(id, s.userId));
    if (!submitResult.ok) return submitResult;
  }

  // Approve via the lifecycle so a valid transition is enforced and an approval
  // record is written. Scheduling never happens here — it goes through the
  // gated confirmDisclosureAction/scheduleAction so the hard gate always runs.
  const r = await guard(() => lifecycle.approve(id, s.userId));
  if (!r.ok) return r;
  // Video types still need the video-generation step, so send them back to
  // in_review; the approval remains on record for the eventual schedule gate.
  if (VIDEO_CONTENT_TYPES.includes(item.type)) {
    const { error } = await adminDb.from('content_items')
      .update({ status: 'in_review', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, error: 'Update failed.' };
  }
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return { ok: true };
}

export async function confirmVideoAction(id: string, videoUrl: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'approve')) return { ok: false, error: 'Permission denied.' };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
  // Persist the rendered video, then approve through the lifecycle. Scheduling
  // is never done here — it always flows through the gated schedule actions.
  const { error } = await adminDb.from('content_items')
    .update({ media_url: videoUrl, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: 'Update failed.' };
  await auditRepo.append({
    campaignId: item.campaignId, actorUserId: s.userId,
    action: 'confirm_video', entityType: 'content_item', entityId: id,
    details: { videoUrl },
  });
  const r = await guard(() => lifecycle.approve(id, s.userId));
  revalidatePath(`/content/${id}`);
  return r;
}

export async function generateFromMonitoringAction(
  monitoringResultId: string,
  contentType: string,
): Promise<Result & { contentId?: string }> {
  const s = await requireSession();
  if (!isContentType(contentType)) return { ok: false, error: 'Unknown content type.' };
  const { getCandidateProfile } = await import('@/lib/candidate');

  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };

  const { data: result } = await adminDb
    .from('monitoring_results')
    .select('*')
    .eq('id', monitoringResultId)
    .eq('campaign_id', s.campaignId)
    .single();
  if (!result) return { ok: false, error: 'Monitoring result not found.' };

  try {
    await billingGate.check(s.campaignId);
    const plan = campaign.planId ? await getBillingPlan(campaign.planId) : null;
    const periodStart = contentPeriodStart(campaign.currentPeriodEnd);
    await quotaGate.checkAndIncrement(s.campaignId, 'content', periodStart, plan?.contentLimitMonthly ?? null);

    const instruction =
      `Respond to this ${result.source} post${result.opponent ? ` from ${result.opponent}` : ''} on behalf of a political campaign.\n\n` +
      `Source: ${result.source}\n` +
      `Excerpt: "${result.excerpt}"\n` +
      (result.url ? `Original post/article: ${result.url}\n` : '') +
      `\nWrite a ${contentType.replace('_', ' ')} that responds specifically to the excerpt above — reference its actual claims or content rather than writing something generic. ` +
      `If the excerpt is too thin to respond to specifically (e.g. it's only engagement stats with no real quoted text or caption), say so plainly instead of inventing details that aren't there. ` +
      `Be factual, on-message, and persuasive.`;

    const out = await withQuotaRelease(s.campaignId, 'content', periodStart, () =>
      contentGenerator.draft({ instruction, type: contentType, candidateProfile: profile ?? undefined }));

    const id = uid();
    await throwOnError(
      adminDb.from('content_items').insert({
        id,
        campaign_id: s.campaignId,
        type: contentType,
        title: out.title,
        body: out.text,
        status: 'draft',
        is_ai_generated: true,
        target_jurisdictions: campaign.jurisdictions,
        created_by: s.userId,
      }),
      'content_items.from_monitoring',
    );

    await auditRepo.append({
      campaignId: s.campaignId,
      actorUserId: s.userId,
      action: 'generate_from_monitoring',
      entityType: 'content_item',
      entityId: id,
      details: { monitoringResultId, contentType },
    });

    return { ok: true, contentId: id };
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
}

export async function confirmDisclosureAction(id: string, disclosureTexts?: string[]): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'schedule')) return { ok: false, error: 'Permission denied.' };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return NOT_FOUND;
  const required = await disclosureEngine.requiredFor(item.targetJurisdictions, item.isAiGenerated);
  for (const [i, req] of required.entries()) {
    // Campaigns edit disclosure wording per state, so the wizard's edited text
    // (not the jurisdiction-rule default) is what actually gets attached.
    const text = (disclosureTexts?.[i] ?? req.disclosureText).trim();
    if (!text) return { ok: false, error: 'Disclosure text cannot be empty.' };
    await disclosureRepo.add({
      contentItemId: id,
      campaignId: s.campaignId,
      jurisdiction: req.jurisdiction,
      disclosureText: text,
      placement: req.placement,
    });
  }
  // Route through the hard gate — enforces approval-on-record + disclosure-for-AI + valid transition.
  const r = await guard(() => lifecycle.schedule(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}

export async function dismissMonitoringAction(id: string): Promise<Result> {
  const s = await requireSession();
  const campaignId = tenantId(s);
  if (!campaignId) return { ok: false, error: 'No campaign in session.' };
  return guard(async () => {
    await adminDb.from('monitoring_results')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('campaign_id', campaignId);
    revalidatePath('/monitoring');
  });
}

export async function saveVideoSettingsAction(data: {
  heygenBaseAvatarId?: string | null;
  heygenAvatarId?: string | null;
  elevenLabsVoiceId?: string | null;
  heygenVoiceId?: string | null;
  videoAspectRatio?: '16:9' | '9:16' | '1:1';
  videoBackground?: string;
}): Promise<Result> {
  return guard(async () => {
    const s = await requireSession();
    if (!can(s.role, 'edit_settings')) throw new GateError('Permission denied.');
    const { upsertCandidateProfile } = await import('@/lib/candidate');
    await upsertCandidateProfile(s.campaignId, data);
    revalidatePath('/settings');
  });
}

export async function uploadBackgroundAction(formData: FormData): Promise<Result & { url?: string }> {
  return guard(async () => {
    const s = await requireSession();
    if (!can(s.role, 'edit_settings')) throw new GateError('Permission denied.');
    const file = formData.get('file') as File | null;
    if (!file || !file.size) throw new GateError('No file provided');
    if (file.size > 10 * 1024 * 1024) throw new GateError('File must be under 10 MB');
    if (!file.type.startsWith('image/')) throw new GateError('Only image files are allowed');

    const bytes = await file.arrayBuffer();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const filename = `backgrounds/${s.campaignId}/${Date.now()}.${ext}`;

    const { error } = await adminDb.storage.from('media').upload(filename, Buffer.from(bytes), {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new GateError(error.message);

    const { data } = adminDb.storage.from('media').getPublicUrl(filename);
    return { url: data.publicUrl };
  }) as Promise<Result & { url?: string }>;
}

export async function scheduleWithTimeAction(
  id: string,
  platforms: Platform[],
  scheduledAt: string,
  timezone: string,
): Promise<Result> {
  return guard(async () => {
    const s = await requireSession();
    if (!can(s.role, 'schedule')) throw new GateError('Permission denied.');
    if (!scheduledAt) throw new GateError('Scheduled time is required');
    // The wizard sends a naive datetime-local string plus the IANA timezone.
    // Interpret it in that zone (not the server's) so the stored UTC instant is
    // correct — otherwise posts fire hours early (audit finding DATA-8).
    const scheduledUtc = zonedNaiveToUtc(scheduledAt, timezone);
    if (scheduledUtc <= new Date()) throw new GateError('Scheduled time must be in the future');

    const item = await contentRepo.get(id);
    if (!item || item.campaignId !== s.campaignId) throw new GateError('Content not found.');

    // Hard gate: enforces human approval, and disclosure-on-file for AI content,
    // before status can move to 'scheduled' — same check scheduleAction uses.
    await lifecycle.schedule(id, s.userId);

    await throwOnError(
      adminDb.from('content_items')
        .update({
          scheduled_at: scheduledUtc.toISOString(),
          timezone,
          platforms,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id),
      'content_items.scheduleWithTime',
    );

    await auditRepo.append({
      campaignId: s.campaignId,
      actorUserId: s.userId,
      action: 'schedule_with_time',
      entityType: 'content_item',
      entityId: id,
      details: { scheduledAt, timezone, platforms },
    });

    revalidatePath(`/content/${id}`);
  });
}

// ── Avatar creation ───────────────────────────────────────────────────────────

// Photo/video avatar creation is split into begin/finalize pairs so the raw
// file bytes never travel through a Server Action body. Sending them there
// (as the single-step createAvatarAction/createVideoAvatarAction used to)
// makes the whole request a serverless function invocation subject to
// Vercel's function payload limit — 10 photos or a training video routinely
// exceed it and the platform rejects the request with 413
// FUNCTION_PAYLOAD_TOO_LARGE before our code even runs. Instead: begin*
// validates and hands back a signed Supabase Storage upload URL per file, the
// browser PUTs directly to Storage (bypassing our functions entirely), and
// finalize* downloads the bytes from Storage server-side (an outbound fetch,
// not a client request, so it isn't subject to the same limit) to hand off to
// HeyGen and write the DB row.
export async function beginAvatarUploadAction(
  consent: boolean,
  files: { name: string; type: string; size: number }[],
): Promise<Result & { avatarId?: string; uploads?: { path: string; token: string }[] }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  if (!consent) return { ok: false, error: 'Consent confirmation is required.' };

  if (files.length < 4 || files.length > 10) return { ok: false, error: 'Upload between 4 and 10 photos.' };
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'Each photo must be under 10 MB.' };
    if (!file.type.startsWith('image/')) return { ok: false, error: 'Only image files are allowed.' };
  }

  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };

  try {
    await billingGate.check(s.campaignId);
    const plan = campaign.planId ? await getBillingPlan(campaign.planId) : null;
    await quotaGate.checkAvatarCap(s.campaignId, plan?.avatarLimit ?? null);
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }

  const avatarId = uid();
  const uploads: { path: string; token: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const ext = files[i].name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `avatars/${s.campaignId}/${avatarId}/${i}.${ext}`;
    const { data, error } = await adminDb.storage.from('media').createSignedUploadUrl(path);
    if (error) return { ok: false, error: error.message };
    uploads.push({ path, token: data.token });
  }

  return { ok: true, avatarId, uploads };
}

export async function finalizeAvatarAction(
  avatarId: string,
  name: string,
  paths: string[],
): Promise<Result & { avatarId?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };

  const prefix = `avatars/${s.campaignId}/${avatarId}/`;
  if (paths.length < 4 || paths.length > 10 || paths.some(p => !p.startsWith(prefix))) {
    return { ok: false, error: 'Invalid upload.' };
  }

  const { insertAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const trimmedName = name.trim() || 'Avatar';

  const buffers: Buffer[] = [];
  const contentTypes: string[] = [];
  const sourcePhotoUrls: string[] = [];
  for (const path of paths) {
    const { data, error } = await adminDb.storage.from('media').download(path);
    if (error || !data) return { ok: false, error: error?.message ?? 'Uploaded photo not found.' };
    buffers.push(Buffer.from(await data.arrayBuffer()));
    contentTypes.push(data.type);
    sourcePhotoUrls.push(adminDb.storage.from('media').getPublicUrl(path).data.publicUrl);
  }

  await insertAvatar({
    id: avatarId,
    campaignId: s.campaignId,
    name: trimmedName,
    sourcePhotoUrls,
    consentConfirmedBy: s.userId,
    createdBy: s.userId,
    status: 'training',
  });

  let createError: string | null = null;
  try {
    let groupId: string | undefined;
    let baseLookId: string | undefined;
    for (let i = 0; i < buffers.length; i++) {
      const { assetId } = await photoAvatarProvider.uploadAsset(buffers[i], contentTypes[i]);
      const { groupId: newGroupId, lookId } = await photoAvatarProvider.createAvatarLook({
        name: trimmedName,
        assetId,
        avatarGroupId: groupId,
      });
      groupId = groupId ?? newGroupId;
      baseLookId = baseLookId ?? lookId;
    }
    await updateAvatarStatus(avatarId, 'training', { heygenGroupId: groupId, heygenLookId: baseLookId });
  } catch (e) {
    createError = e instanceof Error ? e.message : String(e);
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: createError });
  }

  revalidatePath('/avatars');
  // Report the failure instead of returning ok:true for a failed creation (INT-14).
  if (createError) return { ok: false, error: `Avatar creation failed: ${createError}` };
  return { ok: true, avatarId };
}

export async function checkAvatarStatusAction(avatarId: string): Promise<Result> {
  const s = await requireSession();
  const { getAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: 'Avatar not found.' };
  if ((avatar.status !== 'training' && avatar.status !== 'pending_consent') || !avatar.heygenGroupId) return { ok: true };

  const { status, error, consentStatus } = await photoAvatarProvider.getAvatarGroupStatus(avatar.heygenGroupId);
  if (status === 'failed') {
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: error?.message ?? 'Avatar training failed.' });
  } else if (status === 'completed') {
    await updateAvatarStatus(avatarId, 'ready');
  } else if (status === 'pending_consent') {
    // Still waiting on the candidate to complete HeyGen's hosted consent
    // recording — just refresh consentStatus in case it changed.
    await updateAvatarStatus(avatarId, 'pending_consent', { consentStatus });
  } else if (avatar.status === 'pending_consent' && status === 'processing') {
    // Consent was approved since the last poll — HeyGen has started training.
    await updateAvatarStatus(avatarId, 'training', { consentStatus });
  }
  revalidatePath('/avatars');
  return { ok: true };
}

const MAX_TRAINING_VIDEO_BYTES = 500 * 1024 * 1024;

export async function beginVideoAvatarUploadAction(
  consent: boolean,
  file: { name: string; type: string; size: number },
): Promise<Result & { avatarId?: string; path?: string; token?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  if (!consent) return { ok: false, error: 'Consent confirmation is required.' };

  if (!file || file.size === 0) return { ok: false, error: 'Upload a training video.' };
  if (file.size > MAX_TRAINING_VIDEO_BYTES) return { ok: false, error: 'Video must be under 500 MB.' };
  if (file.type !== 'video/mp4' && file.type !== 'video/quicktime') return { ok: false, error: 'Only MP4 or QuickTime video files are allowed.' };

  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };

  try {
    await billingGate.check(s.campaignId);
    const plan = campaign.planId ? await getBillingPlan(campaign.planId) : null;
    await quotaGate.checkAvatarCap(s.campaignId, plan?.avatarLimit ?? null);
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }

  const avatarId = uid();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'mp4';
  const path = `avatars/${s.campaignId}/${avatarId}/training.${ext}`;
  const { data, error } = await adminDb.storage.from('media').createSignedUploadUrl(path);
  if (error) return { ok: false, error: error.message };

  return { ok: true, avatarId, path, token: data.token };
}

export async function finalizeVideoAvatarAction(
  avatarId: string,
  name: string,
  path: string,
): Promise<Result & { avatarId?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };

  const prefix = `avatars/${s.campaignId}/${avatarId}/`;
  if (!path.startsWith(prefix)) return { ok: false, error: 'Invalid upload.' };

  const { insertAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const trimmedName = name.trim() || 'Avatar';

  const { data, error: downloadError } = await adminDb.storage.from('media').download(path);
  if (downloadError || !data) return { ok: false, error: downloadError?.message ?? 'Uploaded video not found.' };
  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type;

  const { data: urlData } = adminDb.storage.from('media').getPublicUrl(path);

  await insertAvatar({
    id: avatarId,
    campaignId: s.campaignId,
    name: trimmedName,
    sourceType: 'digital_twin',
    sourcePhotoUrls: [],
    sourceVideoUrl: urlData.publicUrl,
    consentConfirmedBy: s.userId,
    createdBy: s.userId,
    status: 'training',
  });

  let createError: string | null = null;
  try {
    const { assetId } = await photoAvatarProvider.uploadAsset(buffer, contentType);
    const { groupId, lookId } = await photoAvatarProvider.createVideoAvatar({ name: trimmedName, assetId });
    const rerouteUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/avatars`;
    const { consentUrl, consentStatus } = await photoAvatarProvider.requestConsent({ groupId, rerouteUrl });
    await updateAvatarStatus(avatarId, 'pending_consent', { heygenGroupId: groupId, heygenLookId: lookId, consentUrl, consentStatus });
  } catch (e) {
    const accessDenied = e instanceof HeyGenAccessDeniedError;
    createError = accessDenied
      ? "Video avatars aren't enabled for this HeyGen account. Contact HeyGen support to enable Digital Twin access."
      : e instanceof Error ? e.message : String(e);
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: createError });
    // The access-denied message is already complete and user-facing — don't
    // wrap it with the generic "creation failed" prefix below.
    if (accessDenied) { revalidatePath('/avatars'); return { ok: false, error: createError }; }
  }

  revalidatePath('/avatars');
  if (createError) return { ok: false, error: `Video avatar creation failed: ${createError}` };
  return { ok: true, avatarId };
}

export async function setActiveAvatarAction(avatarId: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  const { getAvatar } = await import('@/lib/avatars');
  const { upsertCandidateProfile } = await import('@/lib/candidate');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: 'Avatar not found.' };
  if (avatar.status !== 'ready') return { ok: false, error: 'Avatar is not ready yet.' };

  await upsertCandidateProfile(s.campaignId, {
    activeAvatarId: avatarId,
    heygenBaseAvatarId: avatar.heygenGroupId,
    // avatar.heygenLookId is the specific trained look HeyGen returns when
    // training finishes (see createAvatarAction) — this is what video
    // generation actually needs. Losing it here silently falls back to
    // whatever HEYGEN_AVATAR_ID is set to at the environment level, which may
    // not even belong to this campaign's candidate.
    heygenAvatarId: avatar.heygenLookId ?? null,
  });
  revalidatePath('/avatars');
  return { ok: true };
}

export async function deleteAvatarAction(avatarId: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  const { getAvatar, deleteAvatarRow } = await import('@/lib/avatars');
  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: 'Avatar not found.' };
  const profile = await getCandidateProfile(s.campaignId);
  if (profile?.activeAvatarId === avatarId) {
    // Previously this just blocked deletion outright, which meant a campaign
    // with only one avatar could never delete it (no way to "deactivate"
    // without activating a different one first). Clear the reference instead
    // — the campaign falls back to "no avatar configured", which
    // generateVideoAction already reports clearly rather than erroring oddly.
    await upsertCandidateProfile(s.campaignId, {
      activeAvatarId: null,
      heygenBaseAvatarId: null,
      heygenAvatarId: null,
    });
  }
  await deleteAvatarRow(avatarId);
  revalidatePath('/avatars');
  return { ok: true };
}

// ── Self-service voice cloning ────────────────────────────────────────────────
// Mirrors the begin/finalize split used for avatars (see the comment above
// beginAvatarUploadAction): raw audio bytes never travel through a Server
// Action body, avoiding Vercel's function payload limit.

const MAX_VOICE_SAMPLE_BYTES = 50 * 1024 * 1024;
// Exact match after stripping any codec parameter: browser-recorded audio
// (MediaRecorder) reports a MIME type with a codec suffix, e.g.
// "audio/webm;codecs=opus", which never exact-matches a bare "audio/webm"
// entry, so the `;codecs=...` portion is stripped before comparing.
const ALLOWED_VOICE_SAMPLE_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/ogg'];

export async function beginVoiceCloneUploadAction(
  consent: boolean,
  file: { name: string; type: string; size: number },
): Promise<Result & { path?: string; token?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  if (!consent) return { ok: false, error: 'Consent confirmation is required.' };

  if (!file || file.size === 0) return { ok: false, error: 'Upload an audio sample.' };
  if (file.size > MAX_VOICE_SAMPLE_BYTES) return { ok: false, error: 'Audio sample must be under 50 MB.' };
  if (!ALLOWED_VOICE_SAMPLE_TYPES.includes(file.type.split(';')[0])) {
    return { ok: false, error: 'Only MP3, WAV, M4A, WebM, or OGG audio files are allowed.' };
  }

  try {
    await billingGate.check(s.campaignId);
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }

  const attemptId = uid();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'mp3';
  const path = `voices/${s.campaignId}/${attemptId}/sample.${ext}`;
  const { data, error } = await adminDb.storage.from('media').createSignedUploadUrl(path);
  if (error) return { ok: false, error: error.message };

  return { ok: true, path, token: data.token };
}

export async function finalizeVoiceCloneAction(name: string, path: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };

  const prefix = `voices/${s.campaignId}/`;
  if (!path.startsWith(prefix)) return { ok: false, error: 'Invalid upload.' };

  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
  const trimmedName = name.trim() || 'My voice';

  const { data, error: downloadError } = await adminDb.storage.from('media').download(path);
  if (downloadError || !data) return { ok: false, error: downloadError?.message ?? 'Uploaded audio not found.' };
  const buffer = Buffer.from(await data.arrayBuffer());
  // Strip any codec parameter (e.g. a browser-recorded file's
  // "audio/webm;codecs=opus") before handing it to HeyGen's asset-upload
  // endpoint, which expects a bare content type.
  const contentType = data.type.split(';')[0];

  const existingProfile = await getCandidateProfile(s.campaignId);
  if (existingProfile?.selfVoiceCloneId) {
    // Best-effort: a failure here must not block creating the replacement —
    // worst case is a stale HeyGen-side voice consuming a slot until manually
    // cleaned up (matches the digital-twin spec's precedent that partial
    // multi-step HeyGen failures don't roll back already-created state).
    try {
      await photoAvatarProvider.deleteVoiceClone(existingProfile.selfVoiceCloneId);
    } catch (e) {
      console.error(`Failed to delete previous voice clone for campaign ${s.campaignId}: ${e}`);
    }
  }

  let cloneError: string | null = null;
  let cloneLimitHit = false;
  let voiceCloneId: string | null = null;
  try {
    const { assetId } = await photoAvatarProvider.uploadAsset(buffer, contentType);
    const result = await photoAvatarProvider.cloneVoice({ name: trimmedName, assetId });
    voiceCloneId = result.voiceCloneId;
  } catch (e) {
    cloneLimitHit = e instanceof HeyGenVoiceCloneLimitError;
    cloneError = cloneLimitHit
      ? 'Voice cloning is temporarily at capacity across the platform — contact support.'
      : e instanceof Error ? e.message : String(e);
  }

  // Best-effort cleanup of the raw uploaded sample regardless of outcome —
  // once HeyGen has consumed it (or failed to), the local copy in Storage has
  // no further purpose: nothing in the UI displays it back (unlike avatar
  // photos/video, which are deliberately kept for sourcePhotoUrls/
  // sourceVideoUrl display). A cleanup failure here must not change the
  // action's success/failure result, matching the deleteVoiceClone
  // best-effort pattern above.
  try {
    await adminDb.storage.from('media').remove([path]);
  } catch (e) {
    console.error(`Failed to clean up voice sample at ${path}: ${e}`);
  }

  await upsertCandidateProfile(s.campaignId, cloneError
    ? { selfVoiceCloneStatus: 'failed', selfVoiceCloneError: cloneError }
    : {
        selfVoiceCloneId: voiceCloneId,
        selfVoiceName: trimmedName,
        selfVoiceCloneStatus: 'training',
        selfVoiceCloneError: null,
        selfVoiceConsentConfirmedBy: s.userId,
        selfVoiceConsentConfirmedAt: new Date().toISOString(),
      });

  revalidatePath('/avatars');
  // The clone-limit message is already complete and user-facing — don't wrap
  // it with the generic "Voice cloning failed:" prefix below (mirrors the
  // accessDenied handling in finalizeVideoAvatarAction).
  if (cloneLimitHit) return { ok: false, error: cloneError as string };
  if (cloneError) return { ok: false, error: `Voice cloning failed: ${cloneError}` };

  // upsertCandidateProfile silently swallows Supabase write errors platform-wide
  // (shared helper used by many unrelated flows — out of scope to change here).
  // Verify the write actually landed before reporting success, so a HeyGen
  // clone that got created but never recorded doesn't look like it worked.
  const verifyProfile = await getCandidateProfile(s.campaignId);
  if (verifyProfile?.selfVoiceCloneId !== voiceCloneId) {
    return { ok: false, error: 'Failed to save the new voice — please try again.' };
  }

  return { ok: true };
}

export async function checkVoiceCloneStatusAction(): Promise<Result> {
  const s = await requireSession();
  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
  const profile = await getCandidateProfile(s.campaignId);
  if (profile?.selfVoiceCloneStatus !== 'training' || !profile.selfVoiceCloneId) return { ok: true };

  const { status } = await photoAvatarProvider.getVoiceCloneStatus(profile.selfVoiceCloneId);
  if (status === 'ready') {
    await upsertCandidateProfile(s.campaignId, { selfVoiceCloneStatus: 'ready' });
  } else if (status === 'failed') {
    await upsertCandidateProfile(s.campaignId, { selfVoiceCloneStatus: 'failed', selfVoiceCloneError: 'HeyGen reported the voice clone failed.' });
  }
  revalidatePath('/avatars');
  return { ok: true };
}

const VOICE_PREVIEW_TEXT = 'Hello, this is a preview of your cloned voice.';

export async function previewVoiceCloneAction(): Promise<Result & { audioUrl?: string }> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  const { getCandidateProfile } = await import('@/lib/candidate');
  const profile = await getCandidateProfile(s.campaignId);
  if (profile?.selfVoiceCloneStatus !== 'ready' || !profile.selfVoiceCloneId) {
    return { ok: false, error: 'No cloned voice is ready yet.' };
  }

  try {
    await billingGate.check(s.campaignId);
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }

  try {
    const { audioUrl } = await photoAvatarProvider.synthesizeSpeech({
      voiceId: profile.selfVoiceCloneId,
      text: VOICE_PREVIEW_TEXT,
    });
    return { ok: true, audioUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function generatePromptLookAction(avatarId: string, name: string, prompt: string): Promise<Result> {
  const s = await requireSession();
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: 'Permission denied.' };
  if (!prompt.trim()) return { ok: false, error: 'Describe how the new look should appear.' };

  const { getAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: 'Avatar not found.' };
  if (avatar.status !== 'ready' || !avatar.heygenLookId) return { ok: false, error: 'Avatar is not ready yet.' };

  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };

  try {
    await billingGate.check(s.campaignId);
    // Regenerating a look on an existing, already-created avatar doesn't
    // consume avatar quota (only createAvatarAction/createVideoAvatarAction,
    // which create new avatar rows, do) — no quotaGate check belongs here.
    const { lookId } = await photoAvatarProvider.createPromptLook({
      name: name.trim() || 'Styled look',
      prompt: prompt.trim(),
      avatarId: avatar.heygenLookId,
    });
    // The avatars table only tracks one heygen_look_id per row (see
    // migration 012) — a newly generated look replaces it so video generation
    // (which reads heygenAvatarId/heygenLookId) actually picks it up. Without
    // this, the HeyGen asset we just generated is created and then discarded.
    if (lookId) {
      await updateAvatarStatus(avatarId, avatar.status, { heygenLookId: lookId });
      const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
      const profile = await getCandidateProfile(s.campaignId);
      if (profile?.activeAvatarId === avatarId) {
        await upsertCandidateProfile(s.campaignId, { heygenAvatarId: lookId });
      }
    }
  } catch (e) {
    if (e instanceof BillingBlocked) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to generate look.' };
  }
  revalidatePath('/avatars');
  return { ok: true };
}
