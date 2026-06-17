'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSession, signInAs, signOut } from '@/lib/session';
import { adminDb } from '@/lib/supabase';
import { uid } from '@/lib/store';
import { getCampaign } from '@/lib/data';
import { lifecycle, disclosureEngine, usageMeter, contentGenerator, publisher, videoProvider, voiceProvider } from '@/lib/services';
import { contentRepo, disclosureRepo } from '@/lib/repos';
import { ContentType, Platform } from '@/domain/types';
import { GateError } from '@/domain/content-lifecycle';
import { CapExceeded } from '@/domain/usage';

type Result = { ok: true } | { ok: false; error: string };

function guard<T>(fn: () => Promise<T>): Promise<Result> {
  return fn().then(() => ({ ok: true as const })).catch((e: unknown) => {
    if (e instanceof GateError || e instanceof CapExceeded) return { ok: false as const, error: e.message };
    throw e;
  });
}

export async function loginAction(formData: FormData) {
  const { cookies } = await import('next/headers');
  const userId = String(formData.get('userId'));
  const { data: user } = await adminDb.from('users').select('*').eq('id', userId).single();
  if (user) {
    cookies().set('session', JSON.stringify({
      userId: user.id,
      name: user.name,
      role: user.role,
      campaignId: user.campaign_id,
    }), { httpOnly: true, sameSite: 'lax', path: '/' });
  }
  if (user?.role === 'super_admin') redirect('/admin');
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
  const campaign = await getCampaign(s.campaignId);
  if (!campaign) throw new Error('Campaign not found');
  await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, 9_00);
  const out = await contentGenerator.draft({ instruction, type });
  await usageMeter.record(s.campaignId, 'llm_tokens', 1, 9_00);
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
      ? lifecycle.approve(id, s.userId, s.role, note)
      : lifecycle.reject(id, s.userId, s.role, note));
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

export async function generateVideoAction(contentId: string, script: string): Promise<Result & { videoId?: string }> {
  const s = requireSession();
  const campaign = await getCampaign(s.campaignId);
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  try {
    await usageMeter.guard(s.campaignId, campaign.monthlyCostCapCents, 100_00);
    const { videoId } = await videoProvider.generateAvatarVideo({ script });
    await usageMeter.record(s.campaignId, 'video_generation', 1, 100_00);
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
