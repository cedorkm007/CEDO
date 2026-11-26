-- undo_renewal_endorsement_message.sql: puts back the earlier sentence in the message sent to an endorsed scholar. Nothing else changes.
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
  if position(v_new in v_def) = 0 then return; end if;
  execute replace(v_def, v_new, v_old);
end
$patch$;

notify pgrst, 'reload schema';
commit;
