-- ─────────────────────────────────────────────────────────────
-- RENEWAL DETAIL — THE APPROVED GRADES THE SCHOLAR ENTERED, AND THEIR SCREENSHOTS.   Safe to run twice.   Undo: undo_renewal_entered_grades_in_detail.sql
--
-- When a scholar enters their own grades (the school has not uploaded them) and the Grades Approver approves them, the renewal detail only said so in a note.
-- This adds ONE read-only function that gives the detail screen the approved grades (code, subject, units, grade), the screenshots, and who approved them and when.
-- It changes nothing and deletes nothing: no table, no existing function, no policy. The screenshots are opened with the same link the Entered grades tab already uses.
-- Who may read it: the people who may see renewals, and the Grades Approver (the same people who may read the Entered grades list).
-- ─────────────────────────────────────────────────────────────
create or replace function public.renewal_record_entered_grades(p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rec public.renewal_records%rowtype;
  s   public.renewal_self_grade_submissions%rowtype;
begin
  if not (public.can_view_renewals() or public.can_approve_scholar_grades()) then raise exception 'Not authorized to view entered grades.'; end if;
  select * into rec from public.renewal_records where id = p_record_id;
  if not found then return null; end if;
  -- the approved try of this application; the same lookup as the scholar's own screen (the application first, then the scholar's try for the same semester)
  select * into s from public.renewal_self_grade_submissions e where e.record_id = rec.id and e.status = 'approved' order by e.version desc limit 1;
  if not found then
    select * into s from public.renewal_self_grade_submissions e
     where e.scholar_id_number = rec.scholar_id_number and e.basis_school_year = rec.basis_school_year and e.basis_term = rec.basis_term and e.status = 'approved'
     order by e.version desc limit 1;
  end if;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', s.id, 'version', s.version, 'status', s.status, 'submitted_at', s.submitted_at, 'decided_at', s.decided_at, 'decided_by_label', s.decided_by_label,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('code', l.subject_code, 'subject', l.subject, 'units', l.units, 'grade', l.grade) order by l.subject_code) from public.renewal_self_grade_lines l where l.submission_id = s.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('name', x.file_name, 'path', x.storage_path, 'mime', x.mime_type) order by x.uploaded_at) from public.renewal_self_grade_files x where x.submission_id = s.id), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_record_entered_grades(uuid) from public, anon;
grant execute on function public.renewal_record_entered_grades(uuid) to authenticated;

notify pgrst, 'reload schema';
