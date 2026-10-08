import { Type, AlignLeft, CircleDot, CheckSquare, ChevronDown, SlidersHorizontal, Star, Calendar, Clock, type LucideIcon } from "lucide-react";
import type { QuestionType } from "../surveyTypes";

export const TYPE_ICONS: Record<QuestionType, LucideIcon> = {
  short_answer: Type,
  paragraph: AlignLeft,
  multiple_choice: CircleDot,
  checkboxes: CheckSquare,
  dropdown: ChevronDown,
  linear_scale: SlidersHorizontal,
  rating: Star,
  date: Calendar,
  time: Clock,
};
