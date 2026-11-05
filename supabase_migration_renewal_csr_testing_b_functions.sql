-- ─────────────────────────────────────────────────────────────
-- A SEPARATE CSR SWITCH FOR TESTING, FILE B of 2: the rules.   Safe to run twice.   Undo: undo_renewal_csr_testing_b.sql
-- Run AFTER supabase_migration_renewal_csr_testing_a_column.sql.
--
-- The Certificate of Scholarship Renewal now has TWO switches:
--   • "On for everyone" (the one that was there): certificates for every renewed scholar.
--   • "On for testing" (new): certificates ONLY for the scholars of a TESTERS-ONLY renewal window (the test accounts), whether or not the first switch is on.
-- So the certificate can be tried with test accounts while it stays off for everybody else, and switching "On for everyone" on later is a separate step. A scholar of a normal window gets a
-- certificate only when "On for everyone" is on. Certificates already made are never removed by switching anything off.
-- Replaces three functions (csr_settings_get, csr_prepare, csr_for_record) and one notice trigger; creates two (the testing switch and a helper). The existing save is NOT changed. No table is changed here. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'csr_settings' and column_name = 'testing_enabled') then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_csr_testing_a_column.sql first.';
  end if;
end $$;

-- Is the certificate on for THIS renewal? On for everyone, or on for testing and the renewal is in a testers-only window.
create or replace function public._csr_on_for_record(p_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.enabled from public.csr_settings s where s.id), false)
      or (coalesce((select s.testing_enabled from public.csr_settings s where s.id), false)
          and exists (select 1 from public.renewal_records r join public.renewal_windows w on w.id = r.window_id where r.id = p_record_id and w.testers is not null));
$$;
revoke all on function public._csr_on_for_record(uuid) from public, anon, authenticated;

create or replace function public.csr_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.csr_settings%rowtype;
begin
  if not public.can_edit_csr_settings() then raise exception 'Only the evaluator and the IT admin can see the certificate settings.'; end if;
  select * into s from public.csr_settings where id;
  return jsonb_build_object('enabled', s.enabled, 'testing_enabled', s.testing_enabled, 'officer_name', s.officer_name, 'officer_title', s.officer_title, 'officer_signature_path', s.officer_signature_path,
    'mayor_name', s.mayor_name, 'mayor_title', s.mayor_title, 'mayor_signature_path', s.mayor_signature_path, 'mayor_mark_path', s.mayor_mark_path, 'place', s.place,
    'updated_at', s.updated_at, 'updated_by', (select public._staff_display_name(s.updated_by)));
end;
$$;
revoke all on function public.csr_settings_get() from public, anon;
grant execute on function public.csr_settings_get() to authenticated;

