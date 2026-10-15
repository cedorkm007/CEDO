-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_p8_csr.sql
--
-- Scholar Renewal System, Phase 8: the Certificate of Scholarship Renewal (CSR) and the renewal line on the public QR page.
-- Run AFTER the Phase 7 file. Additive and safe to run twice.
--
--   1. CSR settings (one row): switched on or off, the two signatories (names, titles, signature pictures), the place printed in "Issued this ...".
--      The evaluator and the IT admin (it.admin1) can change them. Certificates are OFF until someone switches them on.
--   2. csr_issued: every certificate that was made (number, version, who, when, the exact words printed, the stored PDF). The PDF itself is built by
--      the csr-issue edge function and kept in the private folder "csr-issued"; a scholar can open only their own files.
--   3. csr_prepare / csr_complete: the two database calls the csr-issue function makes. A certificate exists only for a renewal the evaluator
--      CONFIRMED (stage Renewed, any result: regular, Probationary or Reconsidered) of a scholar who is not Removed. One number per renewal
--      ("CSR-2026-1S-00012"); a corrected copy keeps the number and gets the next version; the older copy is kept and marked replaced.
--   4. The public QR page (no login): get_public_scholar_emergency_info() now also says the renewal status in one line (and the CSR number),
--      or "Removed". Nothing else about the renewal is public.
--   5. Notices: the scholar is told when a confirmed renewal can be downloaded, and when the office switches certificates on.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Settings ─────────────────────────────────────────────
create table if not exists public.csr_settings (
  id                      boolean primary key default true check (id),
  enabled                 boolean not null default false,
  officer_name            text not null default 'Ms. Richel Petalcurin-Dahay, LPT, MPSM',
  officer_title           text not null default 'City Education and Development Officer, City Education and Development Office',
  officer_signature_path  text,
  mayor_name              text not null default 'Hon. Rolando A. Uy',
  mayor_title             text not null default 'City Mayor',
  mayor_signature_path    text,
  mayor_mark_path         text,
  place                   text not null default 'the City of Cagayan de Oro, Philippines',
  updated_by              uuid references public.users(id) on delete set null,
  updated_at              timestamptz not null default now()
);
insert into public.csr_settings (id) values (true) on conflict (id) do nothing;
alter table public.csr_settings enable row level security;          -- no policy: read and saved only through the functions below

create or replace function public.can_edit_csr_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_renewal_evaluator() or public.is_it_admin();
$$;
revoke all on function public.can_edit_csr_settings() from public, anon;
grant execute on function public.can_edit_csr_settings() to authenticated;

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
  return jsonb_build_object('enabled', s.enabled, 'officer_name', s.officer_name, 'officer_title', s.officer_title, 'officer_signature_path', s.officer_signature_path,
    'mayor_name', s.mayor_name, 'mayor_title', s.mayor_title, 'mayor_signature_path', s.mayor_signature_path, 'mayor_mark_path', s.mayor_mark_path, 'place', s.place,
    'updated_at', s.updated_at, 'updated_by', (select public._staff_display_name(s.updated_by)));
end;
$$;
revoke all on function public.csr_settings_get() from public, anon;
grant execute on function public.csr_settings_get() to authenticated;

