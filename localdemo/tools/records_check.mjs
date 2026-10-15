// localdemo/tools/records_check.mjs — prints every renewal record in the local database (stage, rule, INC deadlines).
import { openDb } from "../build.mjs";
const db = openDb(); await db.waitReady;
for (const r of (await db.query(`select r.scholar_id_number id, r.school_year||' '||r.term term, r.stage, r.rule_code, r.is_late late, r.late_decision, s.status scholar_status, r.temp_probation tp,
  (select string_agg(i.subject_code||':'||i.state||':'||coalesce(i.deadline::text,'-'), ', ') from renewal_inc_items i where i.record_id=r.id) inc
  from renewal_records r join scholars s using (scholar_id_number) order by 1`)).rows) console.log(JSON.stringify(r));
console.log("notifications:", (await db.query("select count(*)::int n from scholar_notifications")).rows[0].n);
await db.close();
