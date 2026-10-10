// Ayrshare endpoint URLs. AYRSHARE_BASE_URL is an optional test seam that
// redirects every Ayrshare call to a local fake (the E2E suite); unset, the
// URLs are exactly the real ones. Read at call time so tests can stub it.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function ayrshareUrl(host: 'app' | 'api', path: string): string {
  const base = process.env.AYRSHARE_BASE_URL;
  if (!base) return `https://${host}.ayrshare.com/api${path}`;
  if (process.env.NODE_ENV === 'production') {
    // A misconfigured production env must never send the real Ayrshare key
    // to a foreign host.
    let url: URL | null = null;
    try { url = new URL(base); } catch { /* rejected below */ }
    const ok = !!url && (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK.has(url.hostname);
    if (!ok) throw new Error('AYRSHARE_BASE_URL must be a loopback URL in production');
  }
  return `${base.replace(/\/+$/, '')}/${host}/api${path}`;
}
