'use client';

import { useState, useEffect, useRef } from 'react';
import { saveVideoSettingsAction } from '@/app/actions';
import { useToast } from '@/components/Toast';

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  preview_url?: string;
  labels?: {
    gender?: string;
    accent?: string;
    description?: string;
    use_case?: string;
    age?: string;
  };
}

export function VoiceLibrary({ currentVoiceId }: { currentVoiceId?: string | null }) {
  const { toast } = useToast();
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(currentVoiceId ?? '');
  const [playing, setPlaying] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'male' | 'female'>('all');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch('/api/elevenlabs/voices')
      .then(r => r.json())
      .then(d => { setVoices(d.voices ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function handlePlay(voice: ElevenLabsVoice) {
    if (!voice.preview_url) return;
    if (playing === voice.voice_id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(voice.preview_url);
    audioRef.current = audio;
    audio.play().catch(() => {});
    audio.onended = () => setPlaying(null);
    setPlaying(voice.voice_id);
  }

  async function handleSave() {
    if (!selectedId) return;
    setSaving(true);
    const result = await saveVideoSettingsAction({ elevenLabsVoiceId: selectedId });
    setSaving(false);
    if (result.ok) toast('Voice saved!');
    else toast(result.error ?? 'Failed to save', 'error');
  }

  const filtered = voices.filter(v => {
    if (filter === 'all') return true;
    return v.labels?.gender?.toLowerCase() === filter;
  });

  const selectedVoice = voices.find(v => v.voice_id === selectedId);

  return (
    <div>
      {selectedVoice && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, padding: 14, background: 'var(--bg-hover)', borderRadius: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', background: 'var(--accent-dim)',
            border: '1px solid rgba(249,115,22,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, flexShrink: 0,
          }}>🎙</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedVoice.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {[selectedVoice.labels?.gender, selectedVoice.labels?.accent, selectedVoice.labels?.description]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
          <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Use this voice'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'male', 'female'] as const).map(f => (
          <button key={f} className="btn" onClick={() => setFilter(f)}
            style={filter === f ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 56, borderRadius: 8 }} />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          {voices.length === 0 ? 'No voices found — check that ELEVENLABS_API_KEY is configured.' : 'No voices match this filter.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(voice => {
          const isSelected = selectedId === voice.voice_id;
          const isPlaying = playing === voice.voice_id;
          return (
            <div key={voice.voice_id}
              onClick={() => setSelectedId(voice.voice_id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                borderRadius: 8, border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
                background: isSelected ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                cursor: 'pointer', transition: 'all 0.1s',
              }}>
              <button type="button"
                onClick={e => { e.stopPropagation(); handlePlay(voice); }}
                disabled={!voice.preview_url}
                style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  background: isPlaying ? 'var(--accent)' : 'var(--bg-hover)',
                  border: '1px solid var(--line)', cursor: 'pointer', fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                aria-label={isPlaying ? 'Pause preview' : 'Play preview'}>
                {isPlaying ? '⏸' : '▶'}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{voice.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {[voice.labels?.gender, voice.labels?.accent, voice.labels?.description, voice.labels?.age]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              {isSelected && (
                <span style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>✓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
