'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { saveVideoSettingsAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import { AvatarsIcon, CheckIcon, ExternalIcon, RefreshIcon, AlertIcon } from '@/components/icons';

interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url?: string;
  preview_video_url?: string;
}

type AspectRatio = '16:9' | '9:16' | '1:1';
const ASPECT_RATIOS: { id: AspectRatio; subKey: 'aspectRatioSub169' | 'aspectRatioSub916' | 'aspectRatioSub11' }[] = [
  { id: '16:9', subKey: 'aspectRatioSub169' },
  { id: '9:16', subKey: 'aspectRatioSub916' },
  { id: '1:1',  subKey: 'aspectRatioSub11' },
];
function isAspectRatio(v: unknown): v is AspectRatio {
  return v === '16:9' || v === '9:16' || v === '1:1';
}

type LooksState =
  | { status: 'idle' | 'loading' | 'error'; looks: HeyGenAvatar[] }
  | { status: 'ready'; looks: HeyGenAvatar[] };

/**
 * Video settings: the avatar look (only when an avatar group exists) and the
 * aspect ratio, which is always reachable — the content wizard sends new
 * users here to set it before any avatar has finished training.
 */
export function AvatarLibrary({
  baseAvatarId,
  currentAvatarId,
  currentAspectRatio,
  canManage,
}: {
  baseAvatarId: string | null;
  currentAvatarId?: string | null;
  currentAspectRatio?: string;
  canManage: boolean;
}) {
  const t = useTranslations('avatars');
  const { toast } = useToast();

  const [looksState, setLooksState] = useState<LooksState>({ status: 'idle', looks: [] });
  const [saving, setSaving] = useState(false);

  const [selectedLookId, setSelectedLookId] = useState(currentAvatarId ?? '');
  const [selectedRatio, setSelectedRatio] = useState<AspectRatio>(isAspectRatio(currentAspectRatio) ? currentAspectRatio : '16:9');

  const loadLooks = useCallback(async () => {
    if (!baseAvatarId) { setLooksState({ status: 'idle', looks: [] }); return; }
    setLooksState(prev => ({ status: 'loading', looks: prev.looks }));
    try {
      const r = await fetch(`/api/heygen/avatars?baseId=${encodeURIComponent(baseAvatarId)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setLooksState({ status: 'ready', looks: Array.isArray(d.avatars) ? d.avatars : [] });
    } catch (e) {
      // A failed fetch used to render as "no looks yet" — show it as an error instead.
      console.error('[avatars] looks fetch failed', e);
      setLooksState({ status: 'error', looks: [] });
    }
  }, [baseAvatarId]);

  useEffect(() => { void loadLooks(); }, [loadLooks]);

  const looks = looksState.looks;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      // Only touch the look when the list actually loaded — otherwise saving
      // the aspect ratio would silently clear the configured look.
      const selected = looksState.status === 'ready' && looks.length > 0
        ? (looks.find(l => l.avatar_id === selectedLookId) ?? looks[0])
        : null;
      const result = await saveVideoSettingsAction({
        ...(selected ? { heygenAvatarId: selected.avatar_id } : {}),
        videoAspectRatio: selectedRatio,
      });
      if (result.ok) toast(t('videoSettingsSaved'));
      else toast(result.error ?? t('saveFailed'), 'error');
    } catch (e) {
      console.error('[avatars] save video settings failed', e);
      toast(t('saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  const selectedSub = ASPECT_RATIOS.find(r => r.id === selectedRatio)?.subKey;

  return (
    <div className="stack">
      {/* ── Avatar looks ────────────────────────────────────────────────── */}
      <section className="stack av-section" aria-labelledby="av-looks-heading">
        <div>
          <h3 id="av-looks-heading" className="av-section-title">{t('yourAvatar')}</h3>
          <p className="muted text-sm">{t('looksDescription')}</p>
        </div>

        {!baseAvatarId && <p className="subtle text-sm">{t('noActiveAvatar')}</p>}

        {baseAvatarId && looksState.status === 'loading' && (
          <div className="av-looks" aria-busy="true">
            {[1, 2, 3].map(i => <div key={i} className="skeleton av-look-skeleton" />)}
          </div>
        )}

        {baseAvatarId && looksState.status === 'error' && (
          <div className="alert alert-bad" role="alert">
            <AlertIcon size={16} />
            <div className="alert-body">
              <div className="alert-text">{t('looksLoadFailed')}</div>
              <div className="alert-actions">
                <button type="button" className="btn btn-sm" onClick={() => { void loadLooks(); }}>
                  <RefreshIcon size={14} />{t('retry')}
                </button>
              </div>
            </div>
          </div>
        )}

        {baseAvatarId && looksState.status === 'ready' && looks.length === 0 && (
          <p className="subtle text-sm">{t('noLooksYet')}</p>
        )}

        {baseAvatarId && looksState.status === 'ready' && looks.length > 0 && (
          <div className="av-looks" role="radiogroup" aria-label={t('yourAvatar')}>
            {looks.map((look, i) => {
              const isSelected = selectedLookId === look.avatar_id || (!selectedLookId && i === 0);
              const label = look.avatar_name || t('lookFallbackName', { number: i + 1 });
              return (
                <div key={`${look.avatar_id}-${i}`} className={`av-look${isSelected ? ' is-selected' : ''}`}>
                  <button type="button" role="radio" aria-checked={isSelected} className="av-look-btn"
                    disabled={!canManage} onClick={() => setSelectedLookId(look.avatar_id)}>
                    {look.preview_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={look.preview_image_url} alt="" className="av-look-img" />
                    ) : (
                      <div className="av-look-img av-look-empty" aria-hidden="true"><AvatarsIcon size={28} /></div>
                    )}
                    {isSelected && <span className="av-look-check" aria-hidden="true"><CheckIcon size={13} strokeWidth={2.5} /></span>}
                    <span className="av-look-name">{label}</span>
                  </button>
                  {look.preview_video_url && (
                    <a href={look.preview_video_url} target="_blank" rel="noreferrer" className="av-look-preview link text-xs">
                      {t('previewLink')}<ExternalIcon size={12} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Video format ────────────────────────────────────────────────── */}
      <section className="stack av-section" aria-labelledby="av-format-heading">
        <h3 id="av-format-heading" className="av-section-title">{t('videoFormat')}</h3>
        <div>
          <div className="segmented" role="radiogroup" aria-labelledby="av-format-heading">
            {ASPECT_RATIOS.map(r => (
              <button key={r.id} type="button" role="radio" aria-checked={selectedRatio === r.id}
                disabled={!canManage} onClick={() => setSelectedRatio(r.id)}>
                {r.id}
              </button>
            ))}
          </div>
          {selectedSub && <span className="field-hint">{t(selectedSub)}</span>}
        </div>
      </section>

      {canManage && (
        <div className="form-actions av-form-actions">
          <button type="button" className="btn btn-primary" disabled={saving} aria-busy={saving} onClick={handleSave}>
            {saving ? t('saving') : t('saveVideoSettings')}
          </button>
        </div>
      )}
    </div>
  );
}
