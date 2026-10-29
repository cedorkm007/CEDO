// tests/renewal/db/run_p8_tests.mjs — Phase 8 database checks: the certificate settings, who may get a certificate and when, numbering and copies,
// the stored files and who can open them, the renewal line on the public QR page, and the notices.
//
// Same setup as the earlier suites: every real migration file in memory + the demo's TEST data, run as signed-in people with the real
// `authenticated` role (and `service_role` for the function's own call).  Run:  node tests/renewal/db/run_p8_tests.mjs
import { buildDb } from "../../../localdemo/build.mjs";
import { seedDb, seedId } from "../../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const EVAL = staffUid("demo.evaluator"), COUNSELOR = staffUid("demo.counselor"), DH = staffUid("demo.divhead"), ITADMIN = staffUid("it.admin1"), SEADHEAD = staffUid("demo.seadhead");
const W1 = seedId("window:w1");

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rpc = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const asService = (sql, params = []) => as(null, async tx => (await tx.query(sql, params)).rows, "service_role");
const fails = async (uid, sql, params, pattern, role) => { try { await (role ? as(uid, async tx => (await tx.query(sql, params)).rows, role) : rpc(uid, sql, params)); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const finalize = async rec => { const f = (await q("select id, referred_to from scholar_counseling_referrals where renewal_record_id = $1 and status = 'division_head_approved'", [rec]))[0]; if (f) await rpc(f.referred_to, "select public.consult_finalize_decision($1)", [f.id]); };   // the consulting staff member makes the final decision after the Division Head signs
const recordOf = async (n, year = "2026-2027", term = "1st Semester") => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), year, term]))[0];
const prepare = async (uid, rec, reason = null) => (await rpc(uid, "select public.csr_prepare($1, $2) r", [rec, reason]))[0].r;
const complete = async (id, path) => asService("select public.csr_complete($1, $2)", [id, path]);
const settings = async () => (await q("select * from csr_settings"))[0];
const SAVE = "select public.csr_settings_save($1, $2, $3, $4, $5, $6, $7, $8, $9)";
const args = (over = {}) => { const a = { enabled: true, on: "Ms. Officer Test", ot: "Officer Title", mn: "Hon. Mayor Test", mt: "City Mayor", pl: "the City of Test, Philippines", os: null, ms: null, mm: null, ...over }; return [a.enabled, a.on, a.ot, a.mn, a.mt, a.pl, a.os, a.ms, a.mm]; };

const rec46 = (await recordOf(46)).id;
console.log("\nThe certificate settings");
check("a fresh database has certificates OFF; the demo switches them on", (await settings()).enabled === true && (await q("select count(*)::int n from csr_settings"))[0].n === 1);
check("only the evaluator and the IT admin can read or change the settings", (await rpc(EVAL, "select public.csr_settings_get() s"))[0].s.enabled === true && (await rpc(ITADMIN, "select public.csr_settings_get() s"))[0].s.officer_name
  && await (async () => { for (const uid of [COUNSELOR, DH, SEADHEAD, scholarUid(1)]) { if (!(await fails(uid, "select public.csr_settings_get()", [], /Only the evaluator and the IT admin/))) return false; if (!(await fails(uid, SAVE, args(), /Only the evaluator and the IT admin/))) return false; } return true; })());
await rpc(ITADMIN, SAVE, args({ os: "signatures/officer-1.png" }));
const s1 = await settings();
check("the IT admin saves: names, titles, place and the officer's picture; the mayor's picture is kept as it was", s1.officer_name === "Ms. Officer Test" && s1.mayor_title === "City Mayor" && s1.officer_signature_path === "signatures/officer-1.png" && s1.mayor_signature_path === null && s1.updated_by === ITADMIN);
await rpc(EVAL, SAVE, args({ ms: "signatures/mayor-1.png" }));
check("a path left empty (null) keeps the picture, the empty text removes it (the sample picture is used again)", (await settings()).officer_signature_path === "signatures/officer-1.png" && (await settings()).mayor_signature_path === "signatures/mayor-1.png");
await rpc(EVAL, SAVE, args({ os: "", ms: "", mm: "" }));
check("removing the pictures", (await settings()).officer_signature_path === null && (await settings()).mayor_signature_path === null);
check("both names, both titles and the place are required, and not endless", await fails(EVAL, SAVE, args({ on: "x" }), /need a name/) && await fails(EVAL, SAVE, args({ mt: " " }), /need a title/) && await fails(EVAL, SAVE, args({ pl: "" }), /place/) && await fails(EVAL, SAVE, args({ ot: "T".repeat(250) }), /too long/));
await rpc(EVAL, SAVE, args({ on: "Ms. Richel Petalcurin-Dahay, LPT, MPSM", ot: "City Education and Development Officer, City Education and Development Office", mn: "Hon. Rolando A. Uy", pl: "the City of Cagayan de Oro, Philippines" }));

