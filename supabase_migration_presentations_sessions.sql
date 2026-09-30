-- ─────────────────────────────────────────────────────────────
-- supabase_migration_presentations_sessions.sql
--
-- Phase 4 of "My Presentations" -- live sessions, join codes, and
-- anonymous audience voting. Per the approved plan's design:
--
-- - The presenter (staff, authenticated) manages a session entirely
--   through owner-checked security-definer RPCs. presentation_sessions/
--   presentation_responses keep owner-only RLS (join through
--   presentations.owner_id = auth.uid()) -- staff never gets a raw
--   anon-facing table grant.
-- - The audience (anonymous, no login -- genuinely new ground in this
--   codebase, confirmed via research that no anon-write pattern existed
--   anywhere before this) interacts ONLY through three narrowly-scoped
--   RPCs granted to anon: join_presentation_session (resolve a 6-digit
--   code), get_presentation_session_state (polling -- the audience
--   client re-checks this every couple seconds rather than an anon
--   realtime subscription, since there's no precedent in this schema
--   for authorizing postgres_changes for unauthenticated clients), and
--   submit_presentation_response (validates + upserts, one row per
--   device per slide via the unique constraint).
-- - A returned "slide" never includes multiple_choice's correctIndexes
--   -- the audience is never shown the answer key.
-- - The presenter's OWN live results view uses the proven
--   useRealtimeRefresh pattern (same as WordCloudLiveView.tsx), since
--   they're an authenticated owner reading their own data -- only
--   presentation_responses needs realtime registration for that.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.presentation_sessions (
  id                uuid primary key default gen_random_uuid(),
  presentation_id   uuid not null references public.presentations(id) on delete cascade,
  join_code         text not null,
  status            text not null default 'active' check (status in ('active', 'ended')),
  current_slide_id  uuid references public.presentation_slides(id),
  show_results      boolean not null default true,
  voting_locked     boolean not null default false,
  created_at        timestamptz not null default now(),
  ended_at          timestamptz
);

-- Uniqueness only matters while a code is live -- an ended session's
-- code is free to be reused later (same idea as most polling tools).
create index if not exists idx_presentation_sessions_active_code on public.presentation_sessions (join_code) where status = 'active';
create index if not exists idx_presentation_sessions_presentation on public.presentation_sessions (presentation_id);

create table if not exists public.presentation_responses (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.presentation_sessions(id) on delete cascade,
  slide_id    uuid not null references public.presentation_slides(id) on delete cascade,
  device_id   text not null,
  response    jsonb not null,
  hidden      boolean not null default false, -- presenter moderation, added later in Phase 5 -- column exists now so that phase is additive, not a migration rewrite
  created_at  timestamptz not null default now(),
  unique (session_id, slide_id, device_id)
);

create index if not exists idx_presentation_responses_session_slide on public.presentation_responses (session_id, slide_id);

alter table public.presentation_sessions enable row level security;
alter table public.presentation_responses enable row level security;

drop policy if exists "owner manages own sessions" on public.presentation_sessions;
create policy "owner manages own sessions" on public.presentation_sessions for all
  using (exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid()));

drop policy if exists "owner reads own responses" on public.presentation_responses;
create policy "owner reads own responses" on public.presentation_responses for select
  using (exists (
    select 1 from public.presentation_sessions s join public.presentations p on p.id = s.presentation_id
    where s.id = session_id and p.owner_id = auth.uid()
  ));

-- ── Join code generation ────────────────────────────────────────
create or replace function public.generate_presentation_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_attempts integer := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    v_code := lpad(floor(random() * 1000000)::text, 6, '0');
    exit when not exists (select 1 from public.presentation_sessions where join_code = v_code and status = 'active');
    if v_attempts > 50 then
      raise exception 'Could not generate a unique join code after % attempts.', v_attempts;
    end if;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.generate_presentation_join_code() from public;

