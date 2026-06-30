'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession, signInAs, signOut } from '@/lib/session';
import { adminDb } from '@/lib/supabase';
import { uid } from '@/lib/store';
import { getCampaign } from '@/lib/data';
import { lifecycle, disclosureEngine, usageMeter, contentGenerator, publisher, videoProvider, voiceProvider } from '@/lib/services';
import { contentRepo, approvalRepo, disclosureRepo, auditRepo } from '@/lib/repos';
import { ContentType, ContentStatus, Platform, VIDEO_CONTENT_TYPES } from '@/domain/types';
import { GateError } from '@/domain/content-lifecycle';
import { CapExceeded } from '@/domain/usage';

type Result = { ok: true } | { ok: false; error: string };

function guard<T>(fn: () => Promise<T>): Promise<Result> {
  return fn().then(() => ({ ok: true as const })).catch((e: unknown) => {
    if (e instanceof GateError || e instanceof CapExceeded) return { ok: false as const, error: e.message };
    throw e;
  });
}

const DUMMY_HASH = '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuuabcdefghijk';

export async function loginAction(formData: FormData) {
  const bcrypt = await import('bcryptjs');
  const { setSessionCookie } = await import('@/lib/session');

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) redirect('/login?error=1');

  const { data: user } = await adminDb
    .from('users')
    .select('id, name, role, campaign_id, password_hash')
    .eq('email', email)
    .single();

  // Always run bcrypt to prevent timing-based email enumeration
  const hash = user?.password_hash ?? DUMMY_HASH;
  const valid = await bcrypt.default.compare(password, hash);

  if (!valid || !user) redirect('/login?error=1');

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

  const { data: existing } = await adminDb
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing) redirect(`${base}&error=email`);

  const password_hash = await bcrypt.default.hash(password, 10);
  const userId = 'u-' + Math.random().toString(36).slice(2, 9);

  await adminDb.from('users').insert({
    id: userId,
    campaign_id: invite.campaign_id,
    name,
    email,
    password_hash,
    role: invite.role,
  });

  await adminDb.from('invite_codes')
    .update({ used_by: userId, used_at: new Date().toISOString() })
    .eq('code', code);

  await adminDb.from('audit_entries').insert({
    campaign_id: invite.campaign_id,
    actor_user_id: userId,
    action: 'user_joined',
    entity_type: 'user',
    entity_id: userId,
    details: { via_invite: code },
  });

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
  const s = requireSession();
  const campaign = await getCampaign(s.campaignId);
  if (!campaign) throw new Error('Campaign not found');
  const id = uid();
  await adminDb.from('content_items').insert({
    id,
    campaign_id: s.campaignId,
    type: (formData.get('type') as ContentType) || 'social_post',
    title: String(formData.get('title') || 'Untitled'),
    body: String(formData.get('body') || ''),
    status: 'draft',
    is_ai_generated: formData.get('isAiGenerated') === 'on',
    target_jurisdictions: campaign.jurisdictions,
    created_by: s.userId,
  });
  redirect(`/content/${id}`);
}

export async function generateDraftAction(instruction: string, type: string) {
  const s = requireSession();
  const { CONTENT_COST_CENTS } = await import('@/lib/prompt');
  const { getCandidateProfile } = await import('@/lib/candidate');

  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) throw new Error('Campaign not found');

  const cost = CONTENT_COST_CENTS[type] ?? 5_00;
  await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, cost);
  const out = await contentGenerator.draft({
    instruction,
    type,
    candidateProfile: profile ?? undefined,
  });
  await usageMeter.record(s.campaignId, 'llm_tokens', 1, cost);
  return out;
}

export async function submitAction(id: string): Promise<Result> {
  const s = requireSession();
  const r = await guard(() => lifecycle.submitForReview(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}

export async function decideAction(id: string, decision: 'approve' | 'reject', note: string): Promise<Result> {
  const s = requireSession();
  const r = await guard(() =>
    decision === 'approve'
      ? lifecycle.approve(id, s.userId, note)
      : lifecycle.reject(id, s.userId, note));
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}

export async function attachDisclosureAction(id: string): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
  if (!item) return { ok: false, error: 'Content not found.' };
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
  const s = requireSession();
  const r = await guard(() => lifecycle.schedule(id, s.userId));
  revalidatePath(`/content/${id}`); revalidatePath('/');
  return r;
}

export async function publishAction(id: string, platforms: Platform[]): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
  if (!item) return { ok: false, error: 'Content not found.' };
  const disc = await disclosureRepo.listFor(id);
  const r = await guard(async () => {
    await lifecycle.markPublished(id, s.userId);
    await publisher.publish({
      platforms, text: item.body,
      disclosureText: disc[0]?.disclosureText ?? '',
      mediaUrl: item.mediaUrl ?? undefined,
    });
  });
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return r;
}

