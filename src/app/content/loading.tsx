import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function ContentLoading() {
  return (
    <AppShellSkeleton>
      <div className="pagehead">
        <div>
          <div className="skeleton" style={{ width: 60, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 130, height: 26 }} />
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <div className="skeleton" style={{ width: 130, height: 36, borderRadius: 7 }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 7, marginBottom: 20 }}>
        {[54, 60, 74, 84, 76].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 34, borderRadius: 7 }} />
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '15px 16px', borderBottom: i < 5 ? '1px solid var(--border)' : 'none' }}>
            <div className="skeleton" style={{ flex: 2, height: 13 }} />
            <div className="skeleton" style={{ flex: 1, height: 11 }} />
            <div className="skeleton" style={{ flex: 1, height: 11 }} />
            <div className="skeleton" style={{ width: 80, height: 20, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    </AppShellSkeleton>
  );
}
