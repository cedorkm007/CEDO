-- Adds per-field document categories for Submission Activities. Run this
-- BEFORE supabase_migration_submission_upload_field_categories_rpc.sql.
-- Existing fields are intentionally backfilled to every supported category.

alter table public.submission_upload_fields
  add column if not exists allowed_categories text[] not null default array['PDF', 'Word', 'JPEG', 'PNG', 'Excel/CSV']::text[];

update public.submission_upload_fields
set allowed_categories = array['PDF', 'Word', 'JPEG', 'PNG', 'Excel/CSV']::text[]
where allowed_categories is null or cardinality(allowed_categories) = 0;

alter table public.submission_upload_fields
  drop constraint if exists submission_upload_fields_allowed_categories_check;
alter table public.submission_upload_fields
  add constraint submission_upload_fields_allowed_categories_check
  check (cardinality(allowed_categories) > 0 and allowed_categories <@ array['PDF', 'Word', 'JPEG', 'PNG', 'Excel/CSV']::text[]);

alter table public.submission_upload_fields
  alter column allowed_categories set default array['PDF', 'Word', 'JPEG', 'PNG', 'Excel/CSV']::text[];
