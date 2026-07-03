'use client';

import { useState, useEffect } from 'react';
import { saveVideoSettingsAction } from '@/app/actions';
import { useToast } from '@/components/Toast';

interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url?: string;
  preview_video_url?: string;
}

const ASPECT_RATIOS = [
  { id: '16:9' as const, label: '16:9', sub: 'YouTube · LinkedIn' },
  { id: '9:16' as const, label: '9:16', sub: 'Reels · TikTok' },
  { id: '1:1'  as const, label: '1:1',  sub: 'Facebook · X' },
];

export function AvatarLibrary({
  baseAvatarId,
  currentAvatarId,
  currentAspectRatio,
}: {
  baseAvatarId: string;
  currentAvatarId?: string | null;
  currentAspectRatio?: string;
}) {
  const { toast } = useToast();

  const [looks, setLooks]     = useState<HeyGenAvatar[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);

  const [selectedLookId, setSelectedLookId] = useState(currentAvatarId ?? '');
  const [selectedRatio,  setSelectedRatio]  = useState<'16:9' | '9:16' | '1:1'>(
    (currentAspectRatio as '16:9' | '9:16' | '1:1') ?? '16:9'
  );

  useEffect(() => {
    setLoading(true);
    fetch(`/api/heygen/avatars?baseId=${encodeURIComponent(baseAvatarId)}`)
      .then(r => r.json())
      .then(d => setLooks(d.avatars ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [baseAvatarId]);

  async function handleSave() {
    const selected = looks.find(l => l.avatar_id === selectedLookId) ?? looks[0];
    setSaving(true);
    const result = await saveVideoSettingsAction({
      heygenAvatarId:   selected?.avatar_id ?? null,
      videoAspectRatio: selectedRatio,
    });
    setSaving(false);
    if (result.ok) toast('Video settings saved!');
    else toast(result.error ?? 'Save failed', 'error');
  }

  return (
    <div>
      {/* ── Avatar looks grid ─────────────────────────────────────────────── */}
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
          <p className="muted" style={{ fontSize: 13 }}>
            This avatar has no completed looks yet — check back once training finishes.
          </p>
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
                    {look.avatar_name || `Look ${i + 1}`}
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

      {/* ── Video format ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
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

      {/* ── Save ──────────────────────────────────────────────────────────── */}
      <button className="btn primary" disabled={saving} onClick={handleSave}>
        {saving ? 'Saving…' : 'Save video settings'}
      </button>
    </div>
  );
}
