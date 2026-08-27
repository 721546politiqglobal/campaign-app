import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { ContentWizard } from '@/components/ContentWizard';
import { requireSession } from '@/lib/session';
import { disclosureEngine } from '@/lib/services';
import { getContentItem, getDisclosuresForItem, getAuditEntries, getCampaign } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';

export default async function ContentDetail({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const [item, discs, log, profile, campaign] = await Promise.all([
    getContentItem(params.id),
    getDisclosuresForItem(params.id),
    getAuditEntries(params.id),
    getCandidateProfile(s.campaignId),
    getCampaign(s.campaignId),
  ]);
  if (!item || item.campaignId !== s.campaignId) notFound();

  const attachedDisclosures = discs.length > 0;
  // AI-generated content now always requires exactly one disclosure (the
  // campaign default, or a generic fallback) — there's no more "genuinely
  // requires none" exemption, so this is satisfied only once a real record
  // is attached.
  const requiredDisclosure =
    item.isAiGenerated && !attachedDisclosures
      ? disclosureEngine.requiredFor(item.isAiGenerated, campaign?.defaultDisclosureText ?? null)
      : null;
  const hasDisclosure = attachedDisclosures;

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
        requiredDisclosure={requiredDisclosure}
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
                {new Date(a.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
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
