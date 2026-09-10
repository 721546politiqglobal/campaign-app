'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Role } from '@/domain/types';
import { ContentItem, VIDEO_CONTENT_TYPES, MEDIA_REQUIRED_PLATFORMS } from '@/domain/types';
import { can } from '@/lib/permissions';
import { zonedNaiveToUtc } from '@/lib/timezone';
import { Platform } from '@/integrations';
import { useToast } from '@/components/Toast';
import {
  saveBodyAction, approveTextAction,
  generateVideoAction, getVideoStatusAction, confirmVideoAction,
  confirmDisclosureAction, publishAction, scheduleWithTimeAction,
} from '@/app/actions';

type WizardStep = 'review' | 'video' | 'disclosure' | 'publish';

const STEP_LABEL_KEYS: Record<WizardStep, string> = {
  review: 'steps.review',
  video: 'steps.video',
  disclosure: 'steps.disclosure',
  publish: 'steps.publish',
};

const US_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
];

const CONTENT_TYPE_PLATFORMS: Record<string, Platform[]> = {
  social_post:    ['instagram', 'facebook', 'x', 'linkedin', 'tiktok'],
  reel:           ['instagram', 'tiktok', 'youtube'],
  press_release:  ['facebook', 'linkedin'],
  ad_copy:        ['instagram', 'facebook', 'x', 'linkedin'],
  talking_points: ['linkedin'],
};

