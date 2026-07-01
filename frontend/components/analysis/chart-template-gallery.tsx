"use client";

import { Check } from "lucide-react";

import { CHART_TEMPLATES, type ChartTemplate } from "@/lib/analytics/chart-templates";
import { cn } from "@/lib/utils";

type ChartTemplateGalleryProps = {
  /** Currently selected template id, if any. */
  selectedId?: string | null;
  onSelect: (template: ChartTemplate) => void;
  /**
   * Disaggregation keys available for the current indicator selection. When
   * provided, templates that require a dimension not in this set are shown as
   * disabled (still visible, so users understand what's possible).
   */
  availableDimensions?: string[];
  className?: string;
};

export function ChartTemplateGallery(props: ChartTemplateGalleryProps) {
  const { selectedId, onSelect, availableDimensions, className } = props;
  const availableSet = availableDimensions ? new Set(availableDimensions) : null;

  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {CHART_TEMPLATES.map((template) => {
        const Icon = template.icon;
        const missing =
          availableSet && template.requiresDimensions
            ? template.requiresDimensions.filter((dimension) => !availableSet.has(dimension))
            : [];
        const disabled = missing.length > 0;
        const active = selectedId === template.id;

        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            disabled={disabled}
            aria-pressed={active}
            title={disabled ? `Not available for the selected indicator (needs ${missing.join(", ")})` : undefined}
            className={cn(
              "group relative flex flex-col items-start gap-2 rounded-[1.25rem] border bg-card p-4 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60 hover:bg-accent/40",
              disabled && "cursor-not-allowed opacity-50 hover:border-border hover:bg-card",
            )}
          >
            {active ? (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            ) : null}
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70",
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-foreground">{template.label}</span>
            <span className="text-xs leading-snug text-muted-foreground">{template.description}</span>
          </button>
        );
      })}
    </div>
  );
}
