'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireSession, signInAs, signOut } from '@/lib/session';
import { adminDb, throwOnError } from '@/lib/supabase';
import { uid, prefixedId } from '@/lib/store';
import { getCampaign, getBillingPlan } from '@/lib/data';
import { lifecycle, disclosureEngine, quotaGate, billingGate, contentGenerator, publisher, videoProvider, photoAvatarProvider } from '@/lib/services';
import { HeyGenAccessDeniedError, HeyGenVoiceCloneLimitError } from '@/integrations';
import { contentRepo, approvalRepo, disclosureRepo, auditRepo } from '@/lib/repos';
import { ContentType, ContentStatus, ContentItem, Platform, AvatarStatus, VIDEO_CONTENT_TYPES, isContentType, platformsMissingRequiredMedia } from '@/domain/types';
import { GateError } from '@/domain/content-lifecycle';
import { getCampaignSocialProfile } from '@/lib/channels';
import { unconnectedPlatforms } from '@/domain/channels';
import { combineDisclosureText } from '@/domain/disclosure';
import { zonedNaiveToUtc } from '@/lib/timezone';
import { QuotaExceeded, contentPeriodStart, videoPeriodStart } from '@/domain/quota';
import { BillingBlocked } from '@/domain/billing';
import { can } from '@/lib/permissions';
import { getLocale, isSupportedLocale, DEFAULT_LOCALE, type Locale } from '@/lib/locale';
import type { ActionFormState } from '@/lib/form-state';

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

// Publishing only ever goes through the campaign's own Ayrshare profile — no
// fallback to the Primary Profile (that's other tenants' accounts). Returns
// the profile key, or the platforms the campaign still has to connect.
async function requireConnectedChannels(
  campaignId: string,
  platforms: Platform[],
): Promise<{ profileKey: string } | { missing: Platform[] }> {
  const { profileKey, accounts } = await getCampaignSocialProfile(campaignId);
  const missing = profileKey ? unconnectedPlatforms(platforms, accounts) : platforms;
  return missing.length > 0 || !profileKey ? { missing } : { profileKey };
}

// The "connect these first" error is read by campaign staff, so it names the
// networks as the Channels page does ("Instagram, X"), not by internal id.
async function networkNames(locale: string, platforms: Platform[]): Promise<string> {
  const t = await getTranslations({ locale, namespace: 'channels' });
  return platforms.map(p => t(`networks.${p}.name`)).join(', ');
}

// super_admin sessions carry no campaign (campaignId === null). Tenant-scoped
// actions must refuse rather than silently query `campaign_id = null`
// (audit finding DATA-18).
function tenantId(s: { campaignId: string | null }): string | null {
  return s.campaignId ?? null;
}

const DUMMY_HASH = '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk';

