-- supabase/migrations/015_avatar_delete_policy.sql
-- DATA-12: candidate_profiles.active_avatar_id (added in 009_avatars.sql) had
-- no ON DELETE rule, so deleting an avatar that is still referenced fails at
-- the DB layer. deleteAvatarAction clears the pointer in code first, but SET
-- NULL is a safe backstop and makes the reference self-healing. The column is
-- nullable, so SET NULL is valid.
--
-- If 009 created the FK under a non-default name, discover it first with:
--   select conname from pg_constraint
--   where conrelid='candidate_profiles'::regclass and confrelid='avatars'::regclass;
-- and substitute below.
alter table candidate_profiles
  drop constraint if exists candidate_profiles_active_avatar_id_fkey;

alter table candidate_profiles
  add constraint candidate_profiles_active_avatar_id_fkey
  foreign key (active_avatar_id) references avatars(id) on delete set null;

-- Verify (expect confdeltype = 'n'):
--   select conname, confdeltype from pg_constraint
--   where conrelid='candidate_profiles'::regclass
--     and conname='candidate_profiles_active_avatar_id_fkey';
