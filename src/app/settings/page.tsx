import { revalidatePath } from 'next/cache';
import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getCampaign, getDisclosureRules, getUsers } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { upsertCandidateProfile } from '@/lib/candidate';
import { setCapAction } from '@/app/actions';
import { can } from '@/lib/permissions';
import type { VoiceTone } from '@/domain/types';

async function saveProfileAction(formData: FormData) {
  'use server';
  const { requireSession } = await import('@/lib/session');
  const { can } = await import('@/lib/permissions');
  const s = await requireSession();
  if (!can(s.role, 'edit_settings')) return;
  const keyPositions = String(formData.get('key_positions') ?? '')
    .split('\n').map((p: string) => p.trim()).filter(Boolean);
  const opponentAliases = String(formData.get('opponent_aliases') ?? '')
    .split(',').map((a: string) => a.trim()).filter(Boolean);
  const monitoringKeywords = String(formData.get('monitoring_keywords') ?? '')
    .split(',').map((k: string) => k.trim()).filter(Boolean);
  await upsertCandidateProfile(s.campaignId, {
    fullName:       String(formData.get('full_name')       ?? '').trim(),
    preferredName:  String(formData.get('preferred_name')  ?? '').trim(),
    office:         String(formData.get('office')          ?? '').trim(),
    district:       String(formData.get('district')        ?? '').trim(),
    party:          String(formData.get('party')           ?? '').trim(),
    bio:            String(formData.get('bio')             ?? '').trim(),
    keyPositions,
    voiceTone:      (String(formData.get('voice_tone') ?? 'conversational')) as VoiceTone,
    targetAudience: String(formData.get('target_audience') ?? '').trim(),
    tagline:        String(formData.get('tagline')         ?? '').trim(),
    photoUrl:       String(formData.get('photo_url')       ?? '').trim() || null,
    opponentName:   String(formData.get('opponent_name')   ?? '').trim() || null,
    opponentAliases,
    monitoringKeywords,
    opponentTwitterHandle:   String(formData.get('opponent_twitter_handle')   ?? '').trim() || null,
    opponentInstagramHandle: String(formData.get('opponent_instagram_handle') ?? '').trim() || null,
    opponentFacebookPage:    String(formData.get('opponent_facebook_page')    ?? '').trim() || null,
    googleAlertsRssUrl:      String(formData.get('google_alerts_rss_url')    ?? '').trim() || null,
  });
  revalidatePath('/settings');
}

