import { ContentStatus } from '@/domain/types';

const LABELS: Record<ContentStatus, string> = {
  draft: 'Draft', in_review: 'In review', approved: 'Approved', scheduled: 'Scheduled',
  published: 'Published', rejected: 'Rejected', archived: 'Archived',
};

export function StatusPill({ status }: { status: ContentStatus }) {
  return <span className={`pill ${status}`} aria-label={`Status: ${status}`}>{LABELS[status]}</span>;
}