-- Save the settings. A signature path of null keeps the picture that is there; the empty text '' removes it (the office's sample picture is used again).
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
      where r.stage = 'renewed' and s.status <> 'Removed' order by r.scholar_id_number, r.confirmed_at desc nulls last
    loop
      perform public._notify_scholar(t.scholar_id_number, 'csr_ready', 'Your Certificate of Scholarship Renewal is ready',
        'You can download your certificate for ' || public._renewal_term_label(t.school_year, t.term) || ' from your Renewal tile.', t.id);
    end loop;
  end if;
end;
$$;
revoke all on function public.csr_settings_save(boolean, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.csr_settings_save(boolean, text, text, text, text, text, text, text, text) to authenticated;

-- ── 2. Folders for the signature pictures and the finished certificates ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('csr-assets', 'csr-assets', false, 2097152, array['image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('csr-issued', 'csr-issued', false, 5242880, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "csr editors manage signature pictures" on storage.objects;
create policy "csr editors manage signature pictures" on storage.objects for all
  using (bucket_id = 'csr-assets' and public.can_edit_csr_settings())
  with check (bucket_id = 'csr-assets' and public.can_edit_csr_settings());
-- Certificates: written only by the csr-issue function (service role). A scholar reads only their own folder; the evaluator reads all.
drop policy if exists "scholar reads own certificate" on storage.objects;
create policy "scholar reads own certificate" on storage.objects for select
  using (bucket_id = 'csr-issued' and (storage.foldername(name))[1] = public.current_scholar_id_number());
drop policy if exists "renewal staff read certificates" on storage.objects;
create policy "renewal staff read certificates" on storage.objects for select
  using (bucket_id = 'csr-issued' and public.is_renewal_evaluator());

-- ── 3. Issued certificates ──────────────────────────────────
create table if not exists public.csr_counters (
  school_year text not null,
  term        text not null,
  last_number integer not null default 0,
  primary key (school_year, term)
);
alter table public.csr_counters enable row level security;

create table if not exists public.csr_issued (
  id                uuid primary key default gen_random_uuid(),
  csr_number        text not null,
  version           integer not null default 1,
  record_id         uuid references public.renewal_records(id) on delete set null,
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  school_year       text not null,
  term              text not null,
  issued_at         timestamptz,
  requested_by      uuid references public.users(id) on delete set null,
  requested_label   text not null default '',
  reason            text not null default '',
  storage_path      text,
  replaced          boolean not null default false,
  snapshot          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (csr_number, version)
);
create unique index if not exists csr_issued_record_version_uq on public.csr_issued (record_id, version) where record_id is not null;
create index if not exists csr_issued_scholar_idx on public.csr_issued (scholar_id_number);
alter table public.csr_issued enable row level security;
drop policy if exists "scholar reads own certificates" on public.csr_issued;
create policy "scholar reads own certificates" on public.csr_issued for select using (scholar_id_number = public.current_scholar_id_number() and storage_path is not null);
drop policy if exists "evaluator reads certificates" on public.csr_issued;
create policy "evaluator reads certificates" on public.csr_issued for select using (public.can_view_renewals());

-- Everything the certificate prints and the website shows about a renewal's certificate.
create or replace function public._csr_snapshot(p_record_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'first_name', s.first_name, 'middle_name', coalesce(s.middle_name, ''), 'last_name', s.last_name, 'scholar_id_number', s.scholar_id_number,
    'barangay', coalesce(s.barangay, ''), 'program', coalesce(nullif(btrim(r.confirmed_program), ''), s.course, ''), 'year_level', coalesce(nullif(btrim(r.confirmed_year_level), ''), s.year_level, ''),
    'school', coalesce(nullif(btrim(r.confirmed_school), ''), s.school, ''), 'term', r.term, 'school_year', r.school_year)
  from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.id = p_record_id;
$$;
revoke all on function public._csr_snapshot(uuid) from public, anon, authenticated;

-- Step 1 of making a certificate (called by the csr-issue function with the CALLER's sign-in): checks that this person may have it, gives back the
-- existing file when there is one, otherwise reserves the number and returns everything the PDF needs.
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
  if not v_set.enabled then raise exception 'Certificates are not switched on yet.'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That renewal was not found.'; end if;
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

-- Step 2 (the function's own service role only): the PDF is stored; the certificate counts from now.
create or replace function public.csr_complete(p_csr_id uuid, p_storage_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.csr_issued%rowtype;
begin
  select * into c from public.csr_issued where id = p_csr_id for update;
  if not found then raise exception 'That certificate was not found.'; end if;
  if c.storage_path is not null then return; end if;
  if p_storage_path is null or p_storage_path not like c.scholar_id_number || '/%' then raise exception 'The file is not in the scholar''s folder.'; end if;
  update public.csr_issued set storage_path = p_storage_path, issued_at = now() where id = p_csr_id;
  update public.csr_issued set replaced = true where record_id = c.record_id and version < c.version;
  if c.record_id is not null then
    perform public._renewal_log(c.record_id, null, 'renewed', 'Certificate of Scholarship Renewal ' || c.csr_number || case when c.version > 1 then ' (copy ' || c.version || ': ' || c.reason || ')' else ' issued' end || '.',
      case when c.requested_label = 'Scholar' then 'Scholar' else c.requested_label end);
  end if;
  if c.version > 1 then
    perform public._notify_scholar(c.scholar_id_number, 'csr_ready', 'A corrected certificate is ready', 'The office issued a corrected copy of your certificate. Download it from your Renewal tile.', c.record_id);
  end if;
end;
$$;
revoke all on function public.csr_complete(uuid, text) from public, anon, authenticated;
grant execute on function public.csr_complete(uuid, text) to service_role;

-- What the screens need to know about a renewal's certificate: can it be downloaded, which copies exist.
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
  select s.enabled into v_enabled from public.csr_settings s where s.id;
  select s.status into v_sch_status from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number;
  return jsonb_build_object(
    'enabled', v_enabled, 'eligible', v_rec.stage = 'renewed' and v_sch_status <> 'Removed', 'stage', v_rec.stage,
    'copies', coalesce((select jsonb_agg(jsonb_build_object('csr_number', c.csr_number, 'version', c.version, 'issued_at', c.issued_at, 'replaced', c.replaced,
          'reason', case when v_staff then c.reason else '' end, 'by', case when v_staff then c.requested_label else '' end) order by c.version desc)
        from public.csr_issued c where c.record_id = p_record_id and c.storage_path is not null), '[]'::jsonb));
end;
$$;
revoke all on function public.csr_for_record(uuid) from public, anon;
grant execute on function public.csr_for_record(uuid) to authenticated;

-- The certificate numbers of a term, for the Excel file (the Phase 7 export asks this separately, so Phase 7 works without this file).
create or replace function public.renewal_export_csr(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.can_view_renewal_reports() then raise exception 'Not authorized to export renewal reports.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('scholar_id_number', c.scholar_id_number, 'csr_number', c.csr_number, 'version', c.version, 'issued_at', c.issued_at))
    from (select distinct on (x.record_id) x.* from public.csr_issued x join public.renewal_records r on r.id = x.record_id
          where r.school_year = p_school_year and r.term = p_term and x.storage_path is not null order by x.record_id, x.version desc) c), '[]'::jsonb);
end;
$fn$;
revoke all on function public.renewal_export_csr(text, text) from public, anon;
grant execute on function public.renewal_export_csr(text, text) to authenticated;

-- ── 4. The public QR page ───────────────────────────────────
create or replace function public.get_public_scholar_emergency_info(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.scholars%rowtype;
  r public.renewal_records%rowtype;
  v_csr text;
  v_line text;
  v_state text;
begin
  select * into s from public.scholars where qr_token = p_token;
  if not found then return jsonb_build_object('found', false); end if;
  if s.status = 'Removed' then
    v_state := 'removed'; v_line := 'Removed';
  else
    select * into r from public.renewal_records x where x.scholar_id_number = s.scholar_id_number and x.stage <> 'not_required'
      order by x.school_year desc, case x.term when 'Summer' then 3 when '2nd Semester' then 2 else 1 end desc, x.created_at desc limit 1;
    if not found then
      v_state := 'none'; v_line := 'No renewal on record yet';
    elsif r.stage = 'renewed' then
      v_state := 'renewed'; v_line := 'Renewed — ' || public._renewal_term_label(r.school_year, r.term);
      select c.csr_number into v_csr from public.csr_issued c where c.record_id = r.id and c.storage_path is not null order by c.version desc limit 1;
    elsif r.stage in ('removed', 'late_declined') then
      v_state := 'none'; v_line := 'No renewal on record yet';
    else
      v_state := 'in_progress'; v_line := 'Renewal in progress — ' || public._renewal_term_label(r.school_year, r.term);
    end if;
  end if;
  return jsonb_build_object(
    'found', true,
    'name', s.first_name || ' ' || s.last_name,
    'emergencyContactName', s.emergency_contact_name,
    'emergencyContactRelationship', s.emergency_contact_relationship,
    'emergencyContactNumber', s.emergency_contact_number,
    'renewal', jsonb_build_object('state', v_state, 'line', v_line, 'csr_number', v_csr));
end;
$$;
grant execute on function public.get_public_scholar_emergency_info(uuid) to anon, authenticated;

-- ── 5. Notices ──────────────────────────────────────────────
-- A renewal the evaluator just confirmed: if certificates are on, tell the scholar it can be downloaded.
create or replace function public._renewal_trg_csr_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.csr_settings s where s.id and s.enabled) then
    perform public._notify_scholar(new.scholar_id_number, 'csr_ready', 'Your Certificate of Scholarship Renewal is ready',
      'You can download your certificate for ' || public._renewal_term_label(new.school_year, new.term) || ' from your Renewal tile.', new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists renewal_csr_ready on public.renewal_records;
create trigger renewal_csr_ready after update of stage on public.renewal_records
  for each row when (new.stage = 'renewed' and old.stage is distinct from new.stage) execute function public._renewal_trg_csr_ready();

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select enabled from public.csr_settings where id) as certificates_switched_on, (select count(*) from public.csr_issued) as certificates_issued;
