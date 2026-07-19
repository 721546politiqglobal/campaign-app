# Security Hardening & UX Polish Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. For code-testable tasks this plan is TDD: write the failing test, watch it fail, implement, watch it pass. For visual/UX tasks the acceptance step is a browser check at desktop (1440px) and mobile (390px) — described inline.

**Goal:** Close the remaining P2/P3 security backstops and UX defects from the 2026-07-15 audit that are *not* covered by the P0 launch-blocker plan: SEC-5, SEC-7, SEC-10 (security) and UX-1, UX-2, UX-3, UX-4, UX-5, FLOW-1 (UX/flows). These are defense-in-depth and polish — none are tenant-isolation blockers (those live in `2026-07-15-p0-launch-blockers.md`), but they are all launch-quality gates.

**Architecture:** All security items are bounded: a shared bearer-token compare helper for the two monitoring routes (SEC-5), a database-backed login throttle plus a pure decision helper (SEC-10), a one-line redirect-target fix in `requireAdmin` (FLOW-1), and one large defense-in-depth RLS migration that enables row-level security on every tenant table (SEC-7). The UX items touch server components, one client component conversion for validated inline errors (UX-3), pure helper functions (UX-5 credibility/relevance), and CSS/JSX-only edits (UX-2, UX-4, UX-1). No new runtime dependencies.

**Tech Stack:** Next.js 14 App Router (server actions + server components), Supabase (`adminDb` service-role client — bypasses RLS), Postgres migrations under `supabase/migrations/`, Vitest. Server actions return `type Result = { ok: true } | { ok: false; error: string }`. Node crypto `timingSafeEqual` is already used in `src/lib/session.ts`.

## Global Constraints

- **No autonomous git commits** — the user reviews and commits (per project memory). Do not run `git commit`/`git push`.
- **UX changes must be verified in the browser** against the running dev server at **desktop 1440px and mobile 390px** before a UX task is considered done. Screenshot or describe the observed result in the handoff. Typecheck/tests alone do not close a UX task.
- **Security changes need tests where unit-testable.** SEC-5, SEC-10, and FLOW-1 have testable cores and MUST land with a failing-first test. SEC-7 (RLS) is a schema migration with no vitest surface; it is verified by applying it to a scratch database and confirming the assertions in that task.
- Tests mock `next/cache`, `next/navigation`, `next/headers`, `@/lib/session`, `@/lib/data`, `@/lib/supabase`, `@/lib/candidate` — mirror the scaffolding in `src/app/actions.avatar-billing.test.ts`.
- The monitoring routes authenticate external callers (n8n). The service-role key must **never** be reused as an inbound bearer token again (SEC-5). Any secret compare must be constant-time and fail closed when the secret env var is unset.
- `getMonthlySpend` (src/lib/data.ts:121) is the single spend window used by both the dashboard and billing screens; UX-1 must not fork it. The deeper calendar-vs-billing-period window mismatch is tracked separately as **BILL-11** and is out of scope here — UX-1 only unifies *labels/framing* over that one shared window.
- Run `npm test && npm run typecheck` green after every task (scripts: `test` → `vitest run`, `typecheck` → `tsc --noEmit`).

## Finding → Task map

- **Task 1** — SEC-5 (dedicated monitoring ingest secret)
- **Task 2** — SEC-10 (login rate limiting / lockout)
- **Task 3** — FLOW-1 (non-admin `/admin` redirect)
- **Task 4** — SEC-7 (RLS defense-in-depth migration)
- **Task 5** — UX-3 (settings profile validation, client + server)
- **Task 6** — UX-1 (dashboard vs billing spend framing; cross-ref BILL-11)
- **Task 7** — UX-2 (avatars: names required + thumbnails + dates)
- **Task 8** — UX-4 (monitoring excerpt line-clamp)
- **Task 9** — UX-5 (monitoring relevance + credibility variation)

---

### Task 1: Mint a dedicated `MONITORING_INGEST_SECRET` for the monitoring routes (SEC-5)

The two monitoring routes currently accept `` `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` `` as their inbound auth token (src/app/api/monitoring/ingest/route.ts:8, src/app/api/monitoring/campaigns/route.ts:9). That is the database god-key, shared with an external n8n instance. Mint a purpose-built secret, compare it in constant time, and stop leaking the service-role key off-box.

**Files:**
- Create: `src/lib/monitoring-auth.ts` (shared bearer compare)
- Create: `src/lib/monitoring-auth.test.ts` (new)
- Modify: `src/app/api/monitoring/ingest/route.ts:6-10`
- Modify: `src/app/api/monitoring/campaigns/route.ts:7-11`
- Modify: `.env.example` (add `MONITORING_INGEST_SECRET`, blank the leaked HeyGen/ElevenLabs IDs while here — see step 5)
- Modify: `n8n-opposition-monitoring.json` (documentation note only — see step 6)

**Interfaces:**
- Produces: `export function monitoringBearerOk(header: string | null): boolean` — constant-time compare of the `Authorization` header against `` `Bearer ${process.env.MONITORING_INGEST_SECRET}` ``; returns `false` when the env var is falsy (fail closed) or lengths differ (guards `timingSafeEqual`, which throws on unequal-length buffers).

- [ ] **Step 1: Write the failing test** (`src/lib/monitoring-auth.test.ts`)

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { monitoringBearerOk } from './monitoring-auth';

const OLD = process.env.MONITORING_INGEST_SECRET;
afterEach(() => { process.env.MONITORING_INGEST_SECRET = OLD; });

