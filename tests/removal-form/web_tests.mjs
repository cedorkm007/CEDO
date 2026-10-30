// tests/removal-form/web_tests.mjs — the Scholarship Grant Termination Acknowledgement Form: the words, the PDF, the screens
// Run:  node tests/removal-form/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rmf-"));
const outfile = path.join(tmp, "form.mjs");
await build({ entryPoints: [path.join(root, "supabase/functions/_shared/removalFormPdf.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root });
const F = await import(pathToFileURL(outfile).href);
const { PDFDocument } = await import("pdf-lib");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

/** The text the PDF draws (every string of every page), without spaces, to compare against. */
function pdfText(bytes) {
  const buf = Buffer.from(bytes), out = []; let from = 0;
  for (;;) {
    const a = buf.indexOf("stream", from, "latin1"); if (a < 0) break;
    const b = buf.indexOf("endstream", a + 6, "latin1"); if (b < 0) break;
    let s = a + 6; if (buf[s] === 0x0d) s++; if (buf[s] === 0x0a) s++;
    let body = buf.subarray(s, b); try { body = zlib.inflateSync(body); } catch { /* not compressed */ }
    for (const m of body.toString("latin1").matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(m[1], "hex").toString("latin1"));
    from = b + 9;
  }
  return out.join("").replace(/\s+/g, "");
}
const base = {
  first: "Bergel Jr", middle: "Obsioma", last: "Losbañes", program: "Bachelor of Science in Civil Engineering", yearLevel: "3rd Year", school: "CU", barangay: "Bulua",
  failed: [{ semesterYear: "2nd Semester 2025-2026", yearLevel: "2", code: "CE201", subject: "Dynamics of Rigid Bodies" }, { semesterYear: "1st Semester 2026-2027", yearLevel: "3", code: "CE301", subject: "Geotechnical Engineering 1 ( Solid Mechanics)" }],
  issuedOn: "2026-10-28", divisionHead: { name: "Roxanne Jul L. Tandang", title: F.DIVISION_HEAD_TITLE, signature: null }, officer: { name: "Richel Petalcurin-Dahay", title: "Acting City Education and Development Officer", signature: null },
};

console.log("The words");
await test("a semester and a school year are told apart; text that is neither is kept as the semester", () => {
  assert.deepEqual(F.splitSemesterYear("2nd Semester 2025-2026"), { semester: "2nd Semester", schoolYear: "2025-2026" });
  assert.deepEqual(F.splitSemesterYear("1st Sem. 2024 – 2025"), { semester: "1st Semester", schoolYear: "2024-2025" });
  assert.deepEqual(F.splitSemesterYear("Summer 2025-2026"), { semester: "Summer", schoolYear: "2025-2026" });
  assert.deepEqual(F.splitSemesterYear("1st 2025"), { semester: "1st Semester", schoolYear: "2025" });
  assert.deepEqual(F.splitSemesterYear("last year"), { semester: "last year", schoolYear: "—" });
  assert.deepEqual(F.splitSemesterYear(""), { semester: "—", schoolYear: "—" });
});
await test("the total is in words and figures; the date is written out", () => {
  assert.equal(F.countInWords(2), "Two (2)"); assert.equal(F.countInWords(1), "One (1)"); assert.equal(F.countInWords(12), "Twelve (12)"); assert.equal(F.countInWords(25), "25");
  assert.equal(F.longDate("2026-10-28"), "October 28, 2026"); assert.equal(F.longDate("2026-01-05"), "January 5, 2026");
});
await test("the failed subjects are grouped by semester and year level, in order; a subject with no name shows its code; blank rows are left out", () => {
  const g = F.groupFailedSubjects([
    { semesterYear: "1st Semester 2025-2026", yearLevel: "2", code: "A1", subject: "Algebra" }, { semesterYear: "1st Semester 2025-2026", yearLevel: "2", code: "B2", subject: "" },
    { semesterYear: "2nd Semester 2025-2026", yearLevel: "2", code: "C3", subject: "Chemistry" }, { semesterYear: "", yearLevel: "", code: "", subject: "" },
  ]);
  assert.equal(g.length, 2); assert.deepEqual(g[0].subjects, ["Algebra", "B2"]); assert.equal(g[0].schoolYear, "2025-2026"); assert.deepEqual(g[1].subjects, ["Chemistry"]);
});

console.log("The PDF");
await test("the form is one A4 page that prints the scholar, the programme, the school, the barangay, the subjects, the total, the date and the four signature places", async () => {
  const bytes = await F.buildRemovalFormPdf(base);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
  const doc = await PDFDocument.load(bytes); assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize(); assert.ok(Math.abs(width - 595.28) < 0.5 && Math.abs(height - 841.89) < 0.5, "A4");
  const text = pdfText(bytes);
  for (const raw of ["SCHOLARSHIP GRANT TERMINATION ACKNOWLEDGEMENT FORM", "BERGEL JR O. LOSBAÑES", "BACHELOR OF SCIENCE IN CIVIL ENGINEERING - 3RD YEAR", "CU", "BULUA", "2nd Semester", "2025-2026", "Dynamics of Rigid Bodies",
    "Geotechnical Engineering 1 ( Solid Mechanics)", "Total Failed Subjects", "Two (2)", "City Ordinance No. 13362-2018", "outright removal from the program", "Date of Issued:", "October 28, 2026", "Witness:", "Name and Signature of Grantee",
    "Name and Signature of Parent/Guardian", "Noted by:", "Endorsed by:", "ROXANNE JUL L. TANDANG", "Head, Scholarships and Educational Assistance Division", "RICHEL PETALCURIN-DAHAY", "Acting City Education and Development Officer"])
    assert.ok(text.includes(raw.replace(/\s+/g, "")), "missing on the form: " + raw);
});
await test("a long list of failed subjects is set more tightly and still fits one page; a very long one moves the signatures to a second page, none is cut off", async () => {
  const many = n => ({ ...base, failed: Array.from({ length: n }, (_, i) => ({ semesterYear: `${i % 2 ? "2nd" : "1st"} Semester 202${3 + Math.floor(i / 2)}-202${4 + Math.floor(i / 2)}`, yearLevel: String(2 + Math.floor(i / 2)), code: "X" + i, subject: "A long subject name number " + i + " of the course" })) });
  const six = await F.buildRemovalFormPdf(many(6)); assert.equal((await PDFDocument.load(six)).getPageCount(), 1);
  const ten = await F.buildRemovalFormPdf(many(10)); const pages = (await PDFDocument.load(ten)).getPageCount(); assert.ok(pages <= 2);
  for (const bytes of [six, ten]) { const text = pdfText(bytes); assert.ok(text.includes("Notedby:") && text.includes("Endorsedby:") && text.includes("NameandSignatureofGrantee".replace(/\s+/g, "")) && text.includes("Total Failed Subjects".replace(/\s+/g, ""))); }
  assert.ok(pdfText(six).includes("Six(6)") && pdfText(ten).includes("Ten(10)"));
});
await test("no failed subject, odd characters and a missing signature never break the file", async () => {
  const none = await F.buildRemovalFormPdf({ ...base, failed: [] }); assert.equal((await PDFDocument.load(none)).getPageCount(), 1); assert.ok(pdfText(none).includes("Zero(0)"));
  const odd = await F.buildRemovalFormPdf({ ...base, last: "Ñandú ★ O'Brien", school: "中文大学", barangay: "", program: "" }); assert.equal((await PDFDocument.load(odd)).getPageCount(), 1);
  const long = await F.buildRemovalFormPdf({ ...base, officer: { name: "Ms. Richel Petalcurin-Dahay, LPT, MPSM with a very long name that goes on and on", title: "City Education and Development Officer, City Education and Development Office", signature: null } }); assert.equal((await PDFDocument.load(long)).getPageCount(), 1);
});
await test("a picture that cannot be read as a signature is left out and the printed name stays", async () => {
  const bad = await F.buildRemovalFormPdf({ ...base, divisionHead: { ...base.divisionHead, signature: new Uint8Array([1, 2, 3]) } });
  assert.ok(pdfText(bad).includes("ROXANNEJULL.TANDANG"));
});

console.log("The calls and the screens");
const fn = src("supabase/functions/removal-form-issue/index.ts"), api = src("src/lib/removalFormApi.ts");
await test("the edge function asks the database who may open the form (as the signed-in person), reads the two e-signatures with its own access, stores nothing and answers with the file", () => {
  assert.ok(fn.includes('asCaller.rpc("removal_form_data"') && fn.includes('picture("staff-signatures"') && fn.includes('picture("csr-assets"'));
  assert.equal(/\.upload\(|\.insert\(|\.update\(|createSignedUrl/.test(fn), false, "nothing is stored");
  assert.ok(fn.includes("pdfBase64: toBase64(pdf)") && fn.includes("Please sign in first."));
});
await test("the website asks for the lists and for the file, and saves it as a PDF", () => {
  for (const r of ["removal_forms_mine", "consult_removal_forms"]) assert.ok(api.includes(`rpc("${r}")`), r);
  assert.ok(api.includes('functions.invoke("removal-form-issue"') && api.includes('type: "application/pdf"') && /fetchMyRemovalForms[\s\S]*return \[\];/.test(api), "empty (not an error) before the database update");
});
await test("the scholar's Renewal tile shows a card to download the form, also when no renewal is open", () => {
  const card = src("src/scholar/components/dashboard/RemovalFormCard.tsx"), panel = src("src/scholar/components/dashboard/RenewalPanel.tsx");
  assert.ok(card.includes("Download the form (PDF)") && card.includes("sign it together with your parent or guardian") && card.includes("if (forms.length === 0) return null;"));
  assert.equal((panel.match(/<RemovalFormCard \/>/g) ?? []).length, 2, "in both the no-renewal view and the normal view");
});
await test("the consulting staff's dashboard lists the termination forms to download, for the removals the Division Head approved", () => {
  const d = src("src/sead/pages/ScholarCounselingDashboardTab.tsx");
  assert.ok(d.includes("Scholarship termination forms (") && d.includes("fetchConsultRemovalForms()") && d.includes("downloadRemovalForm(id)") && d.includes("Download the form (PDF)"));
  assert.ok(d.includes("waiting for your final decision") && d.includes("final decision made"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
