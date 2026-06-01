export type NormalizedDisaggregateRow = {
  first: string;
  second: string;
  third: string;
  value: number;
};

export type DisaggregateCategoryMap = Record<
  string,
  Record<string, Record<string, number> | number | string | null | undefined>
>;

const TOTAL_LIKE_KEYS = new Set(["total", "value", "amount", "count", "ayp", "ayp 10 24"]);
const META_KEYS = new Set([
  "category",
  "option",
  "label",
  "sex",
  "gender",
  "service category",
  "service_category",
  "service type",
  "service_type",
  "message type",
  "message_type",
]);

const AYP_AGE_BAND_LABEL = "AYP (10-24)";

function normalizeKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAgeBandLabel(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return trimmed;

  const normalized = normalizeKey(trimmed);
  if (normalized === "ayp" || normalized === "ayp 10 24") return AYP_AGE_BAND_LABEL;

  const rangeMatch = trimmed.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && (start >= 65 || end >= 65)) {
      return "65+";
    }
    return `${start}-${end}`;
  }

  const plusMatch = trimmed.match(/^(\d{1,2})\s*\+$/);
  if (plusMatch) {
    const start = Number(plusMatch[1]);
    if (Number.isFinite(start) && start >= 65) return "65+";
    return `${start}+`;
  }

  return trimmed;
}

export function toSafeAggregateNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function readAggregateEntryTotal(entry: Record<string, unknown>) {
  const preferredKeys = ["TOTAL", "Total", "total", "Value", "value", "count", "amount"];
  for (const key of preferredKeys) {
    if (entry[key] !== undefined) return toSafeAggregateNumber(entry[key]);
  }

  return Object.entries(entry).reduce((sum, [rawKey, rawValue]) => {
    const key = normalizeKey(rawKey);
    if (TOTAL_LIKE_KEYS.has(key)) return sum;
    return sum + toSafeAggregateNumber(rawValue);
  }, 0);
}

function parseNestedDisaggregates(value: Record<string, unknown>): NormalizedDisaggregateRow[] {
  const source = value.disaggregates;
  if (!source || typeof source !== "object") return [];

  const rows: NormalizedDisaggregateRow[] = [];
  Object.entries(source as Record<string, unknown>).forEach(([levelOne, secondLevel]) => {
    if (!secondLevel || typeof secondLevel !== "object") return;

    Object.entries(secondLevel as Record<string, unknown>).forEach(([levelTwo, thirdLevel]) => {
      if (thirdLevel && typeof thirdLevel === "object") {
        const entry = thirdLevel as Record<string, unknown>;
        const valueEntries = Object.entries(entry).filter(([rawKey, rawValue]) => {
          const key = normalizeKey(rawKey);
          if (TOTAL_LIKE_KEYS.has(key)) return false;
          if (typeof rawValue === "number") return Number.isFinite(rawValue);
          if (typeof rawValue === "string" && rawValue.trim()) {
            return Number.isFinite(Number(rawValue.replaceAll(",", "")));
          }
          return false;
        });

        if (valueEntries.length === 0) {
          rows.push({
            first: levelOne || "General",
            second: levelTwo || "Total",
            third: "Total",
            value: readAggregateEntryTotal(entry),
          });
          return;
        }

        valueEntries.forEach(([levelThree, rawValue]) => {
          rows.push({
            first: levelOne || "General",
            second: levelTwo || "Total",
            third: normalizeAgeBandLabel(levelThree || "Total"),
            value: toSafeAggregateNumber(rawValue),
          });
        });
        return;
      }

      rows.push({
        first: levelOne || "General",
        second: normalizeAgeBandLabel(levelTwo || "Total"),
        third: "Total",
        value: toSafeAggregateNumber(thirdLevel),
      });
    });
  });

  return rows;
}

