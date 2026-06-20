'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ContentItem, VIDEO_CONTENT_TYPES } from '@/domain/types';
import { Platform } from '@/integrations';
import {
  saveBodyAction, approveTextAction,
  generateVideoAction, getVideoStatusAction, confirmVideoAction,
  confirmDisclosureAction, publishAction,
} from '@/app/actions';

type WizardStep = 'review' | 'video' | 'disclosure' | 'publish';

const STEP_LABELS: Record<WizardStep, string> = {
  review: 'Review draft',
  video: 'Generate video',
  disclosure: 'Disclosure',
  publish: 'Publish',
};

const PLATFORMS: Platform[] = ['instagram', 'facebook', 'x', 'linkedin', 'tiktok', 'youtube'];

export interface RequiredDisclosure {
  jurisdiction: string;
  disclosureText: string;
  placement: string;
  needsLegalReview: boolean;
}

function getSteps(item: ContentItem): WizardStep[] {
  const steps: WizardStep[] = ['review'];
  if (VIDEO_CONTENT_TYPES.includes(item.type)) steps.push('video');
  if (item.isAiGenerated) steps.push('disclosure');
  steps.push('publish');
  return steps;
}

function getCurrentStep(item: ContentItem, hasDisclosure: boolean): WizardStep {
  if (item.status === 'draft') return 'review';
  if (item.status === 'in_review') return VIDEO_CONTENT_TYPES.includes(item.type) ? 'video' : 'review';
  if (item.status === 'approved') {
    if (item.isAiGenerated && !hasDisclosure) return 'disclosure';
    return 'publish';
  }
  if (item.status === 'scheduled') return 'publish';
  return 'review';
}

