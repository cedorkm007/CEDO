-- ─────────────────────────────────────────────────────────────
-- SCHOLAR-ENTERED GRADES, FILE D: grades inside the application form, and the SDP reconsideration waits for the grades.   Safe to run twice.   Undo: undo_entered_grades_d.sql
-- Run AFTER _a, _b and _c of the entered grades and the SDP reconsideration files (A to D). It replaces functions only; no table is changed; nothing is deleted.
--
--   1. The application form can carry the grades: a scholar whose school has not uploaded the grades enters them (with the screenshot and the tick) while applying, and the
--      application and the entered grades are saved together (renewal_apply with the grades; the older forms of renewal_apply are left as they are and keep working).
--   2. An SDP reconsideration can only be asked for when the scholar's GRADES are in: entered (waiting for the Grades Approver or approved), or uploaded by the school. The database
--      refuses it otherwise, whichever screen asks.
--   3. An SDP reconsideration can only be APPROVED when the grades are complete: approved by the Grades Approver, or uploaded by the school. (Denying is always possible.)
--   4. The approvers' list of reconsiderations also says where the grades stand (school / approved / pending / returned / none).
-- ─────────────────────────────────────────────────────────────

-- Where the scholar's grades for the semester the renewal looks at stand: 'school' (the school uploaded), else the newest entered try: 'approved' | 'pending' | 'returned', else 'none'.
create or replace function public._eg_grades_status(p_scholar text, p_basis_year text, p_basis_term text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.school_period_submissions sp join public.academic_periods ap on ap.id = sp.period_id join public.scholars s on s.school_id = sp.school_id
                 where s.scholar_id_number = p_scholar and ap.school_year = p_basis_year and ap.term = p_basis_term and sp.status = 'submitted') then 'school'
    else coalesce((select e.status from public.renewal_self_grade_submissions e where e.scholar_id_number = p_scholar and e.basis_school_year = p_basis_year and e.basis_term = p_basis_term
                   and e.status <> 'superseded' order by e.submitted_at desc limit 1), 'none') end;
$$;
revoke all on function public._eg_grades_status(text, text, text) from public, anon, authenticated;

