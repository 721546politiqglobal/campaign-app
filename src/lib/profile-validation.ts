import { SUPPORTED_LOCALES } from './locale-shared';

export const PARTIES = ['Democratic', 'Republican', 'Independent', 'Green', 'Libertarian', 'Other'] as const;
const TONES = ['formal', 'conversational', 'urgent', 'inspirational'];
// Exported so forms can render translated "keep this under N characters"
// messages that agree with the rule enforced here.
export const PROFILE_MAX_LENGTHS = {
  fullName: 120, preferredName: 120, office: 120, district: 120,
  bio: 600, tagline: 160, targetAudience: 200,
} as const;

/** Fields a profile can't be saved without — forms use this for translated "required" messages. */
export const PROFILE_REQUIRED_FIELDS = ['fullName', 'preferredName', 'office', 'district'] as const;

export interface ProfileInput {
  fullName: string; preferredName: string; office: string; district: string;
  party: string; bio: string; tagline: string; targetAudience: string;
  voiceTone: string; googleAlertsRssUrl?: string; photoUrl?: string;
  contentLocale?: string;
}

type Result = { ok: true } | { ok: false; errors: Record<string, string> };

function isHttpUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

export function validateCandidateProfile(input: ProfileInput): Result {
  const errors: Record<string, string> = {};
  const requiredMessages: Record<(typeof PROFILE_REQUIRED_FIELDS)[number], string> = {
    fullName: 'Full name is required.',
    preferredName: 'Preferred name is required.',
    office: 'The office you are running for is required.',
    district: 'District is required.',
  };
  for (const field of PROFILE_REQUIRED_FIELDS) {
    if (!String(input[field] ?? '').trim()) errors[field] = requiredMessages[field];
  }
  for (const [field, limit] of Object.entries(PROFILE_MAX_LENGTHS) as [keyof ProfileInput, number][]) {
    if (String(input[field] ?? '').length > limit) errors[field] = `Keep this under ${limit} characters.`;
  }
  if (input.party && !PARTIES.some(p => p.toLowerCase() === input.party.trim().toLowerCase())) {
    errors.party = 'Choose a party from the list.';
  }
  if (input.contentLocale && !(SUPPORTED_LOCALES as readonly string[]).includes(input.contentLocale)) {
    errors.contentLocale = 'Choose a supported content language.';
  }
  if (!TONES.includes(input.voiceTone)) errors.voiceTone = 'Pick a valid voice tone.';
  if (input.googleAlertsRssUrl && !isHttpUrl(input.googleAlertsRssUrl)) {
    errors.googleAlertsRssUrl = 'Enter a valid http(s) URL.';
  }
  if (input.photoUrl && !isHttpUrl(input.photoUrl)) errors.photoUrl = 'Enter a valid http(s) URL.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}
