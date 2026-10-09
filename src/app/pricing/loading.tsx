// /pricing renders outside AppFrame (no sidebar), so this mirrors the
// onboarding layout rather than AppShellSkeleton.
export default function PricingLoading() {
  return (
    <div className="onboarding-wrap" aria-busy="true">
      <div className="onboarding onboarding-wide">
        <div className="onboarding-bar">
          <div className="skeleton onboarding-sk-logo" />
          <div className="skeleton onboarding-sk-control" />
        </div>
        <div className="skeleton onboarding-sk-stepper" />
        <div className="onboarding-sk-header">
          <div className="skeleton onboarding-sk-eyebrow" />
          <div className="skeleton onboarding-sk-title" />
          <div className="skeleton onboarding-sk-desc" />
        </div>
        <div className="plan-grid" data-count="3">
          {[0, 1, 2].map(i => (
            <div key={i} className="card plan-card">
              <div className="skeleton onboarding-sk-h2" />
              <div className="skeleton onboarding-sk-price" />
              <div className="skeleton onboarding-sk-line" />
              <div className="skeleton onboarding-sk-line" />
              <div className="skeleton onboarding-sk-line" />
              <div className="skeleton onboarding-sk-input" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
