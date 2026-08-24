-- Server-side Scholar Management search and pagination.
-- Safe to run after the staff/scholar portal migrations.

create or replace function public.search_scholars(
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, scholar_id_number text, first_name text, last_name text,
  middle_name text, school text, status text, total_count bigint
)
language sql security definer stable set search_path = public as $$
  select s.id, s.scholar_id_number, s.first_name, s.last_name, s.middle_name,
    s.school, s.status, count(*) over () as total_count
  from public.scholars s
  where public.is_sead_staff()
    and (
      nullif(trim(p_search), '') is null
      or s.scholar_id_number ilike '%' || trim(p_search) || '%'
      or s.first_name ilike '%' || trim(p_search) || '%'
      or s.last_name ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.first_name, s.last_name) ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.last_name, s.first_name) ilike '%' || trim(p_search) || '%'
    )
  order by s.last_name, s.first_name, s.scholar_id_number
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_scholars(text, integer, integer) from public;
grant execute on function public.search_scholars(text, integer, integer) to authenticated;

create extension if not exists pg_trgm;
create index if not exists idx_scholars_id_number_trgm on public.scholars using gin (scholar_id_number gin_trgm_ops);
create index if not exists idx_scholars_first_name_trgm on public.scholars using gin (first_name gin_trgm_ops);
create index if not exists idx_scholars_last_name_trgm on public.scholars using gin (last_name gin_trgm_ops);