describe('monitoringBearerOk', () => {
  it('accepts the correct bearer token', () => {
    process.env.MONITORING_INGEST_SECRET = 's3cret-value';
    expect(monitoringBearerOk('Bearer s3cret-value')).toBe(true);
  });

  it('rejects a wrong token', () => {
    process.env.MONITORING_INGEST_SECRET = 's3cret-value';
    expect(monitoringBearerOk('Bearer nope')).toBe(false);
  });

  it('rejects when the header is missing', () => {
    process.env.MONITORING_INGEST_SECRET = 's3cret-value';
    expect(monitoringBearerOk(null)).toBe(false);
  });

  it('fails closed when the secret env var is unset (no "Bearer undefined" bypass)', () => {
    delete process.env.MONITORING_INGEST_SECRET;
    expect(monitoringBearerOk('Bearer undefined')).toBe(false);
    expect(monitoringBearerOk('Bearer ')).toBe(false);
  });

  it('does not throw on a length-mismatched token', () => {
    process.env.MONITORING_INGEST_SECRET = 'short';
    expect(() => monitoringBearerOk('Bearer a-much-longer-token')).not.toThrow();
    expect(monitoringBearerOk('Bearer a-much-longer-token')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/monitoring-auth.test.ts`
Expected: FAIL — module `./monitoring-auth` does not exist yet.

- [ ] **Step 3: Implement `src/lib/monitoring-auth.ts`**

```ts
import { timingSafeEqual } from 'node:crypto';

// Constant-time bearer-token check for the inbound monitoring routes
// (ingest + campaigns), consumed by the external n8n workflow. Uses a
// dedicated MONITORING_INGEST_SECRET rather than SUPABASE_SERVICE_ROLE_KEY so
// the database god-key never leaves the app. Fails closed when the secret is
// unset — do NOT fall back to comparing against `Bearer undefined`.
export function monitoringBearerOk(header: string | null): boolean {
  const secret = process.env.MONITORING_INGEST_SECRET;
  if (!secret || !header) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Swap both routes onto the helper.**

In `src/app/api/monitoring/ingest/route.ts`, replace lines 6-10:

```ts
export async function POST(req: NextRequest) {
  if (!monitoringBearerOk(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
```

and add the import at the top: `import { monitoringBearerOk } from '@/lib/monitoring-auth';`

In `src/app/api/monitoring/campaigns/route.ts`, replace lines 7-11 the same way (it is a `GET`, keep the signature):

```ts
export async function GET(req: NextRequest) {
  if (!monitoringBearerOk(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
```

with the same import added. Neither route should reference `SUPABASE_SERVICE_ROLE_KEY` afterward.

- [ ] **Step 5: Add `MONITORING_INGEST_SECRET` to `.env.example`** and blank the two leaked provider voice IDs (they ship as concrete real IDs today — INT-6/INT-7 flagged the same file; blank them here since we are editing it). Add a new section after the auth block:

```
# ── Monitoring ingest — REQUIRED for the n8n opposition-monitoring workflow ──
# Dedicated bearer token for POST /api/monitoring/ingest and GET
# /api/monitoring/campaigns. Do NOT reuse SUPABASE_SERVICE_ROLE_KEY here.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
MONITORING_INGEST_SECRET=
```

and change the two ID lines from concrete values to blank:

```
HEYGEN_AVATAR_ID=
HEYGEN_VOICE_ID=
```
```
ELEVENLABS_VOICE_ID=
```

- [ ] **Step 6: Update the n8n note.** The workflow authenticates via an httpHeaderAuth credential named `"Campaign App Service Auth"` (n8n-opposition-monitoring.json:43, 116, 177, 261, 325, and the other ingest nodes). No JSON value change is needed (the credential is stored in n8n, not the file), but add a top-of-file operator note documenting the rotation. Insert a `"notes"`-style comment is not valid JSON, so instead record the instruction in the PR description and in `docs/audit/PRODUCTION-REMEDIATION.md` (create if absent, else append):

```
## Monitoring ingest secret (SEC-5)
The n8n "Campaign App Service Auth" HTTP Header Auth credential previously sent
  Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Update it to send
  Authorization: Bearer <MONITORING_INGEST_SECRET>
using the value now set in the app's MONITORING_INGEST_SECRET env var. Rotate the
Supabase service-role key afterward, since it was shared off-box.
```

- [ ] **Step 7: Run the tests and full suite**

Run: `npx vitest run src/lib/monitoring-auth.test.ts && npm test && npm run typecheck`
Expected: PASS.

---

### Task 2: Rate-limit and lock out repeated failed logins (SEC-10)

`loginAction` (src/app/actions.ts:29-59) has no throttle: an attacker can brute-force the known seed emails unbounded. There is no `middleware.ts` and none is warranted for one action — do this at the action with a database-backed counter (survives serverless cold starts, unlike in-memory state) plus a pure decision helper that is the TDD core.

**Files:**
- Create: `supabase/migrations/015_login_attempts.sql`
- Create: `src/lib/login-throttle.ts` (pure decision helpers + DB wrappers)
- Create: `src/lib/login-throttle.test.ts` (new — tests the pure helpers)
- Modify: `src/app/actions.ts:29-59` (loginAction)
- Modify: `src/app/login/page.tsx` (surface the `?error=locked` message — see step 6)

**Interfaces:**
- Produces (pure, tested):
  - `isLockedOut(row: AttemptRow | null, now: number): boolean`
  - `nextFailureState(row: AttemptRow | null, now: number): AttemptRow` — computes the row after one failed attempt (resets the window if expired, sets `lockedUntil` at the threshold).
  - Constants `MAX_ATTEMPTS = 5`, `WINDOW_MS = 15*60*1000`, `LOCKOUT_MS = 15*60*1000`.
- Produces (DB, thin, not unit-tested): `getAttempts(key)`, `recordFailure(key)`, `clearAttempts(key)` over `adminDb`.
- `AttemptRow = { attempts: number; windowStart: number; lockedUntil: number | null }`.

- [ ] **Step 1: Write the failing test** (`src/lib/login-throttle.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { isLockedOut, nextFailureState, MAX_ATTEMPTS, WINDOW_MS, LOCKOUT_MS } from './login-throttle';

const T = 1_000_000_000_000; // fixed "now"

describe('login throttle decision', () => {
  it('is not locked with no prior attempts', () => {
    expect(isLockedOut(null, T)).toBe(false);
  });

  it('counts failures within the window', () => {
    let row = nextFailureState(null, T);
    expect(row).toEqual({ attempts: 1, windowStart: T, lockedUntil: null });
    row = nextFailureState(row, T + 1000);
    expect(row.attempts).toBe(2);
    expect(row.lockedUntil).toBeNull();
  });

  it('locks out at the threshold', () => {
    let row: any = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) row = nextFailureState(row, T + i * 1000);
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.lockedUntil).toBe(T + (MAX_ATTEMPTS - 1) * 1000 + LOCKOUT_MS);
    expect(isLockedOut(row, T + (MAX_ATTEMPTS - 1) * 1000 + 5000)).toBe(true);
  });

  it('reports unlocked once the lockout expires', () => {
    const row = { attempts: MAX_ATTEMPTS, windowStart: T, lockedUntil: T + LOCKOUT_MS };
    expect(isLockedOut(row, T + LOCKOUT_MS + 1)).toBe(false);
  });

  it('resets the counter when a new attempt arrives after the window closes', () => {
    const stale = { attempts: 3, windowStart: T, lockedUntil: null };
    const row = nextFailureState(stale, T + WINDOW_MS + 1);
    expect(row).toEqual({ attempts: 1, windowStart: T + WINDOW_MS + 1, lockedUntil: null });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/login-throttle.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the pure helpers + DB wrappers** (`src/lib/login-throttle.ts`)

```ts
import { adminDb } from './supabase';

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface AttemptRow { attempts: number; windowStart: number; lockedUntil: number | null; }

export function isLockedOut(row: AttemptRow | null, now: number): boolean {
  return !!row && row.lockedUntil !== null && row.lockedUntil > now;
}

// State after ONE failed attempt. Reset the window if it has closed; set the
// lockout once we hit the threshold within a single window.
export function nextFailureState(row: AttemptRow | null, now: number): AttemptRow {
  if (!row || now - row.windowStart > WINDOW_MS) {
    return { attempts: 1, windowStart: now, lockedUntil: null };
  }
  const attempts = row.attempts + 1;
  const lockedUntil = attempts >= MAX_ATTEMPTS ? now + LOCKOUT_MS : row.lockedUntil;
  return { attempts, windowStart: row.windowStart, lockedUntil };
}

function toRow(r: Record<string, unknown> | null): AttemptRow | null {
  if (!r) return null;
  return {
    attempts: r.attempts as number,
    windowStart: new Date(r.window_start as string).getTime(),
    lockedUntil: r.locked_until ? new Date(r.locked_until as string).getTime() : null,
  };
}

export async function getAttempts(key: string): Promise<AttemptRow | null> {
  const { data } = await adminDb.from('login_attempts').select('*').eq('key', key).maybeSingle();
  return toRow(data as Record<string, unknown> | null);
}

export async function recordFailure(key: string, now: number): Promise<void> {
  const current = await getAttempts(key);
  const next = nextFailureState(current, now);
  await adminDb.from('login_attempts').upsert({
    key,
    attempts: next.attempts,
    window_start: new Date(next.windowStart).toISOString(),
    locked_until: next.lockedUntil ? new Date(next.lockedUntil).toISOString() : null,
  });
}

export async function clearAttempts(key: string): Promise<void> {
  await adminDb.from('login_attempts').delete().eq('key', key);
}
```

- [ ] **Step 4: Create the migration** (`supabase/migrations/015_login_attempts.sql`)

```sql
-- Per-IP and per-account login throttle (SEC-10). Keyed 'ip:<addr>' or
-- 'email:<addr>'. Rows are best-effort and safe to prune periodically.
create table if not exists login_attempts (
  key          text primary key,
  attempts     integer     not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

create index if not exists idx_login_attempts_locked_until on login_attempts(locked_until);
```

- [ ] **Step 5: Wire the throttle into `loginAction`** (src/app/actions.ts:29-59). Read the client IP from the forwarded header and gate on both an IP key and an email key. Add imports at top of the action:

```ts
export async function loginAction(formData: FormData) {
  const bcrypt = await import('bcryptjs');
  const { setSessionCookie } = await import('@/lib/session');
  const { headers } = await import('next/headers');
  const { isLockedOut, getAttempts, recordFailure, clearAttempts } = await import('@/lib/login-throttle');

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/login?error=1');

  const now = Date.now();
  const ip = (headers().get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipKey = `ip:${ip}`;
  const emailKey = `email:${email}`;

  // Fail closed on lockout before touching bcrypt.
  const [ipState, emailState] = await Promise.all([getAttempts(ipKey), getAttempts(emailKey)]);
  if (isLockedOut(ipState, now) || isLockedOut(emailState, now)) {
    redirect('/login?error=locked');
  }

  const { data: user } = await adminDb
    .from('users')
    .select('id, name, role, campaign_id, password_hash')
    .eq('email', email)
    .single();

  const hash = user?.password_hash ?? DUMMY_HASH; // still run bcrypt to prevent enumeration
  const valid = await bcrypt.default.compare(password, hash);

  if (!valid || !user) {
    await Promise.all([recordFailure(ipKey, now), recordFailure(emailKey, now)]);
    redirect('/login?error=1');
  }

  await Promise.all([clearAttempts(ipKey), clearAttempts(emailKey)]);
  setSessionCookie({
    userId: user.id, name: user.name, role: user.role, campaignId: user.campaign_id,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });
  redirect(user.role === 'super_admin' ? '/admin' : '/dashboard');
}
```

Note: `redirect()` throws internally, so the code after each `redirect(...)` does not run — the `recordFailure` call must be `await`ed *before* the `redirect` on the failure branch, as written above.

- [ ] **Step 6: Surface the lockout message.** In `src/app/login/page.tsx`, wherever the existing `?error=1` ("Invalid email or password") message is rendered from `searchParams`, add a branch for `error === 'locked'` → "Too many attempts. Try again in about 15 minutes." (Grep for `error` / `searchParams` in that file and add the copy alongside the existing invalid-credentials message; do not remove the generic case.)

- [ ] **Step 7: Run the tests and full suite**

Run: `npx vitest run src/lib/login-throttle.test.ts && npm test && npm run typecheck`
Expected: PASS. Optionally add a browser smoke check: 5 bad logins in a row should show the lockout copy.

---

### Task 3: Non-admin visiting `/admin` should land on `/dashboard`, not `/login` (FLOW-1)

`requireAdmin` (src/lib/session.ts:101-105) redirects to `/login` for any non-super-admin, including a fully logged-in owner/manager — which reads as an unexpected logout. Distinguish "no session" (→ `/login`) from "valid session, wrong role" (→ `/dashboard`).

**Files:**
- Modify: `src/lib/session.ts:101-105`
- Create: `src/lib/session.requireAdmin.test.ts` (new)

- [ ] **Step 1: Write the failing test** (`src/lib/session.requireAdmin.test.ts`). Build a genuinely-signed cookie with the same HMAC scheme the module uses, mock `next/headers` and the dynamically-imported supabase client, and assert the redirect target.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

process.env.SESSION_SECRET = 'test-secret';

function signCookie(payloadObj: object): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = createHmac('sha256', 'test-secret').update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => cookieStore }));

const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
vi.mock('next/navigation', () => ({ redirect }));

const maybeSingle = vi.fn();
vi.mock('@/lib/supabase', () => ({
  adminDb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}));

const future = Math.floor(Date.now() / 1000) + 10_000;

describe('requireAdmin redirect target', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sends a logged-in NON-admin to /dashboard (not /login)', async () => {
    cookieStore.get.mockReturnValue({ value: signCookie({ userId: 'u-1', name: 'O', role: 'owner', campaignId: 'c-1', exp: future }) });
    maybeSingle.mockResolvedValue({ data: { id: 'u-1', name: 'O', role: 'owner', campaign_id: 'c-1' } });
    const { requireAdmin } = await import('./session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('sends an anonymous visitor to /login', async () => {
    cookieStore.get.mockReturnValue(undefined);
    const { requireAdmin } = await import('./session');
    await expect(requireAdmin()).rejects.toThrow('REDIRECT:/login');
  });

  it('allows a super_admin through', async () => {
    cookieStore.get.mockReturnValue({ value: signCookie({ userId: 'u-a', name: 'A', role: 'super_admin', campaignId: 'c-1', exp: future }) });
    maybeSingle.mockResolvedValue({ data: { id: 'u-a', name: 'A', role: 'super_admin', campaign_id: 'c-1' } });
    const { requireAdmin } = await import('./session');
    const s = await requireAdmin();
    expect(s.role).toBe('super_admin');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/session.requireAdmin.test.ts`
Expected: FAIL — the non-admin case currently throws `REDIRECT:/login`.

- [ ] **Step 3: Fix `requireAdmin`** (src/lib/session.ts:101-105):

```ts
export async function requireAdmin(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  // A valid session that simply lacks admin rights is NOT a logout — send them
  // back to their own dashboard rather than the login screen.
  if (s.role !== 'super_admin') redirect('/dashboard');
  return s;
}
```

- [ ] **Step 4: Run the test and full suite**

Run: `npx vitest run src/lib/session.requireAdmin.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Browser confirm (quick).** Logged in as a non-admin (e.g. an owner), navigate to `/admin` — you should arrive on `/dashboard`, still logged in, not on the login screen.

---

### Task 4: Enable row-level security on every tenant table as a backstop (SEC-7)

There is no RLS on any table today, so the application layer is the *only* tenant boundary (this amplifies SEC-1/2/3/6 in the P0 plan). The app connects exclusively through the **service-role** client (`src/lib/supabase.ts:7`), which **bypasses RLS** — so enabling RLS does not change any application behavior. What it *does* close is the auto-generated PostgREST surface reachable with the project's anon/public key: with RLS enabled and no permissive `anon`/`authenticated` policy, that surface is default-deny. The campaign-scoped policies below additionally become the real enforcement boundary if/when the app migrates to Supabase-Auth-issued JWTs carrying a `campaign_id` claim.

**This is a migration-only task — no vitest surface.** Verification is by applying the migration to a scratch DB and checking the assertions in step 3.

**Files:**
- Create: `supabase/migrations/016_rls.sql`

Tables in scope (from migrations 001–014): tenant-scoped — `campaigns`, `users`, `content_items`, `approval_records`, `disclosure_records`, `audit_entries`, `monitoring_results`, `usage_events`, `candidate_profiles`, `avatars`, `billing_events`, `usage_sync_cursor`; global reference — `disclosure_rules`, `billing_plans`; throttle — `login_attempts` (from Task 2).

- [ ] **Step 1: Write `supabase/migrations/016_rls.sql`**

```sql
-- Defense-in-depth RLS (SEC-7).
--
-- The application uses the Supabase SERVICE ROLE key, which BYPASSES RLS —
-- so none of the policies below affect app behavior. Their purpose is to make
-- the auto-generated PostgREST API (reachable with the anon/public key)
-- default-deny, and to define the campaign-scoping that becomes enforcing if
-- the app ever authenticates end users via Supabase Auth JWTs carrying a
-- `campaign_id` claim. Until then these tables are simply closed to non-service
-- callers.
--
-- Helper: the campaign id asserted by the caller's JWT (NULL for anon / service
-- role). Kept in one place so the per-table policies read cleanly.
create or replace function auth_campaign_id() returns text
  language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'campaign_id', '')
  $$;

-- ── Enable RLS everywhere ────────────────────────────────────────────────────
alter table campaigns           enable row level security;
alter table users               enable row level security;
alter table content_items       enable row level security;
alter table approval_records    enable row level security;
alter table disclosure_records  enable row level security;
alter table audit_entries       enable row level security;
alter table monitoring_results  enable row level security;
alter table usage_events        enable row level security;
alter table candidate_profiles  enable row level security;
alter table avatars             enable row level security;
alter table billing_events      enable row level security;
alter table usage_sync_cursor   enable row level security;
alter table disclosure_rules    enable row level security;
alter table billing_plans       enable row level security;
alter table login_attempts      enable row level security;

-- ── Campaign-scoped read policies (columns named campaign_id) ────────────────
-- Each grants row visibility only when the JWT's campaign_id matches the row.
-- With no such claim (anon / service role) auth_campaign_id() is NULL and the
-- predicate is false, so the public API sees nothing; the service role still
-- bypasses RLS entirely.
create policy campaign_scope_select on campaigns
  for select using (id = auth_campaign_id());
create policy campaign_scope_select on users
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on content_items
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on approval_records
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on disclosure_records
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on audit_entries
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on monitoring_results
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on usage_events
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on candidate_profiles
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on avatars
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on billing_events
  for select using (campaign_id = auth_campaign_id());
create policy campaign_scope_select on usage_sync_cursor
  for select using (campaign_id = auth_campaign_id());

-- ── Global reference tables: readable by any authenticated caller ───────────
-- These carry no tenant data (disclosure rules, plan catalog). Keep them
-- readable so a future Supabase-Auth client can render them; still closed to
-- anon by omitting an anon policy.
create policy ref_read on disclosure_rules
  for select to authenticated using (true);
create policy ref_read on billing_plans
  for select to authenticated using (true);

-- ── login_attempts: no policy at all → fully closed to non-service callers ──
-- (Intentionally left with RLS on and zero policies; only the service role,
-- which bypasses RLS, may touch it.)
```

- [ ] **Step 2: Confirm the app is unaffected.** No application code changes: `adminDb` uses the service role and bypasses RLS. Run `npm test && npm run typecheck` — expected PASS (nothing in TS references these policies).

- [ ] **Step 3: Verify against a scratch database** (do NOT run against production). Apply 001–016 to a scratch Supabase/Postgres, then:

```sql
-- 3a. RLS is enabled on every listed table (relrowsecurity = t for all rows):
select relname, relrowsecurity
from pg_class
where relname in (
  'campaigns','users','content_items','approval_records','disclosure_records',
  'audit_entries','monitoring_results','usage_events','candidate_profiles',
  'avatars','billing_events','usage_sync_cursor','disclosure_rules',
  'billing_plans','login_attempts'
) order by relname;
```

Then confirm, via the PostgREST endpoint using the **anon** key, that a table read returns `[]` (or 401/permission), while the same read via the **service_role** key still returns rows. Record both outputs in the handoff. (There is no vitest coverage for platform RLS; this scratch-DB check is the acceptance evidence.)

---

### Task 5: Validate the candidate-profile form, client and server (UX-3)

The profile form accepts arbitrary free text (the audit observed `party: congress`), and that garbage flows straight into AI drafting prompts. Both write paths — the one-time setup action (`src/app/setup/actions.ts:9`) and the in-app settings save (`src/app/settings/page.tsx:11` `saveProfileAction`) — do only `.trim()`. Add a shared, pure validator (TDD), enforce it server-side on both paths, and add inline client feedback on the settings form.

**Files:**
- Create: `src/lib/profile-validation.ts` (pure validator)
- Create: `src/lib/profile-validation.test.ts` (new)
- Modify: `src/app/setup/actions.ts:36-45` (route through the validator)
- Modify: `src/app/settings/page.tsx` (`saveProfileAction` returns errors; extract the form into a client component)
- Create: `src/components/CandidateProfileForm.tsx` (client, `useActionState`, inline errors + HTML constraints)

**Interfaces:**
- Produces: `validateCandidateProfile(input: ProfileInput): { ok: true } | { ok: false; errors: Record<string, string> }` where `ProfileInput` is the trimmed string fields. Rules:
  - `fullName`, `preferredName`, `office`, `district` — required (non-empty), each ≤ 120 chars.
  - `party` — must be one of the allowed set `['', 'Democratic', 'Republican', 'Independent', 'Green', 'Libertarian', 'Other']` (empty allowed; case-insensitive match normalized to canonical). Rejects free text like `congress`.
  - `bio` ≤ 600 chars; `tagline` ≤ 160 chars; `targetAudience` ≤ 200 chars.
  - `googleAlertsRssUrl`, `photoUrl` — when non-empty, must parse as an `http(s)` URL.
  - `voiceTone` — must be one of `formal|conversational|urgent|inspirational`.

- [ ] **Step 1: Write the failing test** (`src/lib/profile-validation.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { validateCandidateProfile, PARTIES } from './profile-validation';

const base = {
  fullName: 'Alex Rivera', preferredName: 'Alex', office: 'State Assembly',
  district: 'District 12', party: 'Democratic', bio: 'Runs for office.',
  tagline: 'For our future', targetAudience: 'Voters', voiceTone: 'conversational',
  googleAlertsRssUrl: '', photoUrl: '',
};

describe('validateCandidateProfile', () => {
  it('accepts a well-formed profile', () => {
    expect(validateCandidateProfile(base)).toEqual({ ok: true });
  });

  it('requires the four core fields', () => {
    const r = validateCandidateProfile({ ...base, fullName: '', office: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errors.fullName).toBeTruthy(); expect(r.errors.office).toBeTruthy(); }
  });

  it('rejects a party value outside the allowed set (e.g. "congress")', () => {
    const r = validateCandidateProfile({ ...base, party: 'congress' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.party).toBeTruthy();
  });

  it('allows an empty party', () => {
    expect(validateCandidateProfile({ ...base, party: '' })).toEqual({ ok: true });
  });

  it('rejects a non-http google alerts url', () => {
    const r = validateCandidateProfile({ ...base, googleAlertsRssUrl: 'not a url' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.googleAlertsRssUrl).toBeTruthy();
  });

  it('rejects an invalid voice tone', () => {
    const r = validateCandidateProfile({ ...base, voiceTone: 'sarcastic' });
    expect(r.ok).toBe(false);
  });

  it('exposes the allowed party list for the UI', () => {
    expect(PARTIES).toContain('Democratic');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/profile-validation.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/profile-validation.ts`**

```ts
export const PARTIES = ['Democratic', 'Republican', 'Independent', 'Green', 'Libertarian', 'Other'] as const;
const TONES = ['formal', 'conversational', 'urgent', 'inspirational'];

export interface ProfileInput {
  fullName: string; preferredName: string; office: string; district: string;
  party: string; bio: string; tagline: string; targetAudience: string;
  voiceTone: string; googleAlertsRssUrl?: string; photoUrl?: string;
}

type Result = { ok: true } | { ok: false; errors: Record<string, string> };

function isHttpUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

export function validateCandidateProfile(input: ProfileInput): Result {
  const errors: Record<string, string> = {};
  const required: [keyof ProfileInput, string][] = [
    ['fullName', 'Full name is required.'],
    ['preferredName', 'Preferred name is required.'],
    ['office', 'The office you are running for is required.'],
    ['district', 'District is required.'],
  ];
  for (const [field, msg] of required) {
    if (!String(input[field] ?? '').trim()) errors[field] = msg;
  }
  const max: [keyof ProfileInput, number][] = [
    ['fullName', 120], ['preferredName', 120], ['office', 120], ['district', 120],
    ['bio', 600], ['tagline', 160], ['targetAudience', 200],
  ];
  for (const [field, limit] of max) {
    if (String(input[field] ?? '').length > limit) errors[field] = `Keep this under ${limit} characters.`;
  }
  if (input.party && !PARTIES.some(p => p.toLowerCase() === input.party.trim().toLowerCase())) {
    errors.party = 'Choose a party from the list.';
  }
  if (!TONES.includes(input.voiceTone)) errors.voiceTone = 'Pick a valid voice tone.';
  if (input.googleAlertsRssUrl && !isHttpUrl(input.googleAlertsRssUrl)) {
    errors.googleAlertsRssUrl = 'Enter a valid http(s) URL.';
  }
  if (input.photoUrl && !isHttpUrl(input.photoUrl)) errors.photoUrl = 'Enter a valid http(s) URL.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true };
}
```

- [ ] **Step 4: Enforce in the setup action** (`src/app/setup/actions.ts`). After collecting the trimmed fields (line 22-34) and before the existing required-field redirect (line 36-38), replace that redirect with:

```ts
  const check = validateCandidateProfile({
    fullName, preferredName, office, district, party, bio, tagline, targetAudience,
    voiceTone, googleAlertsRssUrl: '', photoUrl: photoUrl ?? '',
  });
  if (!check.ok) redirect('/setup?error=validation');
```

with `import { validateCandidateProfile } from '@/lib/profile-validation';` at the top.

- [ ] **Step 5: Make `saveProfileAction` return errors and extract a client form.** In `src/app/settings/page.tsx`, change `saveProfileAction` (lines 11-44) to validate before writing and return a `Result`-shaped value with `errors`, matching a `useActionState` signature:

```ts
async function saveProfileAction(_prev: unknown, formData: FormData) {
  'use server';
  const { requireSession } = await import('@/lib/session');
  const { can } = await import('@/lib/permissions');
  const { validateCandidateProfile } = await import('@/lib/profile-validation');
  const s = await requireSession();
  if (!can(s.role, 'edit_settings')) return { ok: false as const, errors: { _form: 'Permission denied.' } };

  const fields = {
    fullName: String(formData.get('full_name') ?? '').trim(),
    preferredName: String(formData.get('preferred_name') ?? '').trim(),
    office: String(formData.get('office') ?? '').trim(),
    district: String(formData.get('district') ?? '').trim(),
    party: String(formData.get('party') ?? '').trim(),
    bio: String(formData.get('bio') ?? '').trim(),
    tagline: String(formData.get('tagline') ?? '').trim(),
    targetAudience: String(formData.get('target_audience') ?? '').trim(),
    voiceTone: String(formData.get('voice_tone') ?? 'conversational'),
    googleAlertsRssUrl: String(formData.get('google_alerts_rss_url') ?? '').trim(),
    photoUrl: String(formData.get('photo_url') ?? '').trim(),
  };
  const check = validateCandidateProfile(fields);
  if (!check.ok) return { ok: false as const, errors: check.errors };

  // ...existing upsertCandidateProfile(...) call, unchanged, then:
  revalidatePath('/settings');
  return { ok: true as const, errors: {} as Record<string, string> };
}
```

Move the JSX `<form>` (settings/page.tsx:66-157) into a new client component `src/components/CandidateProfileForm.tsx` that:
  - `'use client'` + `useActionState(saveProfileAction, { ok: true, errors: {} })` (pass the action + profile defaults as props),
  - renders each field's `state.errors[field]` beneath it using the existing `.error` class (globals.css:670),
  - replaces the free-text **Party** `<input>` (settings/page.tsx:86) with a `<select>` populated from `PARTIES` plus a blank option (structurally prevents `congress`),
  - keeps HTML-native constraints for instant feedback: `required` on the four core fields (already present), `maxLength` per the validator limits, `type="url"` on the Google Alerts + photo URL inputs.

Render `<CandidateProfileForm profile={profile} canEdit={canEdit} />` in the page where the form was.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/lib/profile-validation.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Browser verification (1440px and 390px).** On `/settings`: (a) set Party to a value via the dropdown — no free text possible; (b) clear "Full name" and submit — an inline error appears under the field and nothing is saved; (c) enter a bad Google Alerts URL — inline error; (d) a valid save shows success and persists. Confirm the error text is legible and the layout holds at 390px (fields stack, no horizontal scroll).

---

### Task 6: Make dashboard and billing spend read consistently (UX-1)

The dashboard shows `$spend / $cap` with a percentage (cap = `monthlyCostCapCents`, the hard spend cap), while billing shows `$spend used of $included` (the plan allowance, `includedUsageCents`). Same spend, two different denominators, no labels — it looks contradictory. Unify the *framing*: show both the included allowance and the hard cap, labeled, on both screens, over the one shared `getMonthlySpend` window. (The deeper calendar-vs-billing-period-vs-UTC window bug is **BILL-11** and stays out of scope — this task only fixes labels/framing.)

This is a visual/heuristic task — acceptance is the browser check in the final step.

**Files:**
- Modify: `src/app/dashboard/page.tsx:118-139` (spend card)
- Modify: `src/app/billing/page.tsx:45-57` (subscription/usage copy)

- [ ] **Step 1: Dashboard — label the denominator and add the allowance.** In `src/app/dashboard/page.tsx`, the card at 118-139 currently renders `${spend} / ${cap}` + `spendPct%`. Keep the bar but make the caption explicit that the denominator is the **hard cap**, and add the plan **included allowance** when available. The dashboard already fetches `campaign` and `spend`; also fetch the plan (mirror billing) by adding `getBillingPlan` to the `Promise.all` (dashboard/page.tsx:19-25) guarded on `campaign?.planId`. Then:

```tsx
{/* eyebrow stays "Monthly spend" */}
<div style={{ fontSize: 13, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
  <span style={{ color: spendPct > 90 ? 'var(--bad)' : spendPct > 70 ? 'var(--warn)' : 'var(--text)', fontWeight: 600 }}>
    ${(spend / 100).toFixed(2)}
  </span>
  <span className="muted"> used this month</span>
</div>
<div className="muted" style={{ fontSize: 11, marginTop: 2, whiteSpace: 'nowrap' }}>
  {plan && <>${(plan.includedUsageCents / 100).toFixed(0)} included · </>}
  hard cap ${(cap / 100).toFixed(0)}
</div>
```

The percentage pill on the right stays as "% of cap" — but relabel it so the meaning is explicit: change the trailing `{spendPct.toFixed(0)}%` to `{spendPct.toFixed(0)}% of cap`.

- [ ] **Step 2: Billing — add the hard cap alongside the allowance.** In `src/app/billing/page.tsx`, the usage line at 50-53 shows only "used of included". `getMonthlySpend` is already fetched; also read the campaign cap (already on `campaign.monthlyCostCapCents` from `getCampaign`, which is fetched at line 10). Replace the single `<p className="muted">` with two lines using the same numbers/labels as the dashboard:

```tsx
<p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
  {(monthlySpendCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} used this month
  {' '}of {(plan.includedUsageCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} included
</p>
<p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
  Hard spend cap: {(campaign.monthlyCostCapCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · usage above the included allowance bills as overage.
</p>
```

(`campaign` is non-null inside the `plan ?` branch since a plan implies a campaign; if the linter disagrees, use `campaign?.monthlyCostCapCents ?? 0`.)

- [ ] **Step 3: Browser verification (1440px and 390px).** Open `/dashboard` and `/billing` for the same campaign. Confirm the "used this month" figure is identical on both, both screens name the **included allowance** and the **hard cap** with the same words, and the dashboard percentage says "of cap". Confirm no horizontal overflow at 390px (the spend card uses `whiteSpace: nowrap` in a flex row — check the two new lines wrap acceptably; if they clip at 390px, allow the second line to wrap by removing `nowrap` on that line only).

---

### Task 7: Give avatars a name, thumbnail, and date so they're distinguishable (UX-2)

Avatar list rows show only the name and a status line; when a name was left blank the create action defaults it to `'Avatar'` (src/app/actions.ts:603), so multiple avatars look identical. The `Avatar` type already carries `name`, `sourcePhotoUrls`, and `createdAt` (src/lib/avatars.ts:5-19) — no migration needed. Require a real name at creation, and render a thumbnail (first source photo) + created date in each row.

Visual task — acceptance is the browser check.

**Files:**
- Modify: `src/components/AvatarManager.tsx` (step-3 name requirement; list row layout)

- [ ] **Step 1: Require a non-empty name in the create modal.** In `src/components/AvatarManager.tsx`, the step-3 "Create Avatar" button (line 236) is only gated on `submitting`. Also gate on a non-empty name and add a hint:

```tsx
<h3 style={{ marginBottom: 12 }}>Step 3 of 3: Name this avatar</h3>
<input className="input" placeholder="e.g. Alex — studio look" value={name}
  onChange={e => setName(e.target.value)} maxLength={60} />
<p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
  Give it a name you'll recognize later — e.g. the look or setting.
</p>
<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
  <button className="btn" onClick={() => setStep(2)}>← Back</button>
  <button className="btn primary" disabled={submitting || !name.trim()} onClick={handleSubmit}>
    {submitting ? 'Creating…' : 'Create Avatar'}
  </button>
</div>
```

- [ ] **Step 2: Add a thumbnail + created date to each list row.** Replace the row body (AvatarManager.tsx:149-166 — the `<div key={a.id} ...>` down through the status `<div className="muted">`) so the left side shows a thumbnail next to the name/status, and the status line includes the created date:

```tsx
{avatars.map(a => (
  <div key={a.id} style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      {a.sourcePhotoUrls[0] ? (
        <img src={a.sourcePhotoUrls[0]} alt=""
          style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: 'var(--bg-hover)' }} />
      ) : (
        <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--bg-elevated)', display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0 }}>👤</div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
          {a.id === activeAvatarId && <span className="pill approved" style={{ fontSize: 10 }}>Active</span>}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {a.status === 'training' && 'Training… (usually a few minutes)'}
          {a.status === 'ready' && 'Ready'}
          {a.status === 'failed' && `Failed: ${a.errorMessage ?? 'Unknown error'}`}
          {' · '}created {new Date(a.createdAt).toLocaleDateString()}
        </div>
      </div>
    </div>
    {/* existing action buttons block (Set active / Generate look / Delete) unchanged */}
```

Keep the existing `{canManage && ( ... )}` action buttons block that follows.

- [ ] **Step 3: Browser verification (1440px and 390px).** On `/avatars` with 2+ avatars: each row shows a distinct thumbnail, its name, status, and created date; a long name truncates with an ellipsis rather than pushing the buttons off-row. Create a new avatar leaving the name blank — the Create button stays disabled until a name is typed. At 390px the row stays on one line (thumbnail + text left, buttons right) without horizontal scroll.

---

### Task 8: Stop monitoring excerpts from truncating mid-word (UX-4)

Ingested excerpts are stored truncated to 1000 chars (src/app/api/monitoring/ingest/route.ts:52) and rendered in full in the feed (`src/components/MonitoringTable.tsx:163-165`), so long ones cut off mid-word with no ellipsis. Clamp the excerpt to a few lines with a proper ellipsis and a Show more / Show less toggle (MonitoringTable is already a client component, so per-item expand state is cheap).

Visual task — acceptance is the browser check.

**Files:**
- Modify: `src/app/globals.css` (add a `.excerpt-clamp` utility)
- Modify: `src/components/MonitoringTable.tsx` (excerpt `<p>` + per-item expanded state)

- [ ] **Step 1: Add the clamp utility to `globals.css`** (near the other utilities, ~line 671):

```css
/* Clamp long monitoring excerpts to 3 lines with an ellipsis (UX-4). */
.excerpt-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

- [ ] **Step 2: Track expanded rows and toggle the clamp.** In `src/components/MonitoringTable.tsx`, add state near the other `useState` hooks (line 42-44):

```tsx
const [expanded, setExpanded] = useState<Set<string>>(new Set());
function toggleExpanded(id: string) {
  setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
}
```

Replace the excerpt paragraph (lines 163-165) with a clamped paragraph plus a toggle. Only show the toggle when the excerpt is long enough to plausibly clamp (cheap heuristic: length > 160):

```tsx
<p className={expanded.has(result.id) ? undefined : 'excerpt-clamp'}
   style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 8px', color: 'var(--text)' }}>
  {result.excerpt}
</p>
{result.excerpt.length > 160 && (
  <button type="button" onClick={() => toggleExpanded(result.id)}
    style={{ background: 'none', border: 'none', padding: 0, marginBottom: 14,
             color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
    {expanded.has(result.id) ? 'Show less' : 'Show more'}
  </button>
)}
```

(Note the original `<p>` had `margin: '0 0 14px'`; the bottom margin now lives on the toggle button so spacing is unchanged whether or not the toggle renders — keep `margin: '0 0 14px'` on the `<p>` for rows with no toggle by leaving the `8px` when the toggle is present and relying on the button's `marginBottom: 14`. If simpler, keep the `<p>` at `0 0 14px` and drop the button's `marginBottom`.)

- [ ] **Step 3: Browser verification (1440px and 390px).** On `/monitoring` with at least one long excerpt: the text clamps to 3 lines ending in an ellipsis (no mid-word hard cut visible), "Show more" expands it and flips to "Show less", and short excerpts show no toggle. Confirm the clamp and toggle render correctly at 390px with no overflow.

---

### Task 9: Improve monitoring relevance and vary credibility (UX-5)

Two defects in one feed: (a) `scoreCredibility` returns `'medium'` for everything not in the small curated allow/deny lists (src/lib/credibility.ts:32-39), so nearly every real item reads as a flat "Medium"; and (b) the feed surfaces off-topic items because the query isn't scoped to the campaign's entities/geo. Fix (a) with a richer, still-pure credibility function (TDD), add a pure relevance filter applied at ingest (TDD), and widen the campaigns endpoint + n8n query to include geo terms.

**Files:**
- Modify: `src/lib/credibility.ts` (richer scoring)
- Modify: `src/lib/credibility.test.ts` (extend — new expectations)
- Create/Modify: relevance helper in `src/lib/credibility.ts` (`isRelevant`) + tests
- Modify: `src/app/api/monitoring/ingest/route.ts` (apply relevance; accept optional relevance terms)
- Modify: `src/app/api/monitoring/campaigns/route.ts:13-40` (expose district/office/jurisdictions for geo)

- [ ] **Step 1: Write failing tests** — extend `src/lib/credibility.test.ts` with variation + relevance expectations:

```ts
import { describe, it, expect } from 'vitest';
import { scoreCredibility, isRelevant } from './credibility';

describe('scoreCredibility varies beyond high/medium/low buckets', () => {
  it('rates .gov and .edu as high', () => {
    expect(scoreCredibility('https://sos.ca.gov/x')).toBe('high');
    expect(scoreCredibility('https://berkeley.edu/x')).toBe('high');
  });
  it('rates a curated low-credibility domain as low', () => {
    expect(scoreCredibility('https://infowars.com/x')).toBe('low');
  });
  it('rates a social domain below a generic news blog', () => {
    // social defaults lower than an unknown editorial site
    expect(scoreCredibility('https://x.com/someone/status/1')).toBe('low');
    expect(scoreCredibility('https://some-local-paper.com/story')).toBe('medium');
  });
  it('rates a bare/malformed url as low, not medium', () => {
    expect(scoreCredibility('')).toBe('low');
    expect(scoreCredibility('not a url')).toBe('low');
  });
});

describe('isRelevant', () => {
  const terms = ['Rivera', 'District 12', 'transit'];
  it('keeps items mentioning a campaign entity', () => {
    expect(isRelevant('Rivera slams transit plan', terms)).toBe(true);
  });
  it('drops items mentioning none of the terms', () => {
    expect(isRelevant('Unrelated celebrity gossip', terms)).toBe(false);
  });
  it('is case-insensitive and keeps everything when no terms are configured', () => {
    expect(isRelevant('RIVERA', ['rivera'])).toBe(true);
    expect(isRelevant('anything', [])).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/lib/credibility.test.ts`
Expected: FAIL — current `scoreCredibility` returns `'medium'` for `''`/social/unknown, and `isRelevant` does not exist.

- [ ] **Step 3: Enrich `scoreCredibility` and add `isRelevant`** in `src/lib/credibility.ts`. Replace the body of `scoreCredibility` (lines 32-39) and append `isRelevant`:

```ts
export function scoreCredibility(url: string): 'high' | 'medium' | 'low' {
  const domain = getDomain(url);
  if (!domain) return 'low';                       // was 'medium' — a missing/broken URL is not trustworthy
  if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 'high';
  if (HIGH_CREDIBILITY_DOMAINS.has(domain)) return 'high';
  if (LOW_CREDIBILITY_DOMAINS.has(domain)) return 'low';
  if ([...SOCIAL_DOMAINS].some(d => domain.includes(d))) return 'low'; // unattributed social posts
  if (PRESS_RELEASE_KEYWORDS.some(k => domain.includes(k))) return 'medium';
  if (domain.endsWith('.org')) return 'medium';
  return 'medium';                                 // unknown editorial site — neutral, distinct from social/broken
}

// Keep an item only if it mentions at least one campaign entity/geo term.
// No terms configured → keep everything (don't silently blackhole a feed).
export function isRelevant(text: string, terms: string[]): boolean {
  const cleaned = terms.map(t => t.trim().toLowerCase()).filter(Boolean);
  if (cleaned.length === 0) return true;
  const hay = text.toLowerCase();
  return cleaned.some(t => hay.includes(t));
}
```

(The `.gov` branch already existed; `.edu`, social→low, `''`→low, `.org`→medium are the new variation. The buckets remain `high|medium|low` so no DB/CHECK-constraint change is needed — migration 006 already allows exactly these three.)

- [ ] **Step 4: Apply relevance at ingest.** In `src/app/api/monitoring/ingest/route.ts`, accept optional relevance terms in the body and drop clearly off-topic items before insert. After parsing the body (after line 33), compute relevance against the excerpt + source + opponent. Add `relevance_terms?: string[]` to the body type (line 12-18) and, after the dedupe check (line 45), before the insert:

```ts
import { scoreCredibility, categorizeSource, isRelevant } from '@/lib/credibility';
// ...
const terms = Array.isArray(body.relevance_terms) ? body.relevance_terms : [];
if (!isRelevant(`${excerpt} ${source} ${opponent ?? ''}`, terms)) {
  return NextResponse.json({ ok: true, skipped: true, reason: 'off_topic' });
}
```

- [ ] **Step 5: Expose geo terms from the campaigns endpoint** so n8n can both query and pass relevance terms. In `src/app/api/monitoring/campaigns/route.ts`, extend the `select` (line 15-17) to also pull the campaign's district/office and jurisdictions — join what's available: `candidate_profiles` has `office`/`district` (migration 004) and `campaigns` has `jurisdictions` (migration 001). Add `office`, `district` to the profile select and `campaigns(name, jurisdictions)` to the join, then include them in the mapped object (line 27-37):

```ts
    .select(
      'campaign_id, opponent_name, opponent_aliases, monitoring_keywords, office, district, opponent_twitter_handle, opponent_instagram_handle, opponent_facebook_page, google_alerts_rss_url, campaigns(name, jurisdictions)',
    )
```

```ts
    return {
      campaign_id: r.campaign_id,
      campaign_name: campaignName ?? r.campaign_id,
      opponent_name: r.opponent_name,
      opponent_aliases: r.opponent_aliases ?? [],
      monitoring_keywords: r.monitoring_keywords ?? [],
      // Geo terms for relevance scoping (UX-5):
      office: r.office ?? null,
      district: r.district ?? null,
      jurisdictions: (campaign && !Array.isArray(campaign) ? (campaign as { jurisdictions?: string[] }).jurisdictions : []) ?? [],
      opponent_twitter_handle: r.opponent_twitter_handle,
      opponent_instagram_handle: r.opponent_instagram_handle,
      opponent_facebook_page: r.opponent_facebook_page,
      google_alerts_rss_url: r.google_alerts_rss_url,
    };
```

Document in the PR/`PRODUCTION-REMEDIATION.md`: the n8n "Prepare Query" node should build its search query from `opponent_name + opponent_aliases + monitoring_keywords + district` and pass `relevance_terms = [opponent_name, ...opponent_aliases, ...monitoring_keywords, district]` in each ingest POST body so the ingest filter has terms to match. (n8n node logic lives in the workflow, edited in n8n; the JSON file's "Prepare Query" Code node at n8n-opposition-monitoring.json:~10-20 is the reference.)

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/lib/credibility.test.ts && npm test && npm run typecheck`
Expected: PASS. Fix any pre-existing credibility assertions that assumed `'medium'` for social/empty URLs (update them to the new, more accurate expectations — the old behavior was the bug).

- [ ] **Step 7: Browser verification (1440px and 390px).** On `/monitoring`, seed or ingest a mix of items: confirm the credibility badges now show a genuine spread (High/Medium/Low) rather than uniform Medium, and that an obviously off-topic ingested item (no campaign term) does not appear. The credibility filter chips (High/Medium/Low) should each return a non-empty subset. Confirm layout at 390px.

---

## Self-review checklist (run before handing off)

- [ ] **Every listed finding maps to exactly one task:** SEC-5→T1, SEC-10→T2, FLOW-1→T3, SEC-7→T4, UX-3→T5, UX-1→T6 (cross-refs BILL-11), UX-2→T7, UX-4→T8, UX-5→T9.
- [ ] **Code-testable items landed TDD (failing test first):** SEC-5 (T1 `monitoring-auth.test.ts`), SEC-10 (T2 `login-throttle.test.ts`), FLOW-1 (T3 `session.requireAdmin.test.ts`), UX-3 server validation (T5 `profile-validation.test.ts`), UX-5 pure helpers (T9 `credibility.test.ts`).
- [ ] **SEC-5:** neither monitoring route references `SUPABASE_SERVICE_ROLE_KEY` for auth; compare is constant-time and fails closed; `.env.example` has `MONITORING_INGEST_SECRET` and the leaked HeyGen/ElevenLabs IDs are blanked; n8n rotation documented. Grep check: `grep -rn "SERVICE_ROLE_KEY" src/app/api/monitoring` returns nothing.
- [ ] **SEC-7:** RLS enabled on all 15 tables; service-role bypass explicitly noted; verified on a scratch DB (anon read empty, service read works) — not on production.
- [ ] **SEC-10:** lockout checked before bcrypt; both IP and email keyed; success clears counters; migration `015_login_attempts.sql` present; login page shows the `error=locked` copy.
- [ ] **Pure-visual items (UX-1/2/4) verified in the browser at 1440px and 390px**, with the observed result recorded; no horizontal overflow at 390px on dashboard, billing, avatars, monitoring.
- [ ] **UX-1 did not fork the spend window** — both screens still read `getMonthlySpend`; BILL-11 explicitly left out of scope.
- [ ] **No path re-introduces a raw `status:'scheduled'` write** (unrelated to these tasks, but confirm none were added): `grep -n "status: 'scheduled'" src` unchanged from before.
- [ ] `npm test && npm run typecheck` green after every task.
- [ ] **No git commits made** — the user reviews and commits.
