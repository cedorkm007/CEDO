// One-time script: takes the office's own HAND-FILLED example Referral Form
// (a real native Word table, already filled in with a worked example so it
// carries the exact formatting Word applies once you type into it — not the
// blank form's empty-cell defaults) and replaces each filled-in example
// value with a {tag}-style placeholder docxtemplater can render at runtime.
// Run once with:
//   node scripts/tag-referral-template.cjs "<path to filled example .docx>"
// Output: src/assets/ReferralFormTemplate.docx
//
// The office's example (as of the file this was built from) fills in:
//   Name: RACHEL ABA · Course/Yr: BSMA / 3rd Year · School: Capitol University
//   Barangay: Pagatpat · Contact: 9938395070 · Status: On Probation (checked)
//   Failed Subjects row 1: Calculus I / 1st semester 2025-2026 / 3
//   Referred by/to: Julius Jay · Endorsed for: On Probation Status (checked)
//   Date: Sept. 23, 2026 · Approved by: Roxanne Jul L. Tandang
// Lacking Grades and Failed Subjects rows 2-3 were left blank in the example,
// so those are filled positionally instead (like the original blank cells).
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const srcPath = process.argv[2];
if (!srcPath) { console.error('Usage: node tag-referral-template.cjs <source.docx>'); process.exit(1); }

const zip = new PizZip(fs.readFileSync(srcPath));
let xml = zip.file('word/document.xml').asText();

const originalRows = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g);
if (!originalRows || originalRows.length !== 21) {
  throw new Error(`Expected 21 table rows, found ${originalRows ? originalRows.length : 0}`);
}

function replaceRowOnce(rowXml, oldStr, newStr, label) {
  const count = rowXml.split(oldStr).length - 1;
  if (count !== 1) throw new Error(`Expected exactly 1 occurrence of ${label}, found ${count}`);
  return rowXml.replace(oldStr, newStr);
}

/** Replaces the Nth (1-indexed) checkbox glyph run found in rowXml with a {tag} placeholder run. */
function replaceCheckboxSequence(rowXml, tags) {
  let result = rowXml;
  let cursor = 0;
  for (const tag of tags) {
    const m = /<w:t>[☐☑]<\/w:t>/.exec(result.slice(cursor));
    if (!m) throw new Error(`Ran out of checkbox glyphs looking for {${tag}}`);
    const idx = cursor + m.index;
    const replacement = `<w:t>{${tag}}</w:t>`;
    result = result.slice(0, idx) + replacement + result.slice(idx + m[0].length);
    cursor = idx + replacement.length;
  }
  return result;
}

function insertIntoEmptyCell(cellXml, tag) {
  const pPrEnd = cellXml.indexOf('</w:pPr>') + '</w:pPr>'.length;
  const closeP = cellXml.indexOf('</w:p>', pPrEnd);
  const run = `<w:r><w:t xml:space="preserve">{${tag}}</w:t></w:r>`;
  return cellXml.slice(0, closeP) + run + cellXml.slice(closeP);
}

/** Matrix rows are 7 cells: code, divider, semester/year, divider, yr level, and 2 vMerge-continue fillers. */
function fillEmptyMatrixRow(rowXml, [codeTag, semTag, yrTag]) {
  const cells = rowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g);
  if (!cells || cells.length !== 7) throw new Error(`Expected 7 cells in matrix row, found ${cells ? cells.length : 0}`);
  let result = rowXml;
  [[0, codeTag], [2, semTag], [4, yrTag]].forEach(([cellIndex, tag]) => {
    const original = cells[cellIndex];
    const count = result.split(original).length - 1;
    if (count !== 1) throw new Error(`Matrix cell ${cellIndex} not uniquely found in its own row (count ${count})`);
    result = result.replace(original, insertIntoEmptyCell(original, tag));
  });
  return result;
}

const rows = [...originalRows];

// ── Row 0: NAME + REMARKS badge (remarks value appended after the badge) ──
rows[0] = replaceRowOnce(rows[0], '<w:t>RACHEL ABA</w:t>', '<w:t>{name}</w:t>', 'NAME value');
{
  const remarksIdx = rows[0].indexOf('REMARKS:');
  const badgeParaEnd = rows[0].indexOf('</w:r></w:p></w:tc></w:tr>', remarksIdx);
  if (badgeParaEnd === -1) throw new Error('Remarks insertion point not found in row 0');
  const insertAt = badgeParaEnd + '</w:r></w:p>'.length;
  const remarksPara = '<w:p><w:pPr><w:spacing w:before="360"/><w:rPr><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">{remarks}</w:t></w:r></w:p>';
  rows[0] = rows[0].slice(0, insertAt) + remarksPara + rows[0].slice(insertAt);
}

