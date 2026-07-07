-- supabase/migrations/012_avatar_look_id.sql
-- Store one representative HeyGen look id per avatar, so later prompt-guided
-- look generation (POST /v3/avatars, type: "prompt") has something to
-- condition on to preserve the real person's identity.
alter table avatars
  add column if not exists heygen_look_id text;
