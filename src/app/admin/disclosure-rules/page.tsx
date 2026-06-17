import { getAllDisclosureRules } from '@/lib/data';
import { updateDisclosureRuleAction } from '../actions';

export default async function AdminDisclosureRules() {
  const rules = await getAllDisclosureRules();

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Compliance</span>
          <h1>Disclosure rules</h1>
        </div>
        <div className="actions">
          <span className="muted" style={{ fontSize: 13 }}>Applied to all AI-generated content</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rules.map(rule => (
          <div key={rule.jurisdiction} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span className="pill" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
                {rule.jurisdiction}
              </span>
              {rule.needsLegalReview && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                  background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.25)',
                  color: 'var(--warn)', letterSpacing: '0.06em',
                }}>
                  NEEDS LEGAL REVIEW
                </span>
              )}
            </div>

            <form action={updateDisclosureRuleAction} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input type="hidden" name="jurisdiction" value={rule.jurisdiction} />

              <div>
                <label className="field-label">Required disclosure text</label>
                <textarea
                  name="requiredText"
                  className="input"
                  defaultValue={rule.requiredText ?? ''}
                  rows={3}
                  placeholder="Leave blank to use platform default"
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label className="field-label">Placement</label>
                  <select name="placement" className="input" defaultValue={rule.placement}>
                    <option value="overlay">Overlay</option>
                    <option value="caption">Caption</option>
                    <option value="hashtag">Hashtag</option>
                    <option value="footer">Footer</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Blackout days before election</label>
                  <input
                    name="blackoutDays"
                    type="number"
                    className="input"
                    defaultValue={rule.blackoutDaysBeforeElection ?? ''}
                    placeholder="None"
                    min="0"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'flex-end', paddingBottom: 2 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      name="requiresAiLabel"
                      defaultChecked={rule.requiresAiLabel}
                      style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                    />
                    <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Requires AI label</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      name="needsLegalReview"
                      defaultChecked={rule.needsLegalReview}
                      style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                    />
                    <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Needs legal review</span>
                  </label>
                </div>
              </div>

              <div>
                <button className="btn primary" style={{ fontSize: 13 }}>Save rule</button>
              </div>
            </form>
          </div>
        ))}

        {rules.length === 0 && (
          <div className="card">
            <p className="muted">No disclosure rules configured.</p>
          </div>
        )}
      </div>
    </div>
  );
}
