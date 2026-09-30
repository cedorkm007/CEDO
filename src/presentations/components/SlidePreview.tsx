import { Circle, Square, CheckCircle2, GripVertical, Cloud } from "lucide-react";
import type { PresentationSlide, TitleSlideSettings, WordCloudSettings, MultipleChoiceSettings, RankingSettings } from "../slidesApi";

/**
 * What the editor's main area shows for the selected slide -- the
 * slide's actual configured content (question + options/items as they'll
 * be presented), not simulated results. Real audience responses and live
 * result charts arrive with the Present/audience-voting phase; until
 * then this is a structural preview, same idea as PowerPoint/Slides
 * showing your slide content while you edit it.
 */
export function SlidePreview({ slide }: { slide: PresentationSlide }) {
  if (slide.type === "title") {
    const s = slide.settings as TitleSlideSettings;
    return (
      <>
        <h2 className="text-3xl font-bold text-[#062444] mb-3 break-words">{s.heading || "Untitled slide"}</h2>
        {s.subheading && <p className="text-[15px] text-slate-500 break-words">{s.subheading}</p>}
      </>
    );
  }

  if (slide.type === "word_cloud") {
    const s = slide.settings as WordCloudSettings;
    return (
      <>
        <h2 className="text-2xl font-bold text-[#062444] mb-2 break-words">{s.question || "Untitled question"}</h2>
        <p className="text-[12px] text-slate-400 mb-6">
          Up to {s.maxWordsPerPerson} word{s.maxWordsPerPerson > 1 ? "s" : ""} per person, {s.maxCharsPerWord} characters max
        </p>
        <div className="flex items-center gap-2 text-slate-300 border border-dashed border-[#e6ecf5] rounded-xl px-6 py-8">
          <Cloud size={18} />
          <span className="text-[12.5px] font-medium">The live word cloud appears here once you present</span>
        </div>
      </>
    );
  }

  if (slide.type === "multiple_choice") {
    const s = slide.settings as MultipleChoiceSettings;
    return (
      <>
        <h2 className="text-2xl font-bold text-[#062444] mb-6 break-words">{s.question || "Untitled question"}</h2>
        <div className="w-full max-w-md space-y-2 text-left">
          {s.options.map((option, i) => (
            <div key={i} className="flex items-center gap-2.5 border border-[#e6ecf5] rounded-lg px-4 py-2.5">
              {s.allowMultiple ? <Square size={15} className="text-slate-300 shrink-0" /> : <Circle size={15} className="text-slate-300 shrink-0" />}
              <span className="text-[13.5px] font-medium text-[#062444] flex-1 break-words">{option || `Option ${i + 1}`}</span>
              {s.correctIndexes.includes(i) && <CheckCircle2 size={15} className="text-green-600 shrink-0" />}
            </div>
          ))}
        </div>
      </>
    );
  }

  // ranking
  const s = slide.settings as RankingSettings;
  return (
    <>
      <h2 className="text-2xl font-bold text-[#062444] mb-6 break-words">{s.question || "Untitled question"}</h2>
      <div className="w-full max-w-md space-y-2 text-left">
        {s.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2.5 border border-[#e6ecf5] rounded-lg px-4 py-2.5">
            <GripVertical size={15} className="text-slate-300 shrink-0" />
            <span className="text-[11px] font-bold text-slate-400 shrink-0">{i + 1}</span>
            <span className="text-[13.5px] font-medium text-[#062444] break-words">{item || `Item ${i + 1}`}</span>
          </div>
        ))}
      </div>
    </>
  );
}
