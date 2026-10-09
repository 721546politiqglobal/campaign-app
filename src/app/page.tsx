import { getLocale } from '@/lib/locale';
import { getTheme } from '@/lib/theme';
import { hasValidSession } from '@/lib/session';
import { LandingPageClient } from './LandingPageClient';

// LandingPage's markup lives in LandingPageClient (a client component, for
// its scroll-state nav effect). getLocale()/getTheme()/hasValidSession() read
// cookies/headers and can only run in a server component, so this thin
// wrapper computes them and hands them down as props.
export default function Page() {
  return <LandingPageClient currentLocale={getLocale()} currentTheme={getTheme()} isLoggedIn={hasValidSession()} />;
}
