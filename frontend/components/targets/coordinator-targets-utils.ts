import type { CoordinatorTargetQuarter } from "@/lib/api";

// Coordinator performance (actuals, achievement %, status) and the fiscal-quarter
// date math used for aggregate matching now live SERVER-SIDE in the certified
// rollup engine (analysis.services.coordinator_rollups). The helpers below are
// only the small display utilities the page still needs.

export function getCurrentFiscalYear(reference = new Date()): number {
  const monthIndex = reference.getMonth();
  const calendarYear = reference.getFullYear();
  return monthIndex <= 2 ? calendarYear - 1 : calendarYear;
}

export function getFiscalQuarterLabel(year: number, quarter: CoordinatorTargetQuarter): string {
  return `${quarter} ${year}`;
}

export function buildFiscalYearOptions(inputYears: number[]): number[] {
  const unique = new Set(inputYears.filter((year) => Number.isFinite(year)));
  const currentYear = getCurrentFiscalYear();
  unique.add(currentYear - 1);
  unique.add(currentYear);
  unique.add(currentYear + 1);
  return Array.from(unique).sort((left, right) => right - left);
}
