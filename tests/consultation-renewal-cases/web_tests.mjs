// tests/consultation-renewal-cases/web_tests.mjs — Consultation Tool, Renewal Cases: the rules of the list (term, groups, what is remembered, the documents line, the live update) and the screen (5 checks)
// Run:  node tests/consultation-renewal-cases/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cases-"));
const f = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/consultCasesView.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const V = await import(pathToFileURL(f).href);

// 1. the term shown
const terms = [
  { schoolYear: "2026-2027", term: "1st Semester", label: "1st Semester 2026–2027", openCount: 12, isCurrent: true },
  { schoolYear: "2025-2026", term: "2nd Semester", label: "2nd Semester 2025–2026", openCount: 5, isCurrent: false },
  { schoolYear: "2025-2026", term: "1st Semester", label: "1st Semester 2025–2026", openCount: 2, isCurrent: false },
];
check("1 the current term is shown by default; a remembered older term is kept while it exists; 'All terms' is kept; a term that is gone falls back to the current one; the cases in the other terms are counted for the note 'N more open cases are in older terms'",
  V.pickTerm("", terms) === "2026-2027|1st Semester" && V.pickTerm("2025-2026|2nd Semester", terms) === "2025-2026|2nd Semester" && V.pickTerm("all", terms) === "all" && V.pickTerm("2020-2021|Summer", terms) === "2026-2027|1st Semester"
  && V.pickTerm("", []) === "all" && V.otherTermsOpen("2026-2027|1st Semester", terms) === 7 && V.otherTermsOpen("all", terms) === 0 && JSON.stringify(V.splitTermKey("2026-2027|1st Semester")) === '{"schoolYear":"2026-2027","term":"1st Semester"}' && V.splitTermKey("x") === null);

// 2. what is remembered, and the documents line
const ok = V.readRememberedCases(JSON.stringify({ filters: { search: "ana", term: "2025-2026|2nd Semester", group: "sent" }, page: 2.9 }));
check("2 the page, the term, the group and the search are remembered; unknown values are dropped; a broken memory gives nothing; a case's documents are summed up in one line ('2 waiting for you · 1 approved')",
  ok.page === 2 && ok.filters.term === "2025-2026|2nd Semester" && ok.filters.group === "sent" && ok.filters.search === "ana" && V.readRememberedCases("{bad") === null && V.readRememberedCases(null) === null
  && V.readRememberedCases(JSON.stringify({ filters: { term: "nonsense", group: "x" }, page: 0 })).filters.term === "" && V.readRememberedCases(JSON.stringify({ filters: { term: "nonsense", group: "x" }, page: 0 })).page === 1
  && V.docsSummary({ docsSubmitted: 2, docsAccepted: 1, docsReturned: 0, requiredCount: 3 }) === "2 waiting for you · 1 approved" && V.docsSummary({ docsSubmitted: 0, docsAccepted: 0, docsReturned: 1, requiredCount: 3 }) === "1 returned"
  && V.docsSummary({ docsSubmitted: 0, docsAccepted: 0, docsReturned: 0, requiredCount: 3 }) === "none sent yet (3 needed)");

// 3. the live update
const a = { recordId: "a", stage: "needs_study_plan_consultation", docsSubmitted: 1 }, b = { recordId: "b", stage: "ready_for_endorsement", docsSubmitted: 0 }, c = { recordId: "c", stage: "needs_study_plan_consultation", docsSubmitted: 0 };
const same = V.mergeLive([a, b], [{ ...b }, { ...a }]);
const changed = V.mergeLive([a, b], [{ ...a, docsSubmitted: 0 }, b]);
const came = V.mergeLive([a, b], [a, b, c]), went = V.mergeLive([a, b], [a]);
check("3 a live update replaces only the cases that changed (in place, the others are the very same objects), says which ones (so an open case reads its documents again), and when a case came or left it leaves the list alone and offers 'Refresh' with the number",
  same.changedIds.length === 0 && same.rows[0] === a && same.rows[1] === b && changed.changedIds.join() === "a" && changed.rows[0].docsSubmitted === 0 && changed.rows[1] === b && changed.listChanged === 0
  && came.listChanged === 1 && came.rows.length === 2 && went.listChanged === 1 && went.rows.length === 2);

// 4/5. the screen
const tab = src("src/sead/pages/ScholarCounselingRenewalCasesTab.tsx");
check("4 the screen reads the cases page by page with the true total, one term at a time (the 'Term' selector with 'All terms'), group buttons with their numbers, search with a 300 ms wait, grey placeholder cards while loading, an empty message, and remembers the view; it no longer reads every case at once",
  tab.includes("fetchConsultCasesPage(") && tab.includes("<ServerPagination") && tab.includes("noun=\"cases\"") && tab.includes("aria-label=\"Renewal term\"") && tab.includes("ALL_TERMS") && tab.includes("fetchConsultCaseCounts(")
  && tab.includes("animate-pulse") && tab.includes("}, 300)") && tab.includes("CASES_REMEMBER_KEY") && tab.includes("request.current") && tab.includes("No open renewal cases in this term.") && !tab.includes("fetchConsultCases(") && !tab.includes("rows.filter(c => c.canEndorse)"));
check("5 the documents are read only when a case is opened (one case at a time); approving, returning or endorsing re-reads only that case; a live update re-reads the page quietly and replaces only what changed, offering 'Refresh' when the list changed",
  tab.includes("fetchConsultCaseDocs(id)") && /function toggleOpen[\s\S]*?if \(!isOpen\) void loadDocs\(id\)/.test(tab) && tab.includes("fetchConsultCaseOne(id)") && tab.includes("await refreshCase(recordId)") && tab.includes("mergeLive(rows, r.rows)")
  && tab.includes("setNewUpdates(m.listChanged)") && tab.includes("Refresh"));
console.log(`\n${passed} passed`);
