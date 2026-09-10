'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PreAuthLanguageToggle } from '@/components/PreAuthLanguageToggle';
import type { Locale } from '@/lib/locale';

const FEATURES = [
  {
    key: 'aiContent',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 5.5C3 4.12 4.12 3 5.5 3H8.5C9.88 3 11 4.12 11 5.5V8.5C11 9.88 9.88 11 8.5 11H5.5C4.12 11 3 9.88 3 8.5V5.5Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M13 5.5C13 4.12 14.12 3 15.5 3H17V4.5C17 5.88 15.88 7 14.5 7H13V5.5Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3 14L7 10L10 13L14 9L17 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="15" cy="15" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M15 13.5V15L16 16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'approvalWorkflow',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 10L9 12L13 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'disclosures',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 6V10.5L13 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M3.5 7.5H6M14 7.5H16.5M10 3V4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'opponentMonitoring',
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
  },
  {
    key: 'spendControls',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="12" width="3" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="8.5" y="8" width="3" height="9" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="14" y="4" width="3" height="13" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4.5 10L9 7L14 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'auditTrail',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M4 4H16V6H4V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M4 9H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M4 13H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="14.5" cy="13.5" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M14.5 12V13.5L15.5 14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
];

const STEPS = [
  { n: '01', key: 'draft' },
  { n: '02', key: 'review' },
  { n: '03', key: 'publish' },
];

function AppPreview() {
  return (
    <div className="lp-mockup-wrap">
      <div className="lp-mockup">
        <div className="lp-chrome">
          <div className="lp-dots">
            <span /><span /><span />
          </div>
          <div className="lp-url">politiq.ai/dashboard</div>
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

export function LandingPageClient({ currentLocale, isLoggedIn }: { currentLocale: Locale; isLoggedIn: boolean }) {
  const t = useTranslations('landing');
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
            <img src="/politiq-logo.png" alt="PolitIQ" className="lp-brand-logo-img" />
          </Link>
          <div className="lp-navlinks">
            <a href="#features">{t('nav.features')}</a>
            <a href="#workflow">{t('nav.howItWorks')}</a>
          </div>
          <div className="lp-nav-actions">
            {!isLoggedIn && <PreAuthLanguageToggle currentLocale={currentLocale} />}
            <Link href="/login" className="lp-nav-signin">{t('nav.signIn')}</Link>
            <Link href="/login" className="lp-nav-cta">{t('nav.getStarted')}</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-text">
            <h1 className="lp-h1">
              {t.rich('hero.title', {
                br: () => <br />,
                accent: chunks => <span className="lp-h1-accent">{chunks}</span>,
              })}
            </h1>
            <p className="lp-hero-sub">
              {t('hero.subtitle')}
            </p>
            <div className="lp-hero-ctas">
              <Link href="/login" className="lp-btn-primary">
                {t('hero.ctaPrimary')}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
              <a href="#features" className="lp-btn-ghost">
                {t('hero.ctaSecondary')}
              </a>
            </div>
            <div className="lp-hero-trust">
              <span>{t('hero.trustFec')}</span>
              <span className="lp-sep">·</span>
              <span>{t('hero.trustDisclosures')}</span>
              <span className="lp-sep">·</span>
              <span>{t('hero.trustAudit')}</span>
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
            <span className="lp-section-eyebrow">{t('features.eyebrow')}</span>
            <h2 className="lp-section-title">
              {t.rich('features.title', { br: () => <br /> })}
            </h2>
            <p className="lp-section-sub">
              {t('features.subtitle')}
            </p>
          </div>
          <div className="lp-features-grid">
            {FEATURES.map((f) => (
              <div key={f.key} className="lp-feature-card">
                <div className="lp-feature-icon">{f.icon}</div>
                <h3 className="lp-feature-title">{t(`features.items.${f.key}.label`)}</h3>
                <p className="lp-feature-desc">{t(`features.items.${f.key}.desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow ───────────────────────────────────────── */}
      <section className="lp-section lp-workflow-section" id="workflow">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-eyebrow">{t('workflow.eyebrow')}</span>
            <h2 className="lp-section-title">
              {t.rich('workflow.title', { br: () => <br /> })}
            </h2>
          </div>
          <div className="lp-steps">
            {STEPS.map((step, i) => (
              <div key={step.n} className="lp-step">
                <div className="lp-step-num">{step.n}</div>
                <div className="lp-step-body">
                  <h3 className="lp-step-title">{t(`workflow.steps.${step.key}.title`)}</h3>
                  <p className="lp-step-desc">{t(`workflow.steps.${step.key}.desc`)}</p>
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
            <h2 className="lp-cta-title">{t('cta.title')}</h2>
            <p className="lp-cta-sub">
              {t('cta.subtitle')}
            </p>
            <div className="lp-hero-ctas" style={{ justifyContent: 'center' }}>
              <Link href="/login" className="lp-btn-primary">
                {t('cta.primary')}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
              <a href="mailto:ceo@ivac.org" className="lp-btn-ghost">{t('cta.secondary')}</a>
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
                <img src="/politiq-logo.png" alt="PolitIQ" className="lp-brand-logo-img" />
              </div>
              <p className="lp-footer-tagline">
                {t.rich('footer.tagline', { br: () => <br /> })}
              </p>
            </div>
            <div className="lp-footer-links">
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">{t('footer.columns.product')}</div>
                <a href="#features">{t('footer.links.features')}</a>
                <a href="#workflow">{t('footer.links.howItWorks')}</a>
              </div>
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">{t('footer.columns.legal')}</div>
                <a href="#">{t('footer.links.privacyPolicy')}</a>
                <a href="#">{t('footer.links.termsOfService')}</a>
                <a href="#">{t('footer.links.fecCompliance')}</a>
              </div>
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">{t('footer.columns.company')}</div>
                <a href="#">{t('footer.links.about')}</a>
                <a href="mailto:ceo@ivac.org">{t('footer.links.contact')}</a>
              </div>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>{t('footer.copyright')}</span>
            <span>{t('footer.bottomNote')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