-- Complete: the school uploaded, or the Grades Approver approved the entered grades.
create or replace function public._eg_grades_complete(p_scholar text, p_basis_year text, p_basis_term text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public._eg_grades_status(p_scholar, p_basis_year, p_basis_term) in ('school', 'approved'); $$;
revoke all on function public._eg_grades_complete(text, text, text) from public, anon, authenticated;

-- In: complete, or entered and waiting for the Grades Approver.
create or replace function public._eg_grades_available(p_scholar text, p_basis_year text, p_basis_term text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public._eg_grades_status(p_scholar, p_basis_year, p_basis_term) in ('school', 'approved', 'pending'); $$;
revoke all on function public._eg_grades_available(text, text, text) from public, anon, authenticated;

-- The saving of entered grades (it was the body of renewal_self_grades_submit; the application form uses it too, with the folder the images are in while the application is made).
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
    if v_units is null or v_units <= 0 or v_units > 12 then raise exception 'The units of % must be a number from 0.5 to 12.', v_code; end if;
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

create or replace function public.renewal_self_grades_submit(p_record_id uuid, p_lines jsonb, p_files jsonb, p_acknowledged boolean)
returns uuid
language sql
security definer
set search_path = public
as $$ select public._eg_save(p_record_id, p_lines, p_files, p_acknowledged, null); $$;
revoke all on function public.renewal_self_grades_submit(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.renewal_self_grades_submit(uuid, jsonb, jsonb, boolean) to authenticated;

-- A request needs the grades first.
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

-- An approval needs complete grades.
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

-- The approvers' list says where the grades stand (a function cannot change its columns by being created again, so it is dropped first).
drop function if exists public.sdp_reconsideration_list(text, text, integer, integer);
create or replace function public.sdp_reconsideration_list(p_status text default 'pending', p_query text default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  id uuid, scholar_id_number text, name text, school text, program text, year_level text, scholar_status text, school_year text, term text, basis_school_year text, basis_term text,
  status text, lacking jsonb, requested_at timestamptz, decided_at timestamptz, decided_by_label text, decision_note text, record_id uuid, previous jsonb,
  next_school_year text, next_semester text, can_decide boolean, grades_status text, grades_complete boolean, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_decide boolean := public.can_decide_sdp_reconsideration();
begin
  if not (public.can_view_renewals() or v_decide) then raise exception 'Not authorized to view SDP reconsideration requests.'; end if;
  return query
  select r.id, r.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, s.status,
         r.school_year, r.term, r.basis_school_year, r.basis_term, r.status, r.lacking, r.requested_at, r.decided_at, r.decided_by_label, r.decision_note, r.record_id,
         coalesce((select jsonb_agg(jsonb_build_object('school_year', o.school_year, 'term', o.term, 'status', o.status, 'lacking', o.lacking, 'decided_at', o.decided_at) order by o.requested_at desc)
                     from public.sdp_reconsideration_requests o where o.scholar_id_number = r.scholar_id_number and o.id <> r.id), '[]'::jsonb),
         nx.school_year, nx.semester, v_decide and r.status = 'pending', public._eg_grades_status(r.scholar_id_number, r.basis_school_year, r.basis_term), public._eg_grades_complete(r.scholar_id_number, r.basis_school_year, r.basis_term), count(*) over ()
  from public.sdp_reconsideration_requests r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  cross join lateral public._sdp_next_semester(r.basis_school_year, r.basis_term) nx
  where (coalesce(p_status, 'pending') = 'all' or r.status = coalesce(p_status, 'pending'))
    and (v_q is null or r.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by case when r.status = 'pending' then 0 else 1 end, case when r.status = 'pending' then r.requested_at end asc, r.decided_at desc nulls last, r.requested_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.sdp_reconsideration_list(text, text, integer, integer) from public, anon;
grant execute on function public.sdp_reconsideration_list(text, text, integer, integer) to authenticated;

-- Applying WITH the grades (and, if the scholar wants, the SDP reconsideration). p_grade_lines / p_grade_files like renewal_self_grades_submit; the images are uploaded first to
-- <scholar>/<renewal window>/grade-entries/ (the application does not exist yet). Empty grades are fine: the scholar applies and waits for the school's grades (or enters them later).
create or replace function public.renewal_apply(p_window_id uuid, p_school text, p_program text, p_year_level text, p_note text, p_request_sdp_reconsideration boolean,
                                                p_grade_lines jsonb, p_grade_files jsonb, p_grade_ack boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  w public.renewal_windows%rowtype;
  v_record uuid;
  v_entering boolean := jsonb_typeof(coalesce(p_grade_lines, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(p_grade_lines, '[]'::jsonb)) > 0;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into w from public.renewal_windows where id = p_window_id;
  if not found then raise exception 'That renewal window was not found.'; end if;
  if (v_entering or coalesce(p_request_sdp_reconsideration, false))
     and exists (select 1 from public.renewal_records r where r.scholar_id_number = v_id and r.school_year = w.school_year and r.term = w.term) then
    raise exception 'You can enter your grades or ask for an SDP reconsideration together with the application only when you first apply. After that, use your renewal page.';
  end if;
  v_record := public.renewal_apply(p_window_id, p_school, p_program, p_year_level, p_note);
  if v_entering then
    perform public._eg_save(v_record, p_grade_lines, p_grade_files, p_grade_ack, v_id || '/' || p_window_id::text || '/grade-entries/');
  end if;
  if coalesce(p_request_sdp_reconsideration, false) then
    perform public._renewal_sdp_request_create(v_record);
  end if;
  perform public._renewal_recheck(v_record);
  return v_record;
end;
$$;
revoke all on function public.renewal_apply(uuid, text, text, text, text, boolean, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.renewal_apply(uuid, text, text, text, text, boolean, jsonb, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
