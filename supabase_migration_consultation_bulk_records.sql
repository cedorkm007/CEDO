-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_bulk_records.sql
-- CONSULTATION TOOL > DAILY RECORDS: ADD MANY DAILY RECORDS AT ONCE (for past transactions), from a spreadsheet.   Safe to run twice.   Undo: undo_consultation_bulk_records.sql
--
--   * One new function, counseling_bulk_records(rows, dry_run). Only consultation staff can use it (the same people who can add one Daily Record).
--   * It checks every row the way adding one record does (the scholar exists, the status and the visit type are valid, the date is a real date that is not in the future)
--     and says, row by row, what is wrong. With dry_run = true nothing is saved (the screen uses it for the preview); with dry_run = false the good rows are saved.
--   * A row that is already recorded (the same scholar, date, visit type, failed subjects, findings and recommendations) is SKIPPED, so uploading the same file twice does not make doubles.
--   * Every record is saved exactly like one added by hand: the consulted-by is the signed-in staff member who uploads.
--   * Nothing is changed or deleted. No table is touched.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.scholar_counseling_records') is null or to_regprocedure('public.is_scholar_counseling_staff()') is null then
    raise exception 'STOPPED, nothing changed: run the Scholar Consultation files first.';
  end if;
end $$;

create or replace function public.counseling_bulk_records(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_ok boolean; v_err text; v_dup boolean;
  v_id_in text; v_id text; v_name text; v_cur text;
  v_date date; v_date_in text;
  v_status text; v_status_in text; v_visit text; v_visit_in text;
  v_fail text; v_find text; v_rec text; v_key text;
begin
  if not public.is_scholar_counseling_staff() then
    raise exception 'Not authorized to use the Scholar Consultation Tool.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows must be a list.'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'At most 500 rows can be sent at a time.'; end if;

  for e in select x.elem, x.n from jsonb_array_elements(p_rows) with ordinality as x(elem, n) order by x.n loop
    v_ok := true; v_err := null; v_dup := false; v_name := null; v_status := null; v_visit := null; v_date := null; v_id := null;
    v_id_in := btrim(coalesce(e.elem ->> 'id', ''));
    v_date_in := btrim(coalesce(e.elem ->> 'date', ''));
    v_status_in := btrim(coalesce(e.elem ->> 'status', ''));
    v_visit_in := btrim(coalesce(e.elem ->> 'visit_type', ''));
    v_fail := btrim(coalesce(e.elem ->> 'failed', ''));
    v_find := btrim(coalesce(e.elem ->> 'findings', ''));
    v_rec := btrim(coalesce(e.elem ->> 'recommendations', ''));

    -- the scholar
    if v_id_in = '' then v_ok := false; v_err := 'The Scholar ID is empty.';
    else
      select s.scholar_id_number, btrim(s.first_name || ' ' || s.last_name), s.status into v_id, v_name, v_cur
        from public.scholars s where lower(s.scholar_id_number) = lower(v_id_in) limit 1;
      if v_id is null then v_ok := false; v_err := 'No scholar has the Scholar ID "' || left(v_id_in, 40) || '".'; end if;
    end if;
    -- the date
    if v_ok then
      if v_date_in = '' then v_ok := false; v_err := 'The date visited is empty.';
      else
        begin
          if v_date_in !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad'; end if;
          v_date := v_date_in::date;
        exception when others then v_ok := false; v_err := 'The date visited "' || left(v_date_in, 30) || '" is not a valid date.';
        end;
        if v_ok and v_date > v_today then v_ok := false; v_err := 'The date visited is in the future (these are past records).';
        elsif v_ok and v_date < date '2000-01-01' then v_ok := false; v_err := 'The date visited is too old to be right.';
        end if;
      end if;
    end if;
    -- the status (empty = the scholar's current status) and the visit type (empty = Office)
    if v_ok then
      if v_status_in = '' then v_status := v_cur;
      else select s into v_status from unnest(array['Regular', 'Probationary', 'On leave', 'Reconsidered', 'Removed']) s where lower(s) = lower(v_status_in) limit 1;
        if v_status is null then v_ok := false; v_err := 'The status "' || left(v_status_in, 30) || '" is not one of Regular, Probationary, On leave, Reconsidered or Removed.'; end if;
      end if;
    end if;
    if v_ok then
      if v_visit_in = '' then v_visit := 'Office';
      else select s into v_visit from unnest(array['Office', 'KSB Client', 'Home Visit']) s where lower(s) = lower(v_visit_in) limit 1;
        if v_visit is null then v_ok := false; v_err := 'The visit type "' || left(v_visit_in, 30) || '" is not Office, KSB Client or Home Visit.'; end if;
      end if;
    end if;
    if v_ok and (char_length(v_fail) > 1000 or char_length(v_find) > 5000 or char_length(v_rec) > 5000) then
      v_ok := false; v_err := 'A text is too long (failed subjects up to 1,000 characters; findings and recommendations up to 5,000).';
    end if;
    -- already recorded (in the database, or earlier in this same file)?
    if v_ok then
      v_key := lower(v_id) || '|' || v_date::text || '|' || v_visit || '|' || v_fail || '|' || v_find || '|' || v_rec;
      v_dup := v_key = any (v_seen) or exists (
        select 1 from public.scholar_counseling_records r
        where r.scholar_id_number = v_id and r.date_visited = v_date and r.visit_type = v_visit
          and btrim(r.failed_subjects) = v_fail and btrim(r.findings) = v_find and btrim(r.staff_recommendations) = v_rec);
      v_seen := v_seen || v_key;
      if not v_dup and not coalesce(p_dry_run, true) then
        insert into public.scholar_counseling_records (scholar_id_number, status, consulted_by, date_visited, failed_subjects, findings, staff_recommendations, visit_type)
        values (v_id, v_status, auth.uid(), v_date, v_fail, v_find, v_rec, v_visit);
      end if;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object('i', e.n, 'ok', v_ok, 'duplicate', v_dup, 'error', v_err, 'scholar_id', v_id, 'name', v_name,
                                                          'status', v_status, 'visit_type', v_visit, 'date', v_date));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.counseling_bulk_records(jsonb, boolean) from public, anon;
grant execute on function public.counseling_bulk_records(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
