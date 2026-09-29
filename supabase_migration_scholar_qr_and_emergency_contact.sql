-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholar_qr_and_emergency_contact.sql
--
-- Part of the per-activity attendance monitor feature.
--
-- 1. A permanent, opaque per-scholar QR token. Not scholar_id_number
--    (real, guessable) and not `id` (the actual Supabase Auth identity —
--    not something that should be safe to print on a QR code anyone can
--    scan). Scanned by any regular camera, it resolves (via the narrow
--    public RPC below) to a public page showing the scholar's name,
--    emergency contact, and CEDO's own contact info — nothing else.
--
-- 2. Emergency contact fields — didn't exist anywhere before this.
--    Scholar self-service (their own decision): edited from their own
--    Profile tab via update_own_emergency_contact(), a SECURITY DEFINER
--    RPC scoped to auth.uid()'s own row, mirroring update_own_scholar_contact
--    (supabase_migration_scholar_portal.sql:170-187) — not a raw table
--    UPDATE policy, so a scholar can never touch any column but these three.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.scholars add column if not exists qr_token uuid not null default gen_random_uuid();
create unique index if not exists idx_scholars_qr_token on public.scholars (qr_token);

alter table public.scholars add column if not exists emergency_contact_name text not null default '';
alter table public.scholars add column if not exists emergency_contact_relationship text not null default '';
alter table public.scholars add column if not exists emergency_contact_number text not null default '';

create or replace function public.update_own_emergency_contact(
  p_name text, p_relationship text, p_number text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.scholars
  set emergency_contact_name = coalesce(trim(p_name), ''),
      emergency_contact_relationship = coalesce(trim(p_relationship), ''),
      emergency_contact_number = coalesce(trim(p_number), ''),
      updated_at = now()
  where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can update their own emergency contact.'; end if;
end;
$function$;
grant execute on function public.update_own_emergency_contact(text, text, text) to authenticated;

-- Public (anon-callable) lookup — returns ONLY name + emergency contact
-- fields, never anything else from the scholars row. `found: false` when
-- the token doesn't resolve to anyone, so the page can show a clean
-- "not found" state instead of an error.
create or replace function public.get_public_scholar_emergency_info(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.id is null then jsonb_build_object('found', false) else jsonb_build_object(
    'found', true,
    'name', s.first_name || ' ' || s.last_name,
    'emergencyContactName', s.emergency_contact_name,
    'emergencyContactRelationship', s.emergency_contact_relationship,
    'emergencyContactNumber', s.emergency_contact_number
  ) end
  from (select 1) x
  left join public.scholars s on s.qr_token = p_token;
$$;
grant execute on function public.get_public_scholar_emergency_info(uuid) to anon, authenticated;
