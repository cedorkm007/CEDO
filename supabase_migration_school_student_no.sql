-- ─────────────────────────────────────────────────────────────
-- SCHOOL PORTAL: the school's own ID for each scholar ("School ID" / "Student No." on the school's promotional report).   Safe to run twice.   Undo: undo_school_student_no.sql
-- Adds ONE nullable column to the scholars (school_student_no) and two functions the School Portal uses to fill it in. Nothing existing is changed or deleted.
--
--   * A school types the School ID of each of its scholars in the scholar list, or confirms it on its first upload of the new promotional report / enrollment list
--     (the upload matches the scholar by name and asks the school to confirm). After that, uploads find the scholar by Student No.
--   * One School ID per scholar, and no two scholars of the same school may share one (capital letters and spaces at the ends do not make it different).
--   * Only a school account can set it, only for its own scholars. Staff keep their full access to the scholars table as before.
-- ─────────────────────────────────────────────────────────────

set lock_timeout = '5s';

alter table public.scholars add column if not exists school_student_no text;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.scholars'::regclass and conname = 'scholars_school_student_no_check') then
    alter table public.scholars add constraint scholars_school_student_no_check
      check (school_student_no is null or (btrim(school_student_no) = school_student_no and length(school_student_no) between 1 and 40));
  end if;
end $$;

create unique index if not exists scholars_school_student_no_uq on public.scholars (school_id, lower(school_student_no)) where school_student_no is not null and school_id is not null;

-- One scholar: set (or clear, with a blank) the School ID.
create or replace function public.school_set_student_no(p_scholar_id_number text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v_school is null or not public.is_school_account() then raise exception 'Only a school account can set a School ID.'; end if;
  if not exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school) then
    raise exception 'That scholar is not one of your school''s scholars.';
  end if;
  if v is not null and length(v) > 40 then raise exception 'A School ID can be at most 40 characters.'; end if;
  begin
    update public.scholars set school_student_no = v where scholar_id_number = p_scholar_id_number;
  exception when unique_violation then
    raise exception 'Another scholar of your school already has the School ID %.', v;
  end;
end;
$$;
revoke all on function public.school_set_student_no(text, text) from public, anon;
grant execute on function public.school_set_student_no(text, text) to authenticated;

-- Several scholars at once (the links a school confirmed on an upload): [{"scholarIdNumber": "...", "studentNo": "..."}].
-- Each one is judged on its own. A scholar who already has a School ID is never overwritten here (the same ID again counts as done).
create or replace function public.school_link_student_nos(p_links jsonb)
returns table(row_index integer, ok boolean, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  l jsonb;
  i integer := 0;
  v_sid text;
  v_no text;
  v_cur text;
begin
  if v_school is null or not public.is_school_account() then raise exception 'Only a school account can set a School ID.'; end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array' then raise exception 'Expected a list of links.'; end if;
  for l in select * from jsonb_array_elements(p_links) loop
    v_sid := btrim(coalesce(l ->> 'scholarIdNumber', ''));
    v_no := nullif(btrim(coalesce(l ->> 'studentNo', '')), '');
    begin
      if v_no is null then raise exception 'The Student No. is blank.'; end if;
      if length(v_no) > 40 then raise exception 'A School ID can be at most 40 characters.'; end if;
      select s.school_student_no into v_cur from public.scholars s where s.scholar_id_number = v_sid and s.school_id = v_school;
      if not found then raise exception 'That scholar is not one of your school''s scholars.'; end if;
      if v_cur is not null and lower(v_cur) <> lower(v_no) then raise exception 'This scholar already has the School ID %.', v_cur; end if;
      if v_cur is null then
        begin
          update public.scholars set school_student_no = v_no where scholar_id_number = v_sid;
        exception when unique_violation then
          raise exception 'Another scholar of your school already has the School ID %.', v_no;
        end;
      end if;
      row_index := i; ok := true; error := null; return next;
    exception when others then
      row_index := i; ok := false; error := sqlerrm; return next;
    end;
    i := i + 1;
  end loop;
end;
$$;
revoke all on function public.school_link_student_nos(jsonb) from public, anon;
grant execute on function public.school_link_student_nos(jsonb) to authenticated;

notify pgrst, 'reload schema';