-- The testing switch has its OWN function, so the existing save (names, signatures, "on for everyone") is not changed at all. null = leave as it is.
create or replace function public.csr_testing_switch(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old public.csr_settings%rowtype;
  t record;
begin
  if not public.can_edit_csr_settings() then raise exception 'Only the evaluator and the IT admin can change the certificate settings.'; end if;
  select * into old from public.csr_settings where id for update;
  update public.csr_settings set testing_enabled = coalesce(p_enabled, testing_enabled), updated_by = (select u.id from public.users u where u.id = auth.uid()), updated_at = now() where id;
  -- Switched on for TESTING just now: tell the test scholars (the ones in a testers-only window) whose renewal is already confirmed.
  if coalesce(p_enabled, old.testing_enabled) and not old.testing_enabled and not old.enabled then
    for t in
      select distinct on (r.scholar_id_number) r.id, r.scholar_id_number, r.school_year, r.term from public.renewal_records r
      join public.scholars s on s.scholar_id_number = r.scholar_id_number
      join public.renewal_windows w on w.id = r.window_id and w.testers is not null
      where r.stage = 'renewed' and s.status <> 'Removed' order by r.scholar_id_number, r.confirmed_at desc nulls last
    loop
      perform public._notify_scholar(t.scholar_id_number, 'csr_ready', 'Your Certificate of Scholarship Renewal is ready',
        'You can download your certificate for ' || public._renewal_term_label(t.school_year, t.term) || ' from your Renewal tile.', t.id);
    end loop;
  end if;
end;
$$;
revoke all on function public.csr_testing_switch(boolean) from public, anon;
grant execute on function public.csr_testing_switch(boolean) to authenticated;

create or replace function public.csr_prepare(p_record_id uuid, p_reissue_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_sch public.scholars%rowtype;
  v_set public.csr_settings%rowtype;
  v_cur public.csr_issued%rowtype;
  v_row public.csr_issued%rowtype;
  v_is_owner boolean;
  v_is_eval boolean := public.is_renewal_evaluator();
  v_reissue boolean := nullif(btrim(coalesce(p_reissue_reason, '')), '') is not null;
  v_number text;
  v_version integer;
  v_seq integer;
begin
  select * into v_set from public.csr_settings where id;
  select * into v_rec from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That renewal was not found.'; end if;
  if not public._csr_on_for_record(v_rec.id) then raise exception 'Certificates are not switched on yet.'; end if;
  v_is_owner := coalesce(public.current_scholar_id_number() = v_rec.scholar_id_number, false);      -- (null for staff: never "the owner")
  if not (v_is_owner or v_is_eval) then raise exception 'You cannot get this certificate.'; end if;
  if v_rec.stage <> 'renewed' then raise exception 'The certificate is available once the evaluator has confirmed the renewal.'; end if;
  select * into v_sch from public.scholars where scholar_id_number = v_rec.scholar_id_number;
  if v_sch.status = 'Removed' then raise exception 'No certificate is issued to a removed scholar.'; end if;
  if v_reissue and not v_is_eval then raise exception 'Only the evaluator can issue a corrected copy.'; end if;
  if v_reissue and char_length(btrim(p_reissue_reason)) < 5 then raise exception 'Please say why a corrected copy is needed (at least 5 characters).'; end if;

  select * into v_cur from public.csr_issued c where c.record_id = p_record_id and c.storage_path is not null order by c.version desc limit 1;
  if found and not v_reissue then
    return jsonb_build_object('ready', true, 'csr_number', v_cur.csr_number, 'version', v_cur.version, 'storage_path', v_cur.storage_path, 'issued_at', v_cur.issued_at, 'scholar_id_number', v_cur.scholar_id_number,
      'school_year', v_cur.school_year, 'term', v_cur.term);
  end if;

  -- reuse a half-made copy (an earlier attempt failed) instead of burning a number
  select * into v_row from public.csr_issued c where c.record_id = p_record_id and c.storage_path is null order by c.version desc limit 1;
  if not found then
    select c.csr_number, c.version + 1 into v_number, v_version from public.csr_issued c where c.record_id = p_record_id order by c.version desc limit 1;
    if v_number is null then
      insert into public.csr_counters (school_year, term, last_number) values (v_rec.school_year, v_rec.term, 1)
      on conflict (school_year, term) do update set last_number = public.csr_counters.last_number + 1 returning last_number into v_seq;
      v_number := 'CSR-' || substr(v_rec.school_year, 1, 4) || '-' || case v_rec.term when '1st Semester' then '1S' when '2nd Semester' then '2S' else 'SU' end || '-' || lpad(v_seq::text, 5, '0');
      v_version := 1;
    end if;
    insert into public.csr_issued (csr_number, version, record_id, scholar_id_number, school_year, term, requested_by, requested_label, reason, snapshot)
    values (v_number, v_version, p_record_id, v_rec.scholar_id_number, v_rec.school_year, v_rec.term, (select u.id from public.users u where u.id = auth.uid()),
            case when v_is_eval and not v_is_owner then public._actor_name() else 'Scholar' end, coalesce(btrim(p_reissue_reason), ''), public._csr_snapshot(p_record_id))
    returning * into v_row;
  end if;
  return jsonb_build_object('ready', false, 'csr_id', v_row.id, 'csr_number', v_row.csr_number, 'version', v_row.version, 'data', v_row.snapshot, 'qr_token', v_sch.qr_token,
    'settings', jsonb_build_object('officer_name', v_set.officer_name, 'officer_title', v_set.officer_title, 'officer_signature_path', v_set.officer_signature_path,
      'mayor_name', v_set.mayor_name, 'mayor_title', v_set.mayor_title, 'mayor_signature_path', v_set.mayor_signature_path, 'mayor_mark_path', v_set.mayor_mark_path, 'place', v_set.place));
end;
$$;
revoke all on function public.csr_prepare(uuid, text) from public, anon;
grant execute on function public.csr_prepare(uuid, text) to authenticated;

create or replace function public.csr_for_record(p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_enabled boolean;
  v_staff boolean := public.can_view_renewals();
  v_sch_status text;
begin
  select * into v_rec from public.renewal_records where id = p_record_id;
  if not found then return null; end if;
  if not (v_staff or coalesce(public.current_scholar_id_number() = v_rec.scholar_id_number, false)) then return null; end if;
  v_enabled := public._csr_on_for_record(v_rec.id);
  select s.status into v_sch_status from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number;
  return jsonb_build_object(
    'enabled', v_enabled, 'testing', v_enabled and not coalesce((select s.enabled from public.csr_settings s where s.id), false), 'eligible', v_rec.stage = 'renewed' and v_sch_status <> 'Removed', 'stage', v_rec.stage,
    'copies', coalesce((select jsonb_agg(jsonb_build_object('csr_number', c.csr_number, 'version', c.version, 'issued_at', c.issued_at, 'replaced', c.replaced,
          'reason', case when v_staff then c.reason else '' end, 'by', case when v_staff then c.requested_label else '' end) order by c.version desc)
        from public.csr_issued c where c.record_id = p_record_id and c.storage_path is not null), '[]'::jsonb));
end;
$$;
revoke all on function public.csr_for_record(uuid) from public, anon;
grant execute on function public.csr_for_record(uuid) to authenticated;

create or replace function public._renewal_trg_csr_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._csr_on_for_record(new.id) then
    perform public._notify_scholar(new.scholar_id_number, 'csr_ready', 'Your Certificate of Scholarship Renewal is ready',
      'You can download your certificate for ' || public._renewal_term_label(new.school_year, new.term) || ' from your Renewal tile.', new.id);
  end if;
  return null;
end;
$$;

notify pgrst, 'reload schema';
