import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function NewContentLoading() {
  return (
    <AppShellSkeleton>
      <div className="skeleton sk sk-text-xs sk-w-25 content-skel-crumb" />
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton sk sk-eyebrow" />
          <div className="skeleton sk sk-title" />
          <div className="skeleton sk sk-text sk-w-50" />
        </div>
      </div>

      <div className="editor-layout">
        <div className="card stack">
          <div className="skeleton sk sk-heading" />
          <div className="btnrow">
            {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton sk sk-chip" />)}
          </div>
          <div className="skeleton sk sk-text-xs sk-w-25" />
          <div className="skeleton sk sk-input sk-w-50" />
          <div className="skeleton sk sk-text-xs sk-w-25" />
          <div className="skeleton sk sk-textarea" />
          <div className="btnrow">
            <div className="skeleton sk sk-btn" />
            <div className="skeleton sk sk-btn" />
          </div>
        </div>
      </div>
    </AppShellSkeleton>
  );
}
