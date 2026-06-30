'use client';

import { useState, useEffect, useRef } from 'react';
import { saveVideoSettingsAction, uploadBackgroundAction } from '@/app/actions';
import { useToast } from '@/components/Toast';

interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  gender?: string;
  preview_image_url?: string;
  preview_video_url?: string;
  look_id?: string;
}

const ASPECT_RATIOS = [
  { id: '16:9' as const, label: '16:9', sub: 'YouTube · LinkedIn' },
  { id: '9:16' as const, label: '9:16', sub: 'Reels · TikTok' },
  { id: '1:1'  as const, label: '1:1',  sub: 'Facebook · X' },
];

export function AvatarLibrary({
  baseAvatarId,
  currentAvatarId,
  currentBackground,
  currentAspectRatio,
  role,
}: {
  baseAvatarId?: string | null;
  currentAvatarId?: string | null;
  currentBackground?: string;
  currentAspectRatio?: string;
  role?: string;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [looks, setLooks]       = useState<HeyGenAvatar[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [uploading, setUploading] = useState(false);

  const [selectedLookId, setSelectedLookId] = useState(currentAvatarId ?? '');
  const [selectedRatio,  setSelectedRatio]  = useState<'16:9' | '9:16' | '1:1'>(
    (currentAspectRatio as '16:9' | '9:16' | '1:1') ?? '16:9'
  );
  // Only treat stored value as a URL if it actually looks like one
  const [bgUrl, setBgUrl] = useState(
    currentBackground?.startsWith('http') ? currentBackground : ''
  );

  // Admin: setting the base avatar ID
  void role; // passed from settings but avatar assignment now lives in /admin/campaigns/[id]

  useEffect(() => {
    if (!baseAvatarId) return;
    setLoading(true);
    fetch(`/api/heygen/avatars?baseId=${encodeURIComponent(baseAvatarId)}`)
      .then(r => r.json())
      .then(d => setLooks(d.avatars ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [baseAvatarId]);

  async function handleSaveLook() {
    const selected = looks.find(l => l.avatar_id === selectedLookId) ?? looks[0];
    setSaving(true);
    const result = await saveVideoSettingsAction({
      heygenAvatarId: selected?.avatar_id ?? null,
      heygenLookId:   selected?.look_id   ?? null,
      videoBackground:  bgUrl || undefined,
      videoAspectRatio: selectedRatio,
    });
    setSaving(false);
    if (result.ok) toast('Video settings saved!');
    else toast(result.error ?? 'Save failed', 'error');
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const result = await uploadBackgroundAction(fd);
    setUploading(false);
    if (result.ok && result.url) {
      setBgUrl(result.url);
      toast('Background uploaded!');
    } else {
      toast((!result.ok && result.error) ? result.error : 'Upload failed', 'error');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── No avatar assigned yet ────────────────────────────────────────── */}
      {!baseAvatarId && (
        <div style={{
          padding: '28px 20px', border: '1.5px dashed var(--line)', borderRadius: 12,
          textAlign: 'center', marginBottom: 24,
        }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎬</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Avatar not configured yet</div>
          <p className="muted" style={{ fontSize: 13 }}>
            Your platform admin will set up your candidate avatar.
            Once assigned, it will appear here for you to customize.
          </p>
        </div>
      )}

      {/* ── Avatar looks grid ─────────────────────────────────────────────── */}
      {baseAvatarId && (
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Your avatar</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            These are the available looks for your avatar. Pick the one to use in campaign videos.
          </p>

          {loading && (
            <div style={{ display: 'flex', gap: 12 }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ width: 140, height: 190, borderRadius: 10, flexShrink: 0 }} />
              ))}
            </div>
          )}

          {!loading && looks.length === 0 && (
            <div style={{ padding: '20px 0' }}>
              <p className="muted" style={{ fontSize: 13 }}>
                No avatar found with that ID — check the HeyGen avatar_id above.
              </p>
            </div>
          )}

          {!loading && looks.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {looks.map((look, i) => {
                const isSelected = selectedLookId === look.avatar_id || (!selectedLookId && i === 0);
                return (
                  <button key={`${look.avatar_id}-${i}`} type="button"
                    onClick={() => setSelectedLookId(look.avatar_id)}
                    style={{
                      padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                      border: `3px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
                      background: 'var(--bg-hover)', position: 'relative', textAlign: 'left',
                      width: 140, flexShrink: 0,
                      boxShadow: isSelected ? '0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)' : 'none',
                      transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}>
                    {look.preview_image_url ? (
                      <img src={look.preview_image_url} alt={look.avatar_name}
                        style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
                        👤
                      </div>
                    )}
                    {isSelected && (
                      <div style={{
                        position: 'absolute', top: 8, right: 8, width: 24, height: 24,
                        background: 'var(--accent)', borderRadius: '50%', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700,
                      }}>✓</div>
                    )}
                    <div style={{ padding: '8px 10px 10px', fontSize: 12, fontWeight: 600 }}>
                      Look {i + 1}
                      {look.preview_video_url && (
                        <a href={look.preview_video_url} target="_blank" rel="noreferrer"
                          style={{ display: 'block', fontSize: 11, color: 'var(--accent)', marginTop: 2, textDecoration: 'none' }}>
                          Preview ↗
                        </a>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Video format ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Video format</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {ASPECT_RATIOS.map(r => (
            <button key={r.id} type="button" onClick={() => setSelectedRatio(r.id)}
              style={{
                padding: '10px 16px', borderRadius: 8, border: '1.5px solid',
                borderColor: selectedRatio === r.id ? 'var(--accent)' : 'var(--line)',
                background: selectedRatio === r.id ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                cursor: 'pointer', textAlign: 'center',
              }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: selectedRatio === r.id ? 'var(--accent)' : 'var(--text)' }}>{r.label}</div>
              <div className="muted" style={{ fontSize: 11 }}>{r.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Background ────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Background</div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Upload a background image or paste a URL. HeyGen composites your avatar over it.
          Use a high-resolution photo (1920×1080 or larger).
        </p>

        {/* Upload + URL row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />
          <button type="button" className="btn"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            {uploading ? 'Uploading…' : '↑ Upload image'}
          </button>
          <input
            type="url"
            className="input"
            placeholder="or paste an image URL"
            value={bgUrl}
            onChange={e => setBgUrl(e.target.value)}
            style={{ flex: 1, fontSize: 13 }}
          />
        </div>

        {/* Preview */}
        {bgUrl && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img src={bgUrl} alt="Background preview"
              style={{ height: 90, maxWidth: 200, objectFit: 'cover', borderRadius: 8, border: '1.5px solid var(--line)', display: 'block' }} />
            <button type="button"
              onClick={() => setBgUrl('')}
              style={{
                position: 'absolute', top: -8, right: -8, width: 22, height: 22,
                borderRadius: '50%', background: 'var(--bg-elevated)', border: '1.5px solid var(--line)',
                cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>✕</button>
          </div>
        )}

        {!bgUrl && (
          <div style={{
            width: 200, height: 90, borderRadius: 8, border: '1.5px dashed var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-hover)',
          }}>
            <span className="muted" style={{ fontSize: 12 }}>No background set</span>
          </div>
        )}
      </div>

      {/* ── Save ──────────────────────────────────────────────────────────── */}
      <button className="btn primary" disabled={saving} onClick={handleSaveLook}>
        {saving ? 'Saving…' : 'Save video settings'}
      </button>
    </div>
  );
}
