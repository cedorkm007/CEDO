import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, ListChecks, Lock, MoreVertical } from "lucide-react";
import { STAGE_INFO } from "@/lib/renewal";
import { canDoAction, waitingForText, type NeededAction, type ScholarActionFacts, type ViewerRoles } from "@/lib/renewalActions";
import { statusColumnText, type RenewalListTab } from "@/lib/renewalTabs";
import { actionSlots, gradesView, sdpView, shortYear, SLOT_LABEL, splitName, statusTone, type ChipTone } from "@/lib/renewalTableView";
import type { RenewalListRow } from "../renewalTabsApi";

/**
 * Scholar Renewal > Applications / Renewed / Not applied: THE TABLE (and, on a narrow screen, one card per scholar).
 * A visual layer only: it draws the rows it is given. Which scholars are listed, the values, who may press which action and what an action does all come from RenewalListTab, unchanged.
 * Words never break in the middle; short values stay on one line; each status is a chip WITH a text label (never colour alone).
 */

const CHIP: Record<ChipTone, string> = {
  green: "border-green-300 bg-green-50 text-green-900",
  red: "border-red-300 bg-red-50 text-red-800",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  blue: "border-sky-300 bg-sky-50 text-sky-900",
  gray: "border-slate-200 bg-slate-100 text-slate-800",
};
const DOT: Record<string, string> = { success: "bg-green-600", info: "bg-sky-600", warning: "bg-amber-500", danger: "bg-red-600", neutral: "bg-slate-400" };

function Chip({ tone, children, title }: { tone: ChipTone; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-semibold leading-5 ${CHIP[tone]}`}>{children}</span>;
}

/** Where the renewal stands (Applications list), as a small line with a coloured dot and words. */
function StageLine({ r, tab }: { r: RenewalListRow; tab: RenewalListTab }) {
  if (tab !== "applications" || !r.stage || r.stage === "sdp_on_hold") return null;      // "SDP on hold" is said once, in the SDP column
  const info = (STAGE_INFO as Record<string, { title: string; short: string; tone: string }>)[r.stage];
  const text = `${info ? info.short : r.stage}${r.isLate && r.stage !== "late_pending" ? " · late" : ""}`;
  return <span title={info ? info.title : text} className="mt-0.5 flex max-w-full items-start gap-1.5 text-[13px] leading-5 text-slate-700"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[info?.tone ?? "neutral"]}`} aria-hidden="true" /><span className="line-clamp-2 break-normal">{text}</span></span>;
}

function StatusCell({ r, tab }: { r: RenewalListRow; tab: RenewalListTab }) {
  const text = statusColumnText(tab, r.status, r.fromStatus, r.toStatus);
  const arrow = text.split(" → ");
  const now = arrow[arrow.length - 1] || "—";
  return (
    <div className="min-w-0">
      <Chip tone={statusTone(now)}>{now}</Chip>
      {arrow.length > 1 && <span className="line-clamp-2 text-[13px] leading-5 text-slate-700" title={text}>was {arrow[0]}</span>}
      <StageLine r={r} tab={tab} />
    </div>
  );
}

function SdpCell({ r, onView }: { r: RenewalListRow; onView: (r: RenewalListRow) => void }) {
  const v = sdpView(r, r.stage);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Chip tone={v.chip.tone}>{v.chip.text}</Chip>
        {v.canView && (
          <button type="button" onClick={() => onView(r)} title="View SDP credits" aria-label={`View SDP credits of ${r.name}`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#00709f] hover:bg-[#eaf3f9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00709f]"><ListChecks size={16} aria-hidden="true" /></button>
        )}
      </div>
      {v.detail && <span className="line-clamp-2 text-[13px] leading-5 text-slate-700" title={v.detail}>{v.detail}</span>}
    </div>
  );
}

function GradesCell({ r, enteredStatus }: { r: RenewalListRow; enteredStatus: string | null }) {
  const v = gradesView(r, enteredStatus);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1">{v.chips.map(c => <Chip key={c.text} tone={c.tone}>{c.text}</Chip>)}</div>
      {v.detail && <span className="line-clamp-2 text-[13px] leading-5 text-slate-700" title={v.detail}>{v.detail}</span>}
    </div>
  );
}

