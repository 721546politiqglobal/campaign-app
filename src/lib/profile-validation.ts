export const PARTIES = ['Democratic', 'Republican', 'Independent', 'Green', 'Libertarian', 'Other'] as const;
const TONES = ['formal', 'conversational', 'urgent', 'inspirational'];

export interface ProfileInput {
  fullName: string; preferredName: string; office: string; district: string;
  party: string; bio: string; tagline: string; targetAudience: string;
  voiceTone: string; googleAlertsRssUrl?: string; photoUrl?: string;
}

type Result = { ok: true } | { ok: false; errors: Record<string, string> };

function isHttpUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

export function validateCandidateProfile(input: ProfileInput): Result {
  const errors: Record<string, string> = {};
  const required: [keyof ProfileInput, string][] = [
    ['fullName', 'Full name is required.'],
    ['preferredName', 'Preferred name is required.'],
    ['office', 'The office you are running for is required.'],
    ['district', 'District is required.'],
  ];
  for (const [field, msg] of required) {
    if (!String(input[field] ?? '').trim()) errors[field] = msg;
  }
  const max: [keyof ProfileInput, number][] = [
    ['fullName', 120], ['preferredName', 120], ['office', 120], ['district', 120],
    ['bio', 600], ['tagline', 160], ['targetAudience', 200],
  ];
  for (const [field, limit] of max) {
    if (String(input[field] ?? '').length > limit) errors[field] = `Keep this under ${limit} characters.`;
  }
  if (input.party && !PARTIES.some(p => p.toLowerCase() === input.party.trim().toLowerCase())) {
    errors.party = 'Choose a party from the list.';
  }
  if (!TONES.includes(input.voiceTone)) errors.voiceTone = 'Pick a valid voice tone.';
  if (input.googleAlertsRssUrl && !isHttpUrl(input.googleAlertsRssUrl)) {
    errors.googleAlertsRssUrl = 'Enter a valid http(s) URL.';
  }
  if (input.photoUrl && !isHttpUrl(input.photoUrl)) errors.photoUrl = 'Enter a valid http(s) URL.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}
