// Each adapter checks for its env key at instantiation time.
// Add the key → the real service activates automatically.

import Anthropic from '@anthropic-ai/sdk';
import { Platform } from '@/domain/types';

export type { Platform };

// ── Interfaces ────────────────────────────────────────────────────────────────

import type { CandidateProfile } from '@/domain/types';

export interface ContentGenerator {
  draft(input: {
    instruction: string;
    type: string;
    audience?: string;
    candidateProfile?: CandidateProfile;
  }): Promise<{ text: string; title: string }>;
}

export interface VideoProvider {
  generateAvatarVideo(input: {
    script: string;
    avatarId?: string;
    voiceId?: string;
    background?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
  }): Promise<{ videoId: string; url?: string }>;
  getVideoStatus(videoId: string): Promise<{ status: 'processing' | 'completed' | 'failed'; url?: string }>;
}

export interface VoiceProvider {
  synthesize(input: { text: string; voiceId?: string }): Promise<{ audioUrl: string }>;
}

export interface PhotoAvatarProvider {
  uploadAsset(buffer: Buffer, contentType: string): Promise<{ assetId: string }>;
  createAvatarLook(input: { name: string; assetId: string; avatarGroupId?: string }):
    Promise<{ lookId: string; groupId: string }>;
  createPromptLook(input: { name: string; prompt: string; avatarId: string }):
    Promise<{ lookId: string; groupId: string }>;
  getAvatarGroupStatus(groupId: string): Promise<{
    status: 'processing' | 'pending_consent' | 'completed' | 'failed';
    previewImageUrl?: string;
    error?: { code: string; message: string };
  }>;
}

export interface Publisher {
  publish(input: { platforms: Platform[]; text: string; disclosureText: string; mediaUrl?: string }):
    Promise<{ platform: Platform; status: 'scheduled' | 'failed'; error?: string }[]>;
}

export interface MonitoringSource {
  poll(input: { keywords: string[]; opponents: string[] }):
    Promise<{ source: string; opponent?: string; excerpt: string; url: string }[]>;
}

// ── Claude content generator ──────────────────────────────────────────────────

