import { FAKE_AYRSHARE_URL } from '../env';

// Test-side handle on the fake Ayrshare (e2e/fake-ayrshare/server.ts). Its
// state is shared by every worker. Modes are additive rules keyed by id: EVERY
// test must use its own unique id (e.g. its marker), scope with `match`, remove
// the rule in `finally`, and find its own requests by a unique marker.
export type FakeRequest = { host: 'app' | 'api'; method: string; path: string; headers: Record<string, string>; body: unknown; at: string };
export type FakeMode = {
  /** App platform ids ('x', 'facebook', …) whose POST /api/post fails with HTTP 400. */
  failPlatforms?: string[];
  /** Host-relative paths ('/api/post', '/api/user', …) that fail with HTTP 500. */
  failPaths?: string[];
  /** Networks (app ids) the fake linking page connects. Default ['instagram']. */
  linkPlatforms?: string[];
  /** Apply the failures only to requests with this Profile-Key / whose post text includes this. */
  match?: { profileKey?: string; textIncludes?: string };
};

async function call(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${FAKE_AYRSHARE_URL}${path}`, init);
  if (!res.ok) throw new Error(`fake ayrshare ${path}: HTTP ${res.status}`);
  return res;
}

/** Recorded API requests (host-relative path, e.g. '/api/post'), oldest first. */
export async function fakeRequests(filter?: { path?: string; profileKey?: string }): Promise<FakeRequest[]> {
  const all = (await (await call('/__requests')).json()) as FakeRequest[];
  return all.filter((r) =>
    (filter?.path === undefined || r.path === filter.path)
    && (filter?.profileKey === undefined || r.headers['profile-key'] === filter.profileKey));
}

/** Adds or replaces the rule `id` (an empty mode removes it). Other rules stay active. */
export async function addFakeRule(id: string, mode: FakeMode): Promise<void> {
  await call('/__mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, mode }) });
}

/** Removes only the rule `id`. */
export async function removeFakeRule(id: string): Promise<void> {
  await call(`/__mode/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Alias of addFakeRule; setFakeMode({}, id) removes that id's rule. Use a unique id per test. */
export async function setFakeMode(mode: FakeMode, id = 'default'): Promise<void> {
  await addFakeRule(id, mode);
}

/**
 * Back to the initial state: no mode, no recorded requests, seeded linked accounts.
 * MANUAL/DEBUG USE ONLY — never call it from a spec: the fake is shared by every
 * worker, so this wipes state other tests are using. Specs undo their own
 * changes (removeFakeRule(id), unlink what they linked).
 */
export async function resetFake(): Promise<void> {
  await call('/__reset', { method: 'POST' });
}