// Driven by `useFormState` on /login: validation / credential failures come
// back as state (so the email survives and the message renders inline), a
// successful sign-in redirects. The throttle, bcrypt timing guard and session
// cookie behaviour are unchanged from the redirect-based version.
export async function loginAction(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const bcrypt = await import('bcryptjs');
  const { setSessionCookie } = await import('@/lib/session');
  const { headers } = await import('next/headers');
  const { isLockedOut, getAttempts, recordFailure, clearAttempts } = await import('@/lib/login-throttle');
  const t = await getTranslations({ locale: getLocale(), namespace: 'login.errors' });

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  // Never echo the password back.
  const values = { email };

  if (!email || !password) return { ok: false, error: t('incorrectCredentials'), values };

  const now = Date.now();
  const ip = (headers().get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipKey = `ip:${ip}`;
  const emailKey = `email:${email}`;

  // Fail closed on lockout before touching bcrypt (SEC-10).
  const [ipState, emailState] = await Promise.all([getAttempts(ipKey), getAttempts(emailKey)]);
  if (isLockedOut(ipState, now) || isLockedOut(emailState, now)) {
    return { ok: false, error: t('tooManyAttempts'), values };
  }

  const { data: user } = await adminDb
    .from('users')
    .select('id, name, role, campaign_id, password_hash, locale')
    .eq('email', email)
    .single();

  // Always run bcrypt to prevent timing-based email enumeration
  const hash = user?.password_hash ?? DUMMY_HASH;
  const valid = await bcrypt.default.compare(password, hash);

  if (!valid || !user) {
    await Promise.all([recordFailure(ipKey, now), recordFailure(emailKey, now)]);
    return { ok: false, error: t('incorrectCredentials'), values };
  }

  await Promise.all([clearAttempts(ipKey), clearAttempts(emailKey)]);
  setSessionCookie({
    userId: user.id,
    name: user.name,
    role: user.role,
    campaignId: user.campaign_id,
    locale: user.locale,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });

  redirect(user.role === 'super_admin' ? '/admin' : '/dashboard');
}

// Driven by `useFormState` on /join: every validation failure returns state
// with field-level messages and the typed values (never the password), so the
// form is not wiped; success signs the joiner in and redirects.
export async function joinAction(_prev: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const bcrypt = await import('bcryptjs');
  const { setSessionCookie } = await import('@/lib/session');
  // /join has a pre-auth language toggle and is fully translated, so honour the
  // language the joiner actually picked instead of dropping everyone into
  // English. getLocale() already falls back to the pre-auth `locale` cookie.
  const locale = getLocale();
  const t = await getTranslations({ locale, namespace: 'join.errors' });

  const code     = String(formData.get('code')     ?? '').trim();
  const name     = String(formData.get('name')     ?? '').trim();
  const email    = String(formData.get('email')    ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const values = { code, name, email };

  const fieldErrors: Record<string, string> = {};
  if (!code)  fieldErrors.code  = t('required');
  if (!name)  fieldErrors.name  = t('required');
  if (!email) fieldErrors.email = t('required');
  if (!password) fieldErrors.password = t('required');
  else if (password.length < 8) fieldErrors.password = t('passwordTooShort');
  if (Object.keys(fieldErrors).length) {
    const onlyPassword = Object.keys(fieldErrors).length === 1 && fieldErrors.password === t('passwordTooShort');
    return { ok: false, error: onlyPassword ? t('passwordTooShort') : t('allFieldsRequired'), fieldErrors, values };
  }

  const { data: invite } = await adminDb
    .from('invite_codes')
    .select('*')
    .eq('code', code)
    .single();

  if (!invite)                                  return { ok: false, error: t('inviteInvalid'), fieldErrors: { code: t('inviteInvalid') }, values };
  if (invite.used_at)                           return { ok: false, error: t('inviteUsed'),    fieldErrors: { code: t('inviteUsed') },    values };
  if (new Date(invite.expires_at) < new Date()) return { ok: false, error: t('inviteExpired'), fieldErrors: { code: t('inviteExpired') }, values };

  // A user row may already exist here as a placeholder created by addUserAction
  // (name/email/role set, no password_hash yet). Only a row that already has a
  // password_hash represents a real, already-claimed account.
  const { data: existing } = await adminDb
    .from('users')
    .select('id, password_hash')
    .eq('email', email)
    .maybeSingle();
  if (existing?.password_hash) return { ok: false, error: t('emailExists'), fieldErrors: { email: t('emailExists') }, values };

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
  if (!claimed) return { ok: false, error: t('inviteUsed'), fieldErrors: { code: t('inviteUsed') }, values };

  if (existing) {
    await throwOnError(
      adminDb.from('users').update({
        name, password_hash, campaign_id: invite.campaign_id, role: invite.role, locale,
      }).eq('id', existing.id),
      'users.join.update',
    );
  } else {
    await throwOnError(
      adminDb.from('users').insert({
        id: userId, campaign_id: invite.campaign_id, name, email, password_hash, role: invite.role, locale,
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
    locale,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });

  redirect('/dashboard');
}

export async function logoutAction() {
  signOut();
  redirect('/login');
}

// Shape returned to ContentEditor's useFormState: a failure keeps the form
// (and what was typed in it) on screen with a translated message; success
// redirects to the new item and never returns.
export type CreateContentState = { ok: true } | { ok: false; error: string };

export async function createContentAction(_prev: CreateContentState | undefined, formData: FormData): Promise<CreateContentState> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  const tc = await getTranslations({ locale: s.locale, namespace: 'content' });
  const { getCandidateProfile } = await import('@/lib/candidate');
  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return { ok: false, error: t('contentBodyRequired') };
  const rawType = String(formData.get('type') ?? '');
  const type: ContentType = isContentType(rawType) ? rawType : 'reel';
  const rawLocale = String(formData.get('locale') ?? '');
  const locale: Locale = isSupportedLocale(rawLocale)
    ? rawLocale
    : isSupportedLocale(profile?.contentLocale)
      ? profile!.contentLocale
      : DEFAULT_LOCALE;
  const id = uid();
  try {
    await throwOnError(
      adminDb.from('content_items').insert({
        id,
        campaign_id: s.campaignId,
        type,
        title: title || tc('untitled'),
        body,
        status: 'draft',
      // Reels always go through avatar-video generation, so the published
      // artifact is AI-generated regardless of who wrote the script — the
      // "Write it myself" toggle only covers script authorship and must not
      // suppress the disclosure gate for video content types.
        is_ai_generated: VIDEO_CONTENT_TYPES.includes(type) || formData.get('isAiGenerated') === 'on',
        target_jurisdictions: campaign.jurisdictions,
        created_by: s.userId,
        locale,
      }),
      'content_items.create',
    );
  } catch (e) {
    console.error('[createContentAction] insert failed', e);
    return { ok: false, error: t('saveFailed') };
  }
  revalidatePath('/content'); revalidatePath('/dashboard');
  redirect(`/content/${id}`);
}

export type DraftResult = { ok: true; title: string; text: string; locale: Locale } | { ok: false; error: string };

export async function generateDraftAction(instruction: string, type: string, locale?: string): Promise<DraftResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  const { getCandidateProfile } = await import('@/lib/candidate');

  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };

  // The caller (ContentEditor) always passes its selected language, but a
  // missing/corrupted/unsupported value falls back to the campaign's own
  // content-generation default rather than erroring the whole draft.
  const resolvedLocale: Locale = isSupportedLocale(locale)
    ? locale
    : isSupportedLocale(profile?.contentLocale)
      ? profile!.contentLocale
      : DEFAULT_LOCALE;

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
      contentGenerator.draft({ instruction, type, candidateProfile: profile ?? undefined, locale: resolvedLocale }));
    return { ok: true, title: out.title, text: out.text, locale: out.locale };
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }
}

