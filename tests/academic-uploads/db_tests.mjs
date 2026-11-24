// tests/academic-uploads/db_tests.mjs — Grades and Academic Management, PHASE 3: the template and the reliable upload (5 checks, short on purpose)
// Run:  node tests/academic-uploads/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_academic_uploads.sql", UNDO = "undo_academic_uploads.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const MANAGER = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_management') on conflict do nothing", [MANAGER]);
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
const HIGHER = (await q("select id from schools where name like '%Higher-Is-Better%'"))[0].id;
await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.00)", [LOWER]);
await q("delete from scholar_academic_status"); await q("delete from academic_status_history"); await q("delete from academic_recheck_queue");
const ids = (await q("select scholar_id_number s from scholars where school_id = $1 and status <> 'Removed' order by 1 limit 12", [LOWER])).map(r => r.s);
const other = (await q("select scholar_id_number s from scholars where school_id = $1 limit 1", [HIGHER]))[0].s;
// one scholar whose ID has leading zeros (Excel drops them): renamed with the foreign keys switched off (only for this test)
await q("set session_replication_role = replica"); await q("update scholars set scholar_id_number = '0042' where scholar_id_number = $1", [ids[11]]); await q("set session_replication_role = origin");
ids[11] = "0042";
const check_ = (rows, school = LOWER) => attempt(MANAGER, "select public.academic_upload_check($1, $2::jsonb) r", [school, JSON.stringify(rows)]);
const row = (i, id, status, extra = {}) => ({ i, scholar_id: id, name: "", program: "", status, custom: "", ...extra });

// 1. the Scholar IDs are cleaned and found: hidden spaces and other dashes are fixed; a lost dash or lost leading zeros is found only when exactly ONE scholar fits (a warning); Excel's E+ number, unknown IDs and another school's scholar are refused in words; row numbers are the file's own
const dash = ids[0].replace("-", "–") + " ";      // en dash + a no-break space
const rows1 = [row(2, dash, "Academic"), row(3, ids[1].replace("-", ""), "Non-academic"), row(4, "2.507E+07", "Academic"), row(5, "NOPE-9999", "Academic"), row(6, other, "Academic"), row(7, "42", "Academic"), row(9, ids[2], "Sort of")];
const c1 = await check_(rows1); const by = c1.ok ? Object.fromEntries(c1.rows[0].r.rows.map(r => [r.i, r])) : {}; const say = i => (by[i]?.messages ?? []).join(" | ");
check("1 Scholar IDs are cleaned and found: an other dash and a hidden space are fixed (valid), a lost dash is found with a warning, 'Excel changed it into a number' / 'not found' / 'belongs to another school' / a bad status are refused in plain words, and the leading zeros of 0042 are restored from '42' with a warning; row numbers are the ones sent (2, 3, 4…)",
  c1.ok && by[2].state === "valid" && by[2].scholar_id === ids[0] && by[3].state === "warning" && by[3].scholar_id === ids[1] && /read as/.test(say(3)) && by[4].state === "error" && /Excel changed/.test(say(4)) && by[5].state === "error" && /not found/.test(say(5))
  && by[6].state === "error" && /another school/.test(say(6)) && by[7].state === "warning" && by[7].scholar_id === "0042" && /leading zeros/.test(say(7)) && by[9].state === "error" && /Academic, Non-academic or Not set/.test(say(9)) && c1.rows[0].r.rows.length === 7, `${c1.msg} ${JSON.stringify(Object.values(by).map(r => r.i + r.state))}`);

