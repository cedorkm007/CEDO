-- ─────────────────────────────────────────────────────────────
-- supabase_migration_my_surveys_csv_import.sql
--
-- Phase 4 of "My Surveys": create a survey from an uploaded CSV template.
-- Requires the Phase 1 (core) and Phase 2 (builder) migrations.
--
-- The CSV is parsed and validated in the browser (so people get row-by-row
-- error messages before anything is created). This function is the "create"
-- step: it makes a new Draft survey owned by the caller and fills it from the
-- parsed document in ONE transaction. It reuses save_my_survey() for the filling,
-- so the server re-validates everything the CSV could get wrong (question
-- types, scale ranges, option counts, item limits) exactly as it does for the
-- builder. If anything fails the whole thing rolls back -- no half-made survey is
-- left behind.
--
-- Adds one function only; safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.create_my_survey_from_doc(p_doc jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_rev integer;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create a survey.';
  end if;

  insert into public.my_surveys (owner_id, last_edited_by)
  values (auth.uid(), auth.uid())
  returning id, revision into v_id, v_rev;

  -- save_my_survey checks the caller's role (the new owner passes) and validates the document.
  v_result := public.save_my_survey(v_id, v_rev, p_doc, false);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'The survey could not be created from the uploaded file.';
  end if;

  return v_id;
end;
$$;
revoke execute on function public.create_my_survey_from_doc(jsonb) from public, anon;
grant execute on function public.create_my_survey_from_doc(jsonb) to authenticated;