export function ContentWizard({
  item,
  hasDisclosure,
  requiredDisclosures,
}: {
  item: ContentItem;
  hasDisclosure: boolean;
  requiredDisclosures: RequiredDisclosure[];
}) {
  const router = useRouter();
  const steps = getSteps(item);
  const currentStep = getCurrentStep(item, hasDisclosure);
  const stepIndex = steps.indexOf(currentStep);

  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>(['instagram', 'facebook']);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<'idle' | 'generating' | 'ready' | 'failed'>('idle');
  const [videoUrl, setVideoUrl] = useState<string | null>(item.mediaUrl ?? null);

  const run = useCallback(async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Something went wrong.');
    } else {
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    if (!videoId || videoStatus !== 'generating') return;
    const interval = setInterval(async () => {
      const result = await getVideoStatusAction(videoId);
      if (result.status === 'completed' && result.url) {
        setVideoStatus('ready');
        setVideoUrl(result.url);
        clearInterval(interval);
      } else if (result.status === 'failed') {
        setVideoStatus('failed');
        clearInterval(interval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [videoId, videoStatus]);

  async function handleGenerateVideo() {
    setBusy(true);
    setError('');
    const result = await generateVideoAction(item.id, item.body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Video generation failed.');
      return;
    }
    if (result.videoId) {
      setVideoId(result.videoId);
      setVideoStatus('generating');
    }
  }

  const togglePlatform = (p: Platform) =>
    setPlatforms(s => s.includes(p) ? s.filter(x => x !== p) : [...s, p]);

  if (item.status === 'published') {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 32px' }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--accent)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', margin: '0 auto 16px', color: '#fff', fontSize: 22,
        }}>✓</div>
        <h2 style={{ margin: '0 0 8px' }}>Published</h2>
        <p className="muted">This content is live on all selected platforms.</p>
      </div>
    );
  }

  if (item.status === 'rejected' || item.status === 'archived') {
    return (
      <div className="card">
        <h2>{item.status === 'rejected' ? 'Rejected' : 'Archived'}</h2>
        <p className="muted">This content is no longer active.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 28, gap: 0 }}>
        {steps.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 14px', borderRadius: 20,
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : done ? 'var(--text-2)' : 'var(--text-3)',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                transition: 'all 0.2s',
              }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  border: `1.5px solid ${active ? '#fff' : done ? 'var(--accent)' : 'var(--line)'}`,
                  background: done ? 'var(--accent)' : 'transparent',
                  color: done ? '#fff' : 'inherit',
                }}>
                  {done ? '✓' : i + 1}
                </span>
                {STEP_LABELS[step]}
              </div>
              {i < steps.length - 1 && (
                <div style={{
                  width: 28, height: 1.5,
                  background: i < stepIndex ? 'var(--accent)' : 'var(--line)',
                  margin: '0 2px',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step: Review */}
      {currentStep === 'review' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Your draft</h2>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              {item.type.replace('_', ' ')} · {item.isAiGenerated ? 'AI-generated' : 'Human-written'}
            </div>
            <label className="field">
              <span className="cap">Content</span>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                style={{ minHeight: 220, lineHeight: 1.65 }}
              />
            </label>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(() => saveBodyAction(item.id, body))}
            >
              Save edits
            </button>
          </div>
          <div className="card">
            <h2>Ready to continue?</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Read through your draft. Make any edits on the left, then approve to continue.
            </p>
            {VIDEO_CONTENT_TYPES.includes(item.type) && (
              <p className="muted" style={{ fontSize: 13, marginTop: 12, padding: '10px 12px', background: 'var(--bg-hover)', borderRadius: 6 }}>
                Next: generate an avatar video of you delivering this script.
              </p>
            )}
            {item.isAiGenerated && !VIDEO_CONTENT_TYPES.includes(item.type) && (
              <p className="muted" style={{ fontSize: 13, marginTop: 12, padding: '10px 12px', background: 'var(--bg-hover)', borderRadius: 6 }}>
                Next: review and confirm the required AI disclosure.
              </p>
            )}
            {!item.isAiGenerated && !VIDEO_CONTENT_TYPES.includes(item.type) && (
              <p className="muted" style={{ fontSize: 13, marginTop: 12, padding: '10px 12px', background: 'var(--bg-hover)', borderRadius: 6 }}>
                Next: choose platforms and publish.
              </p>
            )}
            <div className="spacer-y" />
            <button
              className="btn primary"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => run(() => approveTextAction(item.id))}
            >
              {busy ? 'Saving…' : 'Looks good — Continue →'}
            </button>
            {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </div>
      )}

      {/* Step: Video */}
      {currentStep === 'video' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Script</h2>
            <div className="eyebrow" style={{ marginBottom: 10 }}>This will be spoken by your avatar</div>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--text)' }}>
              {item.body}
            </p>
          </div>
          <div className="card">
            <h2>Avatar video</h2>
            {videoStatus === 'idle' && !videoUrl && (
              <>
                <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
                  Your candidate avatar will deliver this script. Generation takes 2–4 minutes.
                </p>
                <div className="spacer-y" />
                <button
                  className="btn primary"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={handleGenerateVideo}
                >
                  {busy ? 'Starting…' : 'Generate avatar video'}
                </button>
              </>
            )}
            {videoStatus === 'generating' && (
              <div>
                <p className="muted" style={{ fontSize: 14 }}>Generating your video — this takes a couple of minutes.</p>
                <div style={{ marginTop: 16, height: 4, background: 'var(--bg-hover)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: '100%', background: 'linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite',
                    borderRadius: 2,
                  }} />
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  You can leave this page and come back — nothing will be lost.
                </p>
              </div>
            )}
            {videoStatus === 'ready' && videoUrl && (
              <>
                <video
                  src={videoUrl}
                  controls
                  style={{ width: '100%', borderRadius: 8, marginBottom: 16, background: '#000' }}
                />
                <button
                  className="btn primary"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() => run(() => confirmVideoAction(item.id, videoUrl))}
                >
                  {busy ? 'Saving…' : 'Video looks good — Continue →'}
                </button>
              </>
            )}
            {videoStatus === 'failed' && (
              <div>
                <div className="error">Video generation failed. Try again.</div>
                <button className="btn" style={{ marginTop: 12 }} onClick={handleGenerateVideo}>
                  Retry
                </button>
              </div>
            )}
            {item.mediaUrl && videoStatus === 'idle' && (
              <>
                <video
                  src={item.mediaUrl}
                  controls
                  style={{ width: '100%', borderRadius: 8, marginBottom: 16, background: '#000' }}
                />
                <button
                  className="btn primary"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() => run(() => confirmVideoAction(item.id, item.mediaUrl!))}
                >
                  {busy ? 'Saving…' : 'Video looks good — Continue →'}
                </button>
              </>
            )}
            {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </div>
      )}

      {/* Step: Disclosure */}
      {currentStep === 'disclosure' && (
        <div style={{ maxWidth: 620, margin: '0 auto', width: '100%' }}>
          <div className="card">
            <h2>Required AI disclosure</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Because this content was AI-generated, the following disclosure must be attached
              before publishing. It will be appended to every post automatically.
            </p>
            <div className="spacer-y" />
            {requiredDisclosures.length === 0 ? (
              <p className="muted">No disclosure required for your jurisdictions.</p>
            ) : (
              requiredDisclosures.map((d, i) => (
                <div key={i} style={{
                  padding: 16,
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  marginBottom: 10,
                  background: 'var(--bg-hover)',
                }}>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    {d.jurisdiction} · {d.placement}
                    {d.needsLegalReview && (
                      <span style={{
                        marginLeft: 8, padding: '1px 6px', borderRadius: 4,
                        background: 'color-mix(in srgb, var(--warn) 15%, transparent)',
                        color: 'var(--warn)', fontSize: 10, fontWeight: 700,
                      }}>Needs legal review</span>
                    )}
                  </div>
                  <p style={{ fontSize: 14, fontStyle: 'italic', lineHeight: 1.6, margin: 0 }}>
                    &ldquo;{d.disclosureText}&rdquo;
                  </p>
                </div>
              ))
            )}
            <div className="spacer-y" />
            <button
              className="btn primary"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => run(() => confirmDisclosureAction(item.id))}
            >
              {busy ? 'Confirming…' : 'Confirm disclosure — Continue →'}
            </button>
            {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </div>
      )}

      {/* Step: Publish */}
      {currentStep === 'publish' && (
        <div style={{ maxWidth: 620, margin: '0 auto', width: '100%' }}>
          <div className="card">
            <h2>Publish</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Select the platforms you want to publish to. The post goes out immediately.
            </p>
            <div className="spacer-y" />
            <div className="eyebrow" style={{ marginBottom: 10 }}>Platforms</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {PLATFORMS.map(p => {
                const selected = platforms.includes(p);
                return (
                  <label key={p} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 20,
                    border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
                    cursor: 'pointer', fontSize: 13,
                    fontWeight: selected ? 600 : 400,
                    background: selected ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                    color: selected ? 'var(--accent)' : 'var(--text-2)',
                    userSelect: 'none',
                    transition: 'all 0.15s',
                  }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => togglePlatform(p)}
                      style={{ display: 'none' }}
                    />
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </label>
                );
              })}
            </div>
            {item.mediaUrl && (
              <div style={{ marginBottom: 20 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Video</div>
                <video
                  src={item.mediaUrl}
                  controls
                  style={{ width: '100%', maxWidth: 400, borderRadius: 8, background: '#000' }}
                />
              </div>
            )}
            <button
              className="btn primary"
              style={{ width: '100%' }}
              disabled={busy || platforms.length === 0}
              onClick={() => run(() => publishAction(item.id, platforms))}
            >
              {busy
                ? 'Publishing…'
                : `Publish to ${platforms.length} platform${platforms.length !== 1 ? 's' : ''}`}
            </button>
            {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
