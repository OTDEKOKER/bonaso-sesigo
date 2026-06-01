import { toTitleCase } from "./normalize-indicators";

export type DisaggregationDimensionKey =
  | "sex"
  | "age-range"
  | "age_range"
  | "key-population"
  | "key_population"
  | "location"
  | "activity-type"
  | "activity_type"
  | "referral-type"
  | "referral_type"
  | "message-type"
  | "message_type"
  | "condom-type"
  | "condom_type"
  | "ncd-screening-type"
  | "ncd_screening_type"
  | "counselling-type"
  | "counselling_type"
  | (string & {});

export type DisaggregationRecord = {
  count?: number;
  value?: number;
  [key: string]: unknown;
};

function normalizeDimensionKey(value: string) {
  return value.replace(/-/g, "_").trim().toLowerCase();
}

function resolveDimensionValue(record: DisaggregationRecord, dimensionKey: string): string {
  const normalized = normalizeDimensionKey(dimensionKey);
  const direct = record[dimensionKey];
  const normalizedMatch = Object.keys(record).find((key) => normalizeDimensionKey(key) === normalized);
  const fallback = normalizedMatch ? record[normalizedMatch] : undefined;
  const rawValue = direct ?? fallback;
  const value = String(rawValue ?? "Unknown").trim();
  return value || "Unknown";
}

function resolveCount(record: DisaggregationRecord) {
  const value = Number(record.value ?? record.count ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function groupByDisaggregate(records: DisaggregationRecord[], dimensionKey: string) {
  return records.reduce<Record<string, number>>((acc, record) => {
    const key = resolveDimensionValue(record, dimensionKey);
    acc[key] = (acc[key] || 0) + resolveCount(record);
    return acc;
  }, {});
}

export function buildDisaggregationChartRows(records: DisaggregationRecord[], dimensionKey: string) {
  const grouped = groupByDisaggregate(records, dimensionKey);
  return Object.entries(grouped)
    .map(([label, value]) => ({ label, shortLabel: toTitleCase(label), value }))
    .sort((left, right) => right.value - left.value);
}

export function buildDisaggregationMatrix(
  records: DisaggregationRecord[],
  rowDimension: string,
  columnDimension: string,
) {
  const rows = new Set<string>();
  const columns = new Set<string>();
  const matrix: Record<string, Record<string, number>> = {};

  for (const record of records) {
    const rowKey = resolveDimensionValue(record, rowDimension);
    const columnKey = resolveDimensionValue(record, columnDimension);
    const value = resolveCount(record);

    rows.add(rowKey);
    columns.add(columnKey);

    if (!matrix[rowKey]) matrix[rowKey] = {};
    matrix[rowKey][columnKey] = (matrix[rowKey][columnKey] || 0) + value;
  }

  return {
    columns: Array.from(columns),
    matrix,
    rows: Array.from(rows),
  };
}
