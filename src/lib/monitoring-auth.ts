import { timingSafeEqual } from 'node:crypto';

// Constant-time bearer-token check for the inbound monitoring routes
// (ingest + campaigns), consumed by the external n8n workflow. Uses a
// dedicated MONITORING_INGEST_SECRET rather than SUPABASE_SERVICE_ROLE_KEY so
// the database god-key never leaves the app (SEC-5). Fails closed when the
// secret is unset — do NOT fall back to comparing against `Bearer undefined`.
export function monitoringBearerOk(header: string | null): boolean {
  const secret = process.env.MONITORING_INGEST_SECRET;
  if (!secret || !header) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
