-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_recurring_venue.sql
--
-- A recurring SDP activity's venue can change between occurrences (a
-- weekly meeting might move rooms), so each occurrence now carries its
-- own venue alongside its date. Converts recurring_dates from a plain
-- timestamptz[] to a jsonb array of {date, venue} objects — existing
-- entries (added before this migration) are backfilled with the
-- activity's current venue, since that's the only venue on record for
-- them.
--
-- Safe to re-run (checks the column's current type before converting).
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'sdp_activities' and column_name = 'recurring_dates') = 'ARRAY' then

    alter table public.sdp_activities add column recurring_dates_jsonb jsonb not null default '[]'::jsonb;

    update public.sdp_activities a set recurring_dates_jsonb = coalesce(
      (select jsonb_agg(jsonb_build_object('date', d, 'venue', a.venue) order by d) from unnest(a.recurring_dates) as d),
      '[]'::jsonb
    );

    alter table public.sdp_activities drop column recurring_dates;
    alter table public.sdp_activities rename column recurring_dates_jsonb to recurring_dates;
  end if;
end $$;
