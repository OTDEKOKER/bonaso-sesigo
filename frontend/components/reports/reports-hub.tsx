"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FileText,
  Download,
  Calendar,
  Filter,
  BarChart3,
  PieChart,
  TrendingUp,
  Users,
  Target,
  Clock,
  CheckCircle2,
  FileSpreadsheet,
  Printer,
  Loader2,
  Plus,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { OrganizationMultiSelect } from "@/components/shared/organization-multi-select";
import { NcdMessageTypeChart } from "@/components/reports/ncd-message-type-chart";
import { HivMessageTypeChart } from "@/components/reports/hiv-message-type-chart";
import { ReportBarChart } from "@/components/reports/report-bar-chart";
import { ReportTargetChart } from "@/components/reports/report-target-chart";
import { ReportDisaggregateTable } from "@/components/reports/report-disaggregate-table";
import { ReportDisaggregateMatrix } from "@/components/reports/report-disaggregate-matrix";
import { ReportNestedDisaggregateMatrix } from "@/components/reports/report-nested-disaggregate-matrix";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
} from "recharts";
import {
  reportsService,
} from "@/lib/api";
import type { Report } from "@/lib/api";
import type { Indicator } from "@/lib/types";
import { formatDate } from "@/lib/date-utils";
import { getIndicatorChartLabel, getIndicatorDisplayName } from "@/lib/indicators/display-name";
import { normalizeOrganizationType } from "@/lib/organization-hierarchy";
import {
  compareMonthLabels,
  compareQuarterLabels,
  compareYearLabels,
  getAggregatePeriodLabel,
  type AggregatePeriodMode,
} from "@/lib/aggregates/quarter-buckets";
import { normalizeAggregateDisaggregationConfig } from "@/lib/indicators/disaggregation-presets";
import { mergeDisaggregatesForGroup } from "@/lib/aggregates/aggregate-helpers";
import {
  NAHPA_DISAGGREGATE_DIMENSION_OPTIONS,
  NAHPA_INDICATOR_GROUP_OPTIONS,
  NAHPA_SUMMARY_SECTION_CONFIG,
  NAHPA_TESTING_SERVICES_CONFIG,
  areNahpaSettingsEqual,
  arraysEqual,
  createDefaultNahpaVisualizationSettings,
  normalizeSelectedPeriods,
  type NahpaDisaggregateDimension,
  type NahpaVisualizationSettings,
} from "@/lib/reports/nahpa-visualization-settings";
import {
  buildCategoryRowsFromAggregates,
  buildIndicatorRowsFromAggregates,
  indicatorNameMatchesAliases,
} from "@/lib/reports/nahpa-report-transformers";
import { ReportViewerDialog } from "@/components/shared/report-viewer";
import { ReportBuilderDialog } from "@/components/reports/report-builder-dialog";
import {
  useDashboardStats,
  useAllIndicators,
  useAllOrganizations,
  useAllAggregates,
  useProjects,
  useReports,
  useRespondentStats,
  useScheduledReports,
} from "@/lib/hooks/use-api";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  pending: "bg-warning/20 text-warning border-warning/30",
  processing: "bg-info/20 text-info border-info/30",
  completed: "bg-success/20 text-success border-success/30",
  failed: "bg-destructive/20 text-destructive border-destructive/30",
};

const categoryColors: Record<string, string> = {
  hiv_prevention: "hsl(var(--chart-1))",
  ncd: "hsl(var(--chart-3))",
  mental_health: "#0ea5e9",
  gbv: "#e11d48",
  sti: "#f59e0b",
  trainings: "#10b981",
  media: "#06b6d4",
  events: "hsl(var(--chart-4))",
};

const categoryLabels: Record<string, string> = {
  hiv_prevention: "HIV Prevention",
  ncd: "Non-Communicable Diseases",
  mental_health: "Mental Health",
  gbv: "GBV",
  sti: "STI",
  trainings: "Trainings",
  media: "Media",
  events: "Events",
};

const reportChartPalette = [
  "#1CE783",
  "#0EA5E9",
  "#F97316",
  "#A855F7",
  "#EF4444",
  "#14B8A6",
];

const NAHPA_QUERY_KEYS = [
  "project",
  "pm",
  "period",
  "org",
  "incSubs",
  "sub",
  "ig",
  "gb",
  "dis",
  "dd",
  "dl",
  "cmp",
  "cb",
  "st",
  "sa",
  "spp",
  "ct",
  "lg",
  "rf",
  "rt",
  "di",
];

const parseBoolParam = (rawValue: string | null, fallback: boolean) => {
  if (rawValue === null) return fallback;
  return rawValue === "1" || rawValue.toLowerCase() === "true";
};

