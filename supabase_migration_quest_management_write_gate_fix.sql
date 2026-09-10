-- ─────────────────────────────────────────────────────────────
-- supabase_migration_quest_management_write_gate_fix.sql
--
-- Bug fix: every WRITE policy on quest_subjects/quest_topics/
-- quest_questions/quest_choices (insert/update/delete) checks
-- is_sead_staff() — which itself is defined as "has the scholar_management
-- tag", NOT the quest_management tag introduced when Quest Management
-- Tools was split out of Scholar Management Tools into its own gated
-- page. A staff account tagged ONLY quest_management (not also
-- scholar_management) sees the whole Question Bank UI and can select
-- subjects/topics/questions, but every create/edit/delete — including
-- attaching a topic's video/slide/PDF material URL — is silently
-- rejected by RLS. Confirmed live: of the two accounts tagged
-- quest_management, only it.admin1 (which also happens to hold
-- scholar_management) can actually write; sead.sma3 cannot write
-- anything here at all.
--
-- Fixed by accepting EITHER tag on all 12 affected write policies,
-- mirroring the "is_sead_staff() or has_staff_tag(...)" pattern already
-- used for attendance_sessions (supabase_migration_formation_attendance.sql).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "sead staff write" on public.quest_subjects;
create policy "sead staff write" on public.quest_subjects for insert with check (public.is_sead_staff() or public.has_staff_tag('quest_management'));
drop policy if exists "sead staff update" on public.quest_subjects;
create policy "sead staff update" on public.quest_subjects for update using (public.is_sead_staff() or public.has_staff_tag('quest_management')) with check (public.is_sead_staff() or public.has_staff_tag('quest_management'));
drop policy if exists "sead staff delete" on public.quest_subjects;
create policy "sead staff delete" on public.quest_subjects for delete using (public.is_sead_staff() or public.has_staff_tag('quest_management'));

drop policy if exists "sead staff write" on public.quest_topics;
create policy "sead staff write" on public.quest_topics for insert with check (public.is_sead_staff() or public.has_staff_tag('quest_management'));
drop policy if exists "sead staff update" on public.quest_topics;
create policy "sead staff update" on public.quest_topics for update using (public.is_sead_staff() or public.has_staff_tag('quest_management')) with check (public.is_sead_staff() or public.has_staff_tag('quest_management'));
drop policy if exists "sead staff delete" on public.quest_topics;
create policy "sead staff delete" on public.quest_topics for delete using (public.is_sead_staff() or public.has_staff_tag('quest_management'));

drop policy if exists "sead staff write" on public.quest_questions;
create policy "sead staff write" on public.quest_questions for insert with check (public.is_sead_staff() or public.has_staff_tag('quest_management'));
drop policy if exists "sead staff update" on public.quest_questions;
create policy "sead staff update" on public.quest_questions for update using (public.is_sead_staff() or public.has_staff_tag('quest_management')) with check (public.is_sead_staff() or public.has_staff_tag('quest_management'));
drop policy if exists "sead staff delete" on public.quest_questions;
create policy "sead staff delete" on public.quest_questions for delete using (public.is_sead_staff() or public.has_staff_tag('quest_management'));

drop policy if exists "sead staff write" on public.quest_choices;
create policy "sead staff write" on public.quest_choices for insert with check (public.is_sead_staff() or public.has_staff_tag('quest_management'));
drop policy if exists "sead staff update" on public.quest_choices;
create policy "sead staff update" on public.quest_choices for update using (public.is_sead_staff() or public.has_staff_tag('quest_management')) with check (public.is_sead_staff() or public.has_staff_tag('quest_management'));
drop policy if exists "sead staff delete" on public.quest_choices;
create policy "sead staff delete" on public.quest_choices for delete using (public.is_sead_staff() or public.has_staff_tag('quest_management'));

-- Same gap in the shared activity-pubmats storage bucket (used for a
-- Quest subject's pubmat image, among other activity types) — widen it
-- the same way, additively, so this doesn't affect the other activity
-- types that already write there under is_sead_staff() alone.
drop policy if exists "sead staff manage activity pubmats" on storage.objects;
create policy "sead staff manage activity pubmats" on storage.objects for all
  using (bucket_id = 'activity-pubmats' and (public.is_sead_staff() or public.has_staff_tag('quest_management')))
  with check (bucket_id = 'activity-pubmats' and (public.is_sead_staff() or public.has_staff_tag('quest_management')));

-- subject-certificates is exclusively a Quest subject feature — same fix.
drop policy if exists "staff manage certificates" on storage.objects;
create policy "staff manage certificates" on storage.objects for all
  using (bucket_id = 'subject-certificates' and (public.is_sead_staff() or public.has_staff_tag('quest_management')))
  with check (bucket_id = 'subject-certificates' and (public.is_sead_staff() or public.has_staff_tag('quest_management')));
