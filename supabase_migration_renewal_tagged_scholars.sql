-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_tagged_scholars.sql
-- Scholar tagging for AUTOMATIC RENEWAL.
--   • it.admin1 and the staff accounts it.admin1 gives the tag "renewal_scholar_tagger" can tag scholars (one ID or many at once) for a renewal term, and remove the tag. They see only the
--     "Scholar tagging" tab of Scholar Renewal; the renewal evaluator can read the list.
--   • A tagged scholar applies as usual: all they have to do is enter their grades (if the school has not uploaded them yet) and, when they did not comply with the SDP, ask for an SDP
--     reconsideration. When the grades and the SDP are approved (nothing failed, no DRP and no INC) the renewal is confirmed AUTOMATICALLY by the system: the scholarship status stays what it is.
--   • A tagged scholar with a failed, DRP or INC subject follows the usual process (consultation, study plan, documents, Division Head). Summer renewals are never automatic.
--   • A tag counts for ONE renewal term only. Tagging a scholar who has already applied and is ready renews them at once.
-- Needs the renewal files already run. Nothing is deleted. Safe to run twice.
-- ─────────────────────────────────────────────────────────────

begin;

-- Who may tag: it.admin1 and the accounts it.admin1 gave the tag renewal_scholar_tagger.
create or replace function public.can_tag_renewed_scholars()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_it_admin() or exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'renewal_scholar_tagger');
$$;
revoke all on function public.can_tag_renewed_scholars() from public, anon;
grant execute on function public.can_tag_renewed_scholars() to authenticated;

create table if not exists public.renewal_tagged_scholars (
  school_year        text not null,
  term               text not null,
  scholar_id_number  text not null references public.scholars(scholar_id_number) on delete cascade,
  tagged_by          uuid references public.users(id) on delete set null,
  tagged_by_label    text,
  tagged_at          timestamptz not null default now(),
  primary key (school_year, term, scholar_id_number)
);
create index if not exists renewal_tagged_scholars_scholar_idx on public.renewal_tagged_scholars (scholar_id_number);
alter table public.renewal_tagged_scholars enable row level security;
drop policy if exists "renewal tagged read" on public.renewal_tagged_scholars;
create policy "renewal tagged read" on public.renewal_tagged_scholars for select to authenticated using (public.can_view_renewals() or public.can_tag_renewed_scholars());
-- (no insert / update / delete policy: tagging only goes through the functions below)

-- The renewal terms to choose from (newest first).
create or replace function public.renewal_tag_terms()
returns table(school_year text, term text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.can_view_renewals() or public.can_tag_renewed_scholars()) then raise exception 'Not authorized to see the tagged scholars.'; end if;
  return query select w.school_year, w.term from public.renewal_windows w group by w.school_year, w.term order by max(w.opens_on) desc, w.school_year desc;
end;
$$;
revoke all on function public.renewal_tag_terms() from public, anon;
grant execute on function public.renewal_tag_terms() to authenticated;