// ── the actions ──────────────────────────────────────────────
interface ActionProps {
  r: RenewalListRow; facts: ScholarActionFacts | null; ready: boolean; viewer: ViewerRoles; busy: string | null;
  onAct: (a: NeededAction, r: RenewalListRow, f: ScholarActionFacts) => void; actionsFor: (r: RenewalListRow, f: ScholarActionFacts | null) => NeededAction[];
}

/** One action as a button. Pressing it does exactly what the older button did (onAct). Someone who may not press it sees the same button, locked, with who it waits for. */
function ActionButton({ a, p, solid, label, full }: { a: NeededAction; p: ActionProps; solid: boolean; label: string; full?: boolean }) {
  const f = p.facts as ScholarActionFacts;
  const size = `inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold w-full`;
  if (!canDoAction(a, p.viewer)) {
    const why = waitingForText(a);
    return (
      <button type="button" aria-disabled="true" onClick={e => e.preventDefault()} title={`${a.label}. ${why}`} aria-label={`${a.label} for ${p.r.name}. ${why}`}
        className={`${size} cursor-not-allowed border border-dashed border-slate-300 bg-slate-50 text-slate-600`}><Lock size={13} aria-hidden="true" /><span className="truncate">{label}</span></button>
    );
  }
  return (
    <button type="button" onClick={() => p.onAct(a, p.r, f)} disabled={p.busy === p.r.scholarIdNumber} title={a.label} aria-label={`${a.label} for ${p.r.name}`}
      className={`${size} disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#062444] ${solid ? "bg-[#062444] text-white hover:bg-[#0a3a6e]" : "border border-[#062444] bg-white text-[#062444] hover:bg-[#f0f5fa]"}`}>
      <span className="truncate">{p.busy === p.r.scholarIdNumber && a.key === "refer_consultation" ? "Opening…" : label}</span>
    </button>
  );
}

