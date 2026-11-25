-- ─────────────────────────────────────────────────────────────
-- supabase_migration_daily_records_popup.sql
-- CONSULTATION TOOL > DAILY RECORDS: THE LARGER RECORD POP-UP (scholar summary, quick phrases, saved drafts).   Safe to run twice.   Undo: undo_daily_records_popup.sql
--   * DRAFTS: what a staff member has typed but not saved yet is kept for them (every few seconds), so it comes back after a refresh, after closing the window or on another computer.
--     Each staff member can see only their own drafts. A draft is removed when the record is saved or the draft is discarded, and drafts older than 30 days are removed.
--   * QUICK PHRASES: one shared list of short, ready-made lines ("Advised to submit study plan") that staff insert into the findings or the recommendations. Any consultation staff can add, change or remove them.
--   * SCHOLAR SUMMARY: a read-only function for the left side of the pop-up: the scholar's details, the renewal stage, the failed and INC subjects, and the previous visits.
--   * Adds 2 new tables and 7 new functions. No record, text, history or other table is changed or deleted.
-- Needs supabase_migration_daily_records_edit.sql (Phase 1).
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.scholar_counseling_record_edits') is null or to_regprocedure('public.is_scholar_counseling_staff()') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_daily_records_edit.sql first.';
  end if;
end $$;

-- 1. Drafts: what a staff member typed but has not saved. One draft per staff member and per record (or per new record).
create table if not exists public.consultation_record_drafts (
  staff_id uuid not null references public.users(id) on delete cascade,
  draft_key text not null check (char_length(draft_key) between 1 and 120),
  payload jsonb not null default '{}'::jsonb,
  base_edit_count integer,
  saved_at timestamptz not null default now(),
  primary key (staff_id, draft_key)
);
create index if not exists consultation_record_drafts_saved_idx on public.consultation_record_drafts (saved_at);
alter table public.consultation_record_drafts enable row level security;
revoke all on public.consultation_record_drafts from public, anon, authenticated;      -- read and written only through the functions below, and only your own

