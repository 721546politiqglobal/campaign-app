import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/Logo';

export default async function NotFound() {
  const t = await getTranslations('system.notFound');
  return (
    <div className="system-page">
      <div className="system-card">
        <Logo />
        <span className="system-code">{t('code')}</span>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
        <div className="system-actions">
          <Link href="/" className="btn btn-primary">{t('home')}</Link>
        </div>
      </div>
    </div>
  );
}
