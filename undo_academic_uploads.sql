-- undo_academic_uploads.sql: removes the upload functions (the pre-filled template and the batch upload) and puts back the two history functions without the batch number.
-- The tables, the indexes and every status and history row stay as they are (nothing is deleted): uploads already saved stay saved. The earlier "Set a scholar's status by file" works as before.
-- (Run this ONLY together with putting the previous website version back.)
begin;
drop function if exists public.academic_status_history_scholar(text);
drop function if exists public.academic_status_history_school(uuid, integer, integer);
create or replace function public.academic_status_history_scholar(p_scholar text)
returns table(at timestamptz, old_status text, new_status text, old_custom_gwa numeric, new_custom_gwa numeric, how text, reason text, by_label text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query select h.at, h.old_status, h.new_status, h.old_custom_gwa, h.new_custom_gwa, h.how, h.reason, h.by_label
  from public.academic_status_history h where h.scholar_id_number = p_scholar order by h.at desc, h.id desc limit 200;
end;
$$;
revoke all on function public.academic_status_history_scholar(text) from public, anon;
grant execute on function public.academic_status_history_scholar(text) to authenticated;

create or replace function public.academic_status_history_school(p_school uuid, p_limit integer default 50, p_offset integer default 0)
returns table(total bigint, at timestamptz, scholar_id_number text, name text, old_status text, new_status text, old_custom_gwa numeric, new_custom_gwa numeric, how text, reason text, by_label text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query select count(*) over (), h.at, h.scholar_id_number, btrim(coalesce(s.last_name, '') || ', ' || coalesce(s.first_name, '')), h.old_status, h.new_status, h.old_custom_gwa, h.new_custom_gwa, h.how, h.reason, h.by_label
  from public.academic_status_history h left join public.scholars s on s.scholar_id_number = h.scholar_id_number
  where h.school_id = p_school order by h.at desc, h.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_status_history_school(uuid, integer, integer) from public, anon;
grant execute on function public.academic_status_history_school(uuid, integer, integer) to authenticated;

drop function if exists public.academic_template_rows(uuid, integer, integer);
drop function if exists public.academic_upload_undo(uuid);
drop function if exists public.academic_upload_list(uuid);
drop function if exists public.academic_upload_finish(uuid, integer);
drop function if exists public.academic_upload_apply(uuid, jsonb);
drop function if exists public.academic_upload_start(uuid, text, integer);
drop function if exists public.academic_upload_check(uuid, jsonb);
drop function if exists public._academic_upload_eval(uuid, jsonb);
drop function if exists public._academic_resolve_id(uuid, text);
notify pgrst, 'reload schema';
commit;
