import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function TeamLoading() {
  return (
    <AppShellSkeleton>
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton acct-skel-eyebrow" />
          <div className="skeleton acct-skel-title" />
          <div className="skeleton acct-skel-text" />
        </div>
      </div>

      <div className="stack">
        <div className="card card-sectioned">
          <div className="card-header"><div className="skeleton acct-skel-heading" /></div>
          <div className="card-body">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="acct-skel-row">
                <div className="skeleton acct-skel-text" />
                <div className="skeleton acct-skel-pill" />
              </div>
            ))}
          </div>
        </div>

        <div className="card card-sectioned">
          <div className="card-header"><div className="skeleton acct-skel-heading" /></div>
          <div className="card-body">
            <div className="acct-skel-inline">
              <div className="skeleton acct-skel-input" />
              <div className="skeleton acct-skel-btn" />
            </div>
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}
