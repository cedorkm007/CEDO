// One-time script: turns the office's own "RECOMMENDATION FOR SCHOLARSHIP RENEWAL" form (a Word file) into the template the School Portal fills in for the clearances:
//   node scripts/build-clearance-template.cjs "<path to the office's .docx>"
// Output: src/assets/ClearanceTemplate.docx  — a valid one-form Word file whose entered values are {tag} placeholders:
//   {name} {contact} {school} {gwa} {courseYear} {semester} {scholarId}
// The form's own text and formatting (Calibri 8 pt, the three tick boxes, the CEDO-only block) are kept exactly as the office wrote them. The letterhead (CEDO banner) that sits in the
// page header of the office's file is moved INTO the form, and so is the footer picture, so two forms can share one A4 page and each still has its letterhead.
// The school's own logo that is in the office's file (the Capitol University seal) is NOT carried over: every school has its own and the system does not hold them.
// src/lib/clearanceForm.ts repeats the form once per scholar, two to a page.
const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");

const src = process.argv[2];
if (!src) { console.error("Usage: node build-clearance-template.cjs <the office's .docx>"); process.exit(1); }
const zip = new PizZip(fs.readFileSync(src));
const doc = zip.file("word/document.xml").asText();
const header = zip.file("word/header1.xml").asText();
const footer = zip.file("word/footer1.xml").asText();

const bodyStart = doc.indexOf("<w:body>") + "<w:body>".length;
const root = doc.slice(0, bodyStart);
const body = doc.slice(bodyStart, doc.indexOf("<w:sectPr"));
const paras = body.split("</w:p>").filter(p => p.includes("<w:p")).map(p => p + "</w:p>");
if (paras.length !== 22) throw new Error(`Expected 22 paragraphs in the form, found ${paras.length}`);
const text = p => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join("");
const expect = (i, s) => { if (!text(paras[i]).includes(s)) throw new Error(`Paragraph ${i} should contain "${s}" but is "${text(paras[i])}"`); };
expect(1, "RECOMMENDATION FOR SCHOLARSHIP RENEWAL"); expect(2, "GIVEN NAME"); expect(5, "SCHOLAR ID"); expect(7, "Following the check-in"); expect(21, "Received by");

// ── the four lines of details, rebuilt with the office's own run formatting and one tab stop so the right-hand column lines up whatever the length of the left value ──
const RP = '<w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:rtl w:val="0"/></w:rPr>';
const RPB = '<w:rPr><w:b w:val="1"/><w:bCs w:val="1"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:rtl w:val="0"/></w:rPr>';
const run = (rpr, t) => `<w:r>${rpr}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const tab = `<w:r>${RP}<w:tab/></w:r>`;
const PPR = after => `<w:pPr><w:tabs><w:tab w:val="left" w:pos="6400"/></w:tabs><w:spacing w:after="${after}" w:lineRule="auto"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:pPr>`;
const line = (after, parts) => `<w:p>${PPR(after)}${parts.join("")}</w:p>`;
const details = [
  line(20, [run(RP, "GIVEN NAME: "), run(RPB, "{name}"), tab, run(RP, "CONTACT NUMBER: "), run(RPB, "{contact}")]),
  line(20, [run(RP, "SCHOOL: "), run(RPB, "{school}"), tab, run(RP, "QPI/GWA: "), run(RPB, "{gwa}")]),
  line(20, [run(RP, "COURSE AND YEAR: "), run(RPB, "{courseYear}"), tab, run(RP, "SEMESTER: "), run(RPB, "{semester}")]),
  line(20, [run(RP, "SCHOLAR ID: "), run(RPB, "{scholarId}")]),
];

// ── the letterhead: the CEDO banner (anchored picture) in its own line, tall enough that the title starts below it ──
const anchors = header.match(/<wp:anchor[\s\S]*?<\/wp:anchor>/g);
const banner = anchors.find(a => a.includes('name="image3.png"'));
if (!banner) throw new Error("CEDO banner (image3.png) not found in the header");
const bannerXml = banner.replace('r:embed="rId1"', 'r:embed="rIdClBanner"');
const letterhead = `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1000" w:lineRule="exact"/></w:pPr><w:r><w:drawing>${bannerXml}</w:drawing></w:r></w:p>`;
// ── the footer picture, inline, centred ──
const inline = footer.match(/<wp:inline[\s\S]*?<\/wp:inline>/)[0].replace('r:embed="rId1"', 'r:embed="rIdClFooter"');
const footerPara = `<w:p><w:pPr><w:spacing w:before="60" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>${inline}</w:drawing></w:r></w:p>`;

// the form is repeated, so the identifiers Word puts on each paragraph (paraId, rsid) are dropped: they must not repeat
const block = [letterhead, paras[1], ...details, paras[6], paras[7], ...paras.slice(8, 22), footerPara].join("").replace(/ w14:paraId="[^"]*"/g, "").replace(/ w:rsid[A-Za-z]*="[^"]*"/g, "");
const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="400" w:right="652" w:bottom="400" w:left="652" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
zip.file("word/document.xml", `${root}${block}${sect}</w:body></w:document>`);

// ── the package: no header/footer parts, no school logo, the two pictures are referenced from the body ──
let rels = zip.file("word/_rels/document.xml.rels").asText();
rels = rels.replace(/<Relationship [^>]*Target="header1.xml"\/>/, "").replace(/<Relationship [^>]*Target="footer1.xml"\/>/, "");
rels = rels.replace("</Relationships>", '<Relationship Id="rIdClBanner" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image3.png"/><Relationship Id="rIdClFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>');
zip.file("word/_rels/document.xml.rels", rels);
for (const f of ["word/header1.xml", "word/footer1.xml", "word/_rels/header1.xml.rels", "word/_rels/footer1.xml.rels", "word/media/image2.png"]) zip.remove(f);
let types = zip.file("[Content_Types].xml").asText();
types = types.replace(/<Override [^>]*PartName="\/word\/header1.xml"\/>/, "").replace(/<Override [^>]*PartName="\/word\/footer1.xml"\/>/, "");
zip.file("[Content_Types].xml", types);

const out = path.join(__dirname, "..", "src", "assets", "ClearanceTemplate.docx");
fs.writeFileSync(out, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("written", out);
