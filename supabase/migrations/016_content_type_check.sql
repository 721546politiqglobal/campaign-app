-- supabase/migrations/016_content_type_check.sql
-- DATA-16: content_items.type was unconstrained text. Constrain it to the
-- ContentType union so a bad client-supplied value can never persist.
alter table content_items
  add constraint content_items_type_check
  check (type in ('reel', 'social_post', 'press_release', 'ad_copy', 'talking_points'));

-- Reverse (do not run):
--   alter table content_items drop constraint content_items_type_check;
