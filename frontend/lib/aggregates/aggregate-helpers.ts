import type { Aggregate } from "@/lib/types";
import {
  normalizeAggregateDisaggregationConfig,
  type AggregateDisaggregationConfig,
  type AggregateDisaggregationDimension,
} from "@/lib/indicators/disaggregation-presets";
import {
  getAggregateValueDisaggregateRows,
  normalizeAggregateValueToDisaggregateMap,
  toSafeAggregateNumber,
} from "@/lib/aggregates/disaggregate-normalization";

export type AggregateValue = {
  male?: number;
  female?: number;
  total?: number;
  age_range?: string;
  key_population?: string;
  disaggregates?: MatrixDisaggregates;
};

export type MatrixDisaggregates = Record<
  string,
  Record<string, Record<string, number | undefined>>
>;

export type MatrixInputValues = Record<
  string,
  Record<string, Record<string, string>>
>;

export type OrganizationWithParent = {
  id: string | number;
  name?: string;
  parentId?: string | number | null;
  parent?: string | number | null;
};

export type AggregateIndicatorGroup = {
  key: string;
  indicatorId: string;
  indicatorName: string;
  code: string;
  items: Aggregate[];
};

export type AggregateWorkbookTopicDefinition = {
  id: string;
  label: string;
  description: string;
};

export type AggregateWorkbookTopicSection = AggregateWorkbookTopicDefinition & {
  groups: AggregateIndicatorGroup[];
  totalValue: number;
};

export type DisplayMatrixResult = {
  matrix: MatrixDisaggregates;
  keyPops: string[];
  secondDimensionValues: string[];
  ageBands: string[];
  showAypColumn: boolean;
};

export type AggregateEntryMatrixConfig = {
  hasDisaggregates: boolean;
  primaryLabel: string;
  primaryValues: string[];
  secondaryLabel: string;
  secondaryValues: string[];
  bandLabel: string;
  bandValues: string[];
};

export type IndicatorDisaggregationInput = {
  sub_labels?: string[] | null;
  aggregate_disaggregation_config?: AggregateDisaggregationConfig | null;
};

export const AGE_RANGES = [
  "10-14",
  "15-19",
  "20-24",
  "25-29",
  "30-34",
  "35-39",
  "40-44",
  "45-49",
  "50-54",
  "55-59",
  "60-64",
  "65+",
] as const;

export const AYP_BAND_LABEL = "AYP (10-24)";
const AYP_SOURCE_BANDS = [
  "10-14",
  "15-19",
  "20-24",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
] as const;

export const KEY_POPULATIONS = [
  "MSM",
  "FSW",
  "PWD",
  "PWID",
  "LGBTQI+",
  "GENERAL POP.",
] as const;

export const MATRIX_AGE_BANDS = [...AGE_RANGES, AYP_BAND_LABEL] as const;

export const MATRIX_SEXES = ["Male", "Female"] as const;

export const AGGREGATE_WORKBOOK_TOPIC_DEFINITIONS: AggregateWorkbookTopicDefinition[] = [
  {
    id: "hiv-prevention",
    label: "HIV Prevention Messages",
    description: "HIV testing, PrEP, PEP, treatment, linkage, family planning, and prevention messaging.",
  },
  {
    id: "commodity",
    label: "Commodity Distribution",
    description: "Condoms, lubricants, braille-labelled commodities, and repeat collection indicators.",
  },
  {
    id: "psychosocial",
    label: "Psychosocial Support & Counselling",
    description: "Psychoeducation, counselling, disclosure, and mental health support indicators.",
  },
  {
    id: "human-rights",
    label: "Human Rights",
    description: "Rights, redress, stigma, legal aid, justice, and community-led monitoring indicators.",
  },
  {
    id: "gbv",
    label: "Gender Based Violence",
    description: "GBV screening, eligibility, referrals, and psychosocial or justice support indicators.",
  },
  {
    id: "sti",
    label: "STIs",
    description: "STI screening, STI referrals, linkage, and related TB referral indicators.",
  },
  {
    id: "ncd",
    label: "NCDs",
    description: "NCD screening, prevention messages, cessation programs, cancer, and support-group indicators.",
  },
  {
    id: "events",
    label: "Events & Campaigns",
    description: "Commemorative days, outreach events, and campaign participation indicators.",
  },
  {
    id: "capacity",
    label: "Program Management & Capacity Building",
    description: "Training, mentoring, reporting quality, advocacy, and media planning indicators.",
  },
  {
    id: "other",
    label: "Other Indicators",
    description: "Indicators that do not map cleanly to a workbook topic yet.",
  },
];

const preferredSecondDimensionOrder = ["Male", "M", "Female", "F", "Other", "Unknown", "All"];

const primaryDisaggregateLabelMap: Record<string, string> = {
  kp: "Key Population",
  "key population": "Key Population",
  "alcohol use": "Alcohol Use",
  "alcohol_use": "Alcohol Use",
  "tobacco use": "Tobacco Use",
  "tobacco_use": "Tobacco Use",
  "community leaders": "Community Leaders",
  "family planning": "Family Planning",
  "non traditional sites": "Non Traditional Sites",
  "social media platform": "Social Media Platform",
  "ncd prevention messages": "NCD Prevention Messages",
  "mental health management/treatment services": "Mental Health Management/Treatment Services",
  "mental health management treatment services": "Mental Health Management/Treatment Services",
  "counselling sessions": "Counselling Sessions",
  "counseling sessions": "Counselling Sessions",
  "receiving counselling": "Mental Health Screening",
  "receiving counseling": "Mental Health Screening",
  "mental health screening": "Mental Health Screening",
  "ncd screening": "NCD Screening",
};

const primaryDisaggregateOrder = [
  "kp",
  "key population",
  "alcohol use",
  "tobacco use",
  "community leaders",
  "family planning",
  "non traditional sites",
  "social media platform",
  "ncd prevention messages",
  "mental health management/treatment services",
  "mental health management treatment services",
  "counselling sessions",
  "counseling sessions",
  "receiving counselling",
  "receiving counseling",
  "mental health screening",
  "ncd screening",
];

