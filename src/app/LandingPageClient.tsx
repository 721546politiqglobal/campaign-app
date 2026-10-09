'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PreAuthLanguageToggle } from '@/components/PreAuthLanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { DemoVideoModal } from '@/components/DemoVideoModal';
import { Icon, ArrowRightIcon, MailIcon, PlayIcon, type IconName } from '@/components/icons';
import { mailto } from '@/lib/contact';
import type { Theme } from '@/lib/theme-shared';
import type { Locale } from '@/lib/locale';

const FEATURES: { key: string; icon: IconName }[] = [
  { key: 'aiContent', icon: 'sparkles' },
  { key: 'approvalWorkflow', icon: 'check' },
  { key: 'disclosures', icon: 'shield' },
  { key: 'opponentMonitoring', icon: 'monitoring' },
  { key: 'spendControls', icon: 'billing' },
  { key: 'auditTrail', icon: 'audit' },
];

const STEPS = [
  { n: '01', key: 'draft' },
  { n: '02', key: 'review' },
  { n: '03', key: 'publish' },
] as const;

const MOCK_WORKSPACE: IconName[] = ['dashboard', 'content', 'monitoring', 'analytics'];
const MOCK_ASSETS: IconName[] = ['channels', 'avatars'];
const MOCK_STATS: { status: 'draft' | 'in_review' | 'scheduled' | 'published'; n: string }[] = [
  { status: 'draft', n: '3' }, { status: 'in_review', n: '5' }, { status: 'scheduled', n: '2' }, { status: 'published', n: '12' },
];
const MOCK_QUEUE: { tone: 'warn' | 'info' | 'purple'; status: 'in_review' | 'approved' | 'scheduled'; w: string }[] = [
  { tone: 'warn', status: 'in_review', w: 'w70' }, { tone: 'info', status: 'approved', w: 'w50' }, { tone: 'purple', status: 'scheduled', w: 'w60' },
];

/* Decorative, theme-aware miniature of the real app shell (sidebar with
   grouped nav, KPI tiles, approval queue). Uses the live nav / status
   translations so it localises with the page. Hidden from assistive tech. */
