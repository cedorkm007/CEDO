-- ─────────────────────────────────────────────────────────────
-- bridging_phase1_setup.sql
-- KAGAY-ANON BRIDGING APPLICATION, PHASE 1: accounts, schools, privacy consent.
-- RUN THIS IN THE NEW BRIDGING SUPABASE PROJECT ONLY. It stops if it finds your main CEDO database.
-- Safe to run twice. Undo: undo_bridging_phase1_setup.sql
--
--   * Student and teacher accounts (teachers wait for approval), schools, "school not listed" and other requests.
--   * Privacy notice (English and Bisaya, versioned), who agreed and when, and the DPO / retention / under-18 settings.
--   * Access rules: a person reads only their own rows. All changes go through the functions below, which check everything.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.scholars') is not null or to_regclass('public.school_accounts') is not null then
    raise exception 'STOPPED, nothing changed: this is your MAIN CEDO database. Run this file in the new Bridging project.';
  end if;
end $$;

-- ── 1. Lists ─────────────────────────────────────────────────
create table if not exists public.bridging_schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  offers_jhs boolean not null default false,        -- Grade 7 to 10
  offers_shs boolean not null default false,        -- Grade 11 to 12
  offers_college boolean not null default false,
  offers_als boolean not null default false,        -- Alternative Learning System (community learning center)
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists bridging_schools_name on public.bridging_schools (lower(btrim(name)));

create table if not exists public.bridging_subjects (
  key text primary key,
  name text not null,
  sort_order integer not null default 0
);
insert into public.bridging_subjects (key, name, sort_order) values
  ('math', 'Mathematics', 1), ('science', 'Science', 2), ('english', 'English', 3), ('ict', 'ICT', 4)
on conflict (key) do nothing;

-- ── 2. People ────────────────────────────────────────────────
create table if not exists public.bridging_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'teacher')),
  username text not null,
  last_name text not null,
  first_name text not null,
  middle_name text not null,
  school_id uuid references public.bridging_schools(id),
  requested_school_name text,                       -- "My school is not listed"
  level text check (level in ('g7', 'g8', 'g9', 'g10', 'g11', 'g12', 'c1', 'c2', 'c3', 'c4', 'c5', 'als_jhs', 'als_shs')),
  contact_email text,                               -- optional
  employee_id text,                                 -- teachers: at least one of these two
  work_email text,
  status text not null check (status in ('active', 'pending', 'declined', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'student' or level is not null),
  check (school_id is not null or requested_school_name is not null)
);
create unique index if not exists bridging_profiles_username on public.bridging_profiles (lower(username));
create index if not exists bridging_profiles_school on public.bridging_profiles (school_id, level, role, status);

create table if not exists public.bridging_teacher_levels (
  teacher_id uuid not null references public.bridging_profiles(user_id) on delete cascade,
  level text not null,
  primary key (teacher_id, level)
);
create table if not exists public.bridging_teacher_subjects (
  teacher_id uuid not null references public.bridging_profiles(user_id) on delete cascade,
  subject_key text not null references public.bridging_subjects(key),
  primary key (teacher_id, subject_key)
);

-- A student's teacher. 'pending' waits for the teacher to confirm; 'no_account' = the teacher has no account yet, nothing to wait for.
create table if not exists public.bridging_links (
  student_id uuid primary key references public.bridging_profiles(user_id) on delete cascade,
  teacher_id uuid references public.bridging_profiles(user_id) on delete cascade,
  teacher_name text,
  status text not null check (status in ('pending', 'confirmed', 'declined', 'no_account')),
  updated_at timestamptz not null default now(),
  check ((status = 'no_account' and teacher_id is null and teacher_name is not null) or (status <> 'no_account' and teacher_id is not null))
);
create index if not exists bridging_links_teacher on public.bridging_links (teacher_id, status);

-- Things an admin has to handle (Phase 2 gives the admin the screen).
create table if not exists public.bridging_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bridging_profiles(user_id) on delete cascade,
  kind text not null check (kind in ('school_not_listed', 'school_change', 'delete_account', 'password_reset')),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create unique index if not exists bridging_requests_one_open on public.bridging_requests (user_id, kind) where status = 'open';

