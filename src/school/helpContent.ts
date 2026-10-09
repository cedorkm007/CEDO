// ─────────────────────────────────────────────────────────────
// src/school/helpContent.ts
// What the School Portal's "Help / Contact CEDO" window says. The office details are the ones printed on the
// office's own letterhead (src/sead/components/DocPage.tsx); change them here if they ever change.
// ─────────────────────────────────────────────────────────────

export const CEDO_CONTACT = {
  office: "City Education and Development Office (CEDO) — CDO City Scholarships Office",
  address: "2/F Police Station 1, City Hall Compound, Cagayan de Oro 9000 PH",
  email: "cedo@cagayandeoro.gov.ph",
  mobile: "+63 929 819 0819",
  mobileLink: "+639298190819",
  facebook: "CDO City Scholarships Office",
} as const;

export const HELP_STEPS: { title: string; body: string }[] = [
  { title: "Check the period", body: "The bar under the header shows which school year and semester you are working on. You can only enter or change grades while that period is Open." },
  { title: "Set up your grading scale", body: "Open the Grading System tab and save your scale (and letter grades, if you use them). Grades cannot be entered until this is done." },
  { title: "Declare subjects and enter grades", body: "Choose Enter Grades beside a scholar. Add each subject with its units. Leave the grade blank until it is available. Tick \"Exclude from GWA\" for subjects such as NSTP or PE." },
  { title: "Or upload many at once", body: "Use Download template, type the grades into the file, then Upload CSV. You will see a preview of every row before anything is saved." },
  { title: "Watch the progress", body: "A scholar is Complete when every subject has a grade. The summary at the top shows how many scholars are still Not set up or Not graded." },
];
