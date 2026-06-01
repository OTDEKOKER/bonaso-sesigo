import { getAggregatePeriodLabel, type AggregatePeriodMode } from "@/lib/aggregates/quarter-buckets";
import type { Aggregate } from "@/lib/types";
import type { NahpaCategoryConfig } from "@/lib/reports/nahpa-visualization-settings";
import type { ReportBarCategoryRow } from "@/components/reports/report-bar-chart";
import type { ReportValueCell } from "@/components/reports/report-data-table";

const normalizeText = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toSafeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const extractAggregateTotal = (value: unknown) => {
  if (typeof value === "number" || typeof value === "string") return toSafeNumber(value);
  if (!value || typeof value !== "object") return 0;

  const source = value as Record<string, unknown>;
  if (source.total !== undefined) return toSafeNumber(source.total);
  if (source.value !== undefined) return toSafeNumber(source.value);
  if (source.male !== undefined || source.female !== undefined) {
    return toSafeNumber(source.male) + toSafeNumber(source.female);
  }
  return 0;
};

function findCategoryLabel(indicatorName: string, config: NahpaCategoryConfig[]) {
  const normalizedIndicatorName = normalizeText(indicatorName);
  if (!normalizedIndicatorName) return null;

  for (const category of config) {
    const matches = category.aliases.some((alias) => normalizedIndicatorName.includes(normalizeText(alias)));
    if (matches) return category.label;
  }
  return null;
}

export function buildCategoryRowsFromAggregates(input: {
  aggregates: Aggregate[];
  periodMode: "dates" | AggregatePeriodMode;
  selectedPeriodLabels: string[];
  rangeLabel?: string;
  categories: NahpaCategoryConfig[];
  indicatorFilter?: (indicatorName: string) => boolean;
}): ReportBarCategoryRow[] {
  const { aggregates, periodMode, selectedPeriodLabels, rangeLabel, categories, indicatorFilter } = input;
  const selectedSet = new Set(selectedPeriodLabels);
  const periodHasRows = new Map<string, boolean>();
  const totalsByPeriod = new Map<string, Map<string, number>>();

  aggregates.forEach((aggregate) => {
    const indicatorName = String(aggregate.indicator_name || "");
    if (indicatorFilter && !indicatorFilter(indicatorName)) return;

    const periodLabel =
      periodMode === "dates"
        ? rangeLabel || selectedPeriodLabels[0] || "Selected Range"
        : getAggregatePeriodLabel(aggregate, periodMode);
    if (!periodLabel || !selectedSet.has(periodLabel)) return;

    periodHasRows.set(periodLabel, true);
    if (!totalsByPeriod.has(periodLabel)) totalsByPeriod.set(periodLabel, new Map<string, number>());

    const matchedCategoryLabel = findCategoryLabel(indicatorName, categories);
    if (!matchedCategoryLabel) return;

    const periodTotals = totalsByPeriod.get(periodLabel)!;
    periodTotals.set(
      matchedCategoryLabel,
      (periodTotals.get(matchedCategoryLabel) || 0) + extractAggregateTotal(aggregate.value),
    );
  });

  return categories.map((category) => {
    const byPeriod = selectedPeriodLabels.reduce<Record<string, ReportValueCell>>((accumulator, periodLabel) => {
      const hasPeriodData = Boolean(periodHasRows.get(periodLabel));
      if (!hasPeriodData) {
        accumulator[periodLabel] = { hasData: false, value: null };
        return accumulator;
      }

      const total = totalsByPeriod.get(periodLabel)?.get(category.label) || 0;
      accumulator[periodLabel] = { hasData: true, value: total };
      return accumulator;
    }, {});

    return {
      label: category.label,
      color: category.color,
      byPeriod,
    };
  });
}

export function buildIndicatorRowsFromAggregates(input: {
  aggregates: Aggregate[];
  periodMode: "dates" | AggregatePeriodMode;
  selectedPeriodLabels: string[];
  rangeLabel?: string;
  indicatorFilter?: (indicatorName: string) => boolean;
  indicatorLabelById?: ReadonlyMap<string, string>;
  maxRows?: number;
}): ReportBarCategoryRow[] {
  const {
    aggregates,
    periodMode,
    selectedPeriodLabels,
    rangeLabel,
    indicatorFilter,
    indicatorLabelById,
    maxRows = 20,
  } = input;
  const selectedSet = new Set(selectedPeriodLabels);
  const periodHasRows = new Map<string, boolean>();
  const indicatorSet = new Set<string>();
  const labelByIndicatorKey = new Map<string, string>();
  const totalsByIndicatorPeriod = new Map<string, Map<string, number>>();

  aggregates.forEach((aggregate) => {
    const indicatorName = String(aggregate.indicator_name || "").trim();
    if (!indicatorName) return;
    if (indicatorFilter && !indicatorFilter(indicatorName)) return;
    const indicatorKey = String(aggregate.indicator || "").trim() || indicatorName;
    const indicatorLabel = indicatorLabelById?.get(String(aggregate.indicator || "").trim()) || indicatorName;

    const periodLabel =
      periodMode === "dates"
        ? rangeLabel || selectedPeriodLabels[0] || "Selected Range"
        : getAggregatePeriodLabel(aggregate, periodMode);
    if (!periodLabel || !selectedSet.has(periodLabel)) return;

    periodHasRows.set(periodLabel, true);
    indicatorSet.add(indicatorKey);
    labelByIndicatorKey.set(indicatorKey, indicatorLabel);

    if (!totalsByIndicatorPeriod.has(indicatorKey)) {
      totalsByIndicatorPeriod.set(indicatorKey, new Map<string, number>());
    }
    const periodTotals = totalsByIndicatorPeriod.get(indicatorKey)!;
    periodTotals.set(periodLabel, (periodTotals.get(periodLabel) || 0) + extractAggregateTotal(aggregate.value));
  });

  const indicatorKeys = Array.from(indicatorSet)
    .sort((left, right) =>
      (labelByIndicatorKey.get(left) || left).localeCompare(labelByIndicatorKey.get(right) || right),
    )
    .slice(0, maxRows);

  const palette = ["#1f6a8a", "#9c2f92", "#2e8b57", "#b55a18", "#1f9ac7", "#0f4258", "#48a535", "#e67e22"];

  return indicatorKeys.map((indicatorKey, index) => {
    const byPeriod = selectedPeriodLabels.reduce<Record<string, ReportValueCell>>((accumulator, periodLabel) => {
      const hasPeriodData = Boolean(periodHasRows.get(periodLabel));
      if (!hasPeriodData) {
        accumulator[periodLabel] = { hasData: false, value: null };
        return accumulator;
      }
      const total = totalsByIndicatorPeriod.get(indicatorKey)?.get(periodLabel) || 0;
      accumulator[periodLabel] = { hasData: true, value: total };
      return accumulator;
    }, {});

    return {
      label: labelByIndicatorKey.get(indicatorKey) || indicatorKey,
      color: palette[index % palette.length],
      byPeriod,
    };
  });
}

export function indicatorNameMatchesAliases(indicatorName: string, aliases: string[]) {
  const normalizedIndicatorName = normalizeText(indicatorName);
  return aliases.some((alias) => normalizedIndicatorName.includes(normalizeText(alias)));
}
