// Fake Ayrshare for the E2E server (AYRSHARE_BASE_URL points here, see
// src/integrations/ayrshare-base.ts). Implements exactly the endpoints and
// response shapes the real adapters consume:
//   app host  POST /api/post, POST /api/analytics/post   (src/integrations/index.ts)
//   api host  POST /api/profiles, POST /api/profiles/generateJWT,
//             GET /api/user, DELETE /api/profiles/social (src/integrations/social-accounts.ts)
// Requests arrive as /<host>/api/<path>; the host prefix tells the two apart.
//
// Also: GET /link — stands in for Ayrshare's hosted linking page (the URL
// generateJWT returns). It links mode.linkPlatforms to the profile and
// redirects back, like the real page after a user signs in to a network.
//
// Control endpoints (no auth, not recorded): GET /__requests, POST /__mode,
// DELETE /__mode/<id>, POST /__reset.
// Modes are ADDITIVE rules keyed by owner id: POST /__mode {id, mode} upserts a
// rule ({} removes it); every active rule applies at once (a post fails if ANY
// rule fails it; linkPlatforms is the union). State is shared by all workers —
// give each test its own rule id, scope with `match`, filter requests by marker.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { BASE_URL, E2E_SECRETS, FAKE_AYRSHARE_URL } from '../env';

type Host = 'app' | 'api';
type Recorded = { host: Host; method: string; path: string; headers: Record<string, string>; body: unknown; at: string };
type Mode = {
  /** App platform ids ('x', 'facebook', …) whose /api/post calls fail with HTTP 400. */
  failPlatforms?: string[];
  /** Host-relative paths ('/api/user', …) that fail with HTTP 500. */
  failPaths?: string[];
  /** Networks (app ids) the fake linking page connects. Default: ['instagram']. */
  linkPlatforms?: string[];
  /** Only apply the failures to requests matching all of these. */
  match?: { profileKey?: string; textIncludes?: string };
};
type Display = Record<string, unknown> & { platform: string };

const BEARER = `Bearer ${E2E_SECRETS.ayrshareKey}`;
const { hostname, port: urlPort } = new URL(FAKE_AYRSHARE_URL);
const port = process.env.FAKE_AYRSHARE_PORT ?? urlPort;

// App platform id ↔ Ayrshare's (src/integrations/social-accounts.ts AYRSHARE_PLATFORM).
const TO_AYR: Record<string, string> = { instagram: 'instagram', facebook: 'facebook', x: 'twitter', linkedin: 'linkedin', tiktok: 'tiktok', youtube: 'youtube' };
const FROM_AYR: Record<string, string> = Object.fromEntries(Object.entries(TO_AYR).map(([k, v]) => [v, k]));

function displayFor(ayr: string, name: string): Display {
  const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  switch (ayr) {
    case 'facebook': return { platform: ayr, pageName: name, displayName: name, profileUrl: null, userImage: null };
    case 'youtube': return { platform: ayr, channelTitle: name, displayName: 'Google Account Holder', handle, profileUrl: null, userImage: null };
    default: return { platform: ayr, displayName: name, username: handle, profileUrl: null, userImage: null };
  }
}

// Mirrors e2e/seed.e2e.sql: campaign A (profile e2e-profile-a) has x + facebook linked.
function initialProfiles(): Map<string, { title: string; linked: Map<string, Display> }> {
  return new Map([
    ['e2e-profile-a', { title: 'E2E Campaign A · e2e-camp-a', linked: new Map([
      ['twitter', { ...displayFor('twitter', 'E2E Campaign A'), username: 'e2e_camp_a' }],
      ['facebook', displayFor('facebook', 'E2E Campaign A')],
    ]) }],
  ]);
}

let requests: Recorded[] = [];
const rules = new Map<string, Mode>();
let profiles = initialProfiles();
let seq = 0;

