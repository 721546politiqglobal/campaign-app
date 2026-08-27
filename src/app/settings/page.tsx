import { revalidatePath } from 'next/cache';
import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { adminDb } from '@/lib/supabase';
import { getCampaign } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { upsertCandidateProfile } from '@/lib/candidate';
import { can } from '@/lib/permissions';
import { PARTIES } from '@/lib/profile-validation';
import type { VoiceTone } from '@/domain/types';

async function saveDisclosureDefaultAction(formData: FormData) {
  'use server';
  const { requireSession } = await import('@/lib/session');
  const { can } = await import('@/lib/permissions');
  const s = await requireSession();
  if (!can(s.role, 'edit_settings')) return;
  const text = String(formData.get('default_disclosure_text') ?? '').trim();
  await adminDb.from('campaigns')
    .update({ default_disclosure_text: text || null })
    .eq('id', s.campaignId);
  revalidatePath('/settings');
}

async function saveProfileAction(formData: FormData) {
  'use server';
  const { requireSession } = await import('@/lib/session');
  const { can } = await import('@/lib/permissions');
  const { validateCandidateProfile } = await import('@/lib/profile-validation');
  const { redirect } = await import('next/navigation');
  const s = await requireSession();
  if (!can(s.role, 'edit_settings')) return;

  const fields = {
    fullName:       String(formData.get('full_name')       ?? '').trim(),
    preferredName:  String(formData.get('preferred_name')  ?? '').trim(),
    office:         String(formData.get('office')          ?? '').trim(),
    district:       String(formData.get('district')        ?? '').trim(),
    party:          String(formData.get('party')           ?? '').trim(),
    bio:            String(formData.get('bio')             ?? '').trim(),
    tagline:        String(formData.get('tagline')         ?? '').trim(),
    targetAudience: String(formData.get('target_audience') ?? '').trim(),
    voiceTone:      String(formData.get('voice_tone') ?? 'conversational'),
    googleAlertsRssUrl: String(formData.get('google_alerts_rss_url') ?? '').trim(),
    photoUrl:       String(formData.get('photo_url') ?? '').trim(),
  };
  // Reject garbage before it reaches AI-drafting prompts (UX-3).
  const check = validateCandidateProfile(fields);
  if (!check.ok) redirect('/settings?error=validation');

  const keyPositions = String(formData.get('key_positions') ?? '')
    .split('\n').map((p: string) => p.trim()).filter(Boolean);
  const opponentAliases = String(formData.get('opponent_aliases') ?? '')
    .split(',').map((a: string) => a.trim()).filter(Boolean);
  const monitoringKeywords = String(formData.get('monitoring_keywords') ?? '')
    .split(',').map((k: string) => k.trim()).filter(Boolean);
  await upsertCandidateProfile(s.campaignId, {
    fullName:       fields.fullName,
    preferredName:  fields.preferredName,
    office:         fields.office,
    district:       fields.district,
    party:          fields.party,
    bio:            fields.bio,
    keyPositions,
    voiceTone:      (String(formData.get('voice_tone') ?? 'conversational')) as VoiceTone,
    targetAudience: String(formData.get('target_audience') ?? '').trim(),
    tagline:        String(formData.get('tagline')         ?? '').trim(),
    photoUrl:       String(formData.get('photo_url')       ?? '').trim() || null,
    opponentName:   String(formData.get('opponent_name')   ?? '').trim() || null,
    opponentAliases,
    monitoringKeywords,
    // Strip a leading @ — the n8n workflow builds `from:<handle>` for X search,
    // and that operator rejects a handle prefixed with @.
    opponentTwitterHandle:   String(formData.get('opponent_twitter_handle')   ?? '').trim().replace(/^@+/, '') || null,
    opponentInstagramHandle: String(formData.get('opponent_instagram_handle') ?? '').trim() || null,
    opponentFacebookPage:    String(formData.get('opponent_facebook_page')    ?? '').trim() || null,
    googleAlertsRssUrl:      String(formData.get('google_alerts_rss_url')    ?? '').trim() || null,
  });
  revalidatePath('/settings');
}

export default async function Settings({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const s = await requireSession();
  const [campaign, profile] = await Promise.all([
    getCampaign(s.campaignId),
    getCandidateProfile(s.campaignId),
  ]);
  const canEdit = can(s.role, 'edit_settings');

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Configuration</span><h1>Settings</h1></div>
      </div>

      {/* Candidate profile — first and most important section */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 16 }}>Candidate profile</h2>
        {searchParams.error === 'validation' && (
          <div className="banner warn" style={{ marginBottom: 16 }}>
            <div>
              <div className="t">Profile not saved</div>
              <div className="b">Check the party, voice tone, and any URL fields — one of them isn&rsquo;t valid.</div>
            </div>
          </div>
        )}
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
              <select name="party" className="input" defaultValue={profile?.party ?? ''} disabled={!canEdit}>
                <option value="">—</option>
                {PARTIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
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
          <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0 2px', paddingTop: 16 }}>
            <span className="eyebrow">Opposition monitoring</span>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>Who and what the war room watches for you.</p>
          </div>
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

      <div className="card">
        <h2>Campaign</h2>
        <p><strong>{campaign?.name}</strong></p>
        <div className="eyebrow" style={{ marginTop: 12 }}>Jurisdictions</div>
        <div className="btnrow" style={{ marginTop: 6 }}>
          {(campaign?.jurisdictions ?? []).map(j => <span key={j} className="pill approved">{j}</span>)}
        </div>
      </div>

      <div className="spacer-y" />
      <div className="card">
        <h2>Default AI disclosure</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Shown for confirmation on every AI-generated content item before it can be scheduled.
          Leave blank to use the generic default.
        </p>
        <form action={saveDisclosureDefaultAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            name="default_disclosure_text"
            className="input"
            style={{ minHeight: 90 }}
            defaultValue={campaign?.defaultDisclosureText ?? ''}
            placeholder="This content was generated or substantially altered using AI."
            disabled={!canEdit}
          />
          {canEdit && (
            <button className="btn primary" type="submit" style={{ alignSelf: 'flex-start' }}>Save disclosure</button>
          )}
        </form>
      </div>
    </AppFrame>
  );
}
