import { getTranslations } from 'next-intl/server';
import { getAllCampaigns } from '@/lib/data';
import { createCampaignAction } from '../actions';
import { CampaignsTable } from '@/components/CampaignsTable';

export default async function CampaignsPage() {
  const t = await getTranslations('admin.campaigns');
  const tDashboard = await getTranslations('admin.dashboard');
  const campaigns = await getAllCampaigns();

  return (
    <div>
      <div className="pagehead">
        <div>
          <span className="eyebrow">{tDashboard('eyebrow')}</span>
          <h1>{t('title')}</h1>
        </div>
      </div>

      <CampaignsTable campaigns={campaigns} />

      <div className="card">
        <div style={{ marginBottom: 16 }}>
          <span className="eyebrow">{tDashboard('newCampaignEyebrow')}</span>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 0' }}>{tDashboard('createCampaign')}</h2>
        </div>
        <form action={createCampaignAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="field-label">{tDashboard('campaignNameLabel')}</label>
            <input name="name" className="input" placeholder={tDashboard('campaignNamePlaceholder')} required />
          </div>
          <div>
            <label className="field-label">{tDashboard('jurisdictionsLabel')}</label>
            <input
              name="jurisdictions"
              className="input"
              placeholder={tDashboard('jurisdictionsPlaceholder')}
              defaultValue="US-FEDERAL"
            />
          </div>
          <button className="btn primary" style={{ alignSelf: 'flex-start' }}>{tDashboard('createCampaign')}</button>
        </form>
      </div>
    </div>
  );
}
