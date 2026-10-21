-- SDP Monitoring update, Phase 7 — run BEFORE file B (READ-ONLY, changes nothing): who has an administrator role today.
-- After file B only these Super Admins (and it.admin1) can change roles. Check that the list is what you expect, and that at least one Super Admin exists.
select username, role, is_admin
from public.users
where role is distinct from 'staff' or is_admin
order by role, username;
