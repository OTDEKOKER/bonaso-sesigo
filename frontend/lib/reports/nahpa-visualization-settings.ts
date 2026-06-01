export type NahpaPeriodMode = "date-range" | "month" | "quarter" | "year";

export type PeriodSettings = {
  mode: NahpaPeriodMode;
  selectedPeriods: string[];
};

export type OrganizationSettings = {
  organizationId: string | "all";
  includeSubGrantees: boolean;
  selectedSubGrantees?: string[];
};

export type IndicatorSettings = {
  indicatorGroup: string;
  indicators?: string[];
  groupBy: "category" | "indicator";
};

export type KnownNahpaDisaggregateDimension =
  | "sex"
  | "age_group"
  | "kvp"
  | "district"
  | "service_category";

export type NahpaDisaggregateDimension =
  | KnownNahpaDisaggregateDimension
  | (string & {});

export type DisaggregateSettings = {
  enabled: boolean;
  dimensions: NahpaDisaggregateDimension[];
  layout: "list" | "matrix";
};

export type ComparisonSettings = {
  enabled: boolean;
  compareBy: "period" | "organization";
};

export type TargetSettings = {
  showTargets: boolean;
  showAchievement: boolean;
  showPerformancePercent: boolean;
};

export type DisplaySettings = {
  chartType: "clustered-bar" | "grouped-bar";
  showTable: true;
  showLegend: boolean;
  yAxisLabel: "No. of People";
};

export type NahpaVisualizationSettings = {
  period: PeriodSettings;
  organization: OrganizationSettings;
  indicator: IndicatorSettings;
  disaggregate: DisaggregateSettings;
  comparison: ComparisonSettings;
  targets: TargetSettings;
  display: DisplaySettings;
};

export type NahpaCategoryConfig = {
  id: string;
  label: string;
  color: string;
  aliases: string[];
};

export const NAHPA_DISAGGREGATE_DIMENSION_OPTIONS: Array<{
  value: NahpaDisaggregateDimension;
  label: string;
}> = [
  { value: "sex", label: "Sex" },
  { value: "age_group", label: "Age group" },
  { value: "kvp", label: "Key population (KVP)" },
  { value: "district", label: "District" },
  { value: "service_category", label: "Service category" },
];

export const NAHPA_INDICATOR_GROUP_OPTIONS: Array<{
  value: string;
  label: string;
  aliases: string[];
}> = [
  {
    value: "ncd_prevention",
    label: "NCD Prevention",
    aliases: ["ncd", "non communicable", "cancer", "mental health"],
  },
  {
    value: "hiv_prevention_messages",
    label: "HIV Prevention Messages",
    aliases: ["hiv", "pep", "prep", "condom", "emtct", "gbv", "arv based prevention", "messages"],
  },
  {
    value: "testing_services",
    label: "Testing Services",
    aliases: ["testing", "tested", "screened", "counselling", "counseling"],
  },
  {
    value: "linkage_referrals",
    label: "Linkage & Referrals",
    aliases: ["referral", "referred", "linkage", "linked"],
  },
];

export const NAHPA_SUMMARY_SECTION_CONFIG: NahpaCategoryConfig[] = [
  {
    id: "summary_ncd",
    label: "NCD Prevention",
    color: "#1f6a8a",
    aliases: ["ncd", "non communicable", "cancer", "mental health"],
  },
  {
    id: "summary_hiv",
    label: "HIV Prevention Messages",
    color: "#9c2f92",
    aliases: ["hiv", "pep", "prep", "condom", "emtct", "gbv", "arv based prevention", "messages"],
  },
  {
    id: "summary_testing",
    label: "Testing Services",
    color: "#2e8b57",
    aliases: ["testing", "tested", "screened", "counselling", "counseling"],
  },
  {
    id: "summary_referrals",
    label: "Linkage & Referrals",
    color: "#b55a18",
    aliases: ["referral", "referred", "linkage", "linked"],
  },
];

