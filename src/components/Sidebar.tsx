'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/actions';

export const NAV = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="9" y="9" width="5.5" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      </svg>
    ),
  },
  {
    href: '/content',
    label: 'Content',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <line x1="5" y1="5.5" x2="11" y2="5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="5" y1="10.5" x2="8.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: '/monitoring',
    label: 'Monitoring',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3"/>
        <line x1="8" y1="1.5" x2="8" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="14.5" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="1.5" y1="8" x2="3" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="8" y1="14.5" x2="8" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: '/avatars',
    label: 'Avatars',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: '/team',
    label: 'Team',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="5.5" cy="5" r="2.25" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M1.5 13c0-2.3 1.79-3.75 4-3.75s4 1.45 4 3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="11.5" cy="5.5" r="1.75" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M10 9.6c1.6.15 2.9 1.25 3.1 3.15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M12.6 3.4l-1.06 1.06M4.46 11.54l-1.06 1.06"
          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: '/billing',
    label: 'Billing',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
];

export function Sidebar({ name, campaign }: { name: string; campaign: string }) {
  const path = usePathname();
  const isActive = (href: string) => (href === '/dashboard' ? path === '/dashboard' : path.startsWith(href));

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="/politiq-logo.png" alt="PolitIQ" className="brand-logo-img" />
          </div>
          <div className="brand-campaign">{campaign}</div>
        </div>

        <nav className="nav">
          {NAV.map(n => (
            <Link key={n.href} href={n.href} className={isActive(n.href) ? 'active' : ''}>
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="spacer" />

        <div className="sidebar-footer">
          <div className="sidebar-user">{name}</div>
          <form action={logoutAction}>
            <button className="btn" style={{ width: '100%', fontSize: 13, padding: '7px 12px' }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="mobile-tabs" aria-label="Main navigation">
        {NAV.map(n => (
          <Link key={n.href} href={n.href}
            className={`mobile-tab${isActive(n.href) ? ' active' : ''}`}
            aria-current={isActive(n.href) ? 'page' : undefined}>
            {n.icon}
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
