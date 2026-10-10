// Docker-free rebuild of the E2E Supabase project. Wipes the `public` schema,
// replays every migration in filename order, ensures the `media` storage
// bucket, applies the E2E seed, and reloads PostgREST's schema cache.
// Guarded: refuses any project not in ALLOWED_REFS.
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { Client, type ClientConfig } from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { createClient } from '@supabase/supabase-js';

export const ALLOWED_REFS = ['pckrdspetqcdbmcrqapx'] as const;

const REF = '[a-z0-9]{20}';
const DIRECT_HOST = new RegExp(`^db\\.(${REF})\\.supabase\\.co$`);
const POOLER_HOST = /^[a-z0-9-]+\.pooler\.supabase\.com$/;
const POOLER_USER = new RegExp(`^postgres\\.(${REF})$`);

function refuse(why: string): never {
  throw new Error(`Refusing to reset: ${why} (allow-list: ${ALLOWED_REFS.join(',')})`);
}

// Validates the DB URL with the exact parser pg uses (pg-connection-string),
// so the guard sees the same effective host/user that the connection will.
function resolveDbTarget(dbUrl: string): { ref: string; config: ClientConfig } {
  if (!dbUrl) refuse('E2E_DATABASE_URL is empty');
  let u: URL;
  try { u = new URL(dbUrl); } catch { refuse('E2E_DATABASE_URL is not a valid URL'); }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') refuse(`unexpected db protocol ${u.protocol}`);
  const extraParams = [...u.searchParams.keys()].filter((k) => k !== 'sslmode');
  if (extraParams.length) refuse(`db URL has disallowed query params: ${extraParams.join(',')}`);

  const parsed = parseConnectionString(dbUrl);
  const host = parsed.host ?? '';
  const user = parsed.user ?? '';
  const hostRef = host.match(DIRECT_HOST)?.[1] ?? null;
  const userRef = user.match(POOLER_USER)?.[1] ?? null;

  let ref: string;
  if (hostRef) {
    if (user !== 'postgres' && userRef !== hostRef) refuse(`db user does not match host project ${hostRef}`);
    ref = hostRef;
  } else if (POOLER_HOST.test(host)) {
    if (!userRef) refuse('pooler connection requires user postgres.<ref>');
    ref = userRef;
  } else {
    refuse(`db host ${host || '(none)'} is not a Supabase direct or pooler host`);
  }
  if (!(ALLOWED_REFS as readonly string[]).includes(ref)) refuse(`db ref=${ref} not allowed`);

  return {
    ref,
    config: {
      host,
      port: parsed.port ? Number(parsed.port) : 5432,
      user,
      password: parsed.password,
      database: parsed.database ?? 'postgres',
      ssl: { rejectUnauthorized: false },
    },
  };
}

function apiRefOf(supabaseUrl: string): string {
  let u: URL;
  try { u = new URL(supabaseUrl); } catch { refuse('NEXT_PUBLIC_SUPABASE_URL is empty or not a valid URL'); }
  const ref = u.hostname.match(new RegExp(`^(${REF})\\.supabase\\.co$`))?.[1];
  if (u.protocol !== 'https:' || !ref || u.port || u.username || u.password) {
    refuse(`API URL host ${u.hostname} is not https://<ref>.supabase.co`);
  }
  return ref;
}

function resolveTarget(dbUrl: string, supabaseUrl: string): { ref: string; config: ClientConfig } {
  const db = resolveDbTarget(dbUrl);
  const apiRef = apiRefOf(supabaseUrl);
  if (apiRef !== db.ref) refuse(`db ref=${db.ref} does not match api ref=${apiRef}`);
  return db;
}

export function assertAllowedTarget(dbUrl: string, supabaseUrl: string): string {
  return resolveTarget(dbUrl, supabaseUrl).ref;
}

const ROOT = resolve(__dirname, '..');

export async function resetDb({ log = console.log }: { log?: (m: string) => void } = {}) {
  const dbUrl = process.env.E2E_DATABASE_URL ?? '';
  const { ref, config } = resolveTarget(dbUrl, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  log(`[e2e:db] resetting ${ref}`);
  // Connect with the validated config, never the raw string, so nothing the
  // guard didn't check can redirect the connection.
  const client = new Client(config);
  await client.connect();
  try {
    await client.query(`drop schema if exists public cascade; create schema public;
      grant usage on schema public to postgres, anon, authenticated, service_role;
      grant all on schema public to postgres, service_role;
      alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;`);
    const dir = join(ROOT, 'supabase/migrations');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      try { await client.query(readFileSync(join(dir, f), 'utf8')); }
      catch (e) { throw new Error(`[e2e:db] migration ${f} failed: ${(e as Error).message}`); }
      log(`[e2e:db]   ✓ ${f}`);
    }
    await client.query(`insert into storage.buckets (id, name, public) values ('media','media',true)
      on conflict (id) do update set public = true;`);
    // Supabase blocks direct deletes from storage.objects; clear via the Storage API.
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: emptyErr } = await admin.storage.emptyBucket('media');
    if (emptyErr) throw new Error(`[e2e:db] emptying media bucket failed: ${emptyErr.message}`);
    log('[e2e:db]   ✓ media bucket ready (emptied)');
    await client.query(readFileSync(join(ROOT, 'e2e/seed.e2e.sql'), 'utf8'));
    log('[e2e:db]   ✓ seed.e2e.sql');
    await client.query(`notify pgrst, 'reload schema'`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  resetDb().catch((e) => { console.error(e.message); process.exit(1); });
}
