// Command-line Referral Form generator — fills the same tagged office
// template the app uses (src/assets/ReferralFormTemplate.docx) with the same
// logic as src/lib/referralFormTemplate.ts, so a form can be produced and
// checked without going through the UI.
// Run with:
//   node scripts/generate-referral-form.cjs <data.json> [output.docx]
// data.json uses the ReferralTemplateData shape, except `signature` is a path
// to a PNG (optional — omitted keeps the template's placeholder image).
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const [dataPath, outArg] = process.argv.slice(2);
if (!dataPath) { console.error('Usage: node generate-referral-form.cjs <data.json> [output.docx]'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const templatePath = path.join(__dirname, '..', 'src', 'assets', 'ReferralFormTemplate.docx');

const EMPTY_ROW = { subjectCode: '', semesterAcademicYear: '', yearLevel: '' };
const padToThree = (rows = []) => [rows[0] ?? EMPTY_ROW, rows[1] ?? EMPTY_ROW, rows[2] ?? EMPTY_ROW];
const checkbox = (value, expected) => (value === expected ? '☑' : '☐');

// Must stay in sync with SIGNATURE_* in src/lib/referralFormTemplate.ts.
const SIGNATURE_MEDIA_PATH = 'word/media/image2.png';
const SIGNATURE_BOX_EMU = { width: 1086485, height: 434340 };
const EMU_PER_PIXEL = 9525;

function embedSignature(zip, pngBuffer) {
  // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  zip.file(SIGNATURE_MEDIA_PATH, pngBuffer);
  const scale = Math.min(
    SIGNATURE_BOX_EMU.width / (width * EMU_PER_PIXEL),
    SIGNATURE_BOX_EMU.height / (height * EMU_PER_PIXEL),
  );
  const originalExtent = `cx="${SIGNATURE_BOX_EMU.width}" cy="${SIGNATURE_BOX_EMU.height}"`;
  const newExtent = `cx="${Math.round(width * EMU_PER_PIXEL * scale)}" cy="${Math.round(height * EMU_PER_PIXEL * scale)}"`;
  zip.file('word/document.xml', zip.file('word/document.xml').asText().split(originalExtent).join(newExtent));
}

const doc = new Docxtemplater(new PizZip(fs.readFileSync(templatePath)), { paragraphLoop: true, linebreaks: true });
const [fs0, fs1, fs2] = padToThree(data.failedSubjects);
const [lg0, lg1, lg2] = padToThree(data.lackingGrades);

doc.render({
  name: data.name,
  courseYear: data.courseYear,
  school: data.school,
  barangay: data.barangay,
  contactNo: data.contactNo,
  referredByName: data.referredByName,
  referredToName: data.referredToName,
  referralDate: data.referralDate,
  remarks: data.remarks,
  cbRetained: checkbox(data.previousSemesterStatus, 'Retained'),
  cbOnProbation: checkbox(data.previousSemesterStatus, 'On Probation'),
  cbSpecialRecon: checkbox(data.previousSemesterStatus, 'Special Recon'),
  cbEndorsedProbation: checkbox(data.endorsedFor, 'On Probation Status'),
  cbEndorsedRemoval: checkbox(data.endorsedFor, 'Removal'),
  cbEndorsedRenewal: checkbox(data.endorsedFor, 'Renewal'),
  fs0code: fs0.subjectCode, fs0sem: fs0.semesterAcademicYear, fs0yr: fs0.yearLevel,
  fs1code: fs1.subjectCode, fs1sem: fs1.semesterAcademicYear, fs1yr: fs1.yearLevel,
  fs2code: fs2.subjectCode, fs2sem: fs2.semesterAcademicYear, fs2yr: fs2.yearLevel,
  lg0code: lg0.subjectCode, lg0sem: lg0.semesterAcademicYear, lg0yr: lg0.yearLevel,
  lg1code: lg1.subjectCode, lg1sem: lg1.semesterAcademicYear, lg1yr: lg1.yearLevel,
  lg2code: lg2.subjectCode, lg2sem: lg2.semesterAcademicYear, lg2yr: lg2.yearLevel,
  approvedByName: data.approvedByName,
});

const outZip = doc.getZip();
if (data.signature) embedSignature(outZip, fs.readFileSync(path.resolve(path.dirname(dataPath), data.signature)));

const outPath = outArg || `Referral_Form_${String(data.name).replace(/\s+/g, '_')}.docx`;
fs.writeFileSync(outPath, outZip.generate({ type: 'nodebuffer' }));
console.log('Wrote', path.resolve(outPath));
