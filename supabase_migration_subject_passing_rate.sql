-- ─────────────────────────────────────────────────────────────
-- supabase_migration_subject_passing_rate.sql
--
-- Adds a passing-rate range per subject (e.g. 95%–100%) and an optional
-- certificate/document that only becomes downloadable to a scholar once
-- their computed percentage for that subject falls inside that range.
--
-- How "percentage for a subject" is computed: for each topic under the
-- subject, take the scholar's BEST attempt as a percentage
-- (score/max_score), then average those percentages across every topic in
-- the subject (a topic never attempted counts as 0% — so a scholar can't
-- reach the passing rate by only doing the easy topics and skipping the
-- rest). This lives in the scholar_subject_progress view below.
--
-- The gating itself is enforced by Supabase Storage's own row-level
-- security on a PRIVATE bucket — not by trusting the frontend — so a
-- scholar literally cannot fetch the file's bytes unless the database
-- says they've passed. No edge function needed.
--
-- Run this AFTER supabase_migration_sead_staff.sql and
-- supabase_migration_scholar_portal.sql. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.quest_subjects add column if not exists passing_rate_min numeric not null default 75;
alter table public.quest_subjects add column if not exists passing_rate_max numeric not null default 100;
alter table public.quest_subjects add column if not exists certificate_filename text not null default '';

-- security_invoker means this view enforces the RLS of whoever is
-- QUERYING it (using their own read access to quest_topics /
-- scholar_quest_scores), not the view creator's — so a scholar querying
-- it only ever sees their own rows, and staff see everyone's, exactly
-- matching the access those two tables already grant directly.
create or replace view public.scholar_subject_progress
with (security_invoker = true) as
select
  scholar_id_number,
  subject_id,
  count(*) as topic_count,
  avg(best_pct) as subject_percentage
from (
  select
    t.subject_id,
    t.id as topic_id,
    scholars.scholar_id_number,
    coalesce((
      select max(sqs.score::numeric / nullif(sqs.max_score, 0)) * 100
      from public.scholar_quest_scores sqs
      where sqs.topic_id = t.id and sqs.scholar_id_number = scholars.scholar_id_number
    ), 0) as best_pct
  from public.quest_topics t
  cross join (select distinct scholar_id_number from public.scholars) scholars
) per_topic
group by scholar_id_number, subject_id;

grant select on public.scholar_subject_progress to authenticated;

-- ── Storage bucket for certificates (private — no public URL access) ──
insert into storage.buckets (id, name, public)
values ('subject-certificates', 'subject-certificates', false)
on conflict (id) do nothing;

-- Staff (SEAD staff specifically — matches who can create/edit subjects and
-- questions elsewhere) can upload/replace/remove/preview certificates.
-- File path convention: "{subject_id}/certificate.pdf"
drop policy if exists "staff manage certificates" on storage.objects;
create policy "staff manage certificates" on storage.objects
  for all using (bucket_id = 'subject-certificates' and public.is_sead_staff())
  with check (bucket_id = 'subject-certificates' and public.is_sead_staff());

-- A scholar can download a certificate ONLY if their computed percentage
-- for that subject falls within its passing_rate_min..passing_rate_max.
drop policy if exists "scholar downloads certificate if passing" on storage.objects;
create policy "scholar downloads certificate if passing" on storage.objects
  for select using (
    bucket_id = 'subject-certificates'
    and exists (
      select 1
      from public.scholar_subject_progress p
      join public.quest_subjects qs on qs.id = p.subject_id
      where p.scholar_id_number = (select scholar_id_number from public.scholars where id = auth.uid())
        and qs.id::text = split_part(storage.objects.name, '/', 1)
        and p.subject_percentage >= qs.passing_rate_min
        and p.subject_percentage <= qs.passing_rate_max
    )
  );
