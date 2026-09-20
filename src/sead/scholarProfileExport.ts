import type { ScholarInformationRow } from "./seadApi";
import { fetchScholarQuestProgress } from "./seadApi";
import { fetchScholarSDPHistory } from "./sdpMonitorApi";
import { fetchScholarFormationAttendance } from "./formationActivitiesApi";
import { toCsv, downloadCsv } from "./csvUtils";
import { exportComprehensiveScholarProfilePdf } from "./pdfTableExport";
import { generateComprehensiveScholarProfile } from "@/lib/docGenerator";

export interface ProfileSections {
  basicInfo: { label: string; value: string }[];
  sdpCompleted: { activityName: string; category: string; date: string }[];
  formationAttended: { activityName: string; dateTime: string; venue: string }[];
  questSubjects: { subjectName: string; topicCount: number; percentage: number; isCompleted: boolean }[];
}

/**
 * Fetches every subsystem section needed for one scholar's comprehensive
 * profile, in parallel. Shared by ScholarListPanel (Scholarship Program
 * Information's drill-down downloads) and ScholarProfilePreviewModal (the
 * on-screen "complete details" popup, also used by the Scholar Counseling
 * Tool's Daily Records "View" action) — one implementation, two call sites.
 */
export async function loadProfileSections(r: ScholarInformationRow): Promise<ProfileSections> {
  const [sdp, quest, formation] = await Promise.all([
    fetchScholarSDPHistory(r.scholarIdNumber),
    fetchScholarQuestProgress(r.scholarIdNumber),
    fetchScholarFormationAttendance(r.scholarIdNumber),
  ]);
  return {
    basicInfo: [
      { label: "Scholar ID", value: r.scholarIdNumber },
      { label: "Name", value: `${r.lastName}, ${r.firstName} ${r.middleName}`.trim() },
      { label: "School", value: r.school || "" },
      { label: "Program", value: r.course || "" },
      { label: "Year Level", value: r.yearLevel || "" },
      { label: "Status", value: r.status || "" },
      { label: "Barangay", value: r.barangay || "" },
      { label: "Birthday", value: r.birthday || "" },
      { label: "Civil Status", value: r.civilStatus || "" },
      { label: "Contact No.", value: r.contactNo || "" },
    ],
    sdpCompleted: sdp.attended.map(a => ({ activityName: a.activityName, category: a.category || "", date: a.date })),
    formationAttended: formation.map(f => ({ activityName: f.activityName, dateTime: f.dateTime, venue: f.venue })),
    questSubjects: quest.map(q => ({ subjectName: q.subjectName, topicCount: q.topicCount, percentage: q.percentage, isCompleted: q.isCompleted })),
  };
}

/** Downloads one scholar's comprehensive profile in the given format — the same three formats every export menu in this app offers. */
export async function downloadScholarProfile(r: ScholarInformationRow, format: "csv" | "pdf" | "word", sections: ProfileSections): Promise<void> {
  if (format === "word") {
    await generateComprehensiveScholarProfile({
      scholar: r,
      sdpCompleted: sections.sdpCompleted,
      formationAttended: sections.formationAttended,
      questSubjects: sections.questSubjects,
      generatedAt: new Date().toLocaleString(),
    });
  } else if (format === "pdf") {
    await exportComprehensiveScholarProfilePdf({
      scholarIdNumber: r.scholarIdNumber,
      basicInfo: sections.basicInfo,
      sections: [
        {
          heading: `SDP — Completed Activities (${sections.sdpCompleted.length})`,
          columns: ["Activity", "Category", "Date"],
          rows: sections.sdpCompleted.map(a => [a.activityName, a.category || "—", a.date || "—"]),
          emptyMessage: "No completed SDP activities.",
        },
        {
          heading: `Formation Activities — Attended (${sections.formationAttended.length})`,
          columns: ["Activity", "Date", "Venue"],
          rows: sections.formationAttended.map(a => [a.activityName, a.dateTime || "—", a.venue || "—"]),
          emptyMessage: "No formation activity attendance recorded.",
        },
        {
          heading: `Quest — Subjects (${sections.questSubjects.length})`,
          columns: ["Subject", "Topics Completed", "Score", "Status"],
          rows: sections.questSubjects.map(q => [q.subjectName, String(q.topicCount), `${q.percentage.toFixed(1)}%`, q.isCompleted ? "Completed" : "In Progress"]),
          emptyMessage: "No Quest activity recorded.",
        },
      ],
    });
  } else {
    const blocks = [
      toCsv(["Field", "Value"], sections.basicInfo.map(b => [b.label, b.value])),
      `SDP — Completed Activities (${sections.sdpCompleted.length})\r\n` + toCsv(["Activity", "Category", "Date"], sections.sdpCompleted.map(a => [a.activityName, a.category, a.date])),
      `Formation Activities — Attended (${sections.formationAttended.length})\r\n` + toCsv(["Activity", "Date", "Venue"], sections.formationAttended.map(a => [a.activityName, a.dateTime, a.venue])),
      `Quest — Subjects (${sections.questSubjects.length})\r\n` + toCsv(["Subject", "Topics Completed", "Score", "Status"], sections.questSubjects.map(q => [q.subjectName, q.topicCount, `${q.percentage.toFixed(1)}%`, q.isCompleted ? "Completed" : "In Progress"])),
    ];
    downloadCsv(`Scholar_Profile_${r.scholarIdNumber}_${new Date().toISOString().slice(0, 10)}.csv`, blocks.join("\r\n\r\n"));
  }
}
