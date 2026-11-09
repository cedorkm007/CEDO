-- ─────────────────────────────────────────────────────────────
-- undo_sdp_reconsideration_auto_close.sql
-- Puts the automatic re-check back as it was (waiting requests are no longer closed by themselves) and removes the new function.
-- Requests that were already closed automatically stay closed ("not needed").
-- ─────────────────────────────────────────────────────────────
begin;

create or replace function public._renewal_recheck_scholar(p_scholar_id_number text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from public.renewal_records where scholar_id_number = p_scholar_id_number loop
    perform public._renewal_recheck(r.id);
  end loop;
end;
$$;
revoke all on function public._renewal_recheck_scholar(text) from public, anon, authenticated;

drop function if exists public._sdp_close_unneeded_requests(text);

commit;
