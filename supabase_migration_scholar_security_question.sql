-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholar_security_question.sql
--
-- Instant self-service password reset for scholars, replacing the old
-- "submit a request and wait for staff to manually reset it" flow:
--   1. If a scholar has NOT set a security question yet, matching their
--      Scholar ID + Last Name + First Name is enough to reset instantly.
--   2. Once a scholar has set a security question, resetting requires
--      answering it correctly (in addition to the same ID/name match).
--
-- security_answer_hash is never stored or transmitted in plain text —
-- hashed with pgcrypto's crypt()/gen_salt('bf'), same family of hashing
-- Postgres itself uses for password-like secrets. The answer is
-- lowercased and trimmed before hashing/verifying so a scholar typing
-- "Whiskers" vs "whiskers " later isn't treated as a wrong answer.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.scholars add column if not exists security_question text;
alter table public.scholars add column if not exists security_answer_hash text;

-- ── Scholar sets/updates their own security question ─────────
-- security definer because scholars only have a SELECT policy on their own
-- row ("scholar reads own profile") — no UPDATE policy exists for them to
-- change this themselves otherwise.
create or replace function public.set_scholar_security_question(p_question text, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.scholars where id = auth.uid()) then
    raise exception 'Only signed-in scholars can do this.';
  end if;
  if length(trim(coalesce(p_question, ''))) = 0 then
    raise exception 'Choose a security question.';
  end if;
  if length(trim(coalesce(p_answer, ''))) < 2 then
    raise exception 'Enter a longer answer.';
  end if;

  update public.scholars
  set security_question = trim(p_question),
      security_answer_hash = extensions.crypt(lower(trim(p_answer)), extensions.gen_salt('bf'))
  where id = auth.uid();

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_scholar_security_question(text, text) from public;
grant execute on function public.set_scholar_security_question(text, text) to authenticated;

-- ── Answer verification — service_role ONLY ───────────────────
-- Deliberately NOT granted to authenticated/anon: this takes an arbitrary
-- scholar id and answer with no identity check of its own (that's the
-- Edge Function's job, which also enforces the ID+name match and a
-- generic error message). Granting this broadly would let anyone brute-
-- force any scholar's security answer directly via RPC, bypassing all of
-- that. Only supabase.auth.admin's service-role client (used from
-- scholar-self-reset-password, which never verify-jwts) can call it.
create or replace function public.verify_scholar_security_answer(p_scholar_id uuid, p_answer text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select security_answer_hash = extensions.crypt(lower(trim(p_answer)), security_answer_hash)
     from public.scholars where id = p_scholar_id and security_answer_hash is not null),
    false
  );
$$;
revoke all on function public.verify_scholar_security_answer(uuid, text) from public;
grant execute on function public.verify_scholar_security_answer(uuid, text) to service_role;

-- ── Distinguish self-service resets in the Account History log ──
alter table public.sead_scholar_account_log drop constraint if exists sead_scholar_account_log_source_check;
alter table public.sead_scholar_account_log add constraint sead_scholar_account_log_source_check
  check (source in ('single', 'bulk', 'undo', 'self_service'));
