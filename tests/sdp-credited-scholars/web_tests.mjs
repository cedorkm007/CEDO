// tests/sdp-credited-scholars/web_tests.mjs — SDP Monitoring > an activity > Credited Scholars: the rules of the tab (date format, names with Ñ, when the semester chip shows, reasons, sort / filter choices, ticking)
// and the screen: the size of the pop-up, the fixed parts, the two sides, the table, the paging and the speed (6 checks)
// Run:  node tests/sdp-credited-scholars/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdpc-"));
const f = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/sdpCreditedView.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const V = await import(pathToFileURL(f).href);

// 1. one date format; names with accents
check("1 every date reads 'Nov 23, 2026' (a plain day never shifts by the time zone; a full timestamp is read by its day; nothing gives a dash); a name written in capitals except its accented letters is shown fully in capitals (IBAñEZ → IBAÑEZ), a normal name (Ibañez) and a plain one are left alone",
  V.formatCreditDate("2026-11-23") === "Nov 23, 2026" && V.formatCreditDate("2026-01-05") === "Jan 5, 2026" && V.formatCreditDate("2026-11-23T20:00:00+00:00") === "Nov 23, 2026" && V.formatCreditDate(null) === "—" && V.formatCreditDate("nonsense") === "—" && V.formatCreditDate("2026-13-01") === "—"
  && V.fixAccentCase("JUAN IBAñEZ") === "JUAN IBAÑEZ" && V.fixAccentCase("MUñOZ") === "MUÑOZ" && V.fixAccentCase("Juan Ibañez") === "Juan Ibañez" && V.fixAccentCase("JUAN CRUZ") === "JUAN CRUZ" && V.fixAccentCase("María Núñez") === "María Núñez" && V.fixAccentCase("") === ""
  && V.fullName("JUAN", "IBAñEZ") === "JUAN IBAÑEZ" && V.fullName("Ana", "  Cruz ") === "Ana Cruz");

// 2. the semester chip
const sel = "2026-2027|1st Semester";
const same = V.semesterChip("2026-2027", "1st Semester", sel), other = V.semesterChip("2025-2026", "2nd Semester", sel), none = V.semesterChip(null, null, sel), noneSel = V.semesterChip(null, null, ""), spelled = V.semesterChip("2026-2027", "1st Sem", sel);
check("2 the semester chip shows ONLY when the credit's semester is different from 'Counts in' (so a mistake stands out), including 'No semester'; a credit in the chosen semester shows none, however the semester was typed",
  same.show === false && other.show === true && other.label === "2025-2026 · 2nd Semester" && none.show === true && none.label === "No semester" && noneSel.show === false && spelled.show === false);

// 3. reasons, sorting, filtering, ticking
const so = V.semesterFilterOptions([{ schoolYear: "2026-2027", semester: "1st Semester", n: 80 }, { schoolYear: null, semester: null, n: 3 }]);
let sel2 = V.toggleAllOnPage(new Set(["x"]), ["a", "b"], true); const all = V.allOnPageSelected(sel2, ["a", "b"]); sel2 = V.toggleAllOnPage(sel2, ["a", "b"], false);
check("3 each reason has its wording (waiting for the survey, no category, credit saved for later, no credit recorded); the sort choices and the semester filter map to what the database is asked; 'Select all on this page' ticks the page and no more; the crediting sentence says it ADDS credit (it no longer says the category is complete); the rows per page are 25 or 50",
  /survey/.test(V.reasonText("survey")) && /no SDP category/.test(V.reasonText("no_category")) && /saved for a later semester/.test(V.reasonText("banked")) && /no credit was recorded/.test(V.reasonText("missing"))
  && JSON.stringify(V.sortParams("name_asc")) === '{"key":"name","dir":"asc"}' && JSON.stringify(V.sortParams("date_desc")) === '{"key":"date","dir":"desc"}' && V.SORT_CHOICES.length === 4
  && JSON.stringify(V.semesterFilterParams("2026-2027|1st Semester")) === '{"schoolYear":"2026-2027","semester":"1st Semester","noSemester":false}' && V.semesterFilterParams("none").noSemester === true && V.semesterFilterParams("").schoolYear === null
  && so[0].label === "2026-2027 · 1st Semester (80)" && so[1].value === "none" && so[1].label === "No semester (3)" && all === true && sel2.has("x") && !sel2.has("a")
  && V.creditingNote("Formation Program", 1) === "Crediting a scholar adds 1 credit toward Formation Program." && V.creditingNote("Community Service", 2) === "Crediting a scholar adds 2 credits toward Community Service." && !/complete/.test(V.creditingNote("X", 1))
  && V.pickPageSize(50) === 50 && V.pickPageSize("25") === 25 && V.pickPageSize(1000) === 25 && V.DEFAULT_PAGE_SIZE === 25);