-- ── 3. Privacy ───────────────────────────────────────────────
create table if not exists public.bridging_notices (
  version integer primary key,
  body_en text not null,
  body_ceb text not null,
  published_at timestamptz not null default now()
);
create table if not exists public.bridging_settings (
  id boolean primary key default true check (id),
  dpo_name text not null default '',
  dpo_email text not null default '',
  retention_text text not null default '',
  under18_mode text not null default 'guardian' check (under18_mode in ('guardian', 'notice'))
);
insert into public.bridging_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.bridging_consents (
  user_id uuid not null references public.bridging_profiles(user_id) on delete cascade,
  notice_version integer not null references public.bridging_notices(version),
  agreed_at timestamptz not null default now(),
  under_18 boolean not null default false,
  guardian_name text,
  primary key (user_id, notice_version)
);

-- The first notice. {dpo_name}, {dpo_email} and {retention} are filled in from the settings. A Bisaya speaker should check the Bisaya text.
insert into public.bridging_notices (version, body_en, body_ceb) values (1,
$en$What we collect: your name, school, grade or year level, teacher, username, and (if you give one) an email address. While you use the app we also save your answers, scores and activity.

Why: to give you the reviewer (quests and tests) and to follow your learning progress.

Who can see it: you, your teacher(s) who have accepted you, and CEDO administrators. It is not shared outside CEDO.

How long we keep it: {retention}

Your rights under the Data Privacy Act of 2012 (RA 10173): you may ask to see your data, to correct it, and to have it deleted. You can ask from your Profile page or contact our Data Protection Officer.

Data Protection Officer: {dpo_name} {dpo_email}$en$,
$ceb$Unsa ang among kolektahon: imong ngalan, eskwelahan, grade o year level, magtutudlo, username, ug email address (kon maghatag ka). Samtang naggamit ka sa app, among i-save ang imong mga tubag, iskor ug kalihokan.

Ngano: aron mahatag kanimo ang reviewer (mga quest ug test) ug masubay ang imong pagkat-on.

Kinsa ang makakita: ikaw, ang imong magtutudlo nga midawat kanimo, ug ang mga administrator sa CEDO. Dili kini ipaambit sa gawas sa CEDO.

Unsa kadugay namo kini tipigan: {retention}

Imong mga katungod ubos sa Data Privacy Act of 2012 (RA 10173): mahimo kang mohangyo nga makita ang imong datos, ipatul-id kini, ug ipapapas kini. Mahimo kang mohangyo gikan sa imong Profile o mokontak sa among Data Protection Officer.

Data Protection Officer: {dpo_name} {dpo_email}$ceb$)
on conflict (version) do nothing;

