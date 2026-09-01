-- ─────────────────────────────────────────────────────────────
-- supabase_migration_kauban_seed_content.sql
--
-- Backs the Kauban integration (docs/kauban/MILESTONES.md, milestone 6).
-- One-time load of the content that already existed in the original
-- Laravel app's bundled JSON files (resources/data/quiz-words.json,
-- quick-phrases.json, emergency.json — see docs/kauban/PROGRESS.md's
-- milestone-1 entry for how those were found and mapped to this schema).
-- Nothing here is invented — every row is copied from that source data.
--
-- kauban_sign_words.clip_video_path / tutorial_video_path are set to the
-- exact paths scripts/kauban-migrate-videos.mjs uploads to
-- (clips/<file> and tutorial/<file>) — run that script (before or after
-- this file, order doesn't matter) to actually put the video files at
-- those paths. Until then these rows just point at paths that don't
-- exist yet in Storage.
--
-- Adds a small uniqueness constraint to kauban_quick_phrase_categories,
-- kauban_emergency_contacts, and kauban_emergency_messages (none of the
-- original schema migration's columns besides id/key were unique) so
-- this file's own inserts can use `on conflict do nothing` and be safe
-- to re-run, same as every other insert here.
--
-- Run this AFTER supabase_migration_kauban_content_schema.sql. Safe to
-- re-run — every insert is `on conflict do nothing`, so it never
-- overwrites content you've since edited through the admin tool.
-- ─────────────────────────────────────────────────────────────

-- Postgres has no `ADD CONSTRAINT ... IF NOT EXISTS`, so a unique index
-- (which `on conflict` can target exactly the same way a unique
-- constraint can) is the idempotent-safe way to add this.
create unique index if not exists kauban_quick_phrase_categories_name_key on public.kauban_quick_phrase_categories (name);
create unique index if not exists kauban_quick_phrases_category_text_key on public.kauban_quick_phrases (category_id, text);
create unique index if not exists kauban_emergency_contacts_name_key on public.kauban_emergency_contacts (name);
create unique index if not exists kauban_emergency_messages_message_key on public.kauban_emergency_messages (message);

-- ── Sign categories ─────────────────────────────────────────
insert into public.kauban_sign_categories (key, label, sort_order) values
  ('greetings', 'Greetings', 1),
  ('family', 'Family', 2)
on conflict (key) do nothing;

-- ── Sign words (35 — the full set from quiz-words.json / the original
-- speech-to-sign-language.blade.php's signVideoLibrary, which used the
-- same 35-word list keyed by matching phrase) ──────────────────
insert into public.kauban_sign_words (category_id, phrase, label, clip_video_path, tutorial_video_path, sort_order)
select c.id, w.phrase, w.label, 'clips/' || w.file, 'tutorial/' || w.file, w.ord
from (values
  ('greetings', 'hello', 'Hello', 'hello.mp4', 1),
  ('greetings', 'good morning', 'Good Morning', 'goodmorning.mp4', 2),
  ('greetings', 'good noon', 'Good Noon', 'goodnoon.mp4', 3),
  ('greetings', 'good afternoon', 'Good Afternoon', 'goodafternoon.mp4', 4),
  ('greetings', 'good evening', 'Good Evening', 'goodevening.mp4', 5),
  ('greetings', 'goodbye', 'Goodbye', 'goodbye.mp4', 6),
  ('greetings', 'please', 'Please', 'please.mp4', 7),
  ('greetings', 'thank you', 'Thank You', 'thankyou.mp4', 8),
  ('greetings', 'sorry', 'Sorry', 'sorry.mp4', 9),
  ('greetings', 'welcome', 'Welcome', 'welcome.mp4', 10),
  ('greetings', 'take care', 'Take Care', 'takecare.mp4', 11),
  ('greetings', 'how are you', 'How Are You', 'howareyou.mp4', 12),
  ('greetings', 'im fine', 'I''m Fine', 'imfine.mp4', 13),
  ('greetings', 'what are you doing', 'What Are You Doing', 'whatareyoudoing.mp4', 14),
  ('greetings', 'see you soon', 'See You Soon', 'seeyousoon.mp4', 15),
  ('greetings', 'see you later', 'See You Later', 'seeyoulater.mp4', 16),
  ('greetings', 'see you tomorrow', 'See You Tomorrow', 'seeyoutomorrow.mp4', 17),
  ('greetings', 'share', 'Share', 'share.mp4', 18),
  ('family', 'wife', 'Wife', 'wife.mp4', 19),
  ('family', 'husband', 'Husband', 'husband.mp4', 20),
  ('family', 'aunt', 'Aunt', 'aunt.mp4', 21),
  ('family', 'uncle', 'Uncle', 'uncle.mp4', 22),
  ('family', 'relatives', 'Relatives', 'relatives.mp4', 23),
  ('family', 'friends', 'Friends', 'friends.mp4', 24),
  ('family', 'cousin', 'Cousin', 'cousin.mp4', 25),
  ('family', 'child', 'Child', 'child.mp4', 26),
  ('family', 'grandmother', 'Grandmother', 'grandmother.mp4', 27),
  ('family', 'grandfather', 'Grandfather', 'grandfather.mp4', 28),
  ('family', 'sister', 'Sister', 'sister.mp4', 29),
  ('family', 'brother', 'Brother', 'brother.mp4', 30),
  ('family', 'baby', 'Baby', 'baby.mp4', 31),
  ('family', 'daughter', 'Daughter', 'daughter.mp4', 32),
  ('family', 'son', 'Son', 'son.mp4', 33),
  ('family', 'mother', 'Mother', 'mother.mp4', 34),
  ('family', 'family', 'Family', 'family.mp4', 35)
) as w(category_key, phrase, label, file, ord)
join public.kauban_sign_categories c on c.key = w.category_key
on conflict (phrase) do nothing;

-- ── Quick phrase categories ─────────────────────────────────
insert into public.kauban_quick_phrase_categories (name, icon, color, sort_order) values
  ('Greetings', '👋', '#48BB78', 1),
  ('Basic Needs', '🍽️', '#4299E1', 2),
  ('Feelings', '😊', '#ED8936', 3),
  ('Questions', '❓', '#9F7AEA', 4)
on conflict (name) do nothing;

-- ── Quick phrases (22 — the full built-in list from quick-phrases.json) ──
insert into public.kauban_quick_phrases (category_id, text, sort_order)
select c.id, p.text, p.ord
from (values
  ('Greetings', 'Hello! How are you?', 1),
  ('Greetings', 'Good morning!', 2),
  ('Greetings', 'Good afternoon!', 3),
  ('Greetings', 'Good evening!', 4),
  ('Greetings', 'Nice to meet you!', 5),
  ('Greetings', 'Thank you!', 6),
  ('Greetings', 'Goodbye!', 7),
  ('Basic Needs', 'I need water.', 1),
  ('Basic Needs', 'I need food.', 2),
  ('Basic Needs', 'I need to use the restroom.', 3),
  ('Basic Needs', 'I need help.', 4),
  ('Basic Needs', 'Please wait a moment.', 5),
  ('Feelings', 'I am happy.', 1),
  ('Feelings', 'I am tired.', 2),
  ('Feelings', 'I am not feeling well.', 3),
  ('Feelings', 'I am confused.', 4),
  ('Feelings', 'I am okay.', 5),
  ('Questions', 'Can you help me?', 1),
  ('Questions', 'Where is the restroom?', 2),
  ('Questions', 'What time is it?', 3),
  ('Questions', 'Can you repeat that?', 4),
  ('Questions', 'Do you understand?', 5)
) as p(category_name, text, ord)
join public.kauban_quick_phrase_categories c on c.name = p.category_name
on conflict (category_id, text) do nothing;

-- ── Emergency content ────────────────────────────────────────
insert into public.kauban_emergency_contacts (name, number, color, sort_order) values
  ('Emergency Services', '911', '#E53E3E', 1),
  ('Crisis Hotline', '988', '#ED8936', 2)
on conflict (name) do nothing;

insert into public.kauban_emergency_messages (message, sort_order) values
  ('I need help! This is an emergency.', 1),
  ('Please come to my location immediately.', 2),
  ('I am in danger. Please call for help.', 3),
  ('Medical emergency. Please assist.', 4)
on conflict (message) do nothing;
