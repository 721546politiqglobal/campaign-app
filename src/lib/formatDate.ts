// src/lib/formatDate.ts

export function formatDate(iso: string, style: 'relative' | 'datetime' | 'date' = 'relative'): string {
  const date = new Date(iso);

  if (style === 'date') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (style === 'datetime') {
    return (
      date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    );
  }

  const diffMs    = Date.now() - date.getTime();
  const diffMins  = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays  = Math.floor(diffHours / 24);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7)   return `${diffDays} days ago`;
  return formatDate(iso, 'date');
}
