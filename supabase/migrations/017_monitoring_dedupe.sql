-- supabase/migrations/017_monitoring_dedupe.sql
-- DATA-17: enforce single-row-per-(campaign_id, url) so ingest can upsert
-- on-conflict instead of racing a check-then-insert.

-- 1. Collapse any pre-existing duplicates, keeping the earliest captured row.
--    NOTE: this delete is NOT reversible — call it out in the PR.
delete from monitoring_results a
using monitoring_results b
where a.campaign_id = b.campaign_id
  and a.url = b.url
  and a.captured_at > b.captured_at;

-- 2. Unique index that upsert's onConflict target references.
create unique index if not exists monitoring_results_campaign_url_uniq
  on monitoring_results (campaign_id, url);

-- Reverse (do not run; the dedupe delete above is irreversible):
--   drop index if exists monitoring_results_campaign_url_uniq;
