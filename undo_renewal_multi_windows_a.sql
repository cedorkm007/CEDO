-- Undo of supabase_migration_renewal_multi_windows_a_constraint.sql: puts the "one window per term" rule back.
-- It STOPS (changes nothing) if a term already has two windows: delete or merge the extra windows first (Windows tab), then run it again.
set lock_timeout = '5s';
do $$
begin
  if exists (select 1 from public.renewal_windows group by school_year, term having count(*) > 1) then
    raise exception 'STOPPED, nothing changed: some term has more than one renewal window. Delete the extra windows first, then run this again.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.renewal_windows'::regclass and contype = 'u'
                 and (select array_agg(att.attname::text order by att.attname::text) from pg_attribute att where att.attrelid = conrelid and att.attnum = any (conkey)) = array['school_year', 'term']) then
    alter table public.renewal_windows add constraint renewal_windows_school_year_term_key unique (school_year, term);
  end if;
end $$;
drop index if exists public.renewal_windows_year_term_idx;
