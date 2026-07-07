'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  createAvatarAction, checkAvatarStatusAction, setActiveAvatarAction, deleteAvatarAction, generatePromptLookAction,
} from '@/app/actions';
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

  const [lookModalAvatarId, setLookModalAvatarId] = useState<string | null>(null);
  const [lookName, setLookName] = useState('');
  const [lookPrompt, setLookPrompt] = useState('');
  const [generatingLook, setGeneratingLook] = useState(false);

  const trainingIds = avatars.filter(a => a.status === 'training').map(a => a.id).join(',');

  useEffect(() => {
    let cancelled = false;

    async function pollOnce() {
      const ids = trainingIds ? trainingIds.split(',') : [];
      if (ids.length === 0) return;
      await Promise.all(ids.map(id => checkAvatarStatusAction(id)));
      if (!cancelled) router.refresh();
    }

    // One-shot check on mount even if nothing is currently "training" locally,
    // so status catches up if the user navigated away and back.
    pollOnce();

    if (!trainingIds) return;
    const interval = setInterval(pollOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [trainingIds, router]);

  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [files]);

  function resetModal() {
    setModalOpen(false);
    setStep(1);
    setConsent(false);
    setFiles([]);
    setName('');
  }

  function handleFilesChosen(chosen: FileList | null) {
    if (!chosen) return;
    setFiles([...files, ...Array.from(chosen)].slice(0, MAX_PHOTOS));
  }

  async function handleSubmit() {
    setSubmitting(true);
    const formData = new FormData();
    formData.set('consent', consent ? 'on' : 'off');
    formData.set('name', name);
    files.forEach(f => formData.append('photos', f));
    const result = await createAvatarAction(formData);
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
      toast('Generating new look — it may take a minute to appear in the look picker below.');
      resetLookModal();
    } else {
      toast(result.error ?? 'Failed to generate look', 'error');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="eyebrow">Avatars</div>
        {canManage && (
          <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setModalOpen(true)}>
            + Create Avatar
          </button>
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
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                {a.name}
                {a.id === activeAvatarId && (
                  <span className="pill approved" style={{ fontSize: 10 }}>Active</span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {a.status === 'training' && 'Training… (usually a few minutes)'}
                {a.status === 'ready' && 'Ready'}
                {a.status === 'failed' && `Failed: ${a.errorMessage ?? 'Unknown error'}`}
              </div>
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8 }}>
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
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div className="card" style={{ width: 440, maxWidth: '90vw' }}>
            {step === 1 && (
              <>
                <h3 style={{ marginBottom: 12 }}>Step 1 of 3: Consent</h3>
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
                <h3 style={{ marginBottom: 12 }}>Step 2 of 3: Upload photos</h3>
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
                <h3 style={{ marginBottom: 12 }}>Step 3 of 3: Name this avatar</h3>
                <input className="input" placeholder="e.g. Studio look" value={name} onChange={e => setName(e.target.value)} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(2)}>← Back</button>
                  <button className="btn primary" disabled={submitting} onClick={handleSubmit}>
                    {submitting ? 'Creating…' : 'Create Avatar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {lookModalAvatarId && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div className="card" style={{ width: 440, maxWidth: '90vw' }}>
            <h3 style={{ marginBottom: 12 }}>Generate a new look</h3>
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
