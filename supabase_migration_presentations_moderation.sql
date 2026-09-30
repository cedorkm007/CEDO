-- ─────────────────────────────────────────────────────────────
-- supabase_migration_presentations_moderation.sql
--
-- Phase 5 of "My Presentations" -- moderation half: a basic profanity
-- filter on Word Cloud submissions, and a presenter-only "hide this
-- entry" toggle (the `hidden` column already exists on
-- presentation_responses since Phase 4, added early so this phase would
-- be additive rather than a migration rewrite).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- A deliberately short, common-English blocklist -- "basic" per the
-- spec, not an exhaustive/localized moderation system. Matches on the
-- whole word after stripping to lowercase letters only, so punctuation/
-- leetspeak-lite ("f*ck", "sh1t") isn't a bypass for the plain cases,
-- but this is intentionally simple, not adversarial-proof.
create or replace function public.is_profane_word(p_word text)
returns boolean
language sql
immutable
as $$
  select lower(regexp_replace(p_word, '[^a-zA-Z]', '', 'g')) = any (array[
    'fuck','fucking','fucker','shit','bullshit','bitch','asshole','bastard',
    'dick','pussy','cunt','slut','whore','nigger','nigga','fag','faggot','retard'
  ]);
$$;

create or replace function public.set_response_hidden(p_response_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.presentation_responses r
  set hidden = p_hidden
  from public.presentation_sessions s, public.presentations p
  where r.id = p_response_id and r.session_id = s.id and s.presentation_id = p.id and p.owner_id = auth.uid();
end;
$$;
grant execute on function public.set_response_hidden(uuid, boolean) to authenticated;

-- submit_presentation_response, unchanged except one added check in the
-- word_cloud branch (reject if any submitted word matches the blocklist)
-- -- copy of the Phase 4 body from supabase_migration_presentations_sessions.sql.
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
      if public.is_profane_word(v_word) then
        return jsonb_build_object('ok', false, 'error', 'Please keep submissions appropriate.');
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