const primaryDisaggregateValueMap: Record<string, string[]> = {
  kp: [...KEY_POPULATIONS],
  "key population": [...KEY_POPULATIONS],
  "alcohol use": ["Alcohol Use"],
  "tobacco use": ["Tobacco Use"],
};

function normalizeDimensionToken(value: string | undefined | null): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSheetTotalToken(value: string): boolean {
  const normalized = normalizeDimensionToken(value);
  return (
    normalized === "total" ||
    normalized === "sub total" ||
    normalized === "subtotal" ||
    normalized === "total male" ||
    normalized === "total female"
  );
}

function normalizeDimensionValues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value.length > 0);
}

function resolveDisaggregationConfig(
  input?: string[] | IndicatorDisaggregationInput,
): AggregateDisaggregationConfig {
  // aggregate_disaggregation_config is the ONLY runtime source for the capture
  // matrix, review queue and report matrices. Legacy sub_labels (including raw
  // sub_label arrays) are never read here; an indicator without a config simply
  // has no disaggregation until one is defined in the Indicator Configuration UI.
  if (Array.isArray(input)) {
    return normalizeAggregateDisaggregationConfig(undefined);
  }

  return normalizeAggregateDisaggregationConfig(
    input?.aggregate_disaggregation_config ?? undefined,
  );
}

function isSexDimension(dimension: AggregateDisaggregationDimension): boolean {
  const key = normalizeDimensionToken(dimension.key);
  const label = normalizeDimensionToken(dimension.label);
  return key === "sex" || key === "gender" || label === "sex" || label === "gender";
}

function isAgeDimension(dimension: AggregateDisaggregationDimension): boolean {
  const key = normalizeDimensionToken(dimension.key);
  const label = normalizeDimensionToken(dimension.label);
  return (
    key === "age band" ||
    key === "age range" ||
    key === "age group" ||
    label === "age band" ||
    label === "age range" ||
    label === "age group"
  );
}

function getNormalizedDimensions(
  input?: string[] | IndicatorDisaggregationInput,
): AggregateDisaggregationDimension[] {
  const canonicalLabelByToken: Record<string, string> = {
    "alcohol use": "Alcohol Use",
    "tobacco use": "Tobacco Use",
  };

  const config = resolveDisaggregationConfig(input);
  return (config.dimensions || []).map((dimension) => ({
    key: String(dimension.key || "").trim(),
    label:
      canonicalLabelByToken[normalizeDimensionToken(dimension.key)] ||
      canonicalLabelByToken[normalizeDimensionToken(dimension.label)] ||
      String(dimension.label || "").trim(),
    values: normalizeDimensionValues(dimension.values),
  }));
}

function normalizeValueComparisonToken(value: string): string {
  return normalizeDimensionToken(value)
    .replace(/\bmessages?\b/g, "")
    .replace(/\bmssages\b/g, "")
    .replace(/\bmessage type\b/g, "")
    .replace(/\bprogram\b/g, "")
    .replace(/\bcircumference\b/g, " circumference ")
    .replace(/\bglucose\b/g, " glucose ")
    .replace(/\bpressure\b/g, " pressure ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSexValue(value: string): string {
  const normalized = normalizeDimensionToken(value);
  if (normalized === "m" || normalized === "male") return "Male";
  if (normalized === "f" || normalized === "female") return "Female";
  return value;
}

function buildDimensionAliasMap(expectedValues: string[]): Map<string, string> {
  const aliasMap = new Map<string, string>();

  expectedValues.forEach((expectedValue) => {
    const normalized = normalizeValueComparisonToken(expectedValue);
    if (normalized) aliasMap.set(normalized, expectedValue);
  });

  [
    ["m", "Male"],
    ["male", "Male"],
    ["f", "Female"],
    ["female", "Female"],
    ["gen pop", "GENERAL POP."],
    ["general pop", "GENERAL POP."],
    ["general population", "GENERAL POP."],
    ["blood pressure", "Blood Pressure"],
    ["bp", "Blood Pressure"],
    ["blood pressure messages", "Blood Pressure messages"],
    ["bp messages", "Blood Pressure messages"],
    ["blood glucose", "Blood Glucose"],
    ["blood glucose messages", "Blood glucose messages"],
    ["waist circumference", "Waist Circumference"],
    ["waist circumference messages", "Waist circumference messages"],
    ["tobacco control mssages", "Tobacco Control messages"],
  ].forEach(([alias, canonical]) => {
    if (!aliasMap.has(alias)) {
      aliasMap.set(alias, canonical);
    }
  });

  return aliasMap;
}

function canonicalizeDimensionValue(value: string, expectedValues: string[]): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return trimmed;

  const sexNormalized = normalizeSexValue(trimmed);
  if (sexNormalized !== trimmed && expectedValues.some((item) => normalizeDimensionToken(item) === normalizeDimensionToken(sexNormalized))) {
    return sexNormalized;
  }

  const aliasMap = buildDimensionAliasMap(expectedValues);
  const directMatch = aliasMap.get(normalizeValueComparisonToken(trimmed));
  if (directMatch) return directMatch;

  const normalizedInput = normalizeValueComparisonToken(trimmed);
  const fuzzyMatch = expectedValues.find((expectedValue) => {
    const normalizedExpected = normalizeValueComparisonToken(expectedValue);
    return (
      normalizedExpected === normalizedInput ||
      normalizedExpected.includes(normalizedInput) ||
      normalizedInput.includes(normalizedExpected)
    );
  });

  return fuzzyMatch || sexNormalized;
}

function getPrimaryDimension(
  input?: string[] | IndicatorDisaggregationInput,
): AggregateDisaggregationDimension | null {
  const dimensions = getNormalizedDimensions(input);
  return dimensions.find((dimension) => !isSexDimension(dimension) && !isAgeDimension(dimension)) || null;
}

