// Kagay-anon Bridging Application: the rules the screens share. No browser or database code here, so the tests can run it alone.
// The database checks the same things again (bridging_sql/bridging_phase1_setup.sql); these only give the person a quick, clear message.

export type Role = "student" | "teacher";

export interface School { id: string; name: string; jhs: boolean; shs: boolean; college: boolean; als: boolean }
export interface Level { key: string; label: string; group: "jhs" | "shs" | "college" | "als" }

export const LEVELS: Level[] = [
  ...[7, 8, 9, 10].map(n => ({ key: `g${n}`, label: `Grade ${n}`, group: "jhs" as const })),
  ...[11, 12].map(n => ({ key: `g${n}`, label: `Grade ${n}`, group: "shs" as const })),
  ...["1st", "2nd", "3rd", "4th", "5th"].map((n, i) => ({ key: `c${i + 1}`, label: `College – ${n} Year`, group: "college" as const })),
  { key: "als_jhs", label: "ALS – Junior High School", group: "als" },
  { key: "als_shs", label: "ALS – Senior High School", group: "als" },
];
export const levelLabel = (key: string | null | undefined): string => LEVELS.find(l => l.key === key)?.label ?? "";

/** The levels a school offers. A school that is not listed yet offers them all. */
export const levelsFor = (school: School | null): Level[] => (school ? LEVELS.filter(l => school[l.group]) : LEVELS);

/** The sign-in service wants an email, so a username becomes one that never receives mail. */
export const ACCOUNT_DOMAIN = "bridging.cedo.local";
export const cleanUsername = (raw: string): string => raw.trim().toLowerCase();
export const accountEmail = (username: string): string => `${cleanUsername(username)}@${ACCOUNT_DOMAIN}`;

export const usernameProblem = (raw: string): string =>
  /^[a-z0-9][a-z0-9._]{3,29}$/.test(cleanUsername(raw)) ? "" : "Use 4 to 30 letters or numbers (dot and underscore are fine, no spaces).";

export const passwordMin = (role: Role): number => (role === "teacher" ? 10 : 8);
export function passwordProblem(password: string, role: Role, username = ""): string {
  const min = passwordMin(role);
  if (password.length < min) return `Use at least ${min} characters.`;
  if (password.length > 72) return "Use at most 72 characters.";
  if (/^(.)\1+$/.test(password) || /^(?:0?123456789?0?|password\d*|qwerty\w*)$/i.test(password)) return "That password is too easy to guess.";
  if (username && password.toLowerCase() === cleanUsername(username)) return "Do not use your username as your password.";
  return "";
}

