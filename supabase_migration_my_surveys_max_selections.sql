-- ─────────────────────────────────────────────────────────────
-- supabase_migration_my_surveys_max_selections.sql
--
-- My Surveys: an optional "select up to N" limit on Checkboxes questions.
--
--   * my_survey_questions.max_selections (null = no limit; only used by checkboxes questions).
--   * get_my_survey_doc / get_public_survey return it as "maxSelections".
--   * save_my_survey stores it (1-100, checkboxes only). On a question that already has responses, changing the limit
--     saves the question as a new version, the same as changing its wording or options, so earlier answers (given under
--     the old rule) stay with the version they answered.
--   * submit_my_survey_response refuses an answer that selects more options than the limit - the real check; the
--     respondent page only helps people stay within it.
--
-- The four functions are copies of the latest definitions in supabase_migration_my_surveys_builder.sql and
-- supabase_migration_my_surveys_publishing.sql with only the changes above. Nothing is deleted; existing questions keep
-- no limit. Run AFTER those migrations. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.my_survey_questions add column if not exists max_selections integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'my_survey_questions_max_selections_check') then
    alter table public.my_survey_questions
      add constraint my_survey_questions_max_selections_check check (max_selections is null or max_selections between 1 and 100);
  end if;
end $$;

create or replace function public.get_my_survey_doc(p_survey_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_s public.my_surveys%rowtype;
  v_items jsonb;
begin
  select * into v_s from public.my_surveys where id = p_survey_id;
  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(t.item order by t.ord, t.kind_rank), '[]'::jsonb)
  into v_items
  from (
    select s.order_index as ord, 0 as kind_rank,
           jsonb_build_object('kind', 'section', 'id', s.id, 'title', s.title, 'description', s.description) as item
    from public.my_survey_sections s
    where s.survey_id = p_survey_id
    union all
    select q.order_index, 1,
           jsonb_build_object(
             'kind', 'question', 'id', q.id, 'questionKey', q.question_key, 'version', q.version,
             'type', q.question_type, 'text', q.question_text, 'helpText', q.help_text,
             'required', q.required, 'scaleMin', q.scale_min, 'scaleMax', q.scale_max,
             'scaleMinLabel', q.scale_min_label, 'scaleMaxLabel', q.scale_max_label,
             'maxSelections', q.max_selections,
             'hasResponses', exists (select 1 from public.my_survey_answers a where a.question_id = q.id),
             'options', coalesce((
               select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.order_index, o.created_at)
               from public.my_survey_options o where o.question_id = q.id
             ), '[]'::jsonb)
           )
    from public.my_survey_questions q
    where q.survey_id = p_survey_id and q.archived_at is null
  ) t;

  return jsonb_build_object(
    'id', v_s.id,
    'ownerId', v_s.owner_id,
    'title', v_s.title,
    'description', v_s.description,
    'status', v_s.status,
    'consentEnabled', v_s.consent_enabled,
    'consentText', v_s.consent_text,
    'revision', v_s.revision,
    'role', public.my_survey_role(p_survey_id),
    'updatedAt', v_s.updated_at,
    'lastEditedByName', (
      select nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')
      from public.users u where u.id = v_s.last_edited_by
    ),
    'responseCount', (select count(*) from public.my_survey_responses r where r.survey_id = p_survey_id),
    'items', v_items
  );
end;
$$;
revoke execute on function public.get_my_survey_doc(uuid) from public, anon;
grant execute on function public.get_my_survey_doc(uuid) to authenticated;

