# Social Channels — per-campaign social account connections

**Date:** 2026-10-08
**Status:** Approved in chat (option A, own sidebar item, block-until-connected, all 6 networks) — awaiting written-spec review
**Ayrshare plan:** Launch ($299/mo, 10 User Profiles)

## Problem

Every campaign currently publishes through the single Ayrshare Primary Profile:
`AyrsharePublisher` sends only `Authorization: Bearer <AYRSHARE_API_KEY>` and no
`Profile-Key` (`src/integrations/index.ts:523`). All tenants therefore post to
whichever social accounts are linked to that one Ayrshare account. Clients also
have no way to connect their own accounts from inside the app.

## Goal

Each campaign connects its **own** social accounts from a new **Channels** page,
without ever seeing or logging into Ayrshare, and every publish/analytics call is
scoped to that campaign's Ayrshare User Profile.

### Success criteria

1. An owner/manager opens `/channels`, clicks **Connect**, links Instagram (etc.)
   in a popup, and on return sees the account's avatar + handle within seconds.
2. A campaign can never publish to another campaign's accounts, nor to the
   Primary Profile. Publishing to a network the campaign hasn't connected is
   refused with a message linking to `/channels`.
3. The page reads as a polished, industry-standard integrations screen
   (comparable to Buffer / Hootsuite / Sprout "Channels"), fully translated EN/ES.

### Non-goals (YAGNI)

- Ayrshare's embedded widget (`link-sessions` + script) — newer, partially
  undocumented; revisit later for deeper white-labeling.
- Webhooks for link/unlink events — we re-read state on page load and after
  linking instead.
- Multiple accounts of the same network per campaign.
- Deleting Ayrshare profiles on campaign deletion — the app has no campaign
  deletion flow today. Revisit when one is added.
- Networks beyond the app's existing six `Platform`s.

## Decisions (from chat)

| Question | Decision |
|---|---|
| Linking surface | **A:** Ayrshare hosted linking page in a centered popup; same-tab redirect fallback if the popup is blocked |
| Placement | Own sidebar item **Channels** at `/channels`, between Analytics and Avatars |
| Before a campaign connects | **Block** publish/schedule (no fallback to the Primary Profile) |
| Networks | All 6: Instagram, Facebook, X, LinkedIn, TikTok, YouTube |

## Ayrshare API surface used

All calls use `Authorization: Bearer <AYRSHARE_API_KEY>` (Primary Profile key).

| Purpose | Call | Notes |
|---|---|---|
| Create profile | `POST https://api.ayrshare.com/api/profiles` `{ title, topHeader }` → `{ profileKey, refId }` | `title` must be unique (error code 146). Profile key is only ever returned here — store it. |
| Linking URL | `POST https://api.ayrshare.com/api/profiles/generateJWT` `{ profileKey, redirect, allowedSocial }` → `{ url }` | Deprecated-but-supported, no removal date. Valid 5 min; generated per click. |
| Read connections | `GET https://api.ayrshare.com/api/user` + `Profile-Key` header → `activeSocialAccounts?`, `displayNames[]` | `activeSocialAccounts` omitted when none linked. 60s server cache. |
| Disconnect | `DELETE https://api.ayrshare.com/api/profiles/social` `{ platform }` + `Profile-Key` | Returns 200 even if not linked → re-read state after. **Must** send Profile-Key or it unlinks the Primary Profile's account. |
| Publish / analytics | existing calls + `Profile-Key` header | |

Platform string mapping (existing `PLATFORM_MAP`): our `x` ↔ Ayrshare `twitter`;
all others identical.

Account display fields from `displayNames[]`:
- name: `youtube` → `channelTitle`; others → `displayName ?? pageName ?? username`
- handle: `username` (TikTok already includes `@`; prefix `@` otherwise where applicable)
- `profileUrl`, `userImage`
- `refreshRequired` (LinkedIn/TikTok) → "Reconnect needed" state

## Design

### 1. Data — migration `044_campaign_social_profiles.sql`

```sql
alter table campaigns
  add column if not exists ayrshare_profile_key text,
  add column if not exists ayrshare_ref_id      text,
  add column if not exists social_accounts      jsonb not null default '[]'::jsonb,
  add column if not exists social_synced_at     timestamptz;
```

- `ayrshare_profile_key` is a credential: read only server-side, never returned
  to the client, never included in `getCampaign()`'s public shape. Accessed via a
  dedicated `getCampaignSocialProfile(campaignId)` in a new `src/lib/channels.ts`.