export const emailLooksRight = (value: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

/** "My teacher": an approved teacher, one who has no account yet (name only), or none. */
export type TeacherChoice = { kind: "teacher"; id: string; name: string } | { kind: "no_account"; name: string } | { kind: "none" };
export const teacherPayload = (t: TeacherChoice): { id: string } | { name: string } | null =>
  t.kind === "teacher" ? { id: t.id } : t.kind === "no_account" && t.name.trim() ? { name: t.name.trim() } : null;

export const teacherStatusLabel = (status: string): string =>
  status === "confirmed" ? "Confirmed" : status === "pending" ? "Waiting for your teacher to confirm" : status === "declined" ? "Your teacher did not accept the request" : "No account yet — nothing to confirm";

export interface NoticeSettings { dpoName: string; dpoEmail: string; retention: string; under18Mode: "guardian" | "notice" }
/** Fills the privacy notice's blanks. What CEDO has not filled in yet is said openly, never left empty. */
export function fillNotice(text: string, s: NoticeSettings, lang: "en" | "ceb"): string {
  const pending = lang === "en" ? "(to be announced by CEDO)" : "(ipahibalo pa sa CEDO)";
  return text
    .replace("{retention}", s.retention.trim() || pending)
    .replace("{dpo_name}", s.dpoName.trim() || pending)
    .replace("{dpo_email}", s.dpoEmail.trim() ? `— ${s.dpoEmail.trim()}` : "");
}

export interface ConsentState { agreed: boolean; under18: boolean | null; guardianName: string; guardianAgreed: boolean }
export const emptyConsent: ConsentState = { agreed: false, under18: null, guardianName: "", guardianAgreed: false };
export function consentProblem(c: ConsentState, role: Role, mode: NoticeSettings["under18Mode"]): string {
  if (role === "student" && c.under18 === null) return "Tell us whether you are under 18.";
  if (role === "student" && c.under18 && mode === "guardian" && (!c.guardianName.trim() || !c.guardianAgreed)) return "A parent or guardian must type their name and tick their box.";
  if (!c.agreed) return "Tick the box to agree to the privacy notice.";
  return "";
}

export interface RegisterForm {
  lastName: string; firstName: string; middleName: string;
  schoolId: string; otherSchool: string; notListed: boolean;
  level: string; teacher: TeacherChoice;
  levels: string[]; subjects: string[]; employeeId: string; workEmail: string;
  contactEmail: string; username: string; password: string; confirm: string;
}
export const emptyForm: RegisterForm = {
  lastName: "", firstName: "", middleName: "", schoolId: "", otherSchool: "", notListed: false, level: "", teacher: { kind: "none" },
  levels: [], subjects: [], employeeId: "", workEmail: "", contactEmail: "", username: "", password: "", confirm: "",
};

/** The first thing wrong with the registration form, or "". */
export function registerProblem(f: RegisterForm, role: Role): string {
  if (!f.lastName.trim()) return "Enter your last name.";
  if (!f.firstName.trim()) return "Enter your first name.";
  if (!f.middleName.trim()) return "Enter your middle name, or N/A if you have none.";
  if (f.notListed ? f.otherSchool.trim().length < 2 : !f.schoolId) return f.notListed ? "Type the name of your school." : "Choose your school.";
  if (role === "student") {
    if (!f.level) return "Choose your grade or year level.";
    if (f.teacher.kind === "no_account" && !f.teacher.name.trim()) return "Type your teacher's name, or choose \"I don't have a teacher\".";
  } else {
    if (f.levels.length === 0) return "Choose the levels you handle.";
    if (f.subjects.length === 0) return "Choose the subjects you handle.";
    if (!f.employeeId.trim() && !f.workEmail.trim()) return "Give your employee ID or your work email.";
    if (f.workEmail.trim() && !emailLooksRight(f.workEmail)) return "That work email does not look right.";
  }
  if (f.contactEmail.trim() && !emailLooksRight(f.contactEmail)) return "That email address does not look right.";
  return usernameProblem(f.username) || passwordProblem(f.password, role, f.username) || (f.password !== f.confirm ? "The two passwords are not the same." : "");
}

/** The details sent with a registration. The username is not among them: the database takes it from the account. */
export function registerPayload(f: RegisterForm, role: Role, consent: ConsentState, version: number, confirmDuplicate: boolean) {
  const student = role === "student";
  return {
    role,
    lastName: f.lastName.trim(), firstName: f.firstName.trim(), middleName: f.middleName.trim(),
    schoolId: f.notListed ? "" : f.schoolId,
    otherSchool: f.notListed ? f.otherSchool.trim() : "",
    level: student ? f.level : "",
    teacher: student ? teacherPayload(f.teacher) : null,
    levels: student ? [] : f.levels,
    subjects: student ? [] : f.subjects,
    employeeId: student ? "" : f.employeeId.trim(),
    workEmail: student ? "" : f.workEmail.trim(),
    contactEmail: f.contactEmail.trim(),
    confirmDuplicate,
    consent: consentPayload(consent, version, role),
  };
}
export function consentPayload(c: ConsentState, version: number, role: Role) {
  const under18 = role === "student" ? c.under18 === true : false;
  return { agreed: c.agreed, version, under18, guardianName: under18 ? c.guardianName.trim() : "", guardianAgreed: under18 && c.guardianAgreed };
}

/** A sign-in or sign-up error in plain words. */
export function authMessage(e: { message?: string | null; code?: string | null; status?: number | null } | null | undefined): string {
  const text = `${e?.code ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (e?.status === 429 || /rate limit|too many/.test(text)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/banned/.test(text)) return "This account has been deactivated. Please contact CEDO.";
  if (/weak_password|password should/.test(text)) return "Choose a longer password.";
  if (/failed to fetch|network|timeout/.test(text)) return "Couldn't reach the server. Check your connection and try again.";
  if (/invalid login|invalid_credentials/.test(text)) return "Incorrect username or password.";
  return "Something went wrong. Please try again.";
}
