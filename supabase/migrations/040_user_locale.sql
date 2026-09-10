-- Adds a per-user UI language preference. No CHECK constraint on the
-- value — validity is enforced in application code (SUPPORTED_LOCALES in
-- src/lib/locale.ts) so adding a new language later is a code change,
-- not a migration.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';