// 2. check saves nothing; a numbered batch saves chunk by chunk; the same chunk twice changes nothing; custom GWA on the school's scale; 'Not set' takes the status away; history keeps the batch number
const none = Number((await q("select count(*)::int n from scholar_academic_status"))[0].n);
const st = await attempt(MANAGER, "select public.academic_upload_start($1, 'file.xlsx', 5) r", [LOWER]); const batch = st.rows[0].r;
const chunk1 = [row(2, ids[0], "Academic"), row(3, ids[1], "Non-academic", { custom: "3,25" }), row(4, ids[2], "Non-academic", { custom: "9.9" })];
const chunk2 = [row(5, ids[3], "Non-academic"), row(6, ids[11], "Academic")];
const a1 = await attempt(MANAGER, "select public.academic_upload_apply($1, $2::jsonb) r", [batch.id, JSON.stringify(chunk1)]);
const a1b = await attempt(MANAGER, "select public.academic_upload_apply($1, $2::jsonb) r", [batch.id, JSON.stringify(chunk1)]);      // retry of the same chunk
const a2 = await attempt(MANAGER, "select public.academic_upload_apply($1, $2::jsonb) r", [batch.id, JSON.stringify(chunk2)]);
const clear = await attempt(MANAGER, "select public.academic_upload_apply($1, $2::jsonb) r", [batch.id, JSON.stringify([row(7, ids[3], "Not set")])]);
const fin = await attempt(MANAGER, "select public.academic_upload_finish($1, 1) r", [batch.id]);
const eff = async s => (await q("select * from public._scholar_academic($1)", [s]))[0];
const e1 = await eff(ids[1]), e3 = await eff(ids[3]);
const hist = await q("select * from academic_status_history where batch_no = $1 and how = 'upload'", [batch.batch_no]);
check("2 the check saved nothing; the batch has a number; chunks are saved one by one (2 set + 1 refused for a custom GWA outside the school's scale); the same chunk again changes nothing; a custom passing GWA '3,25' is read; 'Not set' takes the status away; the history keeps the batch number",
  none === 0 && Number.isInteger(batch.batch_no) && a1.rows[0].r.set === 2 && a1.rows[0].r.errors === 1 && a1b.rows[0].r.set === 0 && a1b.rows[0].r.same === 2 && a2.rows[0].r.set === 2 && clear.rows[0].r.set === 1 && fin.ok
  && Number(e1.passing_gwa) === 3.25 && e1.special === true && e3.is_set === false && hist.length === 5 && hist.every(h => h.batch_no === batch.batch_no), `${st.msg} ${a1.msg} ${JSON.stringify(a1.rows?.[0]?.r)} ${JSON.stringify(a1b.rows?.[0]?.r)} ${fin.msg} ${hist.length}`);