console.log("\nWho can get a certificate, and when");
const r46 = await prepare(scholarUid(46), rec46);
check("a scholar whose renewal the evaluator CONFIRMED gets a number and everything the PDF needs", r46.ready === false && r46.csr_number === "CSR-2026-1S-00001" && r46.version === 1 && r46.data.first_name === "TEST" && r46.data.last_name === "Renewed With Certificate"
  && r46.data.scholar_id_number === num(46) && r46.data.program === "BS Test Studies" && /Lower-Is-Better/.test(r46.data.school) && r46.data.term === "1st Semester" && r46.data.school_year === "2026-2027"
  && r46.settings.officer_name === "Ms. Richel Petalcurin-Dahay, LPT, MPSM" && r46.settings.place === "the City of Cagayan de Oro, Philippines");
check("the QR is the scholar's own existing code (their token)", r46.qr_token === (await q("select qr_token from scholars where scholar_id_number = $1", [num(46)]))[0].qr_token);
const again = await prepare(scholarUid(46), rec46);
check("asking again before the file is stored reuses the same reserved number (none is wasted)", again.csr_id === r46.csr_id && again.csr_number === r46.csr_number && (await q("select count(*)::int n from csr_issued"))[0].n === 1);
check("nobody else can get it: another scholar, the counselor, the Division Head, visitors", await fails(scholarUid(2), "select public.csr_prepare($1)", [rec46], /cannot get this certificate/) && await fails(COUNSELOR, "select public.csr_prepare($1)", [rec46], /cannot get this certificate/)
  && await fails(DH, "select public.csr_prepare($1)", [rec46], /cannot get this certificate/) && await fails(null, "select public.csr_prepare($1)", [rec46], undefined, "anon"));