create or replace function public.save_my_survey(
  p_survey_id uuid,
  p_expected_revision integer,
  p_doc jsonb,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_s public.my_surveys%rowtype;
  v_items jsonb;
  v_item jsonb;
  v_pos integer := 0;
  v_current_section uuid := null;
  v_kind text;
  v_id uuid;
  v_type text;
  v_text text;
  v_help text;
  v_required boolean;
  v_smin integer;
  v_smax integer;
  v_smin_label text;
  v_smax_label text;
  v_max integer;
  v_opts jsonb;
  v_opt jsonb;
  v_opt_pos integer;
  v_opt_id uuid;
  v_new_q uuid;
  v_new_o uuid;
  v_existing public.my_survey_questions%rowtype;
  v_has_answers boolean;
  v_changed boolean;
  v_db_labels text[];
  v_doc_labels text[];
  v_key uuid;
  v_seen_questions uuid[] := '{}';
  v_seen_sections uuid[] := '{}';
  v_q_remap jsonb := '{}'::jsonb;
  v_o_remap jsonb := '{}'::jsonb;
  v_doc_option_ids uuid[];
  v_stale record;
  v_title text;
  v_rev integer;
  v_updated timestamptz;
begin
  v_role := public.my_survey_role(p_survey_id);
  if v_role is null or v_role not in ('owner', 'editor') then
    raise exception 'You do not have permission to edit this survey.';
  end if;

  -- Lock the survey row: concurrent saves of the same survey run one at a time.
  select * into v_s from public.my_surveys where id = p_survey_id for update;

  if not p_force and p_expected_revision is distinct from v_s.revision then
    return jsonb_build_object(
      'ok', false, 'conflict', true,
      'revision', v_s.revision,
      'updatedAt', v_s.updated_at,
      'editedByName', (
        select nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')
        from public.users u where u.id = v_s.last_edited_by
      )
    );
  end if;

  v_items := coalesce(p_doc -> 'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 500 then
    raise exception 'Invalid survey content (too many items).';
  end if;

  for v_item in select value from jsonb_array_elements(v_items) loop
    v_pos := v_pos + 1;
    v_kind := v_item ->> 'kind';
    v_id := (v_item ->> 'id')::uuid;

    if v_kind = 'section' then
      if exists (select 1 from public.my_survey_sections where id = v_id and survey_id <> p_survey_id) then
        raise exception 'Invalid section.';
      end if;
      insert into public.my_survey_sections (id, survey_id, title, description, order_index)
      values (v_id, p_survey_id, left(coalesce(v_item ->> 'title', ''), 200), left(coalesce(v_item ->> 'description', ''), 2000), v_pos)
      on conflict (id) do update
        set title = excluded.title, description = excluded.description, order_index = excluded.order_index;
      v_seen_sections := v_seen_sections || v_id;
      v_current_section := v_id;

    elsif v_kind = 'question' then
      v_type := v_item ->> 'type';
      if v_type is null or v_type not in ('short_answer', 'paragraph', 'multiple_choice', 'checkboxes', 'dropdown', 'linear_scale', 'rating', 'date', 'time') then
        raise exception 'Unknown question type "%".', coalesce(v_type, '');
      end if;
      v_text := left(coalesce(v_item ->> 'text', ''), 2000);
      v_help := left(coalesce(v_item ->> 'helpText', ''), 1000);
      v_required := coalesce((v_item ->> 'required')::boolean, false);

      v_smin := null; v_smax := null; v_smin_label := ''; v_smax_label := '';
      if v_type = 'linear_scale' then
        v_smin := coalesce((v_item ->> 'scaleMin')::integer, 1);
        v_smax := coalesce((v_item ->> 'scaleMax')::integer, 5);
        if v_smin not in (0, 1) or v_smax < 2 or v_smax > 10 or v_smax <= v_smin then
          raise exception 'Invalid linear scale range.';
        end if;
        v_smin_label := left(coalesce(v_item ->> 'scaleMinLabel', ''), 100);
        v_smax_label := left(coalesce(v_item ->> 'scaleMaxLabel', ''), 100);
      elsif v_type = 'rating' then
        v_smin := 1;
        v_smax := coalesce((v_item ->> 'scaleMax')::integer, 5);
        if v_smax < 3 or v_smax > 10 then
          raise exception 'Invalid rating size.';
        end if;
      end if;

      -- "Select up to N" limit: checkboxes only.
      v_max := null;
      if v_type = 'checkboxes' and nullif(btrim(coalesce(v_item ->> 'maxSelections', '')), '') is not null then
        v_max := (v_item ->> 'maxSelections')::integer;
        if v_max < 1 or v_max > 100 then
          raise exception 'Invalid selection limit.';
        end if;
      end if;

      if v_type in ('multiple_choice', 'checkboxes', 'dropdown') then
        v_opts := coalesce(v_item -> 'options', '[]'::jsonb);
        if jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) > 100 then
          raise exception 'Too many options.';
        end if;
      else
        v_opts := '[]'::jsonb;
      end if;

      select coalesce(array_agg(lbl order by lbl), '{}')
      into v_doc_labels
      from (select left(coalesce(o ->> 'label', ''), 500) as lbl from jsonb_array_elements(v_opts) o) x;

      select * into v_existing from public.my_survey_questions where id = v_id;

      if found then
        if v_existing.survey_id <> p_survey_id then
          raise exception 'Invalid question.';
        end if;
        if v_existing.archived_at is not null then
          raise exception 'A question was replaced by a newer version while you were editing. Reload the survey.';
        end if;

        v_has_answers := exists (select 1 from public.my_survey_answers where question_id = v_id);
        select coalesce(array_agg(label order by label), '{}') into v_db_labels
        from public.my_survey_options where question_id = v_id;

        v_changed := v_existing.question_type <> v_type
          or v_existing.question_text <> v_text
          or v_existing.scale_min is distinct from v_smin
          or v_existing.scale_max is distinct from v_smax
          or v_existing.scale_min_label <> v_smin_label
          or v_existing.scale_max_label <> v_smax_label
          or v_existing.max_selections is distinct from v_max
          or v_db_labels <> v_doc_labels;

        if v_has_answers and v_changed then
          -- New version replaces the old one; old answers stay on the old row.
          update public.my_survey_questions set archived_at = now() where id = v_id;
          v_new_q := gen_random_uuid();
          insert into public.my_survey_questions (
            id, survey_id, section_id, question_key, version, order_index, question_type, question_text,
            help_text, required, scale_min, scale_max, scale_min_label, scale_max_label, max_selections
          ) values (
            v_new_q, p_survey_id, v_current_section, v_existing.question_key, v_existing.version + 1, v_pos, v_type, v_text,
            v_help, v_required, v_smin, v_smax, v_smin_label, v_smax_label, v_max
          );
          v_opt_pos := 0;
          for v_opt in select value from jsonb_array_elements(v_opts) loop
            v_opt_pos := v_opt_pos + 1;
            v_new_o := gen_random_uuid();
            insert into public.my_survey_options (id, question_id, survey_id, label, order_index)
            values (v_new_o, v_new_q, p_survey_id, left(coalesce(v_opt ->> 'label', ''), 500), v_opt_pos);
            if v_opt ->> 'id' is not null then
              v_o_remap := v_o_remap || jsonb_build_object(v_opt ->> 'id', v_new_o);
            end if;
          end loop;
          v_q_remap := v_q_remap || jsonb_build_object(v_id::text, v_new_q);
          v_seen_questions := v_seen_questions || v_id || v_new_q;
        else
          update public.my_survey_questions
          set section_id = v_current_section, order_index = v_pos, question_type = v_type, question_text = v_text,
              help_text = v_help, required = v_required, scale_min = v_smin, scale_max = v_smax,
              scale_min_label = v_smin_label, scale_max_label = v_smax_label, max_selections = v_max
          where id = v_id;

          if v_has_answers then
            -- Options can't have changed meaning (checked above): only keep their order in sync.
            v_opt_pos := 0;
            for v_opt in select value from jsonb_array_elements(v_opts) loop
              v_opt_pos := v_opt_pos + 1;
              update public.my_survey_options set order_index = v_opt_pos
              where id = (v_opt ->> 'id')::uuid and question_id = v_id;
            end loop;
          else
            select coalesce(array_agg((o ->> 'id')::uuid), '{}') into v_doc_option_ids
            from jsonb_array_elements(v_opts) o where o ->> 'id' is not null;
            delete from public.my_survey_options where question_id = v_id and id <> all(v_doc_option_ids);
            v_opt_pos := 0;
            for v_opt in select value from jsonb_array_elements(v_opts) loop
              v_opt_pos := v_opt_pos + 1;
              v_opt_id := coalesce((v_opt ->> 'id')::uuid, gen_random_uuid());
              if exists (select 1 from public.my_survey_options where id = v_opt_id and question_id <> v_id) then
                raise exception 'Invalid option.';
              end if;
              insert into public.my_survey_options (id, question_id, survey_id, label, order_index)
              values (v_opt_id, v_id, p_survey_id, left(coalesce(v_opt ->> 'label', ''), 500), v_opt_pos)
              on conflict (id) do update set label = excluded.label, order_index = excluded.order_index;
            end loop;
          end if;
          v_seen_questions := v_seen_questions || v_id;
        end if;

      else
        -- Brand-new question (client-generated ids).
        v_key := coalesce((v_item ->> 'questionKey')::uuid, gen_random_uuid());
        insert into public.my_survey_questions (
          id, survey_id, section_id, question_key, version, order_index, question_type, question_text,
          help_text, required, scale_min, scale_max, scale_min_label, scale_max_label, max_selections
        ) values (
          v_id, p_survey_id, v_current_section, v_key, 1, v_pos, v_type, v_text,
          v_help, v_required, v_smin, v_smax, v_smin_label, v_smax_label, v_max
        );
        v_opt_pos := 0;
        for v_opt in select value from jsonb_array_elements(v_opts) loop
          v_opt_pos := v_opt_pos + 1;
          insert into public.my_survey_options (id, question_id, survey_id, label, order_index)
          values (coalesce((v_opt ->> 'id')::uuid, gen_random_uuid()), v_id, p_survey_id, left(coalesce(v_opt ->> 'label', ''), 500), v_opt_pos);
        end loop;
        v_seen_questions := v_seen_questions || v_id;
      end if;

    else
      raise exception 'Unknown item kind.';
    end if;
  end loop;

  -- Questions that are no longer in the list: archive if they carry answers, else delete.
  for v_stale in
    select q.id from public.my_survey_questions q
    where q.survey_id = p_survey_id and q.archived_at is null and q.id <> all(v_seen_questions)
  loop
    if exists (select 1 from public.my_survey_answers where question_id = v_stale.id) then
      update public.my_survey_questions set archived_at = now() where id = v_stale.id;
    else
      delete from public.my_survey_questions where id = v_stale.id;
    end if;
  end loop;
  delete from public.my_survey_sections where survey_id = p_survey_id and id <> all(v_seen_sections);

  v_title := left(trim(coalesce(p_doc ->> 'title', '')), 200);
  if v_title = '' then v_title := 'Untitled survey'; end if;

  -- One update of the survey row: the guard trigger bumps the revision exactly once
  -- and stamps who edited.
  update public.my_surveys
  set title = v_title,
      description = left(coalesce(p_doc ->> 'description', ''), 5000),
      consent_enabled = coalesce((p_doc ->> 'consentEnabled')::boolean, consent_enabled),
      consent_text = left(coalesce(p_doc ->> 'consentText', consent_text), 5000)
  where id = p_survey_id
  returning revision, updated_at into v_rev, v_updated;

  return jsonb_build_object(
    'ok', true,
    'revision', v_rev,
    'updatedAt', v_updated,
    'editedByName', (
      select nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')
      from public.users u where u.id = auth.uid()
    ),
    'remap', jsonb_build_object('questions', v_q_remap, 'options', v_o_remap)
  );
end;
$$;
revoke execute on function public.save_my_survey(uuid, integer, jsonb, boolean) from public, anon;
grant execute on function public.save_my_survey(uuid, integer, jsonb, boolean) to authenticated;

create or replace function public.get_public_survey(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.my_surveys%rowtype;
  v_items jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]{6,32}$' then
    return jsonb_build_object('state', 'not_found');
  end if;

  select * into v_s from public.my_surveys where public_slug = p_slug;
  if not found or v_s.status = 'draft' then
    return jsonb_build_object('state', 'not_found');
  end if;

  -- Close lazily when the closing date has passed or the response limit is reached.
  if v_s.status = 'open' and (
       (v_s.closes_at is not null and v_s.closes_at <= now())
       or (v_s.response_limit is not null
           and (select count(*) from public.my_survey_responses r where r.survey_id = v_s.id) >= v_s.response_limit)
     ) then
    update public.my_surveys set status = 'closed' where id = v_s.id;
    v_s.status := 'closed';
  end if;

  if v_s.status <> 'open' then
    return jsonb_build_object('state', 'closed', 'title', v_s.title);
  end if;

  select coalesce(jsonb_agg(t.item order by t.ord, t.kind_rank), '[]'::jsonb)
  into v_items
  from (
    select s.order_index as ord, 0 as kind_rank,
           jsonb_build_object('kind', 'section', 'id', s.id, 'title', s.title, 'description', s.description) as item
    from public.my_survey_sections s
    where s.survey_id = v_s.id
    union all
    select q.order_index, 1,
           jsonb_build_object(
             'kind', 'question', 'id', q.id, 'questionKey', q.question_key, 'type', q.question_type,
             'text', q.question_text, 'helpText', q.help_text, 'required', q.required,
             'scaleMin', q.scale_min, 'scaleMax', q.scale_max,
             'scaleMinLabel', q.scale_min_label, 'scaleMaxLabel', q.scale_max_label,
             'maxSelections', q.max_selections,
             'options', coalesce((
               select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.order_index, o.created_at)
               from public.my_survey_options o where o.question_id = q.id
             ), '[]'::jsonb)
           )
    from public.my_survey_questions q
    where q.survey_id = v_s.id and q.archived_at is null
  ) t;

  return jsonb_build_object(
    'state', 'open',
    'title', v_s.title,
    'description', v_s.description,
    'consentEnabled', v_s.consent_enabled,
    'consentText', v_s.consent_text,
    'thankYouMessage', v_s.thank_you_message,
    'oneResponsePerDevice', v_s.one_response_per_device,
    'items', v_items
  );
