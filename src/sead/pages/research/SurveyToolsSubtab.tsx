import { useEffect, useState } from "react";
import { Pencil, Trash2, UploadCloud, Plus, ListChecks, SlidersHorizontal, Power, PowerOff } from "lucide-react";
import { fetchSurveys, deleteSurvey, updateSurvey, fetchSurveyQuestions, deleteSurveyQuestion } from "../../seadApi";
import { SurveyEditorModal } from "../../components/SurveyEditorModal";
import { SurveyQuestionEditorModal } from "../../components/SurveyQuestionEditorModal";
import { BulkSurveyQuestionUploadModal } from "../../components/BulkSurveyQuestionUploadModal";
import { ColumnHeader, EmptyColumn } from "../../components/SeadUiShell";
import { usePaginatedList, ListSearchBox, ListPagination } from "@/app/components/PaginatedList";
import type { Survey, SurveyQuestion } from "../../types";

export function SurveyToolsSubtab() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
  const [editingSurvey, setEditingSurvey] = useState<Survey | "new" | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<SurveyQuestion | "new" | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  useEffect(() => { loadSurveys(); }, []);

  async function loadSurveys() {
    const s = await fetchSurveys();
    setSurveys(s);
    if (selectedSurvey) {
      const stillExists = s.find(x => x.id === selectedSurvey.id);
      setSelectedSurvey(stillExists ?? null);
      if (stillExists) setQuestions(await fetchSurveyQuestions(stillExists.id));
    }
  }

  async function selectSurvey(s: Survey) {
    setSelectedSurvey(s);
    setQuestions(await fetchSurveyQuestions(s.id));
  }

  async function reloadQuestions() {
    if (selectedSurvey) setQuestions(await fetchSurveyQuestions(selectedSurvey.id));
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,.9fr)_minmax(480px,2fr)]">
      <SurveyColumn
        surveys={surveys}
        selected={selectedSurvey}
        onSelect={selectSurvey}
        onAdd={() => setEditingSurvey("new")}
        onEdit={s => setEditingSurvey(s)}
        onToggleActive={async s => { await updateSurvey(s.id, { title: s.title, description: s.description, isActive: !s.isActive, activityType: s.activityType, activityId: s.activityId }); loadSurveys(); }}
        onDelete={async id => { await deleteSurvey(id); if (selectedSurvey?.id === id) { setSelectedSurvey(null); setQuestions([]); } loadSurveys(); }}
      />

      <SurveyQuestionColumn
        survey={selectedSurvey}
        questions={questions}
        onAdd={() => setEditingQuestion("new")}
        onBulkUpload={() => setShowBulkUpload(true)}
        onEdit={q => setEditingQuestion(q)}
        onDelete={async id => { await deleteSurveyQuestion(id); reloadQuestions(); }}
      />

      {editingSurvey && (
        <SurveyEditorModal
          existing={editingSurvey === "new" ? null : editingSurvey}
          onClose={() => setEditingSurvey(null)}
          onSaved={() => { setEditingSurvey(null); loadSurveys(); }}
        />
      )}

      {editingQuestion && selectedSurvey && (
        <SurveyQuestionEditorModal
          surveyId={selectedSurvey.id}
          existing={editingQuestion === "new" ? null : editingQuestion}
          nextSortOrder={questions.length}
          onClose={() => setEditingQuestion(null)}
          onSaved={() => { setEditingQuestion(null); reloadQuestions(); }}
        />
      )}

      {showBulkUpload && selectedSurvey && (
        <BulkSurveyQuestionUploadModal
          surveyId={selectedSurvey.id}
          surveyTitle={selectedSurvey.title}
          onClose={() => setShowBulkUpload(false)}
          onDone={reloadQuestions}
        />
      )}
    </div>
  );
}

function SurveyColumn({ surveys, selected, onSelect, onAdd, onEdit, onToggleActive, onDelete }: {
  surveys: Survey[]; selected: Survey | null; onSelect: (s: Survey) => void; onAdd: () => void;
  onEdit: (s: Survey) => void; onToggleActive: (s: Survey) => void; onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col max-h-[72vh] xl:max-h-[720px]">
      <ColumnHeader title="Surveys" onAdd={onAdd} addLabel="New Survey" />
      <div className="overflow-y-auto flex-1">
        {surveys.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">No surveys yet.</p>
        ) : (
          surveys.map(s => (
            <div key={s.id}
              className={`px-4 py-3 border-b border-[#f0f3f8] cursor-pointer ${selected?.id === s.id ? "bg-[#eef3fb]" : "hover:bg-[#f8fafd]"}`}
              onClick={() => onSelect(s)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13.5px] text-[#062444] font-medium truncate">{s.title}</p>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {s.activityName} <span className="text-slate-300">·</span> {s.activityType === "sdp" ? "SDP" : "Formation"}
                  </p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${s.isActive ? "text-green-700 bg-green-100" : "text-slate-500 bg-slate-100"}`}>
                  {s.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[12px] mt-2">
                <button onClick={e => { e.stopPropagation(); onEdit(s); }} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline"><Pencil size={12} /> Edit</button>
                <button onClick={e => { e.stopPropagation(); onToggleActive(s); }} className="flex items-center gap-1 text-slate-400 font-semibold hover:underline hover:text-slate-600">
                  {s.isActive ? <><PowerOff size={12} /> Deactivate</> : <><Power size={12} /> Activate</>}
                </button>
                <button onClick={e => { e.stopPropagation(); onDelete(s.id); }} className="flex items-center gap-1 text-red-500 font-semibold hover:underline hover:text-red-600"><Trash2 size={12} /> Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SurveyQuestionColumn({ survey, questions, onAdd, onBulkUpload, onEdit, onDelete }: {
  survey: Survey | null; questions: SurveyQuestion[]; onAdd: () => void; onBulkUpload: () => void;
  onEdit: (q: SurveyQuestion) => void; onDelete: (id: string) => void;
}) {
  if (!survey) {
    return <EmptyColumn title="Questions" message="Select a survey to manage its questions." />;
  }
  const { paged, search, setSearch, page, setPage, totalPages, filteredCount, pageSize } =
    usePaginatedList(questions, { searchKeys: ["questionText"] });
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] flex flex-col min-h-[72vh] max-h-[720px]">
      <div className="px-4 py-3 border-b border-[#e6ecf5] space-y-2">
        <h3 className="text-[12.5px] font-bold text-[#062444] truncate">Questions — {survey.title}</h3>
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
                <p className="text-[14.5px] leading-relaxed font-medium min-w-0 break-words text-[#062444]">{q.questionText}</p>
                <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2.5 py-1">
                  {q.questionType === "likert" ? <><SlidersHorizontal size={11} /> Likert</> : <><ListChecks size={11} /> Multiple Choice</>}
                </span>
              </div>
              {q.questionType === "multiple_choice" ? (
                <p className="text-[11px] text-slate-500 mb-2.5">{q.choices.length} choices: {q.choices.map(c => c.choiceText).join(", ")}</p>
              ) : (
                <p className="text-[11px] text-slate-500 mb-2.5">Scale {q.likertScaleMin}–{q.likertScaleMax}: "{q.likertMinLabel}" to "{q.likertMaxLabel}"</p>
              )}
              <div className="flex items-center gap-3 text-[12px]">
                <button onClick={() => onEdit(q)} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline"><Pencil size={12} /> Edit</button>
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
