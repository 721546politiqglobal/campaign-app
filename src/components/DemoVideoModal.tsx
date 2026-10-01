'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

const VIDEO_SRC = '/videos/politiq-demo.mp4';
const POSTER_SRC = '/videos/politiq-demo-poster.jpg';

// Native <dialog> + showModal() gives us the focus trap, Escape-to-close and
// inert background for free. The video never autoplays: it only starts when
// the visitor presses play in the native controls.
export function DemoVideoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('landing.demo');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
          <button type="button" className="lp-demo-close" onClick={handleClose} aria-label={t('close')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="lp-demo-video-wrap">
          <video
            ref={videoRef}
            className="lp-demo-video"
            controls
            playsInline
            preload="metadata"
            poster={POSTER_SRC}
          >
            <source src={VIDEO_SRC} type="video/mp4" />
            {t('unsupported')}
          </video>
        </div>
        <p className="lp-demo-sub">{t('subtitle')}</p>
        <div className="lp-demo-ctas">
          <Link href="/login" className="lp-btn-primary">
            {t('startCampaign')}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <a href="mailto:ceo@ivac.org?subject=Politiq.global%20demo%20request" className="lp-btn-ghost">
            {t('requestDemo')}
          </a>
        </div>
      </div>
    </dialog>
  );
}
