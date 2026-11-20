-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_booking_referred_by.sql
-- CONSULTATION TOOL > APPOINTMENTS > a booked appointment's pop-up: "Referred by: <name>".
-- Safe to run twice.   Undo: undo_consultation_booking_referred_by.sql   (It adds ONE read-only function; it changes and deletes no record.)
--
--   * counseling_slot_referrer(slot): who referred the scholar for this appointment. A scholar can be referred for a consultation by the Scholar Renewal evaluator or by Scholar Management staff
--     (they choose the reason; the scholar books the time). When the appointment was booked from such a referral, this gives that staff member's name. An appointment the scholar booked for
--     their own renewal has no referrer: the answer is empty and the pop-up shows no "Referred by" line.
--     Only consultation staff can ask, and only about their own appointments (the ones they see on their calendar), like counseling_slot_scholar_info.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.counseling_slot_scholar_info(uuid)') is null or to_regprocedure('public._staff_display_name(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_consultation_booking_details.sql and the Scholar Renewal appointment files first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'counseling_slots' and column_name = 'referral_id') then
    raise exception 'STOPPED, nothing changed: run the consultation referral files (supabase_migration_referral_reason_a/b/c) first.';
  end if;
end $$;

create or replace function public.counseling_slot_referrer(p_slot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.counseling_slots%rowtype;
  v_name text;
begin
  perform public._require_counseling_staff();
  select * into s from public.counseling_slots where id = p_slot_id and staff_id = auth.uid() and state <> 'open';
  if not found then raise exception 'That appointment was not found.'; end if;
  if s.referral_id is not null then
    select nullif(btrim(public._staff_display_name(f.referred_by)), '') into v_name from public.scholar_counseling_referrals f where f.id = s.referral_id;
  end if;
  return jsonb_build_object('referred_by', v_name);
end;
$$;
revoke all on function public.counseling_slot_referrer(uuid) from public, anon;
grant execute on function public.counseling_slot_referrer(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
