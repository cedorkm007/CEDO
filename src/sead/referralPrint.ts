import { generateReferralFormFromTemplate } from "@/lib/referralFormTemplate";
import { fetchSignatureUrl, fetchMyStaffName, type QueuedReferral } from "./referralApi";

async function loadSignature(path: string | null): Promise<{ buffer: ArrayBuffer; width: number; height: number } | null> {
  if (!path) return null;
  const url = await fetchSignatureUrl(path);
  if (!url) return null;
  const res = await fetch(url);
  const blob = await res.blob();
  const buffer = await blob.arrayBuffer();
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  return { buffer, width, height };
}

// AP-style abbreviations, matching how the office fills the printed Date field by hand
// (e.g. "Sept. 23, 2026") — May/June/July are already short enough to leave unabbreviated.
const ABBREVIATED_MONTHS = [
  "Jan.", "Feb.", "March", "April", "May", "June",
  "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec.",
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  return `${ABBREVIATED_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Generates the printable/downloadable Referral Form (.docx) for an
 * APPROVED referral by filling the office's own real Word template
 * (src/assets/ReferralFormTemplate.docx) — embeds the Division Head's
 * actual approved signature image rather than a blank signature line,
 * since printing only makes sense once that signature already exists.
 */
export async function printApprovedReferral(referral: QueuedReferral): Promise<void> {
  const [signature, myName] = await Promise.all([
    loadSignature(referral.signaturePath),
    fetchMyStaffName(),
  ]);
  await generateReferralFormFromTemplate({
    name: referral.name,
    courseYear: `${referral.course || "—"} / ${referral.yearLevel || "—"}`,
    school: referral.school,
    barangay: referral.barangay,
    contactNo: referral.contactNo,
    previousSemesterStatus: referral.previousSemesterStatus,
    failedSubjects: referral.failedSubjects,
    lackingGrades: referral.lackingGrades,
    referredByName: referral.referredByName,
    referredToName: myName,
    referralDate: formatDate(referral.referralDate),
    endorsedFor: referral.endorsedFor,
    remarks: referral.remarks,
    approvedByName: referral.approvedByName || "—",
    signature,
  });
}
