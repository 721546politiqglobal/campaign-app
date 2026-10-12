'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getCampaign } from '@/lib/data';
import { adminDb } from '@/lib/supabase';
import { socialAccounts, MissingProviderKeyError } from '@/lib/services';
import { getCampaignSocialProfile, saveProfileKeyIfAbsent, saveSocialAccounts, replaceMockProfileKey } from '@/lib/channels';
import { CONNECTABLE_PLATFORMS, isSocialPlatform, type SocialAccount } from '@/domain/channels';
import { SocialAccountsError, MockSocialAccountsProvider } from '@/integrations/social-accounts';
import type { Platform } from '@/domain/types';

type Fail = { ok: false; error: string };
export type ChannelsResult = { ok: true; accounts: SocialAccount[] } | Fail;

async function audit(campaignId: string, userId: string, action: string, details: Record<string, unknown> = {}) {
  // Audit is best-effort here: never fail a user action because the log write did.
  try {
    const { error } = await adminDb.from('audit_entries').insert({
      campaign_id: campaignId, actor_user_id: userId, action,
      entity_type: 'campaign', entity_id: campaignId, details,
    });
    if (error) console.error('[channels] audit write failed', action, error);
  } catch (e) {
    console.error('[channels] audit write failed', action, e);
  }
}

function toFail(e: unknown, t: (k: string) => string): Fail {
  if (e instanceof MissingProviderKeyError) return { ok: false, error: t('notConfigured') };
  if (e instanceof SocialAccountsError) return { ok: false, error: t('serviceUnavailable') };
  throw e;
}

// A 'mock-' key left in the row by the dev Mock provider means nothing to
// Ayrshare; under the real provider it must be treated as no key at all.
function isStaleMockKey(key: string | null): boolean {
  return !!key && key.startsWith('mock-') && !(socialAccounts instanceof MockSocialAccountsProvider);
}

// Lazily create the campaign's Ayrshare profile on its first Connect, so the
// plan's 10 profiles go only to campaigns that actually connect.
async function ensureProfileKey(campaignId: string, userId: string): Promise<string> {
  const existing = await getCampaignSocialProfile(campaignId);
  const replacingMock = isStaleMockKey(existing.profileKey);
  if (existing.profileKey && !replacingMock) return existing.profileKey;
  const campaign = await getCampaign(campaignId);
  const name = campaign?.name ?? 'Campaign';
  let created: { profileKey: string; refId: string };
  try {
    created = await socialAccounts.createProfile({ title: `${name} · ${campaignId}`, displayName: name });
  } catch (e) {
    // Ayrshare rejects duplicate titles (code 146) and our title is unique per
    // campaign, so this means a concurrent click is creating/has created the profile.
    if (e instanceof SocialAccountsError && e.code === 146) {
      const winner = await getCampaignSocialProfile(campaignId);
      if (winner.profileKey && !isStaleMockKey(winner.profileKey)) return winner.profileKey;
      throw new SocialAccountsError('Profile setup already in progress', 409, 146);
    }
    throw e;
  }
  const won = replacingMock
    ? await replaceMockProfileKey(campaignId, created)
    : await saveProfileKeyIfAbsent(campaignId, created);
  if (won) {
    // The mock's pretend accounts don't exist on the new real profile.
    if (replacingMock) await saveSocialAccounts(campaignId, []);
    await audit(campaignId, userId, 'channels_profile_created', { refId: created.refId, replacedMockKey: replacingMock });
    return created.profileKey;
  }
  // A concurrent click stored its key first. Our profile is now orphaned; never use its key.
  await audit(campaignId, userId, 'channels_profile_orphaned', { refId: created.refId });
  const winner = await getCampaignSocialProfile(campaignId);
  if (!winner.profileKey || isStaleMockKey(winner.profileKey)) {
    throw new Error('campaigns.ayrshare_profile: stored key missing after lost race');
  }
  return winner.profileKey;
}