export function toSafeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNumberInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDateAsUtc(value: string): Date | null {
  const trimmed = value.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) return null;
  const [yearRaw, monthRaw, dayRaw] = trimmed.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function isValidIsoDate(value?: string | null): boolean {
  if (!value) return false;
  return parseIsoDateAsUtc(value) !== null;
}

export function isValidDateRange(periodStart?: string | null, periodEnd?: string | null): boolean {
  if (!periodStart || !periodEnd) return false;
  if (!isValidIsoDate(periodStart) || !isValidIsoDate(periodEnd)) return false;
  return periodEnd >= periodStart;
}

export function formatDate(value?: string): string {
  if (!value) return "-";
  const isoDate = parseIsoDateAsUtc(value);
  if (isoDate) {
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(isoDate);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
}

export function getPeriodLabel(aggregate: Pick<Aggregate, "period_start" | "period_end">): string {
  return `${formatDate(aggregate.period_start)} - ${formatDate(aggregate.period_end)}`;
}

export function parseAggregateValue(value: unknown): AggregateValue {
  if (typeof value === "number") {
    return { total: value };
  }
  if (value && typeof value === "object") {
    return value as AggregateValue;
  }
  return {};
}

function coerceMatrixDisaggregates(source: unknown): MatrixDisaggregates | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;

  const matrix: MatrixDisaggregates = {};

  Object.entries(source as Record<string, unknown>).forEach(([firstLevel, rawSecondLevel]) => {
    if (isSheetTotalToken(firstLevel)) return;
    if (!rawSecondLevel || typeof rawSecondLevel !== "object" || Array.isArray(rawSecondLevel)) {
      return;
    }

    const secondLevelEntries: Record<string, Record<string, number | undefined>> = {};

    Object.entries(rawSecondLevel as Record<string, unknown>).forEach(([secondLevel, rawThirdLevel]) => {
      if (isSheetTotalToken(secondLevel)) return;
      if (rawThirdLevel && typeof rawThirdLevel === "object" && !Array.isArray(rawThirdLevel)) {
        const thirdLevelEntries: Record<string, number | undefined> = {};

        Object.entries(rawThirdLevel as Record<string, unknown>).forEach(([thirdLevel, rawValue]) => {
          if (isSheetTotalToken(thirdLevel)) return;
          thirdLevelEntries[thirdLevel] = toSafeNumber(rawValue);
        });

        if (Object.keys(thirdLevelEntries).length > 0) {
          secondLevelEntries[secondLevel] = thirdLevelEntries;
        }
        return;
      }

      secondLevelEntries[secondLevel] = {
        Value: toSafeNumber(rawThirdLevel),
      };
    });

    if (Object.keys(secondLevelEntries).length > 0) {
      matrix[firstLevel] = secondLevelEntries;
    }
  });

  return Object.keys(matrix).length > 0 ? matrix : null;
}

export function getDisaggregates(value: unknown): MatrixDisaggregates | null {
  const parsed = parseAggregateValue(value);
  const directDisaggregates = coerceMatrixDisaggregates(parsed.disaggregates);
  if (directDisaggregates) return directDisaggregates;

  return coerceMatrixDisaggregates(normalizeAggregateValueToDisaggregateMap(value));
}

export function getAggregateTotal(aggregate: Pick<Aggregate, "value">): number {
  const value = parseAggregateValue(aggregate.value);
  const total =
    value.total !== undefined && value.total !== null
      ? toSafeAggregateNumber(value.total)
      : undefined;
  if (total !== undefined && total > 0) return total;

  const male =
    value.male !== undefined && value.male !== null
      ? toSafeAggregateNumber(value.male)
      : undefined;
  const female =
    value.female !== undefined && value.female !== null
      ? toSafeAggregateNumber(value.female)
      : undefined;
  if (male !== undefined || female !== undefined) {
    return (male || 0) + (female || 0);
  }

  const disaggregateRows = getAggregateValueDisaggregateRows(aggregate.value);
  if (disaggregateRows.length > 0) {
    return disaggregateRows.reduce((sum, row) => sum + toSafeAggregateNumber(row.value), 0);
  }

  return 0;
}

export function calculateAggregateTotals(aggregates: Aggregate[]): {
  male: number;
  female: number;
  total: number;
} {
  return aggregates.reduce(
    (acc, aggregate) => {
      const value = parseAggregateValue(aggregate.value);
      acc.male += Number(value.male) || 0;
      acc.female += Number(value.female) || 0;
      acc.total += getAggregateTotal(aggregate);
      return acc;
    },
    { male: 0, female: 0, total: 0 },
  );
}

function buildAggregateRollupSliceKey(
  aggregate: Pick<Aggregate, "indicator" | "project" | "period_start" | "period_end">,
): string {
  return [
    String(aggregate.indicator || ""),
    String(aggregate.project || ""),
    String(aggregate.period_start || ""),
    String(aggregate.period_end || ""),
  ].join("|");
}

export function dedupeRollupAggregates<T extends Aggregate>(
  aggregates: T[],
  organizations: OrganizationWithParent[],
): T[] {
  if (aggregates.length < 2 || organizations.length === 0) {
    return aggregates;
  }

  const parentByOrganizationId = new Map<string, string>();
  organizations.forEach((organization) => {
    parentByOrganizationId.set(
      String(organization.id),
      resolveParentOrganizationId(organization),
    );
  });

  const organizationIdsBySliceKey = new Map<string, Set<string>>();
  aggregates.forEach((aggregate) => {
    const organizationId = String(aggregate.organization || "");
    if (!organizationId) return;

    const sliceKey = buildAggregateRollupSliceKey(aggregate);
    if (!organizationIdsBySliceKey.has(sliceKey)) {
      organizationIdsBySliceKey.set(sliceKey, new Set<string>());
    }
    organizationIdsBySliceKey.get(sliceKey)?.add(organizationId);
  });

  const rollupOrganizationIdsBySliceKey = new Map<string, Set<string>>();
  organizationIdsBySliceKey.forEach((organizationIdsInSlice, sliceKey) => {
    const rollupIds = new Set<string>();

    organizationIdsInSlice.forEach((organizationId) => {
      const visitedAncestors = new Set<string>();
      let ancestorId = parentByOrganizationId.get(organizationId) || "";

      while (ancestorId && !visitedAncestors.has(ancestorId)) {
        if (organizationIdsInSlice.has(ancestorId)) {
          rollupIds.add(ancestorId);
        }
        visitedAncestors.add(ancestorId);
        ancestorId = parentByOrganizationId.get(ancestorId) || "";
      }
    });

    rollupOrganizationIdsBySliceKey.set(sliceKey, rollupIds);
  });

  return aggregates.filter((aggregate) => {
    const organizationId = String(aggregate.organization || "");
    if (!organizationId) return true;

    const sliceKey = buildAggregateRollupSliceKey(aggregate);
    const rollupOrganizationIds = rollupOrganizationIdsBySliceKey.get(sliceKey);
    if (!rollupOrganizationIds || rollupOrganizationIds.size === 0) {
      return true;
    }

    return !rollupOrganizationIds.has(organizationId);
  });
}

