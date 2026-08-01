'use client';

import { usePathname } from 'next/navigation';
import { NAV } from './Sidebar';

/**
 * Static shell shown as the route-level loading fallback. Mirrors AppFrame's
 * sidebar + topbar exactly (nav is static and known) so the transition into the
 * real page is seamless — only the campaign name, page body, and user name flash
 * as shimmering skeletons while server data resolves.
 */
export function AppShellSkeleton({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) =>
    href === '/dashboard' ? path === '/dashboard' : path.startsWith(href);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="/politiq-logo.png" alt="PolitIQ" className="brand-logo-img" />
          </div>
          <div className="skeleton" style={{ width: 130, height: 10, marginTop: 8 }} />
        </div>

        <nav className="nav">
          {NAV.map(n => (
            <span key={n.href} className={isActive(n.href) ? 'active' : ''}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 7, color: 'var(--text-2)', fontSize: 13.5, fontWeight: 500 }}>
              {n.icon}
              {n.label}
            </span>
          ))}
        </nav>

        <div className="spacer" />

        <div className="sidebar-footer">
          <div className="skeleton" style={{ width: 96, height: 11, marginBottom: 10 }} />
          <div className="skeleton" style={{ width: '100%', height: 32, borderRadius: 7 }} />
        </div>
      </aside>

      <div className="main">
        <div className="sk-topbar">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', boxShadow: '0 0 0 3px var(--ok-dim), 0 0 8px var(--ok)', flexShrink: 0 }} />
          <div className="skeleton" style={{ width: 180, height: 12 }} />
          <div className="skeleton" style={{ width: 62, height: 24, borderRadius: 6, marginLeft: 'auto' }} />
        </div>
        <div className="content" aria-busy="true">{children}</div>
      </div>
    </div>
  );
}

/** A shimmering placeholder card block. */
export function SkeletonBlock({ height = 120, style }: { height?: number; style?: React.CSSProperties }) {
  return (
    <div className="card" style={{ ...style }}>
      <div className="skeleton" style={{ width: 120, height: 11, marginBottom: 16 }} />
      <div className="skeleton" style={{ width: '100%', height: height - 40, borderRadius: 8 }} />
    </div>
  );
}
