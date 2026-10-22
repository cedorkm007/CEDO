-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, FILE C of 7: who can read and change the QUEST SCORES (table scholar_quest_scores, about 76,000 rows).
--
-- Today (checked on the live project): any staff account can read, change and delete every score. After this file: READ by Quest Management, Scholar Management and
-- the renewal reviewers; CHANGE, ADD, DELETE only by Quest Management and Scholar Management. Scholars still read their own scores (unchanged); the scores they earn
-- are saved by the quest functions (not affected). Safe to run twice. Undo: undo_sdp_update_p8_c.sql.  Changes ONE table's rules; run it on its own.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.scholar_quest_scores enable row level security;

drop policy if exists "staff full access" on public.scholar_quest_scores;
drop policy if exists "p8 quest staff read scores" on public.scholar_quest_scores;
drop policy if exists "p8 quest staff manage scores" on public.scholar_quest_scores;

create policy "p8 quest staff read scores" on public.scholar_quest_scores
  for select to authenticated using (public.has_staff_tag('quest_management') or public.is_sead_staff() or public.can_view_renewals());

create policy "p8 quest staff manage scores" on public.scholar_quest_scores
  for all to authenticated
  using (public.has_staff_tag('quest_management') or public.is_sead_staff())
  with check (public.has_staff_tag('quest_management') or public.is_sead_staff());
