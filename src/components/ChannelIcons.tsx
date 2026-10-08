import type { Platform } from '@/domain/types';

// Simplified brand marks. Rendered in currentColor; the tile sets the brand color.
const PATHS: Record<Platform, JSX.Element> = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="2" fill="none"/>
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="2" fill="none"/>
      <circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/>
    </>
  ),
  facebook: <path fill="currentColor" d="M13.5 21v-7.4h2.5l.4-2.9h-2.9V8.9c0-.8.2-1.4 1.4-1.4h1.6V4.9c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.1H8.1v2.9h2.5V21h2.9z"/>,
  x: <path fill="currentColor" d="M17.8 3h3l-6.6 7.6L22 21h-6.1l-4.8-6.2L5.6 21h-3l7.1-8.1L2.3 3h6.2l4.3 5.7L17.8 3zm-1 16.2h1.7L7.4 4.7H5.6l11.2 14.5z"/>,
  linkedin: <path fill="currentColor" d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4V21H3V9.75zm6.5 0h3.8v1.6h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-4.9c0-1.17-.02-2.68-1.63-2.68-1.64 0-1.89 1.28-1.89 2.6V21h-4V9.75z"/>,
  tiktok: <path fill="currentColor" d="M16.6 3c.3 2.2 1.6 3.7 3.9 3.9v3c-1.4.1-2.7-.3-3.9-1.1v5.9c0 3.6-2.9 6.3-6.4 6.3S4 18.3 4 14.8c0-3.8 3.4-6.7 7.3-6.2v3.1c-1.8-.4-3.6.9-3.6 2.9 0 1.6 1.2 2.9 2.8 2.9 1.7 0 2.9-1.2 2.9-3.3V3h3.2z"/>,
  youtube: <path fill="currentColor" d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/>,
};

export function ChannelIcon({ platform, size = 22 }: { platform: Platform; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden focusable="false">
      {PATHS[platform]}
    </svg>
  );
}
