-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_allow_resubmission.sql
-- CONSULTATION TOOL > RENEWAL CASES: "ALLOW RESUBMISSION" ON AN APPROVED DOCUMENT.   Safe to run twice.   Undo: undo_renewal_allow_resubmission.sql
--   * The consultation staff can press "Allow resubmission" on an APPROVED study plan, letter from the dean or clearance. The document then counts as NOT approved (the case is re-checked at once)
--     and the scholar can upload a new file. The scholar is told.
--   * When the scholar uploads the new file, the OLD document is DELETED (its record here; the website also removes its stored file). The new file waits for approval like any other; once it is approved
--     the "Allow resubmission" button is there again.
--   * Only the consultation staff can do it, only for an approved document of an application that is still open. Nothing else changes: who approves, what is required and the history stay as they are.
-- Adds two columns (when and by whom a resubmission was allowed) and one function, and replaces one function (the check made when a scholar adds a document; the original is in the undo file). Nothing is deleted here.
-- Needs supabase_migration_renewal_documents_after_approval.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._renewal_finish_endorsed(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_documents_after_approval.sql first.';
  end if;
end $$;

alter table public.renewal_documents add column if not exists resubmission_allowed_at timestamptz;
alter table public.renewal_documents add column if not exists resubmission_allowed_by uuid references public.users(id) on delete set null;

create or replace function public.renewal_allow_resubmission(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.renewal_documents%rowtype;
  r public.renewal_records%rowtype;
  v_label text;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can allow a resubmission.'; end if;
  select * into d from public.renewal_documents where id = p_document_id for update;
  if not found then raise exception 'That document was not found.'; end if;
  if d.kind not in ('study_plan', 'inc_letter', 'clearance') then raise exception 'A resubmission can only be allowed for the study plan, the letter from the dean or the clearance.'; end if;
  if d.status <> 'accepted' then raise exception 'Only an approved document can be opened for resubmission.'; end if;
  select * into r from public.renewal_records where id = d.record_id for update;
  if not (public._renewal_is_active_stage(r.stage) or r.stage in ('returned', 'awaiting_documents')) then raise exception 'This application is closed, so its documents can no longer be changed.'; end if;
  v_label := case d.kind when 'study_plan' then 'study plan' when 'inc_letter' then 'letter from the dean' else 'clearance' end;
  update public.renewal_documents set status = 'returned', reviewer_comment = 'Resubmission allowed by the consultation staff: please upload a new file. The old one is deleted when you upload it.',
    reviewed_by = auth.uid(), reviewed_at = now(), resubmission_allowed_at = now(), resubmission_allowed_by = auth.uid() where id = d.id;
  perform public._renewal_log(r.id, r.stage, r.stage, 'Allowed the scholar to send the ' || v_label || ' again (' || d.file_name || ').');
  perform public._notify_scholar(d.scholar_id_number, 'document_returned', 'You can send a new ' || v_label,
    'The consultation staff opened your ' || v_label || ' for resubmission. Please upload a new file in your Renewal tile; the old one is deleted when you do.', r.id);
  perform public._renewal_recheck(r.id);
end;
$$;
revoke all on function public.renewal_allow_resubmission(uuid) from public, anon;
grant execute on function public.renewal_allow_resubmission(uuid) to authenticated;

-- The check made when a scholar adds a document: a file that replaces a document opened for resubmission deletes the old one.
create or replace function public._renewal_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_required boolean;
begin
  select * into v_rec from public.renewal_records where id = new.record_id;
  if not found or v_rec.scholar_id_number <> new.scholar_id_number then
    raise exception 'That renewal application was not found.';
  end if;
  if new.scholar_id_number is distinct from public.current_scholar_id_number() and public.current_scholar_id_number() is not null then
    raise exception 'You can only add documents to your own application.';
  end if;
  if not public._renewal_is_active_stage(v_rec.stage) and v_rec.stage not in ('returned', 'awaiting_documents') then
    raise exception 'This application is closed, so documents can no longer be added.';
  end if;
  -- a study plan, INC letter or clearance the evaluator has approved is final: no other file of that kind can be added
  if new.kind in ('study_plan', 'inc_letter', 'clearance')
     and exists (select 1 from public.renewal_documents d where d.record_id = new.record_id and d.kind = new.kind and d.status = 'accepted') then
    raise exception 'This document has already been approved, so no other file can be added.';
  end if;
  if new.mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
                           'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    raise exception 'Only PDF, Word, JPG, PNG or WebP files can be uploaded.';
  end if;
  if new.size_bytes > 10485760 then raise exception 'Files can be at most 10 MB.'; end if;
  -- (the INC documents sent together with the application are stored under the window, before the application exists: renewal_apply with the documents sets the flag for its own transaction)
  if new.storage_path not like (new.scholar_id_number || '/' || new.record_id::text || '/' || new.kind || '/%')
     and not (coalesce(current_setting('cedo.apply_docs_ok', true), '') = 'on' and new.storage_path like (new.scholar_id_number || '/' || v_rec.window_id::text || '/inc-docs/' || new.kind || '/%')) then
    raise exception 'The file is not stored in your folder for this application.';
  end if;
  select exists (select 1 from jsonb_array_elements(coalesce(v_rec.evaluation -> 'required_documents', '[]'::jsonb)) d where d ->> 'kind' = new.kind) into v_required;
  if not v_required and coalesce(current_setting('cedo.apply_docs_ok', true), '') <> 'on' then
    raise exception 'That document is not needed for your case right now.';
  end if;
  -- the consultation staff allowed a resubmission of this kind: the old file is replaced by this one (the old document is deleted; the website removes its stored file)
  delete from public.renewal_documents d where d.record_id = new.record_id and d.kind = new.kind and d.resubmission_allowed_at is not null;
  if (select count(*) from public.renewal_documents d where d.record_id = new.record_id and d.kind = new.kind) >= 3 then
    raise exception 'You can upload at most 3 files of each kind. Remove one first.';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