-- ── 4. Helpers ───────────────────────────────────────────────
create or replace function public._bridging_level_fits(p_level text, p_school uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_level is null or p_level not in ('g7', 'g8', 'g9', 'g10', 'g11', 'g12', 'c1', 'c2', 'c3', 'c4', 'c5', 'als_jhs', 'als_shs') then false
    when p_school is null then true                 -- a school that is not listed yet
    else coalesce((select case
        when p_level in ('g7', 'g8', 'g9', 'g10') then s.offers_jhs
        when p_level in ('g11', 'g12') then s.offers_shs
        when p_level like 'als%' then s.offers_als
        else s.offers_college end
      from public.bridging_schools s where s.id = p_school and s.is_active), false)
  end;
$$;

create or replace function public._bridging_text(p_value text, p_label text, p_max integer default 60)
returns text language plpgsql immutable as $$
declare v text := btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'));
begin
  if v = '' then raise exception 'Enter your %.', p_label; end if;
  if char_length(v) > p_max then raise exception 'The % is too long.', p_label; end if;
  return v;
end; $$;

create or replace function public._bridging_latest_notice()
returns integer language sql stable security definer set search_path = public as $$
  select max(version) from public.bridging_notices;
$$;

-- The signed-in person's own profile, or an error.
create or replace function public._bridging_me()
returns public.bridging_profiles language plpgsql stable security definer set search_path = public as $$
declare v public.bridging_profiles%rowtype;
begin
  select * into v from public.bridging_profiles p where p.user_id = auth.uid();
  if not found then raise exception 'Please sign in again.'; end if;
  if v.status = 'deactivated' then raise exception 'This account has been deactivated.'; end if;
  return v;
end; $$;

create or replace function public._bridging_record_consent(p_user uuid, p_consent jsonb, p_student boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_version integer := public._bridging_latest_notice();
  v_under boolean := p_student and coalesce((p_consent ->> 'under18')::boolean, false);
  v_guardian text := nullif(btrim(coalesce(p_consent ->> 'guardianName', '')), '');
begin
  if coalesce((p_consent ->> 'agreed')::boolean, false) is not true then raise exception 'You need to agree to the privacy notice.'; end if;
  if coalesce((p_consent ->> 'version')::integer, 0) <> v_version then raise exception 'The privacy notice was just updated. Please read it again.'; end if;
  if p_student and (p_consent -> 'under18') is null then raise exception 'Tell us whether you are under 18.'; end if;
  if v_under and (select under18_mode from public.bridging_settings) = 'guardian'
     and (v_guardian is null or coalesce((p_consent ->> 'guardianAgreed')::boolean, false) is not true) then
    raise exception 'A parent or guardian must agree: type their name and tick their box.';
  end if;
  insert into public.bridging_consents (user_id, notice_version, under_18, guardian_name)
  values (p_user, v_version, v_under, case when v_under then left(v_guardian, 120) end)
  on conflict (user_id, notice_version) do nothing;
end; $$;

-- Sets (or clears) a student's teacher. {"id": ...} = a teacher with an account, {"name": ...} = has no account yet, null = none.
create or replace function public._bridging_set_teacher(p_student uuid, p_school uuid, p_teacher jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p_teacher ->> 'id', '')::uuid; v_name text := nullif(btrim(coalesce(p_teacher ->> 'name', '')), '');
begin
  if v_id is not null then
    if not exists (select 1 from public.bridging_profiles t where t.user_id = v_id and t.role = 'teacher' and t.status = 'active' and t.school_id is not distinct from p_school) then
      raise exception 'That teacher is not available. Please choose again.';
    end if;
    insert into public.bridging_links (student_id, teacher_id, teacher_name, status) values (p_student, v_id, null, 'pending')
    on conflict (student_id) do update set teacher_id = excluded.teacher_id, teacher_name = null, updated_at = now(),
      status = case when bridging_links.teacher_id = excluded.teacher_id and bridging_links.status = 'confirmed' then 'confirmed' else 'pending' end;
  elsif v_name is not null then
    insert into public.bridging_links (student_id, teacher_id, teacher_name, status) values (p_student, null, left(v_name, 120), 'no_account')
    on conflict (student_id) do update set teacher_id = null, teacher_name = excluded.teacher_name, status = 'no_account', updated_at = now();
  else
    delete from public.bridging_links where student_id = p_student;
  end if;
end; $$;

-- ── 5. What the website calls ────────────────────────────────
-- For the sign-in and registration screens (before signing in).
create or replace function public.bridging_options()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'schools', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'jhs', s.offers_jhs, 'shs', s.offers_shs, 'college', s.offers_college, 'als', s.offers_als) order by lower(s.name))
                         from public.bridging_schools s where s.is_active), '[]'::jsonb),
    'subjects', (select jsonb_agg(jsonb_build_object('key', key, 'name', name) order by sort_order) from public.bridging_subjects),
    'notice', (select jsonb_build_object('version', n.version, 'en', n.body_en, 'ceb', n.body_ceb) from public.bridging_notices n order by n.version desc limit 1),
    'settings', (select jsonb_build_object('dpoName', dpo_name, 'dpoEmail', dpo_email, 'retention', retention_text, 'under18Mode', under18_mode) from public.bridging_settings));
$$;

-- Approved teachers of one school who handle a level: names only.
create or replace function public.bridging_teachers(p_school_id uuid, p_level text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.user_id, 'name', p.last_name || ', ' || p.first_name) order by lower(p.last_name), lower(p.first_name)), '[]'::jsonb)
  from public.bridging_profiles p
  where p.role = 'teacher' and p.status = 'active' and p.school_id = p_school_id
    and exists (select 1 from public.bridging_teacher_levels l where l.teacher_id = p.user_id and l.level = p_level);
$$;