export async function startChannelLinkAction(): Promise<{ ok: true; url: string } | Fail> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.channels' });
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('permissionDenied') };
  // Ayrshare rejects a relative redirect, so refuse before creating anything.
  if (!process.env.NEXT_PUBLIC_SITE_URL) return { ok: false, error: t('notConfigured') };
  let profileKey: string;
  try {
    profileKey = await ensureProfileKey(s.campaignId, s.userId);
  } catch (e) {
    // 146 = a concurrent setup is still in flight; transient, not a setup failure.
    if (e instanceof SocialAccountsError && e.code === 146) return { ok: false, error: t('serviceUnavailable') };
    if (e instanceof SocialAccountsError) {
      await audit(s.campaignId, s.userId, 'channels_setup_failed', { status: e.status, code: e.code, message: e.message });
      return { ok: false, error: t('setupFailed') };
    }
    return toFail(e, t);
  }
  try {
    const { url } = await socialAccounts.createLinkUrl({
      profileKey,
      redirect: `${process.env.NEXT_PUBLIC_SITE_URL}/channels?linked=1`,
      platforms: [...CONNECTABLE_PLATFORMS],
    });
    await audit(s.campaignId, s.userId, 'channels_link_started');
    return { ok: true, url };
  } catch (e) {
    return toFail(e, t);
  }
}

export async function refreshChannelsAction(): Promise<ChannelsResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.channels' });
  const { profileKey, accounts } = await getCampaignSocialProfile(s.campaignId);
  if (!profileKey) return { ok: true, accounts };
  // Leftover mock key: nothing is really linked, and Ayrshare must never see it.
  if (isStaleMockKey(profileKey)) return { ok: true, accounts: [] };
  try {
    const fresh = await socialAccounts.getConnectedAccounts(profileKey);
    await saveSocialAccounts(s.campaignId, fresh);
    return { ok: true, accounts: fresh };
  } catch (e) {
    return toFail(e, t);
  }
}

export async function disconnectChannelAction(platform: Platform): Promise<ChannelsResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.channels' });
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('permissionDenied') };
  // Client-supplied: validate before it reaches Ayrshare.
  if (!isSocialPlatform(platform)) return { ok: false, error: t('unknownNetwork') };
  const { profileKey, accounts: previous } = await getCampaignSocialProfile(s.campaignId);
  if (!profileKey || isStaleMockKey(profileKey)) return { ok: true, accounts: [] };
  try {
    await socialAccounts.disconnect(profileKey, platform);
  } catch (e) {
    return toFail(e, t);
  }
  // Ayrshare returns 200 even when nothing was linked, so re-read for the
  // other networks' truth — but GET /user is cached for up to 60s and may
  // still list the one just removed. The DELETE succeeded, so drop it either
  // way; if the re-read fails, the stored snapshot minus it is still right.
  let accounts: SocialAccount[];
  try {
    accounts = (await socialAccounts.getConnectedAccounts(profileKey)).filter(a => a.platform !== platform);
  } catch (e) {
    console.error('[channels] re-read after disconnect failed', e);
    accounts = previous.filter(a => a.platform !== platform);
  }
  await saveSocialAccounts(s.campaignId, accounts);
  await audit(s.campaignId, s.userId, 'channels_disconnected', { platform });
  revalidatePath('/channels');
  return { ok: true, accounts };
}

// Dev-only: finishes the Mock provider's pretend linking page.
export async function completeMockLinkAction(): Promise<ChannelsResult> {
  const s = await requireSession();
  const t = await getTranslations({ locale: s.locale, namespace: 'errors.channels' });
  if (!can(s.role, 'edit_settings')) return { ok: false, error: t('permissionDenied') };
  if (process.env.NODE_ENV === 'production' || !(socialAccounts instanceof MockSocialAccountsProvider)) return { ok: false, error: t('notConfigured') };
  const { profileKey } = await getCampaignSocialProfile(s.campaignId);
  if (!profileKey) return { ok: true, accounts: [] };
  await socialAccounts.completeMockLink(profileKey);
  return refreshChannelsAction();
}
