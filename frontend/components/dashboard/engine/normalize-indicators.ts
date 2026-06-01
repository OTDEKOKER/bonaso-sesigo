import type { DashboardCustomWidget, IndicatorStage } from "./types";

export const actualSeriesColor = "#0EA5E9";
export const targetSeriesColor = "#F59E0B";

export const indicatorStageOrder: IndicatorStage[] = [
  "screened",
  "eligible",
  "tested",
  "positive",
  "referred",
  "linked",
  "service",
  "messaging",
  "support",
  "other",
];

export const indicatorStageLabels: Record<IndicatorStage, string> = {
  screened: "Screened",
  eligible: "Eligible",
  tested: "Tested",
  positive: "Positive",
  referred: "Referred",
  linked: "Linked",
  service: "Service",
  messaging: "Messaging",
  support: "Support",
  other: "Other",
};

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const wholeNumberFormatter = new Intl.NumberFormat("en");
const percentFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function formatCompactNumber(value: number) {
  return compactNumberFormatter.format(value);
}

export function formatWholeNumber(value: number) {
  return wholeNumberFormatter.format(value);
}

export function formatPercent(value: number) {
  return percentFormatter.format(value);
}

export function toSafeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function truncateLabel(label: string, maxLength = 18) {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function cleanIndicatorLabel(name: string) {
  const standardized = String(name || "")
    .replace(/^\s*(total\s+number\s+of|number\s+of|number)\s+/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!standardized) return "Indicator";

  const titleCased = toTitleCase(standardized);
  return titleCased
    .replace(/\btb\b/gi, "TB")
    .replace(/\bgbv\b/gi, "GBV")
    .replace(/\bhiv\b/gi, "HIV")
    .replace(/\bplhiv\b/gi, "PLHIV")
    .replace(/\bncd\b/gi, "NCD")
    .replace(/\bncds\b/gi, "NCDs")
    .replace(/\bsti\b/gi, "STI")
    .replace(/\bstis\b/gi, "STIs")
    .replace(/\bpep\b/gi, "PEP")
    .replace(/\bprep\b/gi, "PrEP");
}

export function shortIndicatorLabel(name: string) {
  const cleaned = cleanIndicatorLabel(name);
  const acronymMatches = cleaned.match(/\b(?:[A-Z]{2,}(?:s)?|PrEP)\b/g);
  if (acronymMatches?.length) {
    return acronymMatches[acronymMatches.length - 1];
  }

  const withoutCommonPhrases = cleaned
    .replace(/\b(Individuals|People|Persons|Clients|PLHIV)\b/gi, "")
    .replace(/\b(Screened|Tested|Reported|For|Of|Who|With|Receiving|Received)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return truncateLabel(withoutCommonPhrases || cleaned, 14);
}

export function detectIndicatorStage(label: string): IndicatorStage {
  const normalized = cleanIndicatorLabel(label).toLowerCase();

  if (/\btested\b/.test(normalized)) return "tested";
  if (/\bpositive\b/.test(normalized)) return "positive";
  if (/\b(screened|screening|test)\b/.test(normalized)) return "screened";
  if (/\beligible\b/.test(normalized)) return "eligible";
  if (/\b(referred|referral)\b/.test(normalized)) return "referred";
  if (/\b(linked|linkage|initiated)\b/.test(normalized)) return "linked";
  if (/\b(message|messages|reached|sensitised|sensitized)\b/.test(normalized)) return "messaging";
  if (/\b(counselling|counseling|distributed|provided|completed|received)\b/.test(normalized)) return "service";
  if (/\b(followed|tracing|support)\b/.test(normalized)) return "support";

  return "other";
}

export function wrapTickLabel(label: string, maxCharsPerLine = 14, maxLines = 3) {
  const words = label.split(/\s+/).filter(Boolean);
  if (!words.length) return [label];

  const lines: string[] = [];
  let currentLine = "";

  for (const [index, word] of words.entries()) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxCharsPerLine) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      if (lines.length === maxLines - 1) {
        const remainingWords = [word, ...words.slice(index + 1)].join(" ");
        lines.push(truncateLabel(remainingWords, maxCharsPerLine));
        return lines;
      }
    }
    currentLine = word;
  }

  if (currentLine) lines.push(currentLine);
  return lines.slice(0, maxLines);
}

export function wrapLabelWithoutTruncation(label: string, maxCharsPerLine = 24) {
  const words = label.split(/\s+/).filter(Boolean);
  if (!words.length) return [label];

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxCharsPerLine) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

export function getCustomWidgetSubtitle(widget: DashboardCustomWidget) {
  if (!widget.disaggregateDimensionKey) return undefined;
  const displayLabel =
    widget.disaggregateDimensionLabel ||
    toTitleCase(
      String(widget.disaggregateDimensionKey || "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  return displayLabel ? `Breakdown: ${displayLabel}` : undefined;
}

export function renderBarValueLabel(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "";
  return formatWholeNumber(numericValue);
}
