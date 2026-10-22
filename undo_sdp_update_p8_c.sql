-- UNDO for supabase_migration_sdp_update_p8_c_quest_scores.sql: puts back the rule the live project had ("staff full access"). No row is touched.
set lock_timeout = '5s';
drop policy if exists "p8 quest staff read scores" on public.scholar_quest_scores;
drop policy if exists "p8 quest staff manage scores" on public.scholar_quest_scores;
drop policy if exists "staff full access" on public.scholar_quest_scores;
create policy "staff full access" on public.scholar_quest_scores for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
