# Content Generation Internationalization (i18n) — Design

## Context

Phase 1 (`docs/superpowers/specs/2026-09-08-ui-i18n-design.md`) translated
the app's UI chrome only — nav, labels, forms, settings. It explicitly
deferred "content-generation language support (Content Wizard, HeyGen,
ElevenLabs, monitoring)" as a separate spec. This is that spec.

Today, every AI-generated artifact in this app — Content Wizard drafts,
HeyGen avatar video scripts, ElevenLabs voice synthesis, and monitoring
rebuttals — is English-only by construction, independent of Phase 1's
`users.locale`. There is no locale/language column anywhere in the
content pipeline (`content_items`, `campaigns`, `candidate_profiles` all
lack one), and every prompt template in `src/lib/prompt.ts` is hardcoded
English with no `locale` parameter threaded through the call chain.

Ground-truth findings that shape this design:

- **Single choke point**: both content-generation call sites
  (`generateDraftAction`, `generateFromMonitoringAction` in
  `src/app/actions.ts`) call the same `ClaudeContentGenerator.draft()`
  (`src/integrations/index.ts:80-125`), via the shared `contentGenerator`
  singleton (`src/lib/services.ts:36-39`). One prompt file
  (`src/lib/prompt.ts`) and one provider class cover both paths.
- **HeyGen** (`src/integrations/index.ts:129-191`) reuses the Content
  Wizard's generated `content_items.body` verbatim as the video script —
  no separate script-generation step, and no `language` field exists in
  its `/v2/video/generate` call; language is implicit in whatever
  `voice_id` is configured.
- **ElevenLabs** (`src/integrations/index.ts:415-448`) already uses the
  `eleven_multilingual_v2` model, which auto-detects language from the
  input text and speaks it — no separate language parameter exists or is
  needed. If the text is Spanish, the existing configured voice already
  speaks Spanish.
- **Monitoring** (`src/app/monitoring`, `src/lib/credibility.ts`) has no
  LLM step at all — pure domain/keyword matching, already
  language-agnostic. The actual gap is external: the n8n ingestion
  workflows (`n8n-opposition-monitoring.json`,
  `n8n-opposition-monitoring-basic.json`) hardcode
  `language=en`/`country=us` (NewsData) and `sourcelang=eng` (GDELT),
  filtering out Spanish-language opponent coverage before it ever reaches
  the app.
- The output-parsing logic in `ClaudeContentGenerator.draft`
  (`src/integrations/index.ts:118-122`) assumes the literal English
  string `"Title:"` as a line prefix — this must keep working even when
  the body itself is in Spanish.

## Goals

- Content Wizard generation supports an explicit per-item output
  language (English or Spanish), defaulting to a per-campaign preference.
- Generated content is stored with a record of which language it was
  actually generated in.
- HeyGen video and ElevenLabs voice require **no code changes** — they
  already speak whatever language the underlying script/text is in.
- Opponent-monitoring rebuttal drafts (`generateFromMonitoringAction`)
  automatically match the language of the opponent post being rebutted.
- Opponent-monitoring ingestion (n8n) stops filtering out Spanish-language
  opponent coverage at the source.
- Adding a third language later should touch the same small set of
  places Phase 1 established (`SUPPORTED_LOCALES`), not require new
  architecture.

## Non-goals

- Locale-specific avatar/voice configuration (a distinct Spanish HeyGen
  avatar or ElevenLabs voice ID per campaign). One avatar/voice is
  expected to handle both languages for v1; can be revisited if output
  quality demands it.
- Fully independent, separately-authored Spanish prompt templates
  (rhetorical/formality guidance beyond a directive). The chosen approach
  is a single shared English template with an appended Spanish directive
  (see Architecture); a from-scratch Spanish template set is a possible
  future refinement, not built here.
- A language-detection library or service. Language matching for
  rebuttals is done by asking Claude itself, not a separate classifier
  (see Components).
- Retroactively translating existing `content_items` rows.
- Any change to Phase 1's `users.locale` (UI locale) — this is a
  genuinely separate concept from content output language (a Spanish-UI
  user can generate English content and vice versa).

## Architecture

**Approach: instruction-based localization.** `ContentGenerator.draft()`
and `buildCandidatePrompt()` gain a `locale: Locale` parameter
(`Locale` reused from `src/lib/locale.ts`). When `locale === 'es'`, the
existing English prompt templates (both `buildCandidatePrompt` and the
no-candidate-profile fallback string) get one appended directive: write
the entire response in fluent, natural Spanish, while keeping the
`"Title:"` marker itself in English exactly as shown.

This was chosen over two alternatives:

- **Generate-then-translate** (always generate English, then run a
  second translation pass) — rejected: doubles LLM cost/latency per
  Spanish item, and translated copy reliably reads stiffer than natively
  generated copy, a real quality problem for persuasive political
  messaging.
- **Fully separate per-locale prompt files** — rejected for v1: more
  upfront authoring work and a second template to keep in sync with
  every future English prompt change, for a benefit (distinct
  language-specific rhetorical guidance) not yet known to be needed.
  Claude generates fluent, idiomatic Spanish from a directive alone;
  revisit only if real output quality falls short.

**Two distinct locale concepts, not one:**

1. `candidate_profiles.content_locale` — the campaign's *default*
   content-generation language, set once in Settings. Analogous in
   spirit to Phase 1's `users.locale` but a completely separate field:
   this is a per-campaign content-strategy setting, not a per-user UI
   preference.
2. `content_items.locale` — the language a *specific* item was actually
   generated in. Generation is per-item (a bilingual campaign can
   generate the same brief in both languages), so this can't just be
   read off the campaign default at render time — it must be recorded
   per row at generation time.

