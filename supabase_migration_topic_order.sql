-- Adds a staff-controlled display order for topics within each subject.
-- Run this in the Supabase SQL Editor before deploying the corresponding app changes.

alter table public.quest_topics add column if not exists sort_order integer;

-- Preserve the existing alphabetical display order when introducing the column.
with ordered_topics as (
  select id, row_number() over (partition by subject_id order by name, created_at) - 1 as new_sort_order
  from public.quest_topics
)
update public.quest_topics
set sort_order = ordered_topics.new_sort_order
from ordered_topics
where public.quest_topics.id = ordered_topics.id
  and public.quest_topics.sort_order is null;

alter table public.quest_topics alter column sort_order set default 0;
alter table public.quest_topics alter column sort_order set not null;

create index if not exists idx_quest_topics_subject_sort_order
  on public.quest_topics (subject_id, sort_order);
