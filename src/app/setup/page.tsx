import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { getCandidateProfile } from '@/lib/candidate';
import { upsertProfileAction } from './actions';

const TONES = [
  ['conversational', 'Conversational — warm, direct, relatable'],
  ['formal',         'Formal — authoritative, measured, professional'],
  ['urgent',         'Urgent — energizing, action-oriented, passionate'],
  ['inspirational',  'Inspirational — hopeful, visionary, uplifting'],
] as const;

export default async function SetupPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const s = await requireSession();
  const existing = await getCandidateProfile(s.campaignId);
  if (existing) redirect('/dashboard');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 24px' }}>
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ marginBottom: 32 }}>
          <span className="eyebrow">Welcome</span>
          <h1 style={{ margin: '4px 0 8px' }}>Set up your campaign</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            This takes about 3 minutes. Every AI draft will be written specifically for your candidate from this point on.
          </p>
        </div>

        {searchParams.error === 'required' && (
          <div className="banner warn" style={{ marginBottom: 20 }}>
            <div>
              <div className="t">Required fields missing</div>
              <div className="b">Full name, preferred name, office, and district are required.</div>
            </div>
          </div>
        )}

        <form action={upsertProfileAction} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h2 style={{ marginBottom: 16 }}>Candidate</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="field-label">Full name *</label>
                <input name="full_name" className="input" placeholder="Maria Rivera" required />
              </div>
              <div>
                <label className="field-label">Preferred name *</label>
                <input name="preferred_name" className="input" placeholder="Maria" required />
              </div>
              <div>
                <label className="field-label">Running for *</label>
                <input name="office" className="input" placeholder="California State Assembly" required />
              </div>
              <div>
                <label className="field-label">District / jurisdiction *</label>
                <input name="district" className="input" placeholder="District 12" required />
              </div>
              <div>
                <label className="field-label">Party</label>
                <input name="party" className="input" placeholder="Democratic" />
              </div>
              <div>
                <label className="field-label">Primary opponent name</label>
                <input name="opponent_name" className="input" placeholder="John Smith" />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="field-label">Candidate photo URL (optional)</label>
              <input name="photo_url" className="input" placeholder="https://..." />
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 16 }}>Campaign voice</h2>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">Short bio (2–3 sentences used in every AI draft)</label>
              <textarea name="bio" className="input" style={{ minHeight: 80 }}
                placeholder="A lifelong community advocate and small business owner, Maria has spent 20 years fighting for working families in the San Fernando Valley." />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">Campaign tagline</label>
              <input name="tagline" className="input" placeholder="A Voice for District 12" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="field-label">Target audience</label>
              <input name="target_audience" className="input" placeholder="Working families in the San Fernando Valley" />
            </div>
            <div>
              <label className="field-label">Key policy positions (one per line, 3–7)</label>
              <textarea name="key_positions" className="input" style={{ minHeight: 120 }}
                placeholder={"Expand access to affordable healthcare\nLower housing costs for renters\nInvest in public schools and teachers"} />
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Tone</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TONES.map(([value, label]) => (
                <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)' }}>
                  <input type="radio" name="voice_tone" value={value} defaultChecked={value === 'conversational'} />
                  <span style={{ fontSize: 14 }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <button className="btn primary" style={{ alignSelf: 'flex-end', padding: '12px 28px', fontSize: 15 }}>
            Complete setup →
          </button>
        </form>
      </div>
    </div>
  );
}
