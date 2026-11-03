-- ─────────────────────────────────────────────────────────────
-- INC DOCUMENTS, FILE C: an APPROVED study plan, INC letter or clearance is final.   Safe to run twice.   Undo: undo_inc_docs_c.sql
-- Run AFTER supabase_migration_inc_docs_b_functions.sql. It replaces one function only (the check made when a scholar adds a document); no table is changed; nothing is deleted.
--
--   * Once the evaluator has approved a study plan, an INC letter or a clearance, the scholar cannot add another file of that kind, whatever screen or call tries it.
--     (Removing an approved file was already refused.) A file that is only received, or one that was returned, can still be replaced.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public.renewal_apply(uuid,text,text,text,text,boolean,jsonb,jsonb,boolean,jsonb)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_inc_docs_b_functions.sql first.';
  end if;
end $$;

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
  if not public._renewal_is_active_stage(v_rec.stage) and v_rec.stage <> 'returned' then
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
  if (select count(*) from public.renewal_documents d where d.record_id = new.record_id and d.kind = new.kind) >= 3 then
    raise exception 'You can upload at most 3 files of each kind. Remove one first.';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