/** The "⋮" menu: every action that has no slot of its own (the evaluator's confirm / endorse / review, the Division Head's decision, referrals, documents, "Mark not required"). */
function MoreMenu({ items, p, label }: { items: NeededAction[]; p: ActionProps; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const b = btn.current.getBoundingClientRect();
    setPos({ top: b.bottom + 4, right: Math.max(8, window.innerWidth - b.right) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc); window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  if (items.length === 0) return null;
  const f = p.facts as ScholarActionFacts;
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} title={`More actions: ${items.map(a => a.label).join(", ")}`}
        aria-label={`More actions for ${p.r.name}: ${items.map(a => a.label).join(", ")}`}
        className={`inline-flex h-8 items-center justify-center rounded-lg border border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f0f5fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#062444] ${label ? "gap-1 px-2.5 text-[13px] font-semibold" : "w-8"}`}>
        <MoreVertical size={16} aria-hidden="true" />{label}
      </button>
      {open && pos && createPortal(
        <div ref={menu} role="menu" aria-label={`More actions for ${p.r.name}`} style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-[200] w-64 max-w-[90vw] rounded-xl border border-[#e6ecf5] bg-white p-1.5 shadow-lg">
          {items.map(a => canDoAction(a, p.viewer)
            ? <button key={a.label} role="menuitem" type="button" onClick={() => { setOpen(false); p.onAct(a, p.r, f); }} disabled={p.busy === p.r.scholarIdNumber}
                className="block w-full rounded-lg px-3 py-2 text-left text-[14px] font-semibold text-[#062444] hover:bg-[#f0f5fa] disabled:opacity-60">{a.label}</button>
            : <div key={a.label} role="menuitem" aria-disabled="true" className="flex items-start gap-2 rounded-lg px-3 py-2 text-[14px] text-slate-700"><Lock size={14} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" /><span><span className="block font-semibold">{a.label}</span><span className="block text-[13px]">{waitingForText(a)}</span></span></div>)}
        </div>, document.body)}
    </>
  );
}

/** The Actions column: slot 1 "Decide SDP" (solid), slot 2 "Approve grades" (outline), then "⋮". A slot with no action stays EMPTY so the buttons line up in every row. */
function ActionSlots(p: ActionProps) {
  if (!p.ready || !p.facts) return <span className="block text-center text-slate-600">—</span>;
  const all = p.actionsFor(p.r, p.facts);
  if (all.length === 0) return <span className="block text-center text-[13px] text-slate-700">No action needed</span>;
  const { sdp, grades, rest } = actionSlots(all);
  // "Refer for Consultation" is shown as its own visible button under the two slots (not hidden in the "⋮" menu)
  const refer = rest.find(a => a.key === "refer_booking") ?? null;
  const others = rest.filter(a => a !== refer);
  return (
    <div className="mx-auto w-fit">
      <div className="flex items-center gap-1">
        <div className="w-[96px]">{sdp && <ActionButton a={sdp} p={p} solid label={SLOT_LABEL.decide_sdp} />}</div>
        <div className="w-[122px]">{grades && <ActionButton a={grades} p={p} solid={false} label={SLOT_LABEL.approve_grades} />}</div>
        <div className="w-8"><MoreMenu items={others} p={p} /></div>
      </div>
      {refer && <div className="mt-1.5"><ActionButton a={refer} p={p} solid={false} label="Refer for Consultation" /></div>}
    </div>
  );
}

/** On a phone: the first action is the big button, everything else is in "⋮". */
function CardActions(p: ActionProps) {
  if (!p.ready || !p.facts) return null;
  const all = p.actionsFor(p.r, p.facts);
  if (all.length === 0) return <p className="mt-3 text-[13px] text-slate-700">No action needed</p>;
  const { sdp, grades } = actionSlots(all);
  const refer = all.find(a => a.key === "refer_booking") ?? null;
  const first = sdp ?? grades ?? all.find(a => a !== refer) ?? all[0];
  const label = first === sdp ? SLOT_LABEL.decide_sdp : first === grades ? SLOT_LABEL.approve_grades : first === refer ? "Refer for Consultation" : first.label;
  const others = all.filter(a => a !== first && a !== refer);
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><ActionButton a={first} p={p} solid label={label} full /></div>
        {others.length > 0 && <MoreMenu items={others} p={p} label={`${others.length} more`} />}
      </div>
      {refer && first !== refer && <ActionButton a={refer} p={p} solid={false} label="Refer for Consultation" full />}
    </div>
  );
}

// ── the table ────────────────────────────────────────────────
interface TableProps {
  tab: RenewalListTab; rows: RenewalListRow[] | null; facts: Record<string, ScholarActionFacts> | null; ready: boolean; hasActions: boolean; viewer: ViewerRoles; busy: string | null;
  hideSchool: boolean; emptyText: string;
  onOpenRecord: (recordId: string) => void; onViewSdp: (r: RenewalListRow) => void;
  onAct: ActionProps["onAct"]; actionsFor: ActionProps["actionsFor"];
}

function NameCell({ r, onOpenRecord }: { r: RenewalListRow; onOpenRecord: (id: string) => void }) {
  const { surname, given } = splitName(r.name);
  const body = (
    <>
      <span className="block truncate font-bold leading-5">{surname}</span>
      {given && <span className="block truncate text-[13px] font-normal leading-5 text-slate-700">{given}</span>}
    </>
  );
  return r.recordId
    ? <button type="button" onClick={() => onOpenRecord(r.recordId as string)} title={r.name} className="block w-full min-w-0 text-left text-[#00709f] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00709f]">{body}</button>
    : <div title={r.name} className="min-w-0 text-[#062444]">{body}</div>;
}

const TH = "sticky top-0 z-20 whitespace-nowrap bg-white px-2.5 py-2.5 text-left text-[13px] font-medium text-slate-600 border-b border-[#e6ecf5]";
/** The width the columns need at full size (px); a narrower room shrinks the table's text and spacing in proportion. */
const NATURAL_WIDTH = 980;
const MONO = { fontFamily: "'DM Mono', ui-monospace, monospace" } as const;

export function RenewalListTable(t: TableProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const outer = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  // On a wide screen the page column (about 1090px) is narrower than the room that is free to its right: the table takes that room so School and Program fit as columns.
  useLayoutEffect(() => {
    const measure = () => {
      const p = outer.current?.parentElement; if (!p) return;
      const r = p.getBoundingClientRect(), free = window.innerWidth - r.left - 24;
      // wide screen: take the free room; a screen narrower than the page column: stop at the screen's edge (never run off it)
      const w = free >= 1300 && free > r.width + 120 ? Math.round(Math.min(1480, free)) : free < r.width ? Math.max(280, Math.floor(free)) : null;
      setWide(w);
      // Never overflow: when the room is narrower than the table needs (NATURAL_WIDTH), everything in the table (text too) shrinks to fit instead of scrolling sideways.
      setScale(Math.min(1, Math.floor(((w ?? r.width) - 2) / NATURAL_WIDTH * 1000) / 1000));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" && outer.current?.parentElement ? new ResizeObserver(measure) : null;
    if (ro && outer.current?.parentElement) ro.observe(outer.current.parentElement);
    return () => { window.removeEventListener("resize", measure); ro?.disconnect(); };
  }, []);
  const pad = "py-3";
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cols = 6 + (t.hideSchool ? 0 : 1) + (t.hasActions ? 1 : 0) + 1;
  const ap = (r: RenewalListRow): ActionProps => ({ r, facts: t.facts?.[r.scholarIdNumber] ?? null, ready: t.ready, viewer: t.viewer, busy: t.busy, onAct: t.onAct, actionsFor: t.actionsFor });
  const skeleton = t.rows === null;

  return (
    <div ref={outer} className="@container" style={wide ? { width: wide } : undefined}>
      {/* the table: from a medium width up (the container's width, not the screen's) */}
      <div className="hidden @min-[880px]:block rounded-xl border border-[#e6ecf5] bg-white">
        <div className="max-h-[calc(100vh-13rem)] min-h-[12rem] overflow-x-hidden overflow-y-auto rounded-xl">
          <table className="w-full table-fixed border-separate border-spacing-0 text-left text-[14px] text-slate-900" style={{ zoom: scale, width: `${100 / scale}%` }}>
            <caption className="sr-only">Scholars of this list</caption>
            <colgroup>
              <col style={{ width: 106 }} />
              <col />
              <col style={{ width: 52 }} />
              {!t.hideSchool && <col className="hidden @min-[1350px]:table-column" style={{ width: 176 }} />}
              <col className="hidden @min-[1180px]:table-column" style={{ width: 112 }} />
              <col style={{ width: 122 }} />
              <col style={{ width: 146 }} />
              <col style={{ width: 158 }} />
              {t.hasActions && <col style={{ width: 276 }} />}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className={`${TH} left-0 z-30`}>Scholar ID</th>
                <th scope="col" className={`${TH} left-[106px] z-30`}>Name</th>
                <th scope="col" className={TH}>Year</th>
                {!t.hideSchool && <th scope="col" className={`${TH} hidden @min-[1350px]:table-cell`}>School</th>}
                <th scope="col" className={`${TH} hidden @min-[1180px]:table-cell`}>Program</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>SDP</th>
                <th scope="col" className={TH}>Grades</th>
                {t.hasActions && <th scope="col" className={`${TH} !text-center`}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {skeleton && Array.from({ length: 6 }, (_, i) => (
                <tr key={i} aria-hidden="true">{Array.from({ length: cols }, (_, j) => <td key={j} className={`${pad} px-2.5 border-t border-[#eef3fb]`}><div className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${50 + ((i * 7 + j * 13) % 40)}%` }} /></td>)}</tr>
              ))}
              {t.rows && t.rows.length === 0 && <tr><td colSpan={cols} className="px-4 py-10 text-center text-[14px] text-slate-700">{t.emptyText}</td></tr>}
              {t.rows?.map(r => {
                const expanded = open.has(r.scholarIdNumber);
                const cell = `group-hover:bg-[#f7f9fc] ${pad} px-2.5 align-middle border-t border-[#eef3fb] bg-white`;
                return (
                  <FragmentRow key={r.scholarIdNumber}>
                    <tr className="group">
                      <td className={`${cell} sticky left-0 z-10 whitespace-nowrap text-[13px] text-slate-800`} style={MONO}>
                        <span className="inline-flex items-center gap-1">
                          <button type="button" onClick={() => toggle(r.scholarIdNumber)} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} school and program of ${r.name}`}
                            className="@min-[1350px]:hidden -ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-100">{expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</button>
                          <span className="tabular-nums">{r.scholarIdNumber}</span>
                        </span>
                      </td>
                      <td className={`${cell} sticky left-[106px] z-10`}><NameCell r={r} onOpenRecord={t.onOpenRecord} /></td>
                      <td className={`${cell} whitespace-nowrap text-slate-800`} title={r.yearLevel || undefined}>{shortYear(r.yearLevel)}</td>
                      {!t.hideSchool && <td className={`${cell} hidden @min-[1350px]:table-cell text-slate-800`} title={r.school || undefined}><span className="line-clamp-2 leading-5">{r.school || "—"}</span></td>}
                      <td className={`${cell} hidden @min-[1180px]:table-cell text-slate-800`} title={r.program || undefined}><span className="block truncate">{r.program || "—"}</span></td>
                      <td className={cell}><StatusCell r={r} tab={t.tab} /></td>
                      <td className={cell}><SdpCell r={r} onView={t.onViewSdp} /></td>
                      <td className={cell}><GradesCell r={r} enteredStatus={t.facts?.[r.scholarIdNumber]?.gradesStatus ?? null} /></td>
                      {t.hasActions && <td className={`${cell} !px-2`}><ActionSlots {...ap(r)} /></td>}
                    </tr>
                    {expanded && (
                      <tr className="@min-[1350px]:hidden">
                        <td colSpan={cols} className="border-t border-[#eef3fb] bg-[#f7f9fc] px-4 py-2.5 text-[14px] text-slate-800">
                          <span className="mr-5"><span className="text-slate-600">School </span>{r.school || "—"}</span>
                          <span className="@min-[1180px]:hidden"><span className="text-slate-600">Program </span>{r.program || "—"}</span>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* a narrow screen: one card per scholar */}
      <ul className="@min-[880px]:hidden space-y-2.5">
        {skeleton && Array.from({ length: 3 }, (_, i) => <li key={i} aria-hidden="true" className="h-32 animate-pulse rounded-xl border border-[#e6ecf5] bg-white" />)}
        {t.rows && t.rows.length === 0 && <li className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">{t.emptyText}</li>}
        {t.rows?.map(r => {
          const { surname, given } = splitName(r.name);
          return (
            <li key={r.scholarIdNumber} className="rounded-xl border border-[#e6ecf5] bg-white px-3.5 py-3 text-[14px]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {r.recordId
                    ? <button type="button" onClick={() => t.onOpenRecord(r.recordId as string)} className="block max-w-full text-left font-bold text-[#00709f] hover:underline">{surname} {given}</button>
                    : <p className="font-bold text-[#062444]">{surname} {given}</p>}
                  <p className="text-[13px] text-slate-700 tabular-nums" style={MONO}>{r.scholarIdNumber}</p>
                </div>
                <span className="shrink-0 text-[13px] text-slate-700" title={r.yearLevel || undefined}>{shortYear(r.yearLevel)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusChips r={r} tab={t.tab} />
              </div>
              <p className="mt-1.5 text-[13px] leading-5 text-slate-700">{[r.school, r.program].filter(Boolean).join(" · ")}</p>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <div><p className="text-[13px] text-slate-600">SDP</p><SdpCell r={r} onView={t.onViewSdp} /></div>
                <div><p className="text-[13px] text-slate-600">Grades</p><GradesCell r={r} enteredStatus={t.facts?.[r.scholarIdNumber]?.gradesStatus ?? null} /></div>
              </div>
              {t.hasActions && <CardActions {...ap(r)} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The scholarship status and (Applications) where the renewal stands, in a row of chips for the phone card. */
function StatusChips({ r, tab }: { r: RenewalListRow; tab: RenewalListTab }) {
  return <StatusCell r={r} tab={tab} />;
}

/** A row that may be followed by its detail row (a table body takes plain row elements, so this only groups them). */
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }
