-- ─────────────────────────────────────────────────────────────
-- supabase_migration_my_surveys_builder.sql
--
-- Phase 2 of "My Surveys": the survey builder's load/save functions.
-- Requires supabase_migration_my_surveys_core.sql (Phase 1) to be run first.
--
-- The builder works on ONE ordered list of "items": a section header starts a
-- section, and every question after it belongs to that section until the next
-- header (same model as Google Forms). Items are saved as a whole through
-- save_my_survey(), which is a single atomic transaction, so a half-saved
-- survey can never exist.
--
-- What save_my_survey() guarantees:
--   * Permissions: only the owner and editors may save (checked here, on every
--     call -- the function is security definer, so it does its own check).
--   * Edit conflicts: the caller sends the revision it last saw. If someone else
--     has saved since, nothing is written and {conflict: true} comes back, so
--     the client can warn instead of silently overwriting their work.
--     (p_force = true is the explicit "keep my version" choice.)
--     The survey row is locked for the duration, so two saves can't interleave.
--   * Question versioning: a question that already has answers is never
--     rewritten. If its wording, type, scale, or set of options changes, the old
--     row is archived and a new row (same question_key, version + 1) takes its
--     place; old answers stay attached to the old version. Changes that don't
--     alter meaning (required, help text, position, option order) update in
--     place. A question with answers that is deleted is archived, not deleted.
--     A new version has no answers yet, so further edits to it are in place --
--     typing in the question box never produces a pile of versions.
--   * Ids: new items use ids the client generated; when a question is versioned
--     the server returns {old id -> new id} maps for questions and options.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── Load ────────────────────────────────────────────────────
-- security INVOKER: RLS decides whether the caller can see the survey at all
-- (returns null if not). hasResponses tells the builder which questions carry
-- answers (so it can show the "saves as a new version" note).

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

-- ── Save ────────────────────────────────────────────────────

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
          or v_db_labels <> v_doc_labels;

        if v_has_answers and v_changed then
          -- New version replaces the old one; old answers stay on the old row.
          update public.my_survey_questions set archived_at = now() where id = v_id;
          v_new_q := gen_random_uuid();
          insert into public.my_survey_questions (
            id, survey_id, section_id, question_key, version, order_index, question_type, question_text,
            help_text, required, scale_min, scale_max, scale_min_label, scale_max_label
          ) values (
            v_new_q, p_survey_id, v_current_section, v_existing.question_key, v_existing.version + 1, v_pos, v_type, v_text,
            v_help, v_required, v_smin, v_smax, v_smin_label, v_smax_label
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
              scale_min_label = v_smin_label, scale_max_label = v_smax_label
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
          help_text, required, scale_min, scale_max, scale_min_label, scale_max_label
        ) values (
          v_id, p_survey_id, v_current_section, v_key, 1, v_pos, v_type, v_text,
          v_help, v_required, v_smin, v_smax, v_smin_label, v_smax_label
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
