// Server-only access to a campaign's Ayrshare profile and connected-account
// snapshot. The profile key is a credential: nothing here is ever passed to a
// client component — callers pass `accounts` only.
import { adminDb, throwOnError } from './supabase';
import { isSocialPlatform, type SocialAccount } from '@/domain/channels';

export type CampaignSocialProfile = {
  profileKey: string | null;
  accounts: SocialAccount[];
  syncedAt: string | null;
};

function parseAccounts(raw: unknown): SocialAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is SocialAccount =>
    !!a && typeof a === 'object' && isSocialPlatform((a as SocialAccount).platform)
    && typeof (a as SocialAccount).name === 'string');
}

export async function getCampaignSocialProfile(campaignId: string): Promise<CampaignSocialProfile> {
  const { data, error } = await adminDb.from('campaigns')
    .select('ayrshare_profile_key, social_accounts, social_synced_at')
    .eq('id', campaignId).single();
  // PGRST116 = no row. Any other error must surface: reading it as "no key"
  // would let a later Connect create a second paid Ayrshare profile.
  if (error && error.code !== 'PGRST116') {
    throw new Error(`campaigns.social_profile: ${error.message}`);
  }
  if (!data) return { profileKey: null, accounts: [], syncedAt: null };
  return {
    profileKey: (data.ayrshare_profile_key as string | null) ?? null,
    accounts: parseAccounts(data.social_accounts),
    syncedAt: (data.social_synced_at as string | null) ?? null,
  };
}

// Conditional on no key being stored yet, so two concurrent first-Connect
// clicks can't both persist a profile; returns false for the loser.
export async function saveProfileKeyIfAbsent(
  campaignId: string,
  p: { profileKey: string; refId: string },
): Promise<boolean> {
  const rows = await throwOnError(
    adminDb.from('campaigns')
      .update({ ayrshare_profile_key: p.profileKey, ayrshare_ref_id: p.refId })
      .eq('id', campaignId)
      .is('ayrshare_profile_key', null)
      .select('id'),
    'campaigns.ayrshare_profile',
  );
  return Array.isArray(rows) && rows.length > 0;
}

// Swap a leftover dev/mock key for a real one. Conditional on the stored key
// still being a mock key, so a real key stored by a concurrent click survives;
// returns false for the loser.
export async function replaceMockProfileKey(
  campaignId: string,
  p: { profileKey: string; refId: string },
): Promise<boolean> {
  const rows = await throwOnError(
    adminDb.from('campaigns')
      .update({ ayrshare_profile_key: p.profileKey, ayrshare_ref_id: p.refId })
      .eq('id', campaignId)
      .like('ayrshare_profile_key', 'mock-%')
      .select('id'),
    'campaigns.ayrshare_profile',
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function saveSocialAccounts(campaignId: string, accounts: SocialAccount[]): Promise<void> {
  await throwOnError(
    adminDb.from('campaigns')
      .update({ social_accounts: accounts, social_synced_at: new Date().toISOString() })
      .eq('id', campaignId),
    'campaigns.social_accounts',
  );
}