function AppPreview() {
  const t = useTranslations('landing.mockup');
  const tc = useTranslations('common');
  return (
    <div className="lp-mockup" aria-hidden="true">
      <div className="lp-chrome">
        <div className="lp-dots"><span /><span /><span /></div>
        <div className="lp-url">politiq.ai/dashboard</div>
      </div>
      <div className="lp-app">
        <div className="lp-sidebar">
          <div className="lp-sb-brand"><Logo className="lp-sb-logo" /></div>
          <div className="lp-sb-campaign">
            <span className="lp-sb-campaign-label">{tc('navGroups.campaign')}</span>
            {t('campaign')}
          </div>
          <div className="lp-sb-group">
            <span className="lp-sb-group-label">{tc('navGroups.workspace')}</span>
            {MOCK_WORKSPACE.map((k, i) => (
              <div key={k} className={`lp-sb-item${i === 0 ? ' active' : ''}`}>
                <Icon name={k} size={12} />{tc(`nav.${k}`)}
              </div>
            ))}
          </div>
          <div className="lp-sb-group">
            <span className="lp-sb-group-label">{tc('navGroups.assets')}</span>
            {MOCK_ASSETS.map(k => (
              <div key={k} className="lp-sb-item"><Icon name={k} size={12} />{tc(`nav.${k}`)}</div>
            ))}
          </div>
        </div>
        <div className="lp-main">
          <div className="lp-page-head">
            <div>
              <span className="lp-page-eyebrow">{t('eyebrow')}</span>
              <span className="lp-page-title">{t('title')}</span>
            </div>
            <span className="lp-chip">{t('action')}</span>
          </div>
          <div className="lp-stats">
            {MOCK_STATS.map(s => (
              <div key={s.status} className="lp-stat">
                <span className="lp-stat-label">{tc(`status.${s.status}`)}</span>
                <span className="lp-stat-n num">{s.n}</span>
              </div>
            ))}
          </div>
          <div className="lp-two-col">
            <div className="lp-card">
              <div className="lp-card-title">{t('queue')}</div>
              {MOCK_QUEUE.map((row, i) => (
                <div key={i} className="lp-row">
                  <span className={`lp-line ${row.w}`} />
                  <span className={`badge badge-${row.tone} badge-dot badge-sm`}>{tc(`status.${row.status}`)}</span>
                </div>
              ))}
            </div>
            <div className="lp-card">
              <div className="lp-card-title">{t('monitoring')}</div>
              {[0, 1, 2].map(i => (
                <div key={i} className="lp-row lp-row-stack">
                  <span className="lp-line w50" />
                  <span className="lp-line w80" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPageClient({ currentLocale, currentTheme, isLoggedIn }: { currentLocale: Locale; currentTheme: Theme; isLoggedIn: boolean }) {
  const t = useTranslations('landing');
  const [scrolled, setScrolled] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const openDemo = () => setDemoOpen(true);
  const requestAccessHref = mailto(t('hero.ctaPrimary'));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp">
      {/* ── Navbar ─────────────────────────────────────────── */}
      <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="lp-nav-inner">
          <Link href="/" className="lp-brand" aria-label="PolitIQ">
            <Logo className="lp-brand-logo-img" />
          </Link>
          <div className="lp-navlinks">
            <a href="#features">{t('nav.features')}</a>
            <a href="#workflow">{t('nav.howItWorks')}</a>
          </div>
          <div className="lp-nav-actions">
            <ThemeToggle current={currentTheme} size="sm" />
            <PreAuthLanguageToggle currentLocale={currentLocale} />
            {isLoggedIn ? (
              <Link href="/dashboard" className="btn btn-primary btn-sm">{t('nav.openDashboard')}</Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost btn-sm">{t('nav.signIn')}</Link>
                <a href={requestAccessHref} className="btn btn-primary btn-sm lp-nav-cta">{t('nav.requestAccess')}</a>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-hero-text">
            <span className="lp-eyebrow-pill">{t('hero.eyebrow')}</span>
            <h1 className="lp-h1">
              {t.rich('hero.title', { accent: chunks => <span className="lp-h1-accent">{chunks}</span> })}
            </h1>
            <p className="lp-hero-sub">{t('hero.subtitle')}</p>
            <div className="lp-hero-ctas">
              <a href={requestAccessHref} className="btn btn-primary btn-lg">
                <MailIcon size={16} />
                {t('hero.ctaPrimary')}
              </a>
              <button type="button" className="btn btn-lg" onClick={openDemo}>
                <PlayIcon size={16} />
                {t('hero.watchDemo')}
              </button>
            </div>
            <p className="lp-hero-invite">
              {t('hero.inviteHint')}{' '}
              <Link href="/join" className="link lp-inline-link">
                {t('hero.inviteLink')}
                <ArrowRightIcon size={14} />
              </Link>
            </p>
            <div className="lp-hero-trust">
              <span>{t('hero.trustFec')}</span>
              <span className="lp-sep" aria-hidden="true">·</span>
              <span>{t('hero.trustDisclosures')}</span>
              <span className="lp-sep" aria-hidden="true">·</span>
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
            <h2 className="lp-section-title">{t('features.title')}</h2>
            <p className="lp-section-sub">{t('features.subtitle')}</p>
          </div>
          <div className="lp-features-grid">
            {FEATURES.map((f) => (
              <div key={f.key} className="lp-feature-card">
                <div className="lp-feature-icon"><Icon name={f.icon} size={20} /></div>
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
            <h2 className="lp-section-title">{t('workflow.title')}</h2>
          </div>
          <ol className="lp-steps">
            {STEPS.map((step) => (
              <li key={step.n} className="lp-step">
                <div className="lp-step-num">{step.n}</div>
                <h3 className="lp-step-title">{t(`workflow.steps.${step.key}.title`)}</h3>
                <p className="lp-step-desc">{t(`workflow.steps.${step.key}.desc`)}</p>
              </li>
            ))}
          </ol>
          <div className="lp-workflow-cta">
            <button type="button" className="btn" onClick={openDemo}>
              <PlayIcon size={16} />
              {t('hero.watchDemo')}
            </button>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ─────────────────────────────────────── */}
      <section className="lp-cta-section">
        <div className="lp-container">
          <div className="lp-cta-inner">
            <h2 className="lp-cta-title">{t('cta.title')}</h2>
            <p className="lp-cta-sub">{t('cta.subtitle')}</p>
            <div className="lp-hero-ctas lp-ctas-center">
              <a href={requestAccessHref} className="btn btn-primary btn-lg">
                <MailIcon size={16} />
                {t('cta.primary')}
              </a>
              <Link href="/login" className="btn btn-lg">{t('cta.secondary')}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-top">
            <div className="lp-footer-brand">
              <Logo className="lp-brand-logo-img" />
              <p className="lp-footer-tagline">{t('footer.tagline')}</p>
            </div>
            <div className="lp-footer-links">
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">{t('footer.columns.product')}</div>
                <a href="#features">{t('footer.links.features')}</a>
                <a href="#workflow">{t('footer.links.howItWorks')}</a>
              </div>
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">{t('footer.columns.account')}</div>
                <Link href="/login">{t('footer.links.signIn')}</Link>
                <Link href="/join">{t('footer.links.joinWithInvite')}</Link>
              </div>
              <div className="lp-footer-col">
                <div className="lp-footer-col-title">{t('footer.columns.company')}</div>
                <a href={requestAccessHref}>{t('footer.links.requestAccess')}</a>
                <a href={mailto()}>{t('footer.links.contact')}</a>
              </div>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>{t('footer.copyright')}</span>
            <span>{t('footer.bottomNote')}</span>
          </div>
        </div>
      </footer>

      <DemoVideoModal open={demoOpen} onClose={() => setDemoOpen(false)} locale={currentLocale} />
    </div>
  );
}
