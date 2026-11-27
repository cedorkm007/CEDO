-- undo_bridging_phase1_setup.sql  (BRIDGING project only)
-- Removes everything Phase 1 added: the screens' functions AND the tables, so every Bridging profile, school, consent and request is erased.
-- Use it only while testing. Sign-in accounts stay under Authentication > Users; delete them there if you want them gone.
begin;

do $$ begin
  if to_regclass('public.scholars') is not null then raise exception 'STOPPED, nothing changed: this is your MAIN CEDO database.'; end if;
end $$;

drop function if exists public.bridging_options();
drop function if exists public.bridging_teachers(uuid, text);
drop function if exists public.bridging_register(uuid, jsonb);
drop function if exists public.bridging_rate_limit(text, text, integer, integer);
drop function if exists public.bridging_me();
drop function if exists public.bridging_accept_notice(jsonb);
drop function if exists public.bridging_update_profile(jsonb);
drop function if exists public.bridging_choose_teacher(jsonb);
drop function if exists public.bridging_request(text, jsonb);
drop function if exists public.bridging_cancel_request(text);
drop function if exists public.bridging_forgot_password(text);
drop function if exists public._bridging_set_teacher(uuid, uuid, jsonb);
drop function if exists public._bridging_record_consent(uuid, jsonb, boolean);
drop function if exists public._bridging_me();

drop table if exists public.bridging_consents, public.bridging_requests, public.bridging_links, public.bridging_teacher_subjects, public.bridging_teacher_levels,
  public.bridging_profiles, public.bridging_notices, public.bridging_settings, public.bridging_subjects, public.bridging_schools, public.bridging_attempts;

drop function if exists public._bridging_latest_notice();
drop function if exists public._bridging_text(text, text, integer);
drop function if exists public._bridging_level_fits(text, uuid);

notify pgrst, 'reload schema';
commit;