export const NAHPA_TESTING_SERVICES_CONFIG: NahpaCategoryConfig[] = [
  {
    id: "testing_hiv",
    label: "HIV Testing Services",
    color: "#1f6a8a",
    aliases: ["hiv testing", "hiv test", "tested for hiv"],
  },
  {
    id: "testing_ncd",
    label: "NCD Screening Services",
    color: "#2e8b57",
    aliases: ["ncds risk factors", "ncd risk factors", "screened for ncd", "cancer screening", "mental health"],
  },
  {
    id: "testing_counselling",
    label: "Counselling Sessions",
    color: "#9c2f92",
    aliases: ["counselling sessions", "counseling sessions"],
  },
  {
    id: "testing_referrals",
    label: "Referral & Linkage Services",
    color: "#b55a18",
    aliases: ["referral", "referred", "linkage", "linked"],
  },
];

export const DEFAULT_NAHPA_VISUALIZATION_SETTINGS: NahpaVisualizationSettings = {
  period: {
    mode: "quarter",
    selectedPeriods: [],
  },
  organization: {
    organizationId: "all",
    includeSubGrantees: true,
    selectedSubGrantees: [],
  },
  indicator: {
    indicatorGroup: "ncd_prevention",
    indicators: [],
    groupBy: "category",
  },
  disaggregate: {
    enabled: true,
    dimensions: ["sex", "age_group"],
    layout: "matrix",
  },
  comparison: {
    enabled: true,
    compareBy: "period",
  },
  targets: {
    showTargets: true,
    showAchievement: true,
    showPerformancePercent: true,
  },
  display: {
    chartType: "clustered-bar",
    showTable: true,
    showLegend: true,
    yAxisLabel: "No. of People",
  },
};

export function createDefaultNahpaVisualizationSettings(): NahpaVisualizationSettings {
  return {
    ...DEFAULT_NAHPA_VISUALIZATION_SETTINGS,
    period: { ...DEFAULT_NAHPA_VISUALIZATION_SETTINGS.period },
    organization: { ...DEFAULT_NAHPA_VISUALIZATION_SETTINGS.organization },
    indicator: { ...DEFAULT_NAHPA_VISUALIZATION_SETTINGS.indicator },
    disaggregate: { ...DEFAULT_NAHPA_VISUALIZATION_SETTINGS.disaggregate },
    comparison: { ...DEFAULT_NAHPA_VISUALIZATION_SETTINGS.comparison },
    targets: { ...DEFAULT_NAHPA_VISUALIZATION_SETTINGS.targets },
    display: { ...DEFAULT_NAHPA_VISUALIZATION_SETTINGS.display },
  };
}

export function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function normalizeSelectedPeriods(selected: string[], available: string[]) {
  if (available.length === 0) return [] as string[];
  const availableSet = new Set(available);
  const filtered = selected.filter((periodLabel) => availableSet.has(periodLabel));
  if (filtered.length > 0) return filtered;
  return [available[available.length - 1]];
}

export function areNahpaSettingsEqual(
  left: NahpaVisualizationSettings,
  right: NahpaVisualizationSettings,
) {
  return (
    left.period.mode === right.period.mode &&
    arraysEqual(left.period.selectedPeriods, right.period.selectedPeriods) &&
    left.organization.organizationId === right.organization.organizationId &&
    left.organization.includeSubGrantees === right.organization.includeSubGrantees &&
    arraysEqual(
      left.organization.selectedSubGrantees || [],
      right.organization.selectedSubGrantees || [],
    ) &&
    left.indicator.indicatorGroup === right.indicator.indicatorGroup &&
    left.indicator.groupBy === right.indicator.groupBy &&
    arraysEqual(left.indicator.indicators || [], right.indicator.indicators || []) &&
    left.disaggregate.enabled === right.disaggregate.enabled &&
    left.disaggregate.layout === right.disaggregate.layout &&
    arraysEqual(left.disaggregate.dimensions, right.disaggregate.dimensions) &&
    left.comparison.enabled === right.comparison.enabled &&
    left.comparison.compareBy === right.comparison.compareBy &&
    left.targets.showTargets === right.targets.showTargets &&
    left.targets.showAchievement === right.targets.showAchievement &&
    left.targets.showPerformancePercent === right.targets.showPerformancePercent &&
    left.display.chartType === right.display.chartType &&
    left.display.showLegend === right.display.showLegend &&
    left.display.showTable === right.display.showTable &&
    left.display.yAxisLabel === right.display.yAxisLabel
  );
}
