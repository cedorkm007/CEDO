-- SDP Monitoring update, Phase 9: TURN OFF the "still on 123456" check for SCHOLARS again (scholars already asked keep their marker until they choose a new password).
set lock_timeout = '5s';
update public.p9_default_password_settings set scholars = false where id;
delete from public.account_password_flags where reason = 'default_password' and user_id in (select id from public.scholars);
select scholars as scholars_check_is_on, staff_and_schools as staff_and_schools_check_is_on from public.p9_default_password_settings;
