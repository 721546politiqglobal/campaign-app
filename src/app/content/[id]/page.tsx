import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { ContentWizard } from '@/components/ContentWizard';
import { requireSession } from '@/lib/session';
import { disclosureEngine } from '@/lib/services';
import { getContentItem, getDisclosuresForItem, getAuditEntries } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';

export default async function ContentDetail({ params }: { params: { id: string } }) {
  const s = requireSession();
  const [item, discs, log, profile] = await Promise.all([
    getContentItem(params.id),
    getDisclosuresForItem(params.id),
    getAuditEntries(params.id),
    getCandidateProfile(s.campaignId),
  ]);
  if (!item) notFound();

  const hasDisclosure = discs.length > 0;
  const requiredDisclosures =
    item.isAiGenerated && !hasDisclosure
      ? await disclosureEngine.requiredFor(item.targetJurisdictions, item.isAiGenerated)
      : [];

  return (
    <AppFrame>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/content">Content</Link>
        <span className="breadcrumb-sep" aria-hidden>›</span>
        <span>{item.title}</span>
      </nav>
      <div className="pagehead">
        <div>
          <span className="eyebrow">{item.type.replace('_', ' ')}</span>
          <h1>{item.title}</h1>
        </div>
        <StatusPill status={item.status} />
      </div>

      <ContentWizard
        item={item}
        hasDisclosure={hasDisclosure}
        requiredDisclosures={requiredDisclosures}
        videoSettings={{
          avatarId: profile?.heygenAvatarId ?? undefined,
          voiceId: profile?.elevenLabsVoiceId ?? undefined,
          background: profile?.videoBackground ?? 'plain',
          aspectRatio: profile?.videoAspectRatio ?? '16:9',
        }}
        role={s.role}
      />

      {log.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2>Activity</h2>
          {log.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 12, padding: '5px 0', fontSize: 13, borderBottom: '1px solid var(--line)' }}>
              <span className="mono" style={{ color: 'var(--text-3)', minWidth: 70 }}>
                {new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>
                {a.action.replace(/_/g, ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </AppFrame>
  );
}