export function buildChartData(
  aggregates: Aggregate[],
  indicatorNameById: Map<string, string>,
): Array<{ name: string; total: number }> {
  const totalsByIndicator = new Map<string, number>();
  for (const aggregate of aggregates) {
    const total = getAggregateTotal(aggregate);
    const indicatorName =
      aggregate.indicator_name ||
      indicatorNameById.get(String(aggregate.indicator)) ||
      "Indicator";
    totalsByIndicator.set(indicatorName, (totalsByIndicator.get(indicatorName) || 0) + total);
  }
  return Array.from(totalsByIndicator.entries()).map(([name, total]) => ({ name, total }));
}

export function sortWithPreferred(values: string[], preferred: readonly string[]): string[] {
  const preferredMap = new Map(preferred.map((value, index) => [value.toLowerCase(), index]));
  return [...values].sort((left, right) => {
    const leftRank = preferredMap.get(left.toLowerCase()) ?? Number.POSITIVE_INFINITY;
    const rightRank = preferredMap.get(right.toLowerCase()) ?? Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });
}

function getAgeBandSortKey(value: string): [number, number, string] {
  const trimmed = String(value || "").trim();
  const singleMatch = trimmed.match(/^(\d{1,2})$/);
  if (singleMatch) {
    const numeric = Number(singleMatch[1]);
    return [numeric, numeric, trimmed];
  }

  const rangeMatch = trimmed.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    return [start, end, trimmed];
  }

  const plusMatch = trimmed.match(/^(\d{1,2})\+$/);
  if (plusMatch) {
    const start = Number(plusMatch[1]);
    return [start, 999, trimmed];
  }

  return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, trimmed.toLowerCase()];
}

function normalizeAgeBandLabel(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return trimmed;

  const rangeMatch = trimmed.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (rangeMatch) {
    return `${Number(rangeMatch[1])}-${Number(rangeMatch[2])}`;
  }

  const plusMatch = trimmed.match(/^(\d{1,2})\s*\+$/);
  if (plusMatch) {
    return `${Number(plusMatch[1])}+`;
  }

  if (normalizeDimensionToken(trimmed) === "ayp 10 24") {
    return AYP_BAND_LABEL;
  }

  return trimmed;
}

function sortAgeBands(values: string[]): string[] {
  return [...values].sort((left, right) => {
    const [leftStart, leftEnd, leftText] = getAgeBandSortKey(left);
    const [rightStart, rightEnd, rightText] = getAgeBandSortKey(right);
    if (leftStart !== rightStart) return leftStart - rightStart;
    if (leftEnd !== rightEnd) return leftEnd - rightEnd;
    return leftText.localeCompare(rightText);
  });
}

export function getIndicatorDisaggregateGroups(
  input?: string[] | IndicatorDisaggregationInput,
): Set<string> {
  const groups = new Set<string>();
  const config = resolveDisaggregationConfig(input);
  const dimensions = getNormalizedDimensions(input);
  const nonSpecialDimensions = dimensions.filter(
    (dimension) => !isAgeDimension(dimension) && !isSexDimension(dimension),
  );

  if (!config.enabled || dimensions.length === 0) {
    // Config-only: an indicator with no enabled config has no disaggregate groups.
    return new Set<string>();
  }

  for (const dimension of dimensions) {
    const normalizedKey = normalizeDimensionToken(dimension.key);
    const normalizedLabel = normalizeDimensionToken(dimension.label);

    if (normalizedKey) groups.add(normalizedKey);
    if (normalizedLabel) groups.add(normalizedLabel);

    if (normalizedKey === "key population" || normalizedLabel === "key population") {
      groups.add("kp");
    }

    if (isSexDimension(dimension)) {
      groups.add("sex");
    }

    if (isAgeDimension(dimension)) {
      groups.add("age range");
    }
  }

  if (dimensions.some(isSexDimension) || nonSpecialDimensions.length > 1) {
    groups.add("secondary dimension");
  }

  return groups;
}

export function indicatorUsesMatrixEntry(input?: string[] | IndicatorDisaggregationInput): boolean {
  const groups = getIndicatorDisaggregateGroups(input);
  if (groups.size === 0) return true;
  const hasPrimaryGroup = Array.from(groups).some(
    (group) => group !== "sex" && group !== "age range" && group !== "secondary dimension",
  );
  return hasPrimaryGroup || groups.has("sex") || groups.has("age range");
}

export function getPrimaryDisaggregateLabel(
  input?: string[] | IndicatorDisaggregationInput,
): string {
  const primaryDimension = getPrimaryDimension(input);
  if (primaryDimension?.label) return primaryDimension.label;

  const groups = getIndicatorDisaggregateGroups(input);
  for (const key of primaryDisaggregateOrder) {
    if (groups.has(key)) return primaryDisaggregateLabelMap[key];
  }
  return "Disaggregate";
}

