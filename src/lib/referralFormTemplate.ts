// Fills the office's own real Referral Form (Form R5) Word template —
// src/assets/ReferralFormTemplate.docx, the office's hand-built native
// table with {tag}-style placeholders inserted by
// scripts/tag-referral-template.cjs — with a specific referral's data,
// rather than reconstructing the layout from scratch. This guarantees
// pixel-for-pixel fidelity to the real form, since it *is* the real form.
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
// @ts-expect-error -- no type declarations published for this package
import ImageModule from 'docxtemplater-image-module-free'
import { saveAs } from 'file-saver'
import templateUrl from '@/assets/ReferralFormTemplate.docx?url'

export interface ReferralTemplateSubjectRow {
  subjectCode: string
  semesterAcademicYear: string
  yearLevel: string
}

export interface ReferralTemplateSignature {
  buffer: ArrayBuffer
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
  /** null only if it genuinely couldn't be fetched — Noted by then prints blank rather than throwing. */
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

export async function generateReferralFormFromTemplate(data: ReferralTemplateData): Promise<void> {
  const res = await fetch(templateUrl)
  const templateBuffer = await res.arrayBuffer()
  const zip = new PizZip(templateBuffer)

  const blankSignature = new ArrayBuffer(0)
  const imageModule = new ImageModule({
    centered: false,
    getImage: (tagValue: ReferralTemplateSignature | null) => tagValue?.buffer ?? blankSignature,
    getSize: (_img: unknown, tagValue: ReferralTemplateSignature | null) =>
      tagValue ? [tagValue.width, tagValue.height] : [1, 1],
  })

  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, modules: [imageModule] })

  const [fs0, fs1, fs2] = padToThree(data.failedSubjects)
  const [lg0, lg1, lg2] = padToThree(data.lackingGrades)

  // The signature tag's value is an OBJECT ({buffer, width, height}), not a
  // string — the image module's synchronous render() only re-resolves
  // string-valued tags (it treats any object value as already-resolved
  // {rId, sizePixel}, which ours isn't, crashing on a missing sizePixel).
  // renderAsync() routes through the module's resolve() path instead,
  // which always calls getImage/getSize fresh regardless of value type.
  await doc.renderAsync({
    name: data.name,
    courseYear: data.courseYear,
    school: data.school,
    barangay: data.barangay,
    contactNo: data.contactNo,
    referredByName: data.referredByName,
    referredToName: data.referredToName,
    referralDate: data.referralDate,
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
    remarks: data.remarks,
    signature: data.signature,
  })

  const blob: Blob = doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  saveAs(blob, `Referral_Form_${data.name.replace(/\s+/g, '_')}.docx`)
}
