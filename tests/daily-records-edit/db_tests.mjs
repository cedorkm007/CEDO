// tests/daily-records-edit/db_tests.mjs — Daily Records: the findings and staff recommendations can be edited by the person who wrote the record, with a history that cannot be changed (5 checks, short on purpose)
// Run:  node tests/daily-records-edit/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_daily_records_edit.sql", UNDO = "undo_daily_records_edit.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const sys = async (sql, params = []) => { try { return { ok: true, rows: await q(sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const before = await q("select count(*)::int n, coalesce(sum(length(findings) + length(staff_recommendations)), 0)::int c from scholar_counseling_records");
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const WRITER = seedId("staff:demo.counselor"), OTHER = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_counseling') on conflict do nothing", [OTHER]);
const SCHOLAR = (await q("select scholar_id_number s from scholars where status <> 'Removed' order by scholar_id_number limit 1"))[0].s;
const created = await attempt(WRITER, "select public.create_scholar_counseling_record($1, 'Regular', date '2026-11-20', 'Calculus', 'Original findings', 'Original advice', 'Home Visit') id", [SCHOLAR]);
const ID = created.rows[0].id;
const edit = (uid, f, s, reason = "", expected = null) => attempt(uid, "select public.counseling_update_daily_record($1, $2, $3, $4, $5) r", [ID, f, s, reason, expected]);
const stored = async () => (await q("select findings, staff_recommendations, visit_type, date_visited::text d, failed_subjects, status, consulted_by, edit_count, last_edited_by from scholar_counseling_records where id = $1", [ID]))[0];

// 1. only the writer can edit; only the two texts change; the list and the single-record read say "edited"
const other = await edit(OTHER, "Changed by someone else", "x"), plain = await edit(PLAIN, "Changed by plain", "x");
const mine = await edit(WRITER, "  Better findings  ", "New advice", "Added what the scholar told me");
const s1 = await stored();
const list = await attempt(WRITER, "select edit_count, last_edited_at, edited_by_name from public.scholar_counseling_daily_records_page('', null, null, null, null, null, 'date', 'desc', 50, 0, false) where id = $1", [ID]);
const one = await attempt(OTHER, "select findings, edit_count, edited_by_name, consulted_by_id from public.counseling_daily_record_get($1)", [ID]);
const direct = await attempt(WRITER, "update scholar_counseling_records set findings = 'sneaky' where id = $1 returning id", [ID]);
check("1 only the staff member who wrote the record can edit it (another consultation staff and a staff without the tag are refused by the database); the findings are trimmed and saved, nothing else on the record changes, a direct table update does nothing, and the list and the single read say it was edited once",
  !other.ok && /Only the staff member who wrote/.test(other.msg) && !plain.ok && /Not authorized/.test(plain.msg) && mine.ok && mine.rows[0].r.changed === true && mine.rows[0].r.edit_count === 1
  && s1.findings === "Better findings" && s1.staff_recommendations === "New advice" && s1.visit_type === "Home Visit" && s1.d === "2026-11-20" && s1.failed_subjects === "Calculus" && s1.status === "Regular" && s1.consulted_by === WRITER && s1.last_edited_by === WRITER
  && direct.ok && direct.rows.length === 0 && (await stored()).findings === "Better findings"
  && list.ok && list.rows[0].edit_count === 1 && !!list.rows[0].last_edited_at && list.rows[0].edited_by_name !== "" && one.ok && one.rows[0].edit_count === 1 && one.rows[0].findings === "Better findings" && one.rows[0].consulted_by_id === WRITER,
  `${other.msg} ${plain.msg} ${JSON.stringify(mine)} ${JSON.stringify(list)}`);

// 2. limits, and nothing is saved (and no history line) when nothing changed
const same = await edit(WRITER, "Better findings", "New advice", "", 1);
const long = await edit(WRITER, "x".repeat(20001), "a"), longS = await edit(WRITER, "a", "y".repeat(20001)), longR = await edit(WRITER, "a", "b", "r".repeat(501)), exact = await edit(WRITER, "x".repeat(20000), "a", "", 1);
const lines2 = Number((await q("select count(*)::int n from scholar_counseling_record_edits where record_id = $1", [ID]))[0].n);
check("2 the limits are kept by the database (20,000 characters for each text, 500 for the reason; exactly 20,000 is allowed) and an edit with the same text saves nothing and adds no history line",
  same.ok && same.rows[0].r.changed === false && same.rows[0].r.edit_count === 1 && !long.ok && /too long/.test(long.msg) && !longS.ok && /too long/.test(longS.msg) && !longR.ok && /too long/.test(longR.msg)
  && exact.ok && exact.rows[0].r.changed === true && lines2 === 2, `${JSON.stringify(same)} ${long.msg} ${lines2}`);

