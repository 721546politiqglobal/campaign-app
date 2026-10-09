'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MailIcon, XIcon } from '@/components/icons';
import { mailto } from '@/lib/contact';
import type { Locale } from '@/lib/locale';

type DemoVideoKey = 'commercial' | 'walkthrough';

// Each locale has its own recorded commercial and product walkthrough, shown
// as tabs in the modal in this order.
const VIDEOS: Record<Locale, { key: DemoVideoKey; duration: string }[]> = {
  en: [
    { key: 'commercial', duration: '1:21' },
    { key: 'walkthrough', duration: '1:46' },
  ],
  es: [
    { key: 'commercial', duration: '1:29' },
    { key: 'walkthrough', duration: '1:46' },
  ],
};

// Native <dialog> + showModal() gives us the focus trap, Escape-to-close and
// inert background for free. The video never autoplays: it only starts when
// the visitor presses play in the native controls.
export function DemoVideoModal({ open, onClose, locale }: { open: boolean; onClose: () => void; locale: Locale }) {
  const t = useTranslations('landing.demo');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videos = VIDEOS[locale];
  const [active, setActive] = useState<DemoVideoKey>(videos[0].key);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Lock page scroll while the modal is up so mobile visitors don't scroll
  // the landing page behind the video.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleClose = () => {
    videoRef.current?.pause();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="lp-demo-dialog"
      aria-labelledby="lp-demo-title"
      aria-modal="true"
      onClose={handleClose}
      onClick={(e) => {
        // A click on the dialog element itself (not its content) is a click
        // on the backdrop.
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="lp-demo-panel">
        <div className="lp-demo-head">
          <h2 id="lp-demo-title" className="lp-demo-title">{t('title')}</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={handleClose} aria-label={t('close')}>
            <XIcon />
          </button>
        </div>
        <div className="segmented lp-demo-tabs" role="tablist" aria-label={t('tabsLabel')}>
          {videos.map(v => (
            <button
              key={v.key}
              type="button"
              role="tab"
              id={`lp-demo-tab-${v.key}`}
              aria-selected={active === v.key}
              aria-controls="lp-demo-tabpanel"
              className={`lp-demo-tab${active === v.key ? ' active' : ''}`}
              onClick={() => setActive(v.key)}
            >
              <span>{t(`videos.${v.key}`)}</span>
              <span className="lp-demo-tab-duration num">{v.duration}</span>
            </button>
          ))}
        </div>
        <div
          className="lp-demo-video-wrap"
          id="lp-demo-tabpanel"
          role="tabpanel"
          aria-labelledby={`lp-demo-tab-${active}`}
        >
          {/* Keyed on the video so switching tabs swaps in a fresh, paused
              player instead of carrying over playback position. */}
          <video
            key={`${locale}-${active}`}
            ref={videoRef}
            className="lp-demo-video"
            controls
            playsInline
            preload="metadata"
            poster={`/videos/${locale}/${active}-poster.jpg`}
          >
            <source src={`/videos/${locale}/${active}.mp4`} type="video/mp4" />
            {t('unsupported')}
          </video>
        </div>
        <p className="lp-demo-sub">{t('subtitle')}</p>
        <div className="lp-demo-ctas">
          <a href={mailto(t('requestDemo'))} className="btn btn-primary">
            <MailIcon size={16} />
            {t('requestDemo')}
          </a>
          <Link href="/login" className="btn">{t('signIn')}</Link>
        </div>
      </div>
    </dialog>
  );
}