- `social_accounts` is a snapshot array of
  `{ platform, name, handle, profileUrl, avatarUrl, refreshRequired }` used by the
  publish screen and gates without calling Ayrshare.
- `campaigns` already has RLS (026), so no new policy is needed.
- **Lazy profile creation:** a profile is created only on a campaign's first
  Connect click, so the 10-profile allowance is spent only on campaigns that use it.
  `title = "<campaign name> · <campaign id>"` (unique by construction, required
  by Ayrshare) and `topHeader = "<campaign name>"`, so the linking page shows the
  clean campaign name rather than the id.

### 2. Integration seam — `SocialAccountsProvider`

New interface in `src/integrations/index.ts`, wired in `src/lib/services.ts` the
same way as the other providers (real when `AYRSHARE_API_KEY` is set; Mock in
dev/tests; fail-loud stand-in in production per INT-3):

```ts
interface SocialAccountsProvider {
  createProfile(input: { title: string; displayName: string }): Promise<{ profileKey: string; refId: string }>;
  createLinkUrl(input: { profileKey: string; redirect: string; platforms: Platform[] }): Promise<{ url: string }>;
  getConnectedAccounts(profileKey: string): Promise<SocialAccount[]>;
  disconnect(profileKey: string, platform: Platform): Promise<void>;
}
```

- Every method checks `res.ok` **before** using the body and throws a typed
  `SocialAccountsError` carrying Ayrshare's `code`/`message`.
- `MockSocialAccountsProvider` keeps per-profile state in memory so the whole
  flow is clickable locally (`createLinkUrl` returns `/channels?mock_link=1`,
  which the page treats as "link Instagram + Facebook").
- `Publisher.publish` and `AnalyticsProvider.getPostAnalytics` gain a required
  `profileKey: string` argument; `AyrsharePublisher` / `AyrshareAnalyticsProvider`
  send it as the `Profile-Key` header.

### 3. Server actions — `src/app/channels/actions.ts`

All require a session with a campaign; mutating actions require
`can(role, 'edit_settings')` (owner/manager).

| Action | Behavior |
|---|---|
| `startChannelLinkAction()` | Ensure profile (create + persist if missing), then return `{ ok, url }` from `createLinkUrl` with `redirect = <SITE_URL>/channels?linked=1` and all 6 platforms. Audit `channels_link_started`. |
| `refreshChannelsAction()` | Read accounts from Ayrshare, write snapshot + `social_synced_at`, return the snapshot. Any session role may call (read-only). |
| `disconnectChannelAction(platform)` | Validate `platform` against the 6 known values, call `disconnect`, re-read, persist snapshot, audit `channels_disconnected`. |

Errors map to translated messages: profile creation refused (limit reached or
other) → "We couldn't set up social connections for this campaign. Please
contact support." plus an audit entry with Ayrshare's code; Ayrshare
unavailable → "Couldn't reach the social connection service. Try again."

### 4. Publish gating

A pure helper in `src/domain/channels.ts`:

```ts
unconnectedPlatforms(requested: Platform[], connected: SocialAccount[]): Platform[]
```

- `publishAction` and `scheduleWithTimeAction`: if the campaign has no profile or
  any requested platform is unconnected → `{ ok: false, error: "Connect Instagram,
  TikTok on the Channels page first." }`, before any other side effect.
- Cron publish: same check per item using the stored snapshot; on failure the
  item returns to `approved` with audit `cron_publish_not_connected` (never posts
  through the Primary Profile).
- Sync-analytics cron: passes each item's campaign profile key; items whose
  campaign has no profile are skipped.
- `ContentWizard` platform chips: connected networks selectable; unconnected
  ones render disabled with a "Connect" link to `/channels`. If none are
  connected, the publish step shows an empty state pointing to `/channels`.

### 5. The `/channels` page

Server component (`src/app/channels/page.tsx`) loads the stored snapshot and
renders a client component `ChannelsManager`. On mount it calls
`refreshChannelsAction()` once so data is fresh (snapshot shows instantly; no
spinner flash when unchanged).

**Layout (reusing existing `pagehead`, card, button, pill, toast styles):**

- **Header:** eyebrow "Publishing", title "Channels", subtitle "Connect the
  social accounts this campaign publishes to." Right side: progress
  "3 of 6 connected" with a thin bar, and the primary **Connect accounts** button.
