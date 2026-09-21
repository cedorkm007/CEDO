import { generateReferralForm, type ReferralSubjectRow } from "@/lib/docGenerator";
import { fetchSignatureUrl, fetchMyStaffName, type QueuedReferral } from "./referralApi";

const MAX_SIGNATURE_WIDTH = 180;

async function loadSignature(path: string | null): Promise<{ buffer: ArrayBuffer; width: number; height: number } | null> {
  if (!path) return null;
  const url = await fetchSignatureUrl(path);
  if (!url) return null;
  const res = await fetch(url);
  const blob = await res.blob();
  const buffer = await blob.arrayBuffer();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIGNATURE_WIDTH / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  bitmap.close();
  return { buffer, width, height };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.includes("T") ? iso : `${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Generates the printable/downloadable Referral Form (.docx) for an
 * APPROVED referral — embeds the Division Head's actual approved
 * signature image rather than a blank signature line, since printing
 * only makes sense once that signature already exists.
 */
export async function printApprovedReferral(referral: QueuedReferral): Promise<void> {
  const [signature, myName] = await Promise.all([
    loadSignature(referral.signaturePath),
    fetchMyStaffName(),
  ]);
  const toRow = (r: { subjectCode: string; semesterAcademicYear: string; yearLevel: string }): ReferralSubjectRow => r;
  await generateReferralForm({
    scholarIdNumber: referral.scholarIdNumber,
    name: referral.name,
    courseYear: `${referral.course || "—"} / ${referral.yearLevel || "—"}`,
    school: referral.school,
    barangay: referral.barangay,
    contactNo: referral.contactNo,
    previousSemesterStatus: referral.previousSemesterStatus,
    failedSubjects: referral.failedSubjects.map(toRow),
    lackingGrades: referral.lackingGrades.map(toRow),
    referredByName: referral.referredByName,
    referredToName: myName,
    referralDate: formatDate(referral.referralDate),
    endorsedFor: referral.endorsedFor,
    remarks: referral.remarks,
    approvedByName: referral.approvedByName || "—",
    approvedAt: formatDate(referral.approvedAt),
    signature,
  });
}
