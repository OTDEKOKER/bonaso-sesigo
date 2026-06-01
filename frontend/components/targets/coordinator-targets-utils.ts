import type { CoordinatorTargetQuarter } from "@/lib/api";
import type { CoordinatorPerformanceStatus } from "@/components/targets/coordinator-targets-types";

export type DateRange = {
  start: string;
  end: string;
};

export function getCurrentFiscalYear(reference = new Date()): number {
  const monthIndex = reference.getMonth();
  const calendarYear = reference.getFullYear();
  return monthIndex <= 2 ? calendarYear - 1 : calendarYear;
}

export function getFiscalQuarterLabel(year: number, quarter: CoordinatorTargetQuarter): string {
  return `${quarter} ${year}`;
}

export function getFiscalQuarterDateRange(year: number, quarter: CoordinatorTargetQuarter): DateRange {
  if (quarter === "Q1") return { start: `${year}-04-01`, end: `${year}-06-30` };
  if (quarter === "Q2") return { start: `${year}-07-01`, end: `${year}-09-30` };
  if (quarter === "Q3") return { start: `${year}-10-01`, end: `${year}-12-31` };
  return { start: `${year + 1}-01-01`, end: `${year + 1}-03-31` };
}

export function isIsoRangeOverlapping(input: {
  leftStart: string;
  leftEnd: string;
  rightStart: string;
  rightEnd: string;
}): boolean {
  const { leftStart, leftEnd, rightStart, rightEnd } = input;
  const leftStartTime = Date.parse(leftStart);
  const leftEndTime = Date.parse(leftEnd);
  const rightStartTime = Date.parse(rightStart);
  const rightEndTime = Date.parse(rightEnd);
  if (
    Number.isNaN(leftStartTime) ||
    Number.isNaN(leftEndTime) ||
    Number.isNaN(rightStartTime) ||
    Number.isNaN(rightEndTime)
  ) {
    return false;
  }
  return leftStartTime <= rightEndTime && leftEndTime >= rightStartTime;
}

export function calculatePerformanceStatus(input: {
  targetValue: number;
  achievementPercent: number | null;
}): CoordinatorPerformanceStatus {
  if (input.targetValue <= 0 || input.achievementPercent === null) return "no_target";
  if (input.achievementPercent >= 100) return "met";
  if (input.achievementPercent >= 80) return "on_track";
  return "behind";
}

export function buildFiscalYearOptions(inputYears: number[]): number[] {
  const unique = new Set(inputYears.filter((year) => Number.isFinite(year)));
  const currentYear = getCurrentFiscalYear();
  unique.add(currentYear - 1);
  unique.add(currentYear);
  unique.add(currentYear + 1);
  return Array.from(unique).sort((left, right) => right - left);
}