-- ── Presenter-side RPCs (owner-checked, authenticated only) ─────
create or replace function public.start_presentation_session(p_presentation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_existing public.presentation_sessions%rowtype;
  v_first_slide uuid;
  v_code text;
  v_session_id uuid;
begin
  select owner_id into v_owner from public.presentations where id = p_presentation_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Not authorized to present this presentation.';
  end if;

  select * into v_existing from public.presentation_sessions where presentation_id = p_presentation_id and status = 'active' limit 1;
  if found then
    return jsonb_build_object('sessionId', v_existing.id, 'joinCode', v_existing.join_code);
  end if;

  select id into v_first_slide from public.presentation_slides where presentation_id = p_presentation_id order by order_index limit 1;
  v_code := public.generate_presentation_join_code();

  insert into public.presentation_sessions (presentation_id, join_code, current_slide_id)
  values (p_presentation_id, v_code, v_first_slide)
  returning id into v_session_id;

  return jsonb_build_object('sessionId', v_session_id, 'joinCode', v_code);
end;
$$;
grant execute on function public.start_presentation_session(uuid) to authenticated;

create or replace function public.end_presentation_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.presentation_sessions s
  set status = 'ended', ended_at = now()
  from public.presentations p
  where s.id = p_session_id and s.presentation_id = p.id and p.owner_id = auth.uid();
end;
$$;
grant execute on function public.end_presentation_session(uuid) to authenticated;

create or replace function public.set_presentation_session_slide(p_session_id uuid, p_slide_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.presentation_sessions s
  set current_slide_id = p_slide_id
  from public.presentations p
  where s.id = p_session_id and s.presentation_id = p.id and p.owner_id = auth.uid();
end;
$$;
grant execute on function public.set_presentation_session_slide(uuid, uuid) to authenticated;

create or replace function public.set_presentation_session_state(p_session_id uuid, p_show_results boolean default null, p_voting_locked boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.presentation_sessions s
  set show_results = coalesce(p_show_results, s.show_results),
      voting_locked = coalesce(p_voting_locked, s.voting_locked)
  from public.presentations p
  where s.id = p_session_id and s.presentation_id = p.id and p.owner_id = auth.uid();
end;
$$;
grant execute on function public.set_presentation_session_state(uuid, boolean, boolean) to authenticated;

create or replace function public.reset_slide_responses(p_session_id uuid, p_slide_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.presentation_responses r
  using public.presentation_sessions s, public.presentations p
  where r.session_id = s.id and s.id = p_session_id and r.slide_id = p_slide_id
    and s.presentation_id = p.id and p.owner_id = auth.uid();
end;
$$;
grant execute on function public.reset_slide_responses(uuid, uuid) to authenticated;

-- ── Audience-facing helper: a slide's public, answer-key-free shape ──
create or replace function public._public_slide_json(p_slide_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when type = 'multiple_choice' then jsonb_build_object(
      'id', id, 'type', type,
      'settings', jsonb_build_object(
        'question', settings->>'question',
        'options', coalesce(settings->'options', '[]'::jsonb),
        'allowMultiple', coalesce(settings->'allowMultiple', 'false'::jsonb)
      )
    )
    else jsonb_build_object('id', id, 'type', type, 'settings', settings)
  end
  from public.presentation_slides where id = p_slide_id;
$$;
revoke all on function public._public_slide_json(uuid) from public;

-- ── Audience-facing RPCs (anon + authenticated) ──────────────────
create or replace function public.join_presentation_session(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.presentation_sessions%rowtype;
  v_title text;
begin
  select * into v_session from public.presentation_sessions where join_code = trim(p_join_code) and status = 'active';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select title into v_title from public.presentations where id = v_session.presentation_id;
  return jsonb_build_object(
    'found', true,
    'sessionId', v_session.id,
    'presentationTitle', v_title,
    'showResults', v_session.show_results,
    'votingLocked', v_session.voting_locked,
    'slide', case when v_session.current_slide_id is null then null else public._public_slide_json(v_session.current_slide_id) end
  );
end;
$$;
grant execute on function public.join_presentation_session(text) to anon, authenticated;

create or replace function public.get_presentation_session_state(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.presentation_sessions%rowtype;
begin
  select * into v_session from public.presentation_sessions where id = p_session_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'status', v_session.status,
    'showResults', v_session.show_results,
    'votingLocked', v_session.voting_locked,
    'slide', case when v_session.current_slide_id is null then null else public._public_slide_json(v_session.current_slide_id) end
  );
end;
$$;
grant execute on function public.get_presentation_session_state(uuid) to anon, authenticated;

create or replace function public.submit_presentation_response(p_session_id uuid, p_device_id text, p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.presentation_sessions%rowtype;
  v_slide public.presentation_slides%rowtype;
  v_word text;
  v_words jsonb;
  v_max_words integer;
  v_max_chars integer;
  v_selected jsonb;
  v_option_count integer;
  v_order jsonb;
  v_item_count integer;
  v_seen int[];
  v_expected int[];
  v_idx int;
begin
  if p_device_id is null or length(trim(p_device_id)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Missing device id.');
  end if;

  select * into v_session from public.presentation_sessions where id = p_session_id;
  if not found or v_session.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'This session has ended.');
  end if;
  if v_session.voting_locked then
    return jsonb_build_object('ok', false, 'error', 'Voting is currently locked.');
  end if;
  if v_session.current_slide_id is null then
    return jsonb_build_object('ok', false, 'error', 'No active slide.');
  end if;

  select * into v_slide from public.presentation_slides where id = v_session.current_slide_id;

  if v_slide.type = 'word_cloud' then
    v_words := p_response->'words';
    v_max_words := coalesce((v_slide.settings->>'maxWordsPerPerson')::int, 1);
    v_max_chars := coalesce((v_slide.settings->>'maxCharsPerWord')::int, 40);
    if v_words is null or jsonb_typeof(v_words) <> 'array' or jsonb_array_length(v_words) = 0 then
      return jsonb_build_object('ok', false, 'error', 'Enter at least one word.');
    end if;
    if jsonb_array_length(v_words) > v_max_words then
      return jsonb_build_object('ok', false, 'error', format('You can submit up to %s word(s).', v_max_words));
    end if;
    for v_word in select jsonb_array_elements_text(v_words) loop
      if length(trim(v_word)) = 0 then
        return jsonb_build_object('ok', false, 'error', 'Words can''t be empty.');
      end if;
      if length(v_word) > v_max_chars then
        return jsonb_build_object('ok', false, 'error', format('Keep each word to %s characters or fewer.', v_max_chars));
      end if;
    end loop;

  elsif v_slide.type = 'multiple_choice' then
    v_selected := p_response->'selectedIndexes';
    v_option_count := jsonb_array_length(coalesce(v_slide.settings->'options', '[]'::jsonb));
    if v_selected is null or jsonb_typeof(v_selected) <> 'array' or jsonb_array_length(v_selected) = 0 then
      return jsonb_build_object('ok', false, 'error', 'Select at least one option.');
    end if;
    if not coalesce((v_slide.settings->'allowMultiple')::boolean, false) and jsonb_array_length(v_selected) > 1 then
      return jsonb_build_object('ok', false, 'error', 'This question only allows one selection.');
    end if;
    for v_idx in select jsonb_array_elements_text(v_selected)::int loop
      if v_idx < 0 or v_idx >= v_option_count then
        return jsonb_build_object('ok', false, 'error', 'Invalid option selected.');
      end if;
    end loop;

  elsif v_slide.type = 'ranking' then
    v_order := p_response->'order';
    v_item_count := jsonb_array_length(coalesce(v_slide.settings->'items', '[]'::jsonb));
    if v_order is null or jsonb_typeof(v_order) <> 'array' or jsonb_array_length(v_order) <> v_item_count then
      return jsonb_build_object('ok', false, 'error', 'Please rank every item.');
    end if;
    select array_agg(x order by x) into v_seen from (select (elem)::int as x from jsonb_array_elements_text(v_order) as elem) t;
    select array_agg(n) into v_expected from generate_series(0, v_item_count - 1) as n;
    if v_seen is distinct from v_expected then
      return jsonb_build_object('ok', false, 'error', 'Invalid ranking order.');
    end if;

  else
    return jsonb_build_object('ok', false, 'error', 'This slide does not accept responses.');
  end if;

  insert into public.presentation_responses (session_id, slide_id, device_id, response)
  values (p_session_id, v_session.current_slide_id, p_device_id, p_response)
  on conflict (session_id, slide_id, device_id) do update set response = excluded.response, created_at = now();

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.submit_presentation_response(uuid, text, jsonb) to anon, authenticated;

-- ── Realtime: the presenter's own live results view (authenticated,
-- owner-scoped, same proven pattern as WordCloudLiveView.tsx) needs
-- postgres_changes on presentation_responses. The audience side uses
-- polling, not realtime, so presentation_sessions doesn't need this.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'presentation_responses'
  ) then
    alter publication supabase_realtime add table public.presentation_responses;
  end if;
end $$;
