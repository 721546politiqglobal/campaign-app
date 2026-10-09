import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AppFrame } from '@/components/AppFrame';
import { StatusPill } from '@/components/StatusPill';
import { ContentWizard } from '@/components/ContentWizard';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/session';
import { disclosureEngine } from '@/lib/services';
import { getContentItem, getDisclosuresForItem, getAuditEntries, getCampaign, getUsers } from '@/lib/data';
import { getCandidateProfile } from '@/lib/candidate';
import { getCampaignSocialProfile } from '@/lib/channels';
import type { SocialAccount } from '@/domain/channels';
import { isContentAuditAction } from '@/lib/audit-actions';

// Content audit actions have a translated label (content.audit.actions.*);
// anything else (older rows, future actions) falls back to a humanised raw name.
const BAD_AUDIT_ACTIONS = new Set(['reject', 'cron_publish_failed', 'cron_publish_error', 'cron_publish_not_connected']);
const OK_AUDIT_ACTIONS = new Set(['approve', 'publish', 'cron_publish']);

export default async function ContentDetail({ params }: { params: { id: string } }) {
  const [t, format] = await Promise.all([getTranslations('content'), getFormatter()]);
  const s = await requireSession();
  const [item, discs, log, profile, campaign, users, social] = await Promise.all([
    getContentItem(params.id),
    getDisclosuresForItem(params.id),
    getAuditEntries(params.id),
    getCandidateProfile(s.campaignId),
    getCampaign(s.campaignId),
    getUsers(s.campaignId),
    // Only pre-selects the wizard's networks; the publish/schedule actions
    // re-check server-side. A failed read (e.g. migration 044 not yet applied)
    // must not take the whole content page down with it.
    getCampaignSocialProfile(s.campaignId).catch(e => {
      console.error('[content] social profile read failed', e);
      return { accounts: [] as SocialAccount[] };
    }),
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

  const userName = (id?: string | null) => (id && users.find(u => u.id === id)?.name) || null;
  const rejectionNote = item.status === 'rejected'
    ? (log.find(a => a.action === 'reject')?.details?.note as string | undefined) ?? null
    : null;
  const createdName = userName(item.createdBy) ?? t('detail.unknownUser');

  return (
    <AppFrame>
      <PageHeader
        breadcrumb={[{ label: t('pageTitle'), href: '/content' }, { label: item.title }]}
        breadcrumbLabel={t('breadcrumbLabel')}
        eyebrow={t(`types.${item.type}`)}
        title={item.title}
        meta={<StatusPill status={item.status} />}
        description={t('detail.createdMeta', { name: createdName, date: format.dateTime(new Date(item.createdAt), { dateStyle: 'medium' }) })}
      />

      <ContentWizard
        item={item}
        hasDisclosure={attachedDisclosures}
        disclosureText={discs[0]?.disclosureText ?? null}
        requiredDisclosure={requiredDisclosure}
        rejectionNote={rejectionNote}
        videoSettings={{
          avatarId: profile?.heygenAvatarId ?? undefined,
          voiceId: profile?.elevenLabsVoiceId ?? undefined,
          background: profile?.videoBackground ?? 'plain',
          aspectRatio: profile?.videoAspectRatio ?? '16:9',
        }}
        role={s.role}
        connectedPlatforms={social.accounts.filter(a => !a.refreshRequired).map(a => a.platform)}
      />

      {log.length > 0 && (
        <section className="card content-activity" aria-labelledby="content-activity">
          <h2 id="content-activity">{t('audit.title')}</h2>
          <ol className="timeline">
            {log.map(a => {
              const label = isContentAuditAction(a.action)
                ? t(`audit.actions.${a.action}`)
                : t('audit.actions.other', { action: a.action.replace(/_/g, ' ') });
              const actor = a.actorUserId ? userName(a.actorUserId) ?? t('detail.unknownUser') : t('audit.system');
              const note = typeof a.details?.note === 'string' && a.details.note ? a.details.note : null;
              const tone = BAD_AUDIT_ACTIONS.has(a.action) ? 'is-bad' : OK_AUDIT_ACTIONS.has(a.action) ? 'is-ok' : '';
              return (
                <li key={a.id} className={`timeline-item ${tone}`}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div className="timeline-body">
                    <div className="timeline-title">{label}</div>
                    <div className="timeline-meta">
                      <span>{t('audit.by', { name: actor })}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={a.createdAt}>{format.dateTime(new Date(a.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
                    </div>
                    {note && <blockquote className="timeline-note">{note}</blockquote>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </AppFrame>
  );
}
