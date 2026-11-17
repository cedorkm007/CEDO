-- undo_sdp_checklist_reconsideration_note.sql: the Checklist no longer writes "Reconsideration approved" under the Complied chip. One read-only function is removed; no data was ever changed.
begin;

drop function if exists public.scholars_sdp_reconsidered(text, text, text[]);

notify pgrst, 'reload schema';
commit;