-- Tags scholars (a list of Scholar IDs) for a term. Returns {tagged, already, not_found: [...], skipped: [...]}; skipped = Removed or On leave.
create or replace function public.renewal_tag_scholars(p_school_year text, p_term text, p_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
  v_id text;
  v_s public.scholars%rowtype;
  v_tagged integer := 0;
  v_already integer := 0;
  v_not_found jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_rec uuid;
  v_stage text;
begin
  if not public.can_tag_renewed_scholars() then raise exception 'Only it.admin1 and the accounts it.admin1 appoints can tag scholars for automatic renewal.'; end if;
  if coalesce(btrim(p_school_year), '') = '' or coalesce(btrim(p_term), '') = '' then raise exception 'Choose the renewal term first.'; end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Enter at least one Scholar ID.'; end if;
  if array_length(p_ids, 1) > 2000 then raise exception 'At most 2000 Scholar IDs at a time.'; end if;
  v_label := public._actor_name();
  for v_id in select distinct btrim(x) from unnest(p_ids) x where btrim(coalesce(x, '')) <> '' loop
    select * into v_s from public.scholars where upper(scholar_id_number) = upper(v_id);
    if not found then v_not_found := v_not_found || to_jsonb(v_id); continue; end if;
    if v_s.status in ('Removed', 'On leave') then v_skipped := v_skipped || to_jsonb(v_s.scholar_id_number || ' (' || v_s.status || ')'); continue; end if;
    if exists (select 1 from public.renewal_tagged_scholars t where t.school_year = p_school_year and t.term = p_term and t.scholar_id_number = v_s.scholar_id_number) then v_already := v_already + 1; continue; end if;
    insert into public.renewal_tagged_scholars (school_year, term, scholar_id_number, tagged_by, tagged_by_label) values (p_school_year, p_term, v_s.scholar_id_number, auth.uid(), v_label);
    v_tagged := v_tagged + 1;
    -- a scholar who already applied and is ready is renewed right now
    select r.id, r.stage into v_rec, v_stage from public.renewal_records r where r.scholar_id_number = v_s.scholar_id_number and r.school_year = p_school_year and r.term = p_term;
    if v_rec is not null then
      perform public._renewal_log(v_rec, v_stage, v_stage, 'Tagged for automatic renewal by ' || v_label || '.', v_label);
      perform public._renewal_recheck(v_rec);
    end if;
  end loop;
  return jsonb_build_object('tagged', v_tagged, 'already', v_already, 'not_found', v_not_found, 'skipped', v_skipped);
end;
$$;
revoke all on function public.renewal_tag_scholars(text, text, text[]) from public, anon;
grant execute on function public.renewal_tag_scholars(text, text, text[]) to authenticated;

-- Removes the tag (a scholar who is already renewed keeps the renewal). Returns how many tags were removed.
create or replace function public.renewal_untag_scholars(p_school_year text, p_term text, p_ids text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.can_tag_renewed_scholars() then raise exception 'Only it.admin1 and the accounts it.admin1 appoints can remove the tag.'; end if;
  delete from public.renewal_tagged_scholars t
  where t.school_year = p_school_year and t.term = p_term and upper(t.scholar_id_number) in (select upper(btrim(x)) from unnest(coalesce(p_ids, '{}'::text[])) x);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.renewal_untag_scholars(text, text, text[]) from public, anon;
grant execute on function public.renewal_untag_scholars(text, text, text[]) to authenticated;

-- The tagged scholars of a term, with where their renewal stands.
create or replace function public.renewal_tagged_list(p_school_year text, p_term text, p_query text default null, p_limit integer default 25, p_offset integer default 0)
returns table(scholar_id_number text, name text, school text, program text, year_level text, scholar_status text, tagged_at timestamptz, tagged_by_label text, record_id uuid, stage text, renewed boolean, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not (public.can_view_renewals() or public.can_tag_renewed_scholars()) then raise exception 'Not authorized to see the tagged scholars.'; end if;
  return query
  select t.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, s.status, t.tagged_at, t.tagged_by_label,
         r.id, r.stage, coalesce(r.stage = 'renewed', false), count(*) over ()
  from public.renewal_tagged_scholars t
  join public.scholars s on s.scholar_id_number = t.scholar_id_number
  left join public.renewal_records r on r.scholar_id_number = t.scholar_id_number and r.school_year = t.school_year and r.term = t.term
  where t.school_year = p_school_year and t.term = p_term
    and (v_q is null or t.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%' or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by s.last_name, s.first_name
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.renewal_tagged_list(text, text, text, integer, integer) from public, anon;
grant execute on function public.renewal_tagged_list(text, text, text, integer, integer) to authenticated;

-- The automatic confirmation: the same changes the evaluator's "Confirm" makes, done by the system (status unchanged).
create or replace function public._renewal_auto_confirm(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_label text;
begin
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found or v_rec.stage <> 'ready_for_confirmation' then return; end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  update public.renewal_records set stage = 'renewed', result = 'renewed', confirmed_at = now(), confirmed_by = null,
    evaluator_comment = 'Renewed automatically: the scholar was tagged for automatic renewal and the grades and the SDP are approved.', updated_at = now()
  where id = p_record_id;
  perform public._renewal_log(p_record_id, 'ready_for_confirmation', 'renewed', 'Renewed automatically: tagged for automatic renewal, and the grades and the SDP are approved.', 'System');
  perform public._notify_scholar(v_rec.scholar_id_number, 'renewal_confirmed', 'Your renewal is confirmed',
    'You are renewed for ' || v_label || '. Your Certificate of Scholarship Renewal will be available here once certificates are switched on.', p_record_id);
  perform public._renewal_scholar_list_refresh_one(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
end;
$$;
revoke all on function public._renewal_auto_confirm(uuid) from public, anon, authenticated;

-- The automatic re-check (runs whenever grades, SDP credits or documents change), with the automatic renewal added at its end.
create or replace function public._renewal_recheck(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_ev jsonb;
  v_old_stage text;
  v_new_stage text;
  v_term_label text;
  v_item jsonb;
  v_state text;
  v_outcome text;
  v_old_docs text[];
  v_new_docs text[];
  v_doc text;
  v_labels text;
  v_inc_open integer;
  v_scholar public.scholars%rowtype;
  v_auto boolean := false;
begin
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found or not public._renewal_is_active_stage(v_rec.stage) then return; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_rec.scholar_id_number;

  v_ev := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
  if v_ev ? 'error' then return; end if;
  v_old_stage := v_rec.stage;
  v_new_stage := v_ev ->> 'stage';
  -- a scholar the IT admin's team tagged for automatic renewal (this term, not Summer) who reaches "ready for confirmation" is renewed by the system: see below
  v_auto := v_new_stage = 'ready_for_confirmation' and v_rec.term <> 'Summer'
    and exists (select 1 from public.renewal_tagged_scholars t where t.scholar_id_number = v_rec.scholar_id_number and t.school_year = v_rec.school_year and t.term = v_rec.term);
  v_term_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  -- INC items: one per INC subject; settled when the school enters the completed grade.
  for v_item in select * from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') loop
    insert into public.renewal_inc_items (record_id, scholar_id_number, subject_code, subject)
    values (v_rec.id, v_rec.scholar_id_number, v_item ->> 'code', v_item ->> 'subject')
    on conflict (record_id, subject_code) do nothing;
  end loop;
  for v_item in
    select jsonb_build_object('id', i.id, 'code', i.subject_code) from public.renewal_inc_items i
    where i.record_id = v_rec.id and i.state = 'open'
      and not exists (select 1 from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') s where s ->> 'code' = i.subject_code)
  loop
    select public._grade_outcome(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade) into v_outcome
    from public.scholar_subjects_grades g
    where g.scholar_id_number = v_rec.scholar_id_number and g.school_year = v_ev ->> 'basis_school_year'
      and g.semester = v_ev ->> 'basis_term' and g.subject_code = v_item ->> 'code'
    order by g.updated_at desc limit 1;
    v_state := case v_outcome when 'passed' then 'resolved_passed' when 'failed' then 'resolved_failed' when 'drp' then 'resolved_failed' else null end;
    if v_state is not null then
      update public.renewal_inc_items set state = v_state, updated_at = now() where id = (v_item ->> 'id')::uuid;
      perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage,
        'INC in ' || (v_item ->> 'code') || ' resolved with a ' || case when v_state = 'resolved_passed' then 'passing' else 'failing' end || ' grade.', 'System');
    end if;
  end loop;

  -- Temporary probation while an INC is open; lifted when none is left open.
  select count(*) into v_inc_open from public.renewal_inc_items i where i.record_id = v_rec.id and i.state = 'open';
  if v_inc_open > 0 and not v_rec.temp_probation and v_scholar.status in ('Regular', 'Reconsidered') and v_new_stage <> 'sdp_on_hold' and v_new_stage <> 'waiting_grades' then
    perform public._renewal_set_status(v_rec.scholar_id_number, 'Probationary', true, 'Temporary probation while an INC is open (renewal ' || v_term_label || ').');
    update public.renewal_records set temp_probation = true, temp_previous_status = v_scholar.status where id = v_rec.id;
    v_rec.temp_probation := true; v_rec.temp_previous_status := v_scholar.status;
  elsif v_inc_open = 0 and v_rec.temp_probation then
    if exists (select 1 from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number and s.status = 'Probationary') then
      perform public._renewal_set_status(v_rec.scholar_id_number, coalesce(v_rec.temp_previous_status, 'Regular'), false, 'Temporary INC probation lifted (renewal ' || v_term_label || ').');
    end if;
    update public.renewal_records set temp_probation = false where id = v_rec.id;
    v_rec.temp_probation := false;
  end if;

  update public.renewal_records set
    stage = v_new_stage, evaluation = v_ev, rule_code = v_ev ->> 'rule_code', rule_text = v_ev ->> 'rule_text',
    basis_school_year = v_ev ->> 'basis_school_year', basis_term = v_ev ->> 'basis_term',
    consultation_required = coalesce((v_ev ->> 'consultation_required')::boolean, false), updated_at = now()
  where id = v_rec.id;

  if v_new_stage is distinct from v_old_stage then
    perform public._renewal_log(v_rec.id, v_old_stage, v_new_stage,
      case v_new_stage
        when 'sdp_on_hold' then 'On hold: ' || coalesce(v_ev ->> 'reason', '')
        when 'waiting_grades' then v_ev ->> 'reason'
        when 'review_needed' then v_ev ->> 'reason'
        else coalesce(v_ev ->> 'rule_text', '') end, 'System');
    if v_new_stage = 'sdp_on_hold' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'on_hold', 'Your renewal is on hold',
        'Your SDP credits for ' || public._renewal_term_label(v_ev ->> 'basis_school_year', v_ev ->> 'basis_term') || ' are not complete yet: ' || coalesce(v_ev ->> 'reason', '') || '. We will check again automatically when new credits are recorded.', v_rec.id);
    elsif v_new_stage = 'waiting_grades' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'on_hold', 'Waiting for your grades',
        coalesce(v_ev ->> 'reason', '') || ' We will check again automatically when they are submitted.', v_rec.id);
    elsif v_new_stage in ('needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation', 'summer_requirements') then
      perform public._notify_scholar(v_rec.scholar_id_number, 'consultation_needed', 'A consultation is needed for your renewal',
        'Please see what is needed in your Renewal tile. ' || coalesce(v_ev ->> 'rule_text', ''), v_rec.id);
    elsif v_new_stage = 'ready_to_endorse' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal is ready for the evaluator',
        'Everything needed is in. The evaluator will review your case and send it to the Division Head for approval.', v_rec.id);
    elsif v_new_stage = 'ready_for_confirmation' and v_old_stage <> 'submitted' and not v_auto then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal is ready for the evaluator',
        'Everything needed is in. The evaluator will confirm your renewal for ' || v_term_label || '.', v_rec.id);
    elsif v_new_stage = 'inc_deadline_passed' then
      null;
    end if;
  end if;

  -- A new document became necessary after the scholar had already applied.
  if v_rec.evaluation <> '{}'::jsonb then
    select coalesce(array_agg(d ->> 'kind'), '{}') into v_old_docs from jsonb_array_elements(v_rec.evaluation -> 'required_documents') d;
    select coalesce(array_agg(d ->> 'kind'), '{}') into v_new_docs from jsonb_array_elements(v_ev -> 'required_documents') d;
    v_labels := null;
    foreach v_doc in array v_new_docs loop
      if not (v_doc = any (v_old_docs)) then
        v_labels := concat_ws(', ', v_labels, (select d ->> 'label' from jsonb_array_elements(v_ev -> 'required_documents') d where d ->> 'kind' = v_doc limit 1));
      end if;
    end loop;
    if v_labels is not null then
      perform public._notify_scholar(v_rec.scholar_id_number, 'document_required', 'A new document is needed', 'Please upload: ' || v_labels || '.', v_rec.id);
    end if;
  end if;

  if v_auto then
    perform public._renewal_auto_confirm(v_rec.id);
  end if;
end;
$$;
revoke all on function public._renewal_recheck(uuid) from public, anon, authenticated;

commit;
