import { useEffect, useState } from "react";
import {
  Plus, Pencil, Trash2, Check, X as XIcon, GripVertical, UploadCloud, Video, Presentation,
  FileCheck2, FileUp, Eye, FileText, Search,
} from "lucide-react";
import {
  fetchSubjects, createSubject, renameSubject, deleteSubject, updateSubjectMaxAttempts,
  updateSubjectPassingRate, uploadSubjectCertificate, removeSubjectCertificate, fetchCertificatePreviewUrl,
  fetchTopics, createTopic, updateTopic, deleteTopic, reorderTopics,
  fetchQuestions, deleteQuestion, toggleQuestionActive,
} from "../seadApi";
import { isValidHttpsUrl } from "@/lib/urlValidation";
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
  const [previewQuestion, setPreviewQuestion] = useState<QuestQuestion | null>(null);
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(220px,.75fr)_minmax(260px,.9fr)_minmax(480px,2fr)]">
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
        onCreate={async (name, maxAttemptsPerDay, videoUrl, slideUrl, pdfUrl) => {
          if (!selectedSubject) return { ok: false, error: "Select a subject first." };
          const r = await createTopic(selectedSubject.id, name, maxAttemptsPerDay, videoUrl, slideUrl, pdfUrl);
          reloadTopics();
          return r;
        }}
        onUpdate={async (id, fields) => { const r = await updateTopic(id, fields); reloadTopics(); return r; }}
        onReorder={async orderedTopicIds => {
          const currentTopics = topics;
          const orderedTopics = orderedTopicIds.map(id => currentTopics.find(topic => topic.id === id)).filter((topic): topic is QuestTopic => !!topic);
          setTopics(orderedTopics);
          const result = await reorderTopics(orderedTopicIds);
          if (!result.ok) setTopics(currentTopics);
          return result;
        }}
        onDelete={async id => { const r = await deleteTopic(id); if (r.ok) setSelectedTopic(null); reloadTopics(); return r; }}
      />

      <QuestionColumn
        topic={selectedTopic}
        questions={questions}
        onAdd={() => setEditingQuestion("new")}
        onBulkUpload={() => setShowBulkUpload(true)}
        onEdit={q => setEditingQuestion(q)}
        onView={q => setPreviewQuestion(q)}
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

      {previewQuestion && (
        <QuestionPreviewModal question={previewQuestion} onClose={() => setPreviewQuestion(null)} />
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

// ── Shared: modal shell (matches the app's existing modal convention) ──
function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-lg" : "max-w-md"} bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl sticky top-0">
          <h3 className="text-white font-bold text-[15px]">{title}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><XIcon size={18} /></button>
        </div>
        <div className="p-6 space-y-3">{children}</div>
      </div>
    </div>
  );
}

