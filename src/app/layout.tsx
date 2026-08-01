import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

// Self-hosted so the build has no network dependency on Google Fonts — an
// air-gapped CI/build environment would otherwise fail (TEST-BUILD-1).
const manrope = localFont({
  src: [
    { path: './fonts/Manrope-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Manrope-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Manrope-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/Manrope-700.woff2', weight: '700', style: 'normal' },
    { path: './fonts/Manrope-800.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PolitIQ',
  description: 'AI campaign communications — human approval and disclosure built in.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
