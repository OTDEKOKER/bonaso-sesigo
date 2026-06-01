import type { IndicatorCategory } from "@/lib/types"

export const INDICATOR_CATEGORY_OPTIONS: Array<{ value: IndicatorCategory; label: string }> = [
  { value: "hiv_prevention", label: "HIV Prevention" },
  { value: "ncd", label: "Non-Communicable Diseases" },
  { value: "mental_health", label: "Mental Health" },
  { value: "gbv", label: "GBV" },
  { value: "sti", label: "STI" },
  { value: "trainings", label: "Trainings" },
  { value: "media", label: "Media" },
  { value: "events", label: "Events" },
]

export const INDICATOR_CATEGORY_LABELS: Record<IndicatorCategory, string> = Object.fromEntries(
  INDICATOR_CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<IndicatorCategory, string>

export const INDICATOR_CATEGORY_BADGE_CLASSES: Record<IndicatorCategory, string> = {
  hiv_prevention: "bg-primary/10 text-primary",
  ncd: "bg-chart-3/10 text-chart-3",
  mental_health: "bg-sky-100 text-sky-700",
  gbv: "bg-rose-100 text-rose-700",
  sti: "bg-amber-100 text-amber-700",
  trainings: "bg-emerald-100 text-emerald-700",
  media: "bg-cyan-100 text-cyan-700",
  events: "bg-chart-4/10 text-chart-4",
}

export const INDICATOR_CATEGORY_CHART_COLORS: Record<IndicatorCategory, string> = {
  hiv_prevention: "hsl(var(--chart-1))",
  ncd: "hsl(var(--chart-3))",
  mental_health: "#0ea5e9",
  gbv: "#e11d48",
  sti: "#f59e0b",
  trainings: "#10b981",
  media: "#06b6d4",
  events: "hsl(var(--chart-4))",
}

export function getIndicatorCategoryLabel(category?: string | null) {
  if (!category) return "Uncategorized"
  return INDICATOR_CATEGORY_LABELS[category as IndicatorCategory] || category
}