export interface RequiredDisclosure {
  disclosureText: string;
  placement: string;
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
  requiredDisclosure,
  videoSettings,
  role,
}: {
  item: ContentItem;
  hasDisclosure: boolean;
  requiredDisclosure: RequiredDisclosure | null;
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
  const t = useTranslations('contentWizard');
  const tType = useTranslations('content.types');
  const steps = getSteps(item);
  const currentStep = getCurrentStep(item, hasDisclosure);
  const stepIndex = steps.indexOf(currentStep);

  // Instagram/TikTok reject a post with no image/video attached — only offer
  // them once this content actually has media (only reels do today).
  const availablePlatforms = (CONTENT_TYPE_PLATFORMS[item.type] ?? [])
    .filter(p => item.mediaUrl || !MEDIA_REQUIRED_PLATFORMS.includes(p));

  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>(availablePlatforms);
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
  const [timezone, setTimezone] = useState(() => {
    // Defaulting to the operator's own OS/browser zone silently breaks
    // scheduling whenever that zone isn't one of the options below: the
    // native <select> falls back to displaying its first option ("New
    // York") while the real state stays whatever was detected, so the UI
    // shows one timezone but converts using another (verified live — a
    // Pakistan-based browser scheduling for a US campaign silently used
    // Asia/Karachi while the dropdown read "New York"). Only trust the
    // detected zone when it's actually one of the supported US options.
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return US_TIMEZONES.includes(detected) ? detected : US_TIMEZONES[0];
  });
  const [videoOverride, setVideoOverride] = useState<{
    background: string;
    aspectRatio: '16:9' | '9:16' | '1:1';
  }>({
    background: videoSettings?.background ?? 'plain',
    aspectRatio: videoSettings?.aspectRatio ?? '16:9',
  });
  const [disclosureText, setDisclosureText] = useState(requiredDisclosure?.disclosureText ?? '');

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

  // scheduledAt is a naive "wall clock in `timezone`" string — comparing it
  // via bare `new Date(scheduledAt)` parses it in the *browser's* local zone
  // instead, which is wrong whenever the person scheduling isn't in the same
  // zone as the campaign (verified live: New York + a Pakistan-based browser
  // made every valid future time register as "not 5 minutes from now yet").
  // Convert through the actually-selected timezone before comparing/displaying.
  let scheduledUtc: Date | null = null;
  try {
    scheduledUtc = scheduledAt ? zonedNaiveToUtc(scheduledAt, timezone) : null;
  } catch {
    scheduledUtc = null;
  }

  const run = useCallback(async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMsg?: string,
  ) => {
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? t('errors.somethingWentWrong'));
    } else {
      if (successMsg) toast(successMsg);
      router.refresh();
    }
  }, [router, toast, t]);

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
      setError(result.error ?? t('errors.videoGenerationFailed'));
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
        <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{t('published.title')}</h3>
        <p className="muted">{t('published.description')}</p>
      </div>
    );
  }

  if (item.status === 'rejected' || item.status === 'archived') {
    return (
      <div className="card">
        <h2>{item.status === 'rejected' ? t('inactive.rejectedTitle') : t('inactive.archivedTitle')}</h2>
        <p className="muted">{t('inactive.description')}</p>
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
                {t(STEP_LABEL_KEYS[step])}
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
            <h2>{t('review.yourDraft')}</h2>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              {tType(item.type)} · {item.isAiGenerated ? t('review.aiGenerated') : t('review.humanWritten')}
            </div>
            <label className="field">
              <span className="cap">{t('review.contentLabel')}</span>
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
              {t('review.saveEdits')}
            </button>
          </div>
          <div className="card">
            <h2>{t('review.readyToContinue')}</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              {t('review.readyDescription')}
            </p>
            {VIDEO_CONTENT_TYPES.includes(item.type) && (
              <p className="muted" style={{ fontSize: 13, marginTop: 12, padding: '10px 12px', background: 'var(--bg-hover)', borderRadius: 6 }}>
                {t('review.nextVideo')}
              </p>
            )}
            {item.isAiGenerated && !VIDEO_CONTENT_TYPES.includes(item.type) && (
              <p className="muted" style={{ fontSize: 13, marginTop: 12, padding: '10px 12px', background: 'var(--bg-hover)', borderRadius: 6 }}>
                {t('review.nextDisclosure')}
              </p>
            )}
            {!item.isAiGenerated && !VIDEO_CONTENT_TYPES.includes(item.type) && (
              <p className="muted" style={{ fontSize: 13, marginTop: 12, padding: '10px 12px', background: 'var(--bg-hover)', borderRadius: 6 }}>
                {t('review.nextPublish')}
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
                {busy ? t('saving') : t('review.continueButton')}
              </button>
            ) : (
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                {t('approvalRequired')}
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
            <h2>{t('video.scriptTitle')}</h2>
            <div className="eyebrow" style={{ marginBottom: 10 }}>{t('video.spokenByAvatar')}</div>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: 'var(--text)' }}>
              {item.body}
            </p>
          </div>
          <div className="card">
            <h2>{t('video.avatarVideoTitle')}</h2>
            {videoStatus === 'idle' && !videoUrl && (
              <>
                <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
                  {t('video.description')}
                </p>
                {/* Video customization */}
                <div style={{ margin: '14px 0', padding: 14, background: 'var(--bg-hover)', borderRadius: 8 }}>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>{t('video.formatLabel')}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {([
                      { ratio: '16:9', labelKey: 'video.format.youtube' },
                      { ratio: '9:16', labelKey: 'video.format.tiktok' },
                      { ratio: '1:1',  labelKey: 'video.format.instagram' },
                    ] as const).map(({ ratio, labelKey }) => (
                      <button key={ratio} type="button" className={`btn${videoOverride.aspectRatio === ratio ? ' active' : ''}`}
                        onClick={() => setVideoOverride(v => ({ ...v, aspectRatio: ratio }))}
                        style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 12px' }}
                      >
                        <span style={{ fontWeight: 700 }}>{ratio}</span>
                        <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>{t(labelKey)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                    {t('video.defaultFormatNote')}{' '}
                    <a href="/avatars" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{t('video.avatarsLink')}</a>
                  </div>
                </div>
                <div className="spacer-y" />
                <button
                  className="btn primary"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={handleGenerateVideo}
                >
                  {busy ? t('video.startingButton') : t('video.generateButton')}
                </button>
              </>
            )}
            {videoStatus === 'generating' && (
              <div>
                <p className="muted" style={{ fontSize: 14 }}>{t('video.generatingText')}</p>
                <div style={{ marginTop: 16, height: 4, background: 'var(--bg-hover)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: '100%', background: 'linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite',
                    borderRadius: 2,
                  }} />
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  {t('video.generatingNote')}
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
                    {busy ? t('saving') : t('video.continueButton')}
                  </button>
                ) : (
                  <p className="muted" style={{ fontSize: 13 }}>
                    {t('approvalRequired')}
                  </p>
                )}
              </>
            )}
            {videoStatus === 'failed' && (
              <div>
                <div className="error">{t('video.generationFailedMessage')}</div>
                <button className="btn" style={{ marginTop: 12 }} onClick={handleGenerateVideo}>
                  {t('video.retry')}
                </button>
              </div>
            )}
            {videoStatus === 'timed_out' && (
              <div>
                <div className="error">
                  {t('video.timedOutMessage')}
                </div>
                <button className="btn" style={{ marginTop: 12 }} onClick={() => router.refresh()}>
                  {t('video.refresh')}
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
                    {busy ? t('saving') : t('video.continueButton')}
                  </button>
                ) : (
                  <p className="muted" style={{ fontSize: 13 }}>
                    {t('approvalRequired')}
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
            <h2>{t('disclosure.title')}</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              {t('disclosure.description')}
            </p>
            <div className="spacer-y" />
            <div style={{
              padding: 16,
              border: '1px solid var(--line)',
              borderRadius: 8,
              marginBottom: 10,
              background: 'var(--bg-hover)',
            }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{requiredDisclosure?.placement ?? t('disclosure.defaultPlacement')}</div>
              <textarea
                className="input"
                value={disclosureText}
                onChange={e => setDisclosureText(e.target.value)}
                style={{ minHeight: 70, fontStyle: 'italic', lineHeight: 1.6 }}
                placeholder={t('disclosure.textPlaceholder')}
              />
              {!disclosureText.trim() && (
                <div className="error" style={{ marginTop: 6, fontSize: 12 }}>
                  {t('disclosure.textRequired')}
                </div>
              )}
            </div>
            <div className="spacer-y" />
            <button
              className="btn primary"
              style={{ width: '100%' }}
              disabled={busy || !disclosureText.trim()}
              onClick={() => run(() => confirmDisclosureAction(item.id, disclosureText))}
            >
              {busy ? t('disclosure.confirming') : t('disclosure.confirmButton')}
            </button>
            {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </div>
      )}

      {/* Step: Publish */}
      {currentStep === 'publish' && (
        <div style={{ maxWidth: 620, margin: '0 auto', width: '100%' }}>
          <div className="card">
            <h2>{t('publish.title')}</h2>

            {/* Platforms */}
            <div className="eyebrow" style={{ marginBottom: 8 }}>{t('publish.platformsLabel')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {availablePlatforms.map(p => {
                const selected = platforms.includes(p);
                return (
                  <label key={p} className={`chip${selected ? ' on' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => togglePlatform(p)} style={{ display: 'none' }} />
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </label>
                );
              })}
            </div>
            {availablePlatforms.length < (CONTENT_TYPE_PLATFORMS[item.type]?.length ?? 0) && (
              <p className="muted" style={{ fontSize: 12, marginTop: -16, marginBottom: 24 }}>
                {t('publish.mediaRequiredNote')}
              </p>
            )}

            {/* Timing toggle */}
            <div className="eyebrow" style={{ marginBottom: 8 }}>{t('publish.timingLabel')}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {(['now', 'later'] as const).map(m => (
                <button key={m} type="button" className={`btn${scheduleMode === m ? ' active' : ''}`}
                  onClick={() => setScheduleMode(m)}>
                  {m === 'now' ? t('publish.publishNow') : t('publish.scheduleForLater')}
                </button>
              ))}
            </div>

            {scheduleMode === 'later' && (
              <div style={{ marginBottom: 20 }}>
                <label className="field-label">{t('publish.dateTimeLabel')}</label>
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
                    {US_TIMEZONES.map(tz => (
                      <option key={tz} value={tz}>{tz.replace('America/', '').replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                {scheduledUtc && scheduledUtc < new Date(Date.now() + 5 * 60 * 1000) && (
                  <div className="error" style={{ marginTop: 6, fontSize: 12 }}>
                    {t('publish.pickTimeError')}
                  </div>
                )}
              </div>
            )}

            {item.mediaUrl && (
              <div style={{ marginBottom: 20 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>{t('publish.videoLabel')}</div>
                <video src={item.mediaUrl} controls style={{ width: '100%', maxWidth: 400, borderRadius: 8, background: '#000' }} />
              </div>
            )}

            {scheduleMode === 'now' ? (
              can(role, 'publish') ? (
                <button className="btn primary" style={{ width: '100%' }}
                  disabled={busy || platforms.length === 0}
                  onClick={() => run(() => publishAction(item.id, platforms), t('publish.publishedToast'))}>
                  {busy ? t('publish.publishing') : t('publish.publishButton', { count: platforms.length })}
                </button>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>{t('publish.publishingRequiresManager')}</p>
              )
            ) : (
              can(role, 'schedule') ? (
                <button className="btn primary" style={{ width: '100%' }}
                  disabled={busy || platforms.length === 0 || !scheduledUtc || scheduledUtc < new Date(Date.now() + 5 * 60 * 1000)}
                  onClick={() => run(() => scheduleWithTimeAction(item.id, platforms, scheduledAt, timezone), t('publish.scheduledToast'))}>
                  {busy ? t('publish.scheduling') : scheduledUtc
                    ? t('publish.scheduleFor', { date: scheduledUtc.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }) })
                    : t('publish.pickTimeAbove')}
                </button>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>{t('publish.schedulingRequiresManager')}</p>
              )
            )}
            {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