export async function setCapAction(formData: FormData): Promise<void> {
  const s = requireSession();
  const dollars = Number(formData.get('cap'));
  if (Number.isFinite(dollars) && dollars >= 0) {
    await adminDb.from('campaigns')
      .update({ monthly_cost_cap_cents: Math.round(dollars * 100) })
      .eq('id', s.campaignId);
  }
  revalidatePath('/settings');
}

// ── Video generation ──────────────────────────────────────────────────────────

export async function generateVideoAction(
  contentId: string,
  script: string,
  overrides?: { avatarId?: string; voiceId?: string; background?: string; aspectRatio?: '16:9' | '9:16' | '1:1' },
): Promise<Result & { videoId?: string }> {
  const s = requireSession();
  const { getCandidateProfile } = await import('@/lib/candidate');
  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  const VIDEO_COST_CENTS = 50_00;
  try {
    await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, VIDEO_COST_CENTS);
    const { videoId } = await videoProvider.generateAvatarVideo({
      script,
      avatarId: overrides?.avatarId ?? profile?.heygenAvatarId ?? undefined,
      voiceId: overrides?.voiceId ?? profile?.elevenLabsVoiceId ?? undefined,
      background: overrides?.background ?? profile?.videoBackground ?? 'plain',
      aspectRatio: overrides?.aspectRatio ?? profile?.videoAspectRatio ?? '16:9',
    });
    await usageMeter.record(s.campaignId, 'video_generation', 1, VIDEO_COST_CENTS);
    await adminDb.from('audit_entries').insert({
      campaign_id: s.campaignId, actor_user_id: s.userId,
      action: 'generate_video', entity_type: 'content_item', entity_id: contentId,
      details: { videoId },
    });
    return { ok: true, videoId };
  } catch (e) {
    if (e instanceof CapExceeded) return { ok: false, error: e.message };
    throw e;
  }
}

export async function getVideoStatusAction(videoId: string): Promise<{ status: string; url?: string }> {
  return videoProvider.getVideoStatus(videoId);
}

// ── Voice synthesis ───────────────────────────────────────────────────────────

export async function synthesizeVoiceAction(text: string): Promise<Result & { audioUrl?: string }> {
  const s = requireSession();
  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  try {
    await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, 20_00);
    const { audioUrl } = await voiceProvider.synthesize({ text });
    await usageMeter.record(s.campaignId, 'voice_synthesis', 1, 20_00);
    return { ok: true, audioUrl };
  } catch (e) {
    if (e instanceof CapExceeded) return { ok: false, error: e.message };
    throw e;
  }
}

// ── Wizard actions ────────────────────────────────────────────────────────────

export async function saveBodyAction(id: string, body: string): Promise<Result> {
  requireSession();
  await adminDb.from('content_items')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath(`/content/${id}`);
  return { ok: true };
}

export async function approveTextAction(id: string): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
  if (!item) return { ok: false, error: 'Content not found.' };

  await approvalRepo.add({
    contentItemId: id,
    campaignId: item.campaignId,
    approverUserId: s.userId,
    decision: 'approve',
  });

  let nextStatus: ContentStatus;
  if (VIDEO_CONTENT_TYPES.includes(item.type)) {
    nextStatus = 'in_review';
  } else if (item.isAiGenerated) {
    nextStatus = 'approved';
  } else {
    nextStatus = 'scheduled';
  }

  await adminDb.from('content_items')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', id);
  await auditRepo.append({
    campaignId: item.campaignId, actorUserId: s.userId,
    action: 'approve_text', entityType: 'content_item', entityId: id,
  });
  revalidatePath(`/content/${id}`); revalidatePath('/dashboard');
  return { ok: true };
}

export async function confirmVideoAction(id: string, videoUrl: string): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
  if (!item) return { ok: false, error: 'Content not found.' };
  const nextStatus: ContentStatus = item.isAiGenerated ? 'approved' : 'scheduled';
  await adminDb.from('content_items')
    .update({ status: nextStatus, media_url: videoUrl, updated_at: new Date().toISOString() })
    .eq('id', id);
  await auditRepo.append({
    campaignId: item.campaignId, actorUserId: s.userId,
    action: 'confirm_video', entityType: 'content_item', entityId: id,
    details: { videoUrl },
  });
  revalidatePath(`/content/${id}`);
  return { ok: true };
}

