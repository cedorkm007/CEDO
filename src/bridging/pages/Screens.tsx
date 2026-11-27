// The signed-in screens whose content arrives in later phases. They show the prototype's layout and say plainly what is not there yet.
import { BookOpen, Calculator, ClipboardList, FlaskConical, Library, Megaphone, MonitorSmartphone, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { Me } from "../api";
import { levelLabel, teacherStatusLabel } from "../logic";
import { Card } from "../ui";

const Soon = ({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) => (
  <Card className="flex items-start gap-3">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f4c430] text-[#1e3a5f]">{icon}</span>
    <div><h2 className="text-[16px] font-bold text-[#1e3a5f]">{title}</h2><p className="text-[14px] text-slate-600">{children}</p></div>
  </Card>
);

export function Home({ me }: { me: Me }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Maayong adlaw, {me.firstName}!</h1>
        <p className="text-[14px] text-white/70">{levelLabel(me.level)} · {me.schoolName}</p>
      </div>
      {me.teacher && (
        <Card><p className="text-[14px] text-slate-700">Teacher: <span className="font-bold text-[#1e3a5f]">{me.teacher.name}</span> — {teacherStatusLabel(me.teacher.status)}</p></Card>
      )}
      <Soon icon={<Megaphone size={22} />} title="Announcements">None yet. Messages from CEDO will appear here.</Soon>
      <Soon icon={<BookOpen size={22} />} title="Today's quests">Daily quests are being prepared and will appear here.</Soon>
    </div>
  );
}

const SUBJECTS = [
  { name: "Mathematics", color: "from-green-500 to-green-600", icon: Calculator },
  { name: "Science", color: "from-orange-500 to-red-500", icon: FlaskConical },
  { name: "English", color: "from-blue-500 to-blue-600", icon: BookOpen },
  { name: "ICT", color: "from-purple-500 to-purple-600", icon: MonitorSmartphone },
];
export function Quest() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#f4c430]">Quest</h1>
      <p className="text-[14px] text-white/80">Easy, Intermediate and Difficult quests for each subject are coming soon.</p>
      <div className="grid grid-cols-2 gap-3">
        {SUBJECTS.map(({ name, color, icon: Icon }) => (
          <div key={name} className={`flex flex-col items-center gap-2 rounded-2xl bg-gradient-to-br ${color} p-5 text-white shadow-lg`}>
            <Icon size={30} aria-hidden="true" />
            <span className="text-[15px] font-bold">{name}</span>
            <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-[12px] font-bold">Soon</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Tests() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#f4c430]">Tests</h1>
      <Soon icon={<ClipboardList size={22} />} title="Weekly and monthly tests">Pre-tests and post-tests will appear here on the dates CEDO sets.</Soon>
    </div>
  );
}

export function Materials() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#f4c430]">Materials</h1>
      <Soon icon={<Library size={22} />} title="Reading materials">Reading materials will be added in a later version.</Soon>
    </div>
  );
}

export function TeacherHome({ me }: { me: Me }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Maayong adlaw, {me.firstName}!</h1>
        <p className="text-[14px] text-white/70">{me.schoolName}</p>
      </div>
      {me.status === "active" ? (
        <Soon icon={<Users size={22} />} title="Your students">Your account is approved. Student requests and progress will appear here in a later update.</Soon>
      ) : me.status === "pending" ? (
        <Soon icon={<Users size={22} />} title="Waiting for approval">An administrator needs to approve your teacher account. Until then you cannot see any student information.</Soon>
      ) : (
        <Soon icon={<Users size={22} />} title="Not approved">Your teacher account was not approved. Please contact CEDO.</Soon>
      )}
    </div>
  );
}