// 4. the pop-up
const tab = src("src/sead/pages/SDPMonitoringTab.tsx");
check("4 the pop-up: a phone fills the screen, a tablet nearly all of it, a computer 92% of the window (at most 1400px wide, centred); the header is compact; the header and the tab bar stay fixed; only the list scrolls; the page behind does not scroll; the bar at the bottom is fixed and holds the paging and Close; the close (X) is always visible",
  tab.includes("h-[100dvh] w-screen") && tab.includes("sm:h-[calc(100dvh-1.5rem)] sm:w-[calc(100vw-1.5rem)]") && tab.includes("lg:h-[92dvh] lg:w-[min(92vw,1400px)]") && tab.includes("lg:p-0")
  && tab.includes("shrink-0 items-start justify-between") && tab.includes("py-2.5") && /shrink-0 px-4 pt-2 sm:px-6/.test(tab) && tab.includes('document.body.style.overflow = "hidden"') && tab.includes("return () => { document.body.style.overflow = before; }")
  && tab.includes("ref={setPagerSlot}") && tab.includes("border-t border-[#e6ecf5] bg-white") && tab.includes('aria-label="Close"') && tab.includes("md:overflow-hidden") && !tab.includes("h-[70vh]") && !tab.includes("function AttendanceSection"));

// 5. the tab
const panel = src("src/sead/components/CreditedScholarsPanel.tsx");
check("5 the tab: the two-button switch with live counts, 'Credit selected (N)' and 'Credit these scholars (N)' (each asks to confirm), tick boxes and 'Select all on this page', a table with Scholar | Scholar ID | Date credited | Semester | Actions, names that end with … and show in full on hover, a ⋮ menu (Change semester, Remove credit with a confirmation), bulk Change semester / Remove, search, sort and semester filter; the old amber section is gone",
  panel.includes('aria-label="Show"') && panel.includes("Not credited") && panel.includes("Credit selected (${selected.size})") && panel.includes("Credit these scholars (${summary?.creditable ?? 0})") && panel.includes("window.confirm(confirmCreditText(")
  && panel.includes('aria-label="Select all on this page"') && ["Scholar</th>", "Scholar ID</th>", "Date credited</th>", "Semester</th>"].every(t => panel.includes(t)) && panel.includes("truncate font-medium") && panel.includes("title={name}")
  && panel.includes('role="menu"') && panel.includes("Change semester") && panel.includes("Remove credit") && panel.includes("window.confirm(`Remove ${rowName(r)}") && panel.includes("Remove credits") && panel.includes('aria-label="Sort"') && panel.includes('aria-label="Semester filter"') && panel.includes('aria-label="Search this list"')
  && !tab.includes("Scanned the QR code but not credited") && !tab.includes("Crediting a scholar here marks"));
check("6 paging and speed: the credits are read one page at a time (25 or 50, with the true total and 'Rows per page'), the search waits 300 ms, grey rows show while a page loads, friendly empty messages, the tab is read only when it is opened, and after an action only the affected rows and the numbers change (no reading of the whole list); the scholar search of the form uses the fast search",
  panel.includes("fetchCreditedPage(") && panel.includes("fetchNotCreditedPage(") && panel.includes("<ServerPagination") && panel.includes("Rows per page") && panel.includes("}, 300)") && panel.includes("animate-pulse") && panel.includes("No scholars credited yet.") && panel.includes("Everyone who attended has been credited.")
  && tab.includes('{tab === "credited" && (') && /const dropRows =[\s\S]*?setCredited\(rows => \(rows \?\? \[\]\)\.filter/.test(panel) && panel.includes("loadSummary()") && panel.includes("searchScholarsForCredit(q, activity.id)") && src("src/sead/sdpCreditedApi.ts").includes('"sdp_search_scholars"') && src("src/sead/sdpCreditedApi.ts").includes("p_limit: 10"));
console.log(`\n${passed} passed`);
