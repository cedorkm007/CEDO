-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_document_indicators.sql
-- CONSULTATION TOOL > RENEWAL CASES: AN INDICATOR OF EACH DOCUMENT THE SCHOLAR STILL HAS TO SEND ("Waiting for study plan upload", "Waiting for clearance upload"...).   Safe to run twice.   Undo: undo_renewal_document_indicators.sql
--   Each case in the list now carries, for every document it requires (study plan, clearance, and the letter from the dean when there is an INC), where that document stands:
--     missing   = nothing uploaded yet  ("Waiting for study plan upload")
--     returned  = the staff returned it ("Waiting for a new clearance upload")
--     submitted = uploaded, waiting for the consultation staff's approval
--     accepted  = approved
--   Read only: it adds one value to what the list returns (replaces the list function; the original is in the undo file). Nothing is changed or deleted.
-- Needs supabase_migration_renewal_documents_after_approval.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._renewal_finish_endorsed(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_documents_after_approval.sql first.';
  end if;
end $$;

drop function if exists public.renewal_consult_cases_page(text, text, text, text, integer, integer, uuid);
create or replace function public.renewal_consult_cases_page(
  p_school_year text default null,      -- with p_term: one term; both empty: all terms
  p_term text default null,
  p_group text default null,            -- ready | work | sent   (empty: all three)
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0,
  p_record_id uuid default null         -- ONE case (a screen refreshing just that case)
)
returns table(
  record_id uuid, scholar_id_number text, name text, school text, program text, year_level text, scholar_status text, school_year text, term text, term_label text, stage text, grp text,
  rule_code text, rule_text text, failed_subjects jsonb, inc_subjects jsonb, consultation_done_at timestamptz, next_consultation jsonb,
  docs_submitted integer, docs_accepted integer, docs_returned integer, required_count integer, can_endorse boolean,
  endorsed_status text, endorsed_at timestamptz, endorsed_note text, endorsed_by text, legacy boolean, documents jsonb, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_group text := case when lower(coalesce(p_group, '')) in ('ready', 'work', 'sent') then lower(p_group) else null end;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these cases.'; end if;
  return query
  with b as (
    select r.*, case r.stage when 'ready_for_endorsement' then 'ready' when 'endorsed_for_approval' then 'sent' else 'work' end as g,
           case r.stage when 'ready_for_endorsement' then 0 when 'needs_study_plan_consultation' then 1 when 'endorsed_for_approval' then 3 else 2 end as ord
    from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where r.stage in ('needs_study_plan_consultation', 'ready_for_endorsement', 'endorsed_for_approval', 'awaiting_documents', 'needs_inc_letter_consultation', 'inc_waiting_compliance', 'inc_deadline_passed')
      and (p_record_id is null or r.id = p_record_id)
      and (p_school_year is null or (r.school_year = p_school_year and r.term = p_term))
      and (v_q = '' or s.scholar_id_number ilike '%' || v_q || '%' or s.first_name ilike '%' || v_q || '%' or s.last_name ilike '%' || v_q || '%'
           or concat_ws(' ', s.first_name, s.last_name) ilike '%' || v_q || '%' or concat_ws(' ', s.last_name, s.first_name) ilike '%' || v_q || '%')
  ), f as (
    select b.*, count(*) over () as total from b where v_group is null or b.g = v_group
    order by b.ord, b.updated_at, b.id limit v_limit offset v_offset
  )
  select f.id, s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, s.status,
         f.school_year, f.term, public._renewal_term_label(f.school_year, f.term), f.stage, f.g,
         f.rule_code, f.rule_text, coalesce(f.evaluation -> 'grades' -> 'failed_subjects', '[]'::jsonb), coalesce(f.evaluation -> 'grades' -> 'inc_subjects', '[]'::jsonb), f.consultation_done_at,
         (select jsonb_build_object('starts_at', x.starts_at, 'staff', public._staff_display_name(x.staff_id))
          from public.counseling_slots x where x.record_id = f.id and x.state = 'booked' and x.starts_at > now() order by x.starts_at limit 1),
         (select count(*)::integer from public.renewal_documents d where d.record_id = f.id and d.kind in ('study_plan', 'inc_letter', 'clearance') and d.status = 'submitted'),
         (select count(*)::integer from public.renewal_documents d where d.record_id = f.id and d.kind in ('study_plan', 'inc_letter', 'clearance') and d.status = 'accepted'),
         (select count(*)::integer from public.renewal_documents d where d.record_id = f.id and d.kind in ('study_plan', 'inc_letter', 'clearance') and d.status = 'returned'),
         coalesce(jsonb_array_length(case when jsonb_typeof(f.evaluation -> 'required_documents') = 'array' then f.evaluation -> 'required_documents' end), 0),
         f.stage = 'ready_for_endorsement',
         f.endorsed_status, f.endorsed_at, f.endorsed_note, public._staff_display_name(f.endorsed_by),
         exists (select 1 from public.scholar_counseling_referrals q where q.renewal_record_id = f.id),
         (select coalesce(jsonb_agg(jsonb_build_object('kind', d ->> 'kind', 'label', d ->> 'label', 'state',
              case when exists (select 1 from public.renewal_documents x where x.record_id = f.id and x.kind = d ->> 'kind' and x.status = 'accepted') then 'accepted'
                   when exists (select 1 from public.renewal_documents x where x.record_id = f.id and x.kind = d ->> 'kind' and x.status = 'submitted') then 'submitted'
                   when exists (select 1 from public.renewal_documents x where x.record_id = f.id and x.kind = d ->> 'kind' and x.status = 'returned') then 'returned'
                   else 'missing' end) order by d ->> 'kind'), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(f.evaluation -> 'required_documents') = 'array' then f.evaluation -> 'required_documents' end) d
          where d ->> 'kind' in ('study_plan', 'inc_letter', 'clearance')),
         f.total
  from f join public.scholars s on s.scholar_id_number = f.scholar_id_number
  order by f.ord, f.updated_at, f.id;
end;
$$;
revoke all on function public.renewal_consult_cases_page(text, text, text, text, integer, integer, uuid) from public, anon;
grant execute on function public.renewal_consult_cases_page(text, text, text, text, integer, integer, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
