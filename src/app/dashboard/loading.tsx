import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function DashboardLoading() {
  return (
    <AppShellSkeleton>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <div className="skeleton" style={{ width: 70, height: 10, marginBottom: 10 }} />
          <div className="skeleton" style={{ width: 120, height: 26 }} />
        </div>
        <div className="skeleton" style={{ width: 200, height: 36, borderRadius: 7 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card" style={{ padding: 16 }}>
            <div className="skeleton" style={{ width: '55%', height: 10, marginBottom: 16 }} />
            <div className="skeleton" style={{ width: 52, height: 34, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: '70%', height: 10 }} />
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.35fr 1fr', gap: 14 }}>
        <div className="card">
          <div className="skeleton" style={{ width: 130, height: 11, marginBottom: 18 }} />
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: '55%', height: 12, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: 120, height: 9 }} />
              </div>
              <div className="skeleton" style={{ width: 76, height: 20, borderRadius: 999 }} />
            </div>
          ))}
        </div>
        <div className="card">
          <div className="skeleton" style={{ width: 110, height: 11, marginBottom: 18 }} />
          {[0, 1, 2].map(i => (
            <div key={i} style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="skeleton" style={{ width: 90, height: 9, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '100%', height: 10, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: '80%', height: 10 }} />
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="skeleton" style={{ width: '100%', height: 30, borderRadius: 8 }} />
      </div>
    </AppShellSkeleton>
  );
}
