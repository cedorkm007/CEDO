-- ─────────────────────────────────────────────────────────────
-- SCHOLAR RENEWAL: REVERT THE TEST DATA.   Run it TWICE:  first as it is (a DRY RUN: it only counts what it WOULD remove), then with 'YES' (it removes).
--
-- WHAT IT REMOVES (and only this), judged from the check you sent:
--   • the applications of the TEST accounts (the testers of the testers-only window) with their history lines, documents and INC items;
--   • the consultation bookings, the consultation referrals and the Daily Records that the test applications made (only those linked to a test application);
--   • the certificate record(s) of those test applications and the certificate counter of that term (so the first real certificate is number 1 again);
--   • every renewal notice sent to scholars (the "Renewal is now open" alerts that reached everyone, and the test accounts' notices), and the "already told"
--     marks, so a real opening later sends fresh alerts;
--   • the staff bell notices about renewals, the queued push messages and the log of Excel downloads made during the test.
-- WHAT IT KEEPS: the renewal window itself (and its list of testers), every scholar record and status, the status history, the consultation availability staff set,
--   study plan templates, devices registered for push messages. A scholar's status (for example Removed or Probationary) is NOT put back by this file: if the test
--   changed a test account's status, set it by hand in the Scholars tool.
-- SAFETY: it STOPS (and changes nothing) if it finds an application, a certificate, a booking, a Daily Record or a referral that belongs to anyone but the test accounts
--   (a booking, referral or Daily Record is a test account's only if it hangs on one of the test applications).
--   Before it removes anything it COPIES every row it is about to remove into a locked holding table (public._renewal_test_backup), so it can be put back.
--   After a successful run it lists the certificate FILE(S) to delete by hand in the Supabase dashboard (Storage > csr-issued): a database script cannot delete files.
-- Choose "Run without RLS" if asked.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_confirm text := 'NO';     -- <<<<<  CHANGE 'NO' TO 'YES' (keep the quotes) for the second run, the one that removes
  v_testers text[];
  v_ids uuid[];
  v_bad bigint;
  v_n bigint;
  v_kinds text[] := array['application_received', 'application_returned', 'booking_cancelled', 'booking_confirmed', 'consultation_needed', 'csr_ready', 'deadline_extended',
                          'document_approved', 'document_required', 'document_returned', 'inc_deadline_set', 'inc_letter', 'inc_letter_approved', 'inc_reminder', 'late_accepted',
                          'late_declined', 'no_show', 'on_hold', 'progress', 'reminder_day', 'reminder_hour', 'renewal_confirmed', 'rescheduled', 'slot_removed', 'study_plan',
                          'study_plan_approved', 'study_plan_returned', 'window_closing', 'window_open'];
  v_terms jsonb;
  f record;
begin
  drop table if exists pg_temp._rv;
  create temp table _rv (n serial, step text, what text, rows bigint);

  -- ── who the test accounts are, and what is theirs ──
  select coalesce(array_agg(distinct t), '{}') into v_testers from public.renewal_windows w, unnest(w.testers) t where w.testers is not null;
  select coalesce(array_agg(r.id), '{}') into v_ids from public.renewal_records r
    join public.renewal_windows w on w.id = r.window_id where w.testers is not null and r.scholar_id_number = any (v_testers);
  insert into _rv (step, what, rows) values ('0. TEST ACCOUNTS', array_to_string(v_testers, ', '), cardinality(v_testers));

  -- ── stop if anything that is NOT a test account's is involved ──
  select count(*) into v_bad from public.renewal_records r where not (r.id = any (v_ids));
  if v_bad > 0 then raise exception 'STOPPED, nothing changed: % application(s) do not belong to the test accounts of a testers-only window. Tell me, do not run this.', v_bad; end if;
  select count(*) into v_bad from public.csr_issued c where not (c.scholar_id_number = any (v_testers));
  if v_bad > 0 then raise exception 'STOPPED, nothing changed: % certificate(s) belong to someone who is not a test account.', v_bad; end if;
  select count(*) into v_bad from public.counseling_slots s where s.state <> 'open' and s.record_id is not null and not (s.record_id = any (v_ids));
  if v_bad > 0 then raise exception 'STOPPED, nothing changed: % consultation booking(s) are linked to a renewal that is not a test account''s. Tell me, do not run this.', v_bad; end if;
  select count(*) into v_bad from public.scholar_counseling_referrals where renewal_record_id is not null and not (renewal_record_id = any (v_ids));
  if v_bad > 0 then raise exception 'STOPPED, nothing changed: % referral(s) are linked to a renewal that is not a test account''s. Tell me, do not run this.', v_bad; end if;
  select count(*) into v_bad from public.scholar_counseling_records where renewal_record_id is not null and not (renewal_record_id = any (v_ids));
  if v_bad > 0 then raise exception 'STOPPED, nothing changed: % Daily Record(s) are linked to a renewal that is not a test account''s. Tell me, do not run this.', v_bad; end if;

  -- ── what would be removed ──
  insert into _rv (step, what, rows) values
    ('1. REMOVE', 'applications of the test accounts', cardinality(v_ids)),
    ('1. REMOVE', 'their history lines', (select count(*) from public.renewal_history where record_id = any (v_ids))),
    ('1. REMOVE', 'their documents', (select count(*) from public.renewal_documents where record_id = any (v_ids))),
    ('1. REMOVE', 'their INC items', (select count(*) from public.renewal_inc_items where record_id = any (v_ids))),
    ('1. REMOVE', 'consultation bookings of the test applications (a booking made by the new booking system is deleted)', (select count(*) from public.counseling_slots s where s.record_id = any (v_ids)
        and ((to_jsonb(s) ->> 'consult_type') is not null or (to_jsonb(s) ->> 'referral_id') is not null))),
    ('1. REMOVE', 'consultation time slots of the test applications (a ready-made time slot of the older system is made open again, not deleted)', (select count(*) from public.counseling_slots s where s.record_id = any (v_ids)
        and (to_jsonb(s) ->> 'consult_type') is null and (to_jsonb(s) ->> 'referral_id') is null)),
    ('1. REMOVE', 'booking history lines of the test applications', (select count(*) from public.counseling_booking_history where record_id = any (v_ids))),
    ('1. REMOVE', 'consultation referrals of the test applications', (select count(*) from public.scholar_counseling_referrals where renewal_record_id = any (v_ids))),
    ('1. REMOVE', 'Daily Records of the test applications', (select count(*) from public.scholar_counseling_records where renewal_record_id = any (v_ids))),
    ('1. REMOVE', 'certificate records of the test accounts', (select count(*) from public.csr_issued where scholar_id_number = any (v_testers))),
    ('1. REMOVE', 'certificate counters of the terms of those certificates', (select count(*) from public.csr_counters k where exists (select 1 from public.csr_issued c where c.school_year = k.school_year and c.term = k.term))),
    ('1. REMOVE', 'notices sent to scholars about the renewal', (select count(*) from public.scholar_notifications where kind = any (v_kinds) or record_id is not null)),
    ('1. REMOVE', '"already told" marks', (select count(*) from public.renewal_notice_log)),
    ('1. REMOVE', 'staff bell notices about renewals', (select count(*) from public.notifications where type = 'renewal')),
    ('1. REMOVE', 'queued / sent push messages', (select count(*) from public.push_outbox)),
    ('1. REMOVE', 'Excel download log lines', (select count(*) from public.renewal_export_log));
  insert into _rv (step, what, rows) values ('1. KEPT', 'notices to scholars of a kind that is not a renewal one (left alone)', (select count(*) from public.scholar_notifications where not (kind = any (v_kinds) or record_id is not null)));
  for f in select c.csr_number, c.storage_path from public.csr_issued c where c.scholar_id_number = any (v_testers) and c.storage_path is not null loop
    insert into _rv (step, what, rows) values ('2. FILE TO DELETE BY HAND (Storage > csr-issued)', f.storage_path, 1);
  end loop;

  if v_confirm <> 'YES' then
    insert into _rv (step, what, rows) values ('RESULT', 'DRY RUN: nothing was changed. If these numbers are what you expect, change ''NO'' to ''YES'' at the top and run again.', 0);
    return;
  end if;

  -- ── copy everything that is about to go into a locked holding table ──
  create table if not exists public._renewal_test_backup (id bigserial primary key, table_name text not null, row_data jsonb not null, saved_at timestamptz not null default now());
  alter table public._renewal_test_backup enable row level security;
  revoke all on public._renewal_test_backup from anon, authenticated;
  insert into public._renewal_test_backup (table_name, row_data)
    select 'renewal_records', to_jsonb(x) from public.renewal_records x where x.id = any (v_ids)
    union all select 'renewal_history', to_jsonb(x) from public.renewal_history x where x.record_id = any (v_ids)
    union all select 'renewal_documents', to_jsonb(x) from public.renewal_documents x where x.record_id = any (v_ids)
    union all select 'renewal_inc_items', to_jsonb(x) from public.renewal_inc_items x where x.record_id = any (v_ids)
    union all select 'renewal_inc_extensions', to_jsonb(x) from public.renewal_inc_extensions x where x.item_id in (select i.id from public.renewal_inc_items i where i.record_id = any (v_ids))
    union all select 'counseling_slots', to_jsonb(x) from public.counseling_slots x where x.record_id = any (v_ids)
    union all select 'counseling_booking_history', to_jsonb(x) from public.counseling_booking_history x where x.record_id = any (v_ids)
    union all select 'scholar_counseling_referrals', to_jsonb(x) from public.scholar_counseling_referrals x where x.renewal_record_id = any (v_ids)
    union all select 'scholar_counseling_records', to_jsonb(x) from public.scholar_counseling_records x where x.renewal_record_id = any (v_ids)
    union all select 'csr_issued', to_jsonb(x) from public.csr_issued x where x.scholar_id_number = any (v_testers)
    union all select 'csr_counters', to_jsonb(k) from public.csr_counters k where exists (select 1 from public.csr_issued c where c.school_year = k.school_year and c.term = k.term)
    union all select 'scholar_notifications', to_jsonb(x) from public.scholar_notifications x where x.kind = any (v_kinds) or x.record_id is not null
    union all select 'renewal_notice_log', to_jsonb(x) from public.renewal_notice_log x
    union all select 'notifications', to_jsonb(x) from public.notifications x where x.type = 'renewal'
    union all select 'push_outbox', to_jsonb(x) from public.push_outbox x
    union all select 'renewal_export_log', to_jsonb(x) from public.renewal_export_log x;
  select count(*) into v_n from public._renewal_test_backup;
  insert into _rv (step, what, rows) values ('3. BACKED UP', 'rows copied to public._renewal_test_backup (locked table)', v_n);

  -- ── remove ──
  select coalesce(jsonb_agg(distinct jsonb_build_object('y', c.school_year, 't', c.term)), '[]'::jsonb) into v_terms from public.csr_issued c where c.scholar_id_number = any (v_testers);
  delete from public.csr_issued where scholar_id_number = any (v_testers);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'certificate records', v_n);
  delete from public.csr_counters k where exists (select 1 from jsonb_array_elements(v_terms) j where j ->> 'y' = k.school_year and j ->> 't' = k.term)
    and not exists (select 1 from public.csr_issued c where c.school_year = k.school_year and c.term = k.term);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'certificate counters', v_n);
  delete from public.counseling_slots s where s.record_id = any (v_ids) and ((to_jsonb(s) ->> 'consult_type') is not null or (to_jsonb(s) ->> 'referral_id') is not null);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'consultation bookings', v_n);
  update public.counseling_slots set state = 'open', record_id = null, scholar_id_number = null, booked_at = null, marked_by = null, marked_at = null, reminded_day_at = null, reminded_hour_at = null,
    daily_record_id = null where record_id = any (v_ids);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'consultation time slots made open again', v_n);
  delete from public.scholar_counseling_referrals where renewal_record_id = any (v_ids);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'consultation referrals', v_n);
  delete from public.scholar_counseling_records where renewal_record_id = any (v_ids);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'Daily Records', v_n);
  delete from public.renewal_records where id = any (v_ids);
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'applications (their history, documents, INC items and booking history go with them)', v_n);
  delete from public.renewal_notice_log;
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', '"already told" marks', v_n);
  delete from public.scholar_notifications where kind = any (v_kinds) or record_id is not null;
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'notices to scholars', v_n);
  delete from public.notifications where type = 'renewal';
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'staff bell notices about renewals', v_n);
  delete from public.push_outbox;
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'push messages', v_n);
  delete from public.renewal_export_log;
  get diagnostics v_n = row_count; insert into _rv (step, what, rows) values ('4. REMOVED', 'Excel download log lines', v_n);

  insert into _rv (step, what, rows) values ('RESULT', 'DONE. The test data is removed. Delete the certificate file(s) listed above by hand. The copy is in public._renewal_test_backup until you drop it (renewal_test_data_drop_backup.sql).', 0);
end $$;

select step, what, rows from _rv order by n;
