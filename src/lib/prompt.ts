import type { CandidateProfile } from '@/domain/types';

export const PLATFORM_CONSTRAINTS: Record<string, string> = {
  social_post: 'Keep it under 280 characters for X/Twitter compatibility. Write naturally — only use hashtags if they feel organic.',
  social_post_instagram: 'Caption under 2,200 characters. End with 3–5 relevant hashtags on their own line.',
  email: 'First line must be: "Subject:" followed by your subject. Then a blank line, then the body with a greeting and a sign-off using the candidate\'s full name.',
  sms: 'Max 160 characters. No URLs. One direct call to action.',
  press_release: 'Write in third person. Structure: headline, dateline (City, State — Date), 3–4 body paragraphs, then a boilerplate paragraph about the candidate starting with "About" and the candidate\'s name.',
  talking_points: 'Output a bullet list of 5–7 points. Each point must be 1–2 sentences. Lead with the strongest point.',
  ad_copy: 'Punchy headline (max 8 words). Two supporting sentences. End with a clear CTA.',
  reel: 'Write a natural-sounding spoken script. No stage directions. Aim for 30–60 seconds at normal speaking pace (~130 words).',
};

export const CONTENT_COST_CENTS: Record<string, number> = {
  social_post:    3_00,
  sms:            2_00,
  talking_points: 5_00,
  email:          8_00,
  press_release:  12_00,
  ad_copy:        4_00,
  reel:           10_00,
};

export function buildCandidatePrompt(profile: CandidateProfile, contentType: string): string {
  const positions = profile.keyPositions.map(p => `• ${p}`).join('\n');
  const platformNote = PLATFORM_CONSTRAINTS[contentType] ?? '';
  const personNote = contentType === 'press_release'
    ? 'Write in THIRD PERSON — refer to the candidate by name, not as "I".'
    : 'Write in FIRST PERSON as the candidate.';

  return `You are a professional political communications expert.
You are writing on behalf of ${profile.preferredName} (full name: ${profile.fullName}).

CANDIDATE CONTEXT:
- Running for: ${profile.office}, ${profile.district}
- Party: ${profile.party}
- Bio: ${profile.bio}
- Key policy positions:
${positions}
- Campaign tagline: "${profile.tagline}"
- Target audience: ${profile.targetAudience}
- Voice and tone: ${profile.voiceTone}
${profile.opponentName ? `- Primary opponent: ${profile.opponentName}` : ''}

RULES:
- ${personNote}
- Never invent facts or policy positions not listed above.
- Never use placeholder text like name templates or district placeholders.
- Use the actual candidate name, office, and district from this context.
${platformNote ? `- Format requirements: ${platformNote}` : ''}`;
}