// 3. one upload per school at a time (a second start is refused with who and when; another school is free); a forgotten upload is released after 3 hours
const s1 = await attempt(MANAGER, "select public.academic_upload_start($1, 'a.xlsx', 1) r", [LOWER]);
const s2 = await attempt(MANAGER, "select public.academic_upload_start($1, 'b.xlsx', 1) r", [LOWER]);
const s3 = await attempt(MANAGER, "select public.academic_upload_start($1, 'c.xlsx', 1) r", [HIGHER]);
await q("update academic_upload_batches set started_at = now() - interval '4 hours' where id = $1", [s1.rows[0].r.id]);
const s4 = await attempt(MANAGER, "select public.academic_upload_start($1, 'd.xlsx', 1) r", [LOWER]);
const lockState = (await q("select state from academic_upload_batches where id = $1", [s1.rows[0].r.id]))[0].state;
check("3 only one upload per school at a time (the second is refused, saying which batch and who); another school is not blocked; an upload left open for more than 3 hours is released so the school is never stuck",
  s1.ok && !s2.ok && /Another upload for this school is in progress \(batch \d+/.test(s2.msg) && s3.ok && s4.ok && lockState === "abandoned", `${s2.msg} ${s4.msg} ${lockState}`);
await attempt(MANAGER, "select public.academic_upload_finish($1, 0)", [s3.rows[0].r.id]); await attempt(MANAGER, "select public.academic_upload_finish($1, 0)", [s4.rows[0].r.id]);

// 4. undo: puts back every scholar the batch changed who is still at the value it set; somebody changed afterwards is left alone and counted; the batch is marked undone; not twice; not while another upload runs; not after 30 days
await attempt(MANAGER, "select public.academic_status_apply($1, '{}'::jsonb, $2, 'academic')", [LOWER, [ids[3]]]);      // changed after the upload: Not set -> Academic
await attempt(MANAGER, "select public.academic_status_apply($1, '{}'::jsonb, $2, 'non_academic')", [LOWER, [ids[0]]]);      // ids[0] was set Academic by the batch: changed afterwards
const list = await attempt(MANAGER, "select * from public.academic_upload_list($1)", [LOWER]);
const mine = list.rows.find(r => r.id === batch.id);
const busy = await attempt(MANAGER, "select public.academic_upload_start($1, 'e.xlsx', 1) r", [LOWER]);
const refused = await attempt(MANAGER, "select public.academic_upload_undo($1) r", [batch.id]);
await attempt(MANAGER, "select public.academic_upload_finish($1, 0)", [busy.rows[0].r.id]);
const undo = await attempt(MANAGER, "select public.academic_upload_undo($1) r", [batch.id]);
const again = await attempt(MANAGER, "select public.academic_upload_undo($1) r", [batch.id]);
const afterRows = await Promise.all(ids.slice(0, 4).concat([ids[11]]).map(eff));
await q("update academic_upload_batches set state = 'finished', undone_at = null, started_at = now() - interval '40 days' where id = $1", [batch.id]);
const old = await attempt(MANAGER, "select public.academic_upload_undo($1) r", [batch.id]);
check("4 the list says the upload can be undone; the undo is refused while another upload of the school runs; then it puts back the scholars still at the value the upload set (ids[1] and ids[11]: Not set) and leaves alone the two changed afterwards (counted); it cannot be done twice or after 30 days",
  mine?.can_undo === true && !refused.ok && /in progress/.test(refused.msg) && undo.ok && undo.rows[0].r.restored === 2 && undo.rows[0].r.kept === 2 && !again.ok && /finished upload/.test(again.msg) && afterRows[1].is_set === false && afterRows[4].is_set === false && afterRows[0].academic_status === "non_academic" && afterRows[3].academic_status === "academic"
  && !old.ok && /30 days/.test(old.msg), `${JSON.stringify(mine)} ${refused.msg} ${undo.msg} ${JSON.stringify(undo.rows?.[0]?.r)} ${again.msg} ${old.msg}`);

// 5. the template data (the school's scholars with their status, paged), only the Scholar Management staff, the batch number in the history, and the undo of the whole migration (functions gone, nothing deleted, runs again)
const t = await attempt(MANAGER, "select * from public.academic_template_rows($1, 0, 10)", [LOWER]);
const denied = await Promise.all([attempt(PLAIN, "select * from public.academic_template_rows($1, 0, 10)", [LOWER]), attempt(PLAIN, "select public.academic_upload_start($1, 'x', 1)", [LOWER]), attempt(PLAIN, "select public.academic_upload_check($1, '[]'::jsonb)", [LOWER])]);
const hs = await attempt(MANAGER, "select * from public.academic_status_history_scholar($1)", [ids[1]]);
const rowsBefore = Number((await q("select count(*)::int n from academic_upload_batches"))[0].n);
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.academic_upload_start(uuid,text,integer)') a"))[0].a === null;
const hsOld = await attempt(MANAGER, "select * from public.academic_status_history_scholar($1)", [ids[1]]);
await db.exec(read(NEW));
check("5 the template gives 10 of the school's scholars with their status (paged); only the Scholar Management staff can use any of it; the history shows the batch number; after the undo the functions are gone, no batch or status is deleted and the old history still works; the migration runs again",
  t.ok && t.rows.length === 10 && t.rows[0].school && denied.every(r => !r.ok && /Scholar Management/i.test(r.msg)) && hs.rows.some(h => h.batch_no === batch.batch_no) && gone && hsOld.ok && !("batch_no" in hsOld.rows[0]) && rowsBefore >= 4 && Number((await q("select count(*)::int n from academic_upload_batches"))[0].n) === rowsBefore, `${t.msg} ${gone} ${hsOld.msg}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
