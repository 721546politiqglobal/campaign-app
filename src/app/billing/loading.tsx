import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function BillingLoading() {
  return (
    <AppShellSkeleton>
      <div className="pagehead">
        <div>
          <div className="skeleton" style={{ width: 100, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 110, height: 26 }} />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '22px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="skeleton" style={{ width: 150, height: 20, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: 220, height: 12 }} />
          </div>
          <div className="skeleton" style={{ width: 130, height: 36, borderRadius: 7 }} />
        </div>
        <div style={{ padding: '22px 24px' }}>
          <div className="skeleton" style={{ width: 160, height: 11, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: 200, height: 26, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: '100%', height: 8, borderRadius: 999 }} />
        </div>
      </div>
    </AppShellSkeleton>
  );
}
