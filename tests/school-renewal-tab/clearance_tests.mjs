// tests/school-renewal-tab/clearance_tests.mjs — the pre-filled clearance (the office's Recommendation for Scholarship Renewal form): the template, the Word file, the PDF, two to a page, and the button.
// Run:  node tests/school-renewal-tab/clearance_tests.mjs     (no database or browser needed)
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const PizZip = require("pizzip");
const { DOMParser } = require("@xmldom/xmldom");
const { PDFDocument } = require("pdf-lib");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const bundle = path.join(root, ".clr_tests_tmp.mjs");
await build({ entryPoints: [path.join(root, "src/lib/clearanceForm.ts")], bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") }, external: ["pizzip", "pdf-lib"] });
const C = await import(pathToFileURL(bundle).href);
fs.rmSync(bundle);

const template = fs.readFileSync(path.join(root, "src/assets/ClearanceTemplate.docx"));
const person = (n, over = {}) => C.clearanceEntryFor({ firstName: "Juan", middleName: "Santos", lastName: `Dela Cruz ${n}`, contactNo: "09171234567", schoolName: "Xavier University", gwaText: "2.57", program: "Bachelor of Science in Psychology", yearLevel: "3rd Year", semester: "1st Semester 2025-2026", scholarIdNumber: `2409-0000${n}`, ...over });
const xmlOf = docx => new PizZip(docx).file("word/document.xml").asText();
const wellFormed = xml => { const errors = []; new DOMParser({ onError: (l, m) => errors.push(`${l} ${m}`) }).parseFromString(xml, "text/xml"); return errors; };
const count = (s, re) => (s.match(re) ?? []).length;

console.log("The template");
await test("it is the office's own form: the wording, the three tick boxes and the CEDO block are as the office wrote them", () => {
  const x = xmlOf(template);
  const t = [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join("|");
  for (const s of ["RECOMMENDATION FOR SCHOLARSHIP RENEWAL", "Recommended for Scholarship Renewal", "Recommended for Scholarship Renewal with Close Monitoring and Appropriate Intervention", "May Be Advised to Apply for a Leave of Absence (LOA)",
    "Remarks/Recommendation:", "This certification is issued for scholarship renewal purposes only.", "School Guidance Counselor", "FOR CEDO STAFF ONLY.", "Date received", "Action Taken:", "Received by", "Endorsed for Scholarship Renewal", "For Leave of Absence (LOA) Processing"]) assert.ok(t.includes(s), s);
});
await test("the entered values are tags: name, contact, school, GWA, course and year, semester, Scholar ID; no sample person is left", () => {
  const x = xmlOf(template);
  for (const tag of ["name", "contact", "school", "gwa", "courseYear", "semester", "scholarId"]) assert.ok(x.includes(`{${tag}}`), tag);
  for (const sample of ["JUAN", "XAVIER", "PSYCHOLOGY", "12345678", "CRUZ"]) assert.equal(x.includes(sample), false, sample);
});
await test("the letterhead and the footer are inside the form (so each form on a page has its own), the school's logo is not carried over, and the file is a valid package", () => {
  const z = new PizZip(template);
  const files = Object.keys(z.files);
  assert.ok(files.includes("word/media/image3.png") && files.includes("word/media/image1.png"));
  assert.equal(files.includes("word/media/image2.png"), false);                       // the Capitol University seal of the office's example
  assert.equal(files.some(f => /header|footer/.test(f)), false);
  const x = xmlOf(template);
  assert.equal(count(x, /<wp:anchor/g), 1); assert.equal(count(x, /<wp:inline/g), 1);
  assert.equal(/headerReference|footerReference/.test(x), false);
  assert.deepEqual(wellFormed(x), []);
  const rels = z.file("word/_rels/document.xml.rels").asText();
  assert.ok(rels.includes('Id="rIdClBanner"') && rels.includes('Id="rIdClFooter"') && !/header1|footer1/.test(rels));
  assert.equal(/header1|footer1/.test(z.file("[Content_Types].xml").asText()), false);
});
await test("the page is A4 upright with a small margin, so two half-page forms fit", () => {
  const x = xmlOf(template);
  assert.ok(/<w:pgSz w:w="11906" w:h="16838"\/>/.test(x));
});
await test("no paragraph identifier is left to repeat when the form is repeated", () => assert.equal(/paraId|w:rsid/.test(xmlOf(template)), false));

console.log("\nThe Word file");
await test("one scholar: the details are in the right places, nothing is left as a tag", () => {
  const x = xmlOf(C.buildClearanceDocx(template, [person(1)]));
  const t = [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join("|");
  for (const s of ["JUAN SANTOS DELA CRUZ 1", "09171234567", "XAVIER UNIVERSITY", "2.57", "BACHELOR OF SCIENCE IN PSYCHOLOGY 3", "1st Semester 2025-2026", "2409-00001"]) assert.ok(t.includes(s), s);
  assert.equal(/\{[a-zA-Z]+\}/.test(x), false);
  assert.deepEqual(wellFormed(x), []);
});
await test("two to a page: 1 and 2 scholars are one page, 3 and 4 are two (a page break after every second form, none at the end)", () => {
  const breaks = n => count(xmlOf(C.buildClearanceDocx(template, Array.from({ length: n }, (_, i) => person(i + 1)))), /<w:br w:type="page"\/>/g);
  assert.deepEqual([1, 2, 3, 4, 5].map(breaks), [0, 0, 1, 1, 2]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(C.pageCountFor), [0, 1, 1, 2, 2, 3]);
});
await test("a dashed cut line divides the two forms of a page", () => {
  const x = xmlOf(C.buildClearanceDocx(template, [person(1), person(2), person(3)]));
  assert.equal(count(x, /w:val="dashed" w:sz="6"/g), 1);
});
await test("every picture in the file has its own number (a repeated number makes Word complain), and all the scholars are there", () => {
  const x = xmlOf(C.buildClearanceDocx(template, Array.from({ length: 7 }, (_, i) => person(i + 1))));
  const ids = [...x.matchAll(/<wp:docPr id="(\d+)"/g)].map(m => m[1]);
  assert.equal(ids.length, 14); assert.equal(new Set(ids).size, 14);
  for (let i = 1; i <= 7; i++) assert.ok(x.includes(`2409-0000${i}`));
  assert.deepEqual(wellFormed(x), []);
});
await test("characters that are special in a Word file (& < > quotes) are escaped, not broken", () => {
  const x = xmlOf(C.buildClearanceDocx(template, [person(1, { lastName: `O'Brien & <Sons> "Jr"`, schoolName: "Ateneo & Co" })]));
  assert.ok(x.includes("O'BRIEN &amp; &lt;SONS&gt; &quot;JR&quot;") && x.includes("ATENEO &amp; CO"));
  assert.deepEqual(wellFormed(x), []);
});
await test("a missing contact number or GWA leaves the box empty (a dash GWA is not printed)", () => {
  const e = person(1, { contactNo: "", gwaText: "—" });
  assert.equal(e.contact, ""); assert.equal(e.gwa, "");
  assert.deepEqual(wellFormed(xmlOf(C.buildClearanceDocx(template, [e]))), []);
});
await test("the file keeps the office's styles, theme and pictures", () => {
  const z = new PizZip(C.buildClearanceDocx(template, [person(1), person(2)]));
  for (const f of ["word/styles.xml", "word/theme/theme1.xml", "word/media/image3.png", "word/media/image1.png", "[Content_Types].xml"]) assert.ok(z.file(f), f);
});

console.log("\nWhat goes in the boxes");
await test("the name is First Middle Last in capitals, the year level is a number, the course is in capitals", () => {
  const e = person(1);
  assert.equal(e.name, "JUAN SANTOS DELA CRUZ 1"); assert.equal(e.courseYear, "BACHELOR OF SCIENCE IN PSYCHOLOGY 3"); assert.equal(e.school, "XAVIER UNIVERSITY");
  const n = C.clearanceEntryFor({ firstName: "Ana", middleName: "", lastName: "Cruz", contactNo: " 0917 ", schoolName: "X", gwaText: "85.5", program: "BSIT", yearLevel: "Irregular", semester: "s", scholarIdNumber: " 1 " });
  assert.equal(n.name, "ANA CRUZ"); assert.equal(n.courseYear, "BSIT Irregular"); assert.equal(n.contact, "0917"); assert.equal(n.scholarId, "1");
});

console.log("\nThe PDF");
await test("two forms to an A4 page: 1 or 2 scholars make one page, 3 make two, 5 make three", async () => {
  const pages = async n => (await PDFDocument.load(await C.buildClearancePdf(template, Array.from({ length: n }, (_, i) => person(i + 1))))).getPageCount();
  assert.deepEqual([await pages(1), await pages(2), await pages(3), await pages(5)], [1, 1, 2, 3]);
  const doc = await PDFDocument.load(await C.buildClearancePdf(template, [person(1)]));
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.1 && Math.abs(height - 841.89) < 0.1);
});
await test("long and odd values do not break it", async () => {
  const bytes = await C.buildClearancePdf(template, [person(1, { program: "Bachelor of Science in Civil Engineering Major in Structural Engineering and Construction Management", schoolName: "A very long school name of the kind that some universities have in the Philippines" }), person(2, { firstName: "Ñoño", lastName: "Reyes-Santos" })]);
  assert.ok(bytes.length > 1000);
});

console.log("\nThe button");
const panel = src("src/school/components/RenewalMonitorPanel.tsx"), menu = src("src/school/components/ClearanceDownloadMenu.tsx"), dl = src("src/school/clearanceDownload.ts"), page = src("src/school/pages/SchoolPortalPage.tsx");
await test("it is there whenever the list has scholars (even when nobody has an INC or a failed grade), and follows the filters (the scholars of every page, not only the page on screen)", () => {
  assert.ok(panel.includes("const clearanceRows = useMemo(() => shown.filter(needsClearance), [shown])") && panel.includes("shown.length > 0 && summary") && panel.includes("flaggedRows={clearanceRows} allRows={shown}"));
  assert.equal(panel.includes("clearanceRows.length > 0 && summary"), false);
  assert.ok(page.includes("<RenewalMonitorPanel schoolId={profile.schoolId} schoolName={profile.schoolName} />"));
});
await test("the school chooses who it is for (everybody shown, or only INC / failed); with nobody flagged it is everybody and says so", () => {
  assert.ok(menu.includes("Everybody shown") && menu.includes("Scholars with an INC or a failed grade") && menu.includes("flaggedRows.length === 0 ? \"all\" : scope") && menu.includes("Nobody shown has an INC or a failed grade"));
});
await test("the school chooses Word or PDF, is told how many clearances and pages, and sees why a download failed", () => {
  assert.ok(menu.includes("Word (.docx)") && menu.includes('"PDF"') && menu.includes("clearance{rows.length === 1") && menu.includes("Couldn't prepare the clearances"));
});
await test("the forms come out in name order, with the GWA of the judged semester under the school's rules for it, and contact numbers of its own scholars only", () => {
  assert.ok(dl.includes("[...rows].sort(byName)") && dl.includes("rulesAt(") && dl.includes("summarizeScholarGrades(") && dl.includes('.from("scholars").select("scholar_id_number, contact_no")'));
  assert.equal(/\.(insert|update|delete|upsert)\(|rpc\(/.test(dl), false);       // it only reads
});
await test("the template is built from the office's file by a script that is in the project", () => assert.ok(fs.existsSync(path.join(root, "scripts/build-clearance-template.cjs"))));

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