export function getPrimaryDisaggregateKey(
  input?: string[] | IndicatorDisaggregationInput,
): string | null {
  const primaryDimension = getPrimaryDimension(input);
  if (primaryDimension?.key) {
    const normalizedKey = normalizeDimensionToken(primaryDimension.key);
    return normalizedKey || null;
  }

  const groups = getIndicatorDisaggregateGroups(input);
  for (const key of primaryDisaggregateOrder) {
    if (groups.has(key)) return key;
  }
  return null;
}

export function getAggregateEntryMatrixConfig(
  input?: string[] | IndicatorDisaggregationInput,
): AggregateEntryMatrixConfig {
  const config = resolveDisaggregationConfig(input);
  const dimensions = getNormalizedDimensions(input);

  if (!config.enabled || dimensions.length === 0) {
    return {
      hasDisaggregates: false,
      primaryLabel: "Indicator",
      primaryValues: [],
      secondaryLabel: "Category",
      secondaryValues: [],
      bandLabel: "Value",
      bandValues: [],
    };
  }

  const ageDimension = dimensions.find(isAgeDimension) || null;
  const sexDimension = dimensions.find(isSexDimension) || null;
  const nonSpecialDimensions = dimensions.filter(
    (dimension) => !isAgeDimension(dimension) && !isSexDimension(dimension),
  );

  const primaryDimension = nonSpecialDimensions[0] || null;
  const secondaryDimension = sexDimension || nonSpecialDimensions[1] || null;
  const primaryKey = getPrimaryDisaggregateKey(input);

  const primaryValues = primaryDimension?.values?.length
    ? [...primaryDimension.values]
    : primaryKey
      ? [...(primaryDisaggregateValueMap[primaryKey] || ["All"])]
      : ["All"];

  const secondaryValues = secondaryDimension
    ? secondaryDimension.values.length > 0
      ? [...secondaryDimension.values]
      : isSexDimension(secondaryDimension)
        ? [...MATRIX_SEXES]
        : ["All"]
    : ["All"];

  const bandValues = ageDimension
    ? ageDimension.values.length > 0
      ? [...ageDimension.values]
      : [...AGE_RANGES]
    : ["Value"];

  return {
    hasDisaggregates: true,
    primaryLabel: primaryDimension?.label || "Category",
    primaryValues,
    secondaryLabel: secondaryDimension?.label || "Category",
    secondaryValues,
    bandLabel: ageDimension?.label || "Value",
    bandValues,
  };
}

export function normalizeMatrixDisaggregatesForIndicator(
  source: MatrixDisaggregates,
  input?: string[] | IndicatorDisaggregationInput,
): MatrixDisaggregates {
  const config = getAggregateEntryMatrixConfig(input);
  if (!config.hasDisaggregates) return source;
  const primaryDimension = getPrimaryDimension(input);
  const primaryDimensionToken = normalizeDimensionToken(
    primaryDimension?.key || primaryDimension?.label || "",
  );
  const observedPrimaryValues = Object.keys(source || {}).filter(
    (value) => String(value || "").trim().length > 0,
  );
  const useObservedPrimaryValues =
    primaryDimensionToken === "disaggregate" && observedPrimaryValues.length > 0;

  const normalized: MatrixDisaggregates = {};

  Object.entries(source).forEach(([rawPrimary, rawSecondaryMap]) => {
    const primaryValue = canonicalizeDimensionValue(rawPrimary, config.primaryValues);
    if (!primaryValue || isSheetTotalToken(primaryValue)) return;

    if (!normalized[primaryValue]) {
      normalized[primaryValue] = {};
    }

    Object.entries(rawSecondaryMap || {}).forEach(([rawSecondary, rawBandMap]) => {
      const secondaryValue = canonicalizeDimensionValue(rawSecondary, config.secondaryValues);
      if (!secondaryValue || isSheetTotalToken(secondaryValue)) return;

      if (!normalized[primaryValue][secondaryValue]) {
        normalized[primaryValue][secondaryValue] = {};
      }

      Object.entries(rawBandMap || {}).forEach(([rawBand, rawValue]) => {
        if (!rawBand || isSheetTotalToken(rawBand)) return;
        const bandValue = canonicalizeDimensionValue(rawBand, config.bandValues);
        normalized[primaryValue][secondaryValue][bandValue] =
          toSafeNumber(normalized[primaryValue][secondaryValue][bandValue]) + toSafeNumber(rawValue);
      });
    });
  });

  const seedPrimaryValues = useObservedPrimaryValues
    ? observedPrimaryValues
    : config.primaryValues.length > 0
      ? config.primaryValues
      : ["All"];
  const seedSecondaryValues = config.secondaryValues.length > 0 ? config.secondaryValues : ["All"];

  seedPrimaryValues.forEach((primaryValue) => {
    if (!normalized[primaryValue]) {
      normalized[primaryValue] = {};
    }

    seedSecondaryValues.forEach((secondaryValue) => {
      if (!normalized[primaryValue][secondaryValue]) {
        normalized[primaryValue][secondaryValue] = {};
      }

      if (config.bandValues.length === 0) {
        if (normalized[primaryValue][secondaryValue].Value === undefined) {
          normalized[primaryValue][secondaryValue].Value = 0;
        }
        return;
      }

      config.bandValues.forEach((bandValue) => {
        if (normalized[primaryValue][secondaryValue][bandValue] === undefined) {
          normalized[primaryValue][secondaryValue][bandValue] = 0;
        }
      });
    });
  });

  return normalized;
}

export function buildEmptyEntryMatrix(config: AggregateEntryMatrixConfig): MatrixInputValues {
  if (!config.hasDisaggregates) return {};

  const matrix: MatrixInputValues = {};
  for (const primaryValue of config.primaryValues) {
    matrix[primaryValue] = {};
    for (const secondaryValue of config.secondaryValues) {
      matrix[primaryValue][secondaryValue] = {};
      for (const bandValue of config.bandValues) {
        matrix[primaryValue][secondaryValue][bandValue] = "";
      }
    }
  }

  return matrix;
}

