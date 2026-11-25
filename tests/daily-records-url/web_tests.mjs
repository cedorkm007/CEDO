// tests/daily-records-url/web_tests.mjs — Consultation Tool: the same tab, list and open record after a refresh (the address) (4 checks, short on purpose)
// Run:  node tests/daily-records-url/web_tests.mjs
// No database or browser needed (the address bar is replaced by a small stand-in).
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dru-"));
const bundle = async (entry, name) => { const outfile = path.join(tmp, name); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } }); return outfile; };
const U = await import(pathToFileURL(await bundle("src/lib/consultUrl.ts", "lib.mjs")).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const ID = "3f2b8c1e-5a47-4d8e-9b0a-6c7d8e9f0a1b", ID2 = "11111111-2222-3333-4444-555555555555";

await test("the tab is read from the address (the main dashboard when it is missing or wrong), and a change is written in one go: defaults are left out, a new tab starts clean, the page and other tools' parameters stay", () => {
  assert.equal(U.parseCtTab("?page=scholarCounseling"), "main-dashboard");
  assert.equal(U.parseCtTab("?ctTab=daily-records"), "daily-records");
  assert.equal(U.parseCtTab("?ctTab=nonsense"), "main-dashboard");
  assert.equal(U.applyPatch("?page=scholarCounseling", { ctTab: "main-dashboard" }), "?page=scholarCounseling");
  assert.equal(U.applyPatch("?page=scholarCounseling", { ctTab: "daily-records", ctPage: "2" }), "?page=scholarCounseling&ctTab=daily-records&ctPage=2");
  assert.equal(U.applyPatch("?page=scholarCounseling&ctTab=daily-records&ctPage=2&ctSearch=cruz&ctRecord=" + ID + "&other=1", { ctTab: "probation-monitoring" }, true), "?page=scholarCounseling&ctTab=probation-monitoring&other=1");
  assert.equal(U.applyPatch("?page=x&ctPage=3", { ctPage: null }), "?page=x");
  assert.equal(U.stripCt("?page=scholarCounseling&ctTab=daily-records&ctPage=2&keep=1"), "?page=scholarCounseling&keep=1");
  assert.ok(["ctTab", "ctRecord", "ctMode", "ctSearch", "ctQueue", "ctApproved", "ctStaff"].every(k => U.CT_PARAMS.includes(k)));
});

await test("every list comes back from the address exactly as it was written (page, search, dates, filters, sort, term, view, day), a wrong or old value falls back to the default, and an address that says nothing gives null (then the browser tab's memory is used)", () => {
  const d = { filters: { search: "cruz", from: "2026-11-01", to: "2026-11-25", visitTypes: ["Office", "Home Visit"], statuses: ["Probationary"], consultantIds: [ID] }, sortKey: "name", sortDir: "asc", page: 3 };
  const s = U.applyPatch("?page=scholarCounseling&ctTab=daily-records", U.dailyToParams(d));
  assert.deepEqual(U.dailyFromSearch(s), d);
  assert.equal(U.dailyFromSearch("?ctTab=daily-records"), null);
  assert.equal(U.dailyFromSearch("?ctTab=probation-monitoring&ctPage=2"), null, "another tab's address is not read as Daily Records");
  const bad = U.dailyFromSearch(`?ctTab=daily-records&ctPage=-4&ctFrom=yesterday&ctVisit=Fake,Office&ctStatus=Nope&ctConsultant=zzz,${ID2}&ctSort=bogus-up`);
  assert.deepEqual(bad.filters, { search: "", from: "", to: "", visitTypes: ["Office"], statuses: [], consultantIds: [ID2] });
  assert.equal(bad.page, 1); assert.equal(bad.sortKey, "date"); assert.equal(bad.sortDir, "desc");
  assert.equal(U.dailyToParams({ filters: { search: "  ", from: "", to: "", visitTypes: [], statuses: [], consultantIds: [] }, sortKey: "date", sortDir: "desc", page: 1 }).ctSort, null);
  const c = { filters: { search: "ana", term: "all", group: "ready" }, page: 2 };
  assert.deepEqual(U.casesFromSearch(U.applyPatch("?ctTab=renewal-cases", U.casesToParams(c))), c);
  assert.equal(U.casesFromSearch("?ctTab=renewal-cases&ctGroup=weird").filters.group, "");
  const p = { filters: { search: "", attention: ["soon", "no_study_plan"], kind: "temporary" }, sortKey: "deadline", sortDir: "desc", page: 4 };
  assert.deepEqual(U.probationFromSearch(U.applyPatch("?ctTab=probation-monitoring", U.probationToParams(p))), p);
  assert.equal(U.probationFromSearch("?ctTab=probation-monitoring&ctAttention=made_up").filters.attention.length, 0);
  assert.deepEqual(U.calendarFromSearch(`?ctTab=appointments&ctView=day&ctDate=2026-11-25&ctStaff=${ID}`), { view: "day", anchor: "2026-11-25", staff: ID });
  assert.equal(U.calendarToParams({ view: "week", anchor: "2026-11-25", staff: "" }, "2026-11-25").ctDate, null, "today is left out");
  assert.equal(U.calendarFromSearch("?ctTab=appointments&ctDate=31-12-2026").anchor, null);
  assert.deepEqual(U.dashboardFromSearch("?ctTab=main-dashboard&ctQueue=3&ctApproved=x"), { queue: 3, approved: 1 });
  assert.deepEqual(U.dashboardFromSearch("?ctTab=daily-records&ctQueue=3"), { queue: 1, approved: 1 });
});

await test("the open record: only a real id on the Daily Records tab counts, 'edit' is remembered, and anything else is ignored", () => {
  assert.deepEqual(U.recordFromSearch(`?ctTab=daily-records&ctRecord=${ID}`), { id: ID, edit: false });
  assert.deepEqual(U.recordFromSearch(`?ctTab=daily-records&ctRecord=${ID}&ctMode=edit`), { id: ID, edit: true });
  assert.equal(U.recordFromSearch(`?ctTab=daily-records&ctRecord=not-an-id`), null);
  assert.equal(U.recordFromSearch(`?ctTab=daily-records&ctRecord=${ID}%27%3Bdrop`), null);
  assert.equal(U.recordFromSearch(`?ctTab=probation-monitoring&ctRecord=${ID}`), null);
  assert.equal(U.recordFromSearch("?ctTab=daily-records"), null);
});

await test("the history: a tab change and an opened record are ONE step each (so Back and Forward follow them), a filter, page, search or edit mode only replaces the current step, nothing is written while another page is on screen or when nothing changed, and the open record's id stays on its step", async () => {
  const entries = [{ url: "/?page=scholarCounseling", state: null }]; let at = 0;
  const win = {
    get location() { const u = new URL("http://x" + entries[at].url); return { search: u.search, pathname: u.pathname, hash: u.hash }; },
    history: {
      get state() { return entries[at].state; },
      pushState(state, _t, url) { entries.splice(at + 1); entries.push({ url, state }); at = entries.length - 1; },
      replaceState(state, _t, url) { entries[at] = { url, state }; },
    },
    dispatchEvent() { return true; },
  };
  globalThis.window = win; globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
  const C = await import(pathToFileURL(await bundle("src/sead/consultUrl.ts", "browser.mjs")).href);
  assert.equal(C.ctPush({ ctTab: "daily-records" }, { clear: true }), false, "nothing is written while the tool is not on screen");
  assert.equal(entries.length, 1);
  C.setToolShown(true);
  assert.equal(C.ctPush({ ctTab: "daily-records" }, { clear: true }), true);
  assert.equal(entries.length, 2); assert.equal(entries[1].url, "/?page=scholarCounseling&ctTab=daily-records");
  assert.equal(C.ctPush({ ctTab: "daily-records" }, { clear: true }), false, "the same address adds no step");
  C.ctReplace({ ctPage: "3", ctSearch: "cruz" }); C.ctReplace({ ctPage: "4" });
  assert.equal(entries.length, 2, "filters and pages only replace the step"); assert.equal(entries[1].url, "/?page=scholarCounseling&ctTab=daily-records&ctPage=4&ctSearch=cruz");
  C.ctPush({ ctRecord: ID, ctMode: null }, { state: { ctRecord: ID } });
  assert.equal(entries.length, 3); assert.equal(win.history.state.ctRecord, ID);
  C.ctReplace({ ctMode: "edit" }); assert.equal(entries.length, 3); assert.ok(entries[2].url.endsWith("ctMode=edit")); assert.equal(win.history.state.ctRecord, ID, "the record's id stays on its step");
  C.ctPush({ ctTab: "probation-monitoring" }, { clear: true });
  assert.equal(entries[3].url, "/?page=scholarCounseling&ctTab=probation-monitoring", "the new tab starts clean: no page, search or record of the old one");
  at = 2; assert.equal(U.recordFromSearch(win.location.search).edit, true, "Back to the record's step brings the record, in edit mode");
  at = 1; assert.equal(U.recordFromSearch(win.location.search), null, "Back once more: the record is closed, the list is as it was");
  C.setToolShown(false); at = 3;
  assert.equal(C.ctReplace({ ctPage: "9" }), false);
  C.requestConsultTab("appointments"); assert.equal(entries[3].url, "/?page=scholarCounseling&ctTab=appointments", "a tab asked for from a notification is written even while the tool is hidden");
  delete globalThis.window;
});

await test("the screens use it: the tab comes from the address and a click is one step, the lists read the address first (the browser tab's memory second) and write it back, the open record pushes a step and closes by going Back, edit mode is in the address, the app takes the tool's parameters out when another page is shown, and a consultation notice opens Appointments", () => {
  const page = src("src/sead/ScholarCounselingToolPage.tsx"), daily = src("src/sead/pages/ScholarCounselingTab.tsx"), cases = src("src/sead/pages/ScholarCounselingRenewalCasesTab.tsx"), prob = src("src/sead/pages/ProbationMonitoringTab.tsx");
  const appts = src("src/sead/appointments/AppointmentsTab.tsx"), dash = src("src/sead/pages/ScholarCounselingDashboardTab.tsx"), app = src("src/app/App.tsx"), modal = src("src/sead/components/DailyRecordDetailModal.tsx");
  assert.ok(page.includes("parseCtTab(") && page.includes("ctPush({ ctTab: next }, { clear: true })") && page.includes('addEventListener("popstate"') && page.includes("CT_TAB_EVENT") && page.includes("<AppointmentsTab urlState />"));
  assert.ok(page.includes("goTab(t.tab)") && !page.includes("setTab(t.tab)"), "a dashboard number opens its tab as one step");
  assert.ok(daily.includes("dailyFromSearch(window.location.search) ?? readStored()") && cases.includes("casesFromSearch(window.location.search) ?? readStored()") && prob.includes("probationFromSearch(window.location.search) ?? readStored()") && appts.includes("calendarFromSearch(window.location.search)"));
  for (const [n, code] of [["daily", daily], ["cases", cases], ["probation", prob], ["appointments", appts], ["dashboard", dash]]) assert.ok(code.includes("ctReplace(") && !code.includes("ctPush(") === (n !== "daily"), `${n}: lists only replace the step`);
  assert.ok(dash.includes("dashboardFromSearch(window.location.search)") && dash.includes("dashboardToParams("));
  assert.ok(daily.includes("ctPush({ ctRecord: r.id, ctMode: null }, { state: { ctRecord: r.id } })") && daily.includes("window.history.back()") && daily.includes("recordFromSearch(window.location.search)") && daily.includes("could not be opened"));
  assert.ok(modal.includes("initialEditing") && modal.includes("onEditingChange") && daily.includes('ctReplace({ ctMode: editing ? "edit" : null })'));
  assert.ok(app.includes("for (const k of CT_PARAMS) url.searchParams.delete(k)") && app.includes('requestConsultTab("appointments")'));
});
console.log(`\n${passed} passed`);
