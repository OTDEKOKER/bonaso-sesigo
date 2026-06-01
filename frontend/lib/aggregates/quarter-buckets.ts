import type { Aggregate } from "../types";

export type QuarterBucket = {
  year: number; // first year of the April-to-March reporting cycle
  quarter: 1 | 2 | 3 | 4;
};

export type MonthBucket = {
  year: number;
  month: number; // 1-12
};

export function getQuarterBucket(dateValue: string | null | undefined): QuarterBucket | null {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = parsed.getMonth();
  if (month < 3) {
    return { year: parsed.getFullYear() - 1, quarter: 4 };
  }

  const quarter = (Math.floor((month - 3) / 3) + 1) as 1 | 2 | 3 | 4;
  return { year: parsed.getFullYear(), quarter };
}

export function getMonthBucket(dateValue: string | null | undefined): MonthBucket | null {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
}

export function formatMonthBucket(bucket: MonthBucket): string {
  const date = new Date(bucket.year, bucket.month - 1, 1);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
}

export function getYearBucket(dateValue: string | null | undefined): number | null {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getFullYear();
}

export function formatQuarterBucket(bucket: QuarterBucket): string {
  const nextYearSuffix = String((bucket.year + 1) % 100).padStart(2, "0");
  return `Q${bucket.quarter} ${bucket.year}/${nextYearSuffix}`;
}

export function parseQuarterLabel(label: string): QuarterBucket | null {
  const match = String(label || "")
    .trim()
    .match(/^Q([1-4])\s+(\d{4})(?:\s*\/\s*(\d{2}|\d{4}))?$/i);
  if (!match) return null;
  return {
    quarter: Number(match[1]) as 1 | 2 | 3 | 4,
    year: Number(match[2]),
  };
}

export function parseMonthLabel(label: string): MonthBucket | null {
  const parsed = new Date(String(label || "").trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
}

export function compareQuarterLabels(left: string, right: string) {
  const leftBucket = parseQuarterLabel(left);
  const rightBucket = parseQuarterLabel(right);
  if (!leftBucket || !rightBucket) return left.localeCompare(right);
  return leftBucket.year - rightBucket.year || leftBucket.quarter - rightBucket.quarter;
}

export function compareMonthLabels(left: string, right: string) {
  const leftBucket = parseMonthLabel(left);
  const rightBucket = parseMonthLabel(right);
  if (!leftBucket || !rightBucket) return left.localeCompare(right);
  return leftBucket.year - rightBucket.year || leftBucket.month - rightBucket.month;
}

export function compareYearLabels(left: string, right: string) {
  const leftYear = Number(left);
  const rightYear = Number(right);
  if (!Number.isFinite(leftYear) || !Number.isFinite(rightYear)) return left.localeCompare(right);
  return leftYear - rightYear;
}

export function getAggregateQuarterLabel(
  aggregate: Pick<Aggregate, "period_start" | "period_end">,
): string | null {
  const startBucket = getQuarterBucket(aggregate.period_start);
  if (startBucket) return formatQuarterBucket(startBucket);

  const endBucket = getQuarterBucket(aggregate.period_end);
  if (endBucket) return formatQuarterBucket(endBucket);

  return null;
}

export type AggregatePeriodMode = "month" | "quarter" | "year";

export function getAggregatePeriodLabel(
  aggregate: Pick<Aggregate, "period_start" | "period_end">,
  mode: AggregatePeriodMode,
): string | null {
  if (mode === "quarter") return getAggregateQuarterLabel(aggregate);

  if (mode === "month") {
    const monthStart = getMonthBucket(aggregate.period_start);
    if (monthStart) return formatMonthBucket(monthStart);
    const monthEnd = getMonthBucket(aggregate.period_end);
    if (monthEnd) return formatMonthBucket(monthEnd);
    return null;
  }

  const yearStart = getYearBucket(aggregate.period_start);
  if (yearStart) return String(yearStart);
  const yearEnd = getYearBucket(aggregate.period_end);
  if (yearEnd) return String(yearEnd);
  return null;
}
