-- Records which language a specific piece of content was actually
-- generated in. Generation is per-item (a campaign can generate the same
-- brief in both English and Spanish), so this can't be read off
-- candidate_profiles.content_locale at render time — it must be recorded
-- per row at generation time. Defaults to 'en' so existing rows (and any
-- insert path that predates this column) stay consistent with today's
-- English-only behavior without a backfill script.
-- No CHECK constraint — see 040_user_locale.sql / 041 for the rationale.

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';
