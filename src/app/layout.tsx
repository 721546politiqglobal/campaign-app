import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { getLocale } from '@/lib/locale';
import { getTheme, themeAttribute } from '@/lib/theme';
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common.meta');
  return { title: t('title'), description: t('description') };
}

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F8FA' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0D12' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();
  const messages = await getMessages();
  // Explicit light/dark sets data-theme on the server so there is no flash;
  // `system` renders no attribute and the CSS media query decides.
  const theme = themeAttribute(getTheme());

  return (
    <html lang={locale} className={manrope.variable} data-theme={theme}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