// 3. an old window cannot overwrite a newer edit; the history lists every edit, newest first, with the old and the new text and the reason
const stale = await edit(WRITER, "From an old window", "z", "", 1);
const fresh = await edit(WRITER, "Final findings", "Final advice", "Corrected after the call", 2);
const hist = await attempt(OTHER, "select * from public.counseling_record_history($1)", [ID]);
const histPlain = await attempt(PLAIN, "select * from public.counseling_record_history($1)", [ID]);
check("3 a save made from an out-of-date window is stopped and nothing is lost (it says which version is current); the right version saves, and the history shows every edit newest first with who, when, the old text, the new text and the reason (readable by consultation staff only)",
  stale.ok && stale.rows[0].r.ok === false && stale.rows[0].r.conflict === true && stale.rows[0].r.findings === "x".repeat(20000) && fresh.ok && fresh.rows[0].r.edit_count === 3
  && hist.ok && hist.rows.map(r => r.edit_no).join() === "3,2,1" && hist.rows[0].old_findings === "x".repeat(20000) && hist.rows[0].new_findings === "Final findings" && hist.rows[0].reason === "Corrected after the call"
  && hist.rows[2].old_findings === "Original findings" && hist.rows[2].new_findings === "Better findings" && hist.rows[2].old_staff_recommendations === "Original advice" && hist.rows[2].reason === "Added what the scholar told me" && hist.rows[0].edited_by_name !== ""
  && !histPlain.ok && /Not authorized/.test(histPlain.msg), `${JSON.stringify(stale)} ${hist.msg}`);

// 4. the history can only be added to; it goes away only with the whole record (the scholar was deleted); records still cannot be deleted by staff
const upd = await sys("update scholar_counseling_record_edits set new_findings = 'forged' where record_id = $1", [ID]);
const del = await sys("delete from scholar_counseling_record_edits where record_id = $1", [ID]);
const direct2 = await attempt(WRITER, "select count(*)::int n from scholar_counseling_record_edits");
const delRec = await attempt(WRITER, "delete from scholar_counseling_records where id = $1 returning id", [ID]);
let cascaded = false;
{
  const g = (await attempt(WRITER, "select public.create_scholar_counseling_record($1, 'Regular', null, '', 'a', 'b', 'Office') id", [SCHOLAR])).rows[0].id;
  await as(WRITER, "select public.counseling_update_daily_record($1, 'a2', 'b2', '', null)", [g]);
  const had = Number((await q("select count(*)::int n from scholar_counseling_record_edits where record_id = $1", [g]))[0].n);
  const rm = await sys("delete from scholar_counseling_records where id = $1", [g]);      // the whole record removed (what happens when its scholar is deleted): its history goes with it
  cascaded = had === 1 && rm.ok && Number((await q("select count(*)::int n from scholar_counseling_record_edits where record_id = $1", [g]))[0].n) === 0;
}
check("4 the history cannot be changed or deleted by anybody (not even directly in the database), staff cannot read the table or delete a record, and it goes away only when the whole record is removed",
  !upd.ok && /can only be added to/.test(upd.msg) && !del.ok && /can only be added to/.test(del.msg) && (!direct2.ok || direct2.rows[0].n === 0) && (!delRec.ok || delRec.rows.length === 0) && cascaded
  && Number((await q("select count(*)::int n from scholar_counseling_record_edits where record_id = $1", [ID]))[0].n) === 3, `${upd.msg} ${del.msg} ${cascaded}`);

// 5. nothing existing was touched; the undo gives back the old list and keeps the history; the update can be run again
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const old = await attempt(WRITER, "select * from public.scholar_counseling_daily_records_page('', null, null, null, null, null, 'date', 'desc', 5, 0, false)");
const gone = (await q("select to_regprocedure('public.counseling_update_daily_record(uuid,text,text,text,integer)') a, to_regprocedure('public.counseling_record_history(uuid)') b, to_regprocedure('public.counseling_daily_record_get(uuid)') c"))[0];
const keptLines = Number((await q("select count(*)::int n from scholar_counseling_record_edits"))[0].n);
const textKept = (await stored()).findings === "Final findings";
await db.exec(read(NEW));
const again = await attempt(WRITER, "select edit_count from public.scholar_counseling_daily_records_page('', null, null, null, null, null, 'date', 'desc', 5, 0, false) limit 1");
const after = await q("select count(*)::int n, coalesce(sum(length(findings) + length(staff_recommendations)), 0)::int c from scholar_counseling_records where id <> $1", [ID]);
check("5 the records that existed before are unchanged (0 edits); the undo gives back the previous list and removes the functions but keeps the history and the latest text; the update can be run again",
  old.ok && !("edit_count" in old.rows[0]) && !gone.a && !gone.b && !gone.c && keptLines === 3 && textKept && again.ok && again.rows[0].edit_count !== undefined
  && Number((await q("select count(*)::int n from scholar_counseling_records where edit_count = 0 and id <> $1", [ID]))[0].n) === before[0].n && after[0].c === before[0].c, `${JSON.stringify(old.rows?.[0] && Object.keys(old.rows[0]))} ${JSON.stringify(gone)} ${keptLines} ${JSON.stringify(after)} ${JSON.stringify(before)}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