const downloadChartSvg = (containerId: string, filename: string) => {
  const container = document.getElementById(containerId);
  if (!container) return;
  const svg = container.querySelector("svg");
  if (!svg) return;

  const cloned = svg.cloneNode(true) as SVGSVGElement;
  if (!cloned.getAttribute("xmlns")) {
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(cloned);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".svg") ? filename : `${filename}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const SOCIAL_CONTRACTING_INDICATORS = [
  "Total Number of people Reached with HIV TESTING Messages",
  "Total Number of People Reached with PEP Messages",
  "Total Number of people Reached with PREP Messages",
  "Total Number of People Reached with Condom Use Messages",
  "Total Number of People Reached with HIV Treatment Messages",
  "Total Number of People Reached with ARV Based Prevention Messages",
  "Total Number of People Reached with EMTCT Messages",
  "Total Number of People Reached with GBV Messages",
];

const SOCIAL_CONTRACTING_EVENTS = [
  "Number of service providers receiving training",
  "Number of media platforms used per quarter",
  "Number of media engagements conducted",
  "Number of stigma reduction campaigns conducted during the project",
  "Number of target specific demand creation activities conducted",
  "Number of advocacy activities conducted per quarter",
  "Number of community led monitoring conducted for quality of service and human rights",
];

const SOCIAL_CONTRACTING_NCD = [
  "Total number of people reached with NCD prevention and Control messages",
  "Number of people engaged with NCD prevention and control messages through social media",
  "Number of people screened for NCDs behavioural risk factors",
  "Number of people screened for NCDs risk factors",
  "Number of people screened for breast cancer",
  "Number of people screened for prostate cancer",
  "Number of people screened for mental health",
  "Number of people reached with self-breast cancer examination education",
  "Number of people reached with prostate cancer education",
  "Number of people reached with cervical cancer education",
];

const FOCUSED_GROUP_COLORS: Record<string, string> = {
  ncd_prevention: "#1f6a8a",
  hiv_prevention_messages: "#9c2f92",
  testing_services: "#2e8b57",
  linkage_referrals: "#b55a18",
};

const normalizeName = (value: string) => value.trim().toLowerCase();

const extractAggregateTotal = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.total !== undefined) {
      const total = Number(record.total);
      return Number.isNaN(total) ? 0 : total;
    }
    const male = Number(record.male ?? 0);
    const female = Number(record.female ?? 0);
    const sum = male + female;
    return Number.isNaN(sum) ? 0 : sum;
  }
  return 0;
};

type DisaggregateEntry = Record<string, unknown>;
type DisaggregateSecondaryMap = Record<string, DisaggregateEntry | number | string | null | undefined>;
type DisaggregateCategoryMap = Record<string, DisaggregateSecondaryMap>;
type DisaggregateRecord = {
  dimensions: Record<string, string>;
  value: number;
};
type IndicatorDisaggregateDimensionConfig = {
  key: NahpaDisaggregateDimension;
  label: string;
  values: string[];
};
type IndicatorDisaggregateProfile = {
  hasDisaggregates: boolean;
  state: "none" | "single" | "multi";
  defaultLayout: "list" | "matrix";
  dimensions: IndicatorDisaggregateDimensionConfig[];
};

const toSafeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
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
  const preferred = ["TOTAL", "Total", "total", "Value", "value"];
  for (const key of preferred) {
    if (key in entry) {
      const value = toSafeNumber(entry[key]);
      if (value > 0 || entry[key] === 0 || entry[key] === "0") return value;
    }
  }

  let sum = 0;
  Object.entries(entry).forEach(([key, raw]) => {
    const normalized = normalizeName(key);
    if (normalized.includes("ayp")) return;
    sum += toSafeNumber(raw);
  });
  return sum;
};

const AGE_KEY_PATTERN = /(\d+\s*-\s*\d+|\d+\+|\d+\s*to\s*\d+)/i;
const AGE_RANGE_ORDER = [
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
  "all ages",
  "all",
];
const SEX_ORDER = ["female", "male", "other", "unknown", "all"];
const DIMENSION_KEY_ALIASES: Array<{ aliases: string[]; key: NahpaDisaggregateDimension; label: string }> = [
  { aliases: ["sex", "gender"], key: "sex", label: "Sex" },
  { aliases: ["age", "age group", "age range", "age band"], key: "age_group", label: "Age Group" },
  { aliases: ["kvp", "kp", "key population", "key_pop", "key population type"], key: "kvp", label: "Key Population (KVP)" },
  { aliases: ["district", "location", "site"], key: "district", label: "District" },
  { aliases: ["service category", "service type", "category", "message type", "option"], key: "service_category", label: "Service Category" },
];
const TOTAL_LIKE_KEYS = new Set(["total", "value", "amount", "count", "ayp", "ayp 10 24"]);
const KVP_MARKERS = [
  "msm",
  "fsw",
  "pwid",
  "pwd",
  "lgbtqi",
  "agyw",
  "gen pop",
  "general pop",
  "general pop.",
  "general population",
  "young men",
];

const titleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const normalizeDimensionToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeDimensionKey = (value: string): NahpaDisaggregateDimension => {
  const token = normalizeDimensionToken(value);
  for (const item of DIMENSION_KEY_ALIASES) {
    if (item.aliases.some((alias) => token.includes(alias))) return item.key;
  }
  return token || "service_category";
};

const getDimensionLabel = (key: NahpaDisaggregateDimension, fallback?: string | null) => {
  if (fallback && fallback.trim()) return fallback.trim();
  const token = normalizeDimensionToken(String(key));
  const known = DIMENSION_KEY_ALIASES.find((item) => item.key === key || item.aliases.includes(token));
  if (known) return known.label;
  return titleCase(String(key));
};

const isNumericLike = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed);
};

const parseDimensionValues = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value.length > 0);
};

const inferDimensionKeyFromValues = (
  values: string[],
  fallbackKey: NahpaDisaggregateDimension,
  dimensionIndex: number,
): NahpaDisaggregateDimension => {
  const normalizedValues = values.map((value) => normalizeDimensionToken(value)).filter(Boolean);
  if (normalizedValues.length === 0) return fallbackKey;
  if (normalizedValues.every((value) => SEX_ORDER.includes(value))) return "sex";
  if (normalizedValues.every((value) => AGE_KEY_PATTERN.test(value) || value.includes("+") || value.includes("all age"))) {
    return "age_group";
  }
  if (normalizedValues.some((value) => KVP_MARKERS.some((marker) => value.includes(marker)))) {
    return "kvp";
  }
  if (dimensionIndex === 1) return "service_category";
  if (dimensionIndex === 2) return "sex";
  return fallbackKey;
};

const sortDimensionValues = (values: string[], dimension: NahpaDisaggregateDimension) => {
  const normalizedDimension = normalizeDimensionKey(String(dimension));
  const order =
    normalizedDimension === "sex"
      ? SEX_ORDER
      : normalizedDimension === "age_group"
        ? AGE_RANGE_ORDER
        : [];

  return [...values].sort((left, right) => {
    const leftToken = normalizeDimensionToken(left);
    const rightToken = normalizeDimensionToken(right);
    if (order.length > 0) {
      const leftIndex = order.findIndex((item) => item === leftToken);
      const rightIndex = order.findIndex((item) => item === rightToken);
      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
      }
    }
    return left.localeCompare(right);
  });
};

const getConfiguredDisaggregateDimensions = (
  indicator: Indicator | null | undefined,
): IndicatorDisaggregateDimensionConfig[] => {
  if (!indicator) return [];
  const normalizedConfig = normalizeAggregateDisaggregationConfig(
    indicator.aggregate_disaggregation_config || undefined,
    indicator.sub_labels || undefined,
  );
  if (!normalizedConfig.enabled || normalizedConfig.dimensions.length === 0) return [];
  return normalizedConfig.dimensions.map((dimension) => {
    const key = normalizeDimensionKey(String(dimension.key || dimension.label || "service_category"));
    const label = getDimensionLabel(key, String(dimension.label || ""));
    return {
      key,
      label,
      values: parseDimensionValues(dimension.values),
    };
  });
};

const inferDisaggregateDimensionsFromData = (
  disaggregateMaps: DisaggregateCategoryMap[],
): IndicatorDisaggregateDimensionConfig[] => {
  if (disaggregateMaps.length === 0) return [];

  const levelOneValues = new Set<string>();
  const levelTwoValues = new Set<string>();
  const levelThreeValues = new Set<string>();

  disaggregateMaps.forEach((disaggregates) => {
    Object.entries(disaggregates).forEach(([levelOne, secondLevel]) => {
      levelOneValues.add(levelOne);
      if (!secondLevel || typeof secondLevel !== "object") return;

      Object.entries(secondLevel as Record<string, unknown>).forEach(([levelTwo, thirdLevel]) => {
        levelTwoValues.add(levelTwo);
        if (!thirdLevel || typeof thirdLevel !== "object") return;

        Object.entries(thirdLevel as Record<string, unknown>).forEach(([levelThree, rawValue]) => {
          const normalized = normalizeDimensionToken(levelThree);
          if (TOTAL_LIKE_KEYS.has(normalized)) return;
          if (!isNumericLike(rawValue)) return;
          levelThreeValues.add(levelThree);
        });
      });
    });
  });

  const dimensions: IndicatorDisaggregateDimensionConfig[] = [];
  if (levelOneValues.size > 0) {
    const values = sortDimensionValues(Array.from(levelOneValues), "service_category");
    const key = inferDimensionKeyFromValues(values, "service_category", 1);
    dimensions.push({
      key,
      label: getDimensionLabel(key),
      values,
    });
  }
  if (levelTwoValues.size > 1) {
    const values = sortDimensionValues(Array.from(levelTwoValues), "sex");
    const key = inferDimensionKeyFromValues(values, "sex", 2);
    dimensions.push({
      key,
      label: getDimensionLabel(key),
      values,
    });
  }
  if (levelThreeValues.size > 1) {
    const values = sortDimensionValues(Array.from(levelThreeValues), "age_group");
    const key = inferDimensionKeyFromValues(values, "age_group", 3);
    dimensions.push({
      key,
      label: getDimensionLabel(key),
      values,
    });
  }

  return dimensions;
};

const resolveIndicatorDisaggregateProfile = (input: {
  indicator: Indicator | null;
  disaggregateMaps: DisaggregateCategoryMap[];
}): IndicatorDisaggregateProfile => {
  const configuredDimensions = getConfiguredDisaggregateDimensions(input.indicator);
  const dimensions =
    configuredDimensions.length > 0
      ? configuredDimensions
      : inferDisaggregateDimensionsFromData(input.disaggregateMaps);

  if (dimensions.length === 0) {
    return {
      hasDisaggregates: false,
      state: "none",
      defaultLayout: "list",
      dimensions: [],
    };
  }

  if (dimensions.length === 1) {
    return {
      hasDisaggregates: true,
      state: "single",
      defaultLayout: "list",
      dimensions,
    };
  }

  return {
    hasDisaggregates: true,
    state: "multi",
    defaultLayout: "matrix",
    dimensions,
  };
};

const buildDisaggregateRecords = (
  disaggregates: DisaggregateCategoryMap | null,
  dimensionOrder: NahpaDisaggregateDimension[],
) => {
  if (!disaggregates) return [] as DisaggregateRecord[];
  const firstDimension = normalizeDimensionKey(String(dimensionOrder[0] || "service_category"));
  const secondDimension = normalizeDimensionKey(String(dimensionOrder[1] || "sex"));
  const thirdDimension = normalizeDimensionKey(String(dimensionOrder[2] || "age_group"));
  const records: DisaggregateRecord[] = [];

  Object.entries(disaggregates).forEach(([levelOne, secondLevel]) => {
    if (!secondLevel || typeof secondLevel !== "object") return;

    Object.entries(secondLevel as Record<string, unknown>).forEach(([levelTwo, thirdLevel]) => {
      if (thirdLevel && typeof thirdLevel === "object") {
        const levelThreeRecord = thirdLevel as Record<string, unknown>;
        const valueEntries = Object.entries(levelThreeRecord).filter(([key, rawValue]) => {
          const normalized = normalizeDimensionToken(key);
          if (TOTAL_LIKE_KEYS.has(normalized)) return false;
          return isNumericLike(rawValue);
        });

        if (valueEntries.length === 0) {
          records.push({
            dimensions: {
              [firstDimension]: levelOne.trim() || "All",
              [secondDimension]: levelTwo.trim() || "All",
              [thirdDimension]: "All Ages",
            },
            value: readEntryTotal(levelThreeRecord),
          });
          return;
        }

        valueEntries.forEach(([levelThree, rawValue]) => {
          records.push({
            dimensions: {
              [firstDimension]: levelOne.trim() || "All",
              [secondDimension]: levelTwo.trim() || "All",
              [thirdDimension]: levelThree.trim() || "All Ages",
            },
            value: toSafeNumber(rawValue),
          });
        });
        return;
      }

      records.push({
        dimensions: {
          [firstDimension]: levelOne.trim() || "All",
          [secondDimension]: levelTwo.trim() || "All",
          [thirdDimension]: "All Ages",
        },
        value: toSafeNumber(thirdLevel),
      });
    });
  });

  return records;
};

const getRecordDimensionValue = (
  record: DisaggregateRecord,
  dimension: NahpaDisaggregateDimension,
) => {
  const normalized = normalizeDimensionKey(String(dimension));
  return record.dimensions[normalized] || "All";
};

export function ReportsHub() {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasInitializedUrlStateRef = useRef(false);
  const [projectFilter, setProjectFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("2025");
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);

  const [reportName, setReportName] = useState("");
  const [reportType, setReportType] = useState<"indicator_summary" | "project_progress" | "respondent_demographics" | "custom">("indicator_summary");
  const [scheduleFrequency, setScheduleFrequency] = useState<"daily" | "weekly" | "monthly" | "quarterly">("monthly");
  const [scheduleRecipients, setScheduleRecipients] = useState("");
  const [activeIndicatorIndex, setActiveIndicatorIndex] = useState<number | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<Report | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [nahpaSettings, setNahpaSettings] = useState<NahpaVisualizationSettings>(
    () => createDefaultNahpaVisualizationSettings(),
  );
  const [reportRangeFrom, setReportRangeFrom] = useState("");
  const [reportRangeTo, setReportRangeTo] = useState("");
  const [selectedDisaggregateIndicatorId, setSelectedDisaggregateIndicatorId] = useState("all");

  const reportOrgId = nahpaSettings.organization.organizationId;
  const includeSubgrantees = nahpaSettings.organization.includeSubGrantees;
  const selectedSubgranteeIds = useMemo(
    () => nahpaSettings.organization.selectedSubGrantees ?? [],
    [nahpaSettings.organization.selectedSubGrantees],
  );
  const reportDateMode =
    nahpaSettings.period.mode === "date-range"
      ? "dates"
      : nahpaSettings.period.mode;

  const setReportOrgId = useCallback((value: string) => {
    setNahpaSettings((previous) => ({
      ...previous,
      organization: {
        ...previous.organization,
        organizationId: value,
      },
    }));
  }, []);

  const setIncludeSubgrantees = useCallback((value: boolean) => {
    setNahpaSettings((previous) => ({
      ...previous,
      organization: {
        ...previous.organization,
        includeSubGrantees: value,
      },
    }));
  }, []);

  const setSelectedSubgranteeIds = useCallback(
    (nextSelectedIds: string[] | ((previous: string[]) => string[])) => {
      setNahpaSettings((previous) => {
        const current = previous.organization.selectedSubGrantees ?? [];
        const resolved =
          typeof nextSelectedIds === "function"
            ? nextSelectedIds(current)
            : nextSelectedIds;
        return {
          ...previous,
          organization: {
            ...previous.organization,
            selectedSubGrantees: resolved,
          },
        };
      });
    },
    [],
  );

  const setReportDateMode = useCallback((value: "dates" | "month" | "quarter" | "year") => {
    setNahpaSettings((previous) => ({
      ...previous,
      period: {
        ...previous.period,
        mode: value === "dates" ? "date-range" : value,
      },
    }));
  }, []);

  useEffect(() => {
    const params = searchParams;
    if (!params) return;

    const modeParam = params.get("pm");
    const parsedMode =
      modeParam === "date-range" ||
      modeParam === "month" ||
      modeParam === "quarter" ||
      modeParam === "year"
        ? modeParam
        : null;
    const parsedPeriods = Array.from(
      new Set(params.getAll("period").map((value) => value.trim()).filter(Boolean)),
    );
    const parsedOrganizationId = params.get("org");
    const parsedIncludeSubGrantees = params.get("incSubs");
    const parsedSubGrantees = Array.from(
      new Set(params.getAll("sub").map((value) => value.trim()).filter(Boolean)),
    );
    const parsedIndicatorGroup = params.get("ig");
    const parsedGroupBy = params.get("gb");
    const parsedDisaggregateEnabled = params.get("dis");
    const parsedDisaggregateDimensions = Array.from(
      new Set(
        params
          .getAll("dd")
          .map((value) => value.trim())
          .filter((value): value is NahpaDisaggregateDimension =>
            NAHPA_DISAGGREGATE_DIMENSION_OPTIONS.some(
              (option) => option.value === value,
            ),
          ),
      ),
    );
    const parsedDisaggregateLayout = params.get("dl");
    const parsedComparisonEnabled = params.get("cmp");
    const parsedCompareBy = params.get("cb");
    const parsedShowTargets = params.get("st");
    const parsedShowAchievement = params.get("sa");
    const parsedShowPerformancePercent = params.get("spp");
    const parsedChartType = params.get("ct");
    const parsedShowLegend = params.get("lg");
    const parsedProject = params.get("project");
    const parsedRangeFrom = params.get("rf");
    const parsedRangeTo = params.get("rt");
    const parsedDisaggregateIndicator = params.get("di");

    if (parsedProject) setProjectFilter(parsedProject);
    if (parsedRangeFrom !== null) setReportRangeFrom(parsedRangeFrom);
    if (parsedRangeTo !== null) setReportRangeTo(parsedRangeTo);
    if (parsedDisaggregateIndicator) {
      setSelectedDisaggregateIndicatorId(parsedDisaggregateIndicator);
    }

    setNahpaSettings((previous) => {
      const next = createDefaultNahpaVisualizationSettings();
      next.period.selectedPeriods = [...previous.period.selectedPeriods];
      next.organization.selectedSubGrantees = [
        ...(previous.organization.selectedSubGrantees || []),
      ];

      if (parsedMode) next.period.mode = parsedMode;
      if (parsedPeriods.length > 0) next.period.selectedPeriods = parsedPeriods;
      if (parsedOrganizationId) next.organization.organizationId = parsedOrganizationId;
      if (parsedIncludeSubGrantees !== null) {
        next.organization.includeSubGrantees = parseBoolParam(
          parsedIncludeSubGrantees,
          next.organization.includeSubGrantees,
        );
      }
      if (parsedSubGrantees.length > 0) {
        next.organization.selectedSubGrantees = parsedSubGrantees;
      }
      if (
        parsedIndicatorGroup &&
        NAHPA_INDICATOR_GROUP_OPTIONS.some(
          (option) => option.value === parsedIndicatorGroup,
        )
      ) {
        next.indicator.indicatorGroup = parsedIndicatorGroup;
      }
      if (parsedGroupBy === "category" || parsedGroupBy === "indicator") {
        next.indicator.groupBy = parsedGroupBy;
      }
      if (parsedDisaggregateEnabled !== null) {
        next.disaggregate.enabled = parseBoolParam(
          parsedDisaggregateEnabled,
          next.disaggregate.enabled,
        );
      }
      if (parsedDisaggregateDimensions.length > 0) {
        next.disaggregate.dimensions = parsedDisaggregateDimensions;
      }
      if (parsedDisaggregateLayout === "list" || parsedDisaggregateLayout === "matrix") {
        next.disaggregate.layout = parsedDisaggregateLayout;
      }
      if (parsedComparisonEnabled !== null) {
        next.comparison.enabled = parseBoolParam(
          parsedComparisonEnabled,
          next.comparison.enabled,
        );
      }
      if (parsedCompareBy === "period" || parsedCompareBy === "organization") {
        next.comparison.compareBy = parsedCompareBy;
      }
      if (parsedShowTargets !== null) {
        next.targets.showTargets = parseBoolParam(
          parsedShowTargets,
          next.targets.showTargets,
        );
      }
      if (parsedShowAchievement !== null) {
        next.targets.showAchievement = parseBoolParam(
          parsedShowAchievement,
          next.targets.showAchievement,
        );
      }
      if (parsedShowPerformancePercent !== null) {
        next.targets.showPerformancePercent = parseBoolParam(
          parsedShowPerformancePercent,
          next.targets.showPerformancePercent,
        );
      }
      if (parsedChartType === "clustered-bar" || parsedChartType === "grouped-bar") {
        next.display.chartType = parsedChartType;
      }
      if (parsedShowLegend !== null) {
        next.display.showLegend = parseBoolParam(
          parsedShowLegend,
          next.display.showLegend,
        );
      }

      if (areNahpaSettingsEqual(previous, next)) {
        return previous;
      }
      return next;
    });

    hasInitializedUrlStateRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!hasInitializedUrlStateRef.current) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    NAHPA_QUERY_KEYS.forEach((queryKey) => nextParams.delete(queryKey));

    if (projectFilter !== "all") nextParams.set("project", projectFilter);
    nextParams.set("pm", nahpaSettings.period.mode);
    nahpaSettings.period.selectedPeriods.forEach((periodLabel) =>
      nextParams.append("period", periodLabel),
    );
    nextParams.set("org", String(nahpaSettings.organization.organizationId));
    nextParams.set(
      "incSubs",
      nahpaSettings.organization.includeSubGrantees ? "1" : "0",
    );
    [...(nahpaSettings.organization.selectedSubGrantees || [])]
      .sort((left, right) => left.localeCompare(right))
      .forEach((organizationId) => nextParams.append("sub", organizationId));
    nextParams.set("ig", nahpaSettings.indicator.indicatorGroup);
    nextParams.set("gb", nahpaSettings.indicator.groupBy);
    nextParams.set("dis", nahpaSettings.disaggregate.enabled ? "1" : "0");
    [...nahpaSettings.disaggregate.dimensions]
      .sort((left, right) => left.localeCompare(right))
      .forEach((dimension) => nextParams.append("dd", dimension));
    nextParams.set("dl", nahpaSettings.disaggregate.layout);
    nextParams.set("cmp", nahpaSettings.comparison.enabled ? "1" : "0");
    nextParams.set("cb", nahpaSettings.comparison.compareBy);
    nextParams.set("st", nahpaSettings.targets.showTargets ? "1" : "0");
    nextParams.set("sa", nahpaSettings.targets.showAchievement ? "1" : "0");
    nextParams.set(
      "spp",
      nahpaSettings.targets.showPerformancePercent ? "1" : "0",
    );
    nextParams.set("ct", nahpaSettings.display.chartType);
    nextParams.set("lg", nahpaSettings.display.showLegend ? "1" : "0");
    if (reportRangeFrom) nextParams.set("rf", reportRangeFrom);
    if (reportRangeTo) nextParams.set("rt", reportRangeTo);
    if (selectedDisaggregateIndicatorId !== "all") {
      nextParams.set("di", selectedDisaggregateIndicatorId);
    }

    const nextQuery = nextParams.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery === currentQuery) return;

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [
    nahpaSettings,
    pathname,
    projectFilter,
    reportRangeFrom,
    reportRangeTo,
    router,
    searchParams,
    selectedDisaggregateIndicatorId,
  ]);

  const { data: projectsData } = useProjects();
  const { data: indicatorsData } = useAllIndicators();
  const { data: organizationsData } = useAllOrganizations();
  const { data: reportsData, mutate: mutateReports } = useReports();
  const { data: scheduledReportsData, mutate: mutateScheduled } = useScheduledReports();
  const { data: aggregatesData } = useAllAggregates({
    project: projectFilter !== "all" ? projectFilter : undefined,
    status: "approved",
  });
  const { data: dashboardStats } = useDashboardStats(
    projectFilter === "all" ? undefined : Number(projectFilter),
  );
  const { data: respondentStats } = useRespondentStats();

  const projects = projectsData?.results ?? [];
  const indicators = useMemo<Indicator[]>(() => (indicatorsData ?? []) as Indicator[], [indicatorsData]);
  const organizations = useMemo(() => organizationsData?.results ?? [], [organizationsData?.results]);
  const reports = useMemo(() => reportsData?.results ?? [], [reportsData?.results]);
  const scheduledReports = scheduledReportsData ?? [];
  const allAggregates = useMemo(() => aggregatesData ?? [], [aggregatesData]);
  const indicatorNameById = useMemo(
    () =>
      new Map(
        indicators.map((indicator) => [String(indicator.id), indicator.name || ""]),
      ),
    [indicators],
  );
  const indicatorDisplayNameById = useMemo(
    () =>
      new Map(
        indicators.map((indicator) => [
          String(indicator.id),
          getIndicatorDisplayName(indicator, `Indicator ${indicator.id}`),
        ]),
      ),
    [indicators],
  );
  const indicatorChartLabelById = useMemo(
    () =>
      new Map(
        indicators.map((indicator) => [
          String(indicator.id),
          getIndicatorChartLabel(indicator, `Indicator ${indicator.id}`),
        ]),
      ),
    [indicators],
  );
  const indicatorById = useMemo(
    () =>
      new Map(
        indicators.map((indicator) => [String(indicator.id), indicator]),
      ),
    [indicators],
  );

  const organizationById = useMemo(() => {
    const map = new Map<string, (typeof organizations)[number]>();
    organizations.forEach((organization) => {
      map.set(String(organization.id), organization);
    });
    return map;
  }, [organizations]);

  const selectedOrganization =
    reportOrgId !== "all" ? organizationById.get(String(reportOrgId)) || null : null;
  const selectedOrganizationType = normalizeOrganizationType(selectedOrganization?.type);
  const canUseSubgranteeScope =
    selectedOrganizationType === "coordinator" ||
    selectedOrganizationType === "senior_coordinator";

  const coordinatorScopeOptions = useMemo(() => {
    if (!selectedOrganization || !canUseSubgranteeScope) return [];

    const childrenByParent = new Map<string, (typeof organizations)>();
    organizations.forEach((organization) => {
      const parentId = organization.parentId ? String(organization.parentId) : "";
      if (!parentId) return;
      const existing = childrenByParent.get(parentId) || [];
      existing.push(organization);
      childrenByParent.set(parentId, existing);
    });

    const queue = [String(selectedOrganization.id)];
    const visited = new Set<string>();
    const subgrantees: (typeof organizations)[number][] = [];

    while (queue.length > 0) {
      const currentParentId = queue.shift();
      if (!currentParentId) continue;
      const children = childrenByParent.get(currentParentId) || [];
      children.forEach((childOrganization) => {
        const childId = String(childOrganization.id);
        if (visited.has(childId)) return;
        visited.add(childId);
        queue.push(childId);
        subgrantees.push(childOrganization);
      });
    }

    return subgrantees.sort((left, right) => left.name.localeCompare(right.name));
  }, [canUseSubgranteeScope, organizations, selectedOrganization]);

  const effectiveSubgranteeIds = useMemo(() => {
    if (selectedSubgranteeIds.length > 0) return selectedSubgranteeIds;
    return coordinatorScopeOptions.map((organization) => String(organization.id));
  }, [coordinatorScopeOptions, selectedSubgranteeIds]);

  useEffect(() => {
    if (reportOrgId === "all") {
      setSelectedSubgranteeIds([]);
      setIncludeSubgrantees(true);
      return;
    }

    if (!canUseSubgranteeScope) {
      setSelectedSubgranteeIds([]);
      setIncludeSubgrantees(false);
      return;
    }

    setIncludeSubgrantees(true);
  }, [canUseSubgranteeScope, reportOrgId, setIncludeSubgrantees, setSelectedSubgranteeIds]);

  useEffect(() => {
    const allowedIds = new Set(coordinatorScopeOptions.map((organization) => String(organization.id)));
    setSelectedSubgranteeIds((previous) => previous.filter((id) => allowedIds.has(String(id))));
  }, [coordinatorScopeOptions, setSelectedSubgranteeIds]);

  const organizationScopedAggregates = useMemo(() => {
    if (reportOrgId === "all") return allAggregates;

    const selectedOrganizationId = String(reportOrgId);
    if (!canUseSubgranteeScope || !includeSubgrantees) {
      return allAggregates.filter(
        (aggregate) => String(aggregate.organization) === selectedOrganizationId,
      );
    }

    const allowedOrganizationIds = new Set<string>([
      selectedOrganizationId,
      ...effectiveSubgranteeIds.map(String),
    ]);

    return allAggregates.filter((aggregate) =>
      allowedOrganizationIds.has(String(aggregate.organization)),
    );
  }, [
    allAggregates,
    canUseSubgranteeScope,
    effectiveSubgranteeIds,
    includeSubgrantees,
    reportOrgId,
  ]);
  const organizationScopedAggregatesWithResolvedNames = useMemo(
    () =>
      organizationScopedAggregates.map((aggregate) => {
        const directName = String(aggregate.indicator_name || "").trim();
        const fallbackName =
          indicatorNameById.get(String(aggregate.indicator)) ||
          `Indicator ${aggregate.indicator}`;
        return {
          ...aggregate,
          indicator_name: directName || fallbackName,
        };
      }),
    [indicatorNameById, organizationScopedAggregates],
  );

  const periodGranularity: AggregatePeriodMode | null =
    reportDateMode === "quarter"
      ? "quarter"
      : reportDateMode === "month"
        ? "month"
        : reportDateMode === "year"
          ? "year"
          : null;

  const availablePeriodOptions = useMemo(() => {
    if (!periodGranularity) return [];
    const unique = new Set<string>();
    organizationScopedAggregatesWithResolvedNames.forEach((aggregate) => {
      const label = getAggregatePeriodLabel(aggregate, periodGranularity);
      if (label) unique.add(label);
    });

    const values = Array.from(unique);
    if (periodGranularity === "quarter") return values.sort(compareQuarterLabels);
    if (periodGranularity === "month") return values.sort(compareMonthLabels);
    return values.sort(compareYearLabels);
  }, [organizationScopedAggregatesWithResolvedNames, periodGranularity]);

  useEffect(() => {
    if (!periodGranularity) return;
    const normalizedPeriods = normalizeSelectedPeriods(
      nahpaSettings.period.selectedPeriods,
      availablePeriodOptions,
    );
    if (arraysEqual(normalizedPeriods, nahpaSettings.period.selectedPeriods)) {
      return;
    }
    setNahpaSettings((previous) => ({
      ...previous,
      period: {
        ...previous.period,
        selectedPeriods: normalizedPeriods,
      },
    }));
  }, [availablePeriodOptions, nahpaSettings.period.selectedPeriods, periodGranularity]);

  const selectedPeriodLabels = useMemo(() => {
    if (!periodGranularity) return [];
    return nahpaSettings.period.selectedPeriods.filter((periodLabel) =>
      availablePeriodOptions.includes(periodLabel),
    );
  }, [availablePeriodOptions, nahpaSettings.period.selectedPeriods, periodGranularity]);

  const aggregates = useMemo(() => {
    if (periodGranularity) {
      if (selectedPeriodLabels.length === 0) return [];
      const selectedSet = new Set(selectedPeriodLabels);
      return organizationScopedAggregatesWithResolvedNames.filter((aggregate) => {
        const periodLabel = getAggregatePeriodLabel(aggregate, periodGranularity);
        return Boolean(periodLabel && selectedSet.has(periodLabel));
      });
    }

    if (!reportRangeFrom && !reportRangeTo) return organizationScopedAggregatesWithResolvedNames;
    const fromDate = reportRangeFrom ? new Date(reportRangeFrom) : null;
    const toDate = reportRangeTo ? new Date(reportRangeTo) : null;

    return organizationScopedAggregatesWithResolvedNames.filter((aggregate) => {
      const startDate = new Date(aggregate.period_start);
      const endDate = new Date(aggregate.period_end || aggregate.period_start);
      if (fromDate && !Number.isNaN(endDate.getTime()) && endDate < fromDate) return false;
      if (toDate && !Number.isNaN(startDate.getTime()) && startDate > toDate) return false;
      return true;
    });
  }, [
    organizationScopedAggregatesWithResolvedNames,
    periodGranularity,
    reportRangeFrom,
    reportRangeTo,
    selectedPeriodLabels,
  ]);

  const activeRangeLabel = `${reportRangeFrom || "Start"} to ${reportRangeTo || "End"}`;
  const periodLabel = useMemo(
    () => (periodGranularity
      ? selectedPeriodLabels.length > 0
        ? selectedPeriodLabels.join(" vs ")
        : "No period selected"
      : activeRangeLabel),
    [activeRangeLabel, periodGranularity, selectedPeriodLabels],
  );

  const chartPeriodLabels = useMemo(
    () => (periodGranularity ? selectedPeriodLabels : [activeRangeLabel]),
    [activeRangeLabel, periodGranularity, selectedPeriodLabels],
  );

  const getAggregateLabelForCurrentMode = useCallback(
    (aggregate: { period_start: string; period_end: string }) => {
      if (!periodGranularity) return activeRangeLabel;
      return getAggregatePeriodLabel(aggregate, periodGranularity);
    },
    [activeRangeLabel, periodGranularity],
  );

  const indicatorLookup = useMemo(() => {
    return indicators.reduce<Record<string, { id: string; name: string }>>((acc, indicator) => {
      acc[normalizeName(indicator.name)] = { id: indicator.id, name: indicator.name };
      return acc;
    }, {});
  }, [indicators]);

  const targetByIndicatorId = useMemo(() => {
    const allowedOrganizationIds =
      reportOrgId === "all"
        ? null
        : new Set<string>([
            String(reportOrgId),
            ...(canUseSubgranteeScope && includeSubgrantees ? effectiveSubgranteeIds.map(String) : []),
          ]);

    const totals = new Map<string, { value: number; rowCount: number }>();
    indicators.forEach((indicator) => {
      const indicatorId = String(indicator.id);
      const targetRows = indicator.project_targets || [];
      const scopedRows = targetRows.filter((targetRow) => {
        if (projectFilter !== "all" && String(targetRow.project) !== String(projectFilter)) return false;
        if (!allowedOrganizationIds) return true;
        return allowedOrganizationIds.has(String(targetRow.organization));
      });
      if (scopedRows.length === 0) return;
      const total = scopedRows.reduce((sum, row) => sum + toSafeNumber(row.target_value), 0);
      totals.set(indicatorId, { value: total, rowCount: scopedRows.length });
    });
    return totals;
  }, [
    canUseSubgranteeScope,
    effectiveSubgranteeIds,
    includeSubgrantees,
    indicators,
    projectFilter,
    reportOrgId,
  ]);

  const targetComparisonRows = useMemo(() => {
    const categories = [
      { label: "HIV Messages", names: SOCIAL_CONTRACTING_INDICATORS },
      { label: "NCD Messages", names: SOCIAL_CONTRACTING_NCD },
      { label: "Events & Outreach", names: SOCIAL_CONTRACTING_EVENTS },
    ];

    return categories.map((category) => {
      const indicatorIds = category.names
        .map((name) => indicatorLookup[normalizeName(name)]?.id || "")
        .filter((value) => value.length > 0);
      const indicatorIdSet = new Set(indicatorIds);

      const matchingAggregates = aggregates.filter((aggregate) => indicatorIdSet.has(String(aggregate.indicator)));
      const achievedTotal = matchingAggregates.reduce((sum, aggregate) => sum + extractAggregateTotal(aggregate.value), 0);

      const targetStats = indicatorIds.reduce(
        (acc, indicatorId) => {
          const target = targetByIndicatorId.get(String(indicatorId));
          if (!target) return acc;
          acc.value += target.value;
          acc.rowCount += target.rowCount;
          return acc;
        },
        { value: 0, rowCount: 0 },
      );

      return {
        label: category.label,
        achieved: {
          hasData: matchingAggregates.length > 0,
          value: matchingAggregates.length > 0 ? achievedTotal : null,
        },
        target: {
          hasData: targetStats.rowCount > 0,
          value: targetStats.rowCount > 0 ? targetStats.value : null,
        },
      };
    });
  }, [aggregates, indicatorLookup, targetByIndicatorId]);

  const disaggregateIndicatorOptions = useMemo(() => {
    const optionsMap = new Map<string, string>();
    indicators.forEach((indicator) => {
      const indicatorId = String(indicator.id);
      optionsMap.set(
        indicatorId,
        indicatorDisplayNameById.get(indicatorId) || indicator.name || `Indicator ${indicatorId}`,
      );
    });
    organizationScopedAggregatesWithResolvedNames.forEach((aggregate) => {
      const indicatorId = String(aggregate.indicator);
      if (optionsMap.has(indicatorId)) return;
      optionsMap.set(indicatorId, aggregate.indicator_name || `Indicator ${indicatorId}`);
    });
    return Array.from(optionsMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [indicatorDisplayNameById, indicators, organizationScopedAggregatesWithResolvedNames]);

  useEffect(() => {
    if (disaggregateIndicatorOptions.length === 0) {
      setSelectedDisaggregateIndicatorId("all");
      return;
    }
    setSelectedDisaggregateIndicatorId((previous) => {
      if (previous !== "all" && disaggregateIndicatorOptions.some((option) => option.id === previous)) {
        return previous;
      }
      return disaggregateIndicatorOptions[0].id;
    });
  }, [disaggregateIndicatorOptions]);

  const selectedDisaggregateIndicatorAggregates = useMemo(() => {
    if (selectedDisaggregateIndicatorId === "all") return [];
    return aggregates.filter((aggregate) => String(aggregate.indicator) === selectedDisaggregateIndicatorId);
  }, [aggregates, selectedDisaggregateIndicatorId]);

  const selectedDisaggregateIndicator = useMemo(
    () =>
      selectedDisaggregateIndicatorId === "all"
        ? null
        : indicatorById.get(selectedDisaggregateIndicatorId) || null,
    [indicatorById, selectedDisaggregateIndicatorId],
  );
  const selectedDisaggregateIndicatorDisplayName = useMemo(() => {
    if (selectedDisaggregateIndicatorId === "all") return "Indicator";
    if (selectedDisaggregateIndicator) {
      return getIndicatorDisplayName(
        selectedDisaggregateIndicator,
        `Indicator ${selectedDisaggregateIndicatorId}`,
      );
    }
    return (
      indicatorDisplayNameById.get(selectedDisaggregateIndicatorId) ||
      selectedDisaggregateIndicatorAggregates[0]?.indicator_name ||
      `Indicator ${selectedDisaggregateIndicatorId}`
    );
  }, [
    indicatorDisplayNameById,
    selectedDisaggregateIndicator,
    selectedDisaggregateIndicatorAggregates,
    selectedDisaggregateIndicatorId,
  ]);
  const selectedDisaggregateIndicatorChartLabel = useMemo(() => {
    if (selectedDisaggregateIndicatorId === "all") return "Indicator";
    if (selectedDisaggregateIndicator) {
      return getIndicatorChartLabel(
        selectedDisaggregateIndicator,
        `Indicator ${selectedDisaggregateIndicatorId}`,
      );
    }
    return (
      indicatorChartLabelById.get(selectedDisaggregateIndicatorId) ||
      selectedDisaggregateIndicatorAggregates[0]?.indicator_name ||
      `Indicator ${selectedDisaggregateIndicatorId}`
    );
  }, [
    indicatorChartLabelById,
    selectedDisaggregateIndicator,
    selectedDisaggregateIndicatorAggregates,
    selectedDisaggregateIndicatorId,
  ]);

  const selectedIndicatorDisaggregateMaps = useMemo(
    () =>
      selectedDisaggregateIndicatorAggregates
        .map((aggregate) => getDisaggregatesMap(aggregate.value))
        .filter((value): value is DisaggregateCategoryMap => value !== null),
    [selectedDisaggregateIndicatorAggregates],
  );

  const selectedIndicatorDisaggregateProfile = useMemo(
    () =>
      resolveIndicatorDisaggregateProfile({
        indicator: selectedDisaggregateIndicator,
        disaggregateMaps: selectedIndicatorDisaggregateMaps,
      }),
    [selectedDisaggregateIndicator, selectedIndicatorDisaggregateMaps],
  );

  const selectedIndicatorDisaggregateConfig = useMemo(
    () =>
      normalizeAggregateDisaggregationConfig(
        selectedDisaggregateIndicator?.aggregate_disaggregation_config,
        selectedDisaggregateIndicator?.sub_labels,
      ),
    [selectedDisaggregateIndicator],
  );

  const selectedIndicatorMergedDisaggregates = useMemo(
    () => mergeDisaggregatesForGroup(selectedDisaggregateIndicatorAggregates),
    [selectedDisaggregateIndicatorAggregates],
  );

  const shouldRenderNestedDisaggregateMatrix =
    selectedIndicatorDisaggregateProfile.state === "multi" &&
    selectedIndicatorDisaggregateProfile.dimensions.length >= 3 &&
    selectedIndicatorDisaggregateConfig.layout === "nested-matrix";

  useEffect(() => {
    if (selectedDisaggregateIndicatorId === "all") return;
    setNahpaSettings((previous) => {
      const profile = selectedIndicatorDisaggregateProfile;
      const allowedDimensionKeys = Array.from(
        new Set(profile.dimensions.map((dimension) => normalizeDimensionKey(String(dimension.key)))),
      );
      const currentDimensions = previous.disaggregate.dimensions
        .map((dimension) => normalizeDimensionKey(String(dimension)))
        .filter((dimension) => allowedDimensionKeys.includes(dimension));

      let nextDimensions: NahpaDisaggregateDimension[] = currentDimensions;
      let nextLayout: "list" | "matrix" = previous.disaggregate.layout;
      if (!profile.hasDisaggregates) {
        nextDimensions = [];
        nextLayout = "list";
      } else if (profile.state === "single") {
        nextDimensions = [allowedDimensionKeys[0]];
        nextLayout = "list";
      } else {
        const defaults = [allowedDimensionKeys[0], allowedDimensionKeys[1]].filter(
          (value): value is NahpaDisaggregateDimension => Boolean(value),
        );
        nextDimensions =
          currentDimensions.length >= 2
            ? currentDimensions.slice(0, 2)
            : defaults;
        nextLayout = "matrix";
      }

      const nextEnabled = profile.hasDisaggregates;
      if (
        previous.disaggregate.enabled === nextEnabled &&
        previous.disaggregate.layout === nextLayout &&
        arraysEqual(previous.disaggregate.dimensions, nextDimensions)
      ) {
        return previous;
      }

      return {
        ...previous,
        disaggregate: {
          ...previous.disaggregate,
          enabled: nextEnabled,
          layout: nextLayout,
          dimensions: nextDimensions,
        },
      };
    });
  }, [selectedDisaggregateIndicatorId, selectedIndicatorDisaggregateProfile]);

  const selectedIndicatorSummaryRows = useMemo(() => {
    if (selectedDisaggregateIndicatorId === "all" || chartPeriodLabels.length === 0) return [];

    const periodSet = new Set(chartPeriodLabels);
    const periodHasData = new Map<string, boolean>();
    const totalsByPeriod = new Map<string, number>();
    chartPeriodLabels.forEach((periodLabel) => {
      periodHasData.set(periodLabel, false);
      totalsByPeriod.set(periodLabel, 0);
    });

    selectedDisaggregateIndicatorAggregates.forEach((aggregate) => {
      const period = getAggregateLabelForCurrentMode(aggregate);
      if (!period || !periodSet.has(period)) return;
      periodHasData.set(period, true);
      totalsByPeriod.set(period, (totalsByPeriod.get(period) || 0) + extractAggregateTotal(aggregate.value));
    });

    return [
      {
        label: selectedDisaggregateIndicatorChartLabel,
        color: "#1f6a8a",
        byPeriod: chartPeriodLabels.reduce<Record<string, { hasData: boolean; value: number | null }>>(
          (accumulator, periodLabel) => {
            if (!periodHasData.get(periodLabel)) {
              accumulator[periodLabel] = { hasData: false, value: null };
              return accumulator;
            }
            accumulator[periodLabel] = { hasData: true, value: totalsByPeriod.get(periodLabel) || 0 };
            return accumulator;
          },
          {},
        ),
      },
    ];
  }, [
    chartPeriodLabels,
    getAggregateLabelForCurrentMode,
    selectedDisaggregateIndicatorChartLabel,
    selectedDisaggregateIndicatorAggregates,
    selectedDisaggregateIndicatorId,
  ]);

  const selectedIndicatorTargetRows = useMemo(() => {
    if (selectedDisaggregateIndicatorId === "all" || chartPeriodLabels.length === 0) return [];
    const summaryRow = selectedIndicatorSummaryRows[0];
    if (!summaryRow) return [];
    const targetStats = targetByIndicatorId.get(selectedDisaggregateIndicatorId);

    return chartPeriodLabels.map((periodLabel) => ({
      label: periodLabel,
      achieved: summaryRow.byPeriod[periodLabel] || { hasData: false, value: null },
      target: targetStats
        ? { hasData: true, value: targetStats.value }
        : { hasData: false, value: null },
    }));
  }, [
    chartPeriodLabels,
    selectedDisaggregateIndicatorId,
    selectedIndicatorSummaryRows,
    targetByIndicatorId,
  ]);

  const disaggregateTableRows = useMemo(() => {
    if (!selectedIndicatorDisaggregateProfile.hasDisaggregates) return [];
    if (selectedDisaggregateIndicatorId === "all" || chartPeriodLabels.length === 0) return [];

    const dimensionOrder = selectedIndicatorDisaggregateProfile.dimensions.map((dimension) =>
      normalizeDimensionKey(String(dimension.key)),
    );
    const preferredDimension =
      selectedIndicatorDisaggregateProfile.state === "single"
        ? dimensionOrder[0]
        : normalizeDimensionKey(
            String(nahpaSettings.disaggregate.dimensions[0] || dimensionOrder[0] || "service_category"),
          );
    const configuredValues =
      selectedIndicatorDisaggregateProfile.dimensions.find(
        (dimension) => normalizeDimensionKey(String(dimension.key)) === preferredDimension,
      )?.values ?? [];

    const periodHasData = new Map<string, boolean>();
    const totalsByPeriodDimension = new Map<string, Map<string, number>>();

    chartPeriodLabels.forEach((period) => {
      periodHasData.set(period, false);
      totalsByPeriodDimension.set(period, new Map<string, number>());
    });

    selectedDisaggregateIndicatorAggregates.forEach((aggregate) => {
      const period = getAggregateLabelForCurrentMode(aggregate);
      if (!period || !totalsByPeriodDimension.has(period)) return;
      const records = buildDisaggregateRecords(
        getDisaggregatesMap(aggregate.value),
        dimensionOrder,
      );
      if (records.length === 0) return;

      periodHasData.set(period, true);
      const dimensionTotals = totalsByPeriodDimension.get(period)!;
      records.forEach((record) => {
        const dimensionValue = getRecordDimensionValue(record, preferredDimension);
        dimensionTotals.set(
          dimensionValue,
          (dimensionTotals.get(dimensionValue) || 0) + record.value,
        );
      });
    });

    const discoveredValues = new Set<string>();
    configuredValues.forEach((value) => discoveredValues.add(value));
    totalsByPeriodDimension.forEach((map) =>
      map.forEach((_, dimensionValue) => discoveredValues.add(dimensionValue)),
    );
    const sortedValues = sortDimensionValues(Array.from(discoveredValues), preferredDimension);

    return sortedValues.map((dimensionValue) => ({
      label: dimensionValue,
      byPeriod: chartPeriodLabels.reduce<Record<string, { hasData: boolean; value: number | null }>>((accumulator, period) => {
        const hasData = Boolean(periodHasData.get(period));
        if (!hasData) {
          accumulator[period] = { hasData: false, value: null };
          return accumulator;
        }
        const total = totalsByPeriodDimension.get(period)?.get(dimensionValue) || 0;
        accumulator[period] = { hasData: true, value: total };
        return accumulator;
      }, {}),
    }));
  }, [
    chartPeriodLabels,
    getAggregateLabelForCurrentMode,
    nahpaSettings.disaggregate.dimensions,
    selectedIndicatorDisaggregateProfile,
    selectedDisaggregateIndicatorAggregates,
    selectedDisaggregateIndicatorId,
  ]);

  const disaggregateChartRows = useMemo(
    () =>
      disaggregateTableRows.map((row, index) => ({
        label: row.label,
        color: reportChartPalette[index % reportChartPalette.length],
        byPeriod: row.byPeriod,
      })),
    [disaggregateTableRows],
  );

  const disaggregateMatrixData = useMemo(() => {
    if (!selectedIndicatorDisaggregateProfile.hasDisaggregates) {
      return {
        columnLabels: [] as string[],
        columnGroups: [] as Array<{ label: string; span: number }>,
        rows: [] as Array<{ label: string; cells: { hasData: boolean; value: number | null }[] }>,
        rowDimension: "service_category" as NahpaDisaggregateDimension,
        columnDimension: "sex" as NahpaDisaggregateDimension,
      };
    }
    if (selectedIndicatorDisaggregateProfile.state !== "multi" || nahpaSettings.disaggregate.layout !== "matrix") {
      return {
        columnLabels: [] as string[],
        columnGroups: [] as Array<{ label: string; span: number }>,
        rows: [] as Array<{ label: string; cells: { hasData: boolean; value: number | null }[] }>,
        rowDimension: "service_category" as NahpaDisaggregateDimension,
        columnDimension: "sex" as NahpaDisaggregateDimension,
      };
    }
    if (selectedDisaggregateIndicatorId === "all") {
      return {
        columnLabels: [] as string[],
        columnGroups: [] as Array<{ label: string; span: number }>,
        rows: [] as Array<{ label: string; cells: { hasData: boolean; value: number | null }[] }>,
        rowDimension: "service_category" as NahpaDisaggregateDimension,
        columnDimension: "sex" as NahpaDisaggregateDimension,
      };
    }
    if (chartPeriodLabels.length === 0) {
      return {
        columnLabels: [] as string[],
        columnGroups: [] as Array<{ label: string; span: number }>,
        rows: [] as Array<{ label: string; cells: { hasData: boolean; value: number | null }[] }>,
        rowDimension: "service_category" as NahpaDisaggregateDimension,
        columnDimension: "sex" as NahpaDisaggregateDimension,
      };
    }

    const dimensionOrder = selectedIndicatorDisaggregateProfile.dimensions.map((dimension) =>
      normalizeDimensionKey(String(dimension.key)),
    );
    const availableDimensionKeys = new Set(dimensionOrder);
    const requestedRowDimension = normalizeDimensionKey(
      String(nahpaSettings.disaggregate.dimensions[0] || dimensionOrder[0] || "service_category"),
    );
    const rowDimension = availableDimensionKeys.has(requestedRowDimension)
      ? requestedRowDimension
      : dimensionOrder[0];
    const requestedColumnDimension = normalizeDimensionKey(
      String(nahpaSettings.disaggregate.dimensions[1] || dimensionOrder[1] || "sex"),
    );
    const fallbackColumnDimension =
      dimensionOrder.find((dimension) => dimension !== rowDimension) || dimensionOrder[0];
    const columnDimension =
      requestedColumnDimension !== rowDimension && availableDimensionKeys.has(requestedColumnDimension)
        ? requestedColumnDimension
        : fallbackColumnDimension;

    const configuredRowValues =
      selectedIndicatorDisaggregateProfile.dimensions.find(
        (dimension) => normalizeDimensionKey(String(dimension.key)) === rowDimension,
      )?.values ?? [];
    const configuredColumnValues =
      selectedIndicatorDisaggregateProfile.dimensions.find(
        (dimension) => normalizeDimensionKey(String(dimension.key)) === columnDimension,
      )?.values ?? [];

    const matrix = new Map<string, Map<string, number>>();
    const periodColumns: Array<{ period: string; value: string; key: string }> = [];
    const columnValueSet = new Set<string>(configuredColumnValues);
    const periodHasData = new Map<string, boolean>();
    const rowValueSet = new Set<string>(configuredRowValues);

    chartPeriodLabels.forEach((periodLabel) => {
      periodHasData.set(periodLabel, false);
      const relevant = selectedDisaggregateIndicatorAggregates.filter(
        (aggregate) => getAggregateLabelForCurrentMode(aggregate) === periodLabel,
      );
      if (relevant.length === 0) return;

      periodHasData.set(periodLabel, true);

      relevant.forEach((aggregate) => {
        const records = buildDisaggregateRecords(
          getDisaggregatesMap(aggregate.value),
          dimensionOrder,
        );
        records.forEach((record) => {
          const rowValue = getRecordDimensionValue(record, rowDimension) || "All";
          const columnValue = getRecordDimensionValue(record, columnDimension) || "All";
          columnValueSet.add(columnValue);
          rowValueSet.add(rowValue);
          const columnKey = `${columnValue} | ${periodLabel}`;
          if (!matrix.has(rowValue)) matrix.set(rowValue, new Map<string, number>());
          const current = matrix.get(rowValue)!.get(columnKey) || 0;
          matrix.get(rowValue)!.set(columnKey, current + record.value);
        });
      });
    });

    const columnValues = sortDimensionValues(Array.from(columnValueSet), columnDimension);
    const columnGroups = chartPeriodLabels.map((periodLabel) => ({
      label: periodLabel,
      span: columnValues.length,
    }));
    chartPeriodLabels.forEach((periodLabel) => {
      columnValues.forEach((value) => {
        periodColumns.push({
          period: periodLabel,
          value,
          key: `${value} | ${periodLabel}`,
        });
      });
    });

    const rows = sortDimensionValues(Array.from(rowValueSet), rowDimension)
      .map((rowValue) => ({
        label: rowValue,
        cells: periodColumns.map((columnMeta) => {
          const hasPeriodData = Boolean(periodHasData.get(columnMeta.period));
          if (!hasPeriodData) return { hasData: false, value: null };
          return {
            hasData: true,
            value: matrix.get(rowValue)?.get(columnMeta.key) || 0,
          };
        }),
      }));

    const columnLabels = periodColumns.map((columnMeta) => columnMeta.value);

    return { columnLabels, columnGroups, rows, rowDimension, columnDimension };
  }, [
    chartPeriodLabels,
    getAggregateLabelForCurrentMode,
    nahpaSettings.disaggregate.dimensions,
    nahpaSettings.disaggregate.layout,
    selectedIndicatorDisaggregateProfile,
    selectedDisaggregateIndicatorAggregates,
    selectedDisaggregateIndicatorId,
  ]);

  const reportPeriodModeForCharts = reportDateMode === "dates"
    ? "dates"
    : (reportDateMode as AggregatePeriodMode);

  const summarySectionRows = useMemo(
    () =>
      buildCategoryRowsFromAggregates({
        aggregates,
        periodMode: reportPeriodModeForCharts,
        selectedPeriodLabels: chartPeriodLabels,
        rangeLabel: activeRangeLabel,
        categories: NAHPA_SUMMARY_SECTION_CONFIG,
      }),
    [aggregates, activeRangeLabel, chartPeriodLabels, reportPeriodModeForCharts],
  );

  const testingServicesRows = useMemo(
    () =>
      buildCategoryRowsFromAggregates({
        aggregates,
        periodMode: reportPeriodModeForCharts,
        selectedPeriodLabels: chartPeriodLabels,
        rangeLabel: activeRangeLabel,
        categories: NAHPA_TESTING_SERVICES_CONFIG,
      }),
    [aggregates, activeRangeLabel, chartPeriodLabels, reportPeriodModeForCharts],
  );

  const focusedIndicatorGroup = useMemo(
    () =>
      NAHPA_INDICATOR_GROUP_OPTIONS.find(
        (option) => option.value === nahpaSettings.indicator.indicatorGroup,
      ) || NAHPA_INDICATOR_GROUP_OPTIONS[0],
    [nahpaSettings.indicator.indicatorGroup],
  );

  const focusedIndicatorRows = useMemo(() => {
    if (!focusedIndicatorGroup) return [];
    const aliasFilter = (indicatorName: string) =>
      indicatorNameMatchesAliases(indicatorName, focusedIndicatorGroup.aliases);

    if (nahpaSettings.indicator.groupBy === "indicator") {
      return buildIndicatorRowsFromAggregates({
        aggregates,
        periodMode: reportPeriodModeForCharts,
        selectedPeriodLabels: chartPeriodLabels,
        rangeLabel: activeRangeLabel,
        indicatorFilter: aliasFilter,
        indicatorLabelById: indicatorChartLabelById,
        maxRows: 25,
      });
    }

    return buildCategoryRowsFromAggregates({
      aggregates,
      periodMode: reportPeriodModeForCharts,
      selectedPeriodLabels: chartPeriodLabels,
      rangeLabel: activeRangeLabel,
      categories: [
        {
          id: focusedIndicatorGroup.value,
          label: focusedIndicatorGroup.label,
          color:
            FOCUSED_GROUP_COLORS[focusedIndicatorGroup.value] || "#1f6a8a",
          aliases: focusedIndicatorGroup.aliases,
        },
      ],
      indicatorFilter: aliasFilter,
    });
  }, [
    activeRangeLabel,
    aggregates,
    chartPeriodLabels,
    focusedIndicatorGroup,
    indicatorChartLabelById,
    nahpaSettings.indicator.groupBy,
    reportPeriodModeForCharts,
  ]);

  const organizationComparisonRows = useMemo(() => {
    if (!nahpaSettings.comparison.enabled) return [];
    if (nahpaSettings.comparison.compareBy !== "organization") return [];
    if (chartPeriodLabels.length === 0) return [];
    if (!focusedIndicatorGroup) return [];

    const periodSet = new Set(chartPeriodLabels);
    const periodHasData = new Map<string, boolean>();
    chartPeriodLabels.forEach((periodLabel) => periodHasData.set(periodLabel, false));
    const totalsByOrganization = new Map<
      string,
      { color: string; byPeriod: Map<string, { total: number; rowCount: number }> }
    >();

    const aliasFilter = (indicatorName: string) =>
      indicatorNameMatchesAliases(indicatorName, focusedIndicatorGroup.aliases);

    aggregates.forEach((aggregate) => {
      const indicatorName = String(aggregate.indicator_name || "");
      if (!aliasFilter(indicatorName)) return;

      const periodLabel = getAggregateLabelForCurrentMode(aggregate);
      if (!periodLabel || !periodSet.has(periodLabel)) return;

      periodHasData.set(periodLabel, true);
      const organizationName =
        organizationById.get(String(aggregate.organization))?.name ||
        `Organization ${aggregate.organization}`;
      if (!totalsByOrganization.has(organizationName)) {
        totalsByOrganization.set(organizationName, {
          color: "#1f6a8a",
          byPeriod: new Map<string, { total: number; rowCount: number }>(),
        });
      }
      const periodTotals = totalsByOrganization.get(organizationName)!.byPeriod;
      const current = periodTotals.get(periodLabel) || { total: 0, rowCount: 0 };
      current.total += extractAggregateTotal(aggregate.value);
      current.rowCount += 1;
      periodTotals.set(periodLabel, current);
    });

    return Array.from(totalsByOrganization.entries())
      .sort((left, right) => {
        const leftTotal = Array.from(left[1].byPeriod.values()).reduce(
          (sum, cell) => sum + cell.total,
          0,
        );
        const rightTotal = Array.from(right[1].byPeriod.values()).reduce(
          (sum, cell) => sum + cell.total,
          0,
        );
        return rightTotal - leftTotal;
      })
      .slice(0, 12)
      .map(([organizationName, stats], index) => ({
        label: organizationName,
        color: reportChartPalette[index % reportChartPalette.length],
        byPeriod: chartPeriodLabels.reduce<
          Record<string, { hasData: boolean; value: number | null }>
        >((accumulator, periodLabel) => {
          if (!periodHasData.get(periodLabel)) {
            accumulator[periodLabel] = { hasData: false, value: null };
            return accumulator;
          }
          const periodValue = stats.byPeriod.get(periodLabel);
          if (!periodValue || periodValue.rowCount === 0) {
            accumulator[periodLabel] = { hasData: false, value: null };
            return accumulator;
          }
          accumulator[periodLabel] = { hasData: true, value: periodValue.total };
          return accumulator;
        }, {}),
      }));
  }, [
    aggregates,
    chartPeriodLabels,
    focusedIndicatorGroup,
    getAggregateLabelForCurrentMode,
    nahpaSettings.comparison.compareBy,
    nahpaSettings.comparison.enabled,
    organizationById,
  ]);

  const reportStatusCounts = useMemo(() => {
    const statusMap = new Map<string, number>();
    reports.forEach((report) => {
      statusMap.set(report.status, (statusMap.get(report.status) || 0) + 1);
    });
    return Array.from(statusMap.entries()).map(([name, value], index) => ({
      name,
      value,
      color: reportChartPalette[index % reportChartPalette.length],
    }));
  }, [reports]);

  const indicatorBreakdown = useMemo(() => {
    const categories = new Map<string, number>();
    indicators.forEach((indicator) => {
      const category = indicator.category || "hiv_prevention";
      categories.set(category, (categories.get(category) || 0) + 1);
    });
    return Array.from(categories.entries()).map(([name, value]) => ({
      name,
      value,
      color: categoryColors[name] || "hsl(var(--muted))",
      label: categoryLabels[name] || name,
    }));
  }, [indicators]);

  const genderData = useMemo(() => {
    const entries = respondentStats?.by_gender || [];
    return entries.map((entry: { gender: string | null; count: number }, index) => ({
      name: entry.gender || "Unknown",
      value: entry.count,
      color: reportChartPalette[index % reportChartPalette.length],
    }));
  }, [respondentStats]);

  const selectedPeriodSet = useMemo(
    () => new Set(nahpaSettings.period.selectedPeriods),
    [nahpaSettings.period.selectedPeriods],
  );

  const togglePeriodSelection = useCallback((periodLabel: string, checked: boolean) => {
    setNahpaSettings((previous) => {
      const existingSet = new Set(previous.period.selectedPeriods);
      if (checked) existingSet.add(periodLabel);
      else existingSet.delete(periodLabel);
      return {
        ...previous,
        period: {
          ...previous.period,
          selectedPeriods: availablePeriodOptions.filter((label) => existingSet.has(label)),
        },
      };
    });
  }, [availablePeriodOptions]);

  const handleDownload = async (report: Report) => {
    try {
      const format = (report?.parameters?.format as "pdf" | "excel" | "csv") || "excel";
      const blob = await reportsService.download(report.id, format);
      const ext = format === "excel" ? "xlsx" : format === "csv" ? "csv" : "pdf";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${report?.name || `report-${report.id}`}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download report", err);
      toast({
        title: "Download failed",
        description: "Unable to download report.",
        variant: "destructive",
      });
    }
  };

  const openViewer = (report: Report) => {
    setActiveReport(report);
    setViewOpen(true);
  };

  const refreshActiveReport = async () => {
    if (!activeReport?.id) return;
    setIsGenerating(true);
    try {
      const updated = await reportsService.generate(activeReport.id);
      setActiveReport(updated);
      mutateReports();
    } catch (err) {
      console.error("Failed to generate report", err);
      toast({
        title: "Error",
        description: "Failed to generate report data.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateSchedule = async () => {
    if (!reportName) {
      toast({
        title: "Missing report name",
        description: "Please provide a name for the scheduled report.",
        variant: "destructive",
      });
      return;
    }
    setIsScheduling(true);
    try {
      const recipients = scheduleRecipients
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      await reportsService.createScheduled({
        report_name: reportName,
        report_type: reportType,
        frequency: scheduleFrequency,
        recipients,
        parameters: { format: "excel" },
      });
      toast({
        title: "Schedule saved",
        description: "Scheduled report created.",
      });
      setIsScheduleOpen(false);
      setScheduleRecipients("");
      mutateScheduled();
    } catch (err) {
      console.error("Failed to schedule report", err);
      toast({
        title: "Error",
        description: "Failed to create scheduled report.",
        variant: "destructive",
      });
    } finally {
      setIsScheduling(false);
    }
  };

  const handlePrint = () => {
    if (typeof window === "undefined") return;
    window.print();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Dialog open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Calendar className="mr-2 h-4 w-4" />
                Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Schedule Report</DialogTitle>
                <DialogDescription>
                  Create a recurring report with the same filters.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="schedule-name">Report Name</Label>
                  <Input
                    id="schedule-name"
                    value={reportName}
                    onChange={(e) => setReportName(e.target.value)}
                    placeholder="Monthly Summary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schedule-type">Type</Label>
                  <Select value={reportType} onValueChange={(value) => setReportType(value as typeof reportType)}>
                    <SelectTrigger id="schedule-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="indicator_summary">Indicator Summary</SelectItem>
                      <SelectItem value="project_progress">Project Progress</SelectItem>
                      <SelectItem value="respondent_demographics">Respondent Demographics</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schedule-frequency">Frequency</Label>
                  <Select value={scheduleFrequency} onValueChange={(value) => setScheduleFrequency(value as typeof scheduleFrequency)}>
                    <SelectTrigger id="schedule-frequency">
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schedule-recipients">Recipients (comma separated)</Label>
                  <Input
                    id="schedule-recipients"
                    value={scheduleRecipients}
                    onChange={(e) => setScheduleRecipients(e.target.value)}
                    placeholder="user1@example.com, user2@example.com"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsScheduleOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateSchedule} disabled={isScheduling}>
                  {isScheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Schedule
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <ReportBuilderDialog
            onCreated={() => mutateReports()}
            trigger={
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Generate Report
              </Button>
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={String(project.id)}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <Calendar className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2025">2025</SelectItem>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Total Respondents</CardDescription>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.total_respondents ?? 0}</div>
            <p className="text-xs text-muted-foreground">Registered respondents</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Active Projects</CardDescription>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.active_projects ?? 0}</div>
            <p className="text-xs text-muted-foreground">Currently running</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Indicators</CardDescription>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats?.total_indicators ?? indicators.length}</div>
            <p className="text-xs text-muted-foreground">
              Across {projects.length} projects
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Flags Behind</CardDescription>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{dashboardStats?.indicators_behind ?? 0}</div>
            <p className="text-xs text-muted-foreground">Indicators behind target</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="performance">
            <TrendingUp className="mr-2 h-4 w-4" />
            Performance
          </TabsTrigger>
          <TabsTrigger value="social-contracting">
            <BarChart3 className="mr-2 h-4 w-4" />
            Social Contracting
          </TabsTrigger>
          <TabsTrigger value="indicators">
            <PieChart className="mr-2 h-4 w-4" />
            Indicators
          </TabsTrigger>
          <TabsTrigger value="demographics">
            <Users className="mr-2 h-4 w-4" />
            Demographics
          </TabsTrigger>
          <TabsTrigger value="saved">
            <FileText className="mr-2 h-4 w-4" />
            Saved Reports
          </TabsTrigger>
          <TabsTrigger value="scheduled">
            <Calendar className="mr-2 h-4 w-4" />
            Scheduled
          </TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>Report Status</CardTitle>
                  <CardDescription>Generated reports by status</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadChartSvg("report-status-chart", "report-status")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Chart
                </Button>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" id="report-status-chart">
                  {reportStatusCounts.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      No reports generated yet.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reportStatusCounts}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                        <YAxis stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Bar
                          dataKey="value"
                          radius={[4, 4, 0, 0]}
                          fillOpacity={0.85}
                          stroke="rgba(16, 24, 40, 0.2)"
                          strokeWidth={1}
                          barSize={30}
                        >
                          {reportStatusCounts.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest dashboard activity</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(dashboardStats?.recent_activity || []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No recent activity yet.
                  </div>
                ) : (
                  dashboardStats?.recent_activity.map((item, index) => (
                    <div key={`${item.type}-${index}`} className="flex items-start gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <Clock className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm">{item.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(item.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="social-contracting" className="space-y-4">
          <section className="space-y-4 border border-[#c6c6c6] bg-white p-4">
            <div>
              <h2 className="text-[18px] font-semibold text-[#1f4e79]">Social Contracting Report</h2>
              <p className="text-sm text-[#6b7280]">
                Live aggregate and disaggregated values for selected project, organization, and period.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label>Project</Label>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Organization</Label>
                <OrganizationSelect
                  organizations={organizations}
                  value={reportOrgId}
                  onChange={setReportOrgId}
                  includeAll
                  allLabel="All organizations"
                  placeholder="Select organization"
                />
              </div>

              <div className="space-y-2">
                <Label>Period Mode</Label>
                <Select value={reportDateMode} onValueChange={(value) => setReportDateMode(value as "dates" | "month" | "quarter" | "year")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select period mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Month</SelectItem>
                    <SelectItem value="quarter">Quarter</SelectItem>
                    <SelectItem value="year">Year</SelectItem>
                    <SelectItem value="dates">Custom dates</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {reportDateMode !== "dates" ? (
                <div className="space-y-2">
                  <Label>{reportDateMode === "month" ? "Month Selection" : reportDateMode === "year" ? "Year Selection" : "Quarter Selection"}</Label>
                  <div className="space-y-2">
                    <div className="max-h-[180px] space-y-1 overflow-y-auto border border-[#d4d4d4] p-2">
                      {availablePeriodOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No periods found from live aggregate data.</p>
                      ) : (
                        availablePeriodOptions.map((periodOption) => (
                          <label key={`period-${periodOption}`} className="flex items-center gap-2 text-xs text-[#374151]">
                            <Checkbox
                              checked={selectedPeriodSet.has(periodOption)}
                              onCheckedChange={(checked) =>
                                togglePeriodSelection(periodOption, Boolean(checked))
                              }
                            />
                            <span>{periodOption}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setNahpaSettings((previous) => ({
                            ...previous,
                            period: {
                              ...previous.period,
                              selectedPeriods: [...availablePeriodOptions],
                            },
                          }))
                        }
                      >
                        Select all periods
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setNahpaSettings((previous) => ({
                            ...previous,
                            period: {
                              ...previous.period,
                              selectedPeriods:
                                availablePeriodOptions.length > 0
                                  ? [availablePeriodOptions[availablePeriodOptions.length - 1]]
                                  : [],
                            },
                          }))
                        }
                      >
                        Latest period
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Date Range</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="date" value={reportRangeFrom} onChange={(event) => setReportRangeFrom(event.target.value)} />
                    <Input type="date" value={reportRangeTo} onChange={(event) => setReportRangeTo(event.target.value)} />
                  </div>
                </div>
              )}
            </div>

            {reportOrgId !== "all" && canUseSubgranteeScope ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-center justify-between border border-[#d4d4d4] px-3 py-2">
                  <div>
                    <Label className="text-sm">Include sub-grantees</Label>
                    <p className="text-xs text-muted-foreground">
                      Consolidate the selected coordinator with all descendant organizations.
                    </p>
                  </div>
                  <Switch checked={includeSubgrantees} onCheckedChange={setIncludeSubgrantees} />
                </div>
                <div className="space-y-2">
                  <Label>Descendant organization filter</Label>
                  <OrganizationMultiSelect
                    organizations={coordinatorScopeOptions.map((organization) => ({
                      id: String(organization.id),
                      name: organization.name,
                    }))}
                    selectedIds={selectedSubgranteeIds}
                    onChange={setSelectedSubgranteeIds}
                    allLabel="All descendants"
                    disabled={!includeSubgrantees || coordinatorScopeOptions.length === 0}
                  />
                  {coordinatorScopeOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No linked descendant organizations found for this coordinator.</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2 border border-[#d4d4d4] p-3">
                <Label>Indicator Group</Label>
                <Select
                  value={nahpaSettings.indicator.indicatorGroup}
                  onValueChange={(value) =>
                    setNahpaSettings((previous) => ({
                      ...previous,
                      indicator: {
                        ...previous.indicator,
                        indicatorGroup: value,
                      },
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select group" />
                  </SelectTrigger>
                  <SelectContent>
                    {NAHPA_INDICATOR_GROUP_OPTIONS.map((groupOption) => (
                      <SelectItem key={groupOption.value} value={groupOption.value}>
                        {groupOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={nahpaSettings.indicator.groupBy}
                  onValueChange={(value) =>
                    setNahpaSettings((previous) => ({
                      ...previous,
                      indicator: {
                        ...previous.indicator,
                        groupBy: value as "category" | "indicator",
                      },
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Group by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="category">Group by category</SelectItem>
                    <SelectItem value="indicator">Group by indicator</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 border border-[#d4d4d4] p-3">
                <div className="flex items-center justify-between">
                  <Label>Disaggregates</Label>
                  <Badge variant="outline" className="capitalize">
                    {selectedIndicatorDisaggregateProfile.state}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedDisaggregateIndicatorId === "all"
                    ? "Select an indicator to load its disaggregate structure."
                    : selectedIndicatorDisaggregateProfile.state === "none"
                      ? "This indicator is total-only. Disaggregate controls are hidden."
                      : selectedIndicatorDisaggregateProfile.state === "single"
                        ? `Single disaggregate: ${selectedIndicatorDisaggregateProfile.dimensions[0]?.label || "Dimension"}.`
                        : "Multiple disaggregates detected. Matrix view is the default report layout."}
                </p>
                {selectedIndicatorDisaggregateProfile.hasDisaggregates ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-1">
                      {selectedIndicatorDisaggregateProfile.dimensions.map((dimension) => (
                        <div key={`dim-${dimension.key}`} className="rounded border border-[#d4d4d4] px-2 py-1 text-xs text-[#374151]">
                          {dimension.label}
                        </div>
                      ))}
                    </div>

                    {selectedIndicatorDisaggregateProfile.state === "multi" ? (
                      <>
                        <div className="grid grid-cols-1 gap-2">
                          <Label className="text-xs">Row dimension</Label>
                          <Select
                            value={String(
                              nahpaSettings.disaggregate.dimensions[0] ||
                                selectedIndicatorDisaggregateProfile.dimensions[0]?.key ||
                                "",
                            )}
                            onValueChange={(value) =>
                              setNahpaSettings((previous) => {
                                const currentColumn = normalizeDimensionKey(
                                  String(
                                    previous.disaggregate.dimensions[1] ||
                                      selectedIndicatorDisaggregateProfile.dimensions[1]?.key ||
                                      "",
                                  ),
                                );
                                const nextRow = normalizeDimensionKey(value);
                                const fallbackColumn =
                                  selectedIndicatorDisaggregateProfile.dimensions
                                    .map((dimension) => normalizeDimensionKey(String(dimension.key)))
                                    .find((key) => key !== nextRow) || nextRow;
                                const nextColumn = currentColumn !== nextRow ? currentColumn : fallbackColumn;
                                const nextDimensions: NahpaDisaggregateDimension[] = [nextRow, nextColumn];
                                return {
                                  ...previous,
                                  disaggregate: {
                                    ...previous.disaggregate,
                                    dimensions: nextDimensions,
                                    layout: "matrix",
                                    enabled: true,
                                  },
                                };
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Row dimension" />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedIndicatorDisaggregateProfile.dimensions.map((dimension) => (
                                <SelectItem key={`row-dim-${dimension.key}`} value={String(dimension.key)}>
                                  {dimension.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                          <Label className="text-xs">Column dimension</Label>
                          <Select
                            value={String(
                              nahpaSettings.disaggregate.dimensions[1] ||
                                selectedIndicatorDisaggregateProfile.dimensions[1]?.key ||
                                selectedIndicatorDisaggregateProfile.dimensions[0]?.key ||
                                "",
                            )}
                            onValueChange={(value) =>
                              setNahpaSettings((previous) => {
                                const currentRow = normalizeDimensionKey(
                                  String(
                                    previous.disaggregate.dimensions[0] ||
                                      selectedIndicatorDisaggregateProfile.dimensions[0]?.key ||
                                      "",
                                  ),
                                );
                                const nextColumn = normalizeDimensionKey(value);
                                const fallbackRow =
                                  selectedIndicatorDisaggregateProfile.dimensions
                                    .map((dimension) => normalizeDimensionKey(String(dimension.key)))
                                    .find((key) => key !== nextColumn) || nextColumn;
                                const nextRow = currentRow !== nextColumn ? currentRow : fallbackRow;
                                const nextDimensions: NahpaDisaggregateDimension[] = [nextRow, nextColumn];
                                return {
                                  ...previous,
                                  disaggregate: {
                                    ...previous.disaggregate,
                                    dimensions: nextDimensions,
                                    layout: "matrix",
                                    enabled: true,
                                  },
                                };
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Column dimension" />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedIndicatorDisaggregateProfile.dimensions.map((dimension) => (
                                <SelectItem key={`column-dim-${dimension.key}`} value={String(dimension.key)}>
                                  {dimension.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2 border border-[#d4d4d4] p-3">
                <div className="flex items-center justify-between">
                  <Label>Comparison</Label>
                  <Switch
                    checked={nahpaSettings.comparison.enabled}
                    onCheckedChange={(checked) =>
                      setNahpaSettings((previous) => ({
                        ...previous,
                        comparison: {
                          ...previous.comparison,
                          enabled: checked,
                        },
                      }))
                    }
                  />
                </div>
                <Select
                  value={nahpaSettings.comparison.compareBy}
                  onValueChange={(value) =>
                    setNahpaSettings((previous) => ({
                      ...previous,
                      comparison: {
                        ...previous.comparison,
                        compareBy: value as "period" | "organization",
                      },
                    }))
                  }
                  disabled={!nahpaSettings.comparison.enabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Compare by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="period">Compare by period</SelectItem>
                    <SelectItem value="organization">Compare by organization</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={nahpaSettings.display.chartType}
                  onValueChange={(value) =>
                    setNahpaSettings((previous) => ({
                      ...previous,
                      display: {
                        ...previous.display,
                        chartType: value as "clustered-bar" | "grouped-bar",
                      },
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chart type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clustered-bar">Clustered bar</SelectItem>
                    <SelectItem value="grouped-bar">Grouped bar</SelectItem>
                  </SelectContent>
                </Select>

                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={nahpaSettings.targets.showAchievement}
                      onCheckedChange={(checked) =>
                        setNahpaSettings((previous) => ({
                          ...previous,
                          targets: {
                            ...previous.targets,
                            showAchievement: Boolean(checked),
                          },
                        }))
                      }
                    />
                    <span>Show achieved</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={nahpaSettings.targets.showTargets}
                      onCheckedChange={(checked) =>
                        setNahpaSettings((previous) => ({
                          ...previous,
                          targets: {
                            ...previous.targets,
                            showTargets: Boolean(checked),
                          },
                        }))
                      }
                    />
                    <span>Show targets</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={nahpaSettings.targets.showPerformancePercent}
                      onCheckedChange={(checked) =>
                        setNahpaSettings((previous) => ({
                          ...previous,
                          targets: {
                            ...previous.targets,
                            showPerformancePercent: Boolean(checked),
                          },
                        }))
                      }
                    />
                    <span>Show performance %</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={nahpaSettings.display.showLegend}
                      onCheckedChange={(checked) =>
                        setNahpaSettings((previous) => ({
                          ...previous,
                          display: {
                            ...previous.display,
                            showLegend: Boolean(checked),
                          },
                        }))
                      }
                    />
                    <span>Show legend</span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <ReportBarChart
              title="Section 1: Summary Indicators (Totals)"
              yAxisLabel={nahpaSettings.display.yAxisLabel}
              periodLabels={chartPeriodLabels}
              rows={summarySectionRows}
              chartId="nahpa-summary-indicators-chart"
              chartType={nahpaSettings.display.chartType}
              showLegend={nahpaSettings.display.showLegend}
            />

            <ReportBarChart
              title={`Focused Group View: ${focusedIndicatorGroup?.label || "Indicator Group"}`}
              yAxisLabel={nahpaSettings.display.yAxisLabel}
              periodLabels={chartPeriodLabels}
              rows={focusedIndicatorRows}
              chartId="nahpa-focused-group-chart"
              chartType={nahpaSettings.display.chartType}
              showLegend={nahpaSettings.display.showLegend}
            />

            {organizationComparisonRows.length > 0 ? (
              <ReportBarChart
                title={`Organization Comparison: ${focusedIndicatorGroup?.label || "Indicator Group"}`}
                yAxisLabel={nahpaSettings.display.yAxisLabel}
                periodLabels={chartPeriodLabels}
                rows={organizationComparisonRows}
                chartId="nahpa-organization-comparison-chart"
                chartType="grouped-bar"
                showLegend={nahpaSettings.display.showLegend}
              />
            ) : null}

            <NcdMessageTypeChart
              aggregates={aggregates}
              periodMode={reportPeriodModeForCharts}
              selectedPeriodLabels={chartPeriodLabels}
              rangeLabel={activeRangeLabel}
              chartId="ncd-message-type-chart"
              yAxisLabel={nahpaSettings.display.yAxisLabel}
              chartType={nahpaSettings.display.chartType}
              showLegend={nahpaSettings.display.showLegend}
            />

            <HivMessageTypeChart
              aggregates={aggregates}
              periodMode={reportPeriodModeForCharts}
              selectedPeriodLabels={chartPeriodLabels}
              rangeLabel={activeRangeLabel}
              chartId="hiv-message-type-chart"
              yAxisLabel={nahpaSettings.display.yAxisLabel}
              chartType={nahpaSettings.display.chartType}
              showLegend={nahpaSettings.display.showLegend}
            />

            <ReportBarChart
              title="Section 4: Testing & Services"
              yAxisLabel={nahpaSettings.display.yAxisLabel}
              periodLabels={chartPeriodLabels}
              rows={testingServicesRows}
              chartId="testing-services-chart"
              chartType={nahpaSettings.display.chartType}
              showLegend={nahpaSettings.display.showLegend}
            />

            <ReportTargetChart
              title="Section 6: Targets vs Achievement"
              yAxisLabel={nahpaSettings.display.yAxisLabel}
              chartId="target-vs-achievement-chart"
              rows={targetComparisonRows}
              showAchievement={nahpaSettings.targets.showAchievement}
              showTargets={nahpaSettings.targets.showTargets}
              showPerformancePercent={nahpaSettings.targets.showPerformancePercent}
            />

            <section className="space-y-3 border border-[#c6c6c6] bg-white p-4">
              <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)] md:items-end">
                <div className="space-y-2">
                  <Label>Indicator-specific report view</Label>
                  <Select
                    value={selectedDisaggregateIndicatorId}
                    onValueChange={setSelectedDisaggregateIndicatorId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select indicator" />
                    </SelectTrigger>
                    <SelectContent>
                      {disaggregateIndicatorOptions.length === 0 ? (
                        <SelectItem value="all">No indicators in current scope</SelectItem>
                      ) : (
                        disaggregateIndicatorOptions.map((option) => (
                          <SelectItem key={`disagg-${option.id}`} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedDisaggregateIndicatorId === "all"
                    ? "Select an indicator to render indicator-aware report visualizations."
                    : selectedIndicatorDisaggregateProfile.state === "none"
                      ? "This indicator has no disaggregates. Rendering totals and target/achievement only."
                      : selectedIndicatorDisaggregateProfile.state === "single"
                        ? `Single disaggregate detected (${selectedIndicatorDisaggregateProfile.dimensions[0]?.label || "Dimension"}).`
                        : `Multiple disaggregates detected. Matrix layout enabled (${nahpaSettings.disaggregate.layout}).`}
                </div>
              </div>
            </section>

            {selectedDisaggregateIndicatorId === "all" ? (
              <section className="border border-[#c6c6c6] bg-white p-4 text-sm text-[#6b7280]">
                Select an indicator to generate indicator-aware report visuals.
              </section>
            ) : selectedIndicatorDisaggregateProfile.state === "none" ? (
              <>
                <ReportBarChart
                  title={`Indicator Totals: ${selectedDisaggregateIndicatorDisplayName}`}
                  yAxisLabel={nahpaSettings.display.yAxisLabel}
                  periodLabels={chartPeriodLabels}
                  rows={selectedIndicatorSummaryRows}
                  chartId="indicator-total-only-chart"
                  chartType={nahpaSettings.display.chartType}
                  showLegend={nahpaSettings.display.showLegend}
                />
                <ReportTargetChart
                  title={`Target vs Achievement: ${selectedDisaggregateIndicatorDisplayName}`}
                  yAxisLabel={nahpaSettings.display.yAxisLabel}
                  chartId="indicator-total-only-target-chart"
                  rows={selectedIndicatorTargetRows}
                  showAchievement={nahpaSettings.targets.showAchievement}
                  showTargets={nahpaSettings.targets.showTargets}
                  showPerformancePercent={nahpaSettings.targets.showPerformancePercent}
                />
              </>
            ) : (
              <>
                <ReportBarChart
                  title={`Disaggregate Breakdown: ${selectedDisaggregateIndicatorDisplayName}`}
                  yAxisLabel={nahpaSettings.display.yAxisLabel}
                  periodLabels={chartPeriodLabels}
                  rows={disaggregateChartRows}
                  chartId="indicator-disaggregate-breakdown-chart"
                  chartType={nahpaSettings.display.chartType}
                  showLegend={nahpaSettings.display.showLegend}
                />

                <ReportDisaggregateTable
                  title={`Disaggregated Totals by ${getDimensionLabel(
                    normalizeDimensionKey(
                      String(
                        selectedIndicatorDisaggregateProfile.state === "single"
                          ? selectedIndicatorDisaggregateProfile.dimensions[0]?.key || "service_category"
                          : nahpaSettings.disaggregate.dimensions[0] ||
                              selectedIndicatorDisaggregateProfile.dimensions[0]?.key ||
                              "service_category",
                      ),
                    ),
                  )}`}
                  periodLabels={chartPeriodLabels}
                  rows={disaggregateTableRows}
                  titleColumnLabel="Disaggregate"
                />

                {shouldRenderNestedDisaggregateMatrix && selectedIndicatorMergedDisaggregates ? (
                  <ReportNestedDisaggregateMatrix
                    title={`Disaggregate Matrix${periodLabel ? ` - ${periodLabel}` : ""}`}
                    subtitle={
                      selectedOrganization?.name
                        ? `Organization: ${selectedOrganization.name}`
                        : undefined
                    }
                    disaggregates={selectedIndicatorMergedDisaggregates}
                    indicator={selectedDisaggregateIndicator || undefined}
                  />
                ) : null}

                {selectedIndicatorDisaggregateProfile.state === "multi" &&
                nahpaSettings.disaggregate.layout === "matrix" &&
                !shouldRenderNestedDisaggregateMatrix ? (
                  <ReportDisaggregateMatrix
                    title={`Disaggregate Matrix${periodLabel ? ` - ${periodLabel}` : ""}`}
                    rowHeaderLabel={getDimensionLabel(disaggregateMatrixData.rowDimension)}
                    columnLabels={disaggregateMatrixData.columnLabels}
                    columnGroups={chartPeriodLabels.length > 1 ? disaggregateMatrixData.columnGroups : undefined}
                    rows={disaggregateMatrixData.rows}
                  />
                ) : null}
              </>
            )}
          </section>
        </TabsContent>
        <TabsContent value="indicators" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>Indicator Distribution</CardTitle>
                  <CardDescription>Breakdown by indicator category</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadChartSvg("indicator-breakdown-pie", "indicator-distribution")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Chart
                </Button>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" id="indicator-breakdown-pie">
                  {indicatorBreakdown.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      No indicators available.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={indicatorBreakdown}
                          cx="50%"
                          cy="50%"
                          innerRadius={0}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          activeIndex={activeIndicatorIndex ?? undefined}
                          onMouseEnter={(_, index) => setActiveIndicatorIndex(index)}
                          onMouseLeave={() => setActiveIndicatorIndex(null)}
                        >
                          {indicatorBreakdown.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke="hsl(var(--background))" />
                          ))}
                        </Pie>
                        <Tooltip
                          cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {indicatorBreakdown.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span>{item.label}</span>
                      </div>
                      <span className="font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Indicators</CardTitle>
                <CardDescription>Active indicator list</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {indicators.slice(0, 8).map((indicator) => (
                  <div key={indicator.id} className="flex items-start justify-between gap-2 text-sm">
                    <span className="flex-1 min-w-0 break-words leading-snug">{indicator.name}</span>
                    <Badge variant="outline" className="text-xs capitalize shrink-0">
                      {categoryLabels[indicator.category] || indicator.category}
                    </Badge>
                  </div>
                ))}
                {indicators.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    No indicators available.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="demographics" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>Gender Distribution</CardTitle>
                <CardDescription>Respondents by gender</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadChartSvg("gender-distribution-bar", "gender-distribution")}
              >
                <Download className="mr-2 h-4 w-4" />
                Download Chart
              </Button>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]" id="gender-distribution-bar">
                {genderData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    No demographic data available.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={genderData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                      <YAxis stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar
                        dataKey="value"
                        radius={[4, 4, 0, 0]}
                        fillOpacity={0.85}
                        stroke="rgba(16, 24, 40, 0.2)"
                        strokeWidth={1}
                        barSize={30}
                      >
                        {genderData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="saved" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Saved Reports</CardTitle>
              <CardDescription>
                Previously generated reports available for download
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {reports.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No reports generated yet.
                  </div>
                ) : (
                  reports.map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <FileSpreadsheet className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{report.name}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className={statusColors[report.status]}>
                              {report.status}
                            </Badge>
                            <span>{(report.type || "custom").replace("_", " ")}</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(report.created_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openViewer(report)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(report)}
                          disabled={report.status !== "completed"}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <ReportViewerDialog
          open={viewOpen}
          onOpenChange={setViewOpen}
          report={activeReport}
          onRefresh={refreshActiveReport}
          onDownload={() => {
            if (activeReport) return handleDownload(activeReport);
          }}
          refreshing={isGenerating}
        />


        <TabsContent value="scheduled" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Scheduled Reports</CardTitle>
              <CardDescription>Recurring reports created by you or shared.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {scheduledReports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No scheduled reports yet.</p>
              ) : (
                <div className="space-y-2">
                  {scheduledReports.map((report) => (
                    <div
                      key={report.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{report.report_name}</span>
                        <span className="text-muted-foreground">
                          {report.report_type.replace("_", " ")}  -  {report.frequency}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={report.is_active ? "default" : "secondary"}>
                          {report.is_active ? "Active" : "Paused"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}


