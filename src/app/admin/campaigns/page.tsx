import { getAllCampaigns } from '@/lib/data';
import { createCampaignAction } from '../actions';
import { CampaignsTable } from '@/components/CampaignsTable';

export default async function CampaignsPage() {
  const campaigns = await getAllCampaigns();

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">System</span>
          <h1>Campaigns</h1>
        </div>
      </div>

      <CampaignsTable campaigns={campaigns} />

      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <span className="eyebrow">New campaign</span>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 0' }}>Create campaign</h2>
        </div>
        <form action={createCampaignAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">Campaign name</label>
            <input name="name" className="input" placeholder="e.g. Smith for Governor" required />
          </div>
          <div>
            <label className="field-label">Jurisdictions</label>
            <input
              name="jurisdictions"
              className="input"
              placeholder="US-FEDERAL, US-CA"
              defaultValue="US-FEDERAL"
            />
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Create campaign</button>
        </form>
      </div>
    </div>
  );
}
