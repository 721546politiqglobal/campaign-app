'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import {
  beginAvatarUploadAction, finalizeAvatarAction, checkAvatarStatusAction, setActiveAvatarAction, deleteAvatarAction,
  generatePromptLookAction, beginVideoAvatarUploadAction, finalizeVideoAvatarAction,
} from '@/app/actions';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { AvatarsIcon, ImageIcon, VideoIcon, CopyIcon, TrashIcon, SparklesIcon, XIcon } from '@/components/icons';
import type { Avatar, AvatarStatus } from '@/domain/types';

const MIN_PHOTOS = 4;
const MAX_PHOTOS = 10;
const POLL_MS = 5000;

const STATUS_TONE: Record<AvatarStatus, BadgeTone> = {
  pending_consent: 'warn', training: 'info', ready: 'ok', failed: 'bad',
};

type StatusOverride = { status: AvatarStatus; errorMessage: string | null };

export function AvatarManager({
  avatars,
  activeAvatarId,
  canManage,
}: {
  avatars: Avatar[];
  activeAvatarId: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const t = useTranslations('avatarManager');
  const format = useFormatter();

  // Status updates learned from polling, layered over the server list so a
  // tick never re-renders the whole route; the route refreshes once per change.
  const [overrides, setOverrides] = useState<Record<string, StatusOverride>>({});
  const rows = useMemo(
    () => avatars.map(a => (overrides[a.id] ? { ...a, ...overrides[a.id] } : a)),
    [avatars, overrides],
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoStep, setVideoStep] = useState<1 | 2 | 3>(1);
  const [videoConsent, setVideoConsent] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoName, setVideoName] = useState('');
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const [videoDurationWarning, setVideoDurationWarning] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);

  const [lookModalAvatarId, setLookModalAvatarId] = useState<string | null>(null);
  const [lookName, setLookName] = useState('');
  const [lookPrompt, setLookPrompt] = useState('');
  const [generatingLook, setGeneratingLook] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const pollableIds = rows.filter(a => a.status === 'training' || a.status === 'pending_consent').map(a => a.id).join(',');
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    let cancelled = false;

    async function pollOnce() {
      const ids = pollableIds ? pollableIds.split(',') : [];
      if (ids.length === 0) return;
      let changed = false;
      const results = await Promise.allSettled(ids.map(id => checkAvatarStatusAction(id)));
      if (cancelled) return;
      results.forEach((r, i) => {
        if (r.status !== 'fulfilled' || !r.value.ok || !r.value.status) {
          if (r.status === 'rejected') console.error('[avatars] status poll failed', r.reason);
          return;
        }
        const id = ids[i];
        const current = rowsRef.current.find(a => a.id === id);
        if (current && current.status !== r.value.status) {
          changed = true;
          setOverrides(prev => ({ ...prev, [id]: { status: r.value.status!, errorMessage: r.value.errorMessage ?? null } }));
        }
      });
      // One route refresh per real change (picks up consent URLs, look ids…).
      if (changed) router.refresh();
    }

    // One-shot check on mount even if nothing is currently "training" locally,
    // so status catches up if the user navigated away and back.
    void pollOnce();

    if (!pollableIds) return;
    const interval = setInterval(() => { void pollOnce(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollableIds, router]);

  // Server data caught up with what polling learned — drop the overrides.
  useEffect(() => { setOverrides({}); }, [avatars]);

  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [files]);

  useEffect(() => {
    if (!videoFile) { setVideoPreviewUrl(null); return; }
    const url = URL.createObjectURL(videoFile);
    setVideoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  function resetModal() {
    setModalOpen(false);
    setStep(1);
    setConsent(false);
    setFiles([]);
    setName('');
  }

  function resetVideoModal() {
    setVideoModalOpen(false);
    setVideoStep(1);
    setVideoConsent(false);
    setVideoFile(null);
    setVideoName('');
    setVideoDurationWarning(null);
  }

  function handleVideoFileChosen(chosen: FileList | null) {
    const file = chosen?.[0];
    if (!file) return;
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (probe.duration < 30) setVideoDurationWarning(t('steps.durationWarningShort'));
      else if (probe.duration > 300) setVideoDurationWarning(t('steps.durationWarningLong'));
      else setVideoDurationWarning(null);
    };
    probe.src = url;
  }

  async function handleVideoSubmit() {
    if (!videoFile || videoSubmitting) return;
    setVideoSubmitting(true);
    try {
      const begin = await beginVideoAvatarUploadAction(videoConsent, {
        name: videoFile.name, type: videoFile.type, size: videoFile.size,
      });
      if (!begin.ok) { toast(begin.error, 'error'); return; }
      if (!begin.path || !begin.token || !begin.avatarId) { toast(t('errors.createVideoAvatarFailed'), 'error'); return; }

      const { error: uploadError } = await supabaseBrowser.storage.from('media')
        .uploadToSignedUrl(begin.path, begin.token, videoFile);
      if (uploadError) {
        console.error('[avatars] video upload failed', uploadError);
        toast(t('toast.uploadFailed'), 'error');
        return;
      }

      const result = await finalizeVideoAvatarAction(begin.avatarId, videoName, begin.path);
      if (result.ok) {
        toast(t('toast.videoAvatarCreationStarted'));
        resetVideoModal();
        router.refresh();
      } else {
        toast(result.error ?? t('errors.createVideoAvatarFailed'), 'error');
      }
    } catch (e) {
      console.error('[avatars] video avatar submit failed', e);
      toast(t('errors.generic'), 'error');
    } finally {
      setVideoSubmitting(false);
    }
  }

  async function handleCopyConsentLink(url: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      toast(t('toast.consentLinkCopied'));
    } catch {
      toast(t('toast.copyFailed', { url }), 'error');
    }
  }

  function handleFilesChosen(chosen: FileList | null) {
    if (!chosen) return;
    setFiles([...files, ...Array.from(chosen)].slice(0, MAX_PHOTOS));
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const begin = await beginAvatarUploadAction(consent, files.map(f => ({ name: f.name, type: f.type, size: f.size })));
      if (!begin.ok) { toast(begin.error, 'error'); return; }
      if (!begin.uploads || !begin.avatarId) { toast(t('errors.createAvatarFailed'), 'error'); return; }

      const uploads = begin.uploads;
      for (let i = 0; i < uploads.length; i++) {
        const { error: uploadError } = await supabaseBrowser.storage.from('media')
          .uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i]);
        if (uploadError) {
          console.error('[avatars] photo upload failed', uploadError);
          toast(t('toast.uploadFailed'), 'error');
          return;
        }
      }

      const result = await finalizeAvatarAction(begin.avatarId, name, uploads.map(u => u.path));
      if (result.ok) {
        toast(t('toast.avatarCreationStarted'));
        resetModal();
        router.refresh();
      } else {
        toast(result.error ?? t('errors.createAvatarFailed'), 'error');
      }
    } catch (e) {
      console.error('[avatars] avatar submit failed', e);
      toast(t('errors.generic'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetActive(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const result = await setActiveAvatarAction(id);
      if (result.ok) { toast(t('toast.activeAvatarUpdated')); router.refresh(); }
      else toast(result.error ?? t('errors.setActiveFailed'), 'error');
    } catch (e) {
      console.error('[avatars] set active failed', e);
      toast(t('errors.generic'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(avatar: Avatar) {
    if (busyId) return;
    const ok = await confirm({
      title: t('deleteConfirm.title'),
      description: t('deleteConfirm.description', { name: avatar.name }),
      confirmLabel: t('deleteConfirm.confirm'),
      cancelLabel: t('actions.cancel'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(avatar.id);
    try {
      const result = await deleteAvatarAction(avatar.id);
      if (result.ok) { toast(t('toast.avatarDeleted')); router.refresh(); }
      else toast(result.error ?? t('errors.deleteFailed'), 'error');
    } catch (e) {
      console.error('[avatars] delete failed', e);
      toast(t('errors.generic'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  function resetLookModal() {
    setLookModalAvatarId(null);
    setLookName('');
    setLookPrompt('');
  }

  async function handleGenerateLook() {
    if (!lookModalAvatarId || generatingLook) return;
    setGeneratingLook(true);
    try {
      const result = await generatePromptLookAction(lookModalAvatarId, lookName, lookPrompt);
      if (result.ok) {
        toast(t('toast.lookGenerated'));
        resetLookModal();
        router.refresh();
      } else {
        toast(result.error ?? t('errors.generateLookFailed'), 'error');
      }
    } catch (e) {
      console.error('[avatars] generate look failed', e);
      toast(t('errors.generic'), 'error');
    } finally {
      setGeneratingLook(false);
    }
  }

  const createButtons = canManage && (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setModalOpen(true)}>
        <ImageIcon size={14} />{t('fromPhotosButton')}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setVideoModalOpen(true)}>
        <VideoIcon size={14} />{t('fromVideoButton')}
      </button>
    </>
  );

  return (
    <div className="stack">
      {rows.length > 0 && (
        <div className="row-between av-head">
          <span className="eyebrow">{t('avatarCount', { count: rows.length })}</span>
          {canManage && <div className="btnrow">{createButtons}</div>}
        </div>
      )}

      {rows.length === 0 && (
        <EmptyState
          plain
          icon="avatars"
          title={t('emptyState.title')}
          description={canManage ? t('emptyState.canManage') : t('emptyState.readOnly')}
          action={createButtons || undefined}
        />
      )}

      {rows.length > 0 && (
        <ul className="av-list">
          {rows.map(a => {
            const busy = busyId === a.id;
            return (
              <li key={a.id} className="av-row" aria-busy={busy}>
                {a.sourcePhotoUrls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.sourcePhotoUrls[0]} alt="" className="av-thumb" />
                ) : (
                  <div className="av-thumb av-thumb-empty" aria-hidden="true"><AvatarsIcon size={20} /></div>
                )}
                <div className="av-row-text">
                  <div className="av-row-title">
                    <span className="av-name">{a.name}</span>
                    {a.id === activeAvatarId && <Badge tone="accent" size="sm">{t('activeBadge')}</Badge>}
                  </div>
                  <div className="av-row-meta">
                    <Badge tone={STATUS_TONE[a.status]} size="sm" dot>
                      {a.status === 'pending_consent' && t('status.pendingConsent')}
                      {a.status === 'training' && t('status.training')}
                      {a.status === 'ready' && t('status.ready')}
                      {a.status === 'failed' && t('status.failed', { message: a.errorMessage ?? t('status.unknownError') })}
                    </Badge>
                    <span className="subtle text-xs">
                      {t('createdOn', { date: format.dateTime(new Date(a.createdAt), { dateStyle: 'medium' }) })}
                    </span>
                  </div>
                </div>
                {canManage && (
                  <div className="av-row-actions">
                    {a.status === 'pending_consent' && a.consentUrl && (
                      <button type="button" className="btn btn-sm" onClick={() => handleCopyConsentLink(a.consentUrl!)}>
                        <CopyIcon size={14} />{t('actions.copyConsentLink')}
                      </button>
                    )}
                    {a.status === 'ready' && a.id !== activeAvatarId && (
                      <button type="button" className="btn btn-sm" disabled={!!busyId} aria-busy={busy} onClick={() => handleSetActive(a.id)}>
                        {t('actions.setActive')}
                      </button>
                    )}
                    {a.status === 'ready' && a.heygenLookId && (
                      <button type="button" className="btn btn-sm" disabled={!!busyId} onClick={() => setLookModalAvatarId(a.id)}>
                        <SparklesIcon size={14} />{t('actions.generateLook')}
                      </button>
                    )}
                    <button type="button" className="btn btn-danger-soft btn-sm btn-icon" disabled={!!busyId}
                      aria-label={t('actions.deleteNamed', { name: a.name })} title={t('actions.delete')}
                      onClick={() => handleDelete(a)}>
                      <TrashIcon size={14} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Photo avatar wizard ─────────────────────────────────────────── */}
      <Dialog
        open={modalOpen}
        onClose={resetModal}
        title={t('steps.photoDialogTitle')}
        description={step === 1 ? t('steps.consentLabel') : step === 2 ? t('steps.photosLabel') : t('steps.nameLabel')}
        size="md"
        closeOnBackdrop={!submitting}
        footer={
          step === 1 ? (
            <>
              <button type="button" className="btn" onClick={resetModal}>{t('actions.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={!consent} onClick={() => setStep(2)}>{t('actions.next')}</button>
            </>
          ) : step === 2 ? (
            <>
              <button type="button" className="btn" onClick={() => setStep(1)}>{t('actions.back')}</button>
              <button type="button" className="btn btn-primary" disabled={files.length < MIN_PHOTOS} onClick={() => setStep(3)}>{t('actions.next')}</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled={submitting} onClick={() => setStep(2)}>{t('actions.back')}</button>
              <button type="button" className="btn btn-primary" disabled={submitting || !name.trim()} aria-busy={submitting} onClick={handleSubmit}>
                {submitting ? t('steps.creating') : t('steps.createAvatar')}
              </button>
            </>
          )
        }
      >
        {step === 1 && (
          <div className="stack">
            <h3 className="av-step-title">{t('steps.confirmPermissionTitle')}</h3>
            <label className="checkrow av-consent">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              <span>{t('steps.photoConsentText')}</span>
            </label>
          </div>
        )}
        {step === 2 && (
          <div className="stack">
            <h3 className="av-step-title">{t('steps.uploadPhotosTitle')}</h3>
            <Field label={t('steps.photoInputLabel')} hint={t('steps.uploadPhotosInstructions', { min: MIN_PHOTOS, max: MAX_PHOTOS })}>
              {(p) => <input {...p} type="file" accept="image/*" multiple onChange={e => handleFilesChosen(e.target.files)} />}
            </Field>
            {files.length > 0 && (
              <ul className="av-photo-grid" aria-label={t('steps.photoInputLabel')}>
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="av-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrls[i]} alt="" />
                    <button type="button" className="av-photo-remove" aria-label={t('steps.removePhoto', { number: i + 1 })}
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                      <XIcon size={12} strokeWidth={2.2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="subtle text-xs num">{t('steps.photosAddedCount', { count: files.length, max: MAX_PHOTOS })}</p>
          </div>
        )}
        {step === 3 && (
          <div className="stack">
            <h3 className="av-step-title">{t('steps.nameAvatarTitle')}</h3>
            <Field label={t('steps.avatarNameLabel')} hint={t('steps.photoNameHint')}>
              {(p) => (
                <input {...p} className="input" placeholder={t('steps.photoNamePlaceholder')} value={name}
                  onChange={e => setName(e.target.value)} maxLength={60} autoFocus />
              )}
            </Field>
          </div>
        )}
      </Dialog>

      {/* ── Video avatar wizard ─────────────────────────────────────────── */}
      <Dialog
        open={videoModalOpen}
        onClose={resetVideoModal}
        title={t('steps.videoDialogTitle')}
        description={videoStep === 1 ? t('steps.consentLabel') : videoStep === 2 ? t('steps.videoLabel') : t('steps.nameLabel')}
        size="md"
        closeOnBackdrop={!videoSubmitting}
        footer={
          videoStep === 1 ? (
            <>
              <button type="button" className="btn" onClick={resetVideoModal}>{t('actions.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={!videoConsent} onClick={() => setVideoStep(2)}>{t('actions.next')}</button>
            </>
          ) : videoStep === 2 ? (
            <>
              <button type="button" className="btn" onClick={() => setVideoStep(1)}>{t('actions.back')}</button>
              <button type="button" className="btn btn-primary" disabled={!videoFile} onClick={() => setVideoStep(3)}>{t('actions.next')}</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled={videoSubmitting} onClick={() => setVideoStep(2)}>{t('actions.back')}</button>
              <button type="button" className="btn btn-primary" disabled={videoSubmitting || !videoName.trim()} aria-busy={videoSubmitting} onClick={handleVideoSubmit}>
                {videoSubmitting ? t('steps.creating') : t('steps.createVideoAvatar')}
              </button>
            </>
          )
        }
      >
        {videoStep === 1 && (
          <div className="stack">
            <h3 className="av-step-title">{t('steps.confirmPermissionTitle')}</h3>
            <label className="checkrow av-consent">
              <input type="checkbox" checked={videoConsent} onChange={e => setVideoConsent(e.target.checked)} />
              <span>{t('steps.videoConsentText')}</span>
            </label>
          </div>
        )}
        {videoStep === 2 && (
          <div className="stack">
            <h3 className="av-step-title">{t('steps.uploadVideoTitle')}</h3>
            <Field label={t('steps.videoInputLabel')} hint={t('steps.uploadVideoInstructions')}>
              {(p) => <input {...p} type="file" accept="video/mp4,video/quicktime" onChange={e => handleVideoFileChosen(e.target.files)} />}
            </Field>
            {videoFile && videoPreviewUrl && (
              <video src={videoPreviewUrl} controls className="av-video-preview" />
            )}
            {videoDurationWarning && <p className="av-warn text-xs" role="status">{videoDurationWarning}</p>}
          </div>
        )}
        {videoStep === 3 && (
          <div className="stack">
            <h3 className="av-step-title">{t('steps.nameAvatarTitle')}</h3>
            <Field label={t('steps.avatarNameLabel')}>
              {(p) => (
                <input {...p} className="input" placeholder={t('steps.videoNamePlaceholder')} value={videoName}
                  onChange={e => setVideoName(e.target.value)} maxLength={60} autoFocus />
              )}
            </Field>
          </div>
        )}
      </Dialog>

      {/* ── Generate look ───────────────────────────────────────────────── */}
      <Dialog
        open={!!lookModalAvatarId}
        onClose={resetLookModal}
        title={t('lookModal.title')}
        description={t('lookModal.description')}
        size="md"
        closeOnBackdrop={!generatingLook}
        footer={
          <>
            <button type="button" className="btn" disabled={generatingLook} onClick={resetLookModal}>{t('actions.cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={generatingLook || !lookPrompt.trim()} aria-busy={generatingLook} onClick={handleGenerateLook}>
              {generatingLook ? t('lookModal.generating') : t('actions.generateLook')}
            </button>
          </>
        }
      >
        <Field label={t('lookModal.nameLabel')}>
          {(p) => <input {...p} className="input" placeholder={t('lookModal.namePlaceholder')} value={lookName} onChange={e => setLookName(e.target.value)} maxLength={60} />}
        </Field>
        <Field label={t('lookModal.promptLabel')} required>
          {(p) => (
            <textarea {...p} className="input av-prompt" placeholder={t('lookModal.promptPlaceholder')}
              value={lookPrompt} onChange={e => setLookPrompt(e.target.value)} required />
          )}
        </Field>
      </Dialog>
    </div>
  );
}
