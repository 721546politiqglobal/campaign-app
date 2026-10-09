import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function SettingsLoading() {
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
            <div className="acct-fields">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <div className="skeleton acct-skel-label" />
                  <div className="skeleton acct-skel-input" />
                </div>
              ))}
            </div>
            <div className="skeleton acct-skel-textarea" />
            <div className="form-actions"><div className="skeleton acct-skel-btn" /></div>
          </div>
        </div>

        <div className="card card-sectioned">
          <div className="card-header"><div className="skeleton acct-skel-heading" /></div>
          <div className="card-body">
            <div className="skeleton acct-skel-label" />
            <div className="skeleton acct-skel-textarea" />
          </div>
        </div>

        <div className="card card-sectioned">
          <div className="card-header"><div className="skeleton acct-skel-heading" /></div>
          <div className="card-body">
            <div className="skeleton acct-skel-text" />
            <div className="skeleton acct-skel-text-sm" />
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}
