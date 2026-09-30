import type { PresentationSlide, TitleSlideSettings, WordCloudSettings, MultipleChoiceSettings, RankingSettings } from "./slidesApi";
import type { PresentationResponseRow } from "./presentationSessionApi";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function questionOf(slide: PresentationSlide): string {
  if (slide.type === "title") return (slide.settings as TitleSlideSettings).heading;
  return (slide.settings as WordCloudSettings | MultipleChoiceSettings | RankingSettings).question || "";
}

function responseText(slide: PresentationSlide, row: PresentationResponseRow): string {
  if (slide.type === "word_cloud") return (row.response.words ?? []).join(", ");
  if (slide.type === "multiple_choice") {
    const options = (slide.settings as MultipleChoiceSettings).options;
    return (row.response.selectedIndexes ?? []).map(i => options[i] ?? `Option ${i + 1}`).join("; ");
  }
  if (slide.type === "ranking") {
    const items = (slide.settings as RankingSettings).items;
    return (row.response.order ?? []).map((itemIndex, position) => `${position + 1}. ${items[itemIndex] ?? `Item ${itemIndex + 1}`}`).join(" | ");
  }
  return "";
}

/** One row per response, across every slide of a session -- Title slides are skipped (they never collect responses). Triggers a browser download directly; no server round-trip needed since everything's already loaded client-side for the results view. */
export function downloadSessionResultsCsv(presentationTitle: string, slides: PresentationSlide[], responsesBySlide: Map<string, PresentationResponseRow[]>): void {
  const header = ["Slide #", "Slide Type", "Question", "Response", "Hidden", "Submitted At"];
  const rows: string[][] = [];

  slides.forEach((slide, index) => {
    if (slide.type === "title") return;
    const responses = responsesBySlide.get(slide.id) ?? [];
    for (const row of responses) {
      rows.push([
        String(index + 1),
        slide.type,
        questionOf(slide),
        responseText(slide, row),
        row.hidden ? "yes" : "no",
        new Date(row.createdAt).toLocaleString(),
      ]);
    }
  });

  const csv = [header, ...rows].map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${presentationTitle.replace(/[^a-z0-9]+/gi, "-")}-results.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
