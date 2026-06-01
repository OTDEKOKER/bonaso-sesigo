"use client";

import { getAggregatePeriodLabel, type AggregatePeriodMode } from "@/lib/aggregates/quarter-buckets";
import type { Aggregate } from "@/lib/types";

import type { ReportBarCategoryRow } from "@/components/reports/report-bar-chart";
import type { ReportValueCell } from "@/components/reports/report-data-table";

type DisaggregateEntry = Record<string, unknown>;
type DisaggregateSexMap = Record<string, DisaggregateEntry>;
type DisaggregateCategoryMap = Record<string, DisaggregateSexMap>;

export type MessageTypeConfig = {
  label: string;
  color: string;
  aliases: string[];
};

type MessageTypeAccumulatorCell = {
  total: number;
  rowCount: number;
};

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

const getDisaggregatesMap = (value: unknown): DisaggregateCategoryMap | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (!source.disaggregates || typeof source.disaggregates !== "object") return null;
  return source.disaggregates as DisaggregateCategoryMap;
};

const readEntryTotal = (entry: DisaggregateEntry | undefined) => {
  if (!entry) return 0;

  const preferredKeys = ["TOTAL", "Total", "total", "Value", "value"];
  for (const key of preferredKeys) {
    if (entry[key] !== undefined) return toSafeNumber(entry[key]);
  }

  return Object.entries(entry).reduce((sum, [rawKey, rawValue]) => {
    const key = normalizeText(rawKey);
    if (key.includes("ayp")) return sum;
    return sum + toSafeNumber(rawValue);
  }, 0);
};

const resolveMessageTypeLabel = (rawLabel: unknown, config: MessageTypeConfig[]) => {
  const normalized = normalizeText(rawLabel);
  if (!normalized) return null;

  for (const item of config) {
    if (item.aliases.some((alias) => normalized.includes(normalizeText(alias)))) {
      return item.label;
    }
  }
  return null;
};

export function buildMessageTypeRows(input: {
  aggregates: Aggregate[];
  periodMode: "dates" | AggregatePeriodMode;
  selectedPeriodLabels: string[];
  rangeLabel?: string;
  config: MessageTypeConfig[];
  indicatorFilter?: (indicatorName: string) => boolean;
}): ReportBarCategoryRow[] {
  const { aggregates, periodMode, selectedPeriodLabels, rangeLabel, config, indicatorFilter } = input;
  const selectedSet = new Set(selectedPeriodLabels);
  const periodAccumulator = new Map<string, Map<string, MessageTypeAccumulatorCell>>();
  const periodHasRows = new Map<string, boolean>();

  aggregates.forEach((aggregate) => {
    const indicatorName = String(aggregate.indicator_name || "");
    if (indicatorFilter && !indicatorFilter(indicatorName)) return;

    const periodLabel =
      periodMode === "dates"
        ? rangeLabel || selectedPeriodLabels[0] || "Selected Range"
        : getAggregatePeriodLabel(aggregate, periodMode);

    if (!periodLabel || !selectedSet.has(periodLabel)) return;
    periodHasRows.set(periodLabel, true);

    if (!periodAccumulator.has(periodLabel)) {
      periodAccumulator.set(periodLabel, new Map<string, MessageTypeAccumulatorCell>());
    }
    const categoryAccumulator = periodAccumulator.get(periodLabel)!;

    const disaggregates = getDisaggregatesMap(aggregate.value);
    if (disaggregates) {
      Object.entries(disaggregates).forEach(([category, sexMap]) => {
        const label = resolveMessageTypeLabel(category, config);
        if (!label) return;
        const entry = categoryAccumulator.get(label) || { total: 0, rowCount: 0 };
        const categoryTotal = Object.values(sexMap || {}).reduce((sum, categoryEntry) => sum + readEntryTotal(categoryEntry), 0);
        entry.total += categoryTotal;
        entry.rowCount += 1;
        categoryAccumulator.set(label, entry);
      });
      return;
    }

    const directLabel = resolveMessageTypeLabel(indicatorName, config);
    if (!directLabel) return;
    const entry = categoryAccumulator.get(directLabel) || { total: 0, rowCount: 0 };
    entry.total += extractAggregateTotal(aggregate.value);
    entry.rowCount += 1;
    categoryAccumulator.set(directLabel, entry);
  });

  return config.map((item) => {
    const byPeriod = selectedPeriodLabels.reduce<Record<string, ReportValueCell>>((accumulator, periodLabel) => {
      const periodMap = periodAccumulator.get(periodLabel);
      const categoryEntry = periodMap?.get(item.label);
      const hasPeriodData = Boolean(periodHasRows.get(periodLabel));
      if (!hasPeriodData) {
        accumulator[periodLabel] = { hasData: false, value: null };
        return accumulator;
      }
      accumulator[periodLabel] = { hasData: true, value: categoryEntry ? categoryEntry.total : 0 };
      return accumulator;
    }, {});

    return {
      label: item.label,
      color: item.color,
      byPeriod,
    };
  });
}
