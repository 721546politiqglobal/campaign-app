'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { beginVoiceCloneUploadAction, finalizeVoiceCloneAction, checkVoiceCloneStatusAction, previewVoiceCloneAction } from '@/app/actions';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { useToast } from '@/components/Toast';

const POLL_MS = 5000;
const mediaRecorderSupported = typeof MediaRecorder !== 'undefined';

// Explicitly pick a supported MIME type instead of accepting the browser's
// silent default: Firefox's MediaRecorder defaults to "audio/ogg;codecs=opus"
// for an audio-only stream when no mimeType is specified, and letting each
// browser pick its own undocumented default makes behavior nondeterministic.
const PREFERRED_RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return PREFERRED_RECORDING_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
}

export function VoiceCloneManager({
  status,
  name,
  error,
  canManage,
}: {
  status: 'training' | 'ready' | 'failed' | null;
  name: string | null;
  error: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [audioSource, setAudioSource] = useState<'upload' | 'record'>('upload');
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [recordDurationWarning, setRecordDurationWarning] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // MediaRecorder.stop() is asynchronous — its onstop callback fires on a
  // later task, not synchronously. Set right before a stop() call that is
  // meant to *abandon* (not finish) a recording, so onstop knows to discard
  // the blob instead of resurrecting it into `file` after the caller already
  // moved on (e.g. switched to upload mode, or closed the modal).
  const abandonRecordingRef = useRef(false);

  useEffect(() => {
    if (!file) { setAudioPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setAudioPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Stops the microphone (releasing the browser/OS recording indicator) if
  // the component unmounts mid-recording, e.g. the owner navigates away.
  useEffect(() => {
    return () => { mediaStreamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  useEffect(() => {
    if (status !== 'training') return;
    let cancelled = false;
    async function pollOnce() {
      await checkVoiceCloneStatusAction();
      if (!cancelled) router.refresh();
    }
    const interval = setInterval(pollOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [status, router]);

  function resetModal() {
    setModalOpen(false);
    setStep(1);
    setConsent(false);
    setFile(null);
    setVoiceName('');
    setAudioPreviewUrl(null);
    setPreviewAudioUrl(null);
    setAudioSource('upload');
    setIsRecording(false);
    setRecordedSeconds(0);
    setRecordDurationWarning(null);
    setMicError(null);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      abandonRecordingRef.current = true;
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
  }

  function selectAudioSource(source: 'upload' | 'record') {
    if (isRecording) {
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      abandonRecordingRef.current = true;
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    }
    setAudioSource(source);
    setFile(null);
    setRecordDurationWarning(null);
    setMicError(null);
  }

  async function startRecording() {
    setMicError(null);
    abandonRecordingRef.current = false; // defensive: in case a previous abandon somehow didn't get consumed
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
        // Stop() is async — this fires after any synchronous code that
        // decided to abandon (not finish) the recording, e.g. switching to
        // upload mode or closing the modal. Discard the blob rather than
        // resurrecting it into `file`.
        if (abandonRecordingRef.current) { abandonRecordingRef.current = false; return; }
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType });
        // A near-empty blob means the recording was effectively instant
        // (start immediately followed by stop) — treat it as no recording
        // rather than sending a useless sample through the clone pipeline.
        if (blob.size < 1024) {
          setRecordDurationWarning(null);
          toast('Recording was too short — try again.', 'error');
          return;
        }
        const ext = recorder.mimeType.split(';')[0].split('/')[1] || 'webm';
        setFile(new File([blob], `recording.${ext}`, { type: recorder.mimeType }));
      };
      recorder.onerror = () => {
        // A mid-recording device error typically fires both onerror and
        // onstop for the same failure. Set the abandon flag here too, so the
        // onstop that follows discards whatever partial/corrupted chunks
        // were captured instead of silently turning them into `file`.
        abandonRecordingRef.current = true;
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
        setIsRecording(false);
        setMicError('Recording stopped unexpectedly — please try again.');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordedSeconds(0);
      setRecordDurationWarning(null);
      recordingTimerRef.current = setInterval(() => setRecordedSeconds(s => s + 1), 1000);
    } catch (err) {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
      const isPermissionIssue = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'NotFoundError');
      setMicError(isPermissionIssue
        ? 'Microphone access is needed to record — you can upload a file instead.'
        : "Recording isn't supported in this browser — please upload a file instead.");
    }
  }

  function stopRecording() {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (recordedSeconds < 30) setRecordDurationWarning('This recording looks shorter than 30 seconds — a longer sample usually clones more accurately.');
    else if (recordedSeconds > 300) setRecordDurationWarning('This recording looks longer than 5 minutes — HeyGen recommends under 5 minutes.');
  }

  async function handleSubmit() {
    if (!file) return;
    setSubmitting(true);

    const begin = await beginVoiceCloneUploadAction(consent, { name: file.name, type: file.type, size: file.size });
    if (!begin.ok) {
      setSubmitting(false);
      toast(begin.error, 'error');
      return;
    }
    if (!begin.path || !begin.token) {
      setSubmitting(false);
      toast('Failed to start voice cloning', 'error');
      return;
    }

    const { error: uploadError } = await supabaseBrowser.storage.from('media')
      .uploadToSignedUrl(begin.path, begin.token, file);
    if (uploadError) {
      setSubmitting(false);
      toast(`Upload failed: ${uploadError.message}`, 'error');
      return;
    }

    const result = await finalizeVoiceCloneAction(voiceName, begin.path);
    setSubmitting(false);
    if (result.ok) {
      toast('Voice cloning started — this can take a few minutes.');
      resetModal();
      router.refresh();
    } else {
      toast(result.error ?? 'Failed to clone voice', 'error');
    }
  }

  async function handlePlaySample() {
    if (previewAudioUrl) {
      new Audio(previewAudioUrl).play().catch(() => {
        setPreviewAudioUrl(null);
        toast('Couldn\'t play the sample — try again.', 'error');
      });
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await previewVoiceCloneAction();
      if (!result.ok || !result.audioUrl) {
        toast(result.ok ? 'Failed to generate voice preview' : result.error, 'error');
        return;
      }
      setPreviewAudioUrl(result.audioUrl);
      new Audio(result.audioUrl).play().catch(() => {
        setPreviewAudioUrl(null);
        toast('Couldn\'t play the sample — try again.', 'error');
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="eyebrow">Your voice</div>
        {canManage && status !== 'training' && (
          <button className="btn primary" style={{ fontSize: 13 }} onClick={() => setModalOpen(true)}>
            {status === 'ready' ? 'Replace voice' : 'Clone your voice'}
          </button>
        )}
      </div>

      {!status && (
        <p className="muted" style={{ fontSize: 13 }}>
          {canManage
            ? 'No cloned voice yet — clone one from a short audio sample to use it for campaign videos.'
            : 'No voice has been cloned for this campaign yet.'}
        </p>
      )}

      {status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: status === 'ready' ? 'var(--ok)' : status === 'failed' ? 'var(--bad)' : 'var(--warn)',
            boxShadow: `0 0 6px ${status === 'ready' ? 'var(--ok)' : status === 'failed' ? 'var(--bad)' : 'var(--warn)'}`,
          }} />
          <span>
            {status === 'training' && 'Cloning your voice — usually a few minutes'}
            {status === 'ready' && `Ready — "${name}"`}
            {status === 'failed' && `Failed: ${error ?? 'Unknown error'}`}
          </span>
          {status === 'ready' && (
            <button type="button" className="btn" style={{ fontSize: 12 }} disabled={previewLoading} onClick={handlePlaySample}>
              {previewLoading ? 'Generating…' : '▶ Play sample'}
            </button>
          )}
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            {step === 1 && (
              <>
                <div className="modal-step">Step 1 of 3 · Consent</div>
                <h3 style={{ marginBottom: 14, fontSize: 16 }}>Confirm permission</h3>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 }}>
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                  I confirm I have permission to create an AI clone of this voice.
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={resetModal}>Cancel</button>
                  <button className="btn primary" disabled={!consent} onClick={() => setStep(2)}>Next →</button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div className="modal-step">Step 2 of 3 · Audio sample</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Provide an audio sample</h3>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button type="button" className={audioSource === 'record' ? 'btn primary' : 'btn'} style={{ fontSize: 12 }}
                    aria-pressed={audioSource === 'record'} onClick={() => selectAudioSource('record')}>
                    Record
                  </button>
                  <button type="button" className={audioSource === 'upload' ? 'btn primary' : 'btn'} style={{ fontSize: 12 }}
                    aria-pressed={audioSource === 'upload'} onClick={() => selectAudioSource('upload')}>
                    Upload a file
                  </button>
                </div>

                {audioSource === 'upload' && (
                  <>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                      Upload a clear, single-speaker MP3, WAV, M4A, WebM, or OGG recording.
                    </p>
                    <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg"
                      onChange={e => setFile(e.target.files?.[0] ?? null)} />
                  </>
                )}

                {audioSource === 'record' && mediaRecorderSupported && (
                  <>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                      Record a clear, single-speaker sample directly from your microphone.
                    </p>
                    {micError && (
                      <p className="muted" style={{ fontSize: 12, marginBottom: 10, color: 'var(--bad)' }}>{micError}</p>
                    )}
                    {!isRecording && !file && (
                      <button type="button" className="btn primary" style={{ fontSize: 13 }} onClick={startRecording}>
                        ● Start Recording
                      </button>
                    )}
                    {isRecording && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--bad)', boxShadow: '0 0 6px var(--bad)' }} />
                        <span className="mono" aria-live="polite">{Math.floor(recordedSeconds / 60)}:{String(recordedSeconds % 60).padStart(2, '0')}</span>
                        <button type="button" className="btn" style={{ fontSize: 13 }} disabled={recordedSeconds < 1} onClick={stopRecording}>
                          Stop Recording
                        </button>
                      </div>
                    )}
                    {!isRecording && file && (
                      <button type="button" className="btn" style={{ fontSize: 12 }}
                        onClick={() => { setFile(null); setRecordDurationWarning(null); }}>
                        Re-record
                      </button>
                    )}
                  </>
                )}

                {audioSource === 'record' && !mediaRecorderSupported && (
                  <p className="muted" style={{ fontSize: 12 }}>
                    Recording isn&rsquo;t supported in this browser — please upload a file instead.
                  </p>
                )}

                {file && (
                  <audio src={audioPreviewUrl ?? undefined} controls style={{ width: '100%', marginTop: 12 }} />
                )}
                {recordDurationWarning && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 8, color: 'var(--warn)' }}>{recordDurationWarning}</p>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(1)}>← Back</button>
                  <button className="btn primary" disabled={!file} onClick={() => setStep(3)}>Next →</button>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <div className="modal-step">Step 3 of 3 · Name</div>
                <h3 style={{ marginBottom: 12, fontSize: 16 }}>Name this voice</h3>
                <input className="input" placeholder="e.g. My voice" value={voiceName}
                  onChange={e => setVoiceName(e.target.value)} maxLength={60} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <button className="btn" onClick={() => setStep(2)}>← Back</button>
                  <button className="btn primary" disabled={submitting || !voiceName.trim()} onClick={handleSubmit}>
                    {submitting ? 'Cloning…' : 'Clone voice'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
