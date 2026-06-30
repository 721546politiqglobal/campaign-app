'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12L12 4L20 12L12 20L4 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <circle cx="12" cy="12" r="3.5" fill="currentColor"/>
    </svg>
  );
}

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 5.5C3 4.12 4.12 3 5.5 3H8.5C9.88 3 11 4.12 11 5.5V8.5C11 9.88 9.88 11 8.5 11H5.5C4.12 11 3 9.88 3 8.5V5.5Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M13 5.5C13 4.12 14.12 3 15.5 3H17V4.5C17 5.88 15.88 7 14.5 7H13V5.5Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3 14L7 10L10 13L14 9L17 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="15" cy="15" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M15 13.5V15L16 16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
    label: 'AI Content Generation',
    desc: 'Draft social posts, press releases, emails, and talking points in seconds. Every piece runs through your brand voice.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 10L9 12L13 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: 'Human Approval Workflow',
    desc: 'Route every piece of content through role-based review before it ever goes public. Full chain of custody.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 6V10.5L13 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M3.5 7.5H6M14 7.5H16.5M10 3V4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
    label: 'Automatic Disclosures',
    desc: 'Jurisdiction-aware disclosure rules applied instantly. State-specific AI disclosure requirements handled automatically.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="10" y1="3" x2="10" y2="5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="17" y1="10" x2="14.5" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="3" y1="10" x2="5.5" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="10" y1="17" x2="10" y2="14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
    label: 'Opponent Monitoring',
    desc: 'Track what the other side is saying in real time. Surface rebuttal opportunities before they become narratives.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="12" width="3" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="8.5" y="8" width="3" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="14" y="4" width="3" height="13" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4.5 10L9 7L14 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: 'Spend Controls',
    desc: 'Set monthly cost caps per campaign. AI drafting, video generation, and voice synthesis all tracked against your budget.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M4 4H16V6H4V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M4 9H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M4 13H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="14.5" cy="13.5" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M14.5 12V13.5L15.5 14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
    label: 'Full Audit Trail',
    desc: 'Every action logged with actor, timestamp, and context. FEC-ready records at your fingertips come disclosure season.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Draft in seconds',
    desc: "Describe what you need. Command Center's AI drafts press releases, social posts, email blasts, and talking points instantly.",
  },
  {
    n: '02',
    title: 'Review and approve',
    desc: 'Content routes to your approval team. Managers, approvers, and legal all get the right view at the right time.',
  },
  {
    n: '03',
    title: 'Publish with confidence',
    desc: 'Disclosures are auto-applied by jurisdiction before anything goes live. One click to publish across every platform.',
  },
];

