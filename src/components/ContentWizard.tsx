'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { Role } from '@/domain/types';
import { ContentItem, VIDEO_CONTENT_TYPES, MEDIA_REQUIRED_PLATFORMS } from '@/domain/types';
import { can } from '@/lib/permissions';
import { zonedNaiveToUtc } from '@/lib/timezone';
import { Platform } from '@/integrations';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/icons';
import {
  saveBodyAction, approveTextAction, decideAction, submitAction, reviseAction,
  generateVideoAction, getVideoStatusAction, confirmVideoAction,
  confirmDisclosureAction, publishAction, scheduleWithTimeAction, unscheduleAction,
} from '@/app/actions';

type WizardStep = 'review' | 'video' | 'disclosure' | 'publish';
type Busy =
  | 'save' | 'submit' | 'approve' | 'reject' | 'revise'
  | 'video' | 'confirmVideo' | 'disclosure'
  | 'publish' | 'schedule' | 'unschedule'
  | null;
type ActionResult = { ok: boolean; error?: string };

const STEP_LABEL_KEYS: Record<WizardStep, string> = {
  review: 'steps.review',
  video: 'steps.video',
  disclosure: 'steps.disclosure',
  publish: 'steps.publish',
};

// Zones the picker offers. The browser's own zone (or the zone the item was
// scheduled in) is added to the list when it isn't one of these, so the
// <select> never silently displays a different zone than the one in state.
const US_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
];
const DEFAULT_TIMEZONE = 'America/New_York';
const MIN_LEAD_MS = 5 * 60 * 1000;

const CONTENT_TYPE_PLATFORMS: Record<string, Platform[]> = {
  social_post:    ['instagram', 'facebook', 'x', 'linkedin', 'tiktok'],
  reel:           ['instagram', 'tiktok', 'youtube'],
  press_release:  ['facebook', 'linkedin'],
  ad_copy:        ['instagram', 'facebook', 'x', 'linkedin'],
  talking_points: ['linkedin'],
};

const EDITABLE_STATUSES = ['draft', 'in_review', 'rejected'];

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
  // A legacy `scheduled` row with no scheduled_at (from before the disclosure
  // step stopped scheduling) still needs a real time picked.
  if (item.status === 'scheduled') return 'publish';
  return 'review';
}

// The wall-clock time of a UTC instant in `timeZone`, in the exact shape a
// <input type="datetime-local"> wants ("YYYY-MM-DDTHH:mm").
function utcToZonedNaive(iso: string | Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return '';
  }
}

function detectTimezone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

