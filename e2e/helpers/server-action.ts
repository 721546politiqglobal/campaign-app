import type { Page, Request } from '@playwright/test';

// Capture a Next.js server-action POST made by the UI, so it can be replayed
// with another session's cookies (permissions.spec: proves the SERVER enforces
// the permission, not just the UI hiding the button).
export type CapturedAction = { url: string; headers: Record<string, string>; body: string };

export async function captureAction(page: Page, trigger: () => Promise<void>): Promise<CapturedAction> {
  const reqP = page.waitForRequest((r: Request) => r.method() === 'POST' && !!r.headers()['next-action']);
  await trigger();
  const r = await reqP;
  const h = r.headers();
  return { url: r.url(), body: r.postData() ?? '',
    headers: { 'next-action': h['next-action'], 'content-type': h['content-type'], accept: 'text/x-component' } };
}

export async function replayAction(page: Page, a: CapturedAction) {
  return page.request.post(a.url, { headers: a.headers, data: a.body });
}

/** Same action, aimed at another record: every occurrence of `from` in the URL and body becomes `to`. */
export function retarget(a: CapturedAction, from: string, to: string): CapturedAction {
  if (!a.body.includes(from)) throw new Error(`captured action body does not contain "${from}": ${a.body.slice(0, 200)}`);
  return { ...a, url: a.url.split(from).join(to), body: a.body.split(from).join(to) };
}

/**
 * The action's return value from a replay response. The body is an RSC stream
 * (`text/x-component`): row 0 is `["$@<n>", …]` pointing at row <n>, which
 * holds the JSON result. The rest of the stream re-renders the page and
 * includes every translated string (permission errors too), so never assert
 * on the raw text.
 */
export async function actionResult(res: { text(): Promise<string> }): Promise<unknown> {
  const rows = new Map<string, string>();
  for (const line of (await res.text()).split('\n')) {
    const i = line.indexOf(':');
    if (i > 0 && !rows.has(line.slice(0, i))) rows.set(line.slice(0, i), line.slice(i + 1));
  }
  const head = JSON.parse(rows.get('0') ?? 'null');
  const ref = Array.isArray(head) ? head[0] : head?.a;
  if (typeof ref !== 'string' || !ref.startsWith('$@')) throw new Error(`no action result in response row 0: ${rows.get('0')?.slice(0, 200)}`);
  const row = rows.get(parseInt(ref.slice(2), 16).toString(16));
  if (row === undefined) throw new Error(`action result row ${ref} missing`);
  return JSON.parse(row);
}

/**
 * Where a replayed action redirected to (`redirect()` inside a server action),
 * or null. Next 14.2 answers a fetch-driven action redirect with 303 and an
 * `x-action-redirect` header (`<path>;<push|replace>`) but no Location, so
 * Playwright does not follow it.
 */
export function actionRedirect(res: { headers(): Record<string, string> }): string | null {
  const h = res.headers()['x-action-redirect'];
  return h ? h.split(';')[0] : null;
}
