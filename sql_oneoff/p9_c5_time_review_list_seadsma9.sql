-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9 follow-up (C5): HOW LONG does the submissions review list take for one account?   READ-ONLY: changes nothing, saves nothing.
--
-- The database stops any website request that runs longer than about 8 seconds, and the website then shows an EMPTY list instead of an error. This times the same reads
-- the Review Submissions list makes, as one staff account, WITHOUT the 8-second limit, so we can see whether it is simply too slow.
-- HOW: this copy is already filled in for sead.sma9: nothing to change; run it
-- ("Run without RLS" if asked). It can take up to a minute. Send me the few rows it returns.
-- ─────────────────────────────────────────────────────────────
begin;
set local statement_timeout = '120s';

create temp table _who as select id as uid from public.users where lower(username) = lower('sead.sma9');   -- <<< CHANGE THIS
create temp table _out (n serial, what text, seconds numeric, rows_seen bigint);
grant select, insert on _out to authenticated;
grant usage on sequence _out_n_seq to authenticated;
grant select on _who to authenticated;

do $$
declare t0 timestamptz; c bigint; big uuid;
begin
  select a.id into big from public.submission_activities a order by (select count(*) from public.submission_uploads u where u.activity_id = a.id) desc limit 1;
  perform set_config('request.jwt.claim.sub', (select uid::text from _who), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  t0 := clock_timestamp(); select count(*) into c from public.scholars;
  insert into _out (what, seconds, rows_seen) values ('A. read all scholar records (what the list joins to)', round(extract(epoch from clock_timestamp() - t0)::numeric, 2), c);

  t0 := clock_timestamp(); select count(*) into c from public.submission_uploads u left join public.scholars s on s.id = u.scholar_id where u.activity_id = big;
  insert into _out (what, seconds, rows_seen) values ('B. the review list of the biggest submission activity, with scholar names', round(extract(epoch from clock_timestamp() - t0)::numeric, 2), c);

  t0 := clock_timestamp(); select count(*) into c from public.submission_uploads;
  insert into _out (what, seconds, rows_seen) values ('C. all submissions (no scholars)', round(extract(epoch from clock_timestamp() - t0)::numeric, 2), c);

  execute 'reset role';
end $$;

select what as measured, seconds as seconds_taken, rows_seen as rows, case when seconds >= 6 then 'TOO SLOW: close to the 8-second limit' when seconds >= 3 then 'slow' else 'fine' end as verdict
from _out order by n;

rollback;
