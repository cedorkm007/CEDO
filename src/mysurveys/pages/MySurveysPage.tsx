import { useEffect, useState } from "react";
import { Plus, FileUp, Search, ClipboardList, X, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  fetchSurveyList, createSurvey, duplicateSurvey, deleteSurvey,
  type SurveyListItem, type SurveyScope, type SurveyStatus,
} from "../mySurveysApi";
import { SurveyActionsMenu } from "../components/SurveyActionsMenu";
import { SurveyStatusBadge } from "../components/SurveyStatusBadge";
import { DeleteSurveyModal } from "../components/DeleteSurveyModal";
import { ShareLinkModal } from "../components/ShareLinkModal";
import { CsvImportModal } from "../components/CsvImportModal";
import { ShareDialog } from "../components/ShareDialog";
import { ConfirmModal } from "../builder/ConfirmModal";
import { removeShare } from "../shareApi";
import { SurveyBuilderPage } from "./SurveyBuilderPage";
import { SurveyResultsPage } from "./SurveyResultsPage";

type StatusFilter = "all" | SurveyStatus;

const TABS: { key: SurveyScope; label: string }[] = [
  { key: "mine", label: "My Surveys" },
  { key: "shared", label: "Shared with me" },
];

/** "Closes Oct 15, 5:00 PM" for an open survey with an automatic closing date. */
function closingNote(s: SurveyListItem): string | null {
  if (s.status !== "open" || !s.closesAt) return null;
  return `Closes ${new Date(s.closesAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

/** "42" or "42 / 100" when there is a response limit. */
function responsesText(s: SurveyListItem): string {
  return s.responseLimit ? `${s.responseCount} / ${s.responseLimit}` : String(s.responseCount);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * "My Surveys" -- visible to every signed-in staff member (ungated page in
 * src/app/App.tsx). What each person can see and do is decided by the
 * database (RLS + my_survey_role() in supabase_migration_my_surveys_core.sql),
 * not by this UI: the buttons here only mirror those permissions.
 *
 * List, filter, create, create from a CSV template, duplicate, delete, share,
 * Get Link/QR, and View Responses (charts).
 */
export function MySurveysPage() {
  const [tab, setTab] = useState<SurveyScope>("mine");
  const [surveys, setSurveys] = useState<SurveyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [openSurveyId, setOpenSurveyId] = useState<string | null>(null);
  const [resultsSurvey, setResultsSurvey] = useState<{ id: string; title: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SurveyListItem | null>(null);
  const [linkTarget, setLinkTarget] = useState<SurveyListItem | null>(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [shareTarget, setShareTarget] = useState<SurveyListItem | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<SurveyListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load(scope: SurveyScope) {
    setLoading(true);
    const res = await fetchSurveyList(scope);
    if (res.ok) { setSurveys(res.surveys); setError(null); }
    else { setSurveys([]); setError(res.error); }
    setLoading(false);
  }

  useEffect(() => { void load(tab); }, [tab]);

  async function handleNewSurvey() {
    setCreating(true);
    const res = await createSurvey();
    setCreating(false);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setTab("mine");
    setOpenSurveyId(res.id);
  }

  async function handleDuplicate(survey: SurveyListItem) {
    const res = await duplicateSurvey(survey.id);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    // The copy is owned by the person who duplicated it, so it lives under "My Surveys".
    if (tab === "mine") await load("mine"); else setTab("mine");
  }

  async function handleLeave() {
    if (!leaveTarget) return;
    const { data } = await supabase.auth.getUser();
    const res = data.user ? await removeShare(leaveTarget.id, data.user.id) : { ok: false, error: "Not signed in." };
    if (!res.ok) setError(res.error ?? "Couldn't remove the survey from your list.");
    else setError(null);
    setLeaveTarget(null);
    await load(tab);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await deleteSurvey(deleteTarget.id);
    setDeleting(false);
    if (!res.ok) setError(res.error ?? "Failed to delete.");
    else setError(null);
    setDeleteTarget(null);
    await load(tab);
  }

  if (resultsSurvey) {
    return <SurveyResultsPage surveyId={resultsSurvey.id} title={resultsSurvey.title} onBack={() => { setResultsSurvey(null); void load(tab); }} />;
  }
  if (openSurveyId) {
    return (
      <SurveyBuilderPage
        surveyId={openSurveyId}
        onBack={() => { setOpenSurveyId(null); void load(tab); }}
        onViewResponses={title => { setResultsSurvey({ id: openSurveyId, title }); setOpenSurveyId(null); }}
      />
    );
  }

  const query = search.trim().toLowerCase();
  const visible = surveys.filter(s =>
    (statusFilter === "all" || s.status === statusFilter) &&
    (!query || s.title.toLowerCase().includes(query) || s.ownerName.toLowerCase().includes(query))
  );
  const hasFilters = query !== "" || statusFilter !== "all";

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] font-medium text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss" className="shrink-0 text-red-400 hover:text-red-600"><X size={15} /></button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#062444]">My Surveys</h1>
          <p className="text-[13px] text-slate-600">Build surveys, share them with colleagues, and collect responses through a link or QR code.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setImportingCsv(true)}
            className="flex items-center gap-1.5 border border-[#e6ecf5] text-[#062444] text-[12.5px] font-semibold rounded-lg px-3.5 py-2 hover:bg-[#f7f9fc]"
          >
            <FileUp size={15} /> Create from Template (CSV)
          </button>
          <button
            onClick={() => void handleNewSurvey()} disabled={creating}
            className="flex items-center gap-1.5 bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2 hover:bg-[#0a3a6b] disabled:opacity-60"
          >
            <Plus size={15} /> {creating ? "Creating…" : "New Survey"}
          </button>
        </div>
      </div>

      <div role="tablist" className="flex w-full gap-1 border-b border-border mb-4">
        {TABS.map(t => (
          <button
            key={t.key} role="tab" aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-slate-600 hover:text-foreground"
            }`}
          >
            {t.key === "shared" ? <Users size={14} /> : <ClipboardList size={14} />} {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <label htmlFor="survey-search" className="sr-only">Search surveys</label>
          <input
            id="survey-search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tab === "shared" ? "Search by title or owner…" : "Search by title…"}
            className="w-full border border-[#e6ecf5] rounded-lg pl-8 pr-3 py-2 text-[12.5px] outline-none focus:border-[#0088cc]"
          />
        </div>
        <label htmlFor="survey-status-filter" className="sr-only">Filter by status</label>
        <select
          id="survey-status-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="border border-[#e6ecf5] rounded-lg px-3 py-2 text-[12.5px] text-[#062444] outline-none focus:border-[#0088cc] bg-white"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {loading ? (
        <p className="text-center text-slate-500 py-14">Loading…</p>
      ) : surveys.length === 0 ? (
        <div className="text-center py-14 text-slate-500 bg-[#f7f9fc] rounded-2xl">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          {tab === "mine" ? (
            <>
              <p className="text-[13.5px] font-medium">You haven't created any surveys yet.</p>
              <p className="text-[12.5px]">Click "New Survey" to build your first one.</p>
            </>
          ) : (
            <>
              <p className="text-[13.5px] font-medium">Nothing has been shared with you yet.</p>
              <p className="text-[12.5px]">Surveys that colleagues share with you will appear here.</p>
            </>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-14 text-slate-500 bg-[#f7f9fc] rounded-2xl">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-[13.5px] font-medium">{hasFilters ? "No surveys match your search or filter." : "No surveys."}</p>
        </div>
      ) : (
        <>
          {/* Phones / tablets: one card per survey. The switch is at lg, not md: from 768px up the
              app's sidebar is already showing, which leaves the table far too little room. */}
          <ul className="lg:hidden space-y-3">
            {visible.map(s => (
              <li key={s.id} className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => setOpenSurveyId(s.id)} className="text-left min-w-0">
                    <p className="text-[14px] font-semibold text-[#062444] break-words">{s.title}</p>
                  </button>
                  <RowMenu survey={s} onOpen={() => setOpenSurveyId(s.id)} onDuplicate={() => void handleDuplicate(s)} onDelete={() => setDeleteTarget(s)} onGetLink={() => setLinkTarget(s)} onShare={() => setShareTarget(s)} onLeave={() => setLeaveTarget(s)} onViewResponses={() => setResultsSurvey({ id: s.id, title: s.title })} />
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <SurveyStatusBadge status={s.status} />
                  <span className="text-[12px] text-slate-500">{responsesText(s)} response{s.responseCount === 1 && !s.responseLimit ? "" : "s"}</span>
                  {closingNote(s) && <span className="text-[11.5px] text-slate-500">{closingNote(s)}</span>}
                </div>
                <p className="mt-2 text-[11.5px] text-slate-500">
                  Owner: {s.ownerName}<br />
                  Modified {formatDateTime(s.updatedAt)}{s.lastEditedByName ? ` by ${s.lastEditedByName}` : ""}
                </p>
              </li>
            ))}
          </ul>

          {/* lg and up: table. No overflow-hidden on the wrapper so the row menu is never clipped. */}
          <div className="hidden lg:block bg-white rounded-2xl border border-[#e6ecf5]">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-[#f8fafd] text-left text-slate-500 text-[11px] font-bold uppercase tracking-wide">
                  <th className="px-4 py-3 rounded-tl-2xl">Title</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Responses</th>
                  <th className="px-4 py-3">Last modified</th>
                  <th className="px-4 py-3 w-10 rounded-tr-2xl"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(s => (
                  <tr key={s.id} onDoubleClick={() => setOpenSurveyId(s.id)} className="border-t border-[#f0f3f8] hover:bg-[#f7f9fc]">
                    <td className="px-4 py-2.5 max-w-[320px]">
                      <button onClick={() => setOpenSurveyId(s.id)} className="flex items-center gap-2 text-left font-semibold text-[#062444] hover:underline max-w-full">
                        <ClipboardList size={15} className="shrink-0" /> <span className="truncate">{s.title}</span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{s.ownerName}{tab === "shared" && <span className="ml-1.5 text-[10.5px] font-bold uppercase text-slate-500">· {s.myRole}</span>}</td>
                    <td className="px-4 py-2.5">
                      <SurveyStatusBadge status={s.status} />
                      {closingNote(s) && <span className="mt-0.5 block text-[11px] text-slate-500">{closingNote(s)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{responsesText(s)}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {formatDateTime(s.updatedAt)}
                      {s.lastEditedByName && <span className="block text-[11px]">by {s.lastEditedByName}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <RowMenu survey={s} onOpen={() => setOpenSurveyId(s.id)} onDuplicate={() => void handleDuplicate(s)} onDelete={() => setDeleteTarget(s)} onGetLink={() => setLinkTarget(s)} onShare={() => setShareTarget(s)} onLeave={() => setLeaveTarget(s)} onViewResponses={() => setResultsSurvey({ id: s.id, title: s.title })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {importingCsv && (
        <CsvImportModal
          onClose={() => setImportingCsv(false)}
          onCreated={id => { setImportingCsv(false); setTab("mine"); setOpenSurveyId(id); }}
        />
      )}

      {shareTarget && (
        <ShareDialog surveyId={shareTarget.id} surveyTitle={shareTarget.title} onClose={() => setShareTarget(null)} />
      )}

      {leaveTarget && (
        <ConfirmModal
          title={`Remove "${leaveTarget.title}" from your list?`}
          message={`You will no longer be able to open it. ${leaveTarget.ownerName} still owns it and can share it with you again.`}
          confirmLabel="Remove"
          onCancel={() => setLeaveTarget(null)}
          onConfirm={() => void handleLeave()}
        />
      )}

      {linkTarget && linkTarget.publicSlug && (
        <ShareLinkModal title={linkTarget.title} slug={linkTarget.publicSlug} status={linkTarget.status} onClose={() => setLinkTarget(null)} />
      )}

      {deleteTarget && (
        <DeleteSurveyModal
          surveyTitle={deleteTarget.title} responseCount={deleteTarget.responseCount} deleting={deleting}
          onCancel={() => setDeleteTarget(null)} onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

function RowMenu({ survey, onOpen, onDuplicate, onDelete, onGetLink, onShare, onLeave, onViewResponses }: { survey: SurveyListItem; onOpen: () => void; onDuplicate: () => void; onDelete: () => void; onGetLink: () => void; onShare: () => void; onLeave: () => void; onViewResponses: () => void }) {
  return <SurveyActionsMenu role={survey.myRole} hasLink={survey.publicSlug !== null} onOpen={onOpen} onDuplicate={onDuplicate} onDelete={onDelete} onGetLink={onGetLink} onShare={onShare} onLeave={onLeave} onViewResponses={onViewResponses} />;
}
