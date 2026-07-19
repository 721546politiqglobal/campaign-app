-- supabase/migrations/025_login_attempts.sql
-- Per-IP and per-account login throttle (SEC-10). Keyed 'ip:<addr>' or
-- 'email:<addr>'. Rows are best-effort and safe to prune periodically.
create table if not exists login_attempts (
  key          text primary key,
  attempts     integer     not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

create index if not exists idx_login_attempts_locked_until on login_attempts(locked_until);
