'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { ExternalIcon, LockIcon } from '@/components/icons';
import { ChannelIcon } from '@/components/ChannelIcons';
import {
  startChannelLinkAction, refreshChannelsAction, disconnectChannelAction, completeMockLinkAction,
} from '@/app/channels/actions';
import { SOCIAL_PLATFORMS, newlyConnected, type SocialAccount } from '@/domain/channels';
import type { Platform } from '@/domain/types';

type Busy = { kind: 'linking' } | { kind: 'disconnecting'; platform: Platform } | null;

const POPUP_NAME = 'politiq-connect';
// Lets the linking popup reach this page even after a network's login (Google,
// Meta) sets Cross-Origin-Opener-Policy, which severs window.opener and makes
// popup.closed read true while the user is still signing in.
const CHANNEL_NAME = 'politiq-channels';
// Ayrshare caches GET /user for up to 60s, so a fresh link can take that long to appear.
const FINISH_POLL_MS = 5_000;
const FINISH_WINDOW_MS = 60_000;

function openCentered(url: string): Window | null {
  const w = 600, h = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
  return window.open(url, POPUP_NAME, `width=${w},height=${h},left=${left},top=${top}`);
}

function broadcastLinked() {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const bc = new BroadcastChannel(CHANNEL_NAME);
    bc.postMessage({ type: 'linked' });
    bc.close();
  } catch { /* best-effort: the opener also refreshes on focus */ }
}

const sameAccounts = (a: SocialAccount[], b: SocialAccount[]) => JSON.stringify(a) === JSON.stringify(b);

