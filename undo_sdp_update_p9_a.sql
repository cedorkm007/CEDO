-- UNDO for supabase_migration_sdp_update_p9_a_close_functions.sql: gives back the "run" permission for exactly the functions that file closed (they are listed in
-- public.p9_closed_functions), then removes that list. Nothing else is touched.
set lock_timeout = '5s';
do $$
declare r record;
begin
  if to_regclass('public.p9_closed_functions') is null then return; end if;
  for r in select signature, closed_from from public.p9_closed_functions loop
    begin
      if r.closed_from = 'visitors' then
        execute format('grant execute on function %s to public, anon', r.signature);
      else
        execute format('grant execute on function %s to authenticated', r.signature);
      end if;
    exception when undefined_function then null;   -- the function no longer exists
    end;
  end loop;
end $$;
drop table if exists public.p9_closed_functions;