-- Registrations are counted per internet address (kept as a scrambled value), to stop abuse.
create table if not exists public.bridging_attempts (
  kind text not null,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index if not exists bridging_attempts_lookup on public.bridging_attempts (kind, ip_hash, at);

create or replace function public.bridging_rate_limit(p_kind text, p_ip text, p_per_hour integer, p_per_day integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ip text := md5('bridging:' || coalesce(p_ip, ''));
begin
  delete from public.bridging_attempts where at < now() - interval '2 days';
  if (select count(*) from public.bridging_attempts a where a.kind = p_kind and a.ip_hash = v_ip and a.at > now() - interval '1 hour') >= p_per_hour
     or (select count(*) from public.bridging_attempts a where a.kind = p_kind and a.ip_hash = v_ip and a.at > now() - interval '1 day') >= p_per_day then
    return false;
  end if;
  insert into public.bridging_attempts (kind, ip_hash) values (p_kind, v_ip);
  return true;
end; $$;

-- Called only by the server function "bridging-register", right after it creates the sign-in account.
-- The username is taken from the account itself, never from the form.
create or replace function public.bridging_register(p_user uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := p_user;
  v_email text; v_username text;
  v_role text := p ->> 'role';
  v_last text; v_first text; v_middle text;
  v_school uuid := nullif(p ->> 'schoolId', '')::uuid;
  v_other text := nullif(btrim(coalesce(p ->> 'otherSchool', '')), '');
  v_level text := nullif(p ->> 'level', '');
  v_contact text := nullif(btrim(coalesce(p ->> 'contactEmail', '')), '');
  v_employee text := nullif(btrim(coalesce(p ->> 'employeeId', '')), '');
  v_work text := nullif(btrim(coalesce(p ->> 'workEmail', '')), '');
  v_item text; v_n integer;
begin
  if v_uid is null then raise exception 'There is no account to register.'; end if;
  if exists (select 1 from public.bridging_profiles x where x.user_id = v_uid) then raise exception 'This account is already registered.'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null or v_email not like '%@bridging.cedo.local' then raise exception 'This account cannot register here.'; end if;
  v_username := split_part(v_email, '@', 1);
  if v_username !~ '^[a-z0-9][a-z0-9._]{3,29}$' then raise exception 'That username is not allowed.'; end if;
  if v_role not in ('student', 'teacher') or v_role is null then raise exception 'Choose Student or Teacher.'; end if;

  v_last := public._bridging_text(p ->> 'lastName', 'last name');
  v_first := public._bridging_text(p ->> 'firstName', 'first name');
  v_middle := public._bridging_text(p ->> 'middleName', 'middle name (or N/A)');
  if v_school is null then
    v_other := public._bridging_text(v_other, 'school', 160);
  else
    v_other := null;
    if not exists (select 1 from public.bridging_schools s where s.id = v_school and s.is_active) then raise exception 'Choose your school again.'; end if;
  end if;
  if v_contact is not null and (v_contact !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_contact) > 160) then raise exception 'That email address does not look right.'; end if;

  if v_role = 'student' then
    if not public._bridging_level_fits(v_level, v_school) then raise exception 'Choose your grade or year level.'; end if;
    -- the same name at the same school and level: warn, do not block
    if coalesce((p ->> 'confirmDuplicate')::boolean, false) is not true and exists (
      select 1 from public.bridging_profiles x where x.role = 'student' and lower(x.last_name) = lower(v_last) and lower(x.first_name) = lower(v_first)
        and x.level = v_level and x.school_id is not distinct from v_school) then
      return jsonb_build_object('ok', false, 'duplicate', true);
    end if;
    v_employee := null; v_work := null;
  else
    v_level := null;
    if v_employee is null and v_work is null then raise exception 'Give your employee ID or your work email.'; end if;
    if v_work is not null and v_work !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That work email does not look right.'; end if;
  end if;

  insert into public.bridging_profiles (user_id, role, username, last_name, first_name, middle_name, school_id, requested_school_name, level, contact_email, employee_id, work_email, status)
  values (v_uid, v_role, v_username, v_last, v_first, v_middle, v_school, v_other, v_level, v_contact, left(v_employee, 60), left(v_work, 160),
          case when v_role = 'teacher' then 'pending' else 'active' end);
  perform public._bridging_record_consent(v_uid, coalesce(p -> 'consent', '{}'::jsonb), v_role = 'student');

  if v_role = 'teacher' then
    for v_item in select jsonb_array_elements_text(coalesce(p -> 'levels', '[]'::jsonb)) loop
      if not public._bridging_level_fits(v_item, v_school) then raise exception 'One of the levels you handle is not offered by that school.'; end if;
      insert into public.bridging_teacher_levels (teacher_id, level) values (v_uid, v_item) on conflict do nothing;
    end loop;
    for v_item in select jsonb_array_elements_text(coalesce(p -> 'subjects', '[]'::jsonb)) loop
      insert into public.bridging_teacher_subjects (teacher_id, subject_key) values (v_uid, v_item) on conflict do nothing;
    end loop;
    select count(*) into v_n from public.bridging_teacher_levels where teacher_id = v_uid;
    if v_n = 0 then raise exception 'Choose the levels you handle.'; end if;
    select count(*) into v_n from public.bridging_teacher_subjects where teacher_id = v_uid;
    if v_n = 0 then raise exception 'Choose the subjects you handle.'; end if;
  elsif jsonb_typeof(p -> 'teacher') = 'object' then
    perform public._bridging_set_teacher(v_uid, v_school, p -> 'teacher');
  end if;

  if v_other is not null then
    insert into public.bridging_requests (user_id, kind, details) values (v_uid, 'school_not_listed', jsonb_build_object('name', v_other));
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- Everything the signed-in screens need about the person. null when the account has not finished registering.
create or replace function public.bridging_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.bridging_profiles%rowtype;
begin
  select * into v from public.bridging_profiles p where p.user_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object(
    'role', v.role, 'status', v.status, 'username', v.username,
    'lastName', v.last_name, 'firstName', v.first_name, 'middleName', v.middle_name,
    'schoolId', v.school_id, 'schoolName', coalesce((select s.name from public.bridging_schools s where s.id = v.school_id), v.requested_school_name),
    'schoolListed', v.school_id is not null, 'level', v.level, 'contactEmail', v.contact_email,
    'levels', (select coalesce(jsonb_agg(l.level order by l.level), '[]'::jsonb) from public.bridging_teacher_levels l where l.teacher_id = v.user_id),
    'subjects', (select coalesce(jsonb_agg(s.subject_key order by s.subject_key), '[]'::jsonb) from public.bridging_teacher_subjects s where s.teacher_id = v.user_id),
    'teacher', (select jsonb_build_object('id', k.teacher_id, 'status', k.status,
                  'name', coalesce(k.teacher_name, (select t.last_name || ', ' || t.first_name from public.bridging_profiles t where t.user_id = k.teacher_id)))
                from public.bridging_links k where k.student_id = v.user_id),
    'openRequests', (select coalesce(jsonb_agg(r.kind), '[]'::jsonb) from public.bridging_requests r where r.user_id = v.user_id and r.status = 'open'),
    'needsConsent', not exists (select 1 from public.bridging_consents c where c.user_id = v.user_id and c.notice_version = public._bridging_latest_notice()));
end; $$;

create or replace function public.bridging_accept_notice(p_consent jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bridging_profiles%rowtype := public._bridging_me();
begin
  perform public._bridging_record_consent(v.user_id, p_consent, v.role = 'student');
end; $$;

-- Name, level and contact email change at once. A school change is a request (below).
create or replace function public.bridging_update_profile(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.bridging_profiles%rowtype := public._bridging_me();
  v_level text := coalesce(nullif(p ->> 'level', ''), v.level);
  v_contact text := nullif(btrim(coalesce(p ->> 'contactEmail', '')), '');
begin
  if v.role = 'student' and not public._bridging_level_fits(v_level, v.school_id) then raise exception 'That level is not offered by your school.'; end if;
  if v_contact is not null and v_contact !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  update public.bridging_profiles set
    last_name = public._bridging_text(p ->> 'lastName', 'last name'),
    first_name = public._bridging_text(p ->> 'firstName', 'first name'),
    middle_name = public._bridging_text(p ->> 'middleName', 'middle name (or N/A)'),
    level = case when v.role = 'student' then v_level end,
    contact_email = v_contact, updated_at = now()
  where user_id = v.user_id;
end; $$;

create or replace function public.bridging_choose_teacher(p_teacher jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bridging_profiles%rowtype := public._bridging_me();
begin
  if v.role <> 'student' then raise exception 'Only students choose a teacher.'; end if;
  perform public._bridging_set_teacher(v.user_id, v.school_id, p_teacher);
end; $$;

-- Ask an admin: 'school_change' ({"schoolId"} or {"otherSchool"}) or 'delete_account' ({"reason"}). Asking again updates the open request.
create or replace function public.bridging_request(p_kind text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bridging_profiles%rowtype := public._bridging_me(); v_details jsonb;
begin
  if p_kind = 'school_change' then
    if nullif(p_details ->> 'schoolId', '') is not null then
      select jsonb_build_object('schoolId', s.id, 'name', s.name) into v_details from public.bridging_schools s where s.id = (p_details ->> 'schoolId')::uuid and s.is_active;
      if v_details is null then raise exception 'Choose the school again.'; end if;
    else
      v_details := jsonb_build_object('name', public._bridging_text(p_details ->> 'otherSchool', 'school', 160));
    end if;
  elsif p_kind = 'delete_account' then
    v_details := jsonb_build_object('reason', left(btrim(coalesce(p_details ->> 'reason', '')), 500));
  else
    raise exception 'That request is not available.';
  end if;
  insert into public.bridging_requests (user_id, kind, details) values (v.user_id, p_kind, v_details)
  on conflict (user_id, kind) where status = 'open' do update set details = excluded.details, created_at = now();
end; $$;

create or replace function public.bridging_cancel_request(p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bridging_profiles%rowtype := public._bridging_me();
begin
  update public.bridging_requests set status = 'cancelled', handled_at = now() where user_id = v.user_id and kind = p_kind and status = 'open';
end; $$;

-- "Forgot password": notes it for the admin. Always answers the same, so it cannot be used to find out who has an account.
create or replace function public.bridging_forgot_password(p_username text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.bridging_requests (user_id, kind)
  select p.user_id, 'password_reset' from public.bridging_profiles p where lower(p.username) = lower(btrim(coalesce(p_username, ''))) and p.status <> 'deactivated'
  on conflict (user_id, kind) where status = 'open' do nothing;
end; $$;

-- ── 6. Access rules ──────────────────────────────────────────
alter table public.bridging_schools enable row level security;
alter table public.bridging_subjects enable row level security;
alter table public.bridging_profiles enable row level security;
alter table public.bridging_teacher_levels enable row level security;
alter table public.bridging_teacher_subjects enable row level security;
alter table public.bridging_links enable row level security;
alter table public.bridging_requests enable row level security;
alter table public.bridging_notices enable row level security;
alter table public.bridging_settings enable row level security;
alter table public.bridging_consents enable row level security;
alter table public.bridging_attempts enable row level security;

revoke all on table public.bridging_schools, public.bridging_subjects, public.bridging_profiles, public.bridging_teacher_levels, public.bridging_teacher_subjects,
  public.bridging_links, public.bridging_requests, public.bridging_notices, public.bridging_settings, public.bridging_consents, public.bridging_attempts from public, anon, authenticated;
-- a signed-in person may read their own rows; nobody may change a table directly
grant select on table public.bridging_profiles, public.bridging_teacher_levels, public.bridging_teacher_subjects, public.bridging_links, public.bridging_requests, public.bridging_consents to authenticated;

drop policy if exists "own profile" on public.bridging_profiles;
create policy "own profile" on public.bridging_profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own levels" on public.bridging_teacher_levels;
create policy "own levels" on public.bridging_teacher_levels for select to authenticated using (teacher_id = (select auth.uid()));
drop policy if exists "own subjects" on public.bridging_teacher_subjects;
create policy "own subjects" on public.bridging_teacher_subjects for select to authenticated using (teacher_id = (select auth.uid()));
drop policy if exists "own link" on public.bridging_links;
create policy "own link" on public.bridging_links for select to authenticated using (student_id = (select auth.uid()));
drop policy if exists "own requests" on public.bridging_requests;
create policy "own requests" on public.bridging_requests for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own consents" on public.bridging_consents;
create policy "own consents" on public.bridging_consents for select to authenticated using (user_id = (select auth.uid()));

revoke all on function public._bridging_level_fits(text, uuid), public._bridging_text(text, text, integer), public._bridging_latest_notice(), public._bridging_me(),
  public._bridging_record_consent(uuid, jsonb, boolean), public._bridging_set_teacher(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.bridging_register(uuid, jsonb), public.bridging_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.bridging_register(uuid, jsonb), public.bridging_rate_limit(text, text, integer, integer) to service_role;
revoke all on function public.bridging_options(), public.bridging_teachers(uuid, text), public.bridging_me(), public.bridging_accept_notice(jsonb),
  public.bridging_update_profile(jsonb), public.bridging_choose_teacher(jsonb), public.bridging_request(text, jsonb), public.bridging_cancel_request(text), public.bridging_forgot_password(text)
  from public, anon, authenticated;
grant execute on function public.bridging_options(), public.bridging_teachers(uuid, text), public.bridging_forgot_password(text) to anon, authenticated;
grant execute on function public.bridging_options() to service_role;
grant execute on function public.bridging_me(), public.bridging_accept_notice(jsonb), public.bridging_update_profile(jsonb),
  public.bridging_choose_teacher(jsonb), public.bridging_request(text, jsonb), public.bridging_cancel_request(text) to authenticated;

notify pgrst, 'reload schema';
commit;
