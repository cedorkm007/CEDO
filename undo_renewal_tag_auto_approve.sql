-- ─────────────────────────────────────────────────────────────
-- undo_renewal_tag_auto_approve.sql
-- Removes the auto-approve option: the approvers' functions, the grades save, the SDP request and the tag functions go back as they were. The auto-approve choice on the tags is dropped
-- (the scholars stay tagged). Whatever was approved automatically stays approved.
-- ─────────────────────────────────────────────────────────────

begin;

create or replace function public.renewal_self_grades_decide(p_submission_id uuid, p_approve boolean, p_note text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.renewal_self_grade_submissions%rowtype;
  v_note text := left(btrim(coalesce(p_note, '')), 1000);
  v_label text;
  v_term text;
  v_stage text;
  ev jsonb;
  v_result text;
begin
  if not public.can_approve_scholar_grades() then raise exception 'Only a Grades Approver can approve or return entered grades.'; end if;
  select * into s from public.renewal_self_grade_submissions where id = p_submission_id for update;
  if not found then raise exception 'That submission was not found.'; end if;
  if s.status <> 'pending' then raise exception 'This submission was already decided or replaced.'; end if;
  if not coalesce(p_approve, false) and v_note = '' then raise exception 'Please write the reason for returning the grades, so the scholar can correct them.'; end if;
  v_label := public._actor_name();
  v_term := public._renewal_term_label(s.basis_school_year, s.basis_term);
  select stage into v_stage from public.renewal_records where id = s.record_id;
  update public.renewal_self_grade_submissions set status = case when coalesce(p_approve, false) then 'approved' else 'returned' end, decided_by = auth.uid(), decided_by_label = v_label, decided_at = now(), decision_note = v_note
    where id = s.id;
  if coalesce(p_approve, false) then
    perform public._notify_scholar(s.scholar_id_number, 'grades_entry_approved', 'The grades you entered were approved',
      'The Grades Approver approved the grades you entered for ' || v_term || '. They count as your complete grades for the renewal until your school uploads its own.' || case when v_note <> '' then ' Note: ' || v_note else '' end, s.record_id);
    v_result := 'approved';
  else
    perform public._notify_scholar(s.scholar_id_number, 'grades_entry_returned', 'Please correct the grades you entered',
      'The Grades Approver returned the grades you entered for ' || v_term || '. Reason: ' || v_note || ' Please enter them again.', s.record_id);
    v_result := 'returned';
  end if;
  perform public._renewal_log(s.record_id, v_stage, v_stage, case when coalesce(p_approve, false) then 'Entered grades approved (try ' || s.version || ').' else 'Entered grades returned: ' || v_note end, v_label);
  perform public._renewal_recheck(s.record_id);
  perform public._renewal_scholar_list_refresh_one(s.scholar_id_number, s.school_year, s.term);
  if v_result = 'approved' then
    ev := public._renewal_evaluate(s.scholar_id_number, s.school_year, s.term);
    if (ev -> 'grades' ->> 'state') = 'review' and (ev -> 'grades' ->> 'reason') ilike '%passing mark%' then v_result := 'approved_needs_setup'; end if;
  end if;
  return v_result;
end;
$$;
revoke all on function public.renewal_self_grades_decide(uuid, boolean, text) from public, anon;
grant execute on function public.renewal_self_grades_decide(uuid, boolean, text) to authenticated;

create or replace function public.renewal_sdp_reconsideration_decide(p_request_id uuid, p_approve boolean, p_note text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sdp_reconsideration_requests%rowtype;
  v_note text := left(btrim(coalesce(p_note, '')), 1000);
  v_c record;
  v_req jsonb;
  v_lack jsonb;
  v_total integer;
  v_next record;
  v_cat text;
  v_n integer;
  v_text text;
  v_term_label text;
  v_basis_label text;
  v_next_label text;
  v_label text;
  v_stage text;
begin
  if not public.can_decide_sdp_reconsideration() then raise exception 'Only it.admin1 or an appointed approver can decide SDP reconsideration requests.'; end if;
  select * into r from public.sdp_reconsideration_requests where id = p_request_id for update;
  if not found then raise exception 'That request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already decided.'; end if;
  if not coalesce(p_approve, false) and v_note = '' then raise exception 'Please write the reason for denying the request.'; end if;
  v_label := public._actor_name();
  v_term_label := public._renewal_term_label(r.school_year, r.term);
  v_basis_label := public._renewal_term_label(r.basis_school_year, r.basis_term);
  -- what is lacking NOW (credits may have come in since the request was made)
  select * into v_c from public._sdp_compliance(r.basis_school_year, r.basis_term, r.scholar_id_number) limit 1;
  v_req := public._sdp_required_map(r.scholar_id_number, r.basis_school_year, r.basis_term);
  v_lack := jsonb_build_object(
    'community_service', greatest(0, (v_req ->> 'community_service')::integer - coalesce(v_c.community_service, 0)),
    'community_volunteerism', greatest(0, (v_req ->> 'community_volunteerism')::integer - coalesce(v_c.community_volunteerism, 0)),
    'formation_program', greatest(0, (v_req ->> 'formation_program')::integer - coalesce(v_c.formation_program, 0)));
  v_total := (v_lack ->> 'community_service')::integer + (v_lack ->> 'community_volunteerism')::integer + (v_lack ->> 'formation_program')::integer;
  select n.school_year, n.semester into v_next from public._sdp_next_semester(r.basis_school_year, r.basis_term) n;
  v_next_label := public._renewal_term_label(v_next.school_year, v_next.semester);
  v_text := public._sdp_lacking_text(v_lack);
  select stage into v_stage from public.renewal_records where id = r.record_id;

  if v_total = 0 then
    update public.sdp_reconsideration_requests set status = 'not_needed', decided_by = auth.uid(), decided_by_label = v_label, decided_at = now(),
      decision_note = 'The SDP credits became complete before the request was decided, so no reconsideration was needed.' where id = r.id;
    perform public._notify_scholar(r.scholar_id_number, 'sdp_reconsideration_closed', 'No SDP reconsideration needed',
      'Your SDP credits for ' || v_basis_label || ' are now complete, so your reconsideration request is closed and nothing is added to your next SDP requirement.', r.record_id);
    v_text := 'not_needed';
  elsif coalesce(p_approve, false) then
    if not public._eg_grades_complete(r.scholar_id_number, r.basis_school_year, r.basis_term) then
      raise exception 'The scholar''s grades are not complete yet. Approve the SDP reconsideration after the Grades Approver has approved the grades the scholar entered, or the school has uploaded them.';
    end if;
    update public.sdp_reconsideration_requests set status = 'approved', lacking = v_lack, decided_by = auth.uid(), decided_by_label = v_label, decided_at = now(), decision_note = v_note where id = r.id;
    foreach v_cat in array array['community_service', 'community_volunteerism', 'formation_program'] loop
      v_n := (v_lack ->> v_cat)::integer;
      if v_n > 0 then
        insert into public.sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester)
        values (r.id, r.scholar_id_number, v_cat, v_n, v_next.school_year, v_next.semester);
      end if;
    end loop;
    perform public._notify_scholar(r.scholar_id_number, 'sdp_reconsideration_approved', 'Your SDP reconsideration was approved',
      'Your SDP reconsideration for ' || v_term_label || ' was approved. You are treated as complied with the SDP for ' || v_basis_label || '. The credits that were lacking (' || v_text
      || ') are added to your SDP requirement for ' || v_next_label || '.' || case when v_note <> '' then ' Note: ' || v_note else '' end, r.record_id);
    v_text := 'approved';
  else
    update public.sdp_reconsideration_requests set status = 'denied', decided_by = auth.uid(), decided_by_label = v_label, decided_at = now(), decision_note = v_note where id = r.id;
    perform public._notify_scholar(r.scholar_id_number, 'sdp_reconsideration_denied', 'Your SDP reconsideration was not approved',
      'Your SDP reconsideration for ' || v_term_label || ' was not approved. Reason: ' || v_note || ' Your renewal stays on hold until the missing SDP credits (' || v_text || ') are recorded.', r.record_id);
    v_text := 'denied';
  end if;
  if r.record_id is not null then
    perform public._renewal_log(r.record_id, v_stage, v_stage,
      case v_text when 'approved' then 'SDP reconsideration approved: treated as complied for ' || v_basis_label || '; the lacking credits are added to ' || v_next_label || '.'
                  when 'denied' then 'SDP reconsideration denied: ' || v_note
                  else 'SDP reconsideration closed: the SDP credits are now complete.' end, v_label);
    perform public._renewal_recheck(r.record_id);
  end if;
  perform public._renewal_scholar_list_refresh_one(r.scholar_id_number, r.school_year, r.term);
  return v_text;
end;
$$;
revoke all on function public.renewal_sdp_reconsideration_decide(uuid, boolean, text) from public, anon;
grant execute on function public.renewal_sdp_reconsideration_decide(uuid, boolean, text) to authenticated;

create or replace function public._eg_save(p_record_id uuid, p_lines jsonb, p_files jsonb, p_acknowledged boolean, p_extra_prefix text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  rec public.renewal_records%rowtype;
  v_why text;
  v_ver integer;
  v_sub uuid;
  l jsonb;
  f jsonb;
  v_code text; v_name text; v_grade text; v_units numeric;
  v_seen text[] := '{}';
  v_prefix text;
  v_n integer;
  v_label text;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into rec from public.renewal_records where id = p_record_id and scholar_id_number = v_id;
  if not found then raise exception 'That application was not found.'; end if;
  v_why := public._eg_cannot_enter(p_record_id);
  if v_why is not null then raise exception '%', v_why; end if;
  if not coalesce(p_acknowledged, false) then raise exception 'Please tick the box to say you understand that wrong or false information means disciplinary action or removal from the scholarship.'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Enter at least one subject.'; end if;
  if jsonb_array_length(p_lines) > 25 then raise exception 'You can enter at most 25 subjects.'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_code := btrim(coalesce(l ->> 'code', '')); v_name := btrim(coalesce(l ->> 'subject', '')); v_grade := btrim(coalesce(l ->> 'grade', ''));
    if v_code = '' or v_name = '' or v_grade = '' then raise exception 'Every subject needs a subject code, a subject name and a grade.'; end if;
    if char_length(v_code) > 30 or char_length(v_name) > 150 or char_length(v_grade) > 12 then raise exception 'A subject code, name or grade is too long.'; end if;
    begin v_units := (l ->> 'units')::numeric; exception when others then v_units := null; end;
    if v_units is null or v_units <= 0 or v_units > 20 then raise exception 'The units of % must be a number from 0.5 to 20.', v_code; end if;
    if upper(v_code) = any (v_seen) then raise exception 'The subject code % is listed twice.', v_code; end if;
    v_seen := v_seen || upper(v_code);
  end loop;
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 then raise exception 'Upload at least one screenshot or image of your grades.'; end if;
  if jsonb_array_length(p_files) > 5 then raise exception 'You can upload at most 5 images.'; end if;
  v_prefix := v_id || '/' || p_record_id::text || '/grade-entries/';
  for f in select * from jsonb_array_elements(p_files) loop
    if left(coalesce(f ->> 'path', ''), char_length(v_prefix)) <> v_prefix and (p_extra_prefix is null or left(coalesce(f ->> 'path', ''), char_length(p_extra_prefix)) <> p_extra_prefix) then raise exception 'An image is not in your own folder. Please upload it again.'; end if;
    if coalesce(f ->> 'mime', '') not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Only JPG, PNG or WEBP images can be uploaded.'; end if;
    if coalesce((f ->> 'size')::bigint, 0) <= 0 or (f ->> 'size')::bigint > 10485760 then raise exception 'An image is too big (10 MB at most).'; end if;
  end loop;

  select coalesce(max(version), 0) + 1 into v_ver from public.renewal_self_grade_submissions where record_id = p_record_id;
  update public.renewal_self_grade_submissions set status = 'superseded' where record_id = p_record_id and status in ('pending', 'returned');
  insert into public.renewal_self_grade_submissions (record_id, scholar_id_number, school_year, term, basis_school_year, basis_term, version, acknowledged_at)
  values (rec.id, rec.scholar_id_number, rec.school_year, rec.term, rec.basis_school_year, rec.basis_term, v_ver, now())
  returning id into v_sub;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.renewal_self_grade_lines (submission_id, subject_code, subject, units, grade)
    values (v_sub, btrim(l ->> 'code'), btrim(l ->> 'subject'), (l ->> 'units')::numeric, btrim(l ->> 'grade'));
  end loop;
  for f in select * from jsonb_array_elements(p_files) loop
    insert into public.renewal_self_grade_files (submission_id, storage_path, file_name, mime_type, size_bytes)
    values (v_sub, f ->> 'path', left(coalesce(f ->> 'name', 'image'), 200), f ->> 'mime', (f ->> 'size')::bigint);
  end loop;
  v_n := jsonb_array_length(p_lines);
  v_label := public._renewal_term_label(rec.basis_school_year, rec.basis_term);
  perform public._notify_scholar(v_id, 'grades_entry_submitted', 'Your grades were sent for approval',
    'You entered ' || v_n || ' subject' || case when v_n = 1 then '' else 's' end || ' for ' || v_label || '. The Grades Approver will check them against your screenshot. Until then your renewal waits. When your school uploads its grades, they replace the ones you entered.', rec.id);
  perform public._eg_notify_approvers('Entered grades to approve', public._renewal_scholar_label(v_id) || ' entered ' || v_n || ' subject' || case when v_n = 1 then '' else 's' end || ' for ' || v_label || '.', rec.id, public._renewal_scholar_label(v_id));
  perform public._renewal_log(rec.id, rec.stage, rec.stage, 'The scholar entered grades for ' || v_label || ' (try ' || v_ver || ') and sent them for approval.', 'Scholar');
  perform public._renewal_recheck(rec.id);
  return v_sub;
end;
$$;
revoke all on function public._eg_save(uuid, jsonb, jsonb, boolean, text) from public, anon, authenticated;

create or replace function public._renewal_sdp_request_create(p_record_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.renewal_records%rowtype;
  ev jsonb;
  s jsonb;
  v_lack jsonb;
  v_id uuid;
  v_basis_label text;
  v_next_label text;
  v_text text;
begin
  select * into rec from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That application was not found.'; end if;
  if exists (select 1 from public.sdp_reconsideration_requests r where r.scholar_id_number = rec.scholar_id_number and r.school_year = rec.school_year and r.term = rec.term) then
    raise exception 'You already asked for an SDP reconsideration for this term.';
  end if;
  -- the grades come first: a request needs the scholar's grades entered (or the school's grades in)
  if not public._eg_grades_available(rec.scholar_id_number, rec.basis_school_year, rec.basis_term) then
    raise exception 'Enter your grades first. You can ask for an SDP reconsideration only after your grades are entered (or your school has uploaded them).';
  end if;
  ev := public._renewal_evaluate(rec.scholar_id_number, rec.school_year, rec.term);
  s := ev -> 'sdp';
  if not coalesce((s ->> 'applicable')::boolean, false) then raise exception 'There is no SDP requirement for this term, so there is nothing to reconsider.'; end if;
  if coalesce((s ->> 'complied')::boolean, false) then raise exception 'Your SDP credits are complete, so there is nothing to reconsider.'; end if;
  v_lack := s -> 'lacking';
  if coalesce((v_lack ->> 'community_service')::integer, 0) + coalesce((v_lack ->> 'community_volunteerism')::integer, 0) + coalesce((v_lack ->> 'formation_program')::integer, 0) = 0 then
    raise exception 'No lacking SDP credits were found, so there is nothing to reconsider.';
  end if;
  insert into public.sdp_reconsideration_requests (scholar_id_number, school_year, term, record_id, basis_school_year, basis_term, lacking)
  values (rec.scholar_id_number, rec.school_year, rec.term, rec.id, rec.basis_school_year, rec.basis_term, v_lack)
  returning id into v_id;
  v_text := public._sdp_lacking_text(v_lack);
  v_basis_label := public._renewal_term_label(rec.basis_school_year, rec.basis_term);
  v_next_label := public._renewal_term_label(s ->> 'next_school_year', s ->> 'next_semester');
  perform public._notify_scholar(rec.scholar_id_number, 'sdp_reconsideration_requested', 'Your SDP reconsideration request was sent',
    'You asked for an SDP reconsideration with your renewal for ' || public._renewal_term_label(rec.school_year, rec.term) || '. Lacking: ' || v_text
    || '. If it is approved, you will be treated as complied with the SDP for ' || v_basis_label || ', and these lacking credits will be added to your SDP requirement for ' || v_next_label
    || '. We will tell you the decision.', rec.id);
  perform public._sdp_reconsideration_notify_approvers('SDP reconsideration requested', public._renewal_scholar_label(rec.scholar_id_number) || ' asked for an SDP reconsideration (' || v_text || ').', rec.id, public._renewal_scholar_label(rec.scholar_id_number));
  perform public._renewal_log(rec.id, rec.stage, rec.stage, 'SDP reconsideration requested (' || v_text || ').', 'Scholar');
  return v_id;
end;
$$;
revoke all on function public._renewal_sdp_request_create(uuid) from public, anon, authenticated;

drop function if exists public.renewal_tag_scholars(text, text, text[], boolean);
drop function if exists public.renewal_tagged_list(text, text, text, integer, integer);
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

drop function if exists public._tag_auto_approve_pending(text, text, text);
drop function if exists public._tag_auto_decide_sdp(uuid);
drop function if exists public._tag_auto_approve_submission(uuid);
drop function if exists public._tag_is_auto_approve(text, text, text);
drop function if exists public._sdp_decide_core(uuid, boolean, text, text, uuid);
drop function if exists public._eg_decide_core(uuid, boolean, text, text, uuid);
alter table public.renewal_tagged_scholars drop column if exists auto_approve;

commit;