function parseAggregateTable(value: Record<string, unknown>): NormalizedDisaggregateRow[] {
  if (!Array.isArray(value.aggregate_table)) return [];

  const rows: NormalizedDisaggregateRow[] = [];
  value.aggregate_table.forEach((rawRow) => {
    if (!rawRow || typeof rawRow !== "object") return;
    const row = rawRow as Record<string, unknown>;
    const category =
      String(
        row.category ??
          row.option ??
          row.label ??
          row.service_category ??
          row.service_type ??
          "General",
      ).trim() || "General";
    const sex = String(row.sex ?? row.gender ?? "Total").trim() || "Total";
    const valueEntries = Object.entries(row).filter(([rawKey, rawValue]) => {
      const key = normalizeKey(rawKey);
      if (META_KEYS.has(key) || TOTAL_LIKE_KEYS.has(key)) return false;
      if (typeof rawValue === "number") return Number.isFinite(rawValue);
      if (typeof rawValue === "string" && rawValue.trim()) {
        return Number.isFinite(Number(rawValue.replaceAll(",", "")));
      }
      return false;
    });

    if (valueEntries.length === 0) {
      rows.push({
        first: category,
        second: sex,
        third: "Total",
        value: readAggregateEntryTotal(row),
      });
      return;
    }

    valueEntries.forEach(([levelThree, rawValue]) => {
      rows.push({
        first: category,
        second: sex,
        third: normalizeAgeBandLabel(levelThree || "Total"),
        value: toSafeAggregateNumber(rawValue),
      });
    });
  });

  return rows;
}

function parseCategories(value: Record<string, unknown>): NormalizedDisaggregateRow[] {
  if (!value.categories || typeof value.categories !== "object") return [];

  const rows: NormalizedDisaggregateRow[] = [];
  Object.entries(value.categories as Record<string, unknown>).forEach(([category, rawValue]) => {
    if (rawValue && typeof rawValue === "object") {
      const entry = rawValue as Record<string, unknown>;
      const subEntries = Object.entries(entry).filter(([, nestedValue]) => {
        if (typeof nestedValue === "number") return Number.isFinite(nestedValue);
        if (typeof nestedValue === "string" && nestedValue.trim()) {
          return Number.isFinite(Number(nestedValue.replaceAll(",", "")));
        }
        return false;
      });

      if (subEntries.length === 0) {
        rows.push({
          first: category || "General",
          second: "Total",
          third: "Total",
          value: readAggregateEntryTotal(entry),
        });
        return;
      }

      subEntries.forEach(([subKey, nestedValue]) => {
        rows.push({
          first: category || "General",
          second: normalizeAgeBandLabel(subKey || "Total"),
          third: "Total",
          value: toSafeAggregateNumber(nestedValue),
        });
      });
      return;
    }

    rows.push({
      first: category || "General",
      second: "Total",
      third: "Total",
      value: toSafeAggregateNumber(rawValue),
    });
  });

  return rows;
}

function parseSexTotals(value: Record<string, unknown>): NormalizedDisaggregateRow[] {
  const rows: NormalizedDisaggregateRow[] = [];

  if (value.male !== undefined) {
    rows.push({
      first: "General",
      second: "Male",
      third: "Total",
      value: toSafeAggregateNumber(value.male),
    });
  }
  if (value.female !== undefined) {
    rows.push({
      first: "General",
      second: "Female",
      third: "Total",
      value: toSafeAggregateNumber(value.female),
    });
  }

  return rows;
}

export function getAggregateValueDisaggregateRows(value: unknown): NormalizedDisaggregateRow[] {
  if (!value || typeof value !== "object") return [];

  const source = value as Record<string, unknown>;
  const nestedRows = parseNestedDisaggregates(source);
  if (nestedRows.length > 0) return nestedRows;

  const aggregateTableRows = parseAggregateTable(source);
  if (aggregateTableRows.length > 0) return aggregateTableRows;

  const categoryRows = parseCategories(source);
  if (categoryRows.length > 0) return categoryRows;

  const sexRows = parseSexTotals(source);
  if (sexRows.length > 0) return sexRows;

  return [];
}

export function normalizeAggregateValueToDisaggregateMap(
  value: unknown,
): DisaggregateCategoryMap | null {
  const rows = getAggregateValueDisaggregateRows(value);
  if (rows.length === 0) return null;

  const map: DisaggregateCategoryMap = {};
  rows.forEach((row) => {
    if (!map[row.first]) map[row.first] = {};
    const secondLevel = map[row.first];
    const existing = secondLevel[row.second];

    if (row.third === "Total") {
      if (existing && typeof existing === "object" && existing !== null) {
        (existing as Record<string, unknown>).TOTAL = toSafeAggregateNumber(
          (existing as Record<string, unknown>).TOTAL,
        ) + row.value;
        return;
      }
      secondLevel[row.second] = toSafeAggregateNumber(existing) + row.value;
      return;
    }

    const thirdLevel =
      existing && typeof existing === "object" && existing !== null
        ? (existing as Record<string, number>)
        : {};
    thirdLevel[row.third] = toSafeAggregateNumber(thirdLevel[row.third]) + row.value;
    secondLevel[row.second] = thirdLevel;
  });

  return map;
}
