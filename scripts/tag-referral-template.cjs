// One-time script: takes the office's hand-built "REFERRAL FORM.docx" (a real
// native Word table, not an image) and inserts {tag}-style placeholders into
// its currently-empty field cells and checkbox labels, producing a template
// docxtemplater can render at runtime. Run once with:
//   node scripts/tag-referral-template.cjs "<path to source docx>"
// Output: src/assets/ReferralFormTemplate.docx
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const srcPath = process.argv[2];
if (!srcPath) { console.error('Usage: node tag-referral-template.cjs <source.docx>'); process.exit(1); }

const zip = new PizZip(fs.readFileSync(srcPath));
let xml = zip.file('word/document.xml').asText();

function replaceOnce(oldStr, newStr, label) {
  const count = xml.split(oldStr).length - 1;
  if (count !== 1) throw new Error(`Expected exactly 1 occurrence of ${label}, found ${count}`);
  xml = xml.replace(oldStr, newStr);
}

// ── Simple field values: each of these labels is immediately followed by an
// empty paragraph in the next table cell — insert a run with the tag there. ──
function fillEmptyCellAfterLabel(labelText, tag, skipCells = 0) {
  // Find the label's own <w:p>...</w:p>, then the Nth-following empty
  // <w:p>...</w:p> (the value cell), and insert a run inside it. Most labels
  // are followed immediately by their value cell (skipCells = 0), but "Date:"
  // is split into two adjacent blank cells on the real form and the office
  // fills the second one, not the first — confirmed against the office's own
  // hand-filled reference copy.
  const labelIdx = xml.indexOf(`<w:t>${labelText}</w:t>`);
  if (labelIdx === -1) throw new Error(`Label not found: ${labelText}`);
  let cursor = xml.indexOf('</w:p></w:tc>', labelIdx) + '</w:p></w:tc>'.length;
  for (let i = 0; i < skipCells; i++) {
    const skipPStart = xml.indexOf('<w:p ', cursor);
    cursor = xml.indexOf('</w:p>', skipPStart) + '</w:p>'.length;
  }
  // The next <w:p ...>...</w:p> is the value cell's paragraph (self-contained, no runs).
  const nextPStart = xml.indexOf('<w:p ', cursor);
  const pPrEnd = xml.indexOf('</w:pPr>', nextPStart) + '</w:pPr>'.length;
  const closeP = xml.indexOf('</w:p>', pPrEnd);
  const run = `<w:r><w:t xml:space="preserve">{${tag}}</w:t></w:r>`;
  xml = xml.slice(0, closeP) + run + xml.slice(closeP);
}

fillEmptyCellAfterLabel('NAME:', 'name');
fillEmptyCellAfterLabel('COURSE &amp; YR. LEVEL:', 'courseYear');
fillEmptyCellAfterLabel('SCHOOL:', 'school');
fillEmptyCellAfterLabel('BARANGAY:', 'barangay');
fillEmptyCellAfterLabel('CONTACT NUMBER:', 'contactNo');
fillEmptyCellAfterLabel('Referred by:', 'referredByName');
fillEmptyCellAfterLabel('Referred to:', 'referredToName');
fillEmptyCellAfterLabel('Date:', 'referralDate', 1);

// ── Previous Semester Status checkboxes ──
replaceOnce(
  '<w:t>Retained</w:t>',
  '<w:t xml:space="preserve">{cbRetained} Retained</w:t>',
  'Retained checkbox slot',
);
replaceOnce(
  '<w:t xml:space="preserve">  On Probation  Special Reconsideration</w:t>',
  '<w:t xml:space="preserve">  {cbOnProbation} On Probation   {cbSpecialRecon} Special Reconsideration</w:t>',
  'On Probation/Special Reconsideration checkbox slot',
);

// ── Endorsed for checkboxes ──
replaceOnce(
  '<w:t>On Probation Status Removal Renewal</w:t>',
  '<w:t xml:space="preserve">{cbEndorsedProbation} On Probation Status   {cbEndorsedRemoval} Removal   {cbEndorsedRenewal} Renewal</w:t>',
  'Endorsed for checkboxes slot',
);

// ── Failed Subjects / Lacking Grades matrix (3 fixed ruled rows each,
// matching the physical form) — each empty <w:p> in these rows gets one
// positional tag. ──
function fillMatrixRow(precedingMarker, occurrenceIndexFromMarker, tags) {
  // Not used directly — matrix cells are filled by direct sequential scan below.
}

