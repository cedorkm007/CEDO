import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Check, X as XIcon, GripVertical, UploadCloud } from "lucide-react";
import {
  fetchSubjects, createSubject, renameSubject, deleteSubject, updateSubjectMaxAttempts,
  fetchTopics, createTopic, renameTopic, deleteTopic,
  fetchQuestions, deleteQuestion, toggleQuestionActive,
} from "../seadApi";
import { QuestionEditorModal } from "../components/QuestionEditorModal";
import { BulkQuestionUploadModal } from "../components/BulkQuestionUploadModal";
import type { QuestSubject, QuestTopic, QuestQuestion } from "../types";

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
        onCreate={async (name, maxAttemptsPerDay) => { const r = await createSubject(name, maxAttemptsPerDay); loadSubjects(); return r; }}
        onRename={async (id, name) => { const r = await renameSubject(id, name); loadSubjects(); return r; }}
        onUpdateMaxAttempts={async (id, maxAttemptsPerDay) => { const r = await updateSubjectMaxAttempts(id, maxAttemptsPerDay); loadSubjects(); return r; }}
        onDelete={async id => { const r = await deleteSubject(id); if (r.ok) { setSelectedSubject(null); setSelectedTopic(null); } loadSubjects(); return r; }}
      />

      <TopicColumn
        subject={selectedSubject}
        topics={topics}
        selected={selectedTopic}
        onSelect={selectTopic}
        onCreate={async name => { if (!selectedSubject) return { ok: false, error: "Select a subject first." }; const r = await createTopic(selectedSubject.id, name); reloadTopics(); return r; }}
        onRename={async (id, name) => { const r = await renameTopic(id, name); reloadTopics(); return r; }}
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
function SubjectColumn({ subjects, selected, onSelect, onCreate, onRename, onUpdateMaxAttempts, onDelete }: {
  subjects: QuestSubject[]; selected: QuestSubject | null; onSelect: (s: QuestSubject) => void;
  onCreate: (name: string, maxAttemptsPerDay: number) => Promise<{ ok: boolean; error?: string }>;
  onRename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onUpdateMaxAttempts: (id: string, maxAttemptsPerDay: number) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [newName, setNewName] = useState("");
  const [newMaxAttempts, setNewMaxAttempts] = useState("3");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMaxAttempts, setEditMaxAttempts] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!newName.trim()) return;
    const attempts = Number(newMaxAttempts);
    if (!Number.isFinite(attempts) || attempts < 1) { setError("Allowable attempts per day must be at least 1."); return; }
    setBusy(true);
    const result = await onCreate(newName.trim(), attempts);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save — check that this account is authorized."); return; }
    setNewName("");
    setNewMaxAttempts("3");
  }

  async function submitEdit(id: string) {
    setError("");
    const attempts = Number(editMaxAttempts);
    if (!Number.isFinite(attempts) || attempts < 1) { setError("Allowable attempts per day must be at least 1."); return; }
    const original = subjects.find(s => s.id === id);
    const renameResult = original && original.name !== editName ? await onRename(id, editName) : { ok: true as const };
    if (!renameResult.ok) { setError(renameResult.error || "Failed to rename."); return; }
    const attemptsResult = !original || original.maxAttemptsPerDay !== attempts ? await onUpdateMaxAttempts(id, attempts) : { ok: true as const };
    if (!attemptsResult.ok) { setError(attemptsResult.error || "Failed to update attempts limit."); return; }
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
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <div className="flex-1 space-y-1.5">
                    <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                      className="w-full text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">Attempts/day:</span>
                      <input type="number" min={1} value={editMaxAttempts} onChange={e => setEditMaxAttempts(e.target.value)}
                        className="w-16 text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                    </div>
                  </div>
                  <button onClick={() => submitEdit(s.id)} className="text-green-600"><Check size={15} /></button>
                  <button onClick={() => { setEditingId(null); setError(""); }} className="text-slate-400"><XIcon size={15} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <GripVertical size={13} className="text-slate-300 shrink-0" />
                  <div className="flex-1">
                    <span className="text-[13.5px] text-[#062444] font-medium">{s.name}</span>
                    <span className="ml-2 text-[10.5px] font-semibold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">
                      {s.maxAttemptsPerDay}/day
                    </span>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setEditingId(s.id); setEditName(s.name); setEditMaxAttempts(String(s.maxAttemptsPerDay)); setError(""); }}
                    className="text-slate-300 hover:text-[#0088cc]"><Pencil size={13} /></button>
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
          <button type="submit" disabled={busy} className="ml-auto shrink-0 bg-[#062444] text-[#F3BC00] rounded-lg p-2 disabled:opacity-50"><Plus size={15} /></button>
        </div>
      </form>
    </div>
  );
}

