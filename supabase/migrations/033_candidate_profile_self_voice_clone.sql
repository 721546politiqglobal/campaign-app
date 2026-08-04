-- supabase/migrations/033_candidate_profile_self_voice_clone.sql
alter table candidate_profiles
  add column if not exists self_voice_clone_id text,
  add column if not exists self_voice_name text,
  add column if not exists self_voice_clone_status text check (self_voice_clone_status in ('training', 'ready', 'failed')),
  add column if not exists self_voice_clone_error text,
  add column if not exists self_voice_consent_confirmed_by text references users(id),
  add column if not exists self_voice_consent_confirmed_at timestamptz;