export function ContentWizard({
  item,
  hasDisclosure,
  disclosureText: attachedDisclosureText,
  requiredDisclosure,
  rejectionNote,
  videoSettings,
  role,
  connectedPlatforms,
}: {
  item: ContentItem;
  hasDisclosure: boolean;
  /** Text of the disclosure already attached (for the view-only step). */
  disclosureText?: string | null;
  requiredDisclosure: RequiredDisclosure | null;
  /** Latest rejection reason, shown on the rejected card. */
  rejectionNote?: string | null;
  videoSettings?: {
    avatarId?: string;
    voiceId?: string;
    background?: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
  };
  role: Role;
  connectedPlatforms: Platform[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const format = useFormatter();
  const t = useTranslations('contentWizard');
  const tc = useTranslations('common');
  const tType = useTranslations('content.types');
  const tNet = useTranslations('channels.networks');
  const uid = useId();

  const steps = getSteps(item);
  const isScheduled = item.status === 'scheduled' && !!item.scheduledAt;
  const isTerminal = item.status === 'published' || item.status === 'publishing' || isScheduled;
  // Once scheduled/published the last step is the "current" one (shown as
  // active, never as a clickable completed step), and everything before it is
  // done and viewable.
  const currentStep: WizardStep = isTerminal ? 'publish' : getCurrentStep(item, hasDisclosure);
  const stepIndex = steps.indexOf(currentStep);
  const canApprove = can(role, 'approve');
  const canPublish = can(role, 'publish');
  const canSchedule = can(role, 'schedule');
  const editable = EDITABLE_STATUSES.includes(item.status);
  const isVideoType = VIDEO_CONTENT_TYPES.includes(item.type);

  // Instagram/TikTok reject a post with no image/video attached — only offer
  // them once this content actually has media (only reels do today).
  const availablePlatforms = (CONTENT_TYPE_PLATFORMS[item.type] ?? [])
    .filter(p => item.mediaUrl || !MEDIA_REQUIRED_PLATFORMS.includes(p));
  const networkName = (p: string) => tNet(`${p}.name`);
  const networkList = (ps: string[]) => ps.map(networkName).join(', ');

  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState('');
  const [viewStep, setViewStep] = useState<WizardStep | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>(() => {
    const previous = (item.platforms ?? []).filter(p => availablePlatforms.includes(p) && connectedPlatforms.includes(p));
    return previous.length > 0 ? previous : availablePlatforms.filter(p => connectedPlatforms.includes(p));
  });
  const [videoId, setVideoId] = useState<string | null>(item.videoJobId ?? null);
  const [videoStatus, setVideoStatus] = useState<'idle' | 'generating' | 'ready' | 'failed' | 'timed_out'>(
    item.videoStatus === 'processing' && !item.mediaUrl ? 'generating' : 'idle',
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(item.mediaUrl ?? null);
  const [videoOverride, setVideoOverride] = useState<{ background: string; aspectRatio: '16:9' | '9:16' | '1:1' }>({
    background: videoSettings?.background ?? 'plain',
    aspectRatio: videoSettings?.aspectRatio ?? '16:9',
  });
  const [disclosureText, setDisclosureText] = useState(requiredDisclosure?.disclosureText ?? '');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const rejectNoteRef = useRef<HTMLTextAreaElement>(null);

  // Scheduling form
  const [rescheduling, setRescheduling] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [timezone, setTimezone] = useState(() => {
    if (item.timezone) return item.timezone;
    return detectTimezone() ?? DEFAULT_TIMEZONE;
  });
  const [scheduledAt, setScheduledAt] = useState(() =>
    item.scheduledAt ? utcToZonedNaive(item.scheduledAt, item.timezone ?? timezone) : '',
  );
  const [timeTouched, setTimeTouched] = useState(false);
  const timezoneOptions = Array.from(new Set([...US_TIMEZONES, timezone, item.timezone ?? ''].filter(Boolean)));
  const timezoneLabel = (tz: string) =>
    US_TIMEZONES.includes(tz) ? t(`publish.timezones.${tz}`) : tz.replace(/_/g, ' ');

  // scheduledAt is a naive "wall clock in `timezone`" string — compare it
  // through the selected zone, never via bare `new Date(scheduledAt)` (which
  // parses in the browser's zone and is wrong whenever the operator isn't in
  // the campaign's zone).
  let scheduledUtc: Date | null = null;
  let scheduleError = '';
  if (scheduledAt) {
    try {
      scheduledUtc = zonedNaiveToUtc(scheduledAt, timezone);
      if (scheduledUtc.getTime() < Date.now() + MIN_LEAD_MS) scheduleError = t('publish.pickTimeError');
    } catch {
      scheduleError = t('publish.invalidTime');
    }
  }
  const scheduleReady = !!scheduledUtc && !scheduleError;
  const dirty = editable && body !== item.body;

  async function run(key: Exclude<Busy, null>, fn: () => Promise<ActionResult>, successMsg?: string): Promise<boolean> {
    setBusy(key);
    setError('');
    try {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? t('errors.somethingWentWrong'));
        return false;
      }
      if (successMsg) toast(successMsg, 'success');
      router.refresh();
      return true;
    } catch (e) {
      console.error('[ContentWizard]', key, e);
      setError(t('errors.somethingWentWrong'));
      toast(t('errors.somethingWentWrong'), 'error');
      return false;
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!videoId || videoStatus !== 'generating') return;
    const MAX_ATTEMPTS = 60; // 60 × 5s = 5 minutes, then surface a "check later" state
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const result = await getVideoStatusAction(videoId);
        if (result.status === 'completed' && result.url) {
          setVideoStatus('ready');
          setVideoUrl(result.url);
          clearInterval(interval);
          return;
        }
        if (result.status === 'failed') {
          setVideoStatus('failed');
          clearInterval(interval);
          return;
        }
      } catch (e) {
        // A transient network blip must not kill the poll — try again next tick.
        console.error('[ContentWizard] video status poll failed', e);
      }
      if (attempts >= MAX_ATTEMPTS) {
        setVideoStatus('timed_out');
        clearInterval(interval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [videoId, videoStatus]);

  useEffect(() => {
    if (rejectOpen) rejectNoteRef.current?.focus();
  }, [rejectOpen]);

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleSave() {
    await run('save', () => saveBodyAction(item.id, body), t('review.savedToast'));
  }

  // Unsaved textarea edits are saved first, so approving never silently drops them.
  async function handleApprove() {
    await run('approve', async () => {
      if (dirty) {
        const saved = await saveBodyAction(item.id, body);
        if (!saved.ok) return saved;
      }
      return approveTextAction(item.id);
    }, t('review.approvedToast'));
  }

  async function handleSubmitForReview() {
    await run('submit', async () => {
      if (dirty) {
        const saved = await saveBodyAction(item.id, body);
        if (!saved.ok) return saved;
      }
      return submitAction(item.id);
    }, t('review.submittedToast'));
  }

  async function handleReject() {
    const ok = await run('reject', () => decideAction(item.id, 'reject', rejectNote), t('review.rejectedToast'));
    if (ok) { setRejectOpen(false); setRejectNote(''); }
  }

  async function handleRevise() {
    await run('revise', () => reviseAction(item.id), t('rejected.revisedToast'));
  }

  async function handleGenerateVideo() {
    setBusy('video');
    setError('');
    try {
      const result = await generateVideoAction(item.id, item.body, videoOverride);
      if (!result.ok) {
        setError(result.error ?? t('errors.videoGenerationFailed'));
        return;
      }
      if (result.videoId) {
        setVideoId(result.videoId);
        setVideoStatus('generating');
      }
    } catch (e) {
      console.error('[ContentWizard] generateVideo', e);
      setError(t('errors.videoGenerationFailed'));
      toast(t('errors.videoGenerationFailed'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirmVideo(url: string) {
    await run('confirmVideo', () => confirmVideoAction(item.id, url));
  }

  async function handleConfirmDisclosure() {
    await run('disclosure', () => confirmDisclosureAction(item.id, disclosureText), t('disclosure.confirmedToast'));
  }

  async function handlePublishNow(targets: Platform[]) {
    const ok = await confirm({
      title: isScheduled ? t('scheduled.publishNowConfirm.title') : t('publish.confirmPublish.title'),
      description: isScheduled
        ? t('scheduled.publishNowConfirm.description', { platforms: networkList(targets) })
        : t('publish.confirmPublish.description', { count: targets.length }),
      confirmLabel: isScheduled ? t('scheduled.publishNowConfirm.confirm') : t('publish.confirmPublish.confirm'),
    });
    if (!ok) return;
    await run('publish', () => publishAction(item.id, targets), t('publish.publishedToast'));
  }

  async function handleSchedule() {
    setTimeTouched(true);
    if (!scheduleReady) return;
    const ok = await run(
      'schedule',
      () => scheduleWithTimeAction(item.id, platforms, scheduledAt, timezone),
      rescheduling ? t('publish.rescheduledToast') : t('publish.scheduledToast'),
    );
    if (ok) setRescheduling(false);
  }

  async function handleUnschedule() {
    const ok = await confirm({
      title: t('scheduled.unscheduleConfirm.title'),
      description: t('scheduled.unscheduleConfirm.description'),
      confirmLabel: t('scheduled.unscheduleConfirm.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    await run('unschedule', () => unscheduleAction(item.id), t('scheduled.unscheduledToast'));
  }

  function startReschedule() {
    setRescheduling(true);
    setScheduleMode('later');
    setError('');
    if (item.scheduledAt) setScheduledAt(utcToZonedNaive(item.scheduledAt, timezone));
  }

  const togglePlatform = (p: Platform) =>
    setPlatforms(s => s.includes(p) ? s.filter(x => x !== p) : [...s, p]);

  // Completed steps are viewable (read-only); `null` returns to the live step.
  function showStep(step: WizardStep | null) {
    setError('');
    setViewStep(step);
  }

  // ── Shared fragments ────────────────────────────────────────────────────

  const errorBlock = error ? (
    <div className="alert alert-bad wizard-error" role="alert">
      <span className="icon"><Icon name="error" size={16} /></span>
      <div className="alert-body"><div className="alert-text">{error}</div></div>
    </div>
  ) : null;

  const stepper = (
    <ol className="stepper wizard-stepper" aria-label={t('stepperLabel')}>
      {steps.map((step, i) => {
        const done = i < stepIndex;
        const active = viewStep ? step === viewStep : i === stepIndex;
        const classes = `step${active ? ' active' : ''}${done ? ' done' : ''}`;
        const inner = (
          <>
            <span className="marker" aria-hidden="true">{done ? <Icon name="check" size={11} strokeWidth={2.5} /> : i + 1}</span>
            {t(STEP_LABEL_KEYS[step])}
          </>
        );
        return (
          <li key={step} className="wizard-stepper-item">
            {done ? (
              <button type="button" className={classes} aria-current={active ? 'step' : undefined} onClick={() => showStep(step)}>
                {inner}
              </button>
            ) : (
              <span className={classes} aria-current={active ? 'step' : undefined}>{inner}</span>
            )}
            {i < steps.length - 1 && <span className={`connector${done ? ' done' : ''}`} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );

  const backToCurrent = viewStep ? (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => showStep(null)}>
      <Icon name="arrow-left" size={14} />{t('backToCurrent')}
    </button>
  ) : null;

  const viewOnlyBadge = <span className="badge badge-neutral badge-sm">{t('viewOnly')}</span>;

  // ── Terminal / inactive states ──────────────────────────────────────────

  if (item.status === 'rejected' || item.status === 'archived') {
    const rejected = item.status === 'rejected';
    return (
      <div className="wizard-narrow">
        <div className="card wizard-state">
          <div className={`wizard-state-icon ${rejected ? 'is-bad' : 'is-neutral'}`} aria-hidden="true">
            <Icon name={rejected ? 'x' : 'inbox'} size={22} strokeWidth={2} />
          </div>
          <h2>{rejected ? t('rejected.title') : t('archived.title')}</h2>
          <p className="muted">{rejected ? t('rejected.description') : t('archived.description')}</p>
          {rejected && rejectionNote && (
            <blockquote className="wizard-quote">{t('rejected.reason', { note: rejectionNote })}</blockquote>
          )}
          <div className="btnrow wizard-state-actions">
            {rejected && (
              <button type="button" className="btn btn-primary" disabled={busy !== null} aria-busy={busy === 'revise'} onClick={handleRevise}>
                {busy === 'revise' ? t('rejected.revising') : t('rejected.revise')}
              </button>
            )}
            <Link className="btn" href="/content">{t('backToContent')}</Link>
          </div>
          {errorBlock}
        </div>
      </div>
    );
  }

  if (item.status === 'publishing') {
    return (
      <div className="wizard-narrow">
        <div className="card wizard-state">
          <div className="wizard-state-icon is-accent" aria-hidden="true"><span className="spinner" /></div>
          <h2>{t('publishing.title')}</h2>
          <p className="muted">{t('publishing.description')}</p>
          <div className="btnrow wizard-state-actions">
            <button type="button" className="btn" onClick={() => router.refresh()}><Icon name="refresh" size={14} />{t('publishing.refresh')}</button>
          </div>
        </div>
      </div>
    );
  }

  if (item.status === 'published') {
    return (
      <div className="wizard-narrow">
        <div className="card wizard-state">
          <div className="wizard-state-icon is-ok" aria-hidden="true"><Icon name="check" size={22} strokeWidth={2.5} /></div>
          <h2>{t('published.title')}</h2>
          <p className="muted">{t('published.description')}</p>
          {(item.platforms?.length ?? 0) > 0 && (
            <div className="wizard-platform-list">
              <span className="eyebrow">{t('published.platformsLabel')}</span>
              <div className="btnrow">
                {item.platforms!.map(p => <span key={p} className="badge badge-ok badge-dot">{networkName(p)}</span>)}
              </div>
            </div>
          )}
          {item.mediaUrl && <video src={item.mediaUrl} controls className="wizard-video" />}
          <div className="btnrow wizard-state-actions">
            <Link className="btn" href="/content">{t('published.backToContent')}</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── View-only rendering of a completed step ─────────────────────────────

  function renderViewStep(step: WizardStep) {
    if (step === 'review') {
      return (
        <div className="card card-sectioned">
          <div className="card-header">
            <div className="card-header-text">
              <h2>{t('review.yourDraft')}</h2>
              <span className="card-header-desc">{tType(item.type)} · {item.isAiGenerated ? t('review.aiGenerated') : t('review.humanWritten')}</span>
            </div>
            <div className="card-header-actions">{viewOnlyBadge}</div>
          </div>
          <div className="card-body">
            <p className="wizard-prose">{item.body}</p>
            <p className="field-hint">{t('review.editLocked')}</p>
          </div>
          <div className="card-footer">{backToCurrent}</div>
        </div>
      );
    }
    if (step === 'video') {
      return (
        <div className="card card-sectioned">
          <div className="card-header">
            <div className="card-header-text"><h2>{t('video.viewTitle')}</h2></div>
            <div className="card-header-actions">{viewOnlyBadge}</div>
          </div>
          <div className="card-body">
            {item.mediaUrl ? <video src={item.mediaUrl} controls className="wizard-video" /> : <p className="muted">{t('video.description')}</p>}
          </div>
          <div className="card-footer">{backToCurrent}</div>
        </div>
      );
    }
    if (step === 'disclosure') {
      return (
        <div className="card card-sectioned">
          <div className="card-header">
            <div className="card-header-text"><h2>{t('disclosure.attachedTitle')}</h2></div>
            <div className="card-header-actions">{viewOnlyBadge}</div>
          </div>
          <div className="card-body">
            <blockquote className="wizard-quote">{attachedDisclosureText ?? requiredDisclosure?.disclosureText}</blockquote>
          </div>
          <div className="card-footer">{backToCurrent}</div>
        </div>
      );
    }
    return null;
  }

  // ── Scheduled state ─────────────────────────────────────────────────────

  function renderScheduledCard() {
    const when = new Date(item.scheduledAt!);
    const tz = item.timezone ?? timezone;
    const targets = (item.platforms ?? []) as Platform[];
    return (
      <div className="card wizard-state wizard-scheduled">
        <div className="wizard-state-icon is-purple" aria-hidden="true"><Icon name="calendar" size={22} strokeWidth={2} /></div>
        <h2>{t('scheduled.title')}</h2>
        <p className="muted">{t('scheduled.description')}</p>
        <dl className="wizard-facts">
          <div>
            <dt>{t('scheduled.timeLabel')}</dt>
            <dd>
              <strong>{format.dateTime(when, { dateStyle: 'full', timeStyle: 'short', timeZone: tz })}</strong>
              <span className="subtle text-sm">{timezoneLabel(tz)}</span>
            </dd>
          </div>
          {targets.length > 0 && (
            <div>
              <dt>{t('scheduled.platformsLabel')}</dt>
              <dd><div className="btnrow">{targets.map(p => <span key={p} className="badge badge-purple badge-dot">{networkName(p)}</span>)}</div></dd>
            </div>
          )}
        </dl>
        {item.mediaUrl && <video src={item.mediaUrl} controls className="wizard-video" />}
        {canSchedule ? (
          <div className="btnrow wizard-state-actions">
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={startReschedule}>
              <Icon name="clock" size={14} />{t('scheduled.reschedule')}
            </button>
            <button type="button" className="btn" disabled={busy !== null} aria-busy={busy === 'unschedule'} onClick={handleUnschedule}>
              {busy === 'unschedule' ? t('scheduled.unscheduling') : t('scheduled.unschedule')}
            </button>
            {canPublish && targets.length > 0 && (
              <button type="button" className="btn btn-ghost" disabled={busy !== null} aria-busy={busy === 'publish'} onClick={() => handlePublishNow(targets)}>
                {busy === 'publish' ? t('publish.publishing') : t('scheduled.publishNowInstead')}
              </button>
            )}
          </div>
        ) : (
          <p className="field-hint">{t('scheduled.managerOnly')}</p>
        )}
        {errorBlock}
      </div>
    );
  }

  // ── Steps ───────────────────────────────────────────────────────────────

  function renderReview() {
    const nextKey = isVideoType ? 'review.nextVideo' : item.isAiGenerated ? 'review.nextDisclosure' : 'review.nextPublish';
    return (
      <div className="grid cols-2 wizard-review">
        <div className="card">
          <div className="section-header">
            <h2>{t('review.yourDraft')}</h2>
            <span className="subtle text-sm">{tType(item.type)} · {item.isAiGenerated ? t('review.aiGenerated') : t('review.humanWritten')}</span>
          </div>
          <Field label={t('review.contentLabel')} hint={dirty ? t('review.unsavedHint') : undefined}>
            {p => (
              <textarea
                {...p}
                value={body}
                onChange={e => setBody(e.target.value)}
                className="wizard-textarea"
                disabled={!editable}
              />
            )}
          </Field>
          {editable && (
            <div className="form-actions">
              <button type="button" className="btn" disabled={busy !== null || !dirty} aria-busy={busy === 'save'} onClick={handleSave}>
                {busy === 'save' ? t('saving') : t('review.saveEdits')}
              </button>
            </div>
          )}
        </div>
        <div className="card wizard-side">
          <h2>{t('review.readyToContinue')}</h2>
          <p className="muted">{t('review.readyDescription')}</p>
          <div className="alert alert-info">
            <span className="icon"><Icon name="info" size={16} /></span>
            <div className="alert-body"><div className="alert-text">{t(nextKey)}</div></div>
          </div>
          <div className="wizard-side-actions">
            {canApprove ? (
              <>
                <button type="button" className="btn btn-primary btn-block" disabled={busy !== null} aria-busy={busy === 'approve'} onClick={handleApprove}>
                  {busy === 'approve' ? t('saving') : t('review.continueButton')}
                </button>
                <button type="button" className="btn btn-danger-soft btn-block" disabled={busy !== null} onClick={() => setRejectOpen(true)}>
                  {t('review.reject')}
                </button>
              </>
            ) : item.status === 'draft' ? (
              <>
                <button type="button" className="btn btn-primary btn-block" disabled={busy !== null} aria-busy={busy === 'submit'} onClick={handleSubmitForReview}>
                  {busy === 'submit' ? t('saving') : t('review.submitForReview')}
                </button>
                <p className="field-hint">{t('review.submitHint')}</p>
              </>
            ) : (
              <p className="field-hint">{t('approvalRequired')}</p>
            )}
          </div>
          {errorBlock}
        </div>
      </div>
    );
  }

  function renderVideo() {
    const confirmButton = (url: string) => canApprove ? (
      <button type="button" className="btn btn-primary btn-block" disabled={busy !== null} aria-busy={busy === 'confirmVideo'} onClick={() => handleConfirmVideo(url)}>
        {busy === 'confirmVideo' ? t('saving') : t('video.continueButton')}
      </button>
    ) : (
      <p className="field-hint">{t('approvalRequired')}</p>
    );
    const showIdle = videoStatus === 'idle' && !videoUrl;
    const showExisting = videoStatus === 'idle' && !!item.mediaUrl;
    return (
      <div className="grid cols-2">
        <div className="card">
          <div className="section-header">
            <h2>{t('video.scriptTitle')}</h2>
            <span className="subtle text-sm">{t('video.spokenByAvatar')}</span>
          </div>
          <p className="wizard-prose">{item.body}</p>
        </div>
        <div className="card wizard-side">
          <h2>{t('video.avatarVideoTitle')}</h2>
          {showIdle && (
            <>
              <p className="muted">{t('video.description')}</p>
              <fieldset className="field wizard-format">
                <legend className="field-label">{t('video.formatLabel')}</legend>
                <div className="wizard-format-options" role="radiogroup" aria-label={t('video.formatLabel')}>
                  {([
                    { ratio: '16:9', labelKey: 'video.format.youtube' },
                    { ratio: '9:16', labelKey: 'video.format.tiktok' },
                    { ratio: '1:1',  labelKey: 'video.format.instagram' },
                  ] as const).map(({ ratio, labelKey }) => (
                    <label key={ratio} className={`wizard-format-option${videoOverride.aspectRatio === ratio ? ' on' : ''}`}>
                      <input
                        type="radio"
                        name={`${uid}-ratio`}
                        value={ratio}
                        checked={videoOverride.aspectRatio === ratio}
                        onChange={() => setVideoOverride(v => ({ ...v, aspectRatio: ratio }))}
                      />
                      <span className="wizard-format-ratio num">{ratio}</span>
                      <span className="wizard-format-label">{t(labelKey)}</span>
                    </label>
                  ))}
                </div>
                <span className="field-hint">
                  {t('video.defaultFormatNote')} <Link className="link" href="/avatars">{t('video.avatarsLink')}</Link>
                </span>
              </fieldset>
              <button type="button" className="btn btn-primary btn-block" disabled={busy !== null} aria-busy={busy === 'video'} onClick={handleGenerateVideo}>
                {busy === 'video' ? t('video.startingButton') : t('video.generateButton')}
              </button>
            </>
          )}
          {videoStatus === 'generating' && (
            <div className="wizard-generating" role="status">
              <p className="muted">{t('video.generatingText')}</p>
              <div className="wizard-progress" aria-hidden="true"><span /></div>
              <p className="field-hint">{t('video.generatingNote')}</p>
            </div>
          )}
          {videoStatus === 'ready' && videoUrl && (
            <>
              <video src={videoUrl} controls className="wizard-video" />
              {confirmButton(videoUrl)}
            </>
          )}
          {videoStatus === 'failed' && (
            <div className="stack">
              <div className="alert alert-bad" role="alert">
                <span className="icon"><Icon name="error" size={16} /></span>
                <div className="alert-body"><div className="alert-text">{t('video.generationFailedMessage')}</div></div>
              </div>
              <button type="button" className="btn" disabled={busy !== null} aria-busy={busy === 'video'} onClick={handleGenerateVideo}>
                <Icon name="refresh" size={14} />{t('video.retry')}
              </button>
            </div>
          )}
          {videoStatus === 'timed_out' && (
            <div className="stack">
              <div className="alert alert-warn" role="status">
                <span className="icon"><Icon name="clock" size={16} /></span>
                <div className="alert-body"><div className="alert-text">{t('video.timedOutMessage')}</div></div>
              </div>
              <button type="button" className="btn" onClick={() => router.refresh()}>
                <Icon name="refresh" size={14} />{t('video.refresh')}
              </button>
            </div>
          )}
          {showExisting && (
            <>
              <video src={item.mediaUrl!} controls className="wizard-video" />
              {confirmButton(item.mediaUrl!)}
            </>
          )}
          {errorBlock}
        </div>
      </div>
    );
  }

  function renderDisclosure() {
    const empty = !disclosureText.trim();
    return (
      <div className="wizard-narrow">
        <div className="card">
          <h2>{t('disclosure.title')}</h2>
          <p className="muted">{t('disclosure.description')}</p>
          <div className="wizard-disclosure">
            <Field
              label={requiredDisclosure?.placement ?? t('disclosure.defaultPlacement')}
              error={empty ? t('disclosure.textRequired') : undefined}
            >
              {p => (
                <textarea
                  {...p}
                  value={disclosureText}
                  onChange={e => setDisclosureText(e.target.value)}
                  className="wizard-disclosure-text"
                  placeholder={t('disclosure.textPlaceholder')}
                />
              )}
            </Field>
          </div>
          {canSchedule ? (
            <button type="button" className="btn btn-primary btn-block" disabled={busy !== null || empty} aria-busy={busy === 'disclosure'} onClick={handleConfirmDisclosure}>
              {busy === 'disclosure' ? t('disclosure.confirming') : t('disclosure.confirmButton')}
            </button>
          ) : (
            <p className="field-hint">{t('publish.schedulingRequiresManager')}</p>
          )}
          {errorBlock}
        </div>
      </div>
    );
  }

  function renderPublish() {
    const noChannels = connectedPlatforms.length === 0;
    const someUnconnected = availablePlatforms.some(p => !connectedPlatforms.includes(p));
    const mediaFiltered = availablePlatforms.length < (CONTENT_TYPE_PLATFORMS[item.type]?.length ?? 0);
    const nowMin = utcToZonedNaive(new Date(), timezone);
    const later = rescheduling || scheduleMode === 'later';
    const nothingSelected = platforms.length === 0;
    return (
      <div className="wizard-narrow">
        <div className="card">
          <div className="section-header">
            <h2>{rescheduling ? t('publish.rescheduleTitle') : t('publish.title')}</h2>
            {rescheduling && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRescheduling(false); setError(''); }}>
                {t('publish.cancel')}
              </button>
            )}
          </div>

          <fieldset className="field">
            <legend className="field-label">{t('publish.platformsLabel')}</legend>
            <div className="btnrow">
              {availablePlatforms.map(p => {
                const connected = connectedPlatforms.includes(p);
                const selected = connected && platforms.includes(p);
                return (
                  <label key={p} className={`chip${selected ? ' on' : ''}${connected ? '' : ' is-disabled'}`} title={connected ? undefined : t('publish.notConnectedNote')}>
                    <input type="checkbox" checked={selected} disabled={!connected} onChange={() => togglePlatform(p)} />
                    {networkName(p)}
                  </label>
                );
              })}
            </div>
            {noChannels ? (
              <div className="alert alert-warn wizard-inline-alert">
                <span className="icon"><Icon name="channels" size={16} /></span>
                <div className="alert-body">
                  <div className="alert-title">{t('publish.noChannelsTitle')}</div>
                  <div className="alert-text">{t('publish.noChannelsBody')}</div>
                  <div className="alert-actions"><Link href="/channels" className="btn btn-sm btn-primary">{t('publish.manageChannels')}</Link></div>
                </div>
              </div>
            ) : (
              <>
                {nothingSelected && <span className="field-error" role="status">{t('publish.noPlatformsHint')}</span>}
                {someUnconnected && (
                  <span className="field-hint">{t('publish.notConnectedNote')} <Link className="link" href="/channels">{t('publish.manageChannels')}</Link></span>
                )}
              </>
            )}
            {mediaFiltered && <span className="field-hint">{t('publish.mediaRequiredNote')}</span>}
          </fieldset>

          {!rescheduling && (
            <div className="field">
              <span className="field-label" id={`${uid}-timing`}>{t('publish.timingLabel')}</span>
              <div className="segmented" role="group" aria-labelledby={`${uid}-timing`}>
                <button type="button" aria-pressed={scheduleMode === 'now'} onClick={() => { setScheduleMode('now'); setError(''); }}>
                  <Icon name="send" size={14} />{t('publish.publishNow')}
                </button>
                <button type="button" aria-pressed={scheduleMode === 'later'} onClick={() => { setScheduleMode('later'); setError(''); }}>
                  <Icon name="calendar" size={14} />{t('publish.scheduleForLater')}
                </button>
              </div>
            </div>
          )}

          {later && (
            <div className="field-row wizard-schedule">
              <Field label={t('publish.dateTimeLabel')} error={timeTouched || scheduledAt ? scheduleError || undefined : undefined} required>
                {p => (
                  <input
                    {...p}
                    type="datetime-local"
                    value={scheduledAt}
                    min={nowMin}
                    step={60}
                    required
                    onChange={e => { setScheduledAt(e.target.value); setTimeTouched(true); }}
                  />
                )}
              </Field>
              <Field label={t('publish.timezoneLabel')}>
                {p => (
                  <select {...p} value={timezone} onChange={e => setTimezone(e.target.value)}>
                    {timezoneOptions.map(tz => <option key={tz} value={tz}>{timezoneLabel(tz)}</option>)}
                  </select>
                )}
              </Field>
            </div>
          )}

          {item.mediaUrl && (
            <div className="field">
              <span className="field-label">{t('publish.videoLabel')}</span>
              <video src={item.mediaUrl} controls className="wizard-video wizard-video-sm" />
            </div>
          )}

          {!later ? (
            canPublish ? (
              <button
                type="button"
                className="btn btn-primary btn-block btn-lg"
                disabled={busy !== null || nothingSelected}
                aria-busy={busy === 'publish'}
                onClick={() => handlePublishNow(platforms)}
              >
                {busy === 'publish' ? t('publish.publishing') : t('publish.publishButton', { count: platforms.length })}
              </button>
            ) : (
              <p className="field-hint">{t('publish.publishingRequiresManager')}</p>
            )
          ) : (
            canSchedule ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-block btn-lg"
                  disabled={busy !== null || nothingSelected || !scheduleReady}
                  aria-busy={busy === 'schedule'}
                  onClick={handleSchedule}
                >
                  {busy === 'schedule'
                    ? t('publish.scheduling')
                    : rescheduling
                      ? t('publish.rescheduleButton')
                      : scheduleReady
                        ? t('publish.scheduleFor', { date: format.dateTime(scheduledUtc!, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone }) })
                        : t('publish.pickTimeAbove')}
                </button>
                <p className="field-hint wizard-center">{t('publish.scheduleHint')}</p>
              </>
            ) : (
              <p className="field-hint">{t('publish.schedulingRequiresManager')}</p>
            )
          )}
          {errorBlock}
        </div>
      </div>
    );
  }

  const activeStep: WizardStep | null = viewStep ?? (isScheduled && !rescheduling ? null : currentStep);

  return (
    <div className="wizard">
      {stepper}

      {viewStep ? renderViewStep(viewStep)
        : isScheduled && !rescheduling ? renderScheduledCard()
        : activeStep === 'review' ? renderReview()
        : activeStep === 'video' ? renderVideo()
        : activeStep === 'disclosure' ? renderDisclosure()
        : renderPublish()}

      <Dialog
        open={rejectOpen}
        onClose={() => { if (busy !== 'reject') setRejectOpen(false); }}
        title={t('review.rejectDialog.title')}
        description={t('review.rejectDialog.description')}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRejectOpen(false)} disabled={busy === 'reject'}>
              {tc('confirm.cancel')}
            </button>
            <button type="button" className="btn btn-danger" onClick={handleReject} disabled={busy !== null} aria-busy={busy === 'reject'}>
              {busy === 'reject' ? t('review.rejectDialog.rejecting') : t('review.rejectDialog.confirm')}
            </button>
          </>
        }
      >
        <Field label={t('review.rejectDialog.reasonLabel')} htmlFor={`${uid}-reject-note`}>
          <textarea
            id={`${uid}-reject-note`}
            ref={rejectNoteRef}
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            placeholder={t('review.rejectDialog.reasonPlaceholder')}
            className="wizard-reject-note"
            maxLength={500}
          />
        </Field>
      </Dialog>
    </div>
  );
}