export function computeEntryMatrixTotal(
  matrixValues: MatrixInputValues,
  config: AggregateEntryMatrixConfig,
): number {
  if (!config.hasDisaggregates) return 0;

  let total = 0;
  for (const primaryValue of config.primaryValues) {
    for (const secondaryValue of config.secondaryValues) {
      for (const bandValue of config.bandValues) {
        const parsed = parseNumberInput(
          matrixValues[primaryValue]?.[secondaryValue]?.[bandValue] ?? "",
        );
        if (parsed !== undefined) total += parsed;
      }
    }
  }
  return total;
}

export function buildEntryMatrixPayload(
  matrixValues: MatrixInputValues,
  config: AggregateEntryMatrixConfig,
): MatrixDisaggregates {
  const payload: MatrixDisaggregates = {};

  for (const primaryValue of config.primaryValues) {
    payload[primaryValue] = {};
    for (const secondaryValue of config.secondaryValues) {
      payload[primaryValue][secondaryValue] = {};
      for (const bandValue of config.bandValues) {
        payload[primaryValue][secondaryValue][bandValue] = parseNumberInput(
          matrixValues[primaryValue]?.[secondaryValue]?.[bandValue] ?? "",
        );
      }
    }
  }

  return payload;
}

export function sumBands(
  values: Record<string, number | undefined>,
  bands: readonly string[],
): number {
  return bands.reduce((acc, band) => acc + toSafeNumber(values[band]), 0);
}

export function computeAyp(values: Record<string, number | undefined>): number {
  const explicit = toSafeNumber(values[AYP_BAND_LABEL]);
  if (explicit > 0) return explicit;
  return AYP_SOURCE_BANDS.reduce((sum, band) => sum + toSafeNumber(values[band]), 0);
}

export function getBandsForTotals(ageBands: readonly string[]): string[] {
  if (ageBands.length === 1 && ageBands[0] === "Value") return ["Value"];
  return ageBands.filter((band) => band !== AYP_BAND_LABEL);
}

export function buildDisplayMatrix(source: MatrixDisaggregates, groups: Set<string>): DisplayMatrixResult {
  const hasAgeGroupToken =
    groups.has("age range") || groups.has("age band") || groups.has("age group");
  const hasPrimaryGroup = Array.from(groups).some(
    (group) =>
      group !== "sex" &&
      group !== "age range" &&
      group !== "age band" &&
      group !== "age group" &&
      group !== "secondary dimension",
  );
  const includeKeyPopulation = groups.size === 0 || hasPrimaryGroup;
  const includeSecondDimension =
    groups.size === 0 || groups.has("sex") || groups.has("secondary dimension");
  const includeAge = groups.size === 0 || hasAgeGroupToken;
  const matrix: MatrixDisaggregates = {};

  const ensureBucket = (kp: string, dimension: string) => {
    if (!matrix[kp]) matrix[kp] = {};
    if (!matrix[kp][dimension]) matrix[kp][dimension] = {};
    return matrix[kp][dimension];
  };

  Object.entries(source).forEach(([rawKp, rawDimensions]) => {
    const targetKp = includeKeyPopulation ? rawKp : "All";
    const dimensionEntries = Object.entries(rawDimensions || {});
    if (dimensionEntries.length === 0) {
      const bucket = ensureBucket(targetKp, "All");
      if (!includeAge) {
        bucket.Value = toSafeNumber(bucket.Value);
      }
      return;
    }

    dimensionEntries.forEach(([rawDimension, rawBands]) => {
      const targetDimension = includeSecondDimension ? rawDimension : "All";
      const bucket = ensureBucket(targetKp, targetDimension);
      if (includeAge) {
        Object.entries(rawBands || {}).forEach(([band, value]) => {
          const normalizedBand = normalizeAgeBandLabel(band);
          if (!normalizedBand || isSheetTotalToken(normalizedBand)) return;
          bucket[normalizedBand] =
            toSafeNumber(bucket[normalizedBand]) + toSafeNumber(value);
        });
        return;
      }

      bucket.Value =
        toSafeNumber(bucket.Value) +
        Object.values(rawBands || {}).reduce((sum, value) => sum + toSafeNumber(value), 0);
    });
  });

  if (Object.keys(matrix).length === 0) {
    matrix.All = { All: includeAge ? {} : { Value: 0 } };
  }

  const keyPops = includeKeyPopulation
    ? sortWithPreferred(Object.keys(matrix), KEY_POPULATIONS)
    : ["All"];

  const secondDimensions = new Set<string>();
  const ageBandSet = new Set<string>();
  let hasAypFromData = false;

  keyPops.forEach((kp) => {
    const row = matrix[kp] || {};
    Object.keys(row).forEach((dimension) => {
      secondDimensions.add(dimension);
      Object.keys(row[dimension] || {}).forEach((band) => {
        if (band === AYP_BAND_LABEL) {
          hasAypFromData = true;
          return;
        }
        ageBandSet.add(band);
      });
    });
  });

  if (secondDimensions.size === 0) {
    secondDimensions.add("All");
  }

  const secondDimensionValues = includeSecondDimension
    ? sortWithPreferred(Array.from(secondDimensions), preferredSecondDimensionOrder)
    : ["All"];

  const hasAgeDefaults = hasAgeGroupToken && ageBandSet.size === 0;
  const ageBands = includeAge
    ? hasAgeDefaults
      ? [...AGE_RANGES]
      : sortAgeBands(Array.from(ageBandSet))
    : ["Value"];

  const showAypColumn =
    includeAge &&
    (hasAypFromData ||
      ageBands.some((band) => AYP_SOURCE_BANDS.includes(band as (typeof AYP_SOURCE_BANDS)[number])));

  return {
    matrix,
    keyPops,
    secondDimensionValues,
    ageBands,
    showAypColumn,
  };
}

