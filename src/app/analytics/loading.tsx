import { AppShellSkeleton } from '@/components/AppShellSkeleton';

function ListCardSkeleton() {
  return (
    <div className="card stack">
      <div className="skeleton ai-sk-text-md" />
      {[0, 1, 2].map(i => (
        <div key={i} className="an-bar">
          <div className="an-bar-head">
            <div className="skeleton ai-sk-text-sm" />
            <div className="skeleton ai-sk-chip" />
          </div>
          <div className="skeleton ai-sk-bar" />
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsLoading() {
  return (
    <AppShellSkeleton>
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton ai-sk-eyebrow" />
          <div className="skeleton ai-sk-title" />
          <div className="skeleton ai-sk-desc" />
        </div>
      </div>

      <div className="stack">
        <div className="grid cols-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card card-sm stat">
              <div className="skeleton ai-sk-text-sm" />
              <div className="skeleton ai-sk-stat" />
              <div className="skeleton ai-sk-chip" />
            </div>
          ))}
        </div>
        <div className="grid cols-2">
          <ListCardSkeleton />
          <ListCardSkeleton />
        </div>
        <div className="grid cols-2">
          <ListCardSkeleton />
          <div className="card stack">
            <div className="skeleton ai-sk-text-md" />
            <div className="skeleton ai-sk-line" />
            <div className="skeleton ai-sk-line ai-sk-line-85" />
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}
