import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function ContentDetailLoading() {
  return (
    <AppShellSkeleton>
      <div className="skeleton sk sk-text-xs sk-w-25 content-skel-crumb" />
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton sk sk-eyebrow" />
          <div className="skeleton sk sk-title sk-w-50" />
          <div className="skeleton sk sk-text sk-w-25" />
        </div>
      </div>

      <div className="wizard">
        <div className="wizard-stepper-skel" aria-hidden="true">
          {[0, 1, 2].map(i => <div key={i} className="skeleton sk sk-step" />)}
        </div>
        <div className="grid cols-2">
          <div className="card stack">
            <div className="skeleton sk sk-heading" />
            <div className="skeleton sk sk-textarea" />
            <div className="btnrow"><div className="skeleton sk sk-btn" /></div>
          </div>
          <div className="card stack">
            <div className="skeleton sk sk-heading" />
            <div className="skeleton sk sk-text sk-w-100" />
            <div className="skeleton sk sk-text sk-w-75" />
            <div className="skeleton sk sk-btn sk-w-100" />
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}