export default async function Settings() {
  const s = await requireSession();
  const [campaign, rules, users, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getDisclosureRules(),
    getUsers(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  const cap = ((campaign?.monthlyCostCapCents ?? 0) / 100).toFixed(0);
  const canEdit = can(s.role, 'edit_settings');

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Configuration</span><h1>Settings</h1></div>
      </div>

      {/* Candidate profile — first and most important section */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 16 }}>Candidate profile</h2>
        <form action={saveProfileAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="field-label">Full name</label>
              <input name="full_name" className="input" defaultValue={profile?.fullName ?? ''} required disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Preferred name</label>
              <input name="preferred_name" className="input" defaultValue={profile?.preferredName ?? ''} required disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Running for</label>
              <input name="office" className="input" defaultValue={profile?.office ?? ''} required disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">District</label>
              <input name="district" className="input" defaultValue={profile?.district ?? ''} required disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Party</label>
              <input name="party" className="input" defaultValue={profile?.party ?? ''} disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Primary opponent</label>
              <input name="opponent_name" className="input" defaultValue={profile?.opponentName ?? ''} disabled={!canEdit} />
            </div>
          </div>
          <div>
            <label className="field-label">Bio (2–3 sentences)</label>
            <textarea name="bio" className="input" style={{ minHeight: 72 }} defaultValue={profile?.bio ?? ''} disabled={!canEdit} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="field-label">Tagline</label>
              <input name="tagline" className="input" defaultValue={profile?.tagline ?? ''} disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Target audience</label>
              <input name="target_audience" className="input" defaultValue={profile?.targetAudience ?? ''} disabled={!canEdit} />
            </div>
          </div>
          <div>
            <label className="field-label">Key positions (one per line)</label>
            <textarea name="key_positions" className="input" style={{ minHeight: 100 }}
              defaultValue={profile?.keyPositions.join('\n') ?? ''} disabled={!canEdit} />
          </div>
          <div>
            <label className="field-label">Voice tone</label>
            <select name="voice_tone" className="input" defaultValue={profile?.voiceTone ?? 'conversational'} disabled={!canEdit}>
              <option value="conversational">Conversational</option>
              <option value="formal">Formal</option>
              <option value="urgent">Urgent</option>
              <option value="inspirational">Inspirational</option>
            </select>
          </div>
          <div className="eyebrow" style={{ marginTop: 8 }}>Opposition monitoring</div>
          <div>
            <label className="field-label">Opponent aliases (comma-separated)</label>
            <input name="opponent_aliases" className="input"
              defaultValue={profile?.opponentAliases.join(', ') ?? ''} disabled={!canEdit} />
          </div>
          <div>
            <label className="field-label">Extra keywords to track (comma-separated)</label>
            <input name="monitoring_keywords" className="input"
              defaultValue={profile?.monitoringKeywords.join(', ') ?? ''} disabled={!canEdit} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label className="field-label">Opponent Twitter/X handle</label>
              <input name="opponent_twitter_handle" className="input"
                defaultValue={profile?.opponentTwitterHandle ?? ''} disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Opponent Instagram handle</label>
              <input name="opponent_instagram_handle" className="input"
                defaultValue={profile?.opponentInstagramHandle ?? ''} disabled={!canEdit} />
            </div>
            <div>
              <label className="field-label">Opponent Facebook page slug</label>
              <input name="opponent_facebook_page" className="input"
                defaultValue={profile?.opponentFacebookPage ?? ''} disabled={!canEdit} />
            </div>
          </div>
          <div>
            <label className="field-label">Google Alerts RSS feed URL</label>
            <input name="google_alerts_rss_url" className="input"
              defaultValue={profile?.googleAlertsRssUrl ?? ''} disabled={!canEdit} />
          </div>
          {canEdit && (
            <button className="btn primary" type="submit" style={{ alignSelf: 'flex-start' }}>Save profile</button>
          )}
        </form>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Campaign</h2>
          <p><strong>{campaign?.name}</strong></p>
          <div className="eyebrow" style={{ marginTop: 12 }}>Jurisdictions</div>
          <div className="btnrow" style={{ marginTop: 6 }}>
            {(campaign?.jurisdictions ?? []).map(j => <span key={j} className="pill approved">{j}</span>)}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Jurisdictions decide which disclosure rules apply to AI content.
          </p>
        </div>

        <div className="card">
          <h2>Monthly spend cap</h2>
          <form action={setCapAction}>
            <label className="field">
              <span className="cap">Cap (USD)</span>
              <input type="text" name="cap" defaultValue={cap} inputMode="numeric" disabled={!canEdit} />
            </label>
            {canEdit && <button className="btn primary" type="submit">Save cap</button>}
          </form>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Video, voice, and AI drafting count against this cap. Paid actions are blocked once it&rsquo;s reached.
          </p>
        </div>
      </div>

      <div className="spacer-y" />
      <div className="card">
        <h2>Disclosure rules</h2>
        <table>
          <thead><tr><th>Jurisdiction</th><th>Required text</th><th>Placement</th><th>Status</th></tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.jurisdiction}>
                <td className="mono">{r.jurisdiction}</td>
                <td style={{ fontSize: 13 }}>{r.requiredText ?? <span className="muted">generic AI label</span>}</td>
                <td className="muted">{r.placement}</td>
                <td>{r.needsLegalReview
                  ? <span className="pill in_review">Needs legal review</span>
                  : <span className="pill published">Verified</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="spacer-y" />
      <div className="card">
        <h2>Team</h2>
        <table>
          <thead><tr><th>Name</th><th>Role</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="muted">{u.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          To add a team member, contact your platform administrator.
        </p>
      </div>
    </AppFrame>
  );
}
