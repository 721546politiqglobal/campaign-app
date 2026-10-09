import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function BillingLoading() {
  return (
    <AppShellSkeleton>
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton acct-skel-eyebrow" />
          <div className="skeleton acct-skel-title" />
          <div className="skeleton acct-skel-text" />
        </div>
        <div className="page-header-actions"><div className="skeleton acct-skel-btn" /></div>
      </div>

      <div className="stack">
        <div className="card card-sectioned">
          <div className="card-body billing-plan">
            <div className="billing-plan-main">
              <div className="skeleton acct-skel-eyebrow" />
              <div className="skeleton acct-skel-title" />
              <div className="skeleton acct-skel-text" />
            </div>
            <div className="skeleton acct-skel-btn" />
          </div>
        </div>

        <div className="card card-sectioned">
          <div className="card-header"><div className="skeleton acct-skel-heading" /></div>
          <div className="card-body billing-meters">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="billing-meter">
                <div className="billing-meter-head">
                  <div className="skeleton acct-skel-text-sm" />
                  <div className="skeleton acct-skel-text-xs" />
                </div>
                <div className="skeleton acct-skel-bar" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}