export function mergeDisaggregatesForGroup(items: Aggregate[]): MatrixDisaggregates | null {
  const merged: MatrixDisaggregates = {};
  let hasDisaggregates = false;

  items.forEach((item) => {
    const disaggregates = getDisaggregates(item.value);
    if (!disaggregates) return;
    hasDisaggregates = true;

    Object.entries(disaggregates).forEach(([kp, dimensions]) => {
      if (!merged[kp]) merged[kp] = {};
      Object.entries(dimensions || {}).forEach(([dimension, bands]) => {
        if (!merged[kp][dimension]) merged[kp][dimension] = {};
        Object.entries(bands || {}).forEach(([band, value]) => {
          merged[kp][dimension][band] =
            toSafeNumber(merged[kp][dimension][band]) + toSafeNumber(value);
        });
      });
    });
  });

  return hasDisaggregates ? merged : null;
}

export function buildEmptyMatrix(): MatrixInputValues {
  const matrix: MatrixInputValues = {};
  for (const kp of KEY_POPULATIONS) {
    matrix[kp] = { Male: {}, Female: {} };
    for (const band of MATRIX_AGE_BANDS) {
      matrix[kp].Male[band] = "";
      matrix[kp].Female[band] = "";
    }
  }
  return matrix;
}

export function computeMatrixTotal(matrixValues: MatrixInputValues): number {
  let total = 0;
  for (const kp of KEY_POPULATIONS) {
    for (const sex of MATRIX_SEXES) {
      // AYP is derived/reporting and must not be counted into base totals.
      for (const band of AGE_RANGES) {
        const parsed = parseNumberInput(matrixValues[kp]?.[sex]?.[band] ?? "");
        if (parsed !== undefined) total += parsed;
      }
    }
  }
  return total;
}

export function buildMatrixPayload(matrixValues: MatrixInputValues): MatrixDisaggregates {
  const payload: MatrixDisaggregates = {};
  for (const kp of KEY_POPULATIONS) {
    payload[kp] = { Male: {}, Female: {} };
    for (const band of MATRIX_AGE_BANDS) {
      payload[kp].Male[band] = parseNumberInput(matrixValues[kp]?.Male?.[band] ?? "");
      payload[kp].Female[band] = parseNumberInput(matrixValues[kp]?.Female?.[band] ?? "");
    }
  }
  return payload;
}

function parseIndicatorCodeOrder(code?: string | null): { num: number; suffix: string } {
  if (!code) return { num: Number.POSITIVE_INFINITY, suffix: "" };

  const normalizedCode = String(code).trim();
  const nahpaMatch = normalizedCode.match(/NAHPA\d{4}-\d{2}-(\d+)([a-zA-Z]?)/i);
  if (nahpaMatch) {
    return {
      num: Number(nahpaMatch[1]),
      suffix: (nahpaMatch[2] || "").toLowerCase(),
    };
  }

  const genericMatch = normalizedCode.match(/(?:^|[^0-9])(\d+)([a-zA-Z]?)(?:$|[^0-9])/);
  if (!genericMatch) return { num: Number.POSITIVE_INFINITY, suffix: normalizedCode };
  return { num: Number(genericMatch[1]), suffix: (genericMatch[2] || "").toLowerCase() };
}

function normalizeAggregateIndicatorText(value?: string | null): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesAggregateIndicatorToken(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function resolveAggregateWorkbookTopicId(group: AggregateIndicatorGroup): string {
  const normalizedName = normalizeAggregateIndicatorText(group.indicatorName);

  if (
    includesAggregateIndicatorToken(normalizedName, [
      "hiv testing",
      "pep messages",
      "prep messages",
      "hiv treatment",
      "arv based prevention",
      "emtct",
      "family planning",
      "linked to care",
      "initiated on art",
      "tested positive for hiv",
      "referred for hiv testing",
      "referred for prep",
      "referred for pep",
      "assessed for prep eligibility",
      "assessed for pep eligibility",
      "hiv messages",
      "condom use messages",
      "teen and youth club",
      "ayplhiv",
    ])
  ) {
    return "hiv-prevention";
  }

  if (
    includesAggregateIndicatorToken(normalizedName, [
      "condoms distributed",
      "condom distributed",
      "lubricants distributed",
      "braille labelled condom",
      "brailed condom",
      "reported collecting condoms",
      "repeated collecting condoms",
      "collecting condoms for a repeated time",
      "non traditional sites",
    ])
  ) {
    return "commodity";
  }

  if (
    includesAggregateIndicatorToken(normalizedName, [
      "mental health",
      "psychoeducation",
      "counselling",
      "counseling",
      "psychosocial support",
      "disclosure and mental health",
      "trauma informed",
    ])
  ) {
    return "psychosocial";
  }

  if (
    includesAggregateIndicatorToken(normalizedName, [
      "human rights",
      "rights were violated",
      "sought redress",
      "redress",
      "legal aid",
      "justice services",
      "equality and human rights",
      "community led monitoring",
      "stigma",
    ])
  ) {
    return "human-rights";
  }

  if (includesAggregateIndicatorToken(normalizedName, ["gbv", "violence"])) {
    return "gbv";
  }

  if (
    includesAggregateIndicatorToken(normalizedName, [
      " sti ",
      "stis",
      "screened for stis",
      "screened positive for stis",
      "sti cases linked to care",
      "sti cases referrals completed",
      "tb referred",
      "tb testing referrals completed",
    ])
  ) {
    return "sti";
  }

  if (
    includesAggregateIndicatorToken(normalizedName, [
      " ncd ",
      "ncds",
      "cancer",
      "tobacco",
      "alcohol",
      "blood pressure",
      "blood glucose",
      "bmi",
      "waist circumference",
      "healthy lifestyle",
      "social media",
      "support group meetings",
      "new members continuing",
      "cessation program",
    ])
  ) {
    return "ncd";
  }

  if (
    includesAggregateIndicatorToken(normalizedName, [
      "attended",
      "commemoration activities",
      "day activities",
      "campaigns conducted",
      "community youth dialogues",
      "health campaigns",
      "youth forums",
      "success stories",
    ])
  ) {
    return "events";
  }

  if (
    includesAggregateIndicatorToken(normalizedName, [
      "service providers receiving training",
      "sub recipients mentored",
      "sub recipient mentored",
      "csos trained and equipped",
      "sub recipients submitting quality reports",
      "sub recipients submitting quality report",
      "support groups mentored for sustainability",
      "advocacy activities conducted",
      "media platforms used per quarter",
      "target specific demand creation activities conducted",
      "media engagements conducted",
    ])
  ) {
    return "capacity";
  }

  return "other";
}

function parseWorkbookIndexToken(token?: string | null): { num: number; suffix: string } {
  if (!token) return { num: Number.POSITIVE_INFINITY, suffix: "" };
  const match = String(token).trim().match(/^(\d+)([a-zA-Z]?)$/);
  if (!match) return { num: Number.POSITIVE_INFINITY, suffix: String(token).toLowerCase() };
  return {
    num: Number(match[1]),
    suffix: (match[2] || "").toLowerCase(),
  };
}

function extractWorkbookIndexFromNotes(notes?: string | null): string {
  if (!notes) return "";
  const match = String(notes).match(/\b(?:index|code)\s*=\s*([0-9]+[a-zA-Z]?)\b/i);
  return match?.[1] || "";
}

function resolveAggregateGroupWorkbookIndex(group: AggregateIndicatorGroup): { num: number; suffix: string } {
  const codeOrder = parseIndicatorCodeOrder(group.code);
  if (Number.isFinite(codeOrder.num)) return codeOrder;

  const noteTokenCounts = new Map<string, number>();
  group.items.forEach((item) => {
    const token = extractWorkbookIndexFromNotes(item.notes);
    if (!token) return;
    noteTokenCounts.set(token, (noteTokenCounts.get(token) || 0) + 1);
  });

  const topToken = [...noteTokenCounts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      const leftOrder = parseWorkbookIndexToken(left[0]);
      const rightOrder = parseWorkbookIndexToken(right[0]);
      if (leftOrder.num !== rightOrder.num) return leftOrder.num - rightOrder.num;
      return leftOrder.suffix.localeCompare(rightOrder.suffix);
    })[0]?.[0];

  return parseWorkbookIndexToken(topToken);
}