// ── Column: Topics ──────────────────────────────────────────
function TopicColumn({ subject, topics, selected, onSelect, onCreate, onRename, onDelete }: {
  subject: QuestSubject | null; topics: QuestTopic[]; selected: QuestTopic | null; onSelect: (t: QuestTopic) => void;
  onCreate: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onRename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  if (!subject) {
    return <EmptyColumn title="Topics" message="Select a subject to see its topics." />;
  }
  return (
    <ListColumn
      title={`Topics — ${subject.name}`}
      items={topics.map(t => ({ id: t.id, label: t.name }))}
      selectedId={selected?.id ?? null}
      onSelect={id => { const t = topics.find(x => x.id === id); if (t) onSelect(t); }}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      createPlaceholder="New topic (e.g. Algebra)"
    />
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
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col max-h-[600px]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#e6ecf5]">
        <h3 className="text-[12.5px] font-bold text-[#062444]">Questions — {topic.name}</h3>
        <div className="flex items-center gap-3">
          <button onClick={onBulkUpload} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc]">
            <UploadCloud size={14} /> Bulk Upload
          </button>
          <button onClick={onAdd} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc]">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>
      <div className="overflow-y-auto flex-1">
        {questions.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">No questions yet.</p>
        ) : (
          questions.map(q => (
            <div key={q.id} className="px-4 py-3 border-b border-[#f0f3f8]">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className={`text-[13.5px] font-medium ${q.isActive ? "text-[#062444]" : "text-slate-400 line-through"}`}>{q.questionText}</p>
                <span className="shrink-0 text-[11px] font-bold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">{q.points} pt</span>
              </div>
              <p className="text-[12px] text-slate-400 mb-2">{q.choices.length} choices · correct: {q.choices.find(c => c.isCorrect)?.choiceText || "—"}</p>
              <div className="flex items-center gap-3 text-[12px]">
                <button onClick={() => onEdit(q)} className="flex items-center gap-1 text-[#0088cc] font-semibold"><Pencil size={12} /> Edit</button>
                <button onClick={() => onToggleActive(q.id, !q.isActive)} className="text-slate-400 font-semibold">
                  {q.isActive ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => onDelete(q.id)} className="flex items-center gap-1 text-red-500 font-semibold"><Trash2 size={12} /> Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Shared reusable list column (subjects / topics use this) ──
function ListColumn({ title, items, selectedId, onSelect, onCreate, onRename, onDelete, createPlaceholder }: {
  title: string; items: { id: string; label: string }[]; selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onRename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
  createPlaceholder: string;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!newName.trim()) return;
    setBusy(true);
    const result = await onCreate(newName.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save — check that this account is authorized."); return; }
    setNewName(""); // only clear on confirmed success
  }

  async function submitRename(id: string) {
    setError("");
    const result = await onRename(id, editValue);
    if (!result.ok) { setError(result.error || "Failed to rename."); return; }
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
        <h3 className="text-[12.5px] font-bold text-[#062444]">{title}</h3>
      </div>
      <div className="overflow-y-auto flex-1">
        {items.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">None yet.</p>
        ) : (
          items.map(item => (
            <div key={item.id}
              className={`flex items-center gap-2 px-4 py-2.5 border-b border-[#f0f3f8] cursor-pointer ${selectedId === item.id ? "bg-[#eef3fb]" : "hover:bg-[#f8fafd]"}`}
              onClick={() => editingId !== item.id && onSelect(item.id)}
            >
              <GripVertical size={13} className="text-slate-300 shrink-0" />
              {editingId === item.id ? (
                <>
                  <input value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                    onClick={e => e.stopPropagation()}
                    className="flex-1 text-sm border border-[#0088cc]/40 rounded px-2 py-1 outline-none" />
                  <button onClick={e => { e.stopPropagation(); submitRename(item.id); }} className="text-green-600"><Check size={15} /></button>
                  <button onClick={e => { e.stopPropagation(); setEditingId(null); setError(""); }} className="text-slate-400"><XIcon size={15} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[13.5px] text-[#062444] font-medium">{item.label}</span>
                  <button onClick={e => { e.stopPropagation(); setEditingId(item.id); setEditValue(item.label); setError(""); }} className="text-slate-300 hover:text-[#0088cc]"><Pencil size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(item.id); }} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                </>
              )}
            </div>
          ))
        )}
      </div>
      {error && <p className="text-[12px] text-red-600 px-4 py-2 border-t border-red-100 bg-red-50">{error}</p>}
      <form onSubmit={submitCreate} className="flex items-center gap-2 px-3 py-2.5 border-t border-[#e6ecf5]">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={createPlaceholder} disabled={busy}

          className="flex-1 text-sm border border-[#062444]/15 rounded-lg px-3 py-2 outline-none focus:border-[#0088cc]" />
        <button type="submit" className="shrink-0 bg-[#062444] text-[#F3BC00] rounded-lg p-2"><Plus size={15} /></button>
      </form>
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
