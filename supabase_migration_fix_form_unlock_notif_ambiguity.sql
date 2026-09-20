-- ─────────────────────────────────────────────────────────────
-- supabase_migration_fix_form_unlock_notif_ambiguity.sql
--
-- sync_and_get_my_form_unlock_notifications() was failing every call with
-- "column reference material_id is ambiguous". The function's
-- RETURNS TABLE(..., material_id uuid, ...) declares `material_id` as a
-- PL/pgSQL variable for the whole function body. Every genuine column
-- reference in the function is already qualified (c.material_id,
-- n.material_id) — the actual clash is in
-- `on conflict (scholar_id, material_id) do nothing`: Postgres parses an
-- ON CONFLICT target list as expressions (it accepts an expression index
-- there too), not plain column identifiers, so it's subject to PL/pgSQL's
-- variable-vs-column resolution and collides with the local variable.
--
-- Fixed by targeting the unique constraint by name instead of by column
-- list — semantically identical, but a constraint name isn't an
-- expression, so there's nothing for PL/pgSQL to shadow.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.sync_and_get_my_form_unlock_notifications()
 returns table(notification_id uuid, material_id uuid, title text, kind text, created_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_scholar public.scholars%rowtype;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then
    return; -- not signed in as a scholar: nothing to sync or return
  end if;

  -- Create a notification row for every material that is CURRENTLY
  -- unlocked and applicable to this scholar and doesn't already have one.
  -- Same applicability/unlock logic as get_my_form_materials() and the
  -- storage policy above — is_form_material_unlocked() (the cumulative AND
  -- over non-year_level conditions) plus the separate year_level
  -- applicability check — so this can never create a row for a locked
  -- material or one outside the scholar's year level. Also requires at
  -- least one form_material_conditions row to exist at all — a material
  -- with zero conditions is public/visible to every scholar by design
  -- (see is_form_material_unlocked()'s own "empty conditions = unlocked
  -- for everyone" behavior), so it was never actually "unlocked" for this
  -- scholar in any meaningful sense and must not generate a "you unlocked
  -- a new form" notification.
  insert into public.scholar_form_unlock_notifications (scholar_id, material_id)
  select v_scholar.id, m.id
  from public.form_materials m
  where public.is_form_material_unlocked(m.id)
    and exists (
      select 1
      from public.form_material_conditions c
      where c.material_id = m.id
    )
    and not exists (
      select 1
      from public.form_material_conditions c
      where c.material_id = m.id
        and c.condition_type = 'year_level'
        and not public.is_form_condition_met(c.id)
    )
  on conflict on constraint scholar_form_unlock_notifications_unique do nothing;

  -- Return every still-unread row for this scholar — re-checking
  -- unlocked/applicable/conditioned here too (not just trusting the row
  -- exists), so a material that was unlocked when notified but has since
  -- become locked again, or had every one of its conditions removed since,
  -- is never handed back, even if its notification row is still sitting
  -- there unread.
  return query
  select n.id, n.material_id, m.title, m.kind, n.created_at
  from public.scholar_form_unlock_notifications n
  join public.form_materials m on m.id = n.material_id
  where n.scholar_id = v_scholar.id
    and n.read_at is null
    and public.is_form_material_unlocked(m.id)
    and exists (
      select 1
      from public.form_material_conditions c
      where c.material_id = m.id
    )
    and not exists (
      select 1
      from public.form_material_conditions c
      where c.material_id = m.id
        and c.condition_type = 'year_level'
        and not public.is_form_condition_met(c.id)
    )
  order by n.created_at;
end;
$function$;
