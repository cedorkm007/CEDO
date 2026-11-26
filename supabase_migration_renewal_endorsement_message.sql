-- supabase_migration_renewal_endorsement_message.sql
-- THE MESSAGE A SCHOLAR GETS WHEN ENDORSED NO LONGER PROMISES A RENEWAL.   Safe to run twice.   Undo: undo_renewal_endorsement_message.sql
-- Before: "... The Scholar Renewal evaluator will approve it, then you are renewed. We will tell you the result."   (sent even when the endorsement was REMOVED)
-- After:  "... The Scholar Renewal evaluator will decide on it. We will tell you the result."
-- Only that sentence changes, inside the live "endorse status" step. No record, status or message already sent is touched.
begin;

do $patch$
declare
  v_fn regprocedure := to_regprocedure('public.renewal_endorse_status(uuid,text,text)');
  v_def text;
  v_old constant text := 'The Scholar Renewal evaluator will approve it, then you are renewed. We will tell you the result.';
  v_new constant text := 'The Scholar Renewal evaluator will decide on it. We will tell you the result.';
begin
  if v_fn is null then raise exception 'STOPPED, nothing changed: the "endorse status" step was not found.'; end if;
  v_def := pg_get_functiondef(v_fn);
  if position(v_new in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'STOPPED, nothing changed: the live "endorse status" step is not the version this file expects. Tell CEDO''s developer.';
  end if;
  execute replace(v_def, v_old, v_new);
end
$patch$;

notify pgrst, 'reload schema';
commit;
