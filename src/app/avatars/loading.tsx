import { AppShellSkeleton } from '@/components/AppShellSkeleton';

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="card card-sectioned">
      <div className="card-header">
        <div className="card-header-text">
          <div className="skeleton ai-sk-text-md" />
          <div className="skeleton ai-sk-desc" />
        </div>
      </div>
      <div className="card-body stack">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="av-row">
            <div className="skeleton av-thumb" />
            <div className="av-row-text">
              <div className="skeleton ai-sk-text-md" />
              <div className="skeleton ai-sk-text-sm" />
            </div>
            <div className="skeleton ai-sk-btn" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AvatarsLoading() {
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
        <SectionSkeleton rows={2} />
        <SectionSkeleton rows={1} />
        <SectionSkeleton rows={1} />
      </div>
    </AppShellSkeleton>
  );
}
