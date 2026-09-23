// Fills the office's own real Referral Form (Form R5) Word template —
// src/assets/ReferralFormTemplate.docx, built from the office's own
// hand-filled worked example with each entered value replaced by a
// {tag}-style placeholder (see scripts/tag-referral-template.cjs) — with a
// specific referral's data, rather than reconstructing the layout from
// scratch. This guarantees pixel-for-pixel fidelity to the real form, since
// it *is* the real form (down to the exact run formatting Word applied when
// the office typed into it, not a blank cell's defaults).
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { saveAs } from 'file-saver'
import templateUrl from '@/assets/ReferralFormTemplate.docx?url'

export interface ReferralTemplateSubjectRow {
  subjectCode: string
  semesterAcademicYear: string
  yearLevel: string
}

export interface ReferralTemplateSignature {
  buffer: ArrayBuffer
  /** Intrinsic pixel dimensions — used to fit the real signature into the template's fixed signature box without distorting it. */
  width: number
  height: number
}

export interface ReferralTemplateData {
  name: string
  courseYear: string
  school: string
  barangay: string
  contactNo: string
  previousSemesterStatus: string // 'Retained' | 'On Probation' | 'Special Recon'
  failedSubjects: ReferralTemplateSubjectRow[]
  lackingGrades: ReferralTemplateSubjectRow[]
  referredByName: string
  referredToName: string
  referralDate: string
  endorsedFor: string // 'On Probation Status' | 'Removal' | 'Renewal'
  remarks: string
  approvedByName: string
  /** null only if it genuinely couldn't be fetched — the signature box then keeps the template's own placeholder image. */
  signature: ReferralTemplateSignature | null
}

const EMPTY_ROW: ReferralTemplateSubjectRow = { subjectCode: '', semesterAcademicYear: '', yearLevel: '' }

/** The template has exactly 3 fixed ruled rows per matrix, matching the physical form — pad or truncate to that. */
function padToThree(rows: ReferralTemplateSubjectRow[]): [ReferralTemplateSubjectRow, ReferralTemplateSubjectRow, ReferralTemplateSubjectRow] {
  return [rows[0] ?? EMPTY_ROW, rows[1] ?? EMPTY_ROW, rows[2] ?? EMPTY_ROW]
}

function checkbox(value: string, expected: string): string {
  return value === expected ? '☑' : '☐'
}

// The "Noted by" signature is a floating anchored shape positioned over a
// fixed-size box in the office's own template (not inline table-cell flow),
// so it isn't something docxtemplater's {tag} text substitution can target —
// instead the embedded image bytes are swapped directly after rendering, and
// the anchor is resized to fit the real signature's aspect ratio inside the
// same box the office already sized for a signature.
const SIGNATURE_MEDIA_PATH = 'word/media/image2.png'
const SIGNATURE_BOX_EMU = { width: 1086485, height: 434340 }
const EMU_PER_PIXEL = 9525 // standard 96 DPI conversion, matching how Word/docxtemplater size images from pixels

function embedSignature(zip: PizZip, signature: ReferralTemplateSignature): void {
  zip.file(SIGNATURE_MEDIA_PATH, signature.buffer)

  const scale = Math.min(
    SIGNATURE_BOX_EMU.width / (signature.width * EMU_PER_PIXEL),
    SIGNATURE_BOX_EMU.height / (signature.height * EMU_PER_PIXEL),
  )
  const widthEmu = Math.round(signature.width * EMU_PER_PIXEL * scale)
  const heightEmu = Math.round(signature.height * EMU_PER_PIXEL * scale)

  const documentXmlFile = zip.file('word/document.xml')
  if (!documentXmlFile) throw new Error('word/document.xml missing from template')
  const originalExtent = `cx="${SIGNATURE_BOX_EMU.width}" cy="${SIGNATURE_BOX_EMU.height}"`
  const newExtent = `cx="${widthEmu}" cy="${heightEmu}"`
  const xml = documentXmlFile.asText().split(originalExtent).join(newExtent)
  zip.file('word/document.xml', xml)
}

export async function generateReferralFormFromTemplate(data: ReferralTemplateData): Promise<void> {
  const res = await fetch(templateUrl)
  const templateBuffer = await res.arrayBuffer()
  const zip = new PizZip(templateBuffer)

  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })

  const [fs0, fs1, fs2] = padToThree(data.failedSubjects)
  const [lg0, lg1, lg2] = padToThree(data.lackingGrades)

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
  })

  const outZip = doc.getZip()
  if (data.signature) embedSignature(outZip, data.signature)

  const blob: Blob = outZip.generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  saveAs(blob, `Referral_Form_${data.name.replace(/\s+/g, '_')}.docx`)
}
