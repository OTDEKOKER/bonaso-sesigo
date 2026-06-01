import type { Indicator } from "@/lib/types";
import {
  normalizeAggregateDisaggregationConfig,
  type AggregateDisaggregationConfig,
  type AggregateDisaggregationDimension,
} from "@/lib/indicators/disaggregation-presets";

export type DisaggregationComparisonMode = "disaggregation";
export type LegacyDisaggregationComparisonMode = "disaggregate";

export const DEFAULT_UNKNOWN_DISAGGREGATION_LABEL = "Unknown";

const UNKNOWN_VALUE_ALIASES = new Set(
  [
    "unknown",
    "not reported",
    "not applicable",
    "unspecified",
    "n/a",
    "na",
    "-",
    "",
  ].map((value) => value.toLowerCase()),
);

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function compareAgeBandValues(left: string, right: string) {
  const parse = (value: string) => {
    const normalized = normalizeText(value).replace(/\s+/g, "");
    if (normalized.includes("+")) {
      const start = Number(normalized.replace("+", ""));
      return Number.isFinite(start) ? { start, end: Number.MAX_SAFE_INTEGER } : null;
    }
    const match = normalized.match(/^(\d{1,3})[-to]+(\d{1,3})$/i);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  };

  const leftRange = parse(left);
  const rightRange = parse(right);
  if (leftRange && rightRange) {
    if (leftRange.start !== rightRange.start) return leftRange.start - rightRange.start;
    if (leftRange.end !== rightRange.end) return leftRange.end - rightRange.end;
    return 0;
  }
  if (leftRange) return -1;
  if (rightRange) return 1;
  return left.localeCompare(right);
}

const SEX_ORDER = ["male", "female", "other", "unknown"];
const KEY_POPULATION_ORDER = [
  "general pop.",
  "general population",
  "fsw",
  "msm",
  "pwid",
  "pwid/pwids",
  "pwd",
  "lgbtqi+",
  "unknown",
];

const ORDERED_DIMENSION_VALUES: Record<string, string[]> = {
  sex: SEX_ORDER,
  age_band: [],
  age_range: [],
  key_population: KEY_POPULATION_ORDER,
};

export function isDisaggregationComparisonMode(mode: string | null | undefined): boolean {
  const normalized = normalizeText(mode || "");
  return normalized === "disaggregate" || normalized === "disaggregation";
}

export function normalizeAnalyticsComparisonMode<T extends string>(mode: T): T | DisaggregationComparisonMode {
  if (isDisaggregationComparisonMode(mode)) return "disaggregation";
  return mode;
}

export function normalizeDisaggregationValue(value: unknown) {
  if (value === null || value === undefined) return DEFAULT_UNKNOWN_DISAGGREGATION_LABEL;
  const asString = String(value).trim();
  if (!asString) return DEFAULT_UNKNOWN_DISAGGREGATION_LABEL;
  if (UNKNOWN_VALUE_ALIASES.has(asString.toLowerCase())) {
    return DEFAULT_UNKNOWN_DISAGGREGATION_LABEL;
  }
  return asString;
}

export function isUnknownDisaggregationValue(value: unknown) {
  return normalizeDisaggregationValue(value) === DEFAULT_UNKNOWN_DISAGGREGATION_LABEL;
}

export function sortDisaggregationValues(
  key: string,
  values: string[],
  includeUnknown = true,
) {
  const normalizedKey = slugify(key);
  const deduped = Array.from(
    new Set(values.map((value) => normalizeDisaggregationValue(value))),
  );
  const filtered = includeUnknown
    ? deduped
    : deduped.filter((value) => !isUnknownDisaggregationValue(value));

  if (normalizedKey === "age_band" || normalizedKey === "age_range") {
    return [...filtered].sort(compareAgeBandValues);
  }

  const configuredOrder = ORDERED_DIMENSION_VALUES[normalizedKey] || [];
  const configuredRanks = new Map(
    configuredOrder.map((value, index) => [normalizeText(value), index]),
  );

  return [...filtered].sort((left, right) => {
    const leftIsUnknown = isUnknownDisaggregationValue(left);
    const rightIsUnknown = isUnknownDisaggregationValue(right);
    if (leftIsUnknown !== rightIsUnknown) return leftIsUnknown ? 1 : -1;

    const leftRank = configuredRanks.get(normalizeText(left));
    const rightRank = configuredRanks.get(normalizeText(right));
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });
}

