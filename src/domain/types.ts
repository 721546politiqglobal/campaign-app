export type ContentStatus =
  | 'draft' | 'in_review' | 'approved' | 'scheduled' | 'published' | 'rejected' | 'archived';

export type Role = 'owner' | 'manager' | 'staff' | 'approver' | 'super_admin';

export type Platform = 'instagram' | 'facebook' | 'x' | 'linkedin' | 'tiktok' | 'youtube';

export type ContentType =
  | 'reel' | 'social_post' | 'press_release' | 'ad_copy' | 'talking_points';

export const VIDEO_CONTENT_TYPES: ContentType[] = ['reel'];

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
  jurisdiction: string;
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

export type AvatarStatus = 'training' | 'ready' | 'failed';

export interface Avatar {
  id: string;
  campaignId: string;
  name: string;
  status: AvatarStatus;
  heygenGroupId?: string | null;
  heygenLookId?: string | null;
  sourcePhotoUrls: string[];
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
  heygenBaseAvatarId?: string | null;
  heygenAvatarId?: string | null;
  activeAvatarId?: string | null;
  elevenLabsVoiceId?: string | null;
  videoAspectRatio: '16:9' | '9:16' | '1:1';
  videoBackground: string;
  createdAt: string;
  updatedAt: string;
}