export async function submitAction(id: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!(await requireOwnedItem(id, s.campaignId))) return { ok: false as const, error: t('contentNotFound') };
  const r = await guard(() => lifecycle.submitForReview(id, s.userId));
  revalidateContent(id);
  return r;
}

// Approve / reject from the review step. Both are approver-only decisions.
// The wizard shows a draft and an in_review item on the same step, so a
// rejection of a draft passes through in_review first (as approveTextAction
// does) — the FSM only allows in_review → rejected, and the audit trail
// stays complete.
export async function decideAction(id: string, decision: 'approve' | 'reject', note: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'approve')) return { ok: false, error: t('permissionDenied') };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return { ok: false as const, error: t('contentNotFound') };
  const trimmedNote = note.trim() || undefined;
  if (decision === 'reject' && item.status === 'draft') {
    const submitResult = await guard(() => lifecycle.submitForReview(id, s.userId));
    if (!submitResult.ok) return submitResult;
  }
  const r = await guard(() =>
    decision === 'approve'
      ? lifecycle.approve(id, s.userId, trimmedNote)
      : lifecycle.reject(id, s.userId, trimmedNote));
  revalidateContent(id);
  return r;
}

// Rejected → draft so the author can fix it and send it back for review.
export async function reviseAction(id: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!(await requireOwnedItem(id, s.campaignId))) return { ok: false as const, error: t('contentNotFound') };
  const r = await guard(() => lifecycle.revise(id, s.userId));
  revalidateContent(id);
  return r;
}

// Every content status change shows up on the list and the dashboard tiles
// too, so revalidate all three together.
function revalidateContent(id: string): void {
  revalidatePath(`/content/${id}`);
  revalidatePath('/content');
  revalidatePath('/dashboard');
}

export async function publishAction(id: string, platforms: Platform[]): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'publish')) return { ok: false, error: t('permissionDenied') };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return { ok: false as const, error: t('contentNotFound') };
  // Instagram/TikTok reject a post with no image/video attached — catch this
  // before ever calling the publisher, with an error that actually explains
  // why (Ayrshare's own HTTP 400 for this gives no usable message).
  const blocked = platformsMissingRequiredMedia(platforms, !!item.mediaUrl);
  if (blocked.length > 0) {
    return { ok: false, error: t('mediaRequiredForPlatforms', { platforms: await networkNames(s.locale, blocked) }) };
  }
  if (platforms.length === 0) return { ok: false, error: t('noPlatformsSelected') };
  const channels = await requireConnectedChannels(s.campaignId, platforms);
  if ('missing' in channels) {
    return { ok: false, error: t('channelsNotConnected', { platforms: await networkNames(s.locale, channels.missing) }) };
  }
  // Hard gate (approval + AI disclosure) before anything goes live — the post
  // can't be pulled back if markPublished rejects it afterwards.
  const gate = await guard(() => lifecycle.assertPublishable(id));
  if (!gate.ok) return gate;
  const disc = await disclosureRepo.listFor(id);
  // Publish first, inspect the per-platform results, and only mark the item
  // published if at least one platform actually accepted the post.
  const results = await publisher.publish({
    platforms, title: item.title, text: item.body,
    disclosureText: combineDisclosureText(disc),
    mediaUrl: item.mediaUrl ?? undefined,
    profileKey: channels.profileKey,
  });
  const failed = results.filter(r => r.status === 'failed');
  if (failed.length === results.length) {
    // Provider error text is logged, not shown: it's Ayrshare's wording, not ours.
    console.error('[publishAction] all platforms failed', { id, failed });
    return { ok: false, error: t('publishingFailed', { details: await networkNames(s.locale, failed.map(f => f.platform)) }) };
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
  revalidateContent(id);
  if (r.ok && failed.length) {
    console.error('[publishAction] some platforms failed', { id, failed });
    return { ok: false, error: t('publishedButFailedOn', { platforms: await networkNames(s.locale, failed.map(f => f.platform)) }) };
  }
  return r;
}