create or replace function public.counseling_draft_save(p_key text, p_payload jsonb, p_base integer default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_at timestamptz := now();
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  if p_key is null or char_length(btrim(p_key)) = 0 or char_length(p_key) > 120 then raise exception 'That draft has no valid name.'; end if;
  if octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 200000 then raise exception 'The draft is too large to keep.'; end if;
  delete from public.consultation_record_drafts where saved_at < now() - interval '30 days';      -- drafts nobody came back to
  insert into public.consultation_record_drafts (staff_id, draft_key, payload, base_edit_count, saved_at)
  values (auth.uid(), p_key, coalesce(p_payload, '{}'::jsonb), p_base, v_at)
  on conflict (staff_id, draft_key) do update set payload = excluded.payload, base_edit_count = excluded.base_edit_count, saved_at = excluded.saved_at;
  return v_at;
end;
$$;
revoke all on function public.counseling_draft_save(text, jsonb, integer) from public, anon;
grant execute on function public.counseling_draft_save(text, jsonb, integer) to authenticated;

create or replace function public.counseling_draft_get(p_key text)
returns table(payload jsonb, base_edit_count integer, saved_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  return query select d.payload, d.base_edit_count, d.saved_at from public.consultation_record_drafts d where d.staff_id = auth.uid() and d.draft_key = p_key;
end;
$$;
revoke all on function public.counseling_draft_get(text) from public, anon;
grant execute on function public.counseling_draft_get(text) to authenticated;

create or replace function public.counseling_draft_discard(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  delete from public.consultation_record_drafts where staff_id = auth.uid() and draft_key = p_key;
end;
$$;
revoke all on function public.counseling_draft_discard(text) from public, anon;
grant execute on function public.counseling_draft_discard(text) to authenticated;

-- 2. Quick phrases: one shared list for all consultation staff.
create table if not exists public.consultation_quick_phrases (
  id uuid primary key default gen_random_uuid(),
  phrase text not null check (char_length(btrim(phrase)) between 1 and 300),
  sort_no integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.consultation_quick_phrases enable row level security;
revoke all on public.consultation_quick_phrases from public, anon, authenticated;

-- two example phrases, only while the list is still empty
insert into public.consultation_quick_phrases (phrase, sort_no)
select p.phrase, p.n from (values ('Advised to submit study plan', 1), ('Referred to guidance office', 2)) as p(phrase, n)
where not exists (select 1 from public.consultation_quick_phrases);

create or replace function public.counseling_phrases_list()
returns table(id uuid, phrase text, sort_no integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  return query select q.id, q.phrase, q.sort_no from public.consultation_quick_phrases q order by q.sort_no, q.created_at;
end;
$$;
revoke all on function public.counseling_phrases_list() from public, anon;
grant execute on function public.counseling_phrases_list() to authenticated;

-- add a phrase (p_id null) or change one
create or replace function public.counseling_phrase_save(p_id uuid, p_phrase text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_text text := btrim(coalesce(p_phrase, '')); v_id uuid;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  if v_text = '' then raise exception 'Type the phrase first.'; end if;
  if char_length(v_text) > 300 then raise exception 'A phrase can have at most 300 characters.'; end if;
  if p_id is null then
    if (select count(*) from public.consultation_quick_phrases) >= 100 then raise exception 'The list is full (100 phrases). Remove one first.'; end if;
    insert into public.consultation_quick_phrases (phrase, sort_no, created_by)
    values (v_text, coalesce((select max(sort_no) from public.consultation_quick_phrases), 0) + 1, auth.uid()) returning id into v_id;
  else
    update public.consultation_quick_phrases set phrase = v_text, updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'That phrase was not found.'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.counseling_phrase_save(uuid, text) from public, anon;
grant execute on function public.counseling_phrase_save(uuid, text) to authenticated;

create or replace function public.counseling_phrase_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  delete from public.consultation_quick_phrases where id = p_id;
end;
$$;
revoke all on function public.counseling_phrase_delete(uuid) from public, anon;
grant execute on function public.counseling_phrase_delete(uuid) to authenticated;

-- 3. The scholar summary for the left side of the pop-up (read only). The previous visits come 20 at a time, newest first; p_exclude leaves out the record being opened.
create or replace function public.counseling_record_context(p_scholar_id text, p_exclude uuid default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.scholars%rowtype;
  r record;
  v_ev jsonb := null;
  v_failed jsonb := '[]'::jsonb;
  v_inc_subjects jsonb := '[]'::jsonb;
  v_inc jsonb := '[]'::jsonb;
  v_visits jsonb;
  v_total integer;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_renewal jsonb := null;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  select * into s from public.scholars where scholar_id_number = p_scholar_id;
  if not found then raise exception 'Scholar not found.'; end if;

  select rr.id, rr.stage, rr.term, rr.school_year into r from public.renewal_records rr where rr.scholar_id_number = p_scholar_id order by rr.created_at desc limit 1;
  if found then
    begin v_ev := public._renewal_evaluate(p_scholar_id, r.school_year, r.term); exception when others then v_ev := null; end;
    v_failed := coalesce(v_ev -> 'grades' -> 'failed_subjects', '[]'::jsonb);
    v_inc_subjects := coalesce(v_ev -> 'grades' -> 'inc_subjects', '[]'::jsonb);
    select coalesce(jsonb_agg(jsonb_build_object('subject', i.subject, 'deadline', i.deadline) order by i.subject), '[]'::jsonb) into v_inc
    from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open';
    v_renewal := jsonb_build_object('stage', r.stage, 'term', r.term, 'school_year', r.school_year);
  end if;

  select count(*) into v_total from public.scholar_counseling_records c where c.scholar_id_number = p_scholar_id and (p_exclude is null or c.id <> p_exclude);
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'date_visited', t.date_visited, 'visit_type', t.visit_type, 'consultant', t.consultant,
                                               'findings', t.findings, 'staff_recommendations', t.staff_recommendations, 'edit_count', t.edit_count) order by t.date_visited desc, t.created_at desc), '[]'::jsonb) into v_visits
  from (
    select c.id, c.date_visited, c.visit_type, c.created_at, c.findings, c.staff_recommendations, c.edit_count,
           btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as consultant
    from public.scholar_counseling_records c left join public.users u on u.id = c.consulted_by
    where c.scholar_id_number = p_scholar_id and (p_exclude is null or c.id <> p_exclude)
    order by c.date_visited desc, c.created_at desc limit v_limit offset v_offset
  ) t;

  return jsonb_build_object(
    'scholar', jsonb_build_object('name', btrim(s.first_name || ' ' || s.last_name), 'scholar_id_number', s.scholar_id_number, 'school', s.school, 'program', s.course, 'year_level', s.year_level, 'status', s.status),
    'renewal', v_renewal, 'failed_subjects', v_failed, 'inc_subjects', v_inc_subjects, 'open_inc', v_inc,
    'visits', v_visits, 'visits_total', v_total);
end;
$$;
revoke all on function public.counseling_record_context(text, uuid, integer, integer) from public, anon;
grant execute on function public.counseling_record_context(text, uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