- **Network grid** (3 columns desktop, 2 tablet, 1 mobile) — one card per network:
  - Brand mark (inline SVG, brand color on a soft tinted tile), network name,
    one-line description ("Posts, Reels and Stories").
  - **Connected:** status pill "Connected" (green), account avatar + name +
    handle, "View profile ↗" link, overflow "Disconnect" → inline confirm row
    ("Disconnect Instagram? Scheduled posts to it will fail. [Cancel] [Disconnect]").
  - **Reconnect needed** (`refreshRequired`): amber pill + "Reconnect" button.
  - **Not connected:** muted pill, "Connect" button (opens the same linking popup).
- **First-visit empty state** (nothing connected): 3-step strip — 1 Connect,
  2 Approve access on each network, 3 Publish from PolitIQ — above the grid.
- **Trust footer:** lock icon + "Accounts connect directly with each network
  through their official login. PolitIQ never sees your passwords. You can
  disconnect anytime."
- **Read-only** for staff/approvers: buttons hidden, a small "Only owners and
  managers can change connections" note.

**Linking interaction:**

1. Click Connect → button shows spinner → `startChannelLinkAction()`.
2. `window.open(url, 'politiq-connect', 'width=600,height=720,…centered')`.
   If it returns `null` (blocked) → `window.location.assign(url)`; Ayrshare's
   redirect brings the user back to `/channels?linked=1`.
3. While the popup is open: cards show a "Waiting for you to finish connecting…"
   banner with a "Cancel" link. Poll `popup.closed` every 500 ms.
4. On close (or on load with `?linked=1`): show skeleton shimmer on cards →
   `refreshChannelsAction()` → diff old vs new snapshot → toast per newly
   connected network ("Instagram connected"). Because Ayrshare caches `/user` for
   60 s, if nothing changed, retry refresh after 3 s once before concluding.
5. Errors → toast with the translated message; the button returns to idle.

**Accessibility:** cards are `<section aria-labelledby>`, status pills include
text (not color-only), buttons have explicit labels ("Connect Instagram"),
focus returns to the triggering button after the popup closes, all interactive
elements keyboard-reachable, respects `prefers-reduced-motion` for shimmer.

**i18n:** new `channels` namespace in `src/messages/en.json` and `es.json` (kept in
parity), plus nav key `common.nav.channels`.

### 6. Navigation

Add `{ href: '/channels', key: 'channels', icon: <link/plug SVG> }` to `NAV` in
`src/components/Sidebar.tsx` between Analytics and Avatars.

## Error handling summary

| Situation | User sees | System does |
|---|---|---|
| No `AYRSHARE_API_KEY` in production | "Social connections aren't configured." | Fail-loud provider (INT-3) |
| Profile creation refused (limit/other) | "Couldn't set up social connections… contact support." | Audit with Ayrshare code |
| Popup blocked | Seamless same-tab redirect | — |
| User closes popup without linking | Nothing changes, no toast | Single refresh |
| Ayrshare down on refresh | Stale snapshot stays visible + small "Couldn't refresh" note | — |
| Publish to unconnected network | "Connect X on the Channels page first." | No API call |
| Cron item to unconnected network | Item back in Approved | Audit `cron_publish_not_connected` |

## Testing

- **Provider** (`src/integrations/social-accounts.test.ts`, `fetch` stubbed):
  correct URLs/headers/bodies incl. `Profile-Key`; `twitter`↔`x` mapping;
  missing `activeSocialAccounts` → `[]`; display-name mapping per network
  (YouTube `channelTitle`); non-OK → `SocialAccountsError`.
- **Actions** (`src/app/channels/actions.test.ts`): permission denial for
  staff/approver; lazy profile creation happens once and persists key; existing
  key reused; disconnect validates platform; error mapping.
- **Domain** (`src/domain/channels.test.ts`): `unconnectedPlatforms`.
- **Gating:** extend `actions.publish.test.ts`, `actions.scheduleWithTime.test.ts`,
  cron `recovery`/`claim` tests for the not-connected path; publisher receives
  the profile key.
- **i18n parity:** `en.json` / `es.json` `channels` keys match.
- Manual: real Launch-plan link of one network end-to-end on a preview deploy.

## Rollout / ops

1. Apply migration 044.
2. In the Ayrshare dashboard: upload logo/brand colors for the linking page;
   add X developer keys (and the two Ayrshare callback URLs) to enable X linking.
3. Existing campaigns: their first Connect click creates their profile. Until
   then they can't publish (by decision) — tell current test users before deploying.
