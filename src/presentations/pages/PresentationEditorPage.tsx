import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Play, Plus, Copy, Trash2, Type, Cloud, ListChecks, ArrowUpDown } from "lucide-react";
import { renamePresentation, type PresentationItem } from "../presentationsApi";
import {
  fetchSlides, createSlide, duplicateSlide, deleteSlide, updateSlideType, updateSlideSettings, reorderSlides,
  SLIDE_TYPE_LABELS, IMPLEMENTED_SLIDE_TYPES, type PresentationSlide, type SlideType, type TitleSlideSettings,
} from "../slidesApi";

const SLIDE_TYPE_ICONS: Record<SlideType, React.ReactNode> = {
  title: <Type size={14} />, word_cloud: <Cloud size={14} />, multiple_choice: <ListChecks size={14} />, ranking: <ArrowUpDown size={14} />,
};

type SaveStatus = "saved" | "saving";

/**
 * Phase 2 of "My Presentations": the editor's layout, chrome, and
 * auto-save wiring -- top bar (title/save status/Present/back), left
 * slide-thumbnail sidebar (add/delete/duplicate/reorder), main preview,
 * right settings panel. Only the "Title / Text" slide type has real
 * settings so far; Word Cloud/Multiple Choice/Ranking are selectable
 * (the type sticks in the database) but show a "coming in Phase 3"
 * placeholder here, per the approved phased plan.
 */
