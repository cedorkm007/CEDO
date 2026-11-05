-- ─────────────────────────────────────────────────────────────
-- SEVERAL RENEWAL WINDOWS PER TERM, FILE A of 2: lift the "one window per term" rule.   Safe to run twice.   Undo: undo_renewal_multi_windows_a.sql
-- Run this FIRST, on its own, then supabase_migration_renewal_multi_windows_b_functions.sql. Run AFTER the "window schools" files.
--
-- Until now the renewal windows table allowed only ONE window for a school year and term. This removes that rule so a term can have several windows, each for its own schools and
-- with its own opening and closing dates (for example: a different schedule for each school). Which windows may exist together is then decided by file B (a school can belong to
-- only one window of a term).
-- This changes ONE table (renewal_windows): it drops the one-window-per-term rule and adds an ordinary (not unique) index. No row is read, changed or deleted.
-- It needs a very short lock on that table, so it waits at most 5 seconds and then stops with a message instead of holding anything up: if so, run it again a minute later.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.renewal_windows'::regclass and con.contype = 'u'
      and (select array_agg(att.attname::text order by att.attname::text) from pg_attribute att where att.attrelid = con.conrelid and att.attnum = any (con.conkey)) = array['school_year', 'term']
  loop
    execute format('alter table public.renewal_windows drop constraint %I', c.conname);
  end loop;
end $$;

create index if not exists renewal_windows_year_term_idx on public.renewal_windows (school_year, term);

notify pgrst, 'reload schema';
