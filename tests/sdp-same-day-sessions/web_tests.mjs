// tests/sdp-same-day-sessions/web_tests.mjs — a recurring SDP activity with several sessions on one date: the choices, the labels and the edit form keep each session apart (5 checks)
// Run:  node tests/sdp-same-day-sessions/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sess-"));
const f = path.join(tmp, "s.mjs");
fs.writeFileSync(path.join(tmp, "supabase-stub.ts"), "export const supabase: any = {};");
await build({ entryPoints: [path.join(root, "src/scholar/sdpApi.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@/lib/supabase": path.join(tmp, "supabase-stub.ts"), "@": path.join(root, "src") } }).catch(e => { console.log(String(e.message).slice(0, 300)); });
let A = null;
try { A = await import(pathToFileURL(f).href); } catch { A = null; }

// the activity of the request, as the screens see it
const iso = (day, hhmm) => new Date(`${day}T${hhmm}:00+08:00`).toISOString();
const act = {
  name: "City Education Innovation Week 2026", venue: "City Tourism Hall", subName: "Green Innovation Pitching Competition", mainSid: "s0", dateTime: iso("2026-11-16", "08:09"), endTime: iso("2026-11-16", "23:59"),
  recurringDates: [
    { sid: "s1", date: iso("2026-11-17", "09:00"), endTime: iso("2026-11-17", "17:00"), venue: "Golden Friendship Park", subName: "Kita-Kita" },
    { sid: "s2", date: iso("2026-11-17", "18:00"), endTime: iso("2026-11-17", "21:00"), venue: "Brgy. Carmen", subName: "Kahigayonan" },
    { sid: "s3", date: iso("2026-11-18", "08:00"), endTime: iso("2026-11-18", "23:59"), venue: "Limketkai Mall", subName: "ORO Kwento" },
    { sid: "s4", date: iso("2026-11-17", "13:00"), endTime: iso("2026-11-17", "23:59"), venue: "City Tourism Hall", subName: "Teach Talks" },
  ],
};
const D17 = A?.manilaDay(iso("2026-11-17", "12:00")), D18 = A?.manilaDay(iso("2026-11-18", "12:00"));
check("1 every session (row of 'Dates and venues') is listed on its own, also when several are on the same day (17 Nov has three); each keeps its session id",
  !!A && A.scheduleDays(act).length === 5 && A.scheduleDays(act).filter(d => d.day === D17).length === 3 && A.scheduleDays(act).map(A.sessionKey).join() === "s0,s1,s2,s3,s4",
  A ? "" : "could not load sdpApi");
check("2 a session is told apart by its id: the sub-name and the label are those of THAT session (Kahigayonan, not Kita-Kita, though both are on 17 Nov); without an id the first session of the day answers, as before",
  !!A && A.daySubName(act, D17, "s2") === "Kahigayonan" && A.daySubName(act, D17, "s4") === "Teach Talks" && A.daySubName(act, D17) === "Kita-Kita"
  && A.dayLabel(act, D17, "s2") === "City Education Innovation Week 2026 – Kahigayonan");
check("3 a credit or a code is for the session it carries; one made before sessions existed (no id) is for the FIRST session of its day",
  !!A && A.creditSession(act, D17, "s2", null)?.subName === "Kahigayonan" && A.creditSession(act, D17, null, null)?.sid === "s1" && A.creditSession(act, null, null, D18)?.sid === "s3"
  && A.creditSession(act, null, null, "2030-01-01") === null);
const tab = src("src/sead/pages/SDPMonitoringTab.tsx"), api = src("src/sead/sdpMonitorApi.ts");
check("4 the Credited Scholars choice and the QR Attendance choice list every session ('Session being credited', 'Codes for which session', with the time added when a day has several), a session already credited is marked, and the credit and the codes are sent with the session id",
  /label htmlFor="credit-day"[^>]*>Session being credited</.test(tab) && /Codes for which session</.test(tab) && /const days = useMemo\(\(\) => scheduleDays\(activity\)\.filter\(d => d\.day\), \[activity\]\);/.test(tab)
  && /const dayOptions = useMemo\(\(\) => scheduleDays\(activity\)\.filter\(d => d\.day\), \[activity\]\);/.test(tab) && /sameDay && s\.startIso/.test(tab) && /creditedDays\.has\(sessionKey\(d\)\)/.test(tab)
  && /creditScholarForDay\(activity\.id, scholarIdNumber, chosenSession\?\.day \?\? effectiveDay, chosenPeriod\(\), chosenSession\?\.sid \|\| null\)/.test(tab) && /enableAttendanceForActivity\(activity\.id, type, n, voucherHours, showDays \? chosenSession\?\.day \?\? null : null, showDays \? chosenSession\?\.sid \|\| null : null\)/.test(tab)
  && /session_sid: sessionSid/.test(api) && /p_session_sid: sessionSid/.test(api) && /sessionLabel\(activity, code\.dayDate, code\.sessionSid\)/.test(tab));
check("5 the edit form keeps each row's session id (and the first row's id moves with it), a new row has none (the database gives one), and an older database without the update still saves",
  /sid\?: string; \}/.test(tab) && /sid: activity\.mainSid \|\| undefined/.test(tab) && /sid: occ\.sid,/.test(tab) && /\.\.\.\(r\.sid \? \{ sid: r\.sid \} : \{\}\)/.test(tab) && /mainSid: firstSid \?\? ""/.test(tab)
  && /"main_sid" in payload/.test(api) && /\/p_session_sid\|could not find the function\//.test(api) && /\/session_sid\/i\.test\(error\.message\)/.test(api));
console.log(`\n${passed} passed`);
