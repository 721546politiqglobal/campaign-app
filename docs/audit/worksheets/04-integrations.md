# Candidate findings — integrations — unverified

### INT-1 — Cron config in vercel.ts (Vercel never reads it) → scheduled publishing never runs
- **Severity:** P0 · **Location:** vercel.ts:1
- Cron def lives in `vercel.ts`; Vercel only registers crons from `vercel.json`, which doesn't exist. billing-sync not listed at all.
- Fail: user schedules post → status='scheduled' → no cron fires → never publishes; billing-sync never runs.
- Fix: move crons into real `vercel.json` (incl billing-sync), delete vercel.ts. Effort: S

### INT-2 — Publish failures silently discarded; content marked "published" even when every platform failed
- **Severity:** P0 · **Location:** src/app/actions.ts:237-244; src/app/api/cron/publish/route.ts:30-38
- `AyrsharePublisher.publish` returns per-platform `{status:'failed'}` (index.ts:308-315), never throws; both callers ignore the return. `publishAction` calls `markPublished` BEFORE publishing (actions.ts:238).
- Fail: Ayrshare 400 (unlinked account) for all platforms → status='published', audit written, wizard says "live on all platforms" while nothing posted. Dropped forever, no retry.
- Fix: inspect results; only mark published on success; persist per-platform failures; publish first then transition. Effort: M

### INT-3 — Mock providers silently activate in production when an env key is missing
- **Severity:** P1 · **Location:** src/lib/services.ts:24-46
- Every provider falls back to mock on env-key absence, no prod guard/log/UI signal. MockPublisher returns 'scheduled' for every platform.
- Fail: AYRSHARE_API_KEY forgotten in prod → every publish "succeeds", marked published, nothing reaches any platform, nobody told.
- Fix: in production throw/return errors when key missing instead of mocks; surface "demo mode". Effort: S

### INT-4 — HeyGen getVideoStatus swallows every error as "processing"; client polls with no timeout
- **Severity:** P1 · **Location:** src/integrations/index.ts:153-162; src/components/ContentWizard.tsx:119-133
- getVideoStatus never checks res.ok; 401/404/429 → status undefined → falls through to `{status:'processing'}`. Client setInterval poll has no max-attempt/deadline.
- Fail: HeyGen key rotated mid-generation → every status 401 → "processing" forever → user watches spinner, polls every 5s indefinitely.
- Fix: check res.ok and throw/return failed on non-200; add max poll duration in wizard. Effort: S

### INT-5 — Video job ID lives only in client React state; a $50 generation orphaned on tab close
- **Severity:** P1 · **Location:** src/components/ContentWizard.tsx:87-88; src/app/actions.ts:298-311
- generateVideoAction charges VIDEO_COST_CENTS=5000, records videoId only in audit blob; wizard keeps videoId in useState.
- Fail: user clicks Generate ($50), HeyGen takes 5 min, user refreshes → videoId state gone → completed video unreachable → regenerates, pays another $50.
- Fix: persist pending videoId+status on content item; hydrate wizard and resume polling on load. Effort: M

