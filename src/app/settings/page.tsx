import { AppFrame } from '@/components/AppFrame';
import { requireSession } from '@/lib/session';
import { getCampaign, getDisclosureRules, getUsers } from '@/lib/data';
import { setCapAction } from '@/app/actions';

export default async function Settings() {
  const s = requireSession();
  const [campaign, rules, users] = await Promise.all([
    getCampaign(s.campaignId),
    getDisclosureRules(),
    getUsers(s.campaignId),
  ]);
  const cap = ((campaign?.monthlyCostCapCents ?? 0) / 100).toFixed(0);

  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Configuration</span><h1>Settings</h1></div>
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
              <input type="text" name="cap" defaultValue={cap} inputMode="numeric" />
            </label>
            <button className="btn primary" type="submit">Save cap</button>
          </form>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Video, voice, and AI drafting count against this cap. Paid actions are blocked once it&rsquo;s reached.
          </p>
        </div>
      </div>

      <div className="spacer-y" />
      <div className="card">
        <h2>Active integrations</h2>
        <table>
          <thead><tr><th>Service</th><th>Purpose</th><th>Status</th></tr></thead>
          <tbody>
            {[
              { name: 'Claude (LLM)', key: 'LLM_API_KEY', purpose: 'AI content drafting' },
              { name: 'HeyGen', key: 'HEYGEN_API_KEY', purpose: 'Candidate avatar video' },
              { name: 'ElevenLabs', key: 'ELEVENLABS_API_KEY', purpose: 'Voice synthesis' },
              { name: 'Ayrshare', key: 'AYRSHARE_API_KEY', purpose: 'Social publishing' },
              { name: 'NewsData', key: 'NEWSDATA_API_KEY', purpose: 'Opponent monitoring' },
            ].map(svc => (
              <tr key={svc.key}>
                <td>{svc.name}</td>
                <td className="muted" style={{ fontSize: 13 }}>{svc.purpose}</td>
                <td>
                  {process.env[svc.key]
                    ? <span className="pill published">Live</span>
                    : <span className="pill in_review">Add {svc.key}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      </div>
    </AppFrame>
  );
}
