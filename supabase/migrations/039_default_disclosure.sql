-- Replaces the per-jurisdiction disclosure_rules system with a single
-- campaign-level default disclosure, editable by the campaign owner in
-- Settings. The empty-jurisdictions/unconfigured-rule states silently
-- skipped the disclosure step for AI-generated content of any type — this
-- removes that failure mode by making disclosure requirement independent of
-- jurisdiction data entirely.

alter table campaigns add column if not exists default_disclosure_text text;

-- disclosure_records.jurisdiction is no longer written going forward —
-- historical rows keep their values, new rows leave it null.
alter table disclosure_records alter column jurisdiction drop not null;
