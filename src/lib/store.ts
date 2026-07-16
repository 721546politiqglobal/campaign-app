// Thin id helpers used by actions and API routes.
// All data now lives in Supabase — see src/lib/data.ts and src/lib/repos.ts.
import { randomUUID, randomBytes } from 'node:crypto';

// Primary keys. UUIDv4 — collision-resistant and unguessable, unlike the old
// 8-char Math.random() ids (audit finding DATA-14).
export const uid = (): string => randomUUID();

// Human-scannable ids that keep a readable prefix (e.g. 'camp-', 'u-', 'av-').
export const prefixedId = (prefix: string): string => `${prefix}${randomUUID()}`;

// Invite codes must be unguessable — they authorize joining a campaign.
// 18 random bytes → 24 URL-safe chars, ~144 bits of entropy.
export const inviteCode = (): string => `inv_${randomBytes(18).toString('base64url')}`;