end;
$$;
revoke execute on function public.get_public_survey(text) from public;
grant execute on function public.get_public_survey(text) to anon, authenticated;

create or replace function public.submit_my_survey_response(
  p_slug text,
  p_device_id text,
  p_consent boolean,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.my_surveys%rowtype;
  v_device text;
  v_count integer;
  v_resp uuid;
  v_ans jsonb;
  v_q public.my_survey_questions%rowtype;
  v_seen_keys uuid[] := '{}';
  v_text text;
  v_num numeric;
  v_ids jsonb;
  v_oid uuid;
  v_oids uuid[];
  v_req record;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]{6,32}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Lock the survey row so the response limit and one-per-device rule hold under concurrent submissions.
  select * into v_s from public.my_surveys where public_slug = p_slug for update;
  if not found or v_s.status = 'draft' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_s.status <> 'open' or (v_s.closes_at is not null and v_s.closes_at <= now()) then
    if v_s.status = 'open' then update public.my_surveys set status = 'closed' where id = v_s.id; end if;
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  select count(*) into v_count from public.my_survey_responses where survey_id = v_s.id;
  if v_s.response_limit is not null and v_count >= v_s.response_limit then
    update public.my_surveys set status = 'closed' where id = v_s.id;
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  v_device := nullif(left(coalesce(p_device_id, ''), 100), '');
  if v_s.one_response_per_device then
    if v_device is null then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'message', 'Your browser did not provide a device id. Please reload the page and try again.');
    end if;
    if exists (select 1 from public.my_survey_responses where survey_id = v_s.id and device_id = v_device) then
      return jsonb_build_object('ok', false, 'error', 'duplicate');
    end if;
  end if;

  begin
    if v_s.consent_enabled and coalesce(p_consent, false) is not true then
      raise exception 'MYSURVEY:Please agree to the data privacy statement to submit.';
    end if;
    if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 500 then
      raise exception 'MYSURVEY:Your answers could not be read. Please reload the page and try again.';
    end if;

    insert into public.my_survey_responses (survey_id, device_id, consent_given)
    values (v_s.id, v_device, coalesce(p_consent, false))
    returning id into v_resp;

    for v_ans in select value from jsonb_array_elements(p_answers) loop
      select * into v_q from public.my_survey_questions
      where id = (v_ans ->> 'questionId')::uuid and survey_id = v_s.id;
      if not found then
        raise exception 'MYSURVEY:This survey was changed while you were answering. Please reload the page and try again.';
      end if;
      if v_q.question_key = any (v_seen_keys) then
        raise exception 'MYSURVEY:Your answers could not be read. Please reload the page and try again.';
      end if;
      v_seen_keys := v_seen_keys || v_q.question_key;

      if v_q.question_type in ('short_answer', 'paragraph') then
        v_text := btrim(coalesce(v_ans ->> 'text', ''));
        if char_length(v_text) > 5000 then raise exception 'MYSURVEY:An answer is too long.'; end if;
        if v_text <> '' then
          insert into public.my_survey_answers (response_id, survey_id, question_id, value_text) values (v_resp, v_s.id, v_q.id, v_text);
        end if;

      elsif v_q.question_type = 'date' then
        v_text := btrim(coalesce(v_ans ->> 'text', ''));
        if v_text <> '' then
          if v_text !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'MYSURVEY:A date answer is not valid.'; end if;
          perform v_text::date; -- raises on impossible dates like 2026-02-31
          insert into public.my_survey_answers (response_id, survey_id, question_id, value_text) values (v_resp, v_s.id, v_q.id, v_text);
        end if;

      elsif v_q.question_type = 'time' then
        v_text := btrim(coalesce(v_ans ->> 'text', ''));
        if v_text <> '' then
          if v_text !~ '^\d{2}:\d{2}(:\d{2})?$' then raise exception 'MYSURVEY:A time answer is not valid.'; end if;
          perform v_text::time;
          insert into public.my_survey_answers (response_id, survey_id, question_id, value_text) values (v_resp, v_s.id, v_q.id, v_text);
        end if;

      elsif v_q.question_type in ('multiple_choice', 'dropdown', 'checkboxes') then
        v_ids := coalesce(v_ans -> 'optionIds', '[]'::jsonb);
        if jsonb_typeof(v_ids) <> 'array' then raise exception 'MYSURVEY:Your answers could not be read. Please reload the page and try again.'; end if;
        if jsonb_array_length(v_ids) > 0 then
          if v_q.question_type <> 'checkboxes' and jsonb_array_length(v_ids) > 1 then
            raise exception 'MYSURVEY:Only one choice is allowed for a question.';
          end if;
          if v_q.question_type = 'checkboxes' and v_q.max_selections is not null and jsonb_array_length(v_ids) > v_q.max_selections then
            raise exception 'MYSURVEY:Please choose no more than % option% for "%".',
              v_q.max_selections, case when v_q.max_selections = 1 then '' else 's' end, left(v_q.question_text, 120);
          end if;
          v_oids := '{}';
          for v_oid in select (value #>> '{}')::uuid from jsonb_array_elements(v_ids) loop
            if v_oid = any (v_oids) or not exists (select 1 from public.my_survey_options where id = v_oid and question_id = v_q.id) then
              raise exception 'MYSURVEY:This survey was changed while you were answering. Please reload the page and try again.';
            end if;
            v_oids := v_oids || v_oid;
            insert into public.my_survey_answers (response_id, survey_id, question_id, option_id) values (v_resp, v_s.id, v_q.id, v_oid);
          end loop;
        end if;

      elsif v_q.question_type in ('linear_scale', 'rating') then
        if v_ans ->> 'number' is not null and btrim(v_ans ->> 'number') <> '' then
          v_num := (v_ans ->> 'number')::numeric;
          if v_num <> trunc(v_num) or v_num < coalesce(v_q.scale_min, 1) or v_num > v_q.scale_max then
            raise exception 'MYSURVEY:A scale answer is out of range.';
          end if;
          insert into public.my_survey_answers (response_id, survey_id, question_id, value_number) values (v_resp, v_s.id, v_q.id, v_num);
        end if;
      end if;
    end loop;

    -- Every required question that is current must have an answer (any version of it).
    for v_req in
      select q.question_key, q.question_text from public.my_survey_questions q
      where q.survey_id = v_s.id and q.archived_at is null and q.required
    loop
      if not exists (
        select 1 from public.my_survey_answers a
        join public.my_survey_questions q2 on q2.id = a.question_id
        where a.response_id = v_resp and q2.question_key = v_req.question_key
      ) then
        raise exception 'MYSURVEY:Please answer all required questions before submitting.';
      end if;
    end loop;

    -- Hitting the response limit closes the survey.
    if v_s.response_limit is not null and v_count + 1 >= v_s.response_limit then
      update public.my_surveys set status = 'closed' where id = v_s.id;
    end if;
  exception when others then
    -- The block above is one sub-transaction: the response and its answers are rolled back.
    return jsonb_build_object(
      'ok', false, 'error', 'invalid',
      'message', case when sqlerrm like 'MYSURVEY:%' then substr(sqlerrm, 10)
                      else 'Your answers could not be saved. Please check them and try again.' end
    );
  end;

  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.submit_my_survey_response(text, text, boolean, jsonb) from public;
grant execute on function public.submit_my_survey_response(text, text, boolean, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor).
select count(*) as checkboxes_questions, count(max_selections) as with_a_limit
from public.my_survey_questions where question_type = 'checkboxes';
