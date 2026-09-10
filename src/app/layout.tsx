import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { ToastProvider } from '@/components/Toast';
import { getLocale } from '@/lib/locale';
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={manrope.variable}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <ToastProvider>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