### INT-6 — Voice synthesis ignores campaign's configured voice, falls back to hardcoded stock voice
- **Severity:** P1 · **Location:** src/app/actions.ts:331; src/integrations/index.ts:253
- synthesizeVoiceAction calls synthesize({text}) without loading profile.elevenLabsVoiceId → provider falls back to global ELEVENLABS_VOICE_ID env or hardcoded 'EXAVITQu4vr4xnSDxMaL'. .env.example ships concrete real IDs.
- Fail: campaign configures cloned voice → synthesize returns stock/global voice (potentially another tenant's) and charges $20.
- Fix: pass campaign's elevenLabsVoiceId; hard-fail when none configured; blank IDs in .env.example. Effort: S

### INT-7 — ElevenLabs voice ID sent to HeyGen as voice_id; fallback gives every tenant the same global voice
- **Severity:** P1 · **Location:** src/app/actions.ts:301; src/integrations/index.ts:141
- generateVideoAction passes profile?.elevenLabsVoiceId as HeyGen voice.voice_id — different provider namespaces; profile has no HeyGen voice field (types.ts:115-118). Unset → global HEYGEN_VOICE_ID.
- Fail: profile has ElevenLabs voice → HeyGen 400 "voice not found" → video always fails. No voice → every campaign narrated by whoever HEYGEN_VOICE_ID is.
- Fix: add per-campaign heygenVoiceId (or explicit mapping); refuse global env fallback. Effort: M

### INT-8 — ElevenLabs synthesize ignores Supabase upload result, returns URL to possibly nonexistent file
- **Severity:** P1 · **Location:** src/integrations/index.ts:272-274
- storage upload returns `{error}` never checked; getPublicUrl fabricates URL regardless.
- Fail: upload fails → synthesize resolves with dead audioUrl → action records $20 charge, hands user broken link.
- Fix: check upload error and throw before charging. Effort: S

### INT-9 — "Bearer undefined" bypass when auth env unset; service-role key doubles as n8n's HTTP token
- **Severity:** P1 · **Location:** cron/publish/route.ts:10; monitoring/ingest/route.ts:8; monitoring/campaigns/route.ts:9
- All three compare against `` `Bearer ${env.X}` ``; unset → literal "Bearer undefined". Monitoring routes use SUPABASE_SERVICE_ROLE_KEY as shared bearer.
- Fail: deploy without CRON_SECRET → `curl -H 'Authorization: Bearer undefined'` triggers publishing; same on ingest injects fake monitoring results into any campaign.
- Fix: return 401 when secret env absent; mint dedicated MONITORING_INGEST_SECRET. Effort: S
- (Overlaps SEC-4/SEC-5 — merge.)

### INT-10 — Unauthenticated proxy endpoints and server action expose provider data
- **Severity:** P2 · **Location:** heygen/avatars/route.ts:10; elevenlabs/voices/route.ts:3; actions.ts:318-320
- Both GET routes no session check, call providers with server keys; getVideoStatusAction only action with no requireSession().
- Fail: anon users enumerate ElevenLabs voice list, probe HeyGen avatar groups, poll any videoId to get another tenant's finished video_url, burn rate limits.
- Fix: add session checks + campaign scoping. Effort: S
- (Overlaps SEC-8 for getVideoStatusAction.)

### INT-11 — Cron publish can double-post: no claim state, non-atomic publish-then-update, overlapping runs
- **Severity:** P2 · **Location:** cron/publish/route.ts:14-45
- Selects all status='scheduled', calls Ayrshare, then updates row. No claim/lock, no idempotency, every-5-min schedule; slow run overlaps next; crash between publish and update re-publishes.
- Fail: 40 items × multi-platform sequential > 5 min → next cron re-selects → same post twice everywhere.
- Fix: atomically claim rows (set status='publishing' ... returning), then publish, then finalize; cap batch. Effort: M

### INT-12 — n8n workflow only processes $input.first() and hardcodes localhost:3001
- **Severity:** P2 · **Location:** n8n-opposition-monitoring.json:48, :18
- /api/monitoring/campaigns returns top-level array → n8n emits one item per campaign, but Prepare Query reads only $input.first().json. app_base_url hardcoded http://localhost:3001; all fetch nodes neverError/continueOnFail → silent failure every 2h.
- Fail: two campaigns configure monitoring → Prepare Query yields 0/1 → ingest receives nothing → dashboard never fills, no error.
- Fix: iterate $input.all(); make app_base_url configurable; add error branch. Effort: M

### INT-13 — Providers parse res.json() before checking status, accept empty IDs from HeyGen
- **Severity:** P2 · **Location:** src/integrations/index.ts:148-150 (also 183-185, 199-204, 307, 330-331)
- Every provider calls res.json() unconditionally; 502 HTML → raw SyntaxError. generateAvatarVideo returns `json.data?.video_id ?? ''`; createAvatarLook/uploadAsset coerce missing IDs to ''.
- Fail: HeyGen 200 unexpected body → videoId='' → $50 recorded, then getVideoStatus('') polls garbage "processing" forever (compounds INT-4). Non-JSON 502 → user sees "Unexpected token '<'".
- Fix: res.text()+try-JSON so non-JSON raises HTTP status; throw when required fields missing before recording usage. Effort: M

### INT-14 — Avatar training status unvalidated cast; unknown statuses strand avatars in "training"; creation failures still return ok
- **Severity:** P2 · **Location:** src/integrations/index.ts:240; src/app/actions.ts:666-676
- getAvatarGroupStatus casts json.data?.status to 4-value union; checkAvatarStatusAction only acts on failed/completed → undefined/unknown leaves avatar in training, no retry limit, pending_consent unhandled. createAvatarAction catches failure, marks row failed, but still returns `{ok:true}`.
- Fail: HeyGen adds a status value → status check never resolves → permanently "training" avatar already paid for.
- Fix: validate status against known set, treat unknown as failed after N checks, surface pending_consent, return ok:false on creation failure. Effort: S

## CLEAN
- prompt.ts pure module; credibility.ts pure with try/catch; avatars.ts CRUD with caller ownership; Claude generator error handling (index.ts:94-99) detects refusals + records usage in finally; /api/elevenlabs/voices degrades to empty list on non-200 (but see INT-10).

## Note
- NewsDataMonitoringSource/monitoringSource (services.ts:44-46) has NO call sites in src/ — monitoring runs exclusively via n8n. Dead adapter; fixes there moot until wired or removed.