export function PresentationEditorPage({ presentation, onBack }: { presentation: PresentationItem; onBack: () => void }) {
  const [title, setTitle] = useState(presentation.title);
  const [slides, setSlides] = useState<PresentationSlide[]>([]);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const saveTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const loaded = await fetchSlides(presentation.id);
      setSlides(loaded);
      setSelectedSlideId(loaded[0]?.id ?? null);
      setLoading(false);
    })();
    return () => { if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation.id]);

  function scheduleSave(fn: () => Promise<unknown>) {
    setSaveStatus("saving");
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(() => { void fn().then(() => setSaveStatus("saved")); }, 600);
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    scheduleSave(() => renamePresentation(presentation.id, value.trim() || "Untitled presentation"));
  }

  async function handleAddSlide() {
    const res = await createSlide(presentation.id, "title", slides.length);
    if (!res.ok) return;
    setSlides(s => [...s, res.slide]);
    setSelectedSlideId(res.slide.id);
  }

  async function handleDuplicateSlide(slide: PresentationSlide) {
    const res = await duplicateSlide(slide);
    if (!res.ok) return;
    const insertAt = slides.findIndex(s => s.id === slide.id) + 1;
    const reordered = [...slides];
    reordered.splice(insertAt, 0, res.slide);
    setSlides(reordered);
    setSelectedSlideId(res.slide.id);
    await reorderSlides(reordered.map(s => s.id));
  }

  async function handleDeleteSlide(id: string) {
    await deleteSlide(id);
    const remaining = slides.filter(s => s.id !== id);
    setSlides(remaining);
    if (selectedSlideId === id) setSelectedSlideId(remaining[0]?.id ?? null);
  }

  async function handleReorder(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const current = [...slides];
    const fromIndex = current.findIndex(s => s.id === draggedId);
    const toIndex = current.findIndex(s => s.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const [moved] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, moved);
    setSlides(current);
    await reorderSlides(current.map(s => s.id));
  }

  async function handleTypeChange(slide: PresentationSlide, type: SlideType) {
    if (!IMPLEMENTED_SLIDE_TYPES.includes(type) && type !== slide.type) {
      // still allowed -- persists so Phase 3 can pick it up -- just resets settings to that type's default shape.
    }
    const ok = await updateSlideType(slide.id, type);
    if (!ok.ok) return;
    setSlides(await fetchSlides(presentation.id));
  }

  function handleTitleSettingsChange(slide: PresentationSlide, field: keyof TitleSlideSettings, value: string) {
    const current = slide.settings as TitleSlideSettings;
    const next: TitleSlideSettings = { ...current, [field]: value };
    setSlides(s => s.map(x => x.id === slide.id ? { ...x, settings: next } : x));
    scheduleSave(() => updateSlideSettings(slide.id, next));
  }

  const selectedSlide = slides.find(s => s.id === selectedSlideId) ?? null;

  return (
    <div className="fixed inset-0 z-[100] bg-[#f7f9fc] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-[#e6ecf5] shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-md text-slate-500 hover:bg-[#f0f3f8]" aria-label="Back to My Presentations">
          <ArrowLeft size={18} />
        </button>
        <input
          value={title} onChange={e => handleTitleChange(e.target.value)}
          className="text-[15px] font-bold text-[#062444] outline-none border-b border-transparent hover:border-[#e6ecf5] focus:border-[#0088cc] px-1 py-0.5 min-w-[120px] flex-1 max-w-md"
        />
        <span className="text-[11.5px] text-slate-400 shrink-0">{saveStatus === "saving" ? "Saving…" : "Saved"}</span>
        <div className="flex-1" />
        <button
          disabled
          title="Presenting live comes in a later phase of this tool"
          className="flex items-center gap-1.5 bg-[#062444]/40 text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2 cursor-not-allowed"
        >
          <Play size={14} /> Present
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left: slide thumbnails */}
        <div className="w-[190px] shrink-0 border-r border-[#e6ecf5] bg-white flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {slides.map((slide, index) => (
              <div
                key={slide.id}
                draggable
                onDragStart={() => setDraggingId(slide.id)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => { if (draggingId) void handleReorder(draggingId, slide.id); setDraggingId(null); }}
                onClick={() => setSelectedSlideId(slide.id)}
                className={`group relative rounded-lg border-2 p-2 cursor-pointer bg-white ${
                  selectedSlideId === slide.id ? "border-[#0088cc]" : "border-[#e6ecf5] hover:border-[#0088cc]/40"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10.5px] font-bold text-slate-400">{index + 1}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button onClick={e => { e.stopPropagation(); void handleDuplicateSlide(slide); }} className="p-0.5 rounded text-slate-400 hover:text-[#062444]" aria-label="Duplicate slide">
                      <Copy size={12} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); void handleDeleteSlide(slide.id); }} className="p-0.5 rounded text-slate-400 hover:text-red-600" aria-label="Delete slide">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="aspect-video rounded bg-[#f7f9fc] border border-[#f0f3f8] flex items-center justify-center px-2">
                  <p className="text-[9px] font-semibold text-[#062444] text-center truncate w-full">
                    {slide.type === "title" ? ((slide.settings as TitleSlideSettings).heading || "Untitled slide") : SLIDE_TYPE_LABELS[slide.type]}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-[#f0f3f8]">
            <button onClick={handleAddSlide} className="w-full flex items-center justify-center gap-1.5 bg-[#062444] text-white text-[12px] font-semibold rounded-lg py-2 hover:bg-[#0a3a6b]">
              <Plus size={14} /> Add Slide
            </button>
          </div>
        </div>

        {/* Main preview */}
        <div className="flex-1 flex items-center justify-center p-8 min-w-0">
          {loading ? (
            <p className="text-slate-400">Loading…</p>
          ) : !selectedSlide ? (
            <div className="text-center text-slate-400">
              <p className="text-[13.5px] font-medium mb-3">This presentation has no slides yet.</p>
              <button onClick={handleAddSlide} className="flex items-center gap-1.5 mx-auto bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2">
                <Plus size={14} /> Add your first slide
              </button>
            </div>
          ) : (
            <div className="w-full max-w-3xl aspect-video bg-white rounded-2xl border border-[#e6ecf5] shadow-sm flex flex-col items-center justify-center p-10 text-center">
              {selectedSlide.type === "title" ? (
                <>
                  <h2 className="text-3xl font-bold text-[#062444] mb-3 break-words">{(selectedSlide.settings as TitleSlideSettings).heading || "Untitled slide"}</h2>
                  {(selectedSlide.settings as TitleSlideSettings).subheading && (
                    <p className="text-[15px] text-slate-500 break-words">{(selectedSlide.settings as TitleSlideSettings).subheading}</p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-[#F3BC00] mb-3">{SLIDE_TYPE_ICONS[selectedSlide.type]}</div>
                  <p className="text-[15px] font-bold text-[#062444] mb-1.5">{SLIDE_TYPE_LABELS[selectedSlide.type]}</p>
                  <p className="text-[12.5px] text-slate-400 max-w-xs">The live preview and audience voting for this slide type arrive in the next phase of this tool.</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: slide settings */}
        <div className="w-[260px] shrink-0 border-l border-[#e6ecf5] bg-white p-4 overflow-y-auto">
          {selectedSlide ? (
            <>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Slide Type</label>
              <select
                value={selectedSlide.type}
                onChange={e => void handleTypeChange(selectedSlide, e.target.value as SlideType)}
                className="w-full border border-[#e6ecf5] rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[#062444] outline-none focus:border-[#0088cc] mb-5"
              >
                {(Object.keys(SLIDE_TYPE_LABELS) as SlideType[]).map(type => (
                  <option key={type} value={type}>
                    {SLIDE_TYPE_LABELS[type]}{!IMPLEMENTED_SLIDE_TYPES.includes(type) ? " (Phase 3)" : ""}
                  </option>
                ))}
              </select>

              {selectedSlide.type === "title" ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Heading</label>
                    <input
                      value={(selectedSlide.settings as TitleSlideSettings).heading}
                      onChange={e => handleTitleSettingsChange(selectedSlide, "heading", e.target.value)}
                      className="w-full border border-[#e6ecf5] rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#0088cc]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Subheading (optional)</label>
                    <textarea
                      value={(selectedSlide.settings as TitleSlideSettings).subheading}
                      onChange={e => handleTitleSettingsChange(selectedSlide, "subheading", e.target.value)}
                      rows={3}
                      className="w-full border border-[#e6ecf5] rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#0088cc] resize-none"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-slate-400 bg-[#f7f9fc] rounded-lg p-3">
                  Settings for {SLIDE_TYPE_LABELS[selectedSlide.type]} slides (question text, options, etc.) are coming in the next phase of this tool. The slide's type is already saved.
                </p>
              )}
            </>
          ) : (
            <p className="text-[12.5px] text-slate-400">Select or add a slide to edit its settings.</p>
          )}
        </div>
      </div>
    </div>
  );
}