function reset() {
  requests = []; rules.clear(); profiles = initialProfiles(); seq = 0;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

function ruleApplies(mode: Mode, profileKey: string | undefined, body: Record<string, unknown>): boolean {
  const m = mode.match;
  if (!m) return true;
  if (m.profileKey !== undefined && m.profileKey !== profileKey) return false;
  if (m.textIncludes !== undefined && !(typeof body.post === 'string' && body.post.includes(m.textIncludes))) return false;
  return true;
}

// Deterministic, non-zero, in every field each extractor in
// src/integrations/index.ts (ANALYTICS_EXTRACTORS) reads.
const ANALYTICS: Record<string, Record<string, unknown>> = {
  instagram: { reachCount: 120, likeCount: 14, commentsCount: 3, sharesCount: 2, savedCount: 5, viewsCount: 340, igReelsAvgWatchTimeCount: 7500 },
  tiktok: { reach: 210, likeCount: 22, commentsCount: 4, shareCount: 6, favorites: 8, videoViews: 510, averageTimeWatched: 9 },
  youtube: { likes: 31, comments: 7, shares: 3, views: 820, averageViewDuration: 42 },
  // twitter/facebook/linkedin: shapes from Ayrshare's documented example responses.
  twitter: {
    publicMetrics: { impressionCount: 400, likeCount: 12, replyCount: 2, retweetCount: 3, quoteCount: 1, bookmarkCount: 2 },
    organicMetrics: { impressionCount: 380, video: { viewCount: 90 } },
  },
  facebook: { mediaView: 300, totalMediaViewUnique: 220, likeCount: 15, reactions: { like: 15, love: 3, total: 18 }, commentsCount: 2, sharesCount: 1 },
  linkedin: { impressionCount: 250, uniqueImpressionsCount: 180, likeCount: 9, commentCount: 1, shareCount: 1 },
};

async function handleApi(host: Host, path: string, req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) {
  const profileKey = req.headers['profile-key'] as string | undefined;
  const key = `${req.method} ${path}`;
  const profile = profileKey ? profiles.get(profileKey) : undefined;

  if (host === 'app' && key === 'POST /api/post') {
    const ayr = Array.isArray(body.platforms) ? String(body.platforms[0]) : '';
    const platform = FROM_AYR[ayr] ?? ayr;
    // Like Ayrshare: posting needs a known profile with that network linked.
    if (!profile) {
      return send(res, 400, { status: 'error', errors: [{ action: 'post', status: 'error', message: 'Profile key not found.' }] });
    }
    if (!profile.linked.has(ayr)) {
      return send(res, 400, { status: 'error', errors: [{ action: 'post', status: 'error', platform: ayr, message: `${ayr} is not linked for this profile.` }] });
    }
    if ([...rules.values()].some((r) => (r.failPlatforms ?? []).some((p) => p === platform || p === ayr) && ruleApplies(r, profileKey, body))) {
      return send(res, 400, { status: 'error', errors: [{ message: `Fake failure for ${platform}` }] });
    }
    const id = `fake-post-${++seq}`;
    return send(res, 200, { status: 'success', id, postIds: [{ platform: ayr, id: `${ayr}-${id}`, status: 'success' }] });
  }

  if (host === 'app' && key === 'POST /api/analytics/post') {
    // Every platform's block, so whichever the caller reads is present.
    const out: Record<string, unknown> = { status: 'success', id: body.id };
    for (const [ayr, analytics] of Object.entries(ANALYTICS)) out[ayr] = { id: body.id, analytics };
    return send(res, 200, out);
  }

  if (host === 'api' && key === 'POST /api/profiles') {
    const title = String(body.title ?? '');
    for (const p of profiles.values()) {
      if (p.title === title) return send(res, 400, { status: 'error', code: 146, message: 'Profile title already exists.' });
    }
    const n = ++seq;
    const newKey = `fake-profile-${n}`;
    profiles.set(newKey, { title, linked: new Map() });
    return send(res, 200, { status: 'success', title, refId: `fake-ref-${n}`, profileKey: newKey });
  }

  if (host === 'api' && key === 'POST /api/profiles/generateJWT') {
    const pk = String(body.profileKey ?? '');
    if (!profiles.has(pk)) return send(res, 404, { status: 'error', code: 168, message: 'Profile not found.' });
    const url = `${FAKE_AYRSHARE_URL}/link?profileKey=${encodeURIComponent(pk)}&redirect=${encodeURIComponent(String(body.redirect ?? ''))}`;
    return send(res, 200, { status: 'success', title: profiles.get(pk)!.title, token: `fake-jwt-${pk}`, url });
  }

  if (host === 'api' && key === 'GET /api/user') {
    if (!profile) return send(res, 404, { status: 'error', code: 168, message: 'Profile not found.' });
    const displayNames = [...profile.linked.values()];
    // Like Ayrshare: activeSocialAccounts is omitted entirely when nothing is linked.
    return send(res, 200, displayNames.length
      ? { activeSocialAccounts: displayNames.map((d) => d.platform), displayNames, title: profile.title }
      : { displayNames: [], title: profile.title });
  }

  if (host === 'api' && key === 'DELETE /api/profiles/social') {
    if (!profile) return send(res, 404, { status: 'error', code: 168, message: 'Profile not found.' });
    profile.linked.delete(String(body.platform ?? ''));
    return send(res, 200, { status: 'success' });
  }

  return send(res, 404, { status: 'error', message: `Fake Ayrshare: no route for ${host} ${key}` });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', FAKE_AYRSHARE_URL);
    const p = url.pathname;

    // ── Control endpoints ──
    if (p === '/__requests' && req.method === 'GET') return send(res, 200, requests);
    if (p === '/__mode' && req.method === 'POST') {
      const payload = (await readJson(req)) as { id?: unknown; mode?: Mode } | undefined;
      if (!payload || typeof payload.id !== 'string' || !payload.id) return send(res, 400, { error: 'POST /__mode needs {id, mode}' });
      const mode = payload.mode ?? {};
      if (Object.keys(mode).length === 0) rules.delete(payload.id); else rules.set(payload.id, mode);
      return send(res, 200, { id: payload.id, active: [...rules.keys()] });
    }
    if (p.startsWith('/__mode/') && req.method === 'DELETE') {
      rules.delete(decodeURIComponent(p.slice('/__mode/'.length)));
      return send(res, 200, { active: [...rules.keys()] });
    }
    if (p === '/__mode' && req.method === 'GET') return send(res, 200, Object.fromEntries(rules));
    if (p === '/__reset' && req.method === 'POST') { reset(); return send(res, 200, { ok: true }); }

    // ── Hosted linking page (opened by the browser, so no bearer) ──
    if (p === '/link' && req.method === 'GET') {
      const profile = profiles.get(url.searchParams.get('profileKey') ?? '');
      const redirect = url.searchParams.get('redirect') ?? '';
      if (!profile) return send(res, 404, { status: 'error', message: 'Profile not found.' });
      const linkRules = [...rules.values()].filter((r) => r.linkPlatforms && ruleApplies(r, profile === undefined ? undefined : url.searchParams.get('profileKey') ?? undefined, {}));
      const toLink = linkRules.length ? [...new Set(linkRules.flatMap((r) => r.linkPlatforms!))] : ['instagram'];
      for (const app of toLink) {
        const ayr = TO_AYR[app] ?? app;
        profile.linked.set(ayr, displayFor(ayr, `${profile.title.split(' · ')[0]} ${app}`));
      }
      // Only back to the app under test (never an open redirect).
      if (!redirect.startsWith(`${BASE_URL}/`)) return send(res, 200, { status: 'success' });
      res.writeHead(302, { location: redirect });
      return res.end();
    }

    // ── Ayrshare API ──
    const m = /^\/(app|api)(\/api\/.*)$/.exec(p);
    if (!m) return send(res, 404, { status: 'error', message: 'Not found' });
    const host = m[1] as Host;
    const path = m[2];
    if (req.headers.authorization !== BEARER) {
      return send(res, 401, { status: 'error', code: 102, message: 'API Key not valid.' });
    }
    const raw = await readJson(req);
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]));
    requests.push({ host, method: req.method ?? '', path, headers, body: raw, at: new Date().toISOString() });
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const pk = req.headers['profile-key'] as string | undefined;
    if ([...rules.values()].some((r) => (r.failPaths ?? []).includes(path) && ruleApplies(r, pk, body))) {
      return send(res, 500, { status: 'error', message: `Fake failure for ${path}` });
    }
    return await handleApi(host, path, req, res, body);
  } catch (e) {
    console.error('[fake-ayrshare]', e);
    if (!res.headersSent) send(res, 500, { status: 'error', message: 'Fake Ayrshare crashed' });
  }
});

server.listen(Number(port), hostname, () => console.log(`[fake-ayrshare] listening on ${hostname}:${port}`));
