import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function AvatarsLoading() {
  return (
    <AppShellSkeleton>
      <div className="pagehead">
        <div>
          <div className="skeleton" style={{ width: 100, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 130, height: 26 }} />
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div className="skeleton" style={{ width: 70, height: 11 }} />
          <div className="skeleton" style={{ width: 130, height: 32, borderRadius: 7 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10 }}>
              <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 8, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 160, height: 12, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: 220, height: 10 }} />
              </div>
              <div className="skeleton" style={{ width: 84, height: 28, borderRadius: 7 }} />
            </div>
          ))}
        </div>
      </div>
    </AppShellSkeleton>
  );
}