// Used with `useFormState` on /billing, so it takes (prevState, formData) and
// returns a Result the form can show; on success it redirects to the Stripe
// portal (redirect() throws, so nothing is returned on that path).
export async function openMyBillingPortalAction(_prev?: Result | null, _formData?: FormData): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.billing' });
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('permissionDenied') };
  const { stripe } = await import('@/lib/stripe');
  if (!stripe) return { ok: false, error: t('billingNotConfigured') };
  const campaign = await getCampaign(s.campaignId);
  if (!campaign?.stripeCustomerId) return { ok: false, error: t('noBillingAccount') };
  let url: string;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: campaign.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/billing`,
    });
    url = session.url;
  } catch (e) {
    console.error('[billing] openMyBillingPortalAction failed', e);
    return { ok: false, error: t('portalFailed') };
  }
  redirect(url);
}

// ── Video generation ──────────────────────────────────────────────────────────

export async function generateVideoAction(
  contentId: string,
  script: string,
  overrides?: { avatarId?: string; voiceId?: string; background?: string; aspectRatio?: '16:9' | '9:16' | '1:1' },
): Promise<Result & { videoId?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  // Ownership first: the job id is written onto this row below (NEW-2).
  if (!(await requireOwnedItem(contentId, s.campaignId))) return { ok: false, error: t('contentNotFound') };
  const { getCandidateProfile } = await import('@/lib/candidate');
  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };
  const avatarId = overrides?.avatarId ?? profile?.heygenAvatarId ?? undefined;
  // Never fall through to the provider's own HEYGEN_AVATAR_ID env default here —
  // that's a single global avatar shared across every tenant, so silently using
  // it would generate video of the wrong (possibly non-consented) candidate.
  if (!avatarId) return { ok: false, error: t('noAvatarConfigured') };
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
  if (!heygenVoiceId) return { ok: false, error: t('noVideoVoiceConfigured') };
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
  // Only answer for jobs attached to one of the caller's own content items —
  // otherwise any logged-in user could read another tenant's video URL.
  const { data: owned } = await adminDb.from('content_items')
    .select('id').eq('video_job_id', videoId).eq('campaign_id', s.campaignId).maybeSingle();
  if (!owned) return { status: 'failed' };
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

// ── Wizard actions ────────────────────────────────────────────────────────────

export async function saveBodyAction(id: string, body: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return { ok: false as const, error: t('contentNotFound') };
  // Editing after approval would let unapproved text reach publish — only allow pre-approval states.
  if (!['draft', 'in_review', 'rejected'].includes(item.status)) {
    return { ok: false, error: t('contentNoLongerEditable') };
  }
  const { error } = await adminDb.from('content_items')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[saveBodyAction] update failed', error);
    return { ok: false, error: t('saveFailed') };
  }
  revalidateContent(id);
  return { ok: true };
}

export async function approveTextAction(id: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'approve')) return { ok: false, error: t('permissionDenied') };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return { ok: false as const, error: t('contentNotFound') };

  // The wizard presents "review + approve" as one click, but the lifecycle FSM
  // requires in_review before approved — so a freshly generated draft needs the
  // submit_for_review transition first (also keeps the audit trail complete).
  if (item.status === 'draft') {
    const submitResult = await guard(() => lifecycle.submitForReview(id, s.userId));
    if (!submitResult.ok) return submitResult;
  }

  // Approve via the lifecycle so a valid transition is enforced and an approval
  // record is written. Scheduling never happens here — it goes through the
  // gated scheduleWithTimeAction so the hard gate always runs.
  const r = await guard(() => lifecycle.approve(id, s.userId));
  if (!r.ok) return r;
  // Video types still need the video-generation step, so send them back to
  // in_review; the approval remains on record for the eventual schedule gate.
  if (VIDEO_CONTENT_TYPES.includes(item.type)) {
    const { error } = await adminDb.from('content_items')
      .update({ status: 'in_review', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('[approveTextAction] update failed', error);
      return { ok: false, error: t('updateFailed') };
    }
  }
  revalidateContent(id);
  return { ok: true };
}

export async function confirmVideoAction(id: string, videoUrl: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'approve')) return { ok: false, error: t('permissionDenied') };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return { ok: false as const, error: t('contentNotFound') };
  // Persist the rendered video, then approve through the lifecycle. Scheduling
  // is never done here — it always flows through the gated schedule actions.
  const { error } = await adminDb.from('content_items')
    .update({ media_url: videoUrl, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[confirmVideoAction] update failed', error);
    return { ok: false, error: t('updateFailed') };
  }
  await auditRepo.append({
    campaignId: item.campaignId, actorUserId: s.userId,
    action: 'confirm_video', entityType: 'content_item', entityId: id,
    details: { videoUrl },
  });
  const r = await guard(() => lifecycle.approve(id, s.userId));
  revalidateContent(id);
  return r;
}

export async function confirmDisclosureAction(id: string, disclosureText?: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'schedule')) return { ok: false, error: t('permissionDenied') };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return { ok: false as const, error: t('contentNotFound') };
  // The disclosure step only exists for an approved item; attaching a
  // disclosure to anything else would let it skip the review.
  if (item.status !== 'approved') return { ok: false, error: t('disclosureRequiresApproval') };
  const campaign = await getCampaign(s.campaignId);
  const required = disclosureEngine.requiredFor(item.isAiGenerated, campaign?.defaultDisclosureText ?? null);
  if (required) {
    // Campaigns edit the default wording per item, so the wizard's edited
    // text (not the campaign default) is what actually gets attached.
    const text = (disclosureText ?? required.disclosureText).trim();
    if (!text) return { ok: false, error: t('disclosureTextEmpty') };
    // A double submit must not attach the disclosure twice.
    const existing = await disclosureRepo.listFor(id);
    if (existing.length > 0) { revalidateContent(id); return { ok: true }; }
    await disclosureRepo.add({
      contentItemId: id,
      campaignId: s.campaignId,
      disclosureText: text,
      placement: required.placement,
    });
    await auditRepo.append({
      campaignId: item.campaignId, actorUserId: s.userId,
      action: 'confirm_disclosure', entityType: 'content_item', entityId: id,
      details: { placement: required.placement },
    });
  }
  // The item stays `approved`: it only becomes `scheduled` once a real time
  // and platforms are picked (scheduleWithTimeAction), so a scheduled item
  // always has a scheduled_at for the publish cron to act on.
  revalidateContent(id);
  return { ok: true };
}

export async function dismissMonitoringAction(id: string): Promise<Result> {
  return setMonitoringDismissed(id, new Date().toISOString());
}

// Undo for a dismissal (the toast's "Undo" button) — brings the item back.
export async function restoreMonitoringAction(id: string): Promise<Result> {
  return setMonitoringDismissed(id, null);
}

async function setMonitoringDismissed(id: string, dismissedAt: string | null): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  const campaignId = tenantId(s);
  if (!campaignId) return { ok: false, error: t('noCampaignInSession') };
  try {
    await throwOnError(
      adminDb.from('monitoring_results')
        .update({ dismissed_at: dismissedAt })
        .eq('id', id)
        .eq('campaign_id', campaignId),
      'monitoring_results.dismiss',
    );
  } catch (e) {
    console.error('[monitoring] dismiss/restore failed', e);
    return { ok: false, error: t('monitoringUpdateFailed') };
  }
  revalidatePath('/monitoring');
  return { ok: true };
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
    const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
    if (!can(s.role, 'edit_settings')) throw new GateError(t('permissionDenied'));
    const { upsertCandidateProfile } = await import('@/lib/candidate');
    await upsertCandidateProfile(s.campaignId, data);
    revalidatePath('/settings');
    revalidatePath('/avatars');
  });
}

export async function scheduleWithTimeAction(
  id: string,
  platforms: Platform[],
  scheduledAt: string,
  timezone: string,
): Promise<Result> {
  return guard(async () => {
    const s = await requireSession();
    const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
    if (!can(s.role, 'schedule')) throw new GateError(t('permissionDenied'));
    if (!scheduledAt) throw new GateError(t('scheduledTimeRequired'));
    // The wizard sends a naive datetime-local string plus the IANA timezone.
    // Interpret it in that zone (not the server's) so the stored UTC instant is
    // correct — otherwise posts fire hours early (audit finding DATA-8).
    const scheduledUtc = zonedNaiveToUtc(scheduledAt, timezone);
    if (scheduledUtc <= new Date()) throw new GateError(t('scheduledTimeMustBeFuture'));

    const item = await contentRepo.get(id);
    if (!item || item.campaignId !== s.campaignId) throw new GateError(t('contentNotFound'));

    // Instagram/TikTok reject a post with no image/video attached — catch
    // this before the schedule gate, with an error that explains why.
    const blocked = platformsMissingRequiredMedia(platforms, !!item.mediaUrl);
    if (blocked.length > 0) {
      throw new GateError(t('mediaRequiredForPlatforms', { platforms: await networkNames(s.locale, blocked) }));
    }
    if (platforms.length === 0) throw new GateError(t('noPlatformsSelected'));

    const channels = await requireConnectedChannels(s.campaignId, platforms);
    if ('missing' in channels) {
      throw new GateError(t('channelsNotConnected', { platforms: await networkNames(s.locale, channels.missing) }));
    }

    // Hard gate: enforces human approval, and disclosure-on-file for AI content,
    // before status can move to 'scheduled'. Also the reschedule path
    // (scheduled → scheduled), which re-runs the same gate.
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
      action: item.status === 'scheduled' ? 'reschedule' : 'schedule_with_time',
      entityType: 'content_item',
      entityId: id,
      details: { scheduledAt: scheduledUtc.toISOString(), timezone, platforms },
    });

    revalidateContent(id);
  });
}

// Takes a scheduled item off the calendar: back to `approved`, scheduled_at
// cleared. The approval and disclosure stay on record, so it can be
// rescheduled or published right away.
export async function unscheduleAction(id: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'schedule')) return { ok: false, error: t('permissionDenied') };
  const item = await requireOwnedItem(id, s.campaignId);
  if (!item) return { ok: false as const, error: t('contentNotFound') };
  if (item.status !== 'scheduled') return { ok: false, error: t('notScheduled') };
  // Lifecycle first (valid transition + audit entry), then clear the time so
  // the publish cron can never pick up an unscheduled row.
  const r = await guard(() => lifecycle.unschedule(id, s.userId));
  if (!r.ok) return r;
  const { error } = await adminDb.from('content_items')
    .update({ scheduled_at: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[unscheduleAction] clearing scheduled_at failed', error);
    return { ok: false, error: t('updateFailed') };
  }
  revalidateContent(id);
  return { ok: true };
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
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };
  if (!consent) return { ok: false, error: t('consentRequired') };

  if (files.length < 4 || files.length > 10) return { ok: false, error: t('photoCountRange') };
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) return { ok: false, error: t('eachPhotoTooLarge') };
    if (!file.type.startsWith('image/')) return { ok: false, error: t('avatarOnlyImageFiles') };
  }

  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };

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
    if (error) {
      console.error('[avatars] createSignedUploadUrl failed', error);
      return { ok: false, error: t('storageError') };
    }
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
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };

  const prefix = `avatars/${s.campaignId}/${avatarId}/`;
  if (paths.length < 4 || paths.length > 10 || paths.some(p => !p.startsWith(prefix))) {
    return { ok: false, error: t('invalidUpload') };
  }

  const { insertAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const trimmedName = name.trim() || 'Avatar';

  const buffers: Buffer[] = [];
  const contentTypes: string[] = [];
  const sourcePhotoUrls: string[] = [];
  for (const path of paths) {
    const { data, error } = await adminDb.storage.from('media').download(path);
    if (error || !data) {
      if (error) console.error('[avatars] photo download failed', error);
      return { ok: false, error: t('uploadedPhotoNotFound') };
    }
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
    // Raw provider text stays in the logs; the user (and the stored status
    // line) get a translated, actionable message.
    console.error(`[avatars] photo avatar creation failed for ${avatarId}`, e);
    createError = t('avatarCreationFailed');
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: createError });
  }

  revalidatePath('/avatars');
  // Report the failure instead of returning ok:true for a failed creation (INT-14).
  if (createError) return { ok: false, error: createError };
  return { ok: true, avatarId };
}

// Returns the avatar's (possibly updated) status so the client can poll this
// without re-rendering the whole page on every tick — it only refreshes the
// route once the status actually changes.
export type AvatarStatusResult = Result & { status?: AvatarStatus; errorMessage?: string | null };

export async function checkAvatarStatusAction(avatarId: string): Promise<AvatarStatusResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  const { getAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: t('avatarNotFound') };
  if ((avatar.status !== 'training' && avatar.status !== 'pending_consent') || !avatar.heygenGroupId) {
    return { ok: true, status: avatar.status, errorMessage: avatar.errorMessage };
  }

  let next: AvatarStatus = avatar.status;
  let errorMessage: string | null = avatar.errorMessage ?? null;
  const { status, error, consentStatus } = await photoAvatarProvider.getAvatarGroupStatus(avatar.heygenGroupId);
  if (status === 'failed') {
    // Log HeyGen's wording for diagnosis; show the user a translated message.
    console.error(`[avatars] training failed for ${avatarId}`, error);
    next = 'failed';
    errorMessage = t('avatarTrainingFailed');
    await updateAvatarStatus(avatarId, 'failed', { errorMessage });
  } else if (status === 'completed') {
    next = 'ready';
    await updateAvatarStatus(avatarId, 'ready');
  } else if (status === 'pending_consent') {
    // Still waiting on the candidate to complete HeyGen's hosted consent
    // recording — just refresh consentStatus in case it changed.
    await updateAvatarStatus(avatarId, 'pending_consent', { consentStatus });
  } else if (avatar.status === 'pending_consent' && status === 'processing') {
    // Consent was approved since the last poll — HeyGen has started training.
    next = 'training';
    await updateAvatarStatus(avatarId, 'training', { consentStatus });
  }
  if (next !== avatar.status) revalidatePath('/avatars');
  return { ok: true, status: next, errorMessage };
}

const MAX_TRAINING_VIDEO_BYTES = 500 * 1024 * 1024;

export async function beginVideoAvatarUploadAction(
  consent: boolean,
  file: { name: string; type: string; size: number },
): Promise<Result & { avatarId?: string; path?: string; token?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };
  if (!consent) return { ok: false, error: t('consentRequired') };

  if (!file || file.size === 0) return { ok: false, error: t('uploadTrainingVideo') };
  if (file.size > MAX_TRAINING_VIDEO_BYTES) return { ok: false, error: t('videoTooLarge500mb') };
  if (file.type !== 'video/mp4' && file.type !== 'video/quicktime') return { ok: false, error: t('onlyMp4OrQuicktime') };

  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };

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
  if (error) {
    console.error('[avatars] createSignedUploadUrl failed', error);
    return { ok: false, error: t('storageError') };
  }

  return { ok: true, avatarId, path, token: data.token };
}

export async function finalizeVideoAvatarAction(
  avatarId: string,
  name: string,
  path: string,
): Promise<Result & { avatarId?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };

  const prefix = `avatars/${s.campaignId}/${avatarId}/`;
  if (!path.startsWith(prefix)) return { ok: false, error: t('invalidUpload') };

  const { insertAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const trimmedName = name.trim() || 'Avatar';

  const { data, error: downloadError } = await adminDb.storage.from('media').download(path);
  if (downloadError || !data) {
    if (downloadError) console.error('[avatars] training video download failed', downloadError);
    return { ok: false, error: t('uploadedVideoNotFound') };
  }
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
    // Access-denied gets its own specific message; everything else is logged
    // raw and reported with a translated, actionable message.
    console.error(`[avatars] video avatar creation failed for ${avatarId}`, e);
    createError = e instanceof HeyGenAccessDeniedError
      ? t('digitalTwinNotEnabled')
      : t('videoAvatarCreationFailed');
    await updateAvatarStatus(avatarId, 'failed', { errorMessage: createError });
  }

  revalidatePath('/avatars');
  if (createError) return { ok: false, error: createError };
  return { ok: true, avatarId };
}

export async function setActiveAvatarAction(avatarId: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };
  const { getAvatar } = await import('@/lib/avatars');
  const { upsertCandidateProfile } = await import('@/lib/candidate');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: t('avatarNotFound') };
  if (avatar.status !== 'ready') return { ok: false, error: t('avatarNotReady') };

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
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };
  const { getAvatar, deleteAvatarRow } = await import('@/lib/avatars');
  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: t('avatarNotFound') };
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
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };
  if (!consent) return { ok: false, error: t('consentRequired') };

  if (!file || file.size === 0) return { ok: false, error: t('uploadAudioSample') };
  if (file.size > MAX_VOICE_SAMPLE_BYTES) return { ok: false, error: t('audioSampleTooLarge') };
  if (!ALLOWED_VOICE_SAMPLE_TYPES.includes(file.type.split(';')[0])) {
    return { ok: false, error: t('onlyAudioFormatsAllowed') };
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
  if (error) {
    console.error('[voice] createSignedUploadUrl failed', error);
    return { ok: false, error: t('storageError') };
  }

  return { ok: true, path, token: data.token };
}

export async function finalizeVoiceCloneAction(name: string, path: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };

  const prefix = `voices/${s.campaignId}/`;
  if (!path.startsWith(prefix)) return { ok: false, error: t('invalidUpload') };

  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
  const trimmedName = name.trim() || 'My voice';

  const { data, error: downloadError } = await adminDb.storage.from('media').download(path);
  if (downloadError || !data) {
    if (downloadError) console.error('[voice] sample download failed', downloadError);
    return { ok: false, error: t('uploadedAudioNotFound') };
  }
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
    // Raw provider text stays in the logs; the stored status line and the
    // returned error are translated.
    console.error(`[voice] clone failed for campaign ${s.campaignId}`, e);
    cloneLimitHit = e instanceof HeyGenVoiceCloneLimitError;
    cloneError = cloneLimitHit ? t('voiceCloneCapacity') : t('voiceCloningFailed');
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
  if (cloneError) return { ok: false, error: cloneError };

  // upsertCandidateProfile silently swallows Supabase write errors platform-wide
  // (shared helper used by many unrelated flows — out of scope to change here).
  // Verify the write actually landed before reporting success, so a HeyGen
  // clone that got created but never recorded doesn't look like it worked.
  const verifyProfile = await getCandidateProfile(s.campaignId);
  if (verifyProfile?.selfVoiceCloneId !== voiceCloneId) {
    return { ok: false, error: t('voiceSaveVerificationFailed') };
  }

  return { ok: true };
}

// Returns the clone's (possibly updated) status so the client only refreshes
// the route when it actually changes, instead of on every poll tick.
export type VoiceCloneStatusResult = Result & { status?: 'training' | 'ready' | 'failed' | null; errorMessage?: string | null };

export async function checkVoiceCloneStatusAction(): Promise<VoiceCloneStatusResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  const { getCandidateProfile, upsertCandidateProfile } = await import('@/lib/candidate');
  const profile = await getCandidateProfile(s.campaignId);
  if (profile?.selfVoiceCloneStatus !== 'training' || !profile.selfVoiceCloneId) {
    return { ok: true, status: profile?.selfVoiceCloneStatus ?? null, errorMessage: profile?.selfVoiceCloneError ?? null };
  }

  const { status } = await photoAvatarProvider.getVoiceCloneStatus(profile.selfVoiceCloneId);
  if (status === 'ready') {
    await upsertCandidateProfile(s.campaignId, { selfVoiceCloneStatus: 'ready' });
    revalidatePath('/avatars');
    return { ok: true, status: 'ready', errorMessage: null };
  }
  if (status === 'failed') {
    const errorMessage = t('voiceCloneFailed');
    await upsertCandidateProfile(s.campaignId, { selfVoiceCloneStatus: 'failed', selfVoiceCloneError: errorMessage });
    revalidatePath('/avatars');
    return { ok: true, status: 'failed', errorMessage };
  }
  return { ok: true, status: 'training', errorMessage: null };
}

export async function previewVoiceCloneAction(): Promise<Result & { audioUrl?: string }> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };
  const { getCandidateProfile } = await import('@/lib/candidate');
  const profile = await getCandidateProfile(s.campaignId);
  if (profile?.selfVoiceCloneStatus !== 'ready' || !profile.selfVoiceCloneId) {
    return { ok: false, error: t('noVoiceCloneReady') };
  }

  try {
    await billingGate.check(s.campaignId);
  } catch (e) {
    if (e instanceof QuotaExceeded || e instanceof BillingBlocked) return { ok: false, error: e.message };
    throw e;
  }

  // The sample sentence is spoken in the user's language, not always English.
  const tVoice = await getTranslations({ locale: s.locale, namespace: 'voice' });
  try {
    const { audioUrl } = await photoAvatarProvider.synthesizeSpeech({
      voiceId: profile.selfVoiceCloneId,
      text: tVoice('previewText'),
    });
    return { ok: true, audioUrl };
  } catch (e) {
    console.error(`[voice] preview synthesis failed for campaign ${s.campaignId}`, e);
    return { ok: false, error: t('voicePreviewFailed') };
  }
}

export async function generatePromptLookAction(avatarId: string, name: string, prompt: string): Promise<Result> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.actions' });
  if (!can(s.role, 'manage_avatars')) return { ok: false, error: t('permissionDenied') };
  if (!prompt.trim()) return { ok: false, error: t('describeLookPrompt') };

  const { getAvatar, updateAvatarStatus } = await import('@/lib/avatars');
  const avatar = await getAvatar(avatarId);
  if (!avatar || avatar.campaignId !== s.campaignId) return { ok: false, error: t('avatarNotFound') };
  if (avatar.status !== 'ready' || !avatar.heygenLookId) return { ok: false, error: t('avatarNotReady') };

  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: t('campaignNotFound') };

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
    console.error(`[avatars] look generation failed for ${avatarId}`, e);
    return { ok: false, error: t('generateLookFailed') };
  }
  revalidatePath('/avatars');
  return { ok: true };
}
