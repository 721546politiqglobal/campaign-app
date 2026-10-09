// Public contact address used by the invite-only landing page ("Request
// access", "Contact", "Request a demo"). NEXT_PUBLIC_* is inlined at build
// time so this works in client components too. Falls back to the team inbox
// so a deployment without the variable still has a working CTA.
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'ceo@ivac.org';

export function mailto(subject?: string): string {
  return subject ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${CONTACT_EMAIL}`;
}