function AppPreview() {
  return (
    <div className="lp-mockup-wrap">
      <div className="lp-mockup">
        <div className="lp-chrome">
          <div className="lp-dots">
            <span /><span /><span />
          </div>
          <div className="lp-url">commandcenter.ai/dashboard</div>
        </div>
        <div className="lp-app">
          <div className="lp-sidebar">
            <div className="lp-sb-logo">
              <div className="lp-sb-icon" />
              <div className="lp-sb-lines">
                <div className="lp-line w60" />
                <div className="lp-line w40" style={{ marginTop: 3 }} />
              </div>
            </div>
            {[true, false, false, false].map((active, i) => (
              <div key={i} className={`lp-nav-item${active ? ' active' : ''}`}>
                <div className="lp-nav-dot" />
                <div className="lp-line" style={{ width: 50 + i * 8 }} />
              </div>
            ))}
          </div>
          <div className="lp-main">
            <div className="lp-topbar">
              <div className="lp-line w100" />
              <div className="lp-badge" />
            </div>
            <div className="lp-content-area">
              <div className="lp-page-head">
                <div>
                  <div className="lp-line w30" style={{ marginBottom: 5 }} />
                  <div className="lp-line w50 bold" />
                </div>
                <div className="lp-cta-chip" />
              </div>
              <div className="lp-stats-row">
                {[
                  { n: '3', accent: false },
                  { n: '12', accent: false },
                  { n: '7', accent: true },
                ].map((s, i) => (
                  <div key={i} className="lp-stat-card">
                    <div className="lp-stat-icon" />
                    <div className={`lp-stat-n${s.accent ? ' accent' : ''}`}>{s.n}</div>
                    <div className="lp-line w60" style={{ marginTop: 4 }} />
                  </div>
                ))}
              </div>
              <div className="lp-two-col">
                <div className="lp-card">
                  <div className="lp-card-head">
                    <div className="lp-line w50" />
                  </div>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="lp-row">
                      <div className="lp-line w70" />
                      <div className={`lp-pill ${i === 0 ? 'warn' : i === 1 ? 'ok' : 'purple'}`} />
                    </div>
                  ))}
                </div>
                <div className="lp-card">
                  <div className="lp-card-head">
                    <div className="lp-line w40" />
                  </div>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="lp-row">
                      <div style={{ flex: 1 }}>
                        <div className="lp-line w50" style={{ marginBottom: 4 }} />
                        <div className="lp-line w80" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp">
      {/* ── Navbar ─────────────────────────────────────────── */}
      <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="lp-nav-inner">
          <Link href="/" className="lp-brand">
            <span style={{ color: 'var(--accent)' }}><LogoMark size={22} /></span>
            <span className="lp-brand-name">Command Center</span>
          </Link>
          <div className="lp-navlinks">
            <a href="#features">Features</a>
            <a href="#workflow">How it works</a>
          </div>
          <div className="lp-nav-actions">
            <Link href="/login" className="lp-nav-signin">Sign in</Link>
            <Link href="/login" className="lp-nav-cta">Get started</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-text">
            <h1 className="lp-h1">
              The war room<br />
              for modern<br />
              <span className="lp-h1-accent">campaigns.</span>
            </h1>
            <p className="lp-hero-sub">
              AI-drafted content, human-reviewed, legally disclosed.{' '}
              Run your entire communications operation from one command center.
            </p>
            <div className="lp-hero-ctas">
              <Link href="/login" className="lp-btn-primary">
                Get started
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
              <a href="#features" className="lp-btn-ghost">
                See the platform
              </a>
            </div>
            <div className="lp-hero-trust">
              <span>FEC-compliant records</span>
              <span className="lp-sep">·</span>
              <span>State-aware disclosures</span>
              <span className="lp-sep">·</span>
              <span>Full audit trail</span>
            </div>
          </div>
          <div className="lp-hero-visual">
            <AppPreview />
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────── */}
      <section className="lp-section" id="features">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-eyebrow">Platform</span>
            <h2 className="lp-section-title">
              Everything your campaign<br />needs to communicate.
            </h2>
            <p className="lp-section-sub">
              Built specifically for political campaigns — every feature is designed around the unique demands of election law and campaign operations.
            </p>
          </div>
          <div className="lp-features-grid">
            {FEATURES.map((f) => (
              <div key={f.label} className="lp-feature-card">
                <div className="lp-feature-icon">{f.icon}</div>
                <h3 className="lp-feature-title">{f.label}</h3>
                <p className="lp-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow ───────────────────────────────────────── */}
      <section className="lp-section lp-workflow-section" id="workflow">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-eyebrow">How it works</span>
            <h2 className="lp-section-title">
              From brief to published<br />in minutes, not days.
            </h2>
          </div>
          <div className="lp-steps">
            {STEPS.map((step, i) => (
              <div key={step.n} className="lp-step">
                <div className="lp-step-num">{step.n}</div>
                <div className="lp-step-body">
                  <h3 className="lp-step-title">{step.title}</h3>
                  <p className="lp-step-desc">{step.desc}</p>
                </div>
                {i < STEPS.length - 1 && <div className="lp-step-connector" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ─────────────────────────────────────── */}
      <section className="lp-cta-section">
        <div className="lp-container">
          <div className="lp-cta-inner">
            <h2 className="lp-cta-title">Ready to run a smarter campaign?</h2>
            <p className="lp-cta-sub">
              AI-powered communications built for the demands of modern political campaigns.
            </p>
            <div className="lp-hero-ctas" style={{ justifyContent: 'center' }}>
              <Link href="/login" className="lp-btn-primary">
                Get started
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
              <a href="mailto:hello@commandcenter.ai" className="lp-btn-ghost">Talk to the team</a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-top">
            <div className="lp-footer-brand">
              <div className="lp-brand" style={{ marginBottom: 12 }}>
                <span style={{ color: 'var(--accent)' }}><LogoMark size={20} /></span>
                <span className="lp-brand-name">Command Center</span>
              </div>
              <p className="lp-footer-tagline">
                AI campaign communications<br />with compliance built in.
              </p>
            </div>
            <div className="lp-footer-links">
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">Product</div>
                <a href="#features">Features</a>
                <a href="#workflow">How it works</a>
              </div>
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">Legal</div>
                <a href="#">Privacy policy</a>
                <a href="#">Terms of service</a>
                <a href="#">FEC compliance</a>
              </div>
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">Company</div>
                <a href="#">About</a>
                <a href="mailto:hello@commandcenter.ai">Contact</a>
              </div>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© 2026 Command Center. All rights reserved.</span>
            <span>Built for campaigns that play to win.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