**Rebuttal-drafting is a special case.** `generateFromMonitoringAction`
has no upfront language selector — a rebuttal should match whatever
language the opponent's post was written in, not the campaign default.
Rather than adding a separate language-detection step, the prompt sent to
Claude includes the opponent's excerpt and an instruction to detect its
language and reply in kind, prefixing its response with a machine-parsed
`Language: en` / `Language: es` marker line — read the same deterministic
way the existing `Title:` marker already is. This is what gets written to
`content_items.locale` for that row; no guessing before generation, no
new dependency.

## Data model

Two new migrations, following the no-`CHECK`-constraint pattern
established by `040_user_locale.sql` (validity enforced by
`SUPPORTED_LOCALES` in application code, so a third language stays a
code-only change):

```sql
-- 041_candidate_profile_content_locale.sql
alter table candidate_profiles
  add column if not exists content_locale text not null default 'en';
```

```sql
-- 042_content_items_locale.sql
alter table content_items
  add column if not exists locale text not null default 'en';
```

`content_items.locale` defaults to `'en'` so existing rows (and anything
that bypasses explicit locale selection) stay consistent with today's
English-only behavior without a backfill script.

## Components

- **`buildCandidatePrompt(profile, contentType, locale)`**
  (`src/lib/prompt.ts`) — gains the `locale` parameter; appends the
  Spanish directive when `locale === 'es'`. The no-profile English
  fallback system prompt in `ClaudeContentGenerator.draft`
  (`src/integrations/index.ts:97`) gets the same treatment.
- **`ContentGenerator.draft()`** interface
  (`src/integrations/index.ts:22-29`) — input type gains `locale: Locale`.
  `MockContentGenerator` (used when `LLM_API_KEY` is unset) accepts and
  ignores it, same as it ignores other real-provider-only nuances today.
- **`generateDraftAction(instruction, type, locale)`**
  (`src/app/actions.ts:247-273`) — accepts the new `locale` argument from
  the form, passes it into `contentGenerator.draft(...)`, and writes it
  to `content_items.locale` on insert.
- **`ContentEditor.tsx`** — generation form gains a language selector
  (English/Spanish), pre-filled from
  `candidateProfile.content_locale`. Mirrors the existing pattern of
  `LanguageSwitcher.tsx`'s `<select>` (Phase 1), but this is a distinct
  component/action — it writes to `content_locale`/`content_items.locale`,
  never to `users.locale`.
- **Settings** — a new field next to the rest of the candidate profile
  form for `content_locale` (the campaign default), saved via the
  existing profile-save server action, not a new one.
- **`generateFromMonitoringAction`** (`src/app/actions.ts:560-610`) — the
  hardcoded English rebuttal instruction (lines 590-597) is extended to
  include the opponent excerpt and a "detect and match the language,
  prefix your reply with `Language: en` or `Language: es`" instruction.
  The action parses that marker (same style as the existing `Title:`
  parse) to populate `content_items.locale` for the created row.
- **n8n workflows** — `n8n-opposition-monitoring.json` and
  `n8n-opposition-monitoring-basic.json`: remove the NewsData
  `language=en`/`country=us` query params and the GDELT `sourcelang=eng`
  param entirely, so both queries pull English and Spanish results
  without a language filter, letting the app's already-language-agnostic
  `isRelevant()`/`categorizeSource()` filtering (`src/lib/credibility.ts`)
  do the real relevance scoping instead of the source API filtering
  Spanish coverage out upstream.
- **HeyGen / ElevenLabs integrations** — no code changes. Confirmed via
  research that both already synthesize whatever language the input text
  is in, using the campaign's existing single configured avatar/voice.

## Error handling & validation

- `locale` values outside `SUPPORTED_LOCALES` are rejected the same way
  Phase 1's `updateLocaleAction` rejects invalid values — fall back to
  `'en'` rather than erroring, consistent with `getLocale()`'s existing
  fallback behavior.
- If Claude's rebuttal response omits or malforms the `Language:` marker
  (model non-compliance), fall back to `'en'` for `content_items.locale`
  rather than failing the generation — the content itself still gets
  created; the locale tag is metadata, not a hard requirement for the
  feature to function.
- The `Title:` parsing logic itself is unchanged — the directive
  explicitly tells the model to keep that one marker in English
  regardless of body language, so `src/integrations/index.ts:120-122`
  needs no modification.

## Testing

- `src/lib/prompt.test.ts` — new cases asserting the Spanish directive is
  present in `buildCandidatePrompt(...)` output when `locale === 'es'`
  and absent when `'en'`.
- `src/integrations/index.test.ts` — new case(s) for
  `ClaudeContentGenerator.draft` with `locale: 'es'`, and new case(s) for
  the monitoring-rebuttal `Language:` marker parsing (both values, plus
  the malformed/missing-marker fallback-to-`'en'` path).
- New migration files get the same lightweight test coverage pattern used
  for `040_user_locale.sql` in Phase 1.
- Existing tests are unaffected: nothing currently asserts English-only
  generated body text (the mocked Anthropic client in tests always
  returns whatever the test hardcodes), so this is additive, not a
  rewrite of existing coverage.

## Out of scope / follow-up

- Per-language avatar/voice configuration (see Non-goals).
- Fully independent Spanish prompt templates beyond an appended directive
  (see Non-goals) — revisit if Spanish output quality needs more nuanced,
  language-specific copywriting guidance than a directive provides.
- Additional languages beyond Spanish for content generation — the
  `Locale` type and `SUPPORTED_LOCALES` list are shared with Phase 1, so
  this stays a small, code-only extension when needed.