export async function generateFromMonitoringAction(
  monitoringResultId: string,
  contentType: string,
): Promise<Result & { contentId?: string }> {
  const s = requireSession();
  const { getCandidateProfile } = await import('@/lib/candidate');
  const { CONTENT_COST_CENTS } = await import('@/lib/prompt');

  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };

  const { data: result } = await adminDb
    .from('monitoring_results')
    .select('*')
    .eq('id', monitoringResultId)
    .single();
  if (!result) return { ok: false, error: 'Monitoring result not found.' };

  try {
    const cost = CONTENT_COST_CENTS[contentType] ?? 5_00;
    await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, cost);

    const instruction =
      `Respond to this news story${result.opponent ? ` about ${result.opponent}` : ''} on behalf of a political campaign.\n\n` +
      `Source: ${result.source}\n` +
      `Excerpt: "${result.excerpt}"\n` +
      (result.url ? `Article: ${result.url}\n` : '') +
      `\nWrite a ${contentType.replace('_', ' ')} that directly addresses this story. ` +
      `Be factual, on-message, and persuasive.`;

    const out = await contentGenerator.draft({ instruction, type: contentType, candidateProfile: profile ?? undefined });
    await usageMeter.record(s.campaignId, 'llm_tokens', 1, cost);

    const id = uid();
    await adminDb.from('content_items').insert({
      id,
      campaign_id: s.campaignId,
      type: contentType,
      title: out.title,
      body: out.text,
      status: 'draft',
      is_ai_generated: true,
      target_jurisdictions: campaign.jurisdictions,
      created_by: s.userId,
    });

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
    if (e instanceof CapExceeded) return { ok: false, error: e.message };
    throw e;
  }
}

export async function confirmDisclosureAction(id: string): Promise<Result> {
  const s = requireSession();
  const item = await contentRepo.get(id);
  if (!item) return { ok: false, error: 'Content not found.' };
  const required = await disclosureEngine.requiredFor(item.targetJurisdictions, item.isAiGenerated);
  for (const req of required) {
    await disclosureRepo.add({
      contentItemId: id,
      campaignId: s.campaignId,
      jurisdiction: req.jurisdiction,
      disclosureText: req.disclosureText,
      placement: req.placement,
    });
  }
  await adminDb.from('content_items')
    .update({ status: 'scheduled', updated_at: new Date().toISOString() })
    .eq('id', id);
  await auditRepo.append({
    campaignId: item.campaignId, actorUserId: s.userId,
    action: 'confirm_disclosure', entityType: 'content_item', entityId: id,
  });
  revalidatePath(`/content/${id}`);
  return { ok: true };
}

export async function dismissMonitoringAction(id: string): Promise<Result> {
  return guard(async () => {
    const s = requireSession();
    await adminDb.from('monitoring_results')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('campaign_id', s.campaignId);
    revalidatePath('/monitoring');
  });
}

export async function saveVideoSettingsAction(data: {
  heygenBaseAvatarId?: string | null;
  heygenAvatarId?: string | null;
  heygenLookId?: string | null;
  elevenLabsVoiceId?: string | null;
  videoAspectRatio?: '16:9' | '9:16' | '1:1';
  videoBackground?: string;
}): Promise<Result> {
  return guard(async () => {
    const s = requireSession();
    const { upsertCandidateProfile } = await import('@/lib/candidate');
    await upsertCandidateProfile(s.campaignId, data);
    revalidatePath('/settings');
  });
}

export async function uploadBackgroundAction(formData: FormData): Promise<Result & { url?: string }> {
  return guard(async () => {
    const s = requireSession();
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
    const s = requireSession();
    if (!scheduledAt) throw new GateError('Scheduled time is required');
    if (new Date(scheduledAt) <= new Date()) throw new GateError('Scheduled time must be in the future');

    await adminDb.from('content_items')
      .update({
        status: 'scheduled',
        scheduled_at: new Date(scheduledAt).toISOString(),
        timezone,
        platforms,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    await auditRepo.append({
      campaignId: s.campaignId,
      actorUserId: s.userId,
      action: 'schedule',
      entityType: 'content_item',
      entityId: id,
      details: { scheduledAt, timezone, platforms },
    });

    revalidatePath(`/content/${id}`);
  });
}
