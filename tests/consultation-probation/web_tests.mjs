// tests/consultation-probation/web_tests.mjs — Consultation Tool, Probationary Monitoring: the rules of the list (what is remembered, the INC line of a row) and the screen (4 checks)
// Run:  node tests/consultation-probation/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prob-"));
const f = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/probationView.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const V = await import(pathToFileURL(f).href);

// 1. the INC line of a row
const a = V.incSummary(0, null, "2026-11-19"), b = V.incSummary(2, "2026-11-25", "2026-11-19"), c = V.incSummary(1, "2026-12-30", "2026-11-19"), d = V.incSummary(1, "2026-11-16", "2026-11-19"), e = V.incSummary(1, null, "2026-11-19"), g = V.incSummary(1, "2026-11-19", "2026-11-19");
check("1 a row's INC line says how many are open and the nearest deadline in days (soon = within 7 days, shown in amber; passed = in red; due today; deadline not set yet; nothing open)",
  a.text === "No open INC" && a.tone === "none" && b.text === "2 INC open - next deadline in 6 days" && b.tone === "soon" && c.tone === "ok" && c.text.includes("41 days")
  && d.text === "1 INC open - deadline passed 3 days ago" && d.tone === "passed" && e.tone === "unset" && g.text === "1 INC open - due today" && g.tone === "soon", JSON.stringify([a, b, c, d, e, g]));

// 2. what is remembered
const ok = V.readRememberedProbation(JSON.stringify({ filters: { search: "ana", attention: ["soon", "bogus", "no_study_plan"], kind: "temporary" }, sortKey: "deadline", sortDir: "desc", page: 3.7 }));
check("2 the page, the search, the filters and the sort are remembered; unknown values are dropped, a broken or empty memory gives nothing (so the list simply starts fresh)",
  ok.page === 3 && ok.filters.search === "ana" && JSON.stringify(ok.filters.attention) === '["soon","no_study_plan"]' && ok.filters.kind === "temporary" && ok.sortKey === "deadline" && ok.sortDir === "desc"
  && V.readRememberedProbation("not json") === null && V.readRememberedProbation(null) === null && V.readRememberedProbation('{"filters":5}') === null
  && V.readRememberedProbation(JSON.stringify({ filters: { search: 1, kind: "x" }, page: -4 })).page === 1 && V.probationFiltersActive(V.EMPTY_PROBATION_FILTERS) === false && V.probationFiltersActive({ search: "", attention: ["passed"], kind: "" }) === true);

// 3. the screen: pages, filters, remembered, and the documents only when a row is opened
const tab = src("src/sead/pages/ProbationMonitoringTab.tsx"), api = src("src/sead/appointmentsApi.ts");
check("3 the screen reads the list page by page with the true total, filters 'Needs attention' and 'Type', skeleton rows, a 300 ms wait for the search, and remembers the view; it no longer loads every scholar or every renewal",
  tab.includes("fetchProbationMonitoringPage(") && tab.includes("<ServerPagination") && tab.includes("noun=\"scholars\"") && tab.includes("label=\"Needs attention\"") && tab.includes("aria-label=\"Probation type\"")
  && tab.includes("animate-pulse") && tab.includes("}, 300)") && tab.includes("PROBATION_REMEMBER_KEY") && tab.includes("request.current") && !tab.includes("fetchProbationMonitoringList") && !tab.includes("fetchProbationRenewalInfo")
  && !tab.includes("renewalInfo"));
check("4 the INC items and study plan files are read only when a row is opened (one scholar at a time), and extending a deadline re-reads only that scholar and the page",
  tab.includes("fetchProbationRenewalDetail(id)") && /function toggleOpen[\s\S]*?if \(!isOpen\) void loadDetail\(id\)/.test(tab) && tab.includes("void loadDetail(sid); void load();")
  && api.includes("scholar_probation_renewal_detail") && api.includes("p_scholar_id: scholarIdNumber"));
console.log(`\n${passed} passed`);
