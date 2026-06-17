'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { adminLogoutAction } from '@/app/admin/actions';

const NAV = [
  {
    href: '/admin',
    label: 'Overview',
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
    href: '/admin/campaigns',
    label: 'Campaigns',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M2 12V6L8 2L14 6V12" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        <rect x="5.5" y="8" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    href: '/admin/users',
    label: 'Users',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M1.5 13.5C1.5 11.015 3.515 9 6 9C8.485 9 10.5 11.015 10.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <path d="M11 7.5C12.38 7.5 13.5 8.62 13.5 10V13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <circle cx="11.5" cy="5.5" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    href: '/admin/content',
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
    href: '/admin/audit',
    label: 'Audit log',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <line x1="4" y1="6.5" x2="8" y2="6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="4" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <circle cx="12" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
    ),
  },
  {
    href: '/admin/disclosure-rules',
    label: 'Disclosures',
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M8 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="8" cy="5" r="0.8" fill="currentColor"/>
      </svg>
    ),
  },
];

export function AdminSidebar({ name }: { name: string }) {
  const path = usePathname();
  const isActive = (href: string) =>
    href === '/admin' ? path === '/admin' : path.startsWith(href);

  return (
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <div className="brand-mark">
          <div className="brand-icon" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1.5 6L6 1.5L10.5 6L6 10.5L1.5 6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              <circle cx="6" cy="6" r="1.8" fill="currentColor"/>
            </svg>
          </div>
          <span className="brand-name">Command Center</span>
        </div>
        <div className="admin-badge">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <path d="M4 1L5.2 2.8H7L5.6 4L6.2 6L4 4.8L1.8 6L2.4 4L1 2.8H2.8L4 1Z" fill="currentColor"/>
          </svg>
          SUPER ADMIN
        </div>
      </div>

      <nav className="admin-nav">
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
        <form action={adminLogoutAction}>
          <button className="btn" style={{ width: '100%', fontSize: 13, padding: '7px 12px' }}>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
