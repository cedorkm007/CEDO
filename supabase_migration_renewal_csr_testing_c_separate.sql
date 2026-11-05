-- ─────────────────────────────────────────────────────────────
-- THE CERTIFICATE SWITCHES ARE NOW REALLY SEPARATE.   Safe to run twice.   Undo: undo_renewal_csr_testing_c.sql
-- Run AFTER supabase_migration_renewal_csr_testing_b_functions.sql.
--
-- Before: "on for testing" only ADDED certificates for the test scholars, so with "on for everyone" ON the test scholars could download a certificate even when the testing switch was OFF.
-- Now each switch governs its own group and nothing else:
--   • a renewal in a TESTERS-ONLY (test) window: a certificate only while "On for testing" is ON (the other switch makes no difference);
--   • every other renewal: a certificate only while "On for everyone" is ON (the testing switch makes no difference).
-- The notices follow the same split: switching "on for everyone" tells the scholars of the normal windows only; switching "on for testing" tells the test scholars only.
-- Certificates that were already made are never removed. Replaces five functions; changes no table; deletes nothing.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public._csr_on_for_record(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_csr_testing_b_functions.sql first.';
  end if;
end $$;

create or replace function public._csr_on_for_record(p_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- two SEPARATE switches: a renewal in a testers-only (test) window follows the TESTING switch only; every other renewal follows the "on for everyone" switch only
  select case
    when exists (select 1 from public.renewal_records r join public.renewal_windows w on w.id = r.window_id where r.id = p_record_id and w.testers is not null)
      then coalesce((select s.testing_enabled from public.csr_settings s where s.id), false)
    else coalesce((select s.enabled from public.csr_settings s where s.id), false)
  end;
$$;
revoke all on function public._csr_on_for_record(uuid) from public, anon, authenticated;

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
    'enabled', v_enabled, 'testing', exists (select 1 from public.renewal_records r2 join public.renewal_windows w2 on w2.id = r2.window_id where r2.id = p_record_id and w2.testers is not null), 'eligible', v_rec.stage = 'renewed' and v_sch_status <> 'Removed', 'stage', v_rec.stage,
    'copies', coalesce((select jsonb_agg(jsonb_build_object('csr_number', c.csr_number, 'version', c.version, 'issued_at', c.issued_at, 'replaced', c.replaced,
          'reason', case when v_staff then c.reason else '' end, 'by', case when v_staff then c.requested_label else '' end) order by c.version desc)
        from public.csr_issued c where c.record_id = p_record_id and c.storage_path is not null), '[]'::jsonb));
end;
$$;
revoke all on function public.csr_for_record(uuid) from public, anon;
grant execute on function public.csr_for_record(uuid) to authenticated;

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
  if coalesce(p_enabled, old.testing_enabled) and not old.testing_enabled then
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

create or replace function public.csr_settings_save(
  p_enabled boolean, p_officer_name text, p_officer_title text, p_mayor_name text, p_mayor_title text, p_place text,
  p_officer_signature_path text default null, p_mayor_signature_path text default null, p_mayor_mark_path text default null)
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
  if char_length(btrim(coalesce(p_officer_name, ''))) < 3 or char_length(btrim(coalesce(p_mayor_name, ''))) < 3 then raise exception 'Both signatories need a name.'; end if;
  if char_length(btrim(coalesce(p_officer_title, ''))) < 3 or char_length(btrim(coalesce(p_mayor_title, ''))) < 3 then raise exception 'Both signatories need a title.'; end if;
  if char_length(btrim(coalesce(p_place, ''))) < 3 then raise exception 'Please write the place printed in "Issued this ...".'; end if;
  if greatest(char_length(p_officer_name), char_length(p_mayor_name), char_length(p_officer_title), char_length(p_mayor_title)) > 200 or char_length(p_place) > 200 then raise exception 'That text is too long.'; end if;
  select * into old from public.csr_settings where id for update;
  update public.csr_settings set enabled = coalesce(p_enabled, enabled), officer_name = btrim(p_officer_name), officer_title = btrim(p_officer_title), mayor_name = btrim(p_mayor_name),
    mayor_title = btrim(p_mayor_title), place = btrim(p_place),
    officer_signature_path = case when p_officer_signature_path is null then officer_signature_path when p_officer_signature_path = '' then null else p_officer_signature_path end,
    mayor_signature_path = case when p_mayor_signature_path is null then mayor_signature_path when p_mayor_signature_path = '' then null else p_mayor_signature_path end,
    mayor_mark_path = case when p_mayor_mark_path is null then mayor_mark_path when p_mayor_mark_path = '' then null else p_mayor_mark_path end,
    updated_by = (select u.id from public.users u where u.id = auth.uid()), updated_at = now()
  where id;
  -- Switched on just now: tell every scholar whose renewal is already confirmed that the certificate can be downloaded.
  if coalesce(p_enabled, old.enabled) and not old.enabled then
    for t in
      select distinct on (r.scholar_id_number) r.id, r.scholar_id_number, r.school_year, r.term from public.renewal_records r
      join public.scholars s on s.scholar_id_number = r.scholar_id_number
      where r.stage = 'renewed' and s.status <> 'Removed' and not exists (select 1 from public.renewal_windows w where w.id = r.window_id and w.testers is not null)
      order by r.scholar_id_number, r.confirmed_at desc nulls last
    loop
      perform public._notify_scholar(t.scholar_id_number, 'csr_ready', 'Your Certificate of Scholarship Renewal is ready',
        'You can download your certificate for ' || public._renewal_term_label(t.school_year, t.term) || ' from your Renewal tile.', t.id);
    end loop;
  end if;
end;
$$;
revoke all on function public.csr_settings_save(boolean, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.csr_settings_save(boolean, text, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
