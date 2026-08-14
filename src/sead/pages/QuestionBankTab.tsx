import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Check, X as XIcon, GripVertical, UploadCloud, Youtube, FileCheck2, FileUp, Eye } from "lucide-react";
import {
  fetchSubjects, createSubject, renameSubject, deleteSubject, updateSubjectMaxAttempts,
  updateSubjectPassingRate, uploadSubjectCertificate, removeSubjectCertificate, fetchCertificatePreviewUrl,
  fetchTopics, createTopic, updateTopic, deleteTopic,
  fetchQuestions, deleteQuestion, toggleQuestionActive,
} from "../seadApi";
import { QuestionEditorModal } from "../components/QuestionEditorModal";
import { BulkQuestionUploadModal } from "../components/BulkQuestionUploadModal";
import type { QuestSubject, QuestTopic, QuestQuestion } from "../types";
import { usePaginatedList, ListSearchBox, ListPagination } from "@/app/components/PaginatedList";

export function QuestionBankTab() {
  const [subjects, setSubjects] = useState<QuestSubject[]>([]);
  const [topics, setTopics] = useState<QuestTopic[]>([]);
  const [questions, setQuestions] = useState<QuestQuestion[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<QuestSubject | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<QuestTopic | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<QuestQuestion | "new" | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  useEffect(() => { loadSubjects(); }, []);

  async function loadSubjects() {
    const s = await fetchSubjects();
    setSubjects(s);
    if (selectedSubject) {
      const stillExists = s.find(x => x.id === selectedSubject.id);
      setSelectedSubject(stillExists ?? null);
    }
  }

  async function selectSubject(s: QuestSubject) {
    setSelectedSubject(s);
    setSelectedTopic(null);
    setQuestions([]);
    setTopics(await fetchTopics(s.id));
  }

  async function selectTopic(t: QuestTopic) {
    setSelectedTopic(t);
    setQuestions(await fetchQuestions(t.id));
  }

  async function reloadTopics() {
    if (selectedSubject) setTopics(await fetchTopics(selectedSubject.id));
  }
  async function reloadQuestions() {
    if (selectedTopic) setQuestions(await fetchQuestions(selectedTopic.id));
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <SubjectColumn
        subjects={subjects}
        selected={selectedSubject}
        onSelect={selectSubject}
        onCreate={async (name, maxAttemptsPerDay, passingRateMin, passingRateMax) => {
          const r = await createSubject(name, maxAttemptsPerDay, passingRateMin, passingRateMax); loadSubjects(); return r;
        }}
        onRename={async (id, name) => { const r = await renameSubject(id, name); loadSubjects(); return r; }}
        onUpdateMaxAttempts={async (id, maxAttemptsPerDay) => { const r = await updateSubjectMaxAttempts(id, maxAttemptsPerDay); loadSubjects(); return r; }}
        onUpdatePassingRate={async (id, min, max) => { const r = await updateSubjectPassingRate(id, min, max); loadSubjects(); return r; }}
        onUploadCertificate={async (id, file) => { const r = await uploadSubjectCertificate(id, file); loadSubjects(); return r; }}
        onRemoveCertificate={async id => { const r = await removeSubjectCertificate(id); loadSubjects(); return r; }}
        onPreviewCertificate={fetchCertificatePreviewUrl}
        onDelete={async id => { const r = await deleteSubject(id); if (r.ok) { setSelectedSubject(null); setSelectedTopic(null); } loadSubjects(); return r; }}
      />

      <TopicColumn
        subject={selectedSubject}
        topics={topics}
        selected={selectedTopic}
        onSelect={selectTopic}
        onCreate={async (name, maxAttemptsPerDay, youtubeUrl) => {
          if (!selectedSubject) return { ok: false, error: "Select a subject first." };
          const r = await createTopic(selectedSubject.id, name, maxAttemptsPerDay, youtubeUrl);
          reloadTopics();
          return r;
        }}
        onUpdate={async (id, fields) => { const r = await updateTopic(id, fields); reloadTopics(); return r; }}
        onDelete={async id => { const r = await deleteTopic(id); if (r.ok) setSelectedTopic(null); reloadTopics(); return r; }}
      />

      <QuestionColumn
        topic={selectedTopic}
        questions={questions}
        onAdd={() => setEditingQuestion("new")}
        onBulkUpload={() => setShowBulkUpload(true)}
        onEdit={q => setEditingQuestion(q)}
        onDelete={async id => { await deleteQuestion(id); reloadQuestions(); }}
        onToggleActive={async (id, active) => { await toggleQuestionActive(id, active); reloadQuestions(); }}
      />

      {editingQuestion && selectedTopic && (
        <QuestionEditorModal
          topicId={selectedTopic.id}
          existing={editingQuestion === "new" ? null : editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSaved={() => { setEditingQuestion(null); reloadQuestions(); }}
        />
      )}

      {showBulkUpload && selectedTopic && (
        <BulkQuestionUploadModal
          topicId={selectedTopic.id}
          topicName={selectedTopic.name}
          onClose={() => setShowBulkUpload(false)}
          onDone={reloadQuestions}
        />
      )}
    </div>
  );
}

// ── Column: Subjects ────────────────────────────────────────
function SubjectColumn({ subjects, selected, onSelect, onCreate, onRename, onUpdateMaxAttempts, onUpdatePassingRate, onUploadCertificate, onRemoveCertificate, onPreviewCertificate, onDelete }: {
  subjects: QuestSubject[]; selected: QuestSubject | null; onSelect: (s: QuestSubject) => void;
  onCreate: (name: string, maxAttemptsPerDay: number, passingRateMin: number, passingRateMax: number) => Promise<{ ok: boolean; error?: string }>;
  onRename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onUpdateMaxAttempts: (id: string, maxAttemptsPerDay: number) => Promise<{ ok: boolean; error?: string }>;
  onUpdatePassingRate: (id: string, min: number, max: number) => Promise<{ ok: boolean; error?: string }>;
  onUploadCertificate: (id: string, file: File) => Promise<{ ok: boolean; error?: string }>;
  onRemoveCertificate: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onPreviewCertificate: (id: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [newName, setNewName] = useState("");
  const [newMaxAttempts, setNewMaxAttempts] = useState("3");
  const [newPassingMin, setNewPassingMin] = useState("75");
  const [newPassingMax, setNewPassingMax] = useState("100");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMaxAttempts, setEditMaxAttempts] = useState("");
  const [editPassingMin, setEditPassingMin] = useState("");
  const [editPassingMax, setEditPassingMax] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [certBusyId, setCertBusyId] = useState<string | null>(null);

  function validatePassingRate(minRaw: string, maxRaw: string): { ok: true; min: number; max: number } | { ok: false } {
    const min = Number(minRaw), max = Number(maxRaw);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) return { ok: false };
    return { ok: true, min, max };
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!newName.trim()) return;
    const attempts = Number(newMaxAttempts);
    if (!Number.isFinite(attempts) || attempts < 1) { setError("Allowable attempts per day must be at least 1."); return; }
    const rate = validatePassingRate(newPassingMin, newPassingMax);
    if (!rate.ok) { setError("Passing rate must be 0–100%, with the minimum not exceeding the maximum."); return; }
    setBusy(true);
    const result = await onCreate(newName.trim(), attempts, rate.min, rate.max);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save — check that this account is authorized."); return; }
    setNewName(""); setNewMaxAttempts("3"); setNewPassingMin("75"); setNewPassingMax("100");
  }

  async function submitEdit(id: string) {
    setError("");
    const attempts = Number(editMaxAttempts);
    if (!Number.isFinite(attempts) || attempts < 1) { setError("Allowable attempts per day must be at least 1."); return; }
    const rate = validatePassingRate(editPassingMin, editPassingMax);
    if (!rate.ok) { setError("Passing rate must be 0–100%, with the minimum not exceeding the maximum."); return; }

    const original = subjects.find(s => s.id === id);
    const renameResult = original && original.name !== editName ? await onRename(id, editName) : { ok: true as const };
    if (!renameResult.ok) { setError(renameResult.error || "Failed to rename."); return; }
    const attemptsResult = !original || original.maxAttemptsPerDay !== attempts ? await onUpdateMaxAttempts(id, attempts) : { ok: true as const };
    if (!attemptsResult.ok) { setError(attemptsResult.error || "Failed to update attempts limit."); return; }
    const rateResult = !original || original.passingRateMin !== rate.min || original.passingRateMax !== rate.max
      ? await onUpdatePassingRate(id, rate.min, rate.max) : { ok: true as const };
    if (!rateResult.ok) { setError(rateResult.error || "Failed to update passing rate."); return; }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    setError("");
    const result = await onDelete(id);
    if (!result.ok) setError(result.error || "Failed to delete.");
  }

  async function handleCertificateFile(id: string, file: File) {
    setCertBusyId(id);
    const result = await onUploadCertificate(id, file);
    setCertBusyId(null);
    if (!result.ok) setError(result.error || "Failed to upload certificate.");
  }
  async function handleRemoveCertificate(id: string) {
    setCertBusyId(id);
    const result = await onRemoveCertificate(id);
    setCertBusyId(null);
    if (!result.ok) setError(result.error || "Failed to remove certificate.");
  }
  async function handlePreviewCertificate(id: string) {
    const url = await onPreviewCertificate(id);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("Couldn't generate a preview link.");
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col max-h-[600px]">
      <div className="px-4 py-3 border-b border-[#e6ecf5]">
        <h3 className="text-[12.5px] font-bold text-[#062444]">Subjects</h3>
      </div>
      <div className="overflow-y-auto flex-1">
        {subjects.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">None yet.</p>
        ) : (
          subjects.map(s => (
            <div key={s.id}
              className={`px-4 py-2.5 border-b border-[#f0f3f8] cursor-pointer ${selected?.id === s.id ? "bg-[#eef3fb]" : "hover:bg-[#f8fafd]"}`}
              onClick={() => editingId !== s.id && onSelect(s)}
            >
              {editingId === s.id ? (
                <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
                  <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                    className="w-full text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">Attempts/day:</span>
                    <input type="number" min={1} value={editMaxAttempts} onChange={e => setEditMaxAttempts(e.target.value)}
                      className="w-16 text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">Passing rate:</span>
                    <input type="number" min={0} max={100} value={editPassingMin} onChange={e => setEditPassingMin(e.target.value)}
                      className="w-14 text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                    <span className="text-[11px] text-slate-400">% –</span>
                    <input type="number" min={0} max={100} value={editPassingMax} onChange={e => setEditPassingMax(e.target.value)}
                      className="w-14 text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                    <span className="text-[11px] text-slate-400">%</span>
                  </div>

                  <div className="pt-1 border-t border-[#f0f3f8]">
                    <span className="text-[11px] text-slate-400 block mb-1">Certificate (PDF):</span>
                    {s.certificateFilename ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <FileCheck2 size={13} className="text-green-600 shrink-0" />
                        <span className="text-[11.5px] text-[#062444] truncate max-w-[120px]">{s.certificateFilename}</span>
                        <button onClick={() => handlePreviewCertificate(s.id)} className="text-[11px] font-semibold text-[#0088cc] hover:underline flex items-center gap-0.5">
                          <Eye size={11} /> Preview
                        </button>
                        <button onClick={() => handleRemoveCertificate(s.id)} disabled={certBusyId === s.id} className="text-[11px] font-semibold text-red-500 hover:underline">
                          {certBusyId === s.id ? "…" : "Remove"}
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0088cc] cursor-pointer hover:underline w-fit">
                        <FileUp size={12} /> {certBusyId === s.id ? "Uploading…" : "Upload PDF"}
                        <input type="file" accept="application/pdf" className="hidden" disabled={certBusyId === s.id}
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleCertificateFile(s.id, f); }} />
                      </label>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => submitEdit(s.id)} className="text-green-600"><Check size={15} /></button>
                    <button onClick={() => { setEditingId(null); setError(""); }} className="text-slate-400"><XIcon size={15} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <GripVertical size={13} className="text-slate-300 shrink-0" />
                  <div className="flex-1">
                    <span className="text-[13.5px] text-[#062444] font-medium">{s.name}</span>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10.5px] font-semibold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">
                        {s.maxAttemptsPerDay}/day
                      </span>
                      <span className="text-[10.5px] font-semibold text-[#F3BC00] bg-[#F3BC00]/15 rounded-full px-2 py-0.5">
                        Pass: {s.passingRateMin}%–{s.passingRateMax}%
                      </span>
                      {s.certificateFilename && (
                        <span className="text-[10.5px] font-semibold text-green-700 bg-green-100 rounded-full px-2 py-0.5 flex items-center gap-1">
                          <FileCheck2 size={10} /> Certificate
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={e => {
                    e.stopPropagation();
                    setEditingId(s.id); setEditName(s.name); setEditMaxAttempts(String(s.maxAttemptsPerDay));
                    setEditPassingMin(String(s.passingRateMin)); setEditPassingMax(String(s.passingRateMax)); setError("");
                  }} className="text-slate-300 hover:text-[#0088cc]"><Pencil size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(s.id); }} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {error && <p className="text-[12px] text-red-600 px-4 py-2 border-t border-red-100 bg-red-50">{error}</p>}
      <form onSubmit={submitCreate} className="px-3 py-2.5 border-t border-[#e6ecf5] space-y-1.5">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New subject (e.g. Mathematics)" disabled={busy}
          className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2 outline-none focus:border-[#0088cc]" />
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-slate-500 whitespace-nowrap">Allowable attempts/day:</span>
          <input type="number" min={1} value={newMaxAttempts} onChange={e => setNewMaxAttempts(e.target.value)} disabled={busy}
            className="w-16 text-sm border border-[#062444]/15 rounded-lg px-2 py-1.5 outline-none focus:border-[#0088cc]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-slate-500 whitespace-nowrap">Passing rate:</span>
          <input type="number" min={0} max={100} value={newPassingMin} onChange={e => setNewPassingMin(e.target.value)} disabled={busy}
            className="w-14 text-sm border border-[#062444]/15 rounded-lg px-2 py-1.5 outline-none focus:border-[#0088cc]" />
          <span className="text-[11.5px] text-slate-500">% –</span>
          <input type="number" min={0} max={100} value={newPassingMax} onChange={e => setNewPassingMax(e.target.value)} disabled={busy}
            className="w-14 text-sm border border-[#062444]/15 rounded-lg px-2 py-1.5 outline-none focus:border-[#0088cc]" />
          <span className="text-[11.5px] text-slate-500">%</span>
        </div>
        <p className="text-[10.5px] text-slate-400">Certificate upload is available after creating the subject (edit it to attach one).</p>
        <button type="submit" disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-[#062444] text-[#F3BC00] rounded-lg p-2 disabled:opacity-50">
          <Plus size={15} /> Add Subject
        </button>
      </form>
    </div>
  );
}

// ── Column: Topics ──────────────────────────────────────────
function TopicColumn({ subject, topics, selected, onSelect, onCreate, onUpdate, onDelete }: {
  subject: QuestSubject | null; topics: QuestTopic[]; selected: QuestTopic | null; onSelect: (t: QuestTopic) => void;
  onCreate: (name: string, maxAttemptsPerDay: number | null, youtubeUrl: string) => Promise<{ ok: boolean; error?: string }>;
  onUpdate: (id: string, fields: { name: string; maxAttemptsPerDay: number | null; youtubeUrl: string }) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [newName, setNewName] = useState("");
  const [newMaxAttempts, setNewMaxAttempts] = useState(""); // blank = inherit subject default
  const [newYoutubeUrl, setNewYoutubeUrl] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMaxAttempts, setEditMaxAttempts] = useState("");
  const [editYoutubeUrl, setEditYoutubeUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!subject) {
    return <EmptyColumn title="Topics" message="Select a subject to see its topics." />;
  }

  function parseAttempts(raw: string): { ok: true; value: number | null } | { ok: false } {
    if (raw.trim() === "") return { ok: true, value: null }; // inherit subject default
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return { ok: false };
    return { ok: true, value: n };
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!newName.trim()) return;
    const attempts = parseAttempts(newMaxAttempts);
    if (!attempts.ok) { setError("Attempts override must be at least 1, or left blank to use the subject's default."); return; }
    setBusy(true);
    const result = await onCreate(newName.trim(), attempts.value, newYoutubeUrl.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save — check that this account is authorized."); return; }
    setNewName(""); setNewMaxAttempts(""); setNewYoutubeUrl("");
  }

  async function submitEdit(id: string) {
    setError("");
    const attempts = parseAttempts(editMaxAttempts);
    if (!attempts.ok) { setError("Attempts override must be at least 1, or left blank to use the subject's default."); return; }
    const result = await onUpdate(id, { name: editName.trim(), maxAttemptsPerDay: attempts.value, youtubeUrl: editYoutubeUrl.trim() });
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    setError("");
    const result = await onDelete(id);
    if (!result.ok) setError(result.error || "Failed to delete.");
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col max-h-[600px]">
      <div className="px-4 py-3 border-b border-[#e6ecf5]">
        <h3 className="text-[12.5px] font-bold text-[#062444]">Topics — {subject.name}</h3>
      </div>
      <div className="overflow-y-auto flex-1">
        {topics.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">None yet.</p>
        ) : (
          topics.map(t => (
            <div key={t.id}
              className={`px-4 py-2.5 border-b border-[#f0f3f8] cursor-pointer ${selected?.id === t.id ? "bg-[#eef3fb]" : "hover:bg-[#f8fafd]"}`}
              onClick={() => editingId !== t.id && onSelect(t)}
            >
              {editingId === t.id ? (
                <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
                  <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                    className="w-full text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">Attempts/day:</span>
                    <input type="number" min={1} value={editMaxAttempts} onChange={e => setEditMaxAttempts(e.target.value)}
                      placeholder={`${subject.maxAttemptsPerDay} (default)`}
                      className="w-24 text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                  </div>
                  <input value={editYoutubeUrl} onChange={e => setEditYoutubeUrl(e.target.value)} placeholder="YouTube lecture URL (optional)"
                    className="w-full text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => submitEdit(t.id)} className="text-green-600"><Check size={15} /></button>
                    <button onClick={() => { setEditingId(null); setError(""); }} className="text-slate-400"><XIcon size={15} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <GripVertical size={13} className="text-slate-300 shrink-0" />
                  <div className="flex-1">
                    <span className="text-[13.5px] text-[#062444] font-medium">{t.name}</span>
                    <span className="ml-2 text-[10.5px] font-semibold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">
                      {t.maxAttemptsPerDay ?? subject.maxAttemptsPerDay}/day{t.maxAttemptsPerDay === null ? " (default)" : ""}
                    </span>
                    {t.youtubeUrl && <Youtube size={12} className="inline-block ml-1.5 text-red-500 align-text-bottom" />}
                  </div>
                  <button onClick={e => {
                    e.stopPropagation();
                    setEditingId(t.id); setEditName(t.name);
                    setEditMaxAttempts(t.maxAttemptsPerDay === null ? "" : String(t.maxAttemptsPerDay));
                    setEditYoutubeUrl(t.youtubeUrl); setError("");
                  }} className="text-slate-300 hover:text-[#0088cc]"><Pencil size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(t.id); }} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {error && <p className="text-[12px] text-red-600 px-4 py-2 border-t border-red-100 bg-red-50">{error}</p>}
      <form onSubmit={submitCreate} className="px-3 py-2.5 border-t border-[#e6ecf5] space-y-1.5">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New topic (e.g. Algebra)" disabled={busy}
          className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2 outline-none focus:border-[#0088cc]" />
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-slate-500 whitespace-nowrap">Attempts/day override:</span>
          <input type="number" min={1} value={newMaxAttempts} onChange={e => setNewMaxAttempts(e.target.value)} disabled={busy}
            placeholder={`${subject.maxAttemptsPerDay} (default)`}
            className="w-28 text-sm border border-[#062444]/15 rounded-lg px-2 py-1.5 outline-none focus:border-[#0088cc]" />
        </div>
        <input value={newYoutubeUrl} onChange={e => setNewYoutubeUrl(e.target.value)} placeholder="YouTube lecture URL (optional)" disabled={busy}
          className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2 outline-none focus:border-[#0088cc]" />
        <button type="submit" disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-[#062444] text-[#F3BC00] rounded-lg p-2 disabled:opacity-50">
          <Plus size={15} /> Add Topic
        </button>
      </form>
    </div>
  );
}

// ── Column: Questions ───────────────────────────────────────
function QuestionColumn({ topic, questions, onAdd, onBulkUpload, onEdit, onDelete, onToggleActive }: {
  topic: QuestTopic | null; questions: QuestQuestion[]; onAdd: () => void; onBulkUpload: () => void; onEdit: (q: QuestQuestion) => void;
  onDelete: (id: string) => void; onToggleActive: (id: string, active: boolean) => void;
}) {
  if (!topic) {
    return <EmptyColumn title="Questions" message="Select a topic to manage its questions." />;
  }
  const { paged, search, setSearch, page, setPage, totalPages, filteredCount, pageSize } =
    usePaginatedList(questions, { searchKeys: ["questionText"] });
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col max-h-[600px]">
      <div className="px-4 py-3 border-b border-[#e6ecf5] space-y-2">
        <h3 className="text-[12.5px] font-bold text-[#062444] truncate">Questions — {topic.name}</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={onBulkUpload} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] shrink-0 hover:underline hover:text-[#006699]">
            <UploadCloud size={14} /> Bulk Upload
          </button>
          <button onClick={onAdd} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] shrink-0 hover:underline hover:text-[#006699]">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>
      {questions.length > 0 && (
        <div className="px-4 py-2 border-b border-[#f0f3f8]">
          <ListSearchBox value={search} onChange={setSearch} placeholder="Search questions…" />
        </div>
      )}
      <div className="overflow-y-auto flex-1">
        {questions.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">No questions yet.</p>
        ) : filteredCount === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">No questions match your search.</p>
        ) : (
          paged.map(q => (
            <div key={q.id} className="px-4 py-3 border-b border-[#f0f3f8]">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className={`text-[13.5px] font-medium min-w-0 break-words ${q.isActive ? "text-[#062444]" : "text-slate-400 line-through"}`}>{q.questionText}</p>
                <span className="shrink-0 text-[11px] font-bold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">{q.points} pt</span>
              </div>
              <p className="text-[12px] text-slate-400 mb-2">{q.choices.length} choices · correct: {q.choices.find(c => c.isCorrect)?.choiceText || "—"}</p>
              <div className="flex items-center gap-3 text-[12px]">
                <button onClick={() => onEdit(q)} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline"><Pencil size={12} /> Edit</button>
                <button onClick={() => onToggleActive(q.id, !q.isActive)} className="text-slate-400 font-semibold hover:underline hover:text-slate-600">
                  {q.isActive ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => onDelete(q.id)} className="flex items-center gap-1 text-red-500 font-semibold hover:underline hover:text-red-600"><Trash2 size={12} /> Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
      {filteredCount > 0 && (
        <div className="px-2 border-t border-[#f0f3f8]">
          <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={filteredCount} pageSize={pageSize} />
        </div>
      )}
    </div>
  );
}

function EmptyColumn({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-[#e6ecf5] flex flex-col items-center justify-center text-center px-4 py-10">
      <h3 className="text-[12.5px] font-bold text-[#062444] mb-1">{title}</h3>
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