function normalizeDimension(
  dimension: AggregateDisaggregationDimension | null | undefined,
) {
  if (!dimension) return null;
  const key = String(dimension.key || "").trim();
  if (!key) return null;
  return {
    key,
    label: String(dimension.label || key).trim() || key,
    values: Array.isArray(dimension.values)
      ? dimension.values.map((value) => normalizeDisaggregationValue(value)).filter(Boolean)
      : [],
  };
}

export function getIndicatorDisaggregationConfig(
  indicator: Indicator | null | undefined,
): AggregateDisaggregationConfig | null {
  if (!indicator) return null;
  const normalized = normalizeAggregateDisaggregationConfig(
    indicator.aggregate_disaggregation_config || null,
    indicator.sub_labels || [],
  );
  if (!normalized.enabled || normalized.dimensions.length === 0) return null;
  return normalized;
}

export function getSupportedDisaggregationDimensions(indicator: Indicator | null | undefined) {
  const config = getIndicatorDisaggregationConfig(indicator);
  if (!config) return [];
  return config.dimensions
    .map((dimension) => normalizeDimension(dimension))
    .filter((dimension): dimension is NonNullable<typeof dimension> => Boolean(dimension));
}

export function getSupportedDisaggregationKeys(indicator: Indicator | null | undefined) {
  return getSupportedDisaggregationDimensions(indicator).map((dimension) => dimension.key);
}

export function getDisaggregationLabel(
  key: string,
  indicators?: Indicator[] | null,
) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return "";
  const fromIndicators = (indicators || [])
    .flatMap((indicator) => getSupportedDisaggregationDimensions(indicator))
    .find((dimension) => normalizeText(dimension.key) === normalizeText(normalizedKey));
  if (fromIndicators?.label) return fromIndicators.label;
  return normalizedKey
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function getSharedDisaggregationKeys(indicators: Indicator[]) {
  const validIndicators = indicators.filter(Boolean);
  if (validIndicators.length === 0) return [];

  const keySets = validIndicators.map((indicator) => new Set(getSupportedDisaggregationKeys(indicator)));
  const [firstSet, ...remaining] = keySets;
  return Array.from(firstSet).filter((key) => remaining.every((set) => set.has(key)));
}

export function getUnionDisaggregationKeys(indicators: Indicator[]) {
  return Array.from(
    new Set(
      indicators.flatMap((indicator) => getSupportedDisaggregationKeys(indicator)),
    ),
  );
}

export function getDisaggregationValueOptionsByKey(
  input: {
    indicators: Indicator[];
    dataValuesByKey?: Record<string, string[]>;
    keys?: string[];
    includeUnknown?: boolean;
  },
) {
  const {
    indicators,
    dataValuesByKey = {},
    keys,
    includeUnknown = true,
  } = input;
  const sourceKeys = keys && keys.length > 0 ? keys : getUnionDisaggregationKeys(indicators);

  const valuesByKey = new Map<string, Set<string>>();
  sourceKeys.forEach((key) => valuesByKey.set(key, new Set<string>()));

  indicators.forEach((indicator) => {
    getSupportedDisaggregationDimensions(indicator).forEach((dimension) => {
      if (!valuesByKey.has(dimension.key)) return;
      const bucket = valuesByKey.get(dimension.key)!;
      dimension.values.forEach((value) => bucket.add(normalizeDisaggregationValue(value)));
    });
  });

  Object.entries(dataValuesByKey).forEach(([key, values]) => {
    if (!valuesByKey.has(key)) valuesByKey.set(key, new Set<string>());
    const bucket = valuesByKey.get(key)!;
    values.forEach((value) => bucket.add(normalizeDisaggregationValue(value)));
  });

  return Object.fromEntries(
    Array.from(valuesByKey.entries()).map(([key, values]) => [
      key,
      sortDisaggregationValues(key, Array.from(values), includeUnknown).map((value) => ({
        value,
        label: value,
      })),
    ]),
  );
}