export class ClaudeContentGenerator implements ContentGenerator {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async draft({ instruction, type, candidateProfile }: {
    instruction: string;
    type: string;
    audience?: string;
    candidateProfile?: CandidateProfile;
  }) {
    const { buildCandidatePrompt } = await import('@/lib/prompt');

    const systemPrompt = candidateProfile
      ? buildCandidatePrompt(candidateProfile, type)
      : 'You are a professional political campaign copywriter. Write factual, persuasive campaign content.';

    const msg = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Content type: ${type}
Brief: ${instruction}

Write the content now. Start with "Title: [your title here]" on the first line, then a blank line, then the body.`,
      }],
    });

    const block = msg.content[0];
    if (!block || block.type !== 'text') {
      // e.g. stop_reason 'refusal' returns an empty content array — the API
      // call still happened (and was billed) even though there's no usable text.
      throw new Error(`Claude returned no usable text (stop_reason: ${msg.stop_reason ?? 'unknown'}).`);
    }
    const raw = block.text;
    const lines = raw.split('\n');
    const titleLine = lines.find(l => l.toLowerCase().startsWith('title:'));
    const title = titleLine ? titleLine.replace(/^title:\s*/i, '').trim() : instruction.slice(0, 60);
    const body = lines.filter(l => !l.toLowerCase().startsWith('title:')).join('\n').trim();
    return { title, text: body };
  }
}

// ── HeyGen video provider ─────────────────────────────────────────────────────

export class HeyGenVideoProvider implements VideoProvider {
  constructor(private apiKey: string) {}

  async generateAvatarVideo({ script, avatarId, voiceId, background, aspectRatio }: {
    script: string; avatarId?: string; voiceId?: string; background?: string; aspectRatio?: '16:9' | '9:16' | '1:1';
  }) {
    const DIMENSIONS: Record<string, { width: number; height: number }> = {
      '16:9': { width: 1280, height: 720 },
      '9:16': { width: 720, height: 1280 },
      '1:1':  { width: 720, height: 720 },
    };
    const dimension = DIMENSIONS[aspectRatio ?? '16:9'] ?? { width: 1280, height: 720 };

    const bgConfig: Record<string, string> = background?.startsWith('http')
      ? { type: 'image', url: background }
      : { type: 'color', value: (!background || background === 'plain') ? '#FFFFFF' : background };

    const res = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_inputs: [{
          character: {
            type: 'avatar',
            avatar_id: avatarId ?? process.env.HEYGEN_AVATAR_ID ?? '',
            avatar_style: 'normal',
          },
          voice: {
            type: 'text',
            input_text: script,
            // No global HEYGEN_VOICE_ID fallback — the caller guarantees a
            // per-campaign voice id (INT-7); refuse rather than narrate with a
            // shared/absent voice.
            voice_id: voiceId ?? (() => { throw new Error('HeyGen voice_id is required.'); })(),
          },
          background: bgConfig,
        }],
        dimension,
      }),
    });
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) throw new Error(`HeyGen error: ${(json as { message?: string }).message ?? res.status}`);
    const videoId = (json as { data?: { video_id?: string } }).data?.video_id;
    if (!videoId) throw new Error('HeyGen did not return a video id.');
    return { videoId, url: undefined };
  }

  async getVideoStatus(videoId: string) {
    const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    // A 401/404/429/5xx is a real error, not "still working" — never let it
    // masquerade as processing or the client polls forever (INT-4).
    if (!res.ok) return { status: 'failed' as const };
    const json = await res.json().catch(() => null);
    const status = json?.data?.status;
    if (status === 'completed') return { status: 'completed' as const, url: json.data.video_url };
    if (status === 'processing' || status === 'pending' || status === 'waiting') return { status: 'processing' as const };
    if (status === 'failed') return { status: 'failed' as const };
    // Unknown / missing status: fail rather than spin indefinitely.
    return { status: 'failed' as const };
  }
}

// ── HeyGen photo avatar provider (v3 API) ─────────────────────────────────────
// Legacy v1/v2 (used by HeyGenVideoProvider above for rendering) sunsets
// 2026-10-31 — this provider targets v3 only, which fully covers avatar
// creation. v3 has no separate "train" step: training starts automatically
// and asynchronously inside createAvatarLook; readiness comes from polling
// getAvatarGroupStatus.

export class HeyGenPhotoAvatarProvider implements PhotoAvatarProvider {
  constructor(private apiKey: string) {}

  async uploadAsset(buffer: Buffer, contentType: string) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), 'photo');
    const res = await fetch('https://api.heygen.com/v3/assets', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey },
      body: form,
    });
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) throw new Error(`HeyGen upload error: ${(json as { error?: { message?: string } }).error?.message ?? res.status}`);
    const assetId = (json as { data?: { asset_id?: string } }).data?.asset_id;
    if (!assetId) throw new Error('HeyGen did not return an asset id.');
    return { assetId };
  }

  async createAvatarLook({ name, assetId, avatarGroupId }: { name: string; assetId: string; avatarGroupId?: string }) {
    const res = await fetch('https://api.heygen.com/v3/avatars', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'photo',
        name,
        file: { type: 'asset_id', asset_id: assetId },
        ...(avatarGroupId && { avatar_group_id: avatarGroupId }),
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen create avatar error: ${json.error?.message ?? res.status}`);
    const lookId = json.data?.avatar_item?.id;
    const groupId = json.data?.avatar_group?.id ?? json.data?.avatar_item?.group_id;
    if (!lookId || !groupId) throw new Error('HeyGen did not return a look/group id.');
    return { lookId, groupId };
  }

  // Generates a new styled look from an EXISTING trained look, preserving the
  // real person's identity — `avatarId` must be a look id (avatar_item.id),
  // not a group id, or HeyGen won't have a visual reference to condition on
  // (avatar_group_id alone stopped conditioning generation as of a June 2026
  // breaking change on HeyGen's side). Omitting avatar_group_id here is
  // intentional: passing avatar_id alone auto-saves the new look into that
  // look's own group, which is exactly the group we want it in.
  async createPromptLook({ name, prompt, avatarId }: { name: string; prompt: string; avatarId: string }) {
    const res = await fetch('https://api.heygen.com/v3/avatars', {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'prompt', name, prompt, avatar_id: avatarId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen generate look error: ${json.error?.message ?? res.status}`);
    const lookId = json.data?.avatar_item?.id;
    const groupId = json.data?.avatar_group?.id ?? json.data?.avatar_item?.group_id;
    if (!lookId || !groupId) throw new Error('HeyGen did not return a look/group id.');
    return { lookId, groupId };
  }

  // Deliberately polls GET /v3/avatars/{id} (the single-resource endpoint),
  // not GET /v3/avatars/looks?group_id=... — empirically verified the looks-list
  // endpoint returns an empty array even for a group HeyGen itself reports as
  // "completed" with a nonzero looks_count. The single-resource endpoint's
  // top-level `status` is the reliable signal.
  async getAvatarGroupStatus(groupId: string) {
    const res = await fetch(`https://api.heygen.com/v3/avatars/${encodeURIComponent(groupId)}`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`HeyGen get avatar error: ${json.error?.message ?? res.status}`);
    // Validate against the known set — an unrecognized HeyGen status must not
    // be cast straight through, or an avatar strands in "training" forever (INT-14).
    const raw = json.data?.status;
    const KNOWN = ['processing', 'pending_consent', 'completed', 'failed'] as const;
    const status = (KNOWN as readonly string[]).includes(raw) ? raw as typeof KNOWN[number] : 'failed';
    return {
      status,
      previewImageUrl: json.data?.preview_image_url,
      error: json.data?.error,
    };
  }
}

// ── ElevenLabs voice provider ─────────────────────────────────────────────────

export class ElevenLabsVoiceProvider implements VoiceProvider {
  constructor(private apiKey: string) {}

  async synthesize({ text, voiceId }: { text: string; voiceId?: string }) {
    // No hardcoded stock-voice fallback — the only sources are the per-request
    // voiceId or the operator's ELEVENLABS_VOICE_ID (INT-6).
    const vid = voiceId ?? process.env.ELEVENLABS_VOICE_ID;
    if (!vid) throw new Error('No ElevenLabs voice id configured for this request.');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs error: ${res.status}`);
    // Upload the audio blob to Supabase Storage and return a public URL.
    const buffer = Buffer.from(await res.arrayBuffer());
    const { createClient } = await import('@supabase/supabase-js');
    const storage = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const filename = `voice/${Date.now()}.mp3`;
    // Check the upload error instead of fabricating a URL to a file that may
    // not exist and billing for a dead link (INT-8).
    const { error: uploadError } = await storage.storage.from('media').upload(filename, buffer, { contentType: 'audio/mpeg' });
    if (uploadError) throw new Error(`Voice upload failed: ${uploadError.message}`);
    const { data } = storage.storage.from('media').getPublicUrl(filename);
    return { audioUrl: data.publicUrl };
  }
}

// ── Ayrshare publisher ────────────────────────────────────────────────────────

const PLATFORM_MAP: Record<Platform, string> = {
  instagram: 'instagram', facebook: 'facebook', x: 'twitter',
  linkedin: 'linkedin', tiktok: 'tiktok', youtube: 'youtube',
};

export class AyrsharePublisher implements Publisher {
  constructor(private apiKey: string) {}

  async publish({ platforms, text, disclosureText, mediaUrl }: {
    platforms: Platform[]; text: string; disclosureText: string; mediaUrl?: string;
  }) {
    const post = disclosureText ? `${text}\n\n${disclosureText}` : text;
    const results: { platform: Platform; status: 'scheduled' | 'failed'; error?: string }[] = [];

    for (const platform of platforms) {
      try {
        const body: Record<string, unknown> = {
          post,
          platforms: [PLATFORM_MAP[platform]],
        };
        if (mediaUrl) body.mediaUrls = [mediaUrl];

        const res = await fetch('https://app.ayrshare.com/api/post', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) {
          results.push({ platform, status: 'failed', error: json.message ?? `HTTP ${res.status}` });
        } else {
          results.push({ platform, status: 'scheduled' });
        }
      } catch (e) {
        results.push({ platform, status: 'failed', error: String(e) });
      }
    }
    return results;
  }
}

// ── NewsData monitoring source ────────────────────────────────────────────────

export class NewsDataMonitoringSource implements MonitoringSource {
  constructor(private apiKey: string) {}

  async poll({ keywords, opponents }: { keywords: string[]; opponents: string[] }) {
    const query = [...keywords, ...opponents].slice(0, 5).join(' OR ');
    const url = `https://newsdata.io/api/1/news?apikey=${this.apiKey}&q=${encodeURIComponent(query)}&language=en&country=us`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) throw new Error(`NewsData error: ${json.message ?? res.status}`);

    return (json.results ?? []).slice(0, 20).map((a: Record<string, unknown>) => ({
      source: (a.source_id as string) ?? 'NewsData',
      opponent: opponents.find(o => String(a.title ?? '').toLowerCase().includes(o.toLowerCase())),
      excerpt: (a.description as string) ?? (a.title as string) ?? '',
      url: (a.link as string) ?? '',
    }));
  }
}

// ── Mock implementations (used when no API key is present) ───────────────────

export class MockContentGenerator implements ContentGenerator {
  async draft({ instruction, type }: { instruction: string; type: string; candidateProfile?: CandidateProfile }) {
    const title = instruction.replace(/^(make|write|draft)\s+(a|an)?\s*/i, '').slice(0, 60) || 'Untitled draft';
    const text =
      `Here's how our plan answers what voters told us matters most.\n\n` +
      `${instruction.trim()}\n\n` +
      `We'll keep costs down, protect what works, and fix what doesn't. ` +
      `Read the full proposal and tell us what you think.`;
    return { title: title[0].toUpperCase() + title.slice(1), text };
  }
}

export class MockPublisher implements Publisher {
  async publish({ platforms }: { platforms: Platform[] }) {
    return platforms.map(p => ({ platform: p, status: 'scheduled' as const }));
  }
}

export class MockVideoProvider implements VideoProvider {
  async generateAvatarVideo(_input: { script: string; avatarId?: string; voiceId?: string; background?: string; aspectRatio?: '16:9' | '9:16' | '1:1' }) {
    return { videoId: 'mock-video-id' };
  }
  async getVideoStatus() { return { status: 'completed' as const, url: 'https://example.com/demo-video.mp4' }; }
}

export class MockVoiceProvider implements VoiceProvider {
  async synthesize() { return { audioUrl: 'https://example.com/demo-audio.mp3' }; }
}

export class MockPhotoAvatarProvider implements PhotoAvatarProvider {
  async uploadAsset(_buffer: Buffer, _contentType: string) { return { assetId: 'mock-asset-id' }; }
  async createAvatarLook(_input: { name: string; assetId: string; avatarGroupId?: string }) { return { lookId: 'mock-look-id', groupId: 'mock-group-id' }; }
  async createPromptLook(_input: { name: string; prompt: string; avatarId: string }) { return { lookId: 'mock-prompt-look-id', groupId: 'mock-group-id' }; }
  async getAvatarGroupStatus(_groupId: string) {
    return { status: 'completed' as const, previewImageUrl: 'https://example.com/mock-avatar.jpg' };
  }
}

export class MockMonitoringSource implements MonitoringSource {
  async poll() { return []; }
}
