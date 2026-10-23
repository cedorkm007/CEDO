-- ─────────────────────────────────────────────────────────────
-- SCHOLAR RENEWAL: WHAT TEST DATA IS THERE?   READ-ONLY.   Nothing is changed or deleted.
--
-- Why: before anything is reverted I need to see exactly what the testing left behind, and whether any REAL scholar (not a test account) has data in the
-- renewal, so the revert only removes what you confirm. Choose "Run without RLS" if asked (it only makes a temporary table that disappears by itself).
-- Send me the result: use "Export" (CSV) or copy all rows.
-- Personal details are NOT in the result: Scholar ID numbers, stages, counts and dates only (no names, no files' contents).
-- ─────────────────────────────────────────────────────────────
drop table if exists pg_temp._rt;
create temp table _rt (n serial, part text, item text, value text);

do $$
declare
  w record;
  r record;
begin
  -- 1. The renewal windows: who each one is for, and how many applications it holds.
  begin
    for w in select * from public.renewal_windows order by opens_on loop
      insert into _rt (part, item, value) values ('1. WINDOW', w.term || ' ' || w.school_year,
        'opens ' || w.opens_on || ', closes ' || w.closes_on || ' | ' || case when w.testers is null then 'OPEN TO EVERYONE' else 'TESTERS ONLY (' || cardinality(w.testers) || ' scholars: ' || array_to_string(w.testers, ', ') || ')' end
        || ' | applications: ' || (select count(*) from public.renewal_records x where x.window_id = w.id)
        || case when w.testers is not null then ' (from people NOT on the testers list: ' || (select count(*) from public.renewal_records x where x.window_id = w.id and not (x.scholar_id_number = any (w.testers))) || ')' else '' end);
    end loop;
  exception when others then insert into _rt (part, item, value) values ('ERROR', '1. windows', sqlerrm); end;

  -- 2. The applications themselves: the Scholar IDs and where each stands.
  begin
    for r in
      select x.school_year || ' ' || x.term as term, count(*) as c, string_agg(x.scholar_id_number || ' [' || x.stage || ']', ', ' order by x.scholar_id_number) as ids
      from public.renewal_records x group by x.school_year, x.term order by 1
    loop
      insert into _rt (part, item, value) values ('2. APPLICATIONS', r.term || ' (' || r.c || ')', left(r.ids, 3000));
    end loop;
  exception when others then insert into _rt (part, item, value) values ('ERROR', '2. applications', sqlerrm); end;

  -- 3. Status changes the renewal made to scholars (these are what a revert has to undo): who, from what, to what, when.
  begin
    for r in
      select h.scholar_id_number, h.previous_status, h.status, h.source, h.is_temporary, h.changed_at, s.status as now_status
      from public.scholar_status_history h join public.scholars s on s.scholar_id_number = h.scholar_id_number
      where h.source in ('renewal', 'referral', 'removal', 'counseling_record')
        and h.changed_at >= coalesce((select min(created_at) from public.renewal_windows), now())
      order by h.changed_at
    loop
      insert into _rt (part, item, value) values ('3. STATUS CHANGES', r.scholar_id_number,
        coalesce(r.previous_status, '?') || ' -> ' || r.status || case when r.is_temporary then ' (temporary)' else '' end || ' | by ' || r.source || ' | ' || to_char(r.changed_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') || ' | now: ' || r.now_status);
    end loop;
  exception when others then insert into _rt (part, item, value) values ('ERROR', '3. status changes', sqlerrm); end;

  -- 4. Consultation: the availability ranges, the bookings by state, the Daily Records made from attended consultations.
  begin
    insert into _rt (part, item, value) values
      ('4. CONSULTATION', 'availability ranges (all / not started yet)', (select count(*) || ' / ' || count(*) filter (where starts_at > now()) from public.counseling_availability)),
      ('4. CONSULTATION', 'bookings by state', coalesce((select string_agg(state || ': ' || c, ', ' order by state) from (select state, count(*) c from public.counseling_slots group by state) q), 'none')),
      ('4. CONSULTATION', 'booking history rows', (select count(*)::text from public.counseling_booking_history)),
      ('4. CONSULTATION', 'Daily Records made from a renewal consultation', (select count(*)::text from public.scholar_counseling_records where renewal_record_id is not null)),
      ('4. CONSULTATION', 'Daily Records linked to a booking slot', (select count(*)::text from public.scholar_counseling_records where slot_id is not null));
  exception when others then insert into _rt (part, item, value) values ('ERROR', '4. consultation', sqlerrm); end;

  -- 5. Documents, INC items, certificates.
  begin
    insert into _rt (part, item, value) values
      ('5. DOCUMENTS', 'uploaded documents by kind', coalesce((select string_agg(kind || ': ' || c, ', ') from (select kind, count(*) c from public.renewal_documents group by kind) q), 'none')),
      ('5. DOCUMENTS', 'INC items / extensions', (select count(*) from public.renewal_inc_items) || ' / ' || (select count(*) from public.renewal_inc_extensions)),
      ('5. DOCUMENTS', 'renewal history lines', (select count(*)::text from public.renewal_history)),
      ('5. CERTIFICATES', 'certificates issued', (select count(*)::text from public.csr_issued)),
      ('5. CERTIFICATES', 'certificate counters', coalesce((select string_agg(to_jsonb(c)::text, '; ') from public.csr_counters c), 'none')),
      ('5. CERTIFICATES', 'certificates switched on?', coalesce((select enabled::text from public.csr_settings limit 1), '?'));
  exception when others then insert into _rt (part, item, value) values ('ERROR', '5. documents / certificates', sqlerrm); end;

  -- 6. Notices and referrals.
  begin
    insert into _rt (part, item, value) values
      ('6. NOTICES', 'scholar notifications (all / about a renewal)', (select count(*) || ' / ' || count(*) filter (where record_id is not null or kind in ('window_open', 'window_closing')) from public.scholar_notifications)),
      ('6. NOTICES', 'push messages waiting / "already told" marks / export log', (select count(*) from public.push_outbox) || ' / ' || (select count(*) from public.renewal_notice_log) || ' / ' || (select count(*) from public.renewal_export_log)),
      ('6. REFERRALS', 'consultation referrals (all / made by the renewal)', (select count(*) || ' / ' || count(*) filter (where renewal_record_id is not null) from public.scholar_counseling_referrals)),
      ('6. REFERRALS', 'referrals by status', coalesce((select string_agg(status || ': ' || c, ', ') from (select status, count(*) c from public.scholar_counseling_referrals group by status) q), 'none'));
  exception when others then insert into _rt (part, item, value) values ('ERROR', '6. notices / referrals', sqlerrm); end;

  -- 7. Settings the testing may have left (kept by a revert unless you say otherwise).
  begin
    insert into _rt (part, item, value) values
      ('7. SETTINGS', 'study plan templates uploaded', (select count(*)::text from public.renewal_study_plan_forms));
  exception when others then insert into _rt (part, item, value) values ('ERROR', '7. settings', sqlerrm); end;
end $$;

select part, item, value from _rt order by n;
