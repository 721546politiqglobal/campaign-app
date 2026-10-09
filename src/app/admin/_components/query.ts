// Helpers for the admin list pages: parse `?q=&page=&sort=&dir=` search params
// and build hrefs that preserve the rest of the query.

export type SearchParams = Record<string, string | string[] | undefined>;

export const Q_MAX = 100;

export function str(sp: SearchParams | undefined, key: string): string | undefined {
  const v = sp?.[key];
  return typeof v === 'string' ? v : undefined;
}

export function parseQ(v: string | undefined): string {
  return (v ?? '').trim().slice(0, Q_MAX);
}

export function parsePage(v: string | undefined): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function parseEnum<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function parseDir(v: string | undefined): 'asc' | 'desc' | undefined {
  return v === 'asc' || v === 'desc' ? v : undefined;
}

export type HrefParams = Record<string, string | number | undefined | null>;

// Builds `path?k=v…`, dropping empty values and `page=1` so canonical URLs stay short.
export function buildHref(path: string, params: HrefParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'page' && Number(v) <= 1) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
