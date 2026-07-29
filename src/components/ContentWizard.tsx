'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@/domain/types';
import { ContentItem, VIDEO_CONTENT_TYPES } from '@/domain/types';
import { can } from '@/lib/permissions';
import { Platform } from '@/integrations';
import { useToast } from '@/components/Toast';
import {
  saveBodyAction, approveTextAction,
  generateVideoAction, getVideoStatusAction, confirmVideoAction,
  confirmDisclosureAction, publishAction, scheduleWithTimeAction,
} from '@/app/actions';

type WizardStep = 'review' | 'video' | 'disclosure' | 'publish';

const STEP_LABELS: Record<WizardStep, string> = {
  review: 'Review draft',
  video: 'Generate video',
  disclosure: 'Disclosure',
  publish: 'Publish',
};

const CONTENT_TYPE_PLATFORMS: Record<string, Platform[]> = {
  social_post:    ['instagram', 'facebook', 'x', 'linkedin', 'tiktok'],
  reel:           ['instagram', 'tiktok', 'youtube'],
  press_release:  ['facebook', 'linkedin'],
  ad_copy:        ['instagram', 'facebook', 'x', 'linkedin'],
  talking_points: ['linkedin'],
};

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
  videoSettings,
  role,
}: {
  item: ContentItem;
  hasDisclosure: boolean;
  requiredDisclosures: RequiredDisclosure[];
  videoSettings?: {
    avatarId?: string;
    voiceId?: string;
    background?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
  };
  role: Role;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const steps = getSteps(item);
  const currentStep = getCurrentStep(item, hasDisclosure);
  const stepIndex = steps.indexOf(currentStep);

  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>(CONTENT_TYPE_PLATFORMS[item.type] ?? []);
  const [videoId, setVideoId] = useState<string | null>(item.videoJobId ?? null);
  const [videoStatus, setVideoStatus] = useState<'idle' | 'generating' | 'ready' | 'failed' | 'timed_out'>(
    item.videoStatus === 'processing' && !item.mediaUrl ? 'generating' : 'idle',
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(item.mediaUrl ?? null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [dateMonth, setDateMonth] = useState('');
  const [dateDay, setDateDay] = useState('');
  const [dateYear, setDateYear] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [videoOverride, setVideoOverride] = useState<{
    background: string;
    aspectRatio: '16:9' | '9:16' | '1:1';
  }>({
    background: videoSettings?.background ?? 'plain',
    aspectRatio: videoSettings?.aspectRatio ?? '16:9',
  });
  const [disclosureTexts, setDisclosureTexts] = useState<string[]>(
    requiredDisclosures.map(d => d.disclosureText),
  );

  useEffect(() => {
    // American date-entry order (month, day, year) is the whole point of
    // splitting this into three fields — a native date input renders in
    // whatever order the visitor's OS locale dictates, not necessarily MM/DD/YYYY.
    if (dateMonth && dateDay && dateYear.length === 4 && timeStr) {
      setScheduledAt(`${dateYear}-${dateMonth.padStart(2, '0')}-${dateDay.padStart(2, '0')}T${timeStr}`);
    } else {
      setScheduledAt('');
    }
  }, [dateMonth, dateDay, dateYear, timeStr]);

  const run = useCallback(async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMsg?: string,
  ) => {
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'Something went wrong.');
    } else {
      if (successMsg) toast(successMsg);
      router.refresh();
    }
  }, [router, toast]);

  useEffect(() => {
    if (!videoId || videoStatus !== 'generating') return;
    const MAX_ATTEMPTS = 60; // 60 × 5s = 5 minutes, then surface a "check later" state
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      const result = await getVideoStatusAction(videoId);
      if (result.status === 'completed' && result.url) {
        setVideoStatus('ready');
        setVideoUrl(result.url);
        clearInterval(interval);
      } else if (result.status === 'failed') {
        setVideoStatus('failed');
        clearInterval(interval);
      } else if (attempts >= MAX_ATTEMPTS) {
        setVideoStatus('timed_out');
        clearInterval(interval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [videoId, videoStatus]);

  async function handleGenerateVideo() {
    setBusy(true);
    setError('');
    const result = await generateVideoAction(item.id, item.body, videoOverride);
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
          background: 'var(--accent-grad)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', margin: '0 auto 16px', color: 'var(--accent-ink)', fontSize: 22,
          boxShadow: '0 4px 16px rgba(249,115,22,0.35), inset 0 1px 0 rgba(255,255,255,0.35)',
        }}>✓</div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Published</h3>
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
      <div className="stepper">
        {steps.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
              <div className={`step${active ? ' active' : done ? ' done' : ''}`}>
                <span className="marker">{done ? '✓' : i + 1}</span>
                {STEP_LABELS[step]}
              </div>
              {i < steps.length - 1 && (
                <div className={`connector${i < stepIndex ? ' done' : ''}`} />
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
            {can(role, 'approve') ? (
              <button
                className="btn primary"
                style={{ width: '100%' }}
                disabled={busy}
                onClick={() => run(() => approveTextAction(item.id))}
              >
                {busy ? 'Saving…' : 'Looks good — Continue →'}
              </button>
            ) : (
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                Approval requires manager or approver access.
              </p>
            )}
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
                {/* Video customization */}
                <div style={{ margin: '14px 0', padding: 14, background: 'var(--bg-hover)', borderRadius: 8 }}>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Video format</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {([
                      { ratio: '16:9', label: 'YouTube · Landscape' },
                      { ratio: '9:16', label: 'TikTok/Reels/Stories · Vertical' },
                      { ratio: '1:1',  label: 'Instagram · Square' },
                    ] as const).map(({ ratio, label }) => (
                      <button key={ratio} type="button" className={`btn${videoOverride.aspectRatio === ratio ? ' active' : ''}`}
                        onClick={() => setVideoOverride(v => ({ ...v, aspectRatio: ratio }))}
                        style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 12px' }}
                      >
                        <span style={{ fontWeight: 700 }}>{ratio}</span>
                        <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>{label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                    Default format can be changed in{' '}
                    <a href="/avatars" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Avatars</a>
                  </div>
                </div>
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
                {can(role, 'approve') ? (
                  <button
                    className="btn primary"
                    style={{ width: '100%' }}
                    disabled={busy}
                    onClick={() => run(() => confirmVideoAction(item.id, videoUrl))}
                  >
                    {busy ? 'Saving…' : 'Video looks good — Continue →'}
                  </button>
                ) : (
                  <p className="muted" style={{ fontSize: 13 }}>
                    Approval requires manager or approver access.
                  </p>
                )}
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
            {videoStatus === 'timed_out' && (
              <div>
                <div className="error">
                  This is taking longer than expected. Your video may still be processing —
                  leave this page and check back in a few minutes.
                </div>
                <button className="btn" style={{ marginTop: 12 }} onClick={() => router.refresh()}>
                  Refresh
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
                {can(role, 'approve') ? (
                  <button
                    className="btn primary"
                    style={{ width: '100%' }}
                    disabled={busy}
                    onClick={() => run(() => confirmVideoAction(item.id, item.mediaUrl!))}
                  >
                    {busy ? 'Saving…' : 'Video looks good — Continue →'}
                  </button>
                ) : (
                  <p className="muted" style={{ fontSize: 13 }}>
                    Approval requires manager or approver access.
                  </p>
                )}
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
              before publishing. Edit the wording to match your state&apos;s requirements — it
              will be appended to every post automatically.
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
                  <textarea
                    className="input"
                    value={disclosureTexts[i] ?? ''}
                    onChange={e => setDisclosureTexts(texts => {
                      const next = [...texts];
                      next[i] = e.target.value;
                      return next;
                    })}
                    style={{ minHeight: 70, fontStyle: 'italic', lineHeight: 1.6 }}
                    placeholder="Enter the disclosure text required in this jurisdiction…"
                  />
                  {!disclosureTexts[i]?.trim() && (
                    <div className="error" style={{ marginTop: 6, fontSize: 12 }}>
                      Disclosure text is required.
                    </div>
                  )}
                </div>
              ))
            )}
            <div className="spacer-y" />
            <button
              className="btn primary"
              style={{ width: '100%' }}
              disabled={busy || disclosureTexts.some(t => !t.trim())}
              onClick={() => run(() => confirmDisclosureAction(item.id, disclosureTexts))}
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

            {/* Platforms */}
            <div className="eyebrow" style={{ marginBottom: 8 }}>Platforms</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {(CONTENT_TYPE_PLATFORMS[item.type] ?? []).map(p => {
                const selected = platforms.includes(p);
                return (
                  <label key={p} className={`chip${selected ? ' on' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => togglePlatform(p)} style={{ display: 'none' }} />
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </label>
                );
              })}
            </div>

            {/* Timing toggle */}
            <div className="eyebrow" style={{ marginBottom: 8 }}>Timing</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {(['now', 'later'] as const).map(m => (
                <button key={m} type="button" className={`btn${scheduleMode === m ? ' active' : ''}`}
                  onClick={() => setScheduleMode(m)}>
                  {m === 'now' ? 'Publish now' : 'Schedule for later'}
                </button>
              ))}
            </div>

            {scheduleMode === 'later' && (
              <div style={{ marginBottom: 20 }}>
                <label className="field-label">Date (MM/DD/YYYY) &amp; time</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="number" inputMode="numeric" placeholder="MM" min={1} max={12}
                    className="input" style={{ width: 56, textAlign: 'center' }}
                    value={dateMonth} onChange={e => setDateMonth(e.target.value.slice(0, 2))}
                  />
                  <span className="muted">/</span>
                  <input
                    type="number" inputMode="numeric" placeholder="DD" min={1} max={31}
                    className="input" style={{ width: 56, textAlign: 'center' }}
                    value={dateDay} onChange={e => setDateDay(e.target.value.slice(0, 2))}
                  />
                  <span className="muted">/</span>
                  <input
                    type="number" inputMode="numeric" placeholder="YYYY" min={new Date().getFullYear()} max={2100}
                    className="input" style={{ width: 76, textAlign: 'center' }}
                    value={dateYear} onChange={e => setDateYear(e.target.value.slice(0, 4))}
                  />
                  <input
                    type="time" className="input" style={{ width: 130, marginLeft: 8 }}
                    value={timeStr} onChange={e => setTimeStr(e.target.value)}
                  />
                  <select className="input" style={{ width: 150 }} value={timezone} onChange={e => setTimezone(e.target.value)}>
                    {[
                      'America/New_York', 'America/Chicago', 'America/Denver',
                      'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
                    ].map(tz => (
                      <option key={tz} value={tz}>{tz.replace('America/', '').replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                {scheduledAt && new Date(scheduledAt) < new Date(Date.now() + 5 * 60 * 1000) && (
                  <div className="error" style={{ marginTop: 6, fontSize: 12 }}>
                    Pick a time at least 5 minutes from now.
                  </div>
                )}
              </div>
            )}

            {item.mediaUrl && (
              <div style={{ marginBottom: 20 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Video</div>
                <video src={item.mediaUrl} controls style={{ width: '100%', maxWidth: 400, borderRadius: 8, background: '#000' }} />
              </div>
            )}

            {scheduleMode === 'now' ? (
              can(role, 'publish') ? (
                <button className="btn primary" style={{ width: '100%' }}
                  disabled={busy || platforms.length === 0}
                  onClick={() => run(() => publishAction(item.id, platforms), 'Published successfully!')}>
                  {busy ? 'Publishing…' : `Publish to ${platforms.length} platform${platforms.length !== 1 ? 's' : ''}`}
                </button>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>Publishing requires manager access.</p>
              )
            ) : (
              can(role, 'schedule') ? (
                <button className="btn primary" style={{ width: '100%' }}
                  disabled={busy || platforms.length === 0 || !scheduledAt || new Date(scheduledAt) < new Date(Date.now() + 5 * 60 * 1000)}
                  onClick={() => run(() => scheduleWithTimeAction(item.id, platforms, scheduledAt, timezone), 'Content scheduled!')}>
                  {busy ? 'Scheduling…' : scheduledAt
                    ? `Schedule for ${new Date(scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                    : 'Pick a time above'}
                </button>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>Scheduling requires manager access.</p>
              )
            )}
            {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