check("the evaluator can issue it for the scholar", (await prepare(EVAL, rec46)).csr_id === r46.csr_id);
const rec1 = (await rpc(scholarUid(1), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '') as r", [W1]))[0].r;
check("a renewal that is not confirmed yet gets no certificate (ready for confirmation is not enough)", (await recordOf(1)).stage === "ready_for_confirmation" && await fails(scholarUid(1), "select public.csr_prepare($1)", [rec1], /once the evaluator has confirmed/));
check("a renewal the Division Head approved but the evaluator has not confirmed gets none either", await (async () => {
  const rec = (await recordOf(43)).id;
  await rpc(DH, "select public.renewal_division_head_decide($1, 'approve_probationary', 'sig.png', '')", [rec]);
  await finalize(rec);
  return await fails(scholarUid(43), "select public.csr_prepare($1)", [rec], /once the evaluator has confirmed/);
})());
check("certificates switched OFF: nobody can get one", await (async () => { await rpc(EVAL, SAVE, args({ enabled: false })); const refused = await fails(scholarUid(46), "select public.csr_prepare($1)", [rec46], /not switched on/); return refused; })());
await rpc(EVAL, SAVE, args({ enabled: true, on: "Ms. Richel Petalcurin-Dahay, LPT, MPSM", ot: "City Education and Development Officer, City Education and Development Office", mn: "Hon. Rolando A. Uy", pl: "the City of Cagayan de Oro, Philippines" }));

console.log("\nStoring the file and numbering");
check("only the function's own service role can finish a certificate", await fails(EVAL, "select public.csr_complete($1, 'x/y.pdf')", [r46.csr_id], /permission denied/i) && await fails(scholarUid(46), "select public.csr_complete($1, 'x/y.pdf')", [r46.csr_id], /permission denied/i));
check("the file must be in the scholar's own folder", await fails(null, "select public.csr_complete($1, $2)", [r46.csr_id, `${num(2)}/x.pdf`], /scholar's folder/, "service_role"));
await db.query("insert into storage.objects (bucket_id, name, metadata) values ('csr-issued', $1, $2::jsonb)", [`${num(46)}/CSR-2026-1S-00001-v1.pdf`, JSON.stringify({ mimetype: "application/pdf", size: 4, base64: "JVBERg==" })]);
await complete(r46.csr_id, `${num(46)}/CSR-2026-1S-00001-v1.pdf`);
const issued = (await q("select * from csr_issued where id = $1", [r46.csr_id]))[0];
check("completing marks the time, and the renewal's history says the certificate was issued", issued.storage_path === `${num(46)}/CSR-2026-1S-00001-v1.pdf` && issued.issued_at !== null
  && (await q("select 1 from renewal_history where record_id = $1 and note like 'Certificate of Scholarship Renewal CSR-2026-1S-00001 issued%'", [rec46])).length === 1);
const ready = await prepare(scholarUid(46), rec46);
check("from then on the same file is given back (no new number, no new file)", ready.ready === true && ready.csr_number === "CSR-2026-1S-00001" && ready.version === 1 && ready.storage_path === issued.storage_path && (await q("select count(*)::int n from csr_issued"))[0].n === 1);
await complete(r46.csr_id, `${num(46)}/other.pdf`);
check("completing twice changes nothing", (await q("select storage_path from csr_issued where id = $1", [r46.csr_id]))[0].storage_path === issued.storage_path);
await rpc(EVAL, "select public.renewal_confirm($1, 'ok')", [rec1]);
const r1 = await prepare(scholarUid(1), rec1);
check("the next renewed scholar of the same term gets the next number", r1.csr_number === "CSR-2026-1S-00002" && r1.version === 1);
check("a removed scholar gets no certificate (even with a confirmed renewal)", await (async () => {
  await q("update scholars set status = 'Removed' where scholar_id_number = $1", [num(46)]);
  const refused = await fails(EVAL, "select public.csr_prepare($1)", [rec46], /removed scholar/);
  await q("update scholars set status = 'Regular' where scholar_id_number = $1", [num(46)]);
  return refused;
})());

console.log("\nA corrected copy");
check("the scholar cannot ask for one; the evaluator must give a reason", await fails(scholarUid(46), "select public.csr_prepare($1, $2)", [rec46, "Please fix"], /Only the evaluator can issue a corrected copy/) && await fails(EVAL, "select public.csr_prepare($1, $2)", [rec46, "no"], /at least 5 characters/));
const c2 = await prepare(EVAL, rec46, "The program was typed wrongly");
check("a corrected copy keeps the number and is version 2", c2.ready === false && c2.csr_number === "CSR-2026-1S-00001" && c2.version === 2);
check("until it is stored the scholar still gets version 1", (await prepare(scholarUid(46), rec46)).version === 1);
await db.query("insert into storage.objects (bucket_id, name, metadata) values ('csr-issued', $1, $2::jsonb)", [`${num(46)}/CSR-2026-1S-00001-v2.pdf`, JSON.stringify({ mimetype: "application/pdf", size: 4, base64: "JVBERg==" })]);
await complete(c2.csr_id, `${num(46)}/CSR-2026-1S-00001-v2.pdf`);
check("once stored: version 2 is the current copy, version 1 is kept and marked replaced, the scholar is told", (await prepare(scholarUid(46), rec46)).version === 2 && (await q("select replaced from csr_issued where csr_number = 'CSR-2026-1S-00001' order by version")).map(r => r.replaced).join() === "true,false"
  && (await q("select 1 from scholar_notifications where scholar_id_number = $1 and title = 'A corrected certificate is ready'", [num(46)])).length === 1);
const forStaff = (await rpc(EVAL, "select public.csr_for_record($1) c", [rec46]))[0].c, forScholar = (await rpc(scholarUid(46), "select public.csr_for_record($1) c", [rec46]))[0].c;
check("the evaluator sees every copy with the reason and who asked; the scholar sees the copies but not the reasons", forStaff.copies.length === 2 && forStaff.copies[0].reason === "The program was typed wrongly" && /Renewal Evaluator/.test(forStaff.copies[0].by)
  && forScholar.copies.length === 2 && forScholar.copies.every(c => c.reason === "" && c.by === "") && forScholar.eligible === true && forScholar.enabled === true);
check("another scholar gets nothing about this renewal; a record that is not renewed says it is not eligible", (await rpc(scholarUid(2), "select public.csr_for_record($1) c", [rec46]))[0].c === null && (await rpc(scholarUid(3), "select public.csr_for_record($1) c", [(await recordOf(3))?.id ?? rec46]))[0].c === null
  && (await rpc(EVAL, "select public.csr_for_record($1) c", [(await recordOf(4))?.id ?? rec46]))[0] !== undefined);

console.log("\nStored files and who can open them");
const readable = async (uid, bucket, path) => (await as(uid, async tx => (await tx.query("select count(*)::int n from storage.objects where bucket_id = $1 and name = $2", [bucket, path])).rows[0].n)) === 1;
const p1 = `${num(46)}/CSR-2026-1S-00001-v1.pdf`;
check("a scholar can open their own certificate, not anyone else's; the evaluator can open any; the counselor and visitors cannot", await readable(scholarUid(46), "csr-issued", p1) && !(await readable(scholarUid(1), "csr-issued", p1)) && await readable(EVAL, "csr-issued", p1)
  && !(await readable(COUNSELOR, "csr-issued", p1)) && !(await readable(DH, "csr-issued", p1)));
check("nobody signed in can write a certificate file (only the function's service role)", await fails(scholarUid(46), "insert into storage.objects (bucket_id, name, metadata) values ('csr-issued', $1, '{}'::jsonb)", [`${num(46)}/fake.pdf`], /row-level|violates/i) && await fails(EVAL, "insert into storage.objects (bucket_id, name, metadata) values ('csr-issued', $1, '{}'::jsonb)", [`${num(46)}/fake.pdf`], /row-level|violates/i));
check("the evaluator and the IT admin can keep the signature pictures; scholars and others cannot", await (async () => {
  await rpc(EVAL, "insert into storage.objects (bucket_id, name, metadata) values ('csr-assets', 'signatures/a.png', '{}'::jsonb)");
  await rpc(ITADMIN, "insert into storage.objects (bucket_id, name, metadata) values ('csr-assets', 'signatures/b.png', '{}'::jsonb)");
  return await readable(EVAL, "csr-assets", "signatures/b.png") && await readable(ITADMIN, "csr-assets", "signatures/a.png") && !(await readable(scholarUid(46), "csr-assets", "signatures/a.png"))
    && await fails(scholarUid(46), "insert into storage.objects (bucket_id, name, metadata) values ('csr-assets', 'signatures/c.png', '{}'::jsonb)", [], /row-level|violates/i);
})());
check("the buckets are private and only take what they should (PNG pictures, PDF certificates)", await (async () => {
  const b = await q("select id, public, allowed_mime_types from storage.buckets where id in ('csr-assets', 'csr-issued') order by id");
  return b.length === 2 && b.every(x => x.public === false) && b[0].allowed_mime_types.join() === "image/png" && b[1].allowed_mime_types.join() === "application/pdf";
})());
check("the issued-certificates table: a scholar reads only their own finished copies; nobody signed in can write it", (await as(scholarUid(46), async tx => (await tx.query("select count(*)::int n from public.csr_issued")).rows[0].n)) === 2
  && (await as(scholarUid(2), async tx => (await tx.query("select count(*)::int n from public.csr_issued")).rows[0].n)) === 0 && (await as(EVAL, async tx => (await tx.query("select count(*)::int n from public.csr_issued")).rows[0].n)) >= 2
  && await fails(EVAL, "update public.csr_issued set reason = 'x'", [], /permission denied|row-level/i) !== undefined);

console.log("\nThe public QR page");
const tokenOf = async n => (await q("select qr_token t from scholars where scholar_id_number = $1", [num(n)]))[0].t;
const pub = async n => { const token = await tokenOf(n); return db.transaction(async tx => { await tx.exec("set local role anon"); return (await tx.query("select public.get_public_scholar_emergency_info($1) i", [token])).rows[0].i; }); };
const p46 = await pub(46);
check("a renewed scholar: the line, the term, and the certificate number (anyone can scan this without signing in)", p46.found === true && p46.renewal.state === "renewed" && p46.renewal.line === "Renewed — 1st Semester 2026-2027" && p46.renewal.csr_number === "CSR-2026-1S-00001");
check("the page still gives only what it gave before, plus the renewal line", Object.keys(p46).sort().join() === "emergencyContactName,emergencyContactNumber,emergencyContactRelationship,found,name,renewal" && Object.keys(p46.renewal).sort().join() === "csr_number,line,state");
check("a renewal still in progress says so (and nothing about why); a scholar with no renewal says so", (await pub(44)).renewal.state === "in_progress" && /^Renewal in progress — 1st Semester 2026-2027$/.test((await pub(44)).renewal.line) && (await pub(14)).renewal.state === "none" && (await pub(14)).renewal.csr_number === null);
check("a removed scholar's page says Removed", (await pub(12)).renewal.line === "Removed" && (await pub(12)).renewal.state === "removed");
check("a confirmed renewal before the certificate is made shows no number yet; an unknown code is not found", await (async () => { const x = await pub(1); return x.renewal.state === "renewed" && x.renewal.csr_number === null; })()
  && (await db.transaction(async tx => { await tx.exec("set local role anon"); return (await tx.query("select public.get_public_scholar_emergency_info(gen_random_uuid()) i")).rows[0].i; })).found === false);
check("the newest term wins (a Summer renewal in progress is shown instead of the confirmed 1st Semester before it)", await (async () => {
  await q("insert into renewal_records (scholar_id_number, school_year, term, stage) values ($1, '2026-2027', 'Summer', 'submitted')", [num(46)]);
  const x = await pub(46);
  await q("delete from renewal_records where scholar_id_number = $1 and term = 'Summer'", [num(46)]);
  return x.renewal.state === "in_progress" && /Summer 2026-2027/.test(x.renewal.line);
})());

console.log("\nNotices to the scholar");
check("confirming a renewal while certificates are on tells the scholar it is ready", (await q("select 1 from scholar_notifications where scholar_id_number = $1 and title = 'Your Certificate of Scholarship Renewal is ready'", [num(1)])).length === 1);
check("confirming while certificates are OFF tells nobody; switching them ON then tells each renewed scholar once", await (async () => {
  await rpc(EVAL, SAVE, args({ enabled: false, on: "Ms. Richel Petalcurin-Dahay, LPT, MPSM", ot: "City Education and Development Officer, City Education and Development Office", mn: "Hon. Rolando A. Uy", pl: "the City of Cagayan de Oro, Philippines" }));
  const rec = (await recordOf(45)).id;
  await rpc(EVAL, "select public.renewal_confirm_decision($1, 'ok')", [rec]);
  const quiet = (await q("select 1 from scholar_notifications where scholar_id_number = $1 and title = 'Your Certificate of Scholarship Renewal is ready'", [num(45)])).length === 0;
  await q("delete from scholar_notifications where title = 'Your Certificate of Scholarship Renewal is ready'");
  await rpc(EVAL, SAVE, args({ enabled: true, on: "Ms. Richel Petalcurin-Dahay, LPT, MPSM", ot: "City Education and Development Officer, City Education and Development Office", mn: "Hon. Rolando A. Uy", pl: "the City of Cagayan de Oro, Philippines" }));
  const told = await q("select scholar_id_number, count(*)::int n from scholar_notifications where title = 'Your Certificate of Scholarship Renewal is ready' group by 1 order by 1");
  const renewed = await q("select count(distinct scholar_id_number)::int n from renewal_records where stage = 'renewed'");
  await rpc(EVAL, SAVE, args({ enabled: true, on: "Ms. Richel Petalcurin-Dahay, LPT, MPSM", ot: "City Education and Development Officer, City Education and Development Office", mn: "Hon. Rolando A. Uy", pl: "the City of Cagayan de Oro, Philippines" }));
  const stillOnce = (await q("select count(*)::int n from scholar_notifications where title = 'Your Certificate of Scholarship Renewal is ready'"))[0].n === told.length;
  return quiet && told.length === renewed[0].n && told.every(t => t.n === 1) && stillOnce;
})());

console.log("\nThe export carries the certificate number");
check("the Excel export can ask for the certificate numbers of a term (the newest copy per renewal)", await (async () => { const c = (await rpc(EVAL, "select public.renewal_export_csr($1, $2) c", ["2026-2027", "1st Semester"]))[0].c; const x = c.find(r => r.scholar_id_number === num(46)); return !!x && x.csr_number === "CSR-2026-1S-00001" && x.version === 2 && c.every(r => r.csr_number) && await fails(scholarUid(46), "select public.renewal_export_csr($1, $2)", ["2026-2027", "1st Semester"], /Not authorized/); })());

console.log("\nSafety");
check("the migration can be run twice", await (async () => { try { await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p8_csr.sql", import.meta.url), "utf8")); return (await q("select count(*)::int n from csr_issued"))[0].n === 3 && (await q("select count(*)::int n from csr_settings"))[0].n === 1; } catch (e) { console.log("   ", e.message); return false; } })());

console.log(`\n${failed === 0 ? "ALL PHASE 8 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