function compareAggregateIndicatorGroups(
  left: AggregateIndicatorGroup,
  right: AggregateIndicatorGroup,
): number {
  const topicRankById = new Map(
    AGGREGATE_WORKBOOK_TOPIC_DEFINITIONS.map((topic, index) => [topic.id, index]),
  );
  const leftTopicRank =
    topicRankById.get(resolveAggregateWorkbookTopicId(left)) ?? Number.POSITIVE_INFINITY;
  const rightTopicRank =
    topicRankById.get(resolveAggregateWorkbookTopicId(right)) ?? Number.POSITIVE_INFINITY;
  if (leftTopicRank !== rightTopicRank) return leftTopicRank - rightTopicRank;

  const leftIndex = resolveAggregateGroupWorkbookIndex(left);
  const rightIndex = resolveAggregateGroupWorkbookIndex(right);
  if (leftIndex.num !== rightIndex.num) return leftIndex.num - rightIndex.num;
  if (leftIndex.suffix !== rightIndex.suffix) {
    return leftIndex.suffix.localeCompare(rightIndex.suffix);
  }

  return left.indicatorName.localeCompare(right.indicatorName);
}

export function sortAggregateIndicatorGroupsByWorkbookFlow(
  groups: AggregateIndicatorGroup[],
): AggregateIndicatorGroup[] {
  return [...groups].sort(compareAggregateIndicatorGroups);
}

export function buildAggregateWorkbookTopicSections(
  groups: AggregateIndicatorGroup[],
): AggregateWorkbookTopicSection[] {
  const groupedByTopic = new Map<string, AggregateIndicatorGroup[]>();

  sortAggregateIndicatorGroupsByWorkbookFlow(groups).forEach((group) => {
    const topicId = resolveAggregateWorkbookTopicId(group);
    if (!groupedByTopic.has(topicId)) {
      groupedByTopic.set(topicId, []);
    }
    groupedByTopic.get(topicId)?.push(group);
  });

  return AGGREGATE_WORKBOOK_TOPIC_DEFINITIONS
    .filter((topic) => (groupedByTopic.get(topic.id)?.length || 0) > 0)
    .map((topic) => {
      const topicGroups = groupedByTopic.get(topic.id) || [];
      return {
        ...topic,
        groups: topicGroups,
        totalValue: topicGroups.reduce(
          (sum, group) =>
            sum + group.items.reduce((groupSum, item) => groupSum + getAggregateTotal(item), 0),
          0,
        ),
      };
    });
}

export function groupAggregatesByIndicator(
  aggregates: Aggregate[],
  indicatorNameById: Map<string, string>,
  indicatorCodeById: Map<string, string>,
): AggregateIndicatorGroup[] {
  const groups = new Map<string, Aggregate[]>();

  for (const aggregate of aggregates) {
    const indicatorId = String(aggregate.indicator || "");
    const indicatorName =
      aggregate.indicator_name || indicatorNameById.get(indicatorId) || "Indicator";
    const key = indicatorId || indicatorName;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(aggregate);
  }

  const entries = Array.from(groups.entries()).map(([key, items]) => {
    const first = items[0];
    const indicatorId = String(first?.indicator || key);
    const indicatorName =
      first?.indicator_name || indicatorNameById.get(indicatorId) || "Indicator";
    const code = first?.indicator_code || indicatorCodeById.get(indicatorId) || "";
    return { key, indicatorId, indicatorName, code, items };
  });

  return sortAggregateIndicatorGroupsByWorkbookFlow(entries);
}

export function resolveParentOrganizationId(org: OrganizationWithParent): string {
  const rawParent = org.parentId ?? org.parent ?? null;
  if (rawParent === null || rawParent === undefined) return "";

  const normalized = String(rawParent).trim().toLowerCase();
  if (
    normalized === "" ||
    normalized === "null" ||
    normalized === "none" ||
    normalized === "undefined" ||
    normalized === "0"
  ) {
    return "";
  }

  return String(rawParent);
}