export function ChannelsManager({
  initialAccounts, canManage, returnedFromLink, mockLink, eyebrow,
}: {
  initialAccounts: SocialAccount[];
  canManage: boolean;
  returnedFromLink: boolean;
  mockLink: boolean;
  eyebrow: string;
}) {
  const t = useTranslations('channels');
  const { toast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [accounts, setAccounts] = useState<SocialAccount[]>(initialAccounts);
  const [busy, setBusy] = useState<Busy>(null);
  const [waiting, setWaiting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [popupDone, setPopupDone] = useState(false);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  // At most one link watch and one finish poll exist at a time, and none may
  // outlive the page: each is torn down through these refs.
  const watchCleanup = useRef<(() => void) | null>(null);
  const finishTimer = useRef<number | null>(null);
  const finishActive = useRef(false);
  const finishGen = useRef(0); // bumped to orphan an in-flight poll attempt

  const endLinkWatch = useCallback(() => {
    watchCleanup.current?.();
    watchCleanup.current = null;
  }, []);
  const cancelFinish = useCallback(() => {
    finishGen.current++;
    finishActive.current = false;
    if (finishTimer.current !== null) { window.clearTimeout(finishTimer.current); finishTimer.current = null; }
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; cancelFinish(); endLinkWatch(); };
  }, [cancelFinish, endLinkWatch]);

  const networkName = (p: Platform) => t(`networks.${p}.name`);

  // After linking, re-read every few seconds until the new account shows up —
  // Ayrshare's /user cache can hide it for up to a minute.
  const finishLink = useCallback(() => {
    if (finishActive.current) return;
    finishActive.current = true;
    const gen = ++finishGen.current;
    const before = accountsRef.current;
    const deadline = Date.now() + FINISH_WINDOW_MS;
    setFinishing(true);
    const done = () => {
      finishActive.current = false;
      finishTimer.current = null;
      setFinishing(false);
      lastTrigger.current?.focus();
    };
    const attempt = async () => {
      finishTimer.current = null;
      let r: Awaited<ReturnType<typeof refreshChannelsAction>> | null = null;
      try { r = await refreshChannelsAction(); } catch (e) { console.error('[channels] refresh failed', e); }
      if (!mountedRef.current || gen !== finishGen.current) return;
      if (!r || !r.ok) { done(); toast(t('refreshFailed'), 'error'); return; }
      setAccounts(r.accounts);
      const fresh = newlyConnected(before, r.accounts);
      if (fresh.length > 0) {
        endLinkWatch();
        done();
        for (const p of fresh) toast(t('connectedToast', { network: networkName(p) }));
        return;
      }
      if (Date.now() >= deadline) { done(); return; }
      finishTimer.current = window.setTimeout(attempt, FINISH_POLL_MS);
    };
    void attempt();
  }, [t, toast, endLinkWatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch for the user coming back from the linking popup by every route we
  // have: the popup closing, this window regaining focus/visibility (covers a
  // COOP-severed popup), or the popup's broadcast when it lands back on /channels.
  // Stays armed until a new account appears, so a finish poll that lapsed
  // while the user was still signing in gets another chance.
  const watchLink = useCallback((popup: Window) => {
    endLinkWatch();
    setWaiting(true);
    const signal = () => { setWaiting(false); finishLink(); };
    let interval: number | null = window.setInterval(() => {
      if (!popup.closed) return;
      if (interval !== null) { window.clearInterval(interval); interval = null; }
      signal();
    }, 500);
    // Clicking back here while the popup is genuinely still open isn't a return.
    const onFocus = () => { if (popup.closed) signal(); };
    const onVisible = () => { if (document.visibilityState === 'visible' && popup.closed) signal(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (e: MessageEvent) => { if (e.data?.type === 'linked') signal(); };
    }
    watchCleanup.current = () => {
      if (interval !== null) { window.clearInterval(interval); interval = null; }
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      bc?.close();
      if (mountedRef.current) setWaiting(false);
    };
  }, [endLinkWatch, finishLink]);

  // Quiet: cards keep showing the server snapshot and only change if Ayrshare disagrees.
  async function quietRefresh() {
    try {
      const r = await refreshChannelsAction();
      if (!mountedRef.current) return;
      if (!r.ok) { toast(t('refreshFailed'), 'error'); return; }
      if (!sameAccounts(accountsRef.current, r.accounts)) setAccounts(r.accounts);
    } catch (e) {
      console.error('[channels] refresh failed', e);
      if (mountedRef.current) toast(t('refreshFailed'), 'error');
    }
  }

  useEffect(() => {
    (async () => {
      // We are the linking popup: tell the opener, then get out of the way.
      // No refresh or URL cleanup here — the opener owns that.
      if ((returnedFromLink || mockLink) && window.name === POPUP_NAME) {
        if (mockLink) {
          try { await completeMockLinkAction(); } catch (e) { console.error('[channels] mock link failed', e); }
        }
        broadcastLinked();
        if (!mountedRef.current) return;
        // A COOP-severed popup has no opener and may not be script-closable,
        // so it always gets the "close this window" state as a fallback.
        setPopupDone(true);
        if (window.opener) window.close();
        return;
      }
      if (mockLink) {
        try {
          const r = await completeMockLinkAction();
          if (!mountedRef.current) return;
          if (r.ok) {
            for (const p of newlyConnected(accountsRef.current, r.accounts)) toast(t('connectedToast', { network: networkName(p) }));
            setAccounts(r.accounts);
          } else {
            toast(r.error, 'error');
          }
        } catch (e) {
          console.error('[channels] mock link failed', e);
          if (mountedRef.current) toast(t('actionFailed'), 'error');
        }
      } else if (returnedFromLink) {
        finishLink(); // same-tab return (popup was blocked)
      } else {
        await quietRefresh();
      }
      if (returnedFromLink || mockLink) router.replace('/channels');
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect(trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    cancelFinish();
    setFinishing(false);
    endLinkWatch();
    // Open synchronously on click — Safari/Firefox block window.open after an await.
    const popup = openCentered('about:blank');
    setBusy({ kind: 'linking' });
    let r: Awaited<ReturnType<typeof startChannelLinkAction>> | null = null;
    try { r = await startChannelLinkAction(); } catch (e) { console.error('[channels] start link failed', e); }
    if (!mountedRef.current) { popup?.close(); return; }
    if (!r || !r.ok) {
      popup?.close();
      setBusy(null);
      toast(r ? r.error : t('actionFailed'), 'error');
      return;
    }
    if (!popup) { window.location.assign(r.url); return; } // blocked → same tab; Ayrshare redirects back
    setBusy(null);
    if (popup.closed) return; // user dismissed the blank window while we waited
    try {
      popup.location.href = r.url;
    } catch (e) {
      console.error('[channels] could not open linking page', e);
      popup.close();
      toast(t('actionFailed'), 'error');
      return;
    }
    watchLink(popup);
  }

  async function disconnect(platform: Platform) {
    const name = networkName(platform);
    // ConfirmDialog returns focus to the Disconnect button that opened it.
    const ok = await confirm({
      title: t('disconnectNetwork', { network: name }),
      description: t('disconnectConfirm', { network: name }),
      confirmLabel: t('disconnect'),
      cancelLabel: t('cancel'),
      tone: 'danger',
    });
    if (!ok || !mountedRef.current) return;
    setBusy({ kind: 'disconnecting', platform });
    try {
      const r = await disconnectChannelAction(platform);
      if (!mountedRef.current) return;
      if (!r.ok) { toast(r.error, 'error'); return; }
      setAccounts(r.accounts);
      toast(t('disconnectedToast', { network: networkName(platform) }));
    } catch (e) {
      console.error('[channels] disconnect failed', e);
      if (mountedRef.current) toast(t('actionFailed'), 'error');
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  if (popupDone) {
    return <div className="channels-popup-done" role="status"><p>{t('closeWindow')}</p></div>;
  }

  const byPlatform = new Map(accounts.map(a => [a.platform, a]));
  const connectedCount = accounts.filter(a => !a.refreshRequired).length;
  const total = SOCIAL_PLATFORMS.length;
  const linking = busy?.kind === 'linking';

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <div className="channels-head-meta">
            <div className="channels-progress" aria-live="polite">
              <span className="num">{t('progress', { connected: connectedCount, total })}</span>
              <div className="channels-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={connectedCount}>
                <span style={{ width: `${(connectedCount / total) * 100}%` }} />
              </div>
            </div>
            {canManage && (
              <button type="button" className="btn btn-primary" disabled={!!busy || waiting} aria-busy={linking}
                onClick={e => connect(e.currentTarget)}>
                {linking ? t('connecting') : t('connectAccounts')}
              </button>
            )}
          </div>
        }
      />

      {waiting && (
        <div className="channels-banner" role="status">
          <span className="spinner" aria-hidden />
          <span>{t('waiting')}</span>
          <button type="button" className="btn btn-sm" onClick={() => { endLinkWatch(); finishLink(); }}>{t('waitingCancel')}</button>
        </div>
      )}

      {finishing && !waiting && (
        <div className="channels-banner" role="status">
          <span className="spinner" aria-hidden />
          <span>{t('finishing')}</span>
        </div>
      )}

      {accounts.length === 0 && (
        <section className="channels-steps" aria-label={t('stepsTitle')}>
          {[1, 2, 3].map(n => (
            <div key={n} className="channels-step">
              <span className="channels-step-num">{n}</span>
              <div><strong>{t(`step${n}Title`)}</strong><p>{t(`step${n}Body`)}</p></div>
            </div>
          ))}
        </section>
      )}

      <div className="channels-grid">
        {SOCIAL_PLATFORMS.map(p => {
          const a = byPlatform.get(p);
          const needsReconnect = !!a?.refreshRequired;
          const connected = !!a && !needsReconnect;
          const name = networkName(p);
          const cardBusy = finishing || (busy?.kind === 'disconnecting' && busy.platform === p);
          return (
            <section key={p} aria-labelledby={`ch-${p}`} aria-busy={cardBusy}
              className={`channel-card${connected ? ' is-connected' : ''}${cardBusy ? ' is-loading' : ''}`}>
              <div className="channel-card-top">
                <div className={`channel-tile ${p}`}><ChannelIcon platform={p} /></div>
                <div className="channel-title">
                  <h3 id={`ch-${p}`}>{name}</h3>
                  <p>{t(`networks.${p}.description`)}</p>
                </div>
                <span className={`channel-status${connected ? ' ok' : needsReconnect ? ' warn' : ''}`}>
                  {connected ? t('statusConnected') : needsReconnect ? t('statusReconnect') : t('statusNotConnected')}
                </span>
              </div>

              {a && (
                <div className="channel-account">
                  {a.avatarUrl
                    ? <img className="channel-avatar" src={a.avatarUrl} alt="" />
                    : <span className="channel-avatar" aria-hidden>{a.name.charAt(0).toUpperCase()}</span>}
                  <div className="channel-account-text">
                    <strong>{a.name}</strong>
                    {a.handle && <span>{a.handle}</span>}
                  </div>
                  {a.profileUrl && (
                    <a href={a.profileUrl} target="_blank" rel="noopener noreferrer">
                      {t('viewProfile')}<ExternalIcon size={12} />
                    </a>
                  )}
                </div>
              )}

              {canManage ? (
                <div className="channel-actions">
                  {connected && (
                    <button type="button" className="btn" disabled={!!busy || finishing}
                      aria-busy={busy?.kind === 'disconnecting' && busy.platform === p}
                      aria-label={t('disconnectNetwork', { network: name })} onClick={() => disconnect(p)}>
                      {t('disconnect')}
                    </button>
                  )}
                  {needsReconnect && (
                    <button type="button" className="btn btn-primary" disabled={!!busy || waiting}
                      aria-label={t('reconnectNetwork', { network: name })} onClick={e => connect(e.currentTarget)}>
                      {t('reconnect')}
                    </button>
                  )}
                  {!a && (
                    <button type="button" className="btn" disabled={!!busy || waiting}
                      aria-label={t('connectNetwork', { network: name })} onClick={e => connect(e.currentTarget)}>
                      {t('connect')}
                    </button>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="channels-trust">
        <LockIcon size={14} />
        <span>{t('trust')}{!canManage && <> <span className="channels-readonly">{t('readOnly')}</span></>}</span>
      </div>
    </>
  );
}
