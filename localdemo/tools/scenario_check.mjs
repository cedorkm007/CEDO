// localdemo/tools/scenario_check.mjs — checks that the TEST scholars in the seed show the results the walkthrough promises.
import { openDb } from "../build.mjs";
const db = openDb(); await db.waitReady;
const sdp = (await db.query("select scholar_id_number, complied, missing from public._sdp_compliance('2025-2026','2nd Semester') where scholar_id_number in ('TEST-0001','TEST-0010','TEST-0019') order by 1")).rows;
console.log("SDP:", JSON.stringify(sdp));
const prev = (await db.query("select s.scholar_id_number, public.scholar_had_regular_probation(s.scholar_id_number) as had from public.scholars s where s.scholar_id_number in ('TEST-0005','TEST-0024','TEST-0025','TEST-0001') order by 1")).rows;
console.log("previous regular probation:", JSON.stringify(prev));
await db.close();
