-- undo_refer_not_after_attended.sql: puts back the two referral functions as they were (a referral is also possible after the consultation was attended).

create or replace function public._renewal_can_refer(r public.renewal_records)
returns boolean
language sql
stable
as $$
  select r.stage not in ('renewed', 'removed', 'late_declined', 'returned', 'ready_for_endorsement', 'endorsed_for_approval')
     and (coalesce((r.evaluation ->> 'failed_effective')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'drp')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0) > 0
          or coalesce((r.evaluation ->> 'open_inc')::integer, 0) > 0);
$$;

create or replace function public.renewal_refer_book(p_record_id uuid, p_type text, p_day date, p_half text, p_staff uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  v_label text;
  v_who text;
  v_slot public.counseling_slots%rowtype;
begin
  perform public._renewal_require_evaluator();
  select * into r from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That application was not found.'; end if;
  if not public._renewal_can_refer(r) then raise exception 'Only an application with an INC, a DRP or a failed subject can be referred for a consultation.'; end if;
  if exists (select 1 from public.counseling_slots x where x.record_id = r.id and x.state = 'booked') then
    raise exception 'This scholar already has a consultation booked for this renewal. It can be changed from the Consultations tab or by the scholar.';
  end if;
  perform public._consult_place(r.id, r.scholar_id_number, p_type, p_day, p_half, 'booked', null, p_staff);
  select * into v_slot from public.counseling_slots where record_id = r.id and state = 'booked' order by booked_at desc limit 1;
  v_label := public._renewal_term_label(r.school_year, r.term);
  v_who := public._actor_name();
  perform public._renewal_log(r.id, r.stage, r.stage, 'Referred for consultation by ' || v_who || ': booked for ' || public._manila_slot_text(v_slot.starts_at) || ' with ' || public._staff_display_name(v_slot.staff_id) || '.', v_who);
  perform public._notify_scholar(r.scholar_id_number, 'progress', 'You were referred for a consultation',
    'For your renewal (' || v_label || '), the evaluator referred you for a consultation and booked it for you: ' || public._manila_slot_text(v_slot.starts_at) || ' with ' || public._staff_display_name(v_slot.staff_id)
    || '. You do not need to book your own. If you cannot come, change or cancel it in your Renewal tile at least 12 hours before.', r.id);
end;
$$;

revoke all on function public._renewal_can_refer(public.renewal_records) from public, anon, authenticated;
revoke all on function public.renewal_refer_book(uuid, text, date, text, uuid) from public, anon;
grant execute on function public.renewal_refer_book(uuid, text, date, text, uuid) to authenticated;

notify pgrst, 'reload schema';