// ── Row 1-4: single-value fields ──
rows[1] = replaceRowOnce(rows[1], '<w:t>BSMA / 3rd Year</w:t>', '<w:t>{courseYear}</w:t>', 'COURSE & YR. LEVEL value');
rows[2] = replaceRowOnce(rows[2], '<w:t>Capitol University</w:t>', '<w:t>{school}</w:t>', 'SCHOOL value');
rows[3] = replaceRowOnce(rows[3], '<w:t>Pagatpat</w:t>', '<w:t>{barangay}</w:t>', 'BARANGAY value');
rows[4] = replaceRowOnce(rows[4], '<w:t>9938395070</w:t>', '<w:t>{contactNo}</w:t>', 'CONTACT NUMBER value');

// ── Row 5: Previous Semester Status checkboxes (Retained / On Probation / Special Reconsideration) ──
rows[5] = replaceCheckboxSequence(rows[5], ['cbRetained', 'cbOnProbation', 'cbSpecialRecon']);

// ── Row 8: Failed Subjects, filled example row ──
rows[8] = replaceRowOnce(rows[8], '<w:t>Calculus I</w:t>', '<w:t>{fs0code}</w:t>', 'fs0code');
rows[8] = replaceRowOnce(
  rows[8],
  '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r><w:r w:rsidRPr="00E72007"><w:rPr><w:sz w:val="18"/><w:vertAlign w:val="superscript"/></w:rPr><w:t>st</w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> semester 2025-2026</w:t></w:r>',
  '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">{fs0sem}</w:t></w:r>',
  'fs0sem',
);
rows[8] = replaceRowOnce(rows[8], '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>3</w:t></w:r>', '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">{fs0yr}</w:t></w:r>', 'fs0yr');

// ── Rows 9-10: Failed Subjects, blank example rows — filled positionally ──
rows[9] = fillEmptyMatrixRow(rows[9], ['fs1code', 'fs1sem', 'fs1yr']);
rows[10] = fillEmptyMatrixRow(rows[10], ['fs2code', 'fs2sem', 'fs2yr']);

// ── Rows 14-16: Lacking Grades, all blank in the example — filled positionally ──
rows[14] = fillEmptyMatrixRow(rows[14], ['lg0code', 'lg0sem', 'lg0yr']);
rows[15] = fillEmptyMatrixRow(rows[15], ['lg1code', 'lg1sem', 'lg1yr']);
rows[16] = fillEmptyMatrixRow(rows[16], ['lg2code', 'lg2sem', 'lg2yr']);

// ── Row 17: Referred by (office sized the name down to 16pt from the template's default 18pt) ──
rows[17] = replaceRowOnce(
  rows[17],
  '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>Julius Jay</w:t></w:r>',
  '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>{referredByName}</w:t></w:r>',
  'referredByName',
);

// ── Row 18: Referred to (same 16pt sizing), Endorsed for checkboxes, Noted by signature (left untouched — swapped at render time) ──
rows[18] = replaceRowOnce(
  rows[18],
  '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>Julius Jay</w:t></w:r>',
  '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>{referredToName}</w:t></w:r>',
  'referredToName',
);
rows[18] = replaceCheckboxSequence(rows[18], ['cbEndorsedProbation', 'cbEndorsedRemoval', 'cbEndorsedRenewal']);

// ── Row 19: Date ──
rows[19] = replaceRowOnce(rows[19], '<w:t>Sept. 23, 2026</w:t>', '<w:t>{referralDate}</w:t>', 'referralDate');

// ── Row 20: Approver printed name ──
rows[20] = replaceRowOnce(
  rows[20],
  '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">Roxanne Jul L. </w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>Tandang</w:t></w:r><w:proofErr w:type="spellEnd"/>',
  '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>{approvedByName}</w:t></w:r>',
  'approver printed name',
);

// ── Splice the modified rows back into the document. Several blank matrix
// rows are byte-identical to each other, so a plain string replace would hit
// the wrong one — walk forward positionally instead, since originalRows are
// already in top-to-bottom document order. ──
{
  let outXml = '';
  let cursor = 0;
  originalRows.forEach((original, i) => {
    const idx = xml.indexOf(original, cursor);
    if (idx === -1) throw new Error(`Row ${i} not found from cursor ${cursor}`);
    outXml += xml.slice(cursor, idx) + rows[i];
    cursor = idx + original.length;
  });
  outXml += xml.slice(cursor);
  xml = outXml;
}

zip.file('word/document.xml', xml);
const outPath = path.join(__dirname, '..', 'src', 'assets', 'ReferralFormTemplate.docx');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, zip.generate({ type: 'nodebuffer' }));
console.log('Wrote', outPath);
