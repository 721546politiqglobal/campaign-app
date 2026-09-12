-- Per-campaign default language for AI content generation (Content Wizard,
-- monitoring rebuttals). Distinct from users.locale (a per-user UI
-- preference, added in 040) — this is a content-strategy setting that
-- belongs to the campaign, not the person currently viewing the app.
-- No CHECK constraint — validity is enforced in application code
-- (SUPPORTED_LOCALES in src/lib/locale.ts) so a third language later is a
-- code change, not a migration.

ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS content_locale text NOT NULL DEFAULT 'en';
