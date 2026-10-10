import type { APIRequestContext } from '@playwright/test';
import { E2E_SECRETS } from '../env';
export const bearer = (s: string) => ({ authorization: `Bearer ${s}` });
export const cronGet = (r: APIRequestContext, path: string, secret: string = E2E_SECRETS.cron) =>
  r.get(path, { headers: bearer(secret) });
export const ingest = (r: APIRequestContext, data: unknown, secret: string = E2E_SECRETS.monitoring) =>
  r.post('/api/monitoring/ingest', { headers: bearer(secret), data });
