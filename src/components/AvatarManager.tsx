'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  beginAvatarUploadAction, finalizeAvatarAction, checkAvatarStatusAction, setActiveAvatarAction, deleteAvatarAction,
  generatePromptLookAction, beginVideoAvatarUploadAction, finalizeVideoAvatarAction,
} from '@/app/actions';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useToast } from '@/components/Toast';
import type { Avatar } from '@/domain/types';

const MIN_PHOTOS = 4;
const MAX_PHOTOS = 10;
const POLL_MS = 5000;

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

  const pollableIds = avatars.filter(a => a.status === 'training' || a.status === 'pending_consent').map(a => a.id).join(',');

  useEffect(() => {
    let cancelled = false;

    async function pollOnce() {
      const ids = pollableIds ? pollableIds.split(',') : [];
      if (ids.length === 0) return;
      await Promise.all(ids.map(id => checkAvatarStatusAction(id)));
      if (!cancelled) router.refresh();
    }

    // One-shot check on mount even if nothing is currently "training" locally,
    // so status catches up if the user navigated away and back.
    pollOnce();

    if (!pollableIds) return;
    const interval = setInterval(pollOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollableIds, router]);

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
      if (probe.duration < 30) setVideoDurationWarning('This clip looks shorter than 30 seconds — HeyGen recommends at least 30s of footage.');
      else if (probe.duration > 300) setVideoDurationWarning('This clip looks longer than 5 minutes — HeyGen recommends under 5 minutes of footage.');
      else setVideoDurationWarning(null);
    };
    probe.src = url;
  }

  async function handleVideoSubmit() {
    if (!videoFile) return;
    setVideoSubmitting(true);

    const begin = await beginVideoAvatarUploadAction(videoConsent, {
      name: videoFile.name, type: videoFile.type, size: videoFile.size,
    });
    if (!begin.ok) {
      setVideoSubmitting(false);
      toast(begin.error, 'error');
      return;
    }
    if (!begin.path || !begin.token || !begin.avatarId) {
      setVideoSubmitting(false);
      toast('Failed to create video avatar', 'error');
      return;
    }

    const { error: uploadError } = await supabaseBrowser.storage.from('media')
      .uploadToSignedUrl(begin.path, begin.token, videoFile);
    if (uploadError) {
      setVideoSubmitting(false);
      toast(`Upload failed: ${uploadError.message}`, 'error');
      return;
    }

    const result = await finalizeVideoAvatarAction(begin.avatarId, videoName, begin.path);
    setVideoSubmitting(false);
    if (result.ok) {
      toast('Video avatar creation started — send the candidate the consent link shown on this avatar.');
      resetVideoModal();
      router.refresh();
    } else {
      toast(result.error ?? 'Failed to create video avatar', 'error');
    }
  }

  async function handleCopyConsentLink(url: string) {
    await navigator.clipboard.writeText(url);
    toast('Consent link copied.');
  }

  function handleFilesChosen(chosen: FileList | null) {
    if (!chosen) return;
    setFiles([...files, ...Array.from(chosen)].slice(0, MAX_PHOTOS));
  }

  async function handleSubmit() {
    setSubmitting(true);

    const begin = await beginAvatarUploadAction(consent, files.map(f => ({ name: f.name, type: f.type, size: f.size })));
    if (!begin.ok) {
      setSubmitting(false);
      toast(begin.error, 'error');
      return;
    }
    if (!begin.uploads || !begin.avatarId) {
      setSubmitting(false);
      toast('Failed to create avatar', 'error');
      return;
    }

    const uploads = begin.uploads;
    for (let i = 0; i < uploads.length; i++) {
      const { error: uploadError } = await supabaseBrowser.storage.from('media')
        .uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i]);
      if (uploadError) {
        setSubmitting(false);
        toast(`Upload failed: ${uploadError.message}`, 'error');
        return;
      }
    }

    const result = await finalizeAvatarAction(begin.avatarId, name, uploads.map(u => u.path));
    setSubmitting(false);
    if (result.ok) {
      toast('Avatar creation started — this can take a few minutes.');
      resetModal();
      router.refresh();
    } else {
      toast(result.error ?? 'Failed to create avatar', 'error');
    }
  }

  async function handleSetActive(id: string) {
    const result = await setActiveAvatarAction(id);
    if (result.ok) { toast('Active avatar updated.'); router.refresh(); }
    else toast(result.error ?? 'Failed to set active avatar', 'error');
  }

  async function handleDelete(id: string) {
    const result = await deleteAvatarAction(id);
    if (result.ok) { toast('Avatar deleted.'); router.refresh(); }
    else toast(result.error ?? 'Failed to delete avatar', 'error');
  }

  function resetLookModal() {
    setLookModalAvatarId(null);
    setLookName('');
    setLookPrompt('');
  }

  async function handleGenerateLook() {
    if (!lookModalAvatarId) return;
    setGeneratingLook(true);
    const result = await generatePromptLookAction(lookModalAvatarId, lookName, lookPrompt);
    setGeneratingLook(false);
    if (result.ok) {
      toast('New look generated — it replaces this avatar’s current look and will be used for future videos.');
      resetLookModal();
      router.refresh();
    } else {
      toast(result.error ?? 'Failed to generate look', 'error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="eyebrow">{avatars.length} {avatars.length === 1 ? 'avatar' : 'avatars'}</div>
        {canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setModalOpen(true)}>
              + From photos
            </button>
            <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setVideoModalOpen(true)}>
              + From video
            </button>
          </div>
        )}
      </div>

      {avatars.length === 0 && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          {canManage
            ? 'No avatars yet — create one from a set of candidate photos.'
            : 'No avatars have been created for this campaign yet.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {avatars.map(a => (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {a.sourcePhotoUrls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.sourcePhotoUrls[0]} alt=""
                  style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: 'var(--bg-hover)' }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--bg-elevated)', display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  {a.id === activeAvatarId && (
                    <span className="pill published">Active</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: a.status === 'ready' ? 'var(--ok)' : a.status === 'failed' ? 'var(--bad)' : 'var(--warn)',
                    boxShadow: `0 0 6px ${a.status === 'ready' ? 'var(--ok)' : a.status === 'failed' ? 'var(--bad)' : 'var(--warn)'}`,
                  }} />
                  <span>
                    {a.status === 'pending_consent' && 'Waiting on candidate consent'}
                    {a.status === 'training' && 'Training — usually a few minutes'}
                    {a.status === 'ready' && 'Ready'}
                    {a.status === 'failed' && `Failed: ${a.errorMessage ?? 'Unknown error'}`}
                    <span className="mono" style={{ color: 'var(--text-3)' }}> · created {new Date(a.createdAt).toLocaleDateString('en-US')}</span>
                  </span>
                </div>
              </div>
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8 }}>
                {a.status === 'pending_consent' && a.consentUrl && (
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => handleCopyConsentLink(a.consentUrl!)}>
                    Copy consent link
                  </button>
                )}
                {a.status === 'ready' && a.id !== activeAvatarId && (
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => handleSetActive(a.id)}>
                    Set active
                  </button>
                )}
                {a.status === 'ready' && a.heygenLookId && (
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => setLookModalAvatarId(a.id)}>
                    Generate look
                  </button>
                )}
                <button className="admin-delete-btn" onClick={() => handleDelete(a.id)}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            {step === 1 && (
              <>
                <div className="modal-step">Step 1 of 3 · Consent</div>
                <h3 style={{ marginBottom: 14, fontSize: 16 }}>Confirm permission</h3>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 }}>
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                  I confirm I have the candidate&rsquo;s permission to use these photos to create an AI avatar of them.
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={resetModal}>Cancel</button>
                  <button className="btn primary" disabled={!consent} onClick={() => setStep(2)}>Next →</button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="modal-step">Step 2 of 3 · Photos</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Upload photos</h3>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Upload {MIN_PHOTOS}–{MAX_PHOTOS} recent, high-resolution photos. Mix of angles and expressions gives the best result.
                </p>
                <input type="file" accept="image/*" multiple onChange={e => handleFilesChosen(e.target.files)} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={previewUrls[i]} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} />
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--bad)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{files.length} of {MAX_PHOTOS} photos added</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(1)}>← Back</button>
                  <button className="btn primary" disabled={files.length < MIN_PHOTOS} onClick={() => setStep(3)}>Next →</button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <div className="modal-step">Step 3 of 3 · Name</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Name this avatar</h3>
                <input className="input" placeholder="e.g. Alex — studio look" value={name}
                  onChange={e => setName(e.target.value)} maxLength={60} />
                <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Give it a name you&apos;ll recognize later — e.g. the look or setting.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(2)}>← Back</button>
                  <button className="btn primary" disabled={submitting || !name.trim()} onClick={handleSubmit}>
                    {submitting ? 'Creating…' : 'Create Avatar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {videoModalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            {videoStep === 1 && (
              <>
                <div className="modal-step">Step 1 of 3 · Consent</div>
                <h3 style={{ marginBottom: 14, fontSize: 16 }}>Confirm permission</h3>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 }}>
                  <input type="checkbox" checked={videoConsent} onChange={e => setVideoConsent(e.target.checked)} />
                  I confirm I have the candidate&rsquo;s permission to record and use this video to create an AI avatar of them.
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={resetVideoModal}>Cancel</button>
                  <button className="btn primary" disabled={!videoConsent} onClick={() => setVideoStep(2)}>Next →</button>
                </div>
              </>
            )}
            {videoStep === 2 && (
              <>
                <div className="modal-step">Step 2 of 3 · Video</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Upload training video</h3>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Upload one continuous, well-lit, front-facing clip of the candidate speaking (30 seconds to 5 minutes).
                  The candidate will separately complete a short consent recording on HeyGen&rsquo;s own page after you submit this.
                </p>
                <input type="file" accept="video/mp4,video/quicktime" onChange={e => handleVideoFileChosen(e.target.files)} />
                {videoFile && (
                  <video src={videoPreviewUrl ?? undefined} controls style={{ width: '100%', marginTop: 12, borderRadius: 8, maxHeight: 200 }} />
                )}
                {videoDurationWarning && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 8, color: 'var(--warn)' }}>{videoDurationWarning}</p>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setVideoStep(1)}>← Back</button>
                  <button className="btn primary" disabled={!videoFile} onClick={() => setVideoStep(3)}>Next →</button>
                </div>
              </>
            )}
            {videoStep === 3 && (
              <>
                <div className="modal-step">Step 3 of 3 · Name</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Name this avatar</h3>
                <input className="input" placeholder="e.g. Alex — video twin" value={videoName}
                  onChange={e => setVideoName(e.target.value)} maxLength={60} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setVideoStep(2)}>← Back</button>
                  <button className="btn primary" disabled={videoSubmitting || !videoName.trim()} onClick={handleVideoSubmit}>
                    {videoSubmitting ? 'Creating…' : 'Create Video Avatar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {lookModalAvatarId && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-step">New look</div>
            <h3 style={{ marginBottom: 12, fontSize: 16 }}>Generate a new look</h3>
            <p className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
              Describe the style or setting — HeyGen generates a new look of the same person, not a different one.
            </p>
            <label className="field-label">Name</label>
            <input className="input" placeholder="e.g. Studio look" value={lookName}
              onChange={e => setLookName(e.target.value)} style={{ marginBottom: 12 }} />
            <label className="field-label">Prompt</label>
            <textarea className="input" style={{ minHeight: 80 }}
              placeholder="e.g. studio lighting, navy suit, American flag backdrop"
              value={lookPrompt} onChange={e => setLookPrompt(e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="btn" onClick={resetLookModal}>Cancel</button>
              <button className="btn primary" disabled={generatingLook || !lookPrompt.trim()} onClick={handleGenerateLook}>
                {generatingLook ? 'Generating…' : 'Generate look'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
