-- SDP Monitoring update, Phase 9, B0: WHICH staff and school accounts are still on 123456?   READ-ONLY: changes nothing, shows no password.
-- Only user names (the sign-in names of the 23 staff and the school), so you can tell those people before file B makes them choose a new password. Keep this private.
select 'staff' as kind, u.username as sign_in_name, (case when au.encrypted_password like '$2%' then au.encrypted_password = extensions.crypt('123456', au.encrypted_password) else false end) as still_on_123456
from auth.users au join public.users u on u.id = au.id
union all
select 'school', coalesce(a.username, a.email), (case when au.encrypted_password like '$2%' then au.encrypted_password = extensions.crypt('123456', au.encrypted_password) else false end)
from auth.users au join public.school_accounts a on a.id = au.id
order by 3 desc, 1, 2;
