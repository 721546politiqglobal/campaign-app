-- Each campaign gets one HeyGen "base" avatar (the candidate's custom avatar).
-- heygen_base_avatar_id  = the avatar_id assigned by admin (may have multiple looks)
-- heygen_avatar_id       = the specific look currently selected for video generation
alter table candidate_profiles
  add column if not exists heygen_base_avatar_id text;
