-- ─────────────────────────────────────────────────────────────
-- SEVERAL RENEWAL WINDOWS PER TERM, FILE C: the older form of the save follows the new rules.   Safe to run twice.   Undo: undo_renewal_multi_windows_c.sql
-- Run AFTER supabase_migration_renewal_multi_windows_b_functions.sql.
--
-- The Windows tab saves a window through one of two forms of the same function: the form that carries the chosen schools (File B replaced it), and the older, shorter form that the screen
-- uses when no schools are chosen ("All schools", or only editing dates). The older form still had the one-window-per-term check, so it answered "There is already a renewal window for ... —
-- edit that one instead." even after File A and B. This file makes the older form hand over to the new form, so every way of saving follows the same rules:
--   • a second window for a term is accepted when its schools do not overlap with another window's schools;
--   • a second "all schools" window, a school in two windows, and mixing with a testers-only window give the clear messages of File B.
-- Replaces one function. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public._renewal_window_has_scholar(uuid,text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_multi_windows_b_functions.sql first.';
  end if;
end $$;

create or replace function public.renewal_window_save(p_id uuid, p_school_year text, p_term text, p_opens_on date, p_closes_on date, p_late_allowed boolean, p_note text default '', p_testers text[] default null)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.renewal_window_save(p_id, p_school_year, p_term, p_opens_on, p_closes_on, p_late_allowed, p_note, p_testers, null::uuid[]);
$$;
revoke all on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[]) from public, anon;
grant execute on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[]) to authenticated;

notify pgrst, 'reload schema';