// ── Shared: compact header with an "Add" button that opens a modal ──
function ColumnHeader({ title, subtitle, onAdd, addLabel }: { title: string; subtitle?: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="px-4 py-3 border-b border-[#e6ecf5] flex items-center justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-[12.5px] font-bold text-[#062444] truncate">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[10.5px] text-slate-400 truncate">{subtitle}</p>}
      </div>
      {onAdd && (
        <button onClick={onAdd} className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
          <Plus size={14} /> {addLabel}
        </button>
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
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMaxAttempts, setEditMaxAttempts] = useState("");
  const [editPassingMin, setEditPassingMin] = useState("");
  const [editPassingMax, setEditPassingMax] = useState("");
  const [error, setError] = useState("");
  const [certBusyId, setCertBusyId] = useState<string | null>(null);

  const filteredSubjects = search.trim()
    ? subjects.filter(s => s.name.toLowerCase().includes(search.trim().toLowerCase()))
    : subjects;

  function validatePassingRate(minRaw: string, maxRaw: string): { ok: true; min: number; max: number } | { ok: false } {
    const min = Number(minRaw), max = Number(maxRaw);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) return { ok: false };
    return { ok: true, min, max };
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
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col max-h-[72vh] xl:max-h-[720px]">
      <ColumnHeader title="Subjects" onAdd={() => setShowCreate(true)} addLabel="Add Subject" />

      {subjects.length > 0 && (
        <div className="px-3 pt-2.5">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search subjects…"
              className="w-full text-[12.5px] border border-[#062444]/15 rounded-lg pl-7 pr-3 py-1.5 outline-none focus:border-[#0088cc]" />
          </div>
        </div>
      )}

      <div className="overflow-y-auto flex-1 mt-1">
        {subjects.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">None yet.</p>
        ) : filteredSubjects.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">No subjects match your search.</p>
        ) : (
          filteredSubjects.map(s => (
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
      {error && !showCreate && <p className="text-[12px] text-red-600 px-4 py-2 border-t border-red-100 bg-red-50">{error}</p>}

      {showCreate && (
        <CreateSubjectModal
          onClose={() => setShowCreate(false)}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}

function CreateSubjectModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, maxAttemptsPerDay: number, passingRateMin: number, passingRateMax: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("3");
  const [passingMin, setPassingMin] = useState("75");
  const [passingMax, setPassingMax] = useState("100");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Enter a subject name."); return; }
    const attempts = Number(maxAttempts);
    if (!Number.isFinite(attempts) || attempts < 1) { setError("Allowable attempts per day must be at least 1."); return; }
    const min = Number(passingMin), max = Number(passingMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) {
      setError("Passing rate must be 0–100%, with the minimum not exceeding the maximum."); return;
    }
    setBusy(true);
    const result = await onCreate(name.trim(), attempts, min, max);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save — check that this account is authorized."); return; }
    onClose();
  }

  return (
    <ModalShell title="Add Subject" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Subject name (e.g. Mathematics)" disabled={busy} autoFocus
          className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2.5 outline-none focus:border-[#0088cc]" />
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500 whitespace-nowrap">Allowable attempts/day:</span>
          <input type="number" min={1} value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} disabled={busy}
            className="w-20 text-sm border border-[#062444]/15 rounded-lg px-2 py-1.5 outline-none focus:border-[#0088cc]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500 whitespace-nowrap">Passing rate:</span>
          <input type="number" min={0} max={100} value={passingMin} onChange={e => setPassingMin(e.target.value)} disabled={busy}
            className="w-16 text-sm border border-[#062444]/15 rounded-lg px-2 py-1.5 outline-none focus:border-[#0088cc]" />
          <span className="text-[12px] text-slate-500">% –</span>
          <input type="number" min={0} max={100} value={passingMax} onChange={e => setPassingMax(e.target.value)} disabled={busy}
            className="w-16 text-sm border border-[#062444]/15 rounded-lg px-2 py-1.5 outline-none focus:border-[#0088cc]" />
          <span className="text-[12px] text-slate-500">%</span>
        </div>
        <p className="text-[11px] text-slate-400">Certificate upload is available after creating the subject (edit it to attach one).</p>
        {error && <p className="text-[12.5px] text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-[#062444] text-[#F3BC00] rounded-lg p-2.5 font-semibold disabled:opacity-50">
          <Plus size={15} /> {busy ? "Creating…" : "Add Subject"}
        </button>
      </form>
    </ModalShell>
  );
}

// ── Column: Topics ──────────────────────────────────────────
function TopicColumn({ subject, topics, selected, onSelect, onCreate, onUpdate, onReorder, onDelete }: {
  subject: QuestSubject | null; topics: QuestTopic[]; selected: QuestTopic | null; onSelect: (t: QuestTopic) => void;
  onCreate: (name: string, maxAttemptsPerDay: number | null, videoUrl: string, slideUrl: string, pdfUrl: string) => Promise<{ ok: boolean; error?: string }>;
  onUpdate: (id: string, fields: { name: string; maxAttemptsPerDay: number | null; videoUrl: string; slideUrl: string; pdfUrl: string }) => Promise<{ ok: boolean; error?: string }>;
  onReorder: (orderedTopicIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMaxAttempts, setEditMaxAttempts] = useState("");
  const [editVideoUrl, setEditVideoUrl] = useState("");
  const [editSlideUrl, setEditSlideUrl] = useState("");
  const [editPdfUrl, setEditPdfUrl] = useState("");
  const [error, setError] = useState("");
  const [draggedTopicId, setDraggedTopicId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  if (!subject) {
    return <EmptyColumn title="Topics" message="Select a subject to see its topics." />;
  }

  // Drag-and-drop reordering works against the full, unfiltered topic list —
  // disabling it while a search filter narrows what's visible avoids ambiguous
  // index math (dropping a filtered item "between" two others it isn't actually
  // adjacent to in the real order).
  const isFiltering = search.trim().length > 0;
  const filteredTopics = isFiltering
    ? topics.filter(t => t.name.toLowerCase().includes(search.trim().toLowerCase()))
    : topics;

  async function submitEdit(id: string) {
    setError("");
    const attempts = parseAttempts(editMaxAttempts);
    if (!attempts.ok) { setError("Attempts override must be at least 1, or left blank to use the subject's default."); return; }
    if (!isValidHttpsUrl(editVideoUrl)) { setError("Video URL must be a valid https:// link."); return; }
    if (!isValidHttpsUrl(editSlideUrl)) { setError("Slide deck URL must be a valid https:// link."); return; }
    if (!isValidHttpsUrl(editPdfUrl)) { setError("PDF material URL must be a valid https:// link."); return; }
    const result = await onUpdate(id, { name: editName.trim(), maxAttemptsPerDay: attempts.value, videoUrl: editVideoUrl.trim(), slideUrl: editSlideUrl.trim(), pdfUrl: editPdfUrl.trim() });
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    setError("");
    const result = await onDelete(id);
    if (!result.ok) setError(result.error || "Failed to delete.");
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>, targetTopicId: string) {
    event.preventDefault();
    if (!draggedTopicId || draggedTopicId === targetTopicId || reordering) { setDraggedTopicId(null); return; }

    const withoutDragged = topics.filter(topic => topic.id !== draggedTopicId);
    const targetIndex = withoutDragged.findIndex(topic => topic.id === targetTopicId);
    const targetBox = event.currentTarget.getBoundingClientRect();
    const insertAfter = event.clientY > targetBox.top + targetBox.height / 2;
    const reorderedIds = [...withoutDragged];
    reorderedIds.splice(targetIndex + (insertAfter ? 1 : 0), 0, topics.find(topic => topic.id === draggedTopicId)!);

    setDraggedTopicId(null);
    setReordering(true);
    const result = await onReorder(reorderedIds.map(topic => topic.id));
    setReordering(false);
    if (!result.ok) setError(result.error || "Couldn't save the new topic order.");
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col max-h-[72vh] xl:max-h-[720px]">
      <ColumnHeader title={`Topics — ${subject.name}`} subtitle={isFiltering ? undefined : "Drag a topic box to change its order."} onAdd={() => setShowCreate(true)} addLabel="Add Topic" />

      {topics.length > 0 && (
        <div className="px-3 pt-2.5">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search topics…"
              className="w-full text-[12.5px] border border-[#062444]/15 rounded-lg pl-7 pr-3 py-1.5 outline-none focus:border-[#0088cc]" />
          </div>
        </div>
      )}

      <div className="overflow-y-auto flex-1 mt-1">
        {topics.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">None yet.</p>
        ) : filteredTopics.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">No topics match your search.</p>
        ) : (
          filteredTopics.map(t => (
            <div key={t.id}
              draggable={!isFiltering && editingId !== t.id && !reordering}
              onDragStart={event => { event.dataTransfer.effectAllowed = "move"; setDraggedTopicId(t.id); }}
              onDragOver={event => event.preventDefault()}
              onDrop={event => void handleDrop(event, t.id)}
              onDragEnd={() => setDraggedTopicId(null)}
              className={`px-4 py-2.5 border-b border-[#f0f3f8] ${isFiltering ? "" : "cursor-grab active:cursor-grabbing"} ${draggedTopicId === t.id ? "opacity-40" : ""} ${selected?.id === t.id ? "bg-[#eef3fb]" : "hover:bg-[#f8fafd]"}`}
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
                  <input value={editVideoUrl} onChange={e => setEditVideoUrl(e.target.value)} placeholder="Video URL — YouTube, Google Drive, etc. (optional)"
                    className="w-full text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                  <input value={editSlideUrl} onChange={e => setEditSlideUrl(e.target.value)} placeholder="Slide deck URL — Google Slides, Canva, etc. (optional)"
                    className="w-full text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                  <input value={editPdfUrl} onChange={e => setEditPdfUrl(e.target.value)} placeholder="PDF material URL — Google Drive, etc. (optional)"
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
                    {t.videoUrl && <Video size={12} className="inline-block ml-1.5 text-red-500 align-text-bottom" aria-label="Has a video resource" />}
                    {t.slideUrl && <Presentation size={12} className="inline-block ml-1 text-[#0088cc] align-text-bottom" aria-label="Has a slide deck resource" />}
                    {t.pdfUrl && <FileText size={12} className="inline-block ml-1 text-emerald-600 align-text-bottom" aria-label="Has a PDF resource" />}
                  </div>
                  <button onClick={e => {
                    e.stopPropagation();
                    setEditingId(t.id); setEditName(t.name);
                    setEditMaxAttempts(t.maxAttemptsPerDay === null ? "" : String(t.maxAttemptsPerDay));
                    setEditVideoUrl(t.videoUrl); setEditSlideUrl(t.slideUrl); setEditPdfUrl(t.pdfUrl); setError("");
                  }} className="text-slate-300 hover:text-[#0088cc]"><Pencil size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(t.id); }} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {error && !showCreate && <p className="text-[12px] text-red-600 px-4 py-2 border-t border-red-100 bg-red-50">{error}</p>}

      {showCreate && (
        <CreateTopicModal
          subject={subject}
          onClose={() => setShowCreate(false)}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}

function parseAttempts(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (raw.trim() === "") return { ok: true, value: null }; // inherit subject default
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  return { ok: true, value: n };
}

function CreateTopicModal({ subject, onClose, onCreate }: {
  subject: QuestSubject;
  onClose: () => void;
  onCreate: (name: string, maxAttemptsPerDay: number | null, videoUrl: string, slideUrl: string, pdfUrl: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(""); // blank = inherit subject default
  const [videoUrl, setVideoUrl] = useState("");
  const [slideUrl, setSlideUrl] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Enter a topic name."); return; }
    const attempts = parseAttempts(maxAttempts);
    if (!attempts.ok) { setError("Attempts override must be at least 1, or left blank to use the subject's default."); return; }
    if (!isValidHttpsUrl(videoUrl)) { setError("Video URL must be a valid https:// link."); return; }
    if (!isValidHttpsUrl(slideUrl)) { setError("Slide deck URL must be a valid https:// link."); return; }
    if (!isValidHttpsUrl(pdfUrl)) { setError("PDF material URL must be a valid https:// link."); return; }
    setBusy(true);
    const result = await onCreate(name.trim(), attempts.value, videoUrl.trim(), slideUrl.trim(), pdfUrl.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save — check that this account is authorized."); return; }
    onClose();
  }

  return (
    <ModalShell title={`Add Topic — ${subject.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Topic name (e.g. Algebra)" disabled={busy} autoFocus
          className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2.5 outline-none focus:border-[#0088cc]" />
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500 whitespace-nowrap">Attempts/day override:</span>
          <input type="number" min={1} value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} disabled={busy}
            placeholder={`${subject.maxAttemptsPerDay} (default)`}
            className="w-28 text-sm border border-[#062444]/15 rounded-lg px-2 py-1.5 outline-none focus:border-[#0088cc]" />
        </div>
        <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="Video URL — YouTube, Google Drive, etc. (optional)" disabled={busy}
          className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2.5 outline-none focus:border-[#0088cc]" />
        <input value={slideUrl} onChange={e => setSlideUrl(e.target.value)} placeholder="Slide deck URL — Google Slides, Canva, etc. (optional)" disabled={busy}
          className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2.5 outline-none focus:border-[#0088cc]" />
        <input value={pdfUrl} onChange={e => setPdfUrl(e.target.value)} placeholder="PDF material URL — Google Drive, etc. (optional)" disabled={busy}
          className="w-full text-sm border border-[#062444]/15 rounded-lg px-3 py-2.5 outline-none focus:border-[#0088cc]" />
        <p className="text-[11px] text-slate-400">Google Drive links must be shared as "Anyone with the link." All links must start with https://.</p>
        {error && <p className="text-[12.5px] text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-[#062444] text-[#F3BC00] rounded-lg p-2.5 font-semibold disabled:opacity-50">
          <Plus size={15} /> {busy ? "Creating…" : "Add Topic"}
        </button>
      </form>
    </ModalShell>
  );
}

// ── Column: Questions ───────────────────────────────────────
function QuestionColumn({ topic, questions, onAdd, onBulkUpload, onEdit, onView, onDelete, onToggleActive }: {
  topic: QuestTopic | null; questions: QuestQuestion[]; onAdd: () => void; onBulkUpload: () => void; onEdit: (q: QuestQuestion) => void;
  onView: (q: QuestQuestion) => void; onDelete: (id: string) => void; onToggleActive: (id: string, active: boolean) => void;
}) {
  if (!topic) {
    return <EmptyColumn title="Questions" message="Select a topic to manage its questions." />;
  }
  const { paged, search, setSearch, page, setPage, totalPages, filteredCount, pageSize } =
    usePaginatedList(questions, { searchKeys: ["questionText"] });
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col min-h-[72vh] max-h-[720px]">
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
            <div key={q.id} className="px-4 py-4 border-b border-[#f0f3f8]">
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className={`text-[14.5px] leading-relaxed font-medium min-w-0 break-words ${q.isActive ? "text-[#062444]" : "text-slate-400 line-through"}`}>
                  {q.questionText}
                </p>
                <button onClick={() => onView(q)} className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[#0088cc] border border-[#0088cc]/30 rounded-full px-2.5 py-1 hover:bg-[#0088cc]/10">
                  <Eye size={12} /> View
                </button>
              </div>
              <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                <span className="text-[11px] font-bold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">{q.points} pt</span>
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{q.choices.length} choices</span>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${q.isActive ? "text-green-700 bg-green-100" : "text-slate-500 bg-slate-100"}`}>
                  {q.isActive ? "Active" : "Inactive"}
                </span>
              </div>
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

// ── Read-only full question preview (staff-authorized, shows correct answer) ──
function QuestionPreviewModal({ question, onClose }: { question: QuestQuestion; onClose: () => void }) {
  return (
    <ModalShell title="Question Preview" onClose={onClose} wide>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-[11px] font-bold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">{question.points} pt</span>
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${question.isActive ? "text-green-700 bg-green-100" : "text-slate-500 bg-slate-100"}`}>
          {question.isActive ? "Active" : "Inactive"}
        </span>
        <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{question.choices.length} choices</span>
      </div>
      <p className="text-[15px] leading-relaxed font-semibold text-[#062444] whitespace-pre-wrap break-words">
        {question.questionText}
      </p>
      <div className="space-y-2 pt-1">
        {question.choices.map(choice => (
          <div key={choice.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${choice.isCorrect ? "border-green-300 bg-green-50" : "border-[#e6ecf5]"}`}>
            {choice.isCorrect ? (
              <Check size={16} className="text-green-600 shrink-0 mt-0.5" />
            ) : (
              <span className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <p className={`text-[13.5px] break-words ${choice.isCorrect ? "font-semibold text-green-800" : "text-[#062444]"}`}>{choice.choiceText}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 pt-1">This is a read-only preview. Use Edit to change the question.</p>
    </ModalShell>
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