// The 6 matrix rows (3 failed-subject + 3 lacking-grade) each have exactly 3
// data cells (code / semester+year / yr level), all currently-empty <w:p>
// with no <w:pPr><w:rPr> content difference from each other — so we walk them
// in document order using the ruled-row anchor text that precedes each block.
function fillMatrixBlock(afterText, rowTagSets) {
  let cursor = xml.indexOf(afterText);
  if (cursor === -1) throw new Error(`Matrix anchor not found: ${afterText}`);
  for (const [codeTag, semTag, yrTag] of rowTagSets) {
    for (const tag of [codeTag, semTag, yrTag]) {
      const pStart = xml.indexOf('<w:p ', cursor);
      const pPrEnd = xml.indexOf('</w:pPr>', pStart) + '</w:pPr>'.length;
      const closeP = xml.indexOf('</w:p>', pPrEnd);
      const run = `<w:r><w:t xml:space="preserve">{${tag}}</w:t></w:r>`;
      xml = xml.slice(0, closeP) + run + xml.slice(closeP);
      cursor = closeP + run.length;
    }
  }
}

fillMatrixBlock('(Yr. </w:t></w:r><w:proofErr w:type="spellStart"/><w:r w:rsidRPr="00101CA9"><w:rPr><w:i/><w:sz w:val="14"/></w:rPr><w:t>Lvl</w:t></w:r><w:proofErr w:type="spellEnd"/><w:r w:rsidRPr="00101CA9"><w:rPr><w:i/><w:sz w:val="14"/></w:rPr><w:t>)</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="283" w:type="dxa"/><w:vMerge/>', [
  ['fs0code', 'fs0sem', 'fs0yr'],
  ['fs1code', 'fs1sem', 'fs1yr'],
  ['fs2code', 'fs2sem', 'fs2yr'],
]);

// Second occurrence of the same header pattern precedes the Lacking Grades rows.
{
  const marker = '(Yr. </w:t></w:r><w:proofErr w:type="spellStart"/><w:r w:rsidRPr="00101CA9"><w:rPr><w:i/><w:sz w:val="14"/></w:rPr><w:t>Lvl</w:t></w:r><w:proofErr w:type="spellEnd"/><w:r w:rsidRPr="00101CA9"><w:rPr><w:i/><w:sz w:val="14"/></w:rPr><w:t>)</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="283" w:type="dxa"/><w:vMerge/>';
  const firstIdx = xml.indexOf(marker);
  const secondIdx = xml.indexOf(marker, firstIdx + marker.length);
  if (secondIdx === -1) throw new Error('Lacking Grades header marker not found');
  let cursor = secondIdx;
  for (const [codeTag, semTag, yrTag] of [['lg0code', 'lg0sem', 'lg0yr'], ['lg1code', 'lg1sem', 'lg1yr'], ['lg2code', 'lg2sem', 'lg2yr']]) {
    for (const tag of [codeTag, semTag, yrTag]) {
      const pStart = xml.indexOf('<w:p ', cursor);
      const pPrEnd = xml.indexOf('</w:pPr>', pStart) + '</w:pPr>'.length;
      const closeP = xml.indexOf('</w:p>', pPrEnd);
      const run = `<w:r><w:t xml:space="preserve">{${tag}}</w:t></w:r>`;
      xml = xml.slice(0, closeP) + run + xml.slice(closeP);
      cursor = closeP + run.length;
    }
  }
}

// ── Noted by: signature image placeholder (image module tag) ──
replaceOnce(
  '<w:p w:rsidR="00553116" w:rsidRPr="00553116" w:rsidRDefault="00553116" w:rsidP="006A6E05"><w:pPr><w:rPr><w:b/><w:sz w:val="18"/></w:rPr></w:pPr></w:p></w:tc></w:tr>',
  '<w:p w:rsidR="00553116" w:rsidRPr="00553116" w:rsidRDefault="00553116" w:rsidP="006A6E05"><w:pPr><w:rPr><w:b/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:t>{%signature}</w:t></w:r></w:p></w:tc></w:tr>',
  'Noted-by signature cell',
);

// ── Approver printed name (was hardcoded "Roxanne Jul L. Tandang") ──
replaceOnce(
  '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">Roxanne Jul L. </w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>Tandang</w:t></w:r><w:proofErr w:type="spellEnd"/>',
  '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>{approvedByName}</w:t></w:r>',
  'approver printed name',
);

// ── Remarks value — a new paragraph appended inside the REMARKS cell, right
// after its floating "REMARKS:" badge shape's paragraph. ──
{
  const badgeParaEnd = xml.indexOf('</w:r></w:p></w:tc></w:tr>', xml.indexOf('REMARKS:'));
  if (badgeParaEnd === -1) throw new Error('Remarks cell insertion point not found');
  const insertAt = badgeParaEnd + '</w:r></w:p>'.length;
  const remarksPara = '<w:p><w:pPr><w:spacing w:before="360"/><w:rPr><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">{remarks}</w:t></w:r></w:p>';
  xml = xml.slice(0, insertAt) + remarksPara + xml.slice(insertAt);
}

zip.file('word/document.xml', xml);
const outPath = path.join(__dirname, '..', 'src', 'assets', 'ReferralFormTemplate.docx');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, zip.generate({ type: 'nodebuffer' }));
console.log('Wrote', outPath);
