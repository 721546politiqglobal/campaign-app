import { AppShellSkeleton } from '@/components/AppShellSkeleton';

export default function ChannelsLoading() {
  return (
    <AppShellSkeleton>
      <div className="page-header">
        <div className="page-header-main">
          <div className="skeleton ai-sk-eyebrow" />
          <div className="skeleton ai-sk-title" />
          <div className="skeleton ai-sk-desc" />
        </div>
        <div className="page-header-actions">
          <div className="skeleton ai-sk-btn" />
        </div>
      </div>

      <div className="channels-grid">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="channel-card">
            <div className="channel-card-top">
              <div className="skeleton channel-tile" />
              <div className="channel-title stack">
                <div className="skeleton ai-sk-text-md" />
                <div className="skeleton ai-sk-text-sm" />
              </div>
              <div className="skeleton ai-sk-badge" />
            </div>
            <div className="channel-actions">
              <div className="skeleton ai-sk-btn" />
            </div>
          </div>
        ))}
      </div>
    </AppShellSkeleton>
  );
}
