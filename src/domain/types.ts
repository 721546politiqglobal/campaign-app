export type ContentStatus =
  | 'draft' | 'in_review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'rejected' | 'archived';

export type Role = 'owner' | 'manager' | 'staff' | 'approver' | 'super_admin';

export type Platform = 'instagram' | 'facebook' | 'x' | 'linkedin' | 'tiktok' | 'youtube';

export type ContentType =
  | 'reel' | 'social_post' | 'press_release' | 'ad_copy' | 'talking_points';

export const VIDEO_CONTENT_TYPES: ContentType[] = ['reel'];

// Instagram and TikTok reject a post with no image/video attached — unlike
// Facebook, X, and LinkedIn, they don't support text-only posts.
export const MEDIA_REQUIRED_PLATFORMS: Platform[] = ['instagram', 'tiktok'];

export function platformsMissingRequiredMedia(platforms: Platform[], hasMedia: boolean): Platform[] {
  if (hasMedia) return [];
  return platforms.filter(p => MEDIA_REQUIRED_PLATFORMS.includes(p));
}

// Single source of truth for valid content types at runtime — used to reject
// client-supplied values before they hit the DB (audit finding DATA-16).
export const CONTENT_TYPES: readonly ContentType[] =
  ['reel', 'social_post', 'press_release', 'ad_copy', 'talking_points'] as const;

export function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

export interface ContentItem {
  id: string;
  campaignId: string;
  type: ContentType;
  title: string;
  body: string;
  status: ContentStatus;
  isAiGenerated: boolean;
  targetJurisdictions: string[];
  mediaUrl?: string | null;
  videoJobId?: string | null;
  videoStatus?: 'processing' | 'completed' | 'failed' | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  contentItemId: string;
  campaignId: string;
  approverUserId: string;
  decision: 'approve' | 'reject';
  note?: string;
  createdAt: string;
}

export interface DisclosureRecord {
  id: string;
  contentItemId: string;
  campaignId: string;
  disclosureText: string;
  placement: string;
  appliedAt: string;
}

export interface AuditEntry {
  id: string;
  campaignId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface ContentRepo {
  get(id: string): Promise<ContentItem | null>;
  setStatus(id: string, status: ContentStatus): Promise<void>;
}
export interface ApprovalRepo {
  add(rec: Omit<ApprovalRecord, 'id' | 'createdAt'>): Promise<void>;
  hasApproval(contentItemId: string): Promise<boolean>;
}
export interface DisclosureRepo {
  add(rec: Omit<DisclosureRecord, 'id' | 'appliedAt'>): Promise<void>;
  listFor(contentItemId: string): Promise<DisclosureRecord[]>;
}
export interface AuditRepo {
  append(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void>;
}

export type VoiceTone = 'formal' | 'conversational' | 'urgent' | 'inspirational';

export type AvatarStatus = 'pending_consent' | 'training' | 'ready' | 'failed';
export type AvatarSourceType = 'photo' | 'digital_twin';
export type AvatarConsentStatus = 'pending' | 'approved' | 'declined';

export interface Avatar {
  id: string;
  campaignId: string;
  name: string;
  status: AvatarStatus;
  sourceType: AvatarSourceType;
  heygenGroupId?: string | null;
  heygenLookId?: string | null;
  sourcePhotoUrls: string[];
  sourceVideoUrl?: string | null;
  consentStatus?: AvatarConsentStatus | null;
  consentUrl?: string | null;
  errorMessage?: string | null;
  consentConfirmedBy: string;
  consentConfirmedAt: string;
  createdBy: string;
  createdAt: string;
}

export interface CandidateProfile {
  id: string;
  campaignId: string;
  fullName: string;
  preferredName: string;
  office: string;
  district: string;
  party: string;
  bio: string;
  keyPositions: string[];
  voiceTone: VoiceTone;
  targetAudience: string;
  tagline: string;
  photoUrl?: string | null;
  opponentName?: string | null;
  opponentAliases: string[];
  monitoringKeywords: string[];
  opponentTwitterHandle?: string | null;
  opponentInstagramHandle?: string | null;
  opponentFacebookPage?: string | null;
  googleAlertsRssUrl?: string | null;
  heygenBaseAvatarId?: string | null;
  heygenAvatarId?: string | null;
  activeAvatarId?: string | null;
  elevenLabsVoiceId?: string | null;
  heygenVoiceId?: string | null;
  selfVoiceCloneId?: string | null;
  selfVoiceName?: string | null;
  selfVoiceCloneStatus?: 'training' | 'ready' | 'failed' | null;
  selfVoiceCloneError?: string | null;
  selfVoiceConsentConfirmedBy?: string | null;
  selfVoiceConsentConfirmedAt?: string | null;
  videoAspectRatio: '16:9' | '9:16' | '1:1';
  videoBackground: string;
  createdAt: string;
  updatedAt: string;
}
