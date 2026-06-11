"use client";

/*
 * Deprecated copy: the live /dashboard/aggregates route is implemented in ./page.tsx.
 * Keep aggregate page behavior changes in page.tsx, hooks.ts, and components/aggregates/*.
 */

import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import * as XLSX from "xlsx-js-style";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Plus,
  Search,
  Filter,
  Download,
  Table2,
  BarChart3,
  Calendar,
  Calculator,
  Target,
  Users2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { ReportingWorkbookDialog } from "@/components/aggregates/ReportingWorkbookDialog";
import { aggregatesService } from "@/lib/api";
import {
  useAllAggregates,
  useAggregateTemplates,
  useIndicators,
  useAllOrganizations,
  useProjects,
} from "@/lib/hooks/use-api";
import type { Aggregate, Indicator } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { getUserOrganizationId } from "@/lib/utils/organization";
import { isPlatformAdmin } from "@/lib/permissions";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { normalizeAggregateValueToDisaggregateMap } from "@/lib/aggregates/disaggregate-normalization";
// aggregates-hotfix-build-marker-2026-04-12

type AggregateValue = {
  male?: number;
  female?: number;
  total?: number;
  age_range?: string;
  key_population?: string;
  disaggregates?: Record<
    string,
    Record<string, Record<string, number | undefined>>
  >;
};
type MatrixDisaggregates = Record<
  string,
  Record<string, Record<string, number | undefined>>
>;
type AggregateGroupEntry = {
  key: string;
  indicatorId: string;
  indicatorName: string;
  items: Aggregate[];
  code: string;
};
type DashboardGroup = AggregateGroupEntry & {
  indicator?: Indicator;
  disaggregates: MatrixDisaggregates | null;
  totalValue: number;
  organizations: string[];
  projects: string[];
  periods: string[];
};
type WorkbookTopicDefinition = {
  id: string;
  label: string;
  description: string;
};
type DashboardTopicSection = WorkbookTopicDefinition & {
  groups: DashboardGroup[];
  totalValue: number;
};

const ageRanges = [
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
];

const keyPopulations = [
  "MSM",
  "FSW",
  "PWD",
  "PWID",
  "LGBTQI+",
  "GENERAL POP.",
];
const matrixAgeBands = [...ageRanges, "AYP (10-24)"];
const matrixAgeBandCore = ageRanges;
const aypBandLabel = "AYP (10-24)";
const preferredSecondDimensionOrder = ["Male", "Female", "Other", "Unknown", "All"];
const ageBandLabelMap: Record<string, string> = {
  "10 14": "10-14",
  "15 19": "15-19",
  "20 24": "20-24",
  "25 29": "25-29",
  "30 34": "30-34",
  "35 39": "35-39",
  "40 44": "40-44",
  "45 49": "45-49",
  "50 54": "50-54",
  "55 59": "55-59",
  "60 64": "60-64",
  "65": "65+",
  "65+": "65+",
  "65 plus": "65+",
  "ayp 10 24": "AYP (10-24)",
};
const primaryDisaggregateLabelMap: Record<string, string> = {
  kp: "Key Population",
  "community leaders": "Community Leaders",
  "family planning": "Family Planning",
  "non traditional sites": "Non Traditional Sites",
  "social media platform": "Social Media Platform",
  "ncd screening": "NCD Screening",
};
const primaryDisaggregateOrder = [
  "kp",
  "community leaders",
  "family planning",
  "non traditional sites",
  "social media platform",
  "ncd screening",
];
const matrixColumnWidths = {
  indicator: 210,
  keyPopulation: 140,
  ageSex: 96,
  metric: 56,
};
const workbookTopicDefinitions: WorkbookTopicDefinition[] = [
  {
    id: "capacity",
    label: "Program Management & Capacity Building",
    description: "Training, mentoring, reporting quality, advocacy, and media planning indicators.",
  },
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
    id: "other",
    label: "Other Indicators",
    description: "Indicators that do not map cleanly to a workbook topic yet.",
  },
];

const formatDate = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
};

const getPeriodLabel = (aggregate: Aggregate) =>
  `${formatDate(aggregate.period_start)} - ${formatDate(aggregate.period_end)}`;

const parseAggregateValue = (value: unknown): AggregateValue => {
  if (typeof value === "number") {
    return { total: value };
  }
  if (value && typeof value === "object") {
    return value as AggregateValue;
  }
  return {};
};

const coerceMatrixDisaggregates = (source: unknown): MatrixDisaggregates | null => {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;

  const matrix: MatrixDisaggregates = {};

  Object.entries(source as Record<string, unknown>).forEach(([firstLevel, rawSecondLevel]) => {
    if (!rawSecondLevel || typeof rawSecondLevel !== "object" || Array.isArray(rawSecondLevel)) {
      return;
    }

    const secondLevelEntries: Record<string, Record<string, number | undefined>> = {};

    Object.entries(rawSecondLevel as Record<string, unknown>).forEach(([secondLevel, rawThirdLevel]) => {
      if (rawThirdLevel && typeof rawThirdLevel === "object" && !Array.isArray(rawThirdLevel)) {
        const thirdLevelEntries: Record<string, number | undefined> = {};

        Object.entries(rawThirdLevel as Record<string, unknown>).forEach(([thirdLevel, rawValue]) => {
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
};

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeMatrixText = (value?: string | null) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const summaryLikePrimaryLabels = new Set([
  "total",
  "total male",
  "total female",
  "subtotal",
  "sub total",
]);

const canonicalizePrimaryLabel = (value: string) => {
  const normalized = normalizeMatrixText(value);
  if (normalized === "general population") return "GENERAL POP.";
  if (normalized === "pwids") return "PWID";
  const preferred = keyPopulations.find((entry) => normalizeMatrixText(entry) === normalized);
  return preferred || value;
};

const canonicalizeSecondDimensionLabel = (value: string) => {
  const normalized = normalizeMatrixText(value);
  const preferred = preferredSecondDimensionOrder.find(
    (entry) => normalizeMatrixText(entry) === normalized,
  );
  return preferred || value;
};

const canonicalizeAgeBandLabel = (value: string) =>
  ageBandLabelMap[normalizeMatrixText(value)] || null;

const sanitizeMatrixDisaggregates = (
  source: MatrixDisaggregates | null | undefined,
): MatrixDisaggregates | null => {
  if (!source) return null;

  const sanitized: MatrixDisaggregates = {};

  Object.entries(source).forEach(([rawPrimary, rawSecondLevel]) => {
    if (summaryLikePrimaryLabels.has(normalizeMatrixText(rawPrimary))) return;

    const primary = canonicalizePrimaryLabel(rawPrimary);
    Object.entries(rawSecondLevel || {}).forEach(([rawSecond, rawBands]) => {
      const second = canonicalizeSecondDimensionLabel(rawSecond);
      const sanitizedBands: Record<string, number | undefined> = {};

      Object.entries(rawBands || {}).forEach(([rawBand, rawValue]) => {
        if (normalizeMatrixText(rawBand) === "value") {
          sanitizedBands.Value = toSafeNumber(rawValue);
          return;
        }

        const canonicalBand = canonicalizeAgeBandLabel(rawBand);
        if (!canonicalBand) return;
        sanitizedBands[canonicalBand] = toSafeNumber(rawValue);
      });

      if (Object.keys(sanitizedBands).length === 0) return;
      if (!sanitized[primary]) sanitized[primary] = {};
      sanitized[primary][second] = sanitizedBands;
    });
  });

  return Object.keys(sanitized).length > 0 ? sanitized : null;
};

const getDisaggregates = (value: unknown) => {
  const parsed = parseAggregateValue(value);
  const directDisaggregates = sanitizeMatrixDisaggregates(
    coerceMatrixDisaggregates(parsed.disaggregates),
  );
  const normalizedDisaggregates = sanitizeMatrixDisaggregates(
    coerceMatrixDisaggregates(normalizeAggregateValueToDisaggregateMap(value)),
  );

  return directDisaggregates || normalizedDisaggregates;
};

const sumBands = (
  values: Record<string, number | undefined>,
  bands: string[] = matrixAgeBandCore,
) => bands.reduce((acc, band) => acc + toSafeNumber(values[band]), 0);

const computeAYP = (values: Record<string, number | undefined>) =>
  toSafeNumber(values[aypBandLabel]) ||
  toSafeNumber(values["10-14"]) +
    toSafeNumber(values["15-19"]) +
    toSafeNumber(values["20-24"]);

const sortWithPreferred = (values: string[], preferred: string[]) => {
  const preferredMap = new Map(preferred.map((value, index) => [value.toLowerCase(), index]));
  return [...values].sort((a, b) => {
    const aRank = preferredMap.get(a.toLowerCase()) ?? Number.POSITIVE_INFINITY;
    const bRank = preferredMap.get(b.toLowerCase()) ?? Number.POSITIVE_INFINITY;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });
};

const getIndicatorDisaggregateGroups = (labels?: string[]) =>
  new Set((labels || []).map((value) => value.toLowerCase().trim()));

const inspectDisaggregateShape = (source: MatrixDisaggregates | null | undefined) => {
  if (!source) {
    return {
      hasPrimary: false,
      hasSecondDimension: false,
      hasAge: false,
      primaryLooksLikeKeyPopulation: false,
    };
  }

  const normalizedPrimaryValues = Object.keys(source)
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0 && value !== "all" && value !== "general" && value !== "total");

  const normalizedSecondValues = new Set<string>();
  const normalizedBandValues = new Set<string>();

  Object.values(source).forEach((dimensions) => {
    Object.entries(dimensions || {}).forEach(([dimension, bands]) => {
      const normalizedDimension = normalizeText(dimension);
      if (
        normalizedDimension &&
        normalizedDimension !== "all" &&
        normalizedDimension !== "total"
      ) {
        normalizedSecondValues.add(normalizedDimension);
      }

      Object.keys(bands || {}).forEach((band) => {
        const canonicalBand = canonicalizeAgeBandLabel(band);
        if (canonicalBand) normalizedBandValues.add(canonicalBand);
      });
    });
  });

  const normalizedKeyPopulationSet = new Set(keyPopulations.map((value) => normalizeText(value)));
  const primaryLooksLikeKeyPopulation =
    normalizedPrimaryValues.length > 0 &&
    normalizedPrimaryValues.every((value) => normalizedKeyPopulationSet.has(value));

  return {
    hasPrimary: normalizedPrimaryValues.length > 0,
    hasSecondDimension: normalizedSecondValues.size > 0,
    hasAge: normalizedBandValues.size > 0,
    primaryLooksLikeKeyPopulation,
  };
};

const resolveDisplayDisaggregateGroups = (
  source: MatrixDisaggregates | null | undefined,
  labels?: string[],
) => {
  const indicatorGroups = getIndicatorDisaggregateGroups(labels);
  const shape = inspectDisaggregateShape(source);
  const groups = new Set<string>();

  if (shape.hasPrimary) {
    const primaryGroup = Array.from(indicatorGroups).find(
      (group) => group !== "sex" && group !== "age range",
    );
    if (primaryGroup) groups.add(primaryGroup);
    else if (shape.primaryLooksLikeKeyPopulation) groups.add("kp");
    else groups.add("disaggregate");
  }

  if (shape.hasSecondDimension) {
    groups.add("sex");
  }

  if (shape.hasAge) {
    groups.add("age range");
  }

  return groups;
};

const indicatorUsesMatrixEntry = (labels?: string[]) => {
  const groups = getIndicatorDisaggregateGroups(labels);
  if (groups.size === 0) return true;
  const hasPrimaryGroup = Array.from(groups).some(
    (group) => group !== "sex" && group !== "age range",
  );
  return hasPrimaryGroup || groups.has("sex") || groups.has("age range");
};

const buildDisplayMatrix = (
  source: MatrixDisaggregates,
  groups: Set<string>,
) => {
  const shape = inspectDisaggregateShape(source);
  const hasPrimaryGroup = Array.from(groups).some(
    (group) => group !== "sex" && group !== "age range",
  );
  const includeKeyPopulation = shape.hasPrimary || (groups.size === 0 && hasPrimaryGroup);
  const includeSecondDimension = shape.hasSecondDimension || groups.has("sex");
  const includeAge = shape.hasAge;
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
          bucket[band] = toSafeNumber(bucket[band]) + toSafeNumber(value);
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
    ? sortWithPreferred(Object.keys(matrix), keyPopulations)
    : ["All"];
  const secondDimension = new Set<string>();
  const ageBandSet = new Set<string>();
  let hasAypFromData = false;

  keyPops.forEach((kp) => {
    const row = matrix[kp] || {};
    Object.keys(row).forEach((dimension) => {
      secondDimension.add(dimension);
      Object.keys(row[dimension] || {}).forEach((band) => {
        if (band === aypBandLabel) {
          hasAypFromData = true;
          return;
        }
        ageBandSet.add(band);
      });
    });
  });

  if (secondDimension.size === 0) {
    secondDimension.add("All");
  }

  const secondDimensionValues = includeSecondDimension
    ? sortWithPreferred(Array.from(secondDimension), preferredSecondDimensionOrder)
    : ["All"];

  const hasAgeDefaults = groups.has("age range") && ageBandSet.size === 0;
  const ageBands = includeAge
    ? sortWithPreferred(
        hasAgeDefaults ? matrixAgeBandCore : Array.from(ageBandSet),
        matrixAgeBandCore,
      )
    : ["Value"];
  const showAypColumn =
    includeAge &&
    (hasAypFromData ||
      ageBands.some((band) => band === "10-14" || band === "15-19" || band === "20-24"));

  return {
    matrix,
    keyPops,
    secondDimensionValues,
    ageBands,
    showAypColumn,
  };
};

const getPrimaryDisaggregateLabel = (labels?: string[]) => {
  const groups = getIndicatorDisaggregateGroups(labels);
  for (const key of primaryDisaggregateOrder) {
    if (groups.has(key)) return primaryDisaggregateLabelMap[key];
  }
  return "Disaggregate";
};

const getAggregateTotal = (aggregate: Aggregate) => {
  const value = parseAggregateValue(aggregate.value);
  const male = Number(value.male) || 0;
  const female = Number(value.female) || 0;
  return value.total !== undefined
    ? Number(value.total) || 0
    : male + female;
};

const mergeDisaggregatesForGroup = (items: Aggregate[]) => {
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
};

const parseNumber = (value: string) => {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

type OrganizationWithParent = {
  id: string | number;
  name?: string;
  parentId?: string | number | null;
  parent?: string | number | null;
};

const resolveParentOrganizationId = (org: OrganizationWithParent): string => {
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
};

const buildEmptyMatrix = () => {
  const matrix: Record<string, Record<string, Record<string, string>>> = {};
  for (const kp of keyPopulations) {
    matrix[kp] = { Male: {}, Female: {} };
    for (const band of matrixAgeBands) {
      matrix[kp].Male[band] = "";
      matrix[kp].Female[band] = "";
    }
  }
  return matrix;
};

type DashboardRollupDatum = {
  id: string;
  name: string;
  total: number;
  target: number;
  percentAchieved: number;
  organizations: number;
  indicators: number;
};

type ComplianceDatum = {
  id: string;
  name: string;
  submitted: number;
  late: number;
  missing: number;
  details: Record<"submitted" | "late" | "missing", string[]>;
};

type BreakdownDatum = {
  name: string;
  Male?: number;
  Female?: number;
  Other?: number;
  Total: number;
};

type CascadePreset = {
  id: string;
  label: string;
  stages: Array<{ label: string; patterns: string[] }>;
};

const cascadePresets: CascadePreset[] = [
  {
    id: "art",
    label: "HIV Testing to ART",
    stages: [
      { label: "Tested", patterns: ["tested", "hiv testing"] },
      { label: "Positive", patterns: ["positive"] },
      { label: "Initiated on ART", patterns: ["initiated on art", "art initiated"] },
    ],
  },
  {
    id: "screening",
    label: "Screening to Linkage",
    stages: [
      { label: "Screened", patterns: ["screened", "screening"] },
      { label: "Eligible", patterns: ["eligible"] },
      { label: "Referred", patterns: ["referred", "referral"] },
      { label: "Linked", patterns: ["linked", "linkage"] },
    ],
  },
  {
    id: "wellness",
    label: "Psychoeducation to Counselling",
    stages: [
      { label: "Psychoeducation", patterns: ["psychoeducation"] },
      { label: "Screened", patterns: ["screened", "screening"] },
      { label: "Referred", patterns: ["referred", "referral"] },
      { label: "Counselling", patterns: ["counselling", "counseling"] },
    ],
  },
];

const dashboardSeriesColors = [
  "hsl(var(--primary))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const normalizeText = (value?: string | null) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const includesAnyToken = (value: string, tokens: string[]) =>
  tokens.some((token) => value.includes(token));

const resolveWorkbookTopicId = (group: DashboardGroup): string => {
  const normalizedName = normalizeText(group.indicatorName);
  const indicatorCategory = group.indicator?.category || "";

  if (
    indicatorCategory === "trainings" ||
    includesAnyToken(normalizedName, [
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

  if (
    includesAnyToken(normalizedName, [
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
    indicatorCategory === "mental_health" ||
    includesAnyToken(normalizedName, [
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
    includesAnyToken(normalizedName, [
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

  if (
    indicatorCategory === "gbv" ||
    includesAnyToken(normalizedName, ["gbv", "violence"])
  ) {
    return "gbv";
  }

  if (
    indicatorCategory === "sti" ||
    includesAnyToken(normalizedName, [
      " sti ",
      "stis",
      "screened for stis",
      "screened positive for stis",
      "sti cases linked to care",
      "sti cases referrals completed",
      "symptomatic for tb referred",
    ])
  ) {
    return "sti";
  }

  if (
    indicatorCategory === "ncd" ||
    includesAnyToken(normalizedName, [
      " ncd ",
      "ncds",
      "cancer",
      "tobacco",
      "alcohol",
      "blood pressure",
      "blood glucose",
      "bmi",
      "waist circumference",
      "breast cancer",
      "prostate cancer",
      "cervical cancer",
      "diabetes",
      "healthy lifestyle",
    ])
  ) {
    return "ncd";
  }

  if (
    indicatorCategory === "events" ||
    includesAnyToken(normalizedName, [
      "attended",
      "commemoration activities",
      "day activities",
      "campaigns conducted",
    ])
  ) {
    return "events";
  }

  if (
    indicatorCategory === "media" ||
    indicatorCategory === "hiv_prevention" ||
    includesAnyToken(normalizedName, [
      "hiv testing",
      "prep",
      "pep",
      "hiv treatment",
      "family planning",
      "linked to care",
      "initiated on art",
      "tested for hiv",
      "condom use messages",
      "plwh reached",
      "ayp",
    ])
  ) {
    return "hiv-prevention";
  }

  return "other";
};

const getLogicalIndicatorKey = (aggregate: Aggregate, fallbackName?: string) => {
  const code = normalizeText(aggregate.indicator_code);
  if (code) return `code:${code}`;
  const name = normalizeText(aggregate.indicator_name || fallbackName || "");
  if (name) return `name:${name}`;
  return `id:${String(aggregate.indicator || "")}`;
};

const aggregateStatusRank: Record<string, number> = {
  approved: 5,
  reviewed: 4,
  pending: 3,
  draft: 2,
  flagged: 1,
  rejected: 0,
};

const countDisaggregateEntries = (
  source: MatrixDisaggregates | null | undefined,
) => {
  if (!source) return 0;
  let count = 0;
  Object.values(source).forEach((dimensions) => {
    Object.values(dimensions || {}).forEach((bands) => {
      Object.values(bands || {}).forEach((value) => {
        if (toSafeNumber(value) !== 0) count += 1;
      });
    });
  });
  return count;
};

const getAggregatePreferenceTuple = (aggregate: Aggregate) => [
  aggregateStatusRank[String(aggregate.status || "").toLowerCase()] ?? -1,
  getAggregateTotal(aggregate) !== 0 ? 1 : 0,
  countDisaggregateEntries(getDisaggregates(aggregate.value)),
  new Date(aggregate.updated_at || aggregate.created_at || 0).getTime() || 0,
  new Date(aggregate.created_at || 0).getTime() || 0,
  -toSafeNumber(aggregate.id),
];

const isPreferredAggregate = (candidate: Aggregate, current: Aggregate) => {
  const candidateTuple = getAggregatePreferenceTuple(candidate);
  const currentTuple = getAggregatePreferenceTuple(current);
  for (let index = 0; index < candidateTuple.length; index += 1) {
    if (candidateTuple[index] === currentTuple[index]) continue;
    return candidateTuple[index] > currentTuple[index];
  }
  return false;
};

const dedupeAggregatesByLogicalSubmission = (items: Aggregate[]) => {
  const deduped = new Map<string, Aggregate>();

  items.forEach((aggregate) => {
    const key = [
      getLogicalIndicatorKey(aggregate),
      String(aggregate.organization || ""),
      String(aggregate.project || ""),
      String(aggregate.period_start || ""),
      String(aggregate.period_end || ""),
    ].join("|");

    const existing = deduped.get(key);
    if (!existing || isPreferredAggregate(aggregate, existing)) {
      deduped.set(key, aggregate);
    }
  });

  return Array.from(deduped.values());
};

const sumValueBucket = (values: Record<string, number | undefined>) => {
  const keys = Object.keys(values || {});
  const hasCoreAges = keys.some((key) => matrixAgeBandCore.includes(key));
  const keysToSum = hasCoreAges ? matrixAgeBandCore : keys.filter((key) => key !== aypBandLabel);
  return keysToSum.reduce((sum, key) => sum + toSafeNumber(values[key]), 0);
};

const deriveSexTotals = (value: unknown) => {
  const disaggregates = getDisaggregates(value);
  if (!disaggregates) {
    const parsed = parseAggregateValue(value);
    return {
      male: toSafeNumber(parsed.male),
      female: toSafeNumber(parsed.female),
      total:
        parsed.total !== undefined
          ? toSafeNumber(parsed.total)
          : toSafeNumber(parsed.male) + toSafeNumber(parsed.female),
    };
  }

  let male = 0;
  let female = 0;
  let total = 0;
  Object.values(disaggregates).forEach((dimensions) => {
    Object.entries(dimensions || {}).forEach(([dimension, bands]) => {
      const bucketTotal = sumValueBucket(bands || {});
      total += bucketTotal;
      const normalized = normalizeText(dimension);
      if (normalized === "male") male += bucketTotal;
      if (normalized === "female") female += bucketTotal;
    });
  });

  return { male, female, total };
};

const getHeatColor = (value: number, maxValue: number) => {
  if (value <= 0 || maxValue <= 0) return undefined;
  const intensity = Math.max(0.12, Math.min(0.72, value / maxValue));
  return `rgba(22, 163, 74, ${intensity})`;
};

const sortPeriods = (values: string[]) =>
  [...values].sort((left, right) => {
    const leftDate = new Date(left.split(" - ")[0]).getTime();
    const rightDate = new Date(right.split(" - ")[0]).getTime();
    if (Number.isNaN(leftDate) || Number.isNaN(rightDate)) {
      return left.localeCompare(right);
    }
    return leftDate - rightDate;
  });

const buildRollupData = ({
  aggregates,
  bucketForOrganization,
  bucketNames,
  targetByBucketId,
}: {
  aggregates: Aggregate[];
  bucketForOrganization: Map<string, string>;
  bucketNames: Map<string, string>;
  targetByBucketId: Map<string, number>;
}): DashboardRollupDatum[] => {
  const buckets = new Map<
    string,
    { total: number; organizations: Set<string>; indicators: Set<string> }
  >();

  aggregates.forEach((aggregate) => {
    const bucketId =
      bucketForOrganization.get(String(aggregate.organization)) || String(aggregate.organization);
    if (!buckets.has(bucketId)) {
      buckets.set(bucketId, {
        total: 0,
        organizations: new Set<string>(),
        indicators: new Set<string>(),
      });
    }
    const bucket = buckets.get(bucketId)!;
    bucket.total += getAggregateTotal(aggregate);
    bucket.organizations.add(String(aggregate.organization));
    bucket.indicators.add(String(aggregate.indicator));
  });

  return Array.from(buckets.entries())
    .map(([id, value]) => {
      const target = toSafeNumber(targetByBucketId.get(id));
      return {
        id,
        name: bucketNames.get(id) || id,
        total: value.total,
        target,
        percentAchieved: target > 0 ? (value.total / target) * 100 : 0,
        organizations: value.organizations.size,
        indicators: value.indicators.size,
      };
    })
    .sort((left, right) => right.total - left.total);
};

const buildContributionData = (
  aggregates: Aggregate[],
  organizationNames: Map<string, string>,
  limit = 10,
) => {
  const totals = new Map<string, number>();
  aggregates.forEach((aggregate) => {
    const id = String(aggregate.organization);
    totals.set(id, (totals.get(id) || 0) + getAggregateTotal(aggregate));
  });
  return Array.from(totals.entries())
    .map(([id, total]) => ({
      id,
      name: organizationNames.get(id) || id,
      total,
    }))
    .sort((left, right) => right.total - left.total)
    .slice(0, limit);
};

const buildTrendData = ({
  aggregates,
  indicatorId,
  mode,
  bucketForOrganization,
  bucketNames,
  limit = 5,
}: {
  aggregates: Aggregate[];
  indicatorId: string;
  mode: "consolidated" | "compare";
  bucketForOrganization: Map<string, string>;
  bucketNames: Map<string, string>;
  limit?: number;
}) => {
  const scoped = aggregates.filter((aggregate) => String(aggregate.indicator) === indicatorId);
  const periods = sortPeriods(Array.from(new Set(scoped.map((aggregate) => getPeriodLabel(aggregate)))));
  if (mode === "consolidated") {
    return {
      seriesKeys: ["total"],
      data: periods.map((period) => ({
        period,
        total: scoped
          .filter((aggregate) => getPeriodLabel(aggregate) === period)
          .reduce((sum, aggregate) => sum + getAggregateTotal(aggregate), 0),
      })),
    };
  }

  const bucketTotals = new Map<string, number>();
  scoped.forEach((aggregate) => {
    const bucketId =
      bucketForOrganization.get(String(aggregate.organization)) || String(aggregate.organization);
    bucketTotals.set(bucketId, (bucketTotals.get(bucketId) || 0) + getAggregateTotal(aggregate));
  });
  const seriesKeys = Array.from(bucketTotals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([id]) => id);

  return {
    seriesKeys,
    data: periods.map((period) => {
      const row: Record<string, string | number> = { period };
      seriesKeys.forEach((bucketId) => {
        row[bucketId] = scoped
          .filter(
            (aggregate) =>
              getPeriodLabel(aggregate) === period &&
              (bucketForOrganization.get(String(aggregate.organization)) ||
                String(aggregate.organization)) === bucketId,
          )
          .reduce((sum, aggregate) => sum + getAggregateTotal(aggregate), 0);
      });
      row.total = seriesKeys.reduce((sum, key) => sum + toSafeNumber(row[key]), 0);
      return row;
    }),
    seriesNames: bucketNames,
  };
};

const buildComplianceData = ({
  organizations,
  aggregates,
  organizationNames,
  coordinatorNames,
  coordinatorByOrgId,
  activePeriod,
}: {
  organizations: Array<{ id: string | number; name?: string }>;
  aggregates: Aggregate[];
  organizationNames: Map<string, string>;
  coordinatorNames: Map<string, string>;
  coordinatorByOrgId: Map<string, string>;
  activePeriod: string | null;
}): ComplianceDatum[] => {
  if (!activePeriod) return [];
  const recordsByOrg = new Map<string, Aggregate[]>();
  aggregates
    .filter((aggregate) => getPeriodLabel(aggregate) === activePeriod)
    .forEach((aggregate) => {
      const orgId = String(aggregate.organization);
      if (!recordsByOrg.has(orgId)) recordsByOrg.set(orgId, []);
      recordsByOrg.get(orgId)!.push(aggregate);
    });

  const coordinatorBuckets = new Map<string, ComplianceDatum>();
  organizations.forEach((organization) => {
    const orgId = String(organization.id);
    const coordinatorId = coordinatorByOrgId.get(orgId) || orgId;
    if (!coordinatorBuckets.has(coordinatorId)) {
      coordinatorBuckets.set(coordinatorId, {
        id: coordinatorId,
        name: coordinatorNames.get(coordinatorId) || coordinatorId,
        submitted: 0,
        late: 0,
        missing: 0,
        details: { submitted: [], late: [], missing: [] },
      });
    }
    const bucket = coordinatorBuckets.get(coordinatorId)!;
    const orgRecords = recordsByOrg.get(orgId) || [];
    if (orgRecords.length === 0) {
      bucket.missing += 1;
      bucket.details.missing.push(organizationNames.get(orgId) || orgId);
      return;
    }

    const latestUpdatedAt = orgRecords
      .map((record) => new Date(record.updated_at || record.created_at).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0];
    const periodEnd = orgRecords
      .map((record) => new Date(record.period_end).getTime())
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => right - left)[0];

    if (Number.isFinite(latestUpdatedAt) && Number.isFinite(periodEnd) && latestUpdatedAt > periodEnd) {
      bucket.late += 1;
      bucket.details.late.push(organizationNames.get(orgId) || orgId);
      return;
    }

    bucket.submitted += 1;
    bucket.details.submitted.push(organizationNames.get(orgId) || orgId);
  });

  return Array.from(coordinatorBuckets.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
};

const buildDisaggregateBreakdownData = ({
  disaggregates,
  indicatorGroups,
  mode,
}: {
  disaggregates: MatrixDisaggregates | null;
  indicatorGroups: Set<string>;
  mode: "sex" | "age" | "primary";
}): BreakdownDatum[] => {
  if (!disaggregates) return [];
  const {
    matrix,
    keyPops,
    secondDimensionValues,
    ageBands,
  } = buildDisplayMatrix(disaggregates, indicatorGroups);

  if (mode === "sex") {
    return secondDimensionValues.map((dimension) => {
      const total = keyPops.reduce(
        (sum, kp) => sum + sumValueBucket(matrix[kp]?.[dimension] || {}),
        0,
      );
      return { name: dimension, Total: total };
    });
  }

  if (mode === "age") {
    const baseBands = ageBands.filter((band) => band !== aypBandLabel);
    return baseBands.map((band) => {
      let male = 0;
      let female = 0;
      let other = 0;
      keyPops.forEach((kp) => {
        secondDimensionValues.forEach((dimension) => {
          const value = toSafeNumber(matrix[kp]?.[dimension]?.[band]);
          const normalized = normalizeText(dimension);
          if (normalized === "male") male += value;
          else if (normalized === "female") female += value;
          else other += value;
        });
      });
      return { name: band, Male: male, Female: female, Other: other, Total: male + female + other };
    });
  }

  return keyPops.map((kp) => {
    let male = 0;
    let female = 0;
    let other = 0;
    secondDimensionValues.forEach((dimension) => {
      const total = sumValueBucket(matrix[kp]?.[dimension] || {});
      const normalized = normalizeText(dimension);
      if (normalized === "male") male += total;
      else if (normalized === "female") female += total;
      else other += total;
    });
    return { name: kp, Male: male, Female: female, Other: other, Total: male + female + other };
  });
};

const buildCascadeData = (
  groups: Array<{ indicatorName: string; totalValue: number }>,
  presetId: string,
) => {
  const preset = cascadePresets.find((item) => item.id === presetId) || cascadePresets[0];
  return preset.stages.map((stage) => {
    const match = groups.find((group) => {
      const normalized = normalizeText(group.indicatorName);
      return stage.patterns.some((pattern) => normalized.includes(normalizeText(pattern)));
    });
    return {
      stage: stage.label,
      total: match?.totalValue || 0,
      indicatorName: match?.indicatorName || "No matching indicator",
    };
  });
};

export default function AggregatesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [parentOrgFilter, setParentOrgFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isChartOpen, setIsChartOpen] = useState(false);
  const [isAutoCalcOpen, setIsAutoCalcOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoCalcSubmitting, setIsAutoCalcSubmitting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [formProject, setFormProject] = useState("");
  const [formIndicator, setFormIndicator] = useState("");
  const [formOrganization, setFormOrganization] = useState("");
  const [formTemplate, setFormTemplate] = useState("all");
  const [formPeriodStart, setFormPeriodStart] = useState("");
  const [formPeriodEnd, setFormPeriodEnd] = useState("");
  const [useMatrixEntry, setUseMatrixEntry] = useState(true);
  const [formMale, setFormMale] = useState("");
  const [formFemale, setFormFemale] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formDataSource, setFormDataSource] = useState("");
  const [matrixValues, setMatrixValues] = useState(buildEmptyMatrix);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const comparisonChartRef = useRef<HTMLDivElement | null>(null);
  const targetsChartRef = useRef<HTMLDivElement | null>(null);
  const trendChartRef = useRef<HTMLDivElement | null>(null);
  const contributionChartRef = useRef<HTMLDivElement | null>(null);
  const complianceChartRef = useRef<HTMLDivElement | null>(null);
  const breakdownChartRef = useRef<HTMLDivElement | null>(null);
  const cascadeChartRef = useRef<HTMLDivElement | null>(null);

  const [autoOutputIndicator, setAutoOutputIndicator] = useState("");
  const [autoSourceIndicator, setAutoSourceIndicator] = useState("");
  const [autoOperator, setAutoOperator] = useState<"equals" | "not_equals" | "contains">("equals");
  const [autoMatchValue, setAutoMatchValue] = useState("yes");
  const [autoCountDistinct, setAutoCountDistinct] = useState<"respondent" | "interaction">("respondent");
  const [autoProject, setAutoProject] = useState("");
  const [autoOrganization, setAutoOrganization] = useState("");
  const [autoPeriodStart, setAutoPeriodStart] = useState("");
  const [autoPeriodEnd, setAutoPeriodEnd] = useState("");
  const [autoSaveRule, setAutoSaveRule] = useState(true);
  const [autoSaveAggregate, setAutoSaveAggregate] = useState(true);
  const [autoComputed, setAutoComputed] = useState<number | null>(null);
  const [detailIndicatorId, setDetailIndicatorId] = useState("");
  const [trendMode, setTrendMode] = useState<"consolidated" | "compare">("consolidated");
  const [breakdownMode, setBreakdownMode] = useState<"sex" | "age" | "primary">("age");
  const [selectedCascadeId, setSelectedCascadeId] = useState(cascadePresets[0].id);
  const [complianceSelection, setComplianceSelection] = useState<{
    coordinatorId: string;
    status: "submitted" | "late" | "missing";
  } | null>(null);

  const { data: aggregatesData, isLoading, error, mutate } = useAllAggregates();
  const { data: projectsData } = useProjects();
  const { data: indicatorsData } = useIndicators();
  const { data: organizationsData } = useAllOrganizations();
  const { data: templatesData } = useAggregateTemplates({
    project: formProject || undefined,
    organization: formOrganization || undefined,
  });

  const aggregates = useMemo(() => aggregatesData || [], [aggregatesData]);
  const projects = useMemo(() => projectsData?.results || [], [projectsData?.results]);
  const indicators = useMemo(() => indicatorsData?.results || [], [indicatorsData?.results]);
  const organizations = useMemo(() => organizationsData?.results || [], [organizationsData?.results]);
  const templates = useMemo(() => templatesData || [], [templatesData]);
  const userOrganizationId = useMemo(() => getUserOrganizationId(user), [user]);
  const canReportAcrossOrganizations = useMemo(() => isPlatformAdmin(user), [user]);

  const resetAutoCalcForm = () => {
    setAutoOutputIndicator("");
    setAutoSourceIndicator("");
    setAutoOperator("equals");
    setAutoMatchValue("yes");
    setAutoCountDistinct("respondent");
    setAutoProject("");
    setAutoOrganization("");
    setAutoPeriodStart("");
    setAutoPeriodEnd("");
    setAutoSaveRule(true);
    setAutoSaveAggregate(true);
    setAutoComputed(null);
  };

  const indicatorNameById = useMemo<Map<string, string>>(
    () =>
      new Map<string, string>(indicators.map((indicator) => [String(indicator.id), indicator.name])),
    [indicators],
  );
  const indicatorCodeById = useMemo<Map<string, string>>(
    () =>
      new Map<string, string>(indicators.map((indicator) => [String(indicator.id), indicator.code])),
    [indicators],
  );
  const indicatorById = useMemo<Map<string, Indicator>>(
    () => new Map<string, Indicator>(indicators.map((indicator) => [String(indicator.id), indicator])),
    [indicators],
  );
  const projectNameById = useMemo<Map<string, string>>(
    () =>
      new Map<string, string>(projects.map((project) => [String(project.id), project.name])),
    [projects],
  );
  const coordinatorOrganizations = useMemo(() => {
    const organizationsWithChildren = new Set<string>();
    organizations.forEach((org) => {
      const parentId = resolveParentOrganizationId(org as unknown as OrganizationWithParent);
      if (parentId) {
        organizationsWithChildren.add(parentId);
      }
    });

    return organizations
      .filter((org) => organizationsWithChildren.has(String(org.id)))
      .slice()
      .sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || "")),
      );
  }, [organizations]);
  const accessibleOrganizations = useMemo(() => {
    if (canReportAcrossOrganizations) return organizations;
    const ownOrganizationId = userOrganizationId ? String(userOrganizationId) : "";
    if (!ownOrganizationId) return [];
    const ownOrganization = organizations.find((org) => String(org.id) === ownOrganizationId);
    if (!ownOrganization) return [];
    const ownParentId = resolveParentOrganizationId(
      ownOrganization as unknown as OrganizationWithParent,
    );
    if (!ownParentId) {
      return organizations.filter((org) => {
        const orgId = String(org.id);
        return (
          orgId === ownOrganizationId ||
          resolveParentOrganizationId(org as unknown as OrganizationWithParent) === ownOrganizationId
        );
      });
    }
    return organizations.filter((org) => String(org.id) === ownOrganizationId);
  }, [canReportAcrossOrganizations, organizations, userOrganizationId]);
  const availableCoordinatorOrganizations = useMemo(() => {
    const accessibleIds = new Set(accessibleOrganizations.map((org) => String(org.id)));
    const ownOrganizationId = userOrganizationId ? String(userOrganizationId) : "";
    const ownOrganization = organizations.find((org) => String(org.id) === ownOrganizationId);
    const ownParentId = ownOrganization
      ? resolveParentOrganizationId(ownOrganization as unknown as OrganizationWithParent)
      : "";
    return coordinatorOrganizations.filter((coordinator) => {
      const coordinatorId = String(coordinator.id);
      return (
        accessibleIds.has(coordinatorId) ||
        coordinatorId === ownParentId ||
        accessibleOrganizations.some(
          (organization) =>
            resolveParentOrganizationId(organization as unknown as OrganizationWithParent) ===
            coordinatorId,
        )
      );
    });
  }, [accessibleOrganizations, coordinatorOrganizations, organizations, userOrganizationId]);
  const accessibleOrganizationIds = useMemo<Set<string>>(
    () => new Set<string>(accessibleOrganizations.map((org) => String(org.id))),
    [accessibleOrganizations],
  );
  const organizationNameById = useMemo<Map<string, string>>(
    () => new Map<string, string>(organizations.map((organization) => [String(organization.id), organization.name])),
    [organizations],
  );
  const coordinatorByOrgId = useMemo(() => {
    const map = new Map<string, string>();
    organizations.forEach((organization) => {
      const organizationId = String(organization.id);
      const parentId = resolveParentOrganizationId(
        organization as unknown as OrganizationWithParent,
      );
      map.set(organizationId, parentId || organizationId);
    });
    return map;
  }, [organizations]);
  const coordinatorNameById = useMemo(
    () =>
      new Map<string, string>(
        coordinatorOrganizations.map((organization) => [String(organization.id), organization.name]),
      ),
    [coordinatorOrganizations],
  );
  const scopedOrganizations = useMemo(() => {
    const scoped =
      parentOrgFilter === "all"
        ? accessibleOrganizations
        : accessibleOrganizations.filter((org) => {
            const orgId = String(org.id);
            const parentId = resolveParentOrganizationId(
              org as unknown as OrganizationWithParent,
            );
            return orgId === parentOrgFilter || parentId === parentOrgFilter;
          });
    return scoped
      .slice()
      .sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || "")),
      );
  }, [accessibleOrganizations, parentOrgFilter]);
  const scopedOrganizationIds = useMemo<Set<string>>(
    () => new Set<string>(scopedOrganizations.map((org) => String(org.id))),
    [scopedOrganizations],
  );
  const selectedOrganizationIds = useMemo(() => {
    if (orgFilter === "all") {
      return scopedOrganizationIds;
    }
    return new Set<string>(
      orgFilter
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && scopedOrganizationIds.has(value)),
    );
  }, [orgFilter, scopedOrganizationIds]);
  const writableOrganizations = useMemo(() => {
    if (canReportAcrossOrganizations) return organizations;
    const ownOrganizationId = userOrganizationId ? String(userOrganizationId) : "";
    if (!ownOrganizationId) return [];
    return organizations.filter((org) => String(org.id) === ownOrganizationId);
  }, [canReportAcrossOrganizations, organizations, userOrganizationId]);
  const writableOrganizationIds = useMemo<Set<string>>(
    () => new Set<string>(writableOrganizations.map((org) => String(org.id))),
    [writableOrganizations],
  );
  const isOrganizationSelectionLocked = !canReportAcrossOrganizations;
  const defaultOwnOrganizationValue = userOrganizationId
    ? String(userOrganizationId)
    : "";
  const selectedFormIndicator = useMemo(
    () => indicatorById.get(formIndicator),
    [formIndicator, indicatorById],
  );
  const selectedFormIndicatorUsesMatrix = useMemo(
    () => indicatorUsesMatrixEntry(selectedFormIndicator?.sub_labels),
    [selectedFormIndicator],
  );
  const formPrimaryDisaggregateLabel = useMemo(
    () => getPrimaryDisaggregateLabel(selectedFormIndicator?.sub_labels),
    [selectedFormIndicator],
  );
  const matrixToggleDisabled = Boolean(formIndicator) && !selectedFormIndicatorUsesMatrix;
  const sidebarOrgId = searchParams.get("orgId");

  useEffect(() => {
    if (!formIndicator) return;
    if (selectedFormIndicatorUsesMatrix && !useMatrixEntry) {
      setUseMatrixEntry(true);
      return;
    }
    if (!selectedFormIndicatorUsesMatrix && useMatrixEntry) {
      setUseMatrixEntry(false);
    }
  }, [formIndicator, selectedFormIndicatorUsesMatrix, useMatrixEntry]);

  useEffect(() => {
    if (!sidebarOrgId) return;

    const matchedCoordinator = availableCoordinatorOrganizations.find(
      (org) => String(org.id) === sidebarOrgId,
    );
    if (matchedCoordinator) {
      setParentOrgFilter(sidebarOrgId);
      setOrgFilter("all");
      return;
    }

    const matchedOrg = organizations.find((org) => String(org.id) === sidebarOrgId);
    if (!matchedOrg) return;
    if (!accessibleOrganizationIds.has(String(matchedOrg.id))) return;
    const parentId = resolveParentOrganizationId(
      matchedOrg as unknown as OrganizationWithParent,
    );
    setParentOrgFilter(parentId || String(matchedOrg.id));
    setOrgFilter("all");
  }, [
    accessibleOrganizationIds,
    availableCoordinatorOrganizations,
    organizations,
    sidebarOrgId,
  ]);

  useEffect(() => {
    if (
      parentOrgFilter !== "all" &&
      !availableCoordinatorOrganizations.some((org) => String(org.id) === parentOrgFilter)
    ) {
      setParentOrgFilter("all");
    }
  }, [availableCoordinatorOrganizations, parentOrgFilter]);

  useEffect(() => {
    if (orgFilter === "all") return;
    if (!selectedOrganizationIds.size) {
      setOrgFilter("all");
    }
  }, [orgFilter, selectedOrganizationIds]);

  useEffect(() => {
    if (!isDialogOpen || !isOrganizationSelectionLocked) return;
    if (!userOrganizationId) return;
    setFormOrganization(String(userOrganizationId));
  }, [isDialogOpen, isOrganizationSelectionLocked, userOrganizationId]);

  useEffect(() => {
    if (!isAutoCalcOpen || !isOrganizationSelectionLocked) return;
    if (!userOrganizationId) return;
    setAutoOrganization(String(userOrganizationId));
  }, [isAutoCalcOpen, isOrganizationSelectionLocked, userOrganizationId]);

  const periods = useMemo<string[]>(
    () => Array.from(new Set<string>(aggregates.map(getPeriodLabel))),
    [aggregates],
  );

  const filteredAggregates = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return aggregates.filter((agg) => {
      const aggregateOrganizationId = String(agg.organization);
      if (!selectedOrganizationIds.has(aggregateOrganizationId)) return false;

      const matchesProject =
        projectFilter === "all" || String(agg.project) === projectFilter;
      if (!matchesProject) return false;

      const matchesPeriod =
        periodFilter === "all" || getPeriodLabel(agg) === periodFilter;
      if (!matchesPeriod) return false;

      const indicatorName =
        agg.indicator_name ||
        indicatorNameById.get(String(agg.indicator)) ||
        "";
      const matchesSearch =
        query.length === 0 || indicatorName.toLowerCase().includes(query);
      return matchesSearch;
    });
  }, [
    aggregates,
    indicatorNameById,
    periodFilter,
    projectFilter,
    searchQuery,
    selectedOrganizationIds,
  ]);

  const dedupedFilteredAggregates = useMemo(
    () => dedupeAggregatesByLogicalSubmission(filteredAggregates),
    [filteredAggregates],
  );

  const aggregateGroups = useMemo<AggregateGroupEntry[]>(() => {
    const groups = new Map<string, Aggregate[]>();
    for (const agg of dedupedFilteredAggregates) {
      const indicatorId = String(agg.indicator || "");
      const indicatorName =
        agg.indicator_name || indicatorNameById.get(indicatorId) || "Indicator";
      const key = getLogicalIndicatorKey(agg, indicatorName);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(agg);
    }
    const parseCode = (code?: string | null) => {
      if (!code) return { num: Number.POSITIVE_INFINITY, suffix: "" };
      const match = code.match(/(\d+)([a-zA-Z])?/);
      if (!match) return { num: Number.POSITIVE_INFINITY, suffix: code };
      return { num: Number(match[1]), suffix: (match[2] || "").toLowerCase() };
    };
    const entries: AggregateGroupEntry[] = Array.from(groups.entries()).map(([key, items]) => {
      const first = items[0];
      const indicatorId = String(first?.indicator || "");
      const indicatorName =
        first?.indicator_name ||
        indicatorNameById.get(indicatorId) ||
        "Indicator";
      const code =
        first?.indicator_code ||
        indicatorCodeById.get(indicatorId) ||
        "";
      return { key, indicatorId, indicatorName, items, code };
    });
    return entries.sort((a, b) => {
      const ac = parseCode(a.code);
      const bc = parseCode(b.code);
      if (ac.num !== bc.num) return ac.num - bc.num;
      if (ac.suffix !== bc.suffix) return ac.suffix.localeCompare(bc.suffix);
      return a.indicatorName.localeCompare(b.indicatorName);
    });
  }, [dedupedFilteredAggregates, indicatorCodeById, indicatorNameById]);

  const dashboardGroups = useMemo<DashboardGroup[]>(
    () =>
      aggregateGroups.map((group) => {
        const indicator = indicatorById.get(group.indicatorId);
        const disaggregates = mergeDisaggregatesForGroup(group.items);
        return {
          ...group,
          indicator,
          disaggregates,
          totalValue: group.items.reduce((sum, item) => sum + getAggregateTotal(item), 0),
          organizations: Array.from(
            new Set(group.items.map((item) => String(item.organization))),
          ),
          projects: Array.from(new Set(group.items.map((item) => String(item.project)))),
          periods: Array.from(new Set(group.items.map((item) => getPeriodLabel(item)))),
        };
      }),
    [aggregateGroups, indicatorById],
  );

  const dashboardTopicSections = useMemo<DashboardTopicSection[]>(() => {
    const grouped = new Map<string, DashboardGroup[]>();

    dashboardGroups.forEach((group) => {
      const topicId = resolveWorkbookTopicId(group);
      if (!grouped.has(topicId)) {
        grouped.set(topicId, []);
      }
      grouped.get(topicId)!.push(group);
    });

    return workbookTopicDefinitions
      .filter((topic) => (grouped.get(topic.id)?.length || 0) > 0)
      .map((topic) => {
        const groups = grouped.get(topic.id) || [];
        return {
          ...topic,
          groups,
          totalValue: groups.reduce((sum, group) => sum + group.totalValue, 0),
        };
      });
  }, [dashboardGroups]);

  useEffect(() => {
    if (!dashboardGroups.length) {
      if (detailIndicatorId) setDetailIndicatorId("");
      return;
    }
    if (
      !detailIndicatorId ||
      !dashboardGroups.some((group) => group.indicatorId === detailIndicatorId)
    ) {
      setDetailIndicatorId(dashboardGroups[0].indicatorId);
    }
  }, [dashboardGroups, detailIndicatorId]);

  const selectedDetailGroup = useMemo(
    () =>
      dashboardGroups.find((group) => group.indicatorId === detailIndicatorId) ||
      dashboardGroups[0] ||
      null,
    [dashboardGroups, detailIndicatorId],
  );

  const comparisonMode = parentOrgFilter === "all" ? "coordinator" : "organization";
  const comparisonBucketNames = useMemo<Map<string, string>>(() => {
    if (comparisonMode === "coordinator") return coordinatorNameById;
    return organizationNameById;
  }, [comparisonMode, coordinatorNameById, organizationNameById]);
  const comparisonBucketByOrg = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    scopedOrganizations.forEach((organization) => {
      const organizationId = String(organization.id);
      map.set(
        organizationId,
        comparisonMode === "coordinator"
          ? coordinatorByOrgId.get(organizationId) || organizationId
          : organizationId,
      );
    });
    return map;
  }, [comparisonMode, coordinatorByOrgId, scopedOrganizations]);

  const targetByComparisonBucket = useMemo<Map<string, number>>(() => {
    const targetMap = new Map<string, number>();
    const includedProjects =
      projectFilter === "all"
        ? new Set<string>(dedupedFilteredAggregates.map((aggregate) => String(aggregate.project)))
        : new Set<string>([projectFilter]);
    const includedIndicators = new Set<string>(
      dedupedFilteredAggregates.map((aggregate) => String(aggregate.indicator)),
    );

    indicators.forEach((indicator) => {
      if (includedIndicators.size > 0 && !includedIndicators.has(String(indicator.id))) return;
      (indicator.project_targets || []).forEach((target) => {
        const organizationId = String(target.organization);
        if (!selectedOrganizationIds.has(organizationId)) return;
        if (includedProjects.size && !includedProjects.has(String(target.project))) return;
        const bucketId =
          comparisonMode === "coordinator"
            ? coordinatorByOrgId.get(organizationId) || organizationId
            : organizationId;
        targetMap.set(bucketId, (targetMap.get(bucketId) || 0) + toSafeNumber(target.target_value));
      });
    });

    return targetMap;
  }, [
    comparisonMode,
    coordinatorByOrgId,
    dedupedFilteredAggregates,
    indicators,
    projectFilter,
    selectedOrganizationIds,
  ]);

  const dashboardRollupData = useMemo(
    () =>
      buildRollupData({
        aggregates: dedupedFilteredAggregates,
        bucketForOrganization: comparisonBucketByOrg,
        bucketNames: comparisonBucketNames,
        targetByBucketId: targetByComparisonBucket,
      }),
    [
      comparisonBucketByOrg,
      comparisonBucketNames,
      dedupedFilteredAggregates,
      targetByComparisonBucket,
    ],
  );

  const scopeOrganizationLabel = useMemo(() => {
    if (orgFilter !== "all") {
      const selectedOrgName =
        organizationNameById.get(orgFilter) || scopedOrganizations.find((org) => String(org.id) === orgFilter)?.name;
      return selectedOrgName || "Selected organization";
    }
    if (parentOrgFilter !== "all") {
      return `${coordinatorNameById.get(parentOrgFilter) || "Coordinator"} portfolio`;
    }
    return "All reporting organizations";
  }, [
    coordinatorNameById,
    orgFilter,
    organizationNameById,
    parentOrgFilter,
    scopedOrganizations,
  ]);

  const totals = useMemo(() => {
    return dedupedFilteredAggregates.reduce(
      (acc, aggregate) => {
        const sexTotals = deriveSexTotals(aggregate.value);
        acc.male += sexTotals.male;
        acc.female += sexTotals.female;
        acc.total += sexTotals.total;
        return acc;
      },
      { male: 0, female: 0, total: 0 },
    );
  }, [dedupedFilteredAggregates]);

  const parseCSV = (text: string) => {
    const rows: string[][] = [];
    let current = "";
    let inQuotes = false;
    const row: string[] = [];
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === "\"") {
        if (inQuotes && next === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === "," && !inQuotes) {
        row.push(current);
        current = "";
        continue;
      }
      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (current !== "" || row.length > 0) {
          row.push(current);
          rows.push([...row]);
          row.length = 0;
          current = "";
        }
        continue;
      }
      current += char;
    }
    if (current !== "" || row.length > 0) {
      row.push(current);
      rows.push(row);
    }
    return rows;
  };

  const getPeriodBounds = (label: string) => {
    const match = aggregates.find((agg) => getPeriodLabel(agg) === label);
    if (!match) return null;
    return { from: match.period_start, to: match.period_end };
  };

  const handleExport = async () => {
    try {
      const periodBounds =
        periodFilter !== "all" ? getPeriodBounds(periodFilter) : null;
      const blob = await aggregatesService.export({
        format: "excel",
        project: projectFilter !== "all" ? projectFilter : undefined,
        organization: orgFilter !== "all" ? orgFilter : undefined,
        date_from: periodBounds?.from,
        date_to: periodBounds?.to,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `aggregates_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export aggregates", err);
      toast({
        title: "Export failed",
        description: "Unable to export aggregates.",
        variant: "destructive",
      });
    }
  };

  const resolveId = (value: string, list: Array<{ id: number; name?: string }>) => {
    if (!value) return null;
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) return numeric;
    const match = list.find((item) => (item.name || "").toLowerCase() === value.toLowerCase());
    return match?.id ?? null;
  };

  const handleImport = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const normalize = (value: string) => value.trim().toLowerCase();
    const findOrgBySheet = (sheetName: string) =>
      organizations.find((org) => normalize(org.name) === normalize(sheetName))?.id ?? null;
    const findTemplateBySheet = (sheetName: string) =>
      templates.find((template) => normalize(template.name) === normalize(sheetName)) ?? null;

    let success = 0;
    let failed = 0;
    const payloads: Array<{
      indicator: number;
      project: number;
      organization: number;
      period_start: string;
      period_end: string;
      value: AggregateValue | unknown;
      notes?: string;
    }> = [];

    const processRows = (
      rows: string[][],
      sheetOrgId: number | null,
      templateIndicators: Array<{ id: number; name?: string }>,
    ) => {
      if (rows.length < 2) return;
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const get = (row: string[], key: string) => {
        const idx = header.indexOf(key);
        return idx >= 0 ? row[idx]?.trim() : "";
      };
      for (const row of rows.slice(1)) {
        try {
          const indicatorValue = get(row, "indicator_id") || get(row, "indicator_name");
          let indicatorId = resolveId(indicatorValue, indicators);
          if (!indicatorId && templateIndicators.length) {
            indicatorId = resolveId(indicatorValue, templateIndicators);
          }
          const projectId = resolveId(get(row, "project_id") || get(row, "project_name"), projects);
          let orgId = resolveId(get(row, "organization_id") || get(row, "organization_name"), organizations);
          if (!orgId && sheetOrgId) orgId = sheetOrgId;
          const periodStart = get(row, "period_start");
          const periodEnd = get(row, "period_end");
          if (!indicatorId || !projectId || !orgId || !periodStart || !periodEnd) {
            failed += 1;
            continue;
          }
          if (!canReportAcrossOrganizations && !writableOrganizationIds.has(String(orgId))) {
            failed += 1;
            continue;
          }
          let value: AggregateValue | unknown = {};
          const valueJson = get(row, "value_json");
          if (valueJson) {
            try {
              value = JSON.parse(valueJson);
            } catch {
              value = {};
            }
          }
          const male = parseNumber(get(row, "male"));
          const female = parseNumber(get(row, "female"));
          const total = parseNumber(get(row, "total"));
          if (typeof value === "object" && value !== null) {
            if (male !== undefined) (value as AggregateValue).male = male;
            if (female !== undefined) (value as AggregateValue).female = female;
            if (total !== undefined) (value as AggregateValue).total = total;
          }
          if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) {
            value = {
              total: total ?? (male ?? 0) + (female ?? 0),
              ...(male !== undefined ? { male } : {}),
              ...(female !== undefined ? { female } : {}),
            };
          }

          payloads.push({
            indicator: indicatorId,
            project: projectId,
            organization: orgId,
            period_start: periodStart,
            period_end: periodEnd,
            value,
            notes: get(row, "notes") || undefined,
          });
        } catch {
          failed += 1;
        }
      }
    };

    if (extension === "xlsx" || extension === "xls") {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetNames = workbook.SheetNames.length ? workbook.SheetNames : [];
      for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as Array<Array<unknown>>).map(
          (row) => row.map((cell) => (cell === undefined || cell === null ? "" : String(cell))),
        );
        const sheetOrgId = findOrgBySheet(sheetName);
        const template = findTemplateBySheet(sheetName);
        const templateIndicators = template?.indicators || [];
        processRows(rows, sheetOrgId, templateIndicators);
      }
    } else {
      const text = await file.text();
      const rows = parseCSV(text);
      processRows(rows, null, []);
    }

    if (payloads.length === 0) {
      toast({ title: "Invalid file", description: "No rows found.", variant: "destructive" });
      return;
    }

    const grouped = new Map<
      string,
      {
        project: number;
        organization: number;
        period_start: string;
        period_end: string;
        data: Array<{ indicator: number; value: AggregateValue | unknown; notes?: string }>;
      }
    >();

    for (const item of payloads) {
      const key = `${item.project}::${item.organization}::${item.period_start}::${item.period_end}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          project: item.project,
          organization: item.organization,
          period_start: item.period_start,
          period_end: item.period_end,
          data: [],
        });
      }
      grouped.get(key)!.data.push({
        indicator: item.indicator,
        value: item.value,
        notes: item.notes,
      });
    }

    for (const group of grouped.values()) {
      try {
        const result = await aggregatesService.bulkCreate({
          project: group.project,
          organization: group.organization,
          period_start: group.period_start,
          period_end: group.period_end,
          data: group.data,
        });
        success += result.length;
      } catch {
        failed += group.data.length;
      }
    }

    await mutate();
    toast({
      title: "Import complete",
      description: `Imported ${success} rows. ${failed} failed.`,
      variant: failed ? "destructive" : "default",
    });
  };

  const chartData = useMemo(() => {
    const totalsByIndicator = new Map<string, number>();
    for (const agg of dedupedFilteredAggregates) {
      const value = parseAggregateValue(agg.value);
      const male = Number(value.male) || 0;
      const female = Number(value.female) || 0;
      const total =
        value.total !== undefined
          ? Number(value.total) || 0
          : male + female;
      const indicatorName =
        agg.indicator_name ||
        indicatorNameById.get(String(agg.indicator)) ||
        "Indicator";
      totalsByIndicator.set(
        indicatorName,
        (totalsByIndicator.get(indicatorName) || 0) + total,
      );
    }
    return Array.from(totalsByIndicator.entries()).map(([name, total]) => ({
      name,
      total,
    }));
  }, [dedupedFilteredAggregates, indicatorNameById]);

  const activeCompliancePeriod = useMemo(() => {
    if (periodFilter !== "all") return periodFilter;
    const available = sortPeriods(
      Array.from(new Set(dedupedFilteredAggregates.map((aggregate) => getPeriodLabel(aggregate)))),
    );
    return available[available.length - 1] || null;
  }, [dedupedFilteredAggregates, periodFilter]);

  const complianceData = useMemo(
    () =>
      buildComplianceData({
        organizations: scopedOrganizations,
        aggregates: dedupedFilteredAggregates,
        organizationNames: organizationNameById,
        coordinatorNames: coordinatorNameById,
        coordinatorByOrgId,
        activePeriod: activeCompliancePeriod,
      }),
    [
      activeCompliancePeriod,
      coordinatorByOrgId,
      coordinatorNameById,
      dedupedFilteredAggregates,
      organizationNameById,
      scopedOrganizations,
    ],
  );

  const complianceSummary = useMemo(() => {
    const summary = complianceData.reduce(
      (acc, item) => {
        acc.submitted += item.submitted;
        acc.late += item.late;
        acc.missing += item.missing;
        return acc;
      },
      { submitted: 0, late: 0, missing: 0 },
    );
    const expected = summary.submitted + summary.late + summary.missing;
    return {
      ...summary,
      expected,
      complianceRate:
        expected > 0 ? ((summary.submitted + summary.late) / expected) * 100 : 0,
    };
  }, [complianceData]);

  const contributionData = useMemo(
    () =>
      buildContributionData(
        dedupedFilteredAggregates,
        organizationNameById,
        parentOrgFilter === "all" ? 10 : scopedOrganizations.length,
      ),
    [dedupedFilteredAggregates, organizationNameById, parentOrgFilter, scopedOrganizations.length],
  );

  const trendData = useMemo(() => {
    if (!selectedDetailGroup) return { data: [], seriesKeys: [] as string[], seriesNames: new Map<string, string>() };
    return buildTrendData({
      aggregates: dedupedFilteredAggregates,
      indicatorId: selectedDetailGroup.indicatorId,
      mode: trendMode,
      bucketForOrganization:
        trendMode === "compare" ? comparisonBucketByOrg : new Map<string, string>(),
      bucketNames: comparisonBucketNames,
      limit: comparisonMode === "coordinator" ? 5 : 8,
    });
  }, [
    comparisonBucketByOrg,
    comparisonBucketNames,
    comparisonMode,
    dedupedFilteredAggregates,
    selectedDetailGroup,
    trendMode,
  ]);

  const disaggregateBreakdownData = useMemo(() => {
    if (!selectedDetailGroup) return [];
    return buildDisaggregateBreakdownData({
      disaggregates: selectedDetailGroup.disaggregates,
      indicatorGroups: resolveDisplayDisaggregateGroups(
        selectedDetailGroup.disaggregates,
        selectedDetailGroup.indicator?.sub_labels,
      ),
      mode: breakdownMode,
    });
  }, [breakdownMode, selectedDetailGroup]);

  const cascadeData = useMemo(
    () =>
      buildCascadeData(
        dashboardGroups.map((group) => ({
          indicatorName: group.indicatorName,
          totalValue: group.totalValue,
        })),
        selectedCascadeId,
      ),
    [dashboardGroups, selectedCascadeId],
  );

  const messageBreakdownData = useMemo(
    () =>
      dashboardGroups
        .filter((group) => {
          const normalized = normalizeText(group.indicatorName);
          return (
            normalized.includes("message") ||
            normalized.includes("screening") ||
            normalized.includes("screened")
          );
        })
        .map((group) => ({
          name: group.indicatorName,
          total: group.totalValue,
        }))
        .sort((left, right) => right.total - left.total)
        .slice(0, 8),
    [dashboardGroups],
  );

  const selectedComplianceDetails = useMemo(() => {
    if (!complianceSelection) return [];
    const matched = complianceData.find((item) => item.id === complianceSelection.coordinatorId);
    return matched?.details[complianceSelection.status] || [];
  }, [complianceData, complianceSelection]);

  const selectedDetailMatrix = useMemo(() => {
    if (!selectedDetailGroup?.disaggregates) return null;
    const indicatorGroups = resolveDisplayDisaggregateGroups(
      selectedDetailGroup.disaggregates,
      selectedDetailGroup.indicator?.sub_labels,
    );
    return {
      ...buildDisplayMatrix(selectedDetailGroup.disaggregates, indicatorGroups),
      primaryDisaggregateLabel: getPrimaryDisaggregateLabel(Array.from(indicatorGroups)),
    };
  }, [selectedDetailGroup]);

  const selectedDetailMatrixMax = useMemo(() => {
    if (!selectedDetailMatrix) return 0;
    let maxValue = 0;
    selectedDetailMatrix.keyPops.forEach((kp) => {
      selectedDetailMatrix.secondDimensionValues.forEach((dimension) => {
        selectedDetailMatrix.ageBands.forEach((band) => {
          maxValue = Math.max(
            maxValue,
            toSafeNumber(selectedDetailMatrix.matrix[kp]?.[dimension]?.[band]),
          );
        });
      });
    });
    return maxValue;
  }, [selectedDetailMatrix]);

  const resetForm = () => {
    setFormProject("");
    setFormIndicator("");
    setFormOrganization(defaultOwnOrganizationValue);
    setFormTemplate("all");
    setFormPeriodStart("");
    setFormPeriodEnd("");
    setUseMatrixEntry(true);
    setFormMale("");
    setFormFemale("");
    setFormNotes("");
    setFormDataSource("");
    setMatrixValues(buildEmptyMatrix());
  };

  const serializeChartSvg = (container: HTMLDivElement | null) => {
    if (!container) return null;
    const svg = container.querySelector("svg");
    if (!svg) return null;
    const cloned = svg.cloneNode(true) as SVGSVGElement;
    if (!cloned.getAttribute("xmlns")) {
      cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    return new XMLSerializer().serializeToString(cloned);
  };

  const downloadChartSvg = (container: HTMLDivElement | null, filename: string) => {
    const svgText = serializeChartSvg(container);
    if (!svgText) return;
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadChartPng = async (container: HTMLDivElement | null, filename: string) => {
    const svgText = serializeChartSvg(container);
    if (!svgText) return;
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width || 1200;
      canvas.height = image.height || 720;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const pngUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = pngUrl;
        link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  const templateIndicatorOptions = useMemo(() => {
    if (formTemplate !== "all") {
      const selected = templates.find((template) => String(template.id) === formTemplate);
      if (selected) {
        return selected.indicators.map((indicator) => ({
          id: indicator.id,
          name: indicator.name,
          code: indicator.code,
        }));
      }
    }
    // Phase 4: when a project is selected, restrict to project-assigned indicators
    // (templates endpoint already filters by project + org when both are provided).
    if (formProject && templates.length > 0) {
      const projectTemplate = templates[0];
      return projectTemplate.indicators.map((indicator) => ({
        id: indicator.id,
        name: indicator.name,
        code: indicator.code,
      }));
    }
    return indicators;
  }, [formTemplate, indicators, templates, formProject]);

  const computedTotal = useMemo(() => {
    if (useMatrixEntry) {
      return 0;
    }
    const male = parseNumber(formMale) ?? 0;
    const female = parseNumber(formFemale) ?? 0;
    return male + female;
  }, [formFemale, formMale, useMatrixEntry]);

  const matrixTotal = useMemo(() => {
    if (!useMatrixEntry) return 0;
    let total = 0;
    for (const kp of keyPopulations) {
      for (const sex of ["Male", "Female"]) {
        for (const band of matrixAgeBands) {
          const value = parseNumber(matrixValues[kp]?.[sex]?.[band] ?? "");
          if (value !== undefined) total += value;
        }
      }
    }
    return total;
  }, [matrixValues, useMatrixEntry]);

  const handleSave = async () => {
    if (!formProject || !formIndicator || !formOrganization || !formPeriodStart || !formPeriodEnd) {
      toast({
        title: "Missing required fields",
        description: "Project, indicator, organization, and period dates are required.",
        variant: "destructive",
      });
      return;
    }

    const male = !useMatrixEntry ? parseNumber(formMale) : undefined;
    const female = !useMatrixEntry ? parseNumber(formFemale) : undefined;

    if (useMatrixEntry && matrixTotal === 0) {
      toast({
        title: "Missing value",
        description: "Enter at least one value in the disaggregate matrix.",
        variant: "destructive",
      });
      return;
    }

    if (!useMatrixEntry && male === undefined && female === undefined) {
      toast({
        title: "Missing value",
        description: "Provide at least one of male or female values.",
        variant: "destructive",
      });
      return;
    }

    if (!canReportAcrossOrganizations && !writableOrganizationIds.has(formOrganization)) {
      toast({
        title: "Organization restricted",
        description: "You can only submit aggregate data for your own organization.",
        variant: "destructive",
      });
      return;
    }

    const valuePayload: AggregateValue = {
      total: useMatrixEntry
        ? matrixTotal
        : (male ?? 0) + (female ?? 0),
    };
    if (!useMatrixEntry && male !== undefined) valuePayload.male = male;
    if (!useMatrixEntry && female !== undefined) valuePayload.female = female;
    if (useMatrixEntry) {
      const matrixPayload: Record<string, Record<string, Record<string, number | undefined>>> = {};
      for (const kp of keyPopulations) {
        matrixPayload[kp] = { Male: {}, Female: {} };
        for (const band of matrixAgeBands) {
          matrixPayload[kp].Male[band] = parseNumber(matrixValues[kp]?.Male?.[band] ?? "");
          matrixPayload[kp].Female[band] = parseNumber(matrixValues[kp]?.Female?.[band] ?? "");
        }
      }
      valuePayload.disaggregates = matrixPayload;
    }

    setIsSubmitting(true);
    try {
      const combinedNotes = [
        formNotes.trim(),
        formDataSource.trim() ? `Data source: ${formDataSource.trim()}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
      await aggregatesService.create({
        indicator: Number(formIndicator),
        project: Number(formProject),
        organization: Number(formOrganization),
        period_start: formPeriodStart,
        period_end: formPeriodEnd,
        value: valuePayload,
        notes: combinedNotes || undefined,
      });
      toast({
        title: "Aggregate saved",
        description: "Aggregate entry created successfully.",
      });
      await mutate();
      setIsDialogOpen(false);
      resetForm();
    } catch (err) {
      console.error("Failed to create aggregate", err);
      toast({
        title: "Error",
        description: "Failed to create aggregate entry.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAutoCalculate = async () => {
    if (
      !autoOutputIndicator ||
      !autoSourceIndicator ||
      !autoProject ||
      !autoOrganization ||
      !autoPeriodStart ||
      !autoPeriodEnd
    ) {
      toast({
        title: "Missing required fields",
        description: "Output, source, project, organization, and period dates are required.",
        variant: "destructive",
      });
      return;
    }

    if (
      autoSaveAggregate &&
      !canReportAcrossOrganizations &&
      !writableOrganizationIds.has(autoOrganization)
    ) {
      toast({
        title: "Organization restricted",
        description: "You can only save aggregates for your own organization.",
        variant: "destructive",
      });
      return;
    }

    setIsAutoCalcSubmitting(true);
    try {
      const result = await aggregatesService.generateFromInteractions({
        output_indicator: Number(autoOutputIndicator),
        source_indicator: Number(autoSourceIndicator),
        operator: autoOperator,
        match_value: autoMatchValue,
        count_distinct: autoCountDistinct,
        project: Number(autoProject),
        organization: Number(autoOrganization),
        period_start: autoPeriodStart,
        period_end: autoPeriodEnd,
        save_rule: autoSaveRule,
        save_aggregate: autoSaveAggregate,
      });

      setAutoComputed(result.computed);
      if (autoSaveAggregate) {
        await mutate();
      }
      toast({
        title: "Auto-calculation complete",
        description: `Computed value: ${result.computed}`,
      });
    } catch (err) {
      console.error("Failed to auto-calculate aggregate", err);
      toast({
        title: "Error",
        description: "Failed to auto-calculate from interactions.",
        variant: "destructive",
      });
    } finally {
      setIsAutoCalcSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Failed to load aggregates</p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Aggregates"
          description="Enter and manage aggregate data without individual respondent tracking"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Aggregates" },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <ReportingWorkbookDialog
                projects={projects}
                organizations={accessibleOrganizations}
                defaultProject={projectFilter}
                defaultOrganization={orgFilter}
                onImported={() => { void mutate(); }}
              />
              <Button variant="outline" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleImport(file);
                  }
                  if (importInputRef.current) {
                    importInputRef.current.value = "";
                  }
                }}
              />

              <Dialog
                open={isAutoCalcOpen}
                onOpenChange={(open) => {
                  setIsAutoCalcOpen(open);
                  if (!open) resetAutoCalcForm();
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Calculator className="mr-2 h-4 w-4" />
                    Auto-calculate
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Auto-calculate Aggregate</DialogTitle>
                    <DialogDescription>
                      Create/update a derivation rule and compute an aggregate from interaction responses.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4 py-2">
                    <div className="space-y-2">
                      <Label>Project</Label>
                      <Select value={autoProject} onValueChange={setAutoProject}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                        <SelectContent>
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
                      <Select value={autoOrganization} onValueChange={setAutoOrganization}>
                        <SelectTrigger disabled={isOrganizationSelectionLocked}>
                          <SelectValue placeholder="Select organization" />
                        </SelectTrigger>
                        <SelectContent>
                          {writableOrganizations.map((org) => (
                            <SelectItem key={org.id} value={String(org.id)}>
                              {org.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Output Indicator (the number you report)</Label>
                      <Select value={autoOutputIndicator} onValueChange={setAutoOutputIndicator}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select output indicator" />
                        </SelectTrigger>
                        <SelectContent>
                          {indicators
                            .filter((i) => i.type === "number" || i.type === "percentage")
                            .map((indicator) => (
                              <SelectItem key={indicator.id} value={String(indicator.id)}>
                                {indicator.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Source Indicator (screening indicator)</Label>
                      <Select value={autoSourceIndicator} onValueChange={setAutoSourceIndicator}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select source indicator" />
                        </SelectTrigger>
                        <SelectContent>
                          {indicators.map((indicator) => (
                            <SelectItem key={indicator.id} value={String(indicator.id)}>
                              {indicator.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Operator</Label>
                        <Select
                          value={autoOperator}
                          onValueChange={(v) =>
                            setAutoOperator(v as "equals" | "not_equals" | "contains")
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="equals">Equals</SelectItem>
                            <SelectItem value="not_equals">Not equals</SelectItem>
                            <SelectItem value="contains">Contains</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <Label>Match value</Label>
                        {(() => {
                          const source = indicators.find((i) => String(i.id) === autoSourceIndicator);
                          if (source?.type === "yes_no") {
                            return (
                              <Select value={autoMatchValue} onValueChange={setAutoMatchValue}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="yes">Yes</SelectItem>
                                  <SelectItem value="no">No</SelectItem>
                                </SelectContent>
                              </Select>
                            );
                          }
                          return (
                            <Input
                              value={autoMatchValue}
                              onChange={(e) => setAutoMatchValue(e.target.value)}
                              placeholder="e.g., yes"
                            />
                          );
                        })()}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Count distinct</Label>
                      <Select
                        value={autoCountDistinct}
                        onValueChange={(v) =>
                          setAutoCountDistinct(v as "respondent" | "interaction")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="respondent">Respondent (people)</SelectItem>
                          <SelectItem value="interaction">Interaction (services)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Period start</Label>
                        <Input
                          type="date"
                          value={autoPeriodStart}
                          onChange={(e) => setAutoPeriodStart(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Period end</Label>
                        <Input
                          type="date"
                          value={autoPeriodEnd}
                          onChange={(e) => setAutoPeriodEnd(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                      <div className="flex items-center gap-2">
                        <Checkbox checked={autoSaveRule} onCheckedChange={(v) => setAutoSaveRule(v === true)} />
                        <span className="text-sm">Save mapping rule</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox checked={autoSaveAggregate} onCheckedChange={(v) => setAutoSaveAggregate(v === true)} />
                        <span className="text-sm">Save aggregate record</span>
                      </div>
                    </div>

                    {autoComputed !== null ? (
                      <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
                        Computed value: <span className="font-medium">{autoComputed}</span>
                      </div>
                    ) : null}
                  </div>

                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsAutoCalcOpen(false)}
                      disabled={isAutoCalcSubmitting}
                    >
                      Close
                    </Button>
                    <Button onClick={handleAutoCalculate} disabled={isAutoCalcSubmitting}>
                      {isAutoCalcSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Calculate
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog
                open={isDialogOpen}
                onOpenChange={(open) => {
                  setIsDialogOpen(open);
                  if (!open) resetForm();
                }}
              >
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" /> Add Entry
                  </Button>
                </DialogTrigger>
                <DialogContent className="fixed inset-0 !top-0 !left-0 !translate-x-0 !translate-y-0 !max-w-none !w-screen !h-screen overflow-hidden rounded-none p-0">
                  <DialogHeader>
                    <DialogTitle>Add Aggregate Entry</DialogTitle>
                    <DialogDescription>
                      Enter aggregate data for an indicator without individual
                      respondent tracking
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4 py-4 px-6 h-[calc(100vh-140px)] overflow-y-auto">
                    <div className="space-y-2">
                      <Label htmlFor="agg-project">Project</Label>
                      <Select
                        value={formProject}
                        onValueChange={(value) => {
                          setFormProject(value)
                          // Clear indicator on project change — different projects have different assignments.
                          setFormIndicator("")
                          setFormTemplate("all")
                        }}
                      >
                        <SelectTrigger id="agg-project">
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                        <SelectContent>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={String(project.id)}>
                              {project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agg-template">Indicator Template</Label>
                      <Select
                        value={formTemplate}
                        onValueChange={(value) => {
                          setFormTemplate(value);
                          setFormIndicator("");
                        }}
                      >
                        <SelectTrigger id="agg-template">
                          <SelectValue placeholder="All indicators" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All indicators</SelectItem>
                          {templates.map((template) => (
                            <SelectItem key={template.id} value={String(template.id)}>
                              {template.name} ({template.indicators?.length ?? 0})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agg-indicator">
                        Indicator
                        {formProject && templateIndicatorOptions.length > 0 && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            ({templateIndicatorOptions.length} assigned)
                          </span>
                        )}
                      </Label>
                      <Select value={formIndicator} onValueChange={setFormIndicator}>
                        <SelectTrigger id="agg-indicator">
                          <SelectValue placeholder="Select indicator" />
                        </SelectTrigger>
                        <SelectContent>
                          {templateIndicatorOptions.map((indicator) => (
                            <SelectItem key={indicator.id} value={String(indicator.id)}>
                              {indicator.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agg-org">Organization</Label>
                      <OrganizationSelect
                        organizations={writableOrganizations}
                        value={formOrganization}
                        onChange={(value) => {
                          setFormOrganization(value)
                          // Clear indicator when org changes — assignment may differ per org.
                          if (formProject) setFormIndicator("")
                        }}
                        placeholder="Select organization"
                        disabled={isOrganizationSelectionLocked}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="agg-period-start">Period Start</Label>
                        <Input
                          id="agg-period-start"
                          type="date"
                          value={formPeriodStart}
                          onChange={(event) => setFormPeriodStart(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="agg-period-end">Period End</Label>
                        <Input
                          id="agg-period-end"
                          type="date"
                          value={formPeriodEnd}
                          onChange={(event) => setFormPeriodEnd(event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Disaggregates</Label>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                          checked={useMatrixEntry}
                          disabled={matrixToggleDisabled}
                          onCheckedChange={(checked) => setUseMatrixEntry(Boolean(checked))}
                        />
                        Use KP x Sex x Age matrix
                      </div>
                      {matrixToggleDisabled ? (
                        <p className="text-xs text-muted-foreground">
                          This indicator is configured as total-only. Matrix entry is disabled.
                        </p>
                      ) : null}
                    </div>

                    {useMatrixEntry ? (
                      <div className="space-y-3">
                        <div className="text-sm text-muted-foreground">
                          Enter values by {formPrimaryDisaggregateLabel}, Sex, and Age band.
                        </div>
                        <div className="overflow-auto rounded-lg border border-border max-h-[55vh]">
                          <table className="min-w-[960px] w-full text-xs">
                            <thead className="bg-muted/50 sticky top-0 z-10">
                              <tr>
                                <th className="p-1.5 text-left">{formPrimaryDisaggregateLabel}</th>
                                <th className="p-1.5 text-left">Sex</th>
                                {matrixAgeBands.map((band) => (
                                  <th key={band} className="p-1.5 text-center whitespace-nowrap">
                                    {band}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {keyPopulations.map((kp) => (
                                <React.Fragment key={kp}>
                                  {["Male", "Female"].map((sex) => (
                                    <tr key={`${kp}-${sex}`} className="border-t border-border">
                                      <td className="p-1.5 font-medium whitespace-nowrap">{kp}</td>
                                      <td className="p-1.5 whitespace-nowrap">{sex}</td>
                                      {matrixAgeBands.map((band) => (
                                        <td key={`${kp}-${sex}-${band}`} className="p-2">
                                          <Input
                                            type="number"
                                            className="h-8 text-center min-w-[72px]"
                                            value={matrixValues[kp]?.[sex]?.[band] ?? ""}
                                            onChange={(event) => {
                                              const value = event.target.value;
                                              setMatrixValues((prev) => ({
                                                ...prev,
                                                [kp]: {
                                                  ...prev[kp],
                                                  [sex]: {
                                                    ...prev[kp]?.[sex],
                                                    [band]: value,
                                                  },
                                                },
                                              }));
                                            }}
                                          />
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Matrix total: <span className="font-semibold text-foreground">{matrixTotal.toLocaleString()}</span>
                        </div>
                      </div>
                    ) : (
                    <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label htmlFor="agg-male">Male</Label>
                          <Input
                            id="agg-male"
                            type="number"
                            placeholder="0"
                            value={formMale}
                            onChange={(event) => setFormMale(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="agg-female">Female</Label>
                          <Input
                            id="agg-female"
                            type="number"
                            placeholder="0"
                            value={formFemale}
                            onChange={(event) => setFormFemale(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="agg-total">Total</Label>
                          <Input
                            id="agg-total"
                            type="number"
                            value={computedTotal}
                            disabled
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="agg-source">Data Source</Label>
                      <Input
                        id="agg-source"
                        placeholder="e.g. DHIS2 report, Excel, routine register"
                        value={formDataSource}
                        onChange={(event) => setFormDataSource(event.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agg-notes">Notes</Label>
                      <Input
                        id="agg-notes"
                        placeholder="Optional notes"
                        value={formNotes}
                        onChange={(event) => setFormNotes(event.target.value)}
                      />
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={isSubmitting}>
                      {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save Entry
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          }
        />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search indicators..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="mr-2 h-4 w-4" />{" "}
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

            <Select
              value={parentOrgFilter}
              onValueChange={(value) => {
                setParentOrgFilter(value);
                setOrgFilter("all");
              }}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Coordinator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Coordinators</SelectItem>
                {availableCoordinatorOrganizations.map((org) => (
                  <SelectItem key={org.id} value={String(org.id)}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={orgFilter} onValueChange={setOrgFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Organization" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Organizations</SelectItem>
                {scopedOrganizations.map((org) => (
                  <SelectItem key={org.id} value={String(org.id)}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Calendar className="mr-2 h-4 w-4" />{" "}
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Periods</SelectItem>
                {periods.map((period) => (
                  <SelectItem key={period} value={period}>
                    {period}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Performance Overview</h2>
            <p className="text-sm text-muted-foreground">
              Consolidated dashboard for the filtered coordinator and organization scope.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <Card className="border-primary/15 bg-gradient-to-br from-primary/10 via-background to-background">
              <CardHeader className="pb-2">
                <CardDescription>Total Indicators Reported</CardDescription>
                <CardTitle className="flex items-center justify-between text-2xl">
                  {dashboardGroups.length}
                  <Target className="h-5 w-5 text-primary" />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Organizations Reporting</CardDescription>
                <CardTitle className="flex items-center justify-between text-2xl">
                  {new Set(dedupedFilteredAggregates.map((aggregate) => String(aggregate.organization))).size}
                  <Building2 className="h-5 w-5 text-chart-1" />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Grand Total Beneficiaries</CardDescription>
                <CardTitle className="flex items-center justify-between text-2xl">
                  {totals.total.toLocaleString()}
                  <Users2 className="h-5 w-5 text-chart-2" />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Male</CardDescription>
                <CardTitle className="flex items-center justify-between text-2xl text-chart-2">
                  {totals.male.toLocaleString()}
                  <ArrowUpRight className="h-5 w-5" />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Female</CardDescription>
                <CardTitle className="flex items-center justify-between text-2xl text-chart-5">
                  {totals.female.toLocaleString()}
                  <ArrowUpRight className="h-5 w-5" />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Reporting Compliance</CardDescription>
                <CardTitle className="flex items-center justify-between text-2xl">
                  {Math.round(complianceSummary.complianceRate)}%
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {complianceSummary.submitted + complianceSummary.late} of{" "}
                  {complianceSummary.expected || 0} org scopes submitted
                </p>
              </CardHeader>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Coordinator Comparison</CardTitle>
                  <CardDescription>
                    {comparisonMode === "coordinator"
                      ? "Portfolio totals by coordinator. Click a bar to drill down."
                      : "Organization comparison inside the selected coordinator."}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => downloadChartSvg(comparisonChartRef.current, "aggregates_comparison")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void downloadChartPng(comparisonChartRef.current, "aggregates_comparison")}
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div ref={comparisonChartRef}>
                  <ChartContainer
                    config={{
                      total: { label: "Total", color: "hsl(var(--primary))" },
                    }}
                    className="h-[300px]"
                  >
                    <BarChart data={dashboardRollupData.slice(0, comparisonMode === "coordinator" ? 8 : 10)}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={64} />
                      <YAxis tickLine={false} axisLine={false} />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            formatter={(value, name, item) => (
                              <div className="flex flex-col">
                                <span className="font-medium">{item?.payload?.name}</span>
                                <span>Total: {Number(value).toLocaleString()}</span>
                                <span>Organizations: {item?.payload?.organizations ?? 0}</span>
                              </div>
                            )}
                          />
                        }
                      />
                      <Bar
                        dataKey="total"
                        radius={[8, 8, 0, 0]}
                        fill="var(--color-total)"
                        onClick={(payload) => {
                          const id = payload?.id ? String(payload.id) : "";
                          if (!id) return;
                          if (comparisonMode === "coordinator") {
                            setParentOrgFilter(id);
                            setOrgFilter("all");
                            setComplianceSelection(null);
                          } else {
                            setOrgFilter(id);
                          }
                        }}
                      />
                    </BarChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Achieved vs Target</CardTitle>
                  <CardDescription>
                    Achieved totals compared with configured targets for the current scope.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => downloadChartSvg(targetsChartRef.current, "aggregates_targets")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void downloadChartPng(targetsChartRef.current, "aggregates_targets")}
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div ref={targetsChartRef}>
                  <ChartContainer
                    config={{
                      total: { label: "Achieved", color: "hsl(var(--chart-2))" },
                      target: { label: "Target", color: "hsl(var(--chart-4))" },
                    }}
                    className="h-[300px]"
                  >
                    <BarChart data={dashboardRollupData.slice(0, comparisonMode === "coordinator" ? 8 : 10)}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={64} />
                      <YAxis tickLine={false} axisLine={false} />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            formatter={(value, name, item) => (
                              <div className="flex flex-col">
                                <span className="font-medium">{item?.payload?.name}</span>
                                <span>{String(name)}: {Number(value).toLocaleString()}</span>
                                <span>Achievement: {Math.round(item?.payload?.percentAchieved ?? 0)}%</span>
                              </div>
                            )}
                          />
                        }
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar dataKey="total" fill="var(--color-total)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="target" fill="var(--color-target)" radius={[6, 6, 0, 0]}>
                        <LabelList
                          dataKey="percentAchieved"
                          position="top"
                          formatter={(value: number) => `${Math.round(value)}%`}
                        />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Trend Over Time</CardTitle>
                  <CardDescription>
                    Quarter-to-quarter trend for the selected indicator.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={detailIndicatorId} onValueChange={setDetailIndicatorId}>
                    <SelectTrigger className="w-full sm:w-[280px]">
                      <SelectValue placeholder="Select indicator" />
                    </SelectTrigger>
                    <SelectContent>
                      {dashboardGroups.map((group) => (
                        <SelectItem key={group.indicatorId} value={group.indicatorId}>
                          {group.indicatorName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={trendMode} onValueChange={(value) => setTrendMode(value as "consolidated" | "compare")}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="consolidated">Consolidated</SelectItem>
                      <SelectItem value="compare">Compare Scope</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div ref={trendChartRef}>
                  <ChartContainer
                    config={trendData.seriesKeys.reduce<Record<string, { label: string; color: string }>>(
                      (acc, key, index) => {
                        acc[key] = {
                          label:
                            key === "total"
                              ? "Total"
                              : trendData.seriesNames?.get?.(key) || comparisonBucketNames.get(key) || key,
                          color: dashboardSeriesColors[index % dashboardSeriesColors.length],
                        };
                        return acc;
                      },
                      {},
                    )}
                    className="h-[300px]"
                  >
                    <LineChart data={trendData.data}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="period" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      {trendData.seriesKeys.map((key) => (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stroke={`var(--color-${key})`}
                          strokeWidth={2.5}
                          dot={{ r: 3 }}
                          activeDot={{ r: 5 }}
                        />
                      ))}
                    </LineChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Organization Contribution</CardTitle>
                  <CardDescription>
                    Contribution by CSO / organization in the current scope. Click a bar to drill down.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => downloadChartSvg(contributionChartRef.current, "aggregates_contribution")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void downloadChartPng(contributionChartRef.current, "aggregates_contribution")}
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div ref={contributionChartRef}>
                  <ChartContainer
                    config={{
                      total: { label: "Contribution", color: "hsl(var(--chart-3))" },
                    }}
                    className="h-[300px]"
                  >
                    <BarChart data={contributionData} layout="vertical" margin={{ left: 24 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickLine={false} axisLine={false} />
                      <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={140} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar
                        dataKey="total"
                        fill="var(--color-total)"
                        radius={[0, 8, 8, 0]}
                        onClick={(payload) => {
                          const id = payload?.id ? String(payload.id) : "";
                          if (!id) return;
                          const coordinatorId = coordinatorByOrgId.get(id) || id;
                          setParentOrgFilter(coordinatorId);
                          setOrgFilter(id);
                        }}
                      />
                    </BarChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Reporting Compliance</CardTitle>
                <CardDescription>
                  Compliance summary for {activeCompliancePeriod || "the current scope"}, based on reporting period end dates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div ref={complianceChartRef}>
                  <ChartContainer
                    config={{
                      submitted: { label: "Submitted on time", color: "hsl(var(--chart-2))" },
                      late: { label: "Late", color: "hsl(var(--chart-4))" },
                      missing: { label: "Missing", color: "hsl(var(--destructive))" },
                    }}
                    className="h-[300px]"
                  >
                    <BarChart data={complianceData}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-16} textAnchor="end" height={62} />
                      <YAxis tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar
                        dataKey="submitted"
                        stackId="compliance"
                        fill="var(--color-submitted)"
                        onClick={(payload) =>
                          payload?.id &&
                          setComplianceSelection({
                            coordinatorId: String(payload.id),
                            status: "submitted",
                          })
                        }
                      />
                      <Bar
                        dataKey="late"
                        stackId="compliance"
                        fill="var(--color-late)"
                        onClick={(payload) =>
                          payload?.id &&
                          setComplianceSelection({
                            coordinatorId: String(payload.id),
                            status: "late",
                          })
                        }
                      />
                      <Bar
                        dataKey="missing"
                        stackId="compliance"
                        fill="var(--color-missing)"
                        onClick={(payload) =>
                          payload?.id &&
                          setComplianceSelection({
                            coordinatorId: String(payload.id),
                            status: "missing",
                          })
                        }
                      />
                    </BarChart>
                  </ChartContainer>
                </div>
                <div className="rounded-lg border border-dashed border-border p-3">
                  <p className="text-sm font-medium">
                    {complianceSelection
                      ? `${comparisonBucketNames.get(complianceSelection.coordinatorId) || coordinatorNameById.get(complianceSelection.coordinatorId) || "Scope"} ${complianceSelection.status}`
                      : "Click a compliance segment to inspect organizations"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedComplianceDetails.length > 0
                      ? selectedComplianceDetails.join(", ")
                      : "No selected compliance detail yet."}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Disaggregate Analysis</CardTitle>
                  <CardDescription>
                    Sex, age, and primary disaggregate breakdown for the selected indicator.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={breakdownMode} onValueChange={(value) => setBreakdownMode(value as "sex" | "age" | "primary")}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="age">Age View</SelectItem>
                      <SelectItem value="sex">Sex View</SelectItem>
                      <SelectItem value="primary">Disaggregate View</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => downloadChartSvg(breakdownChartRef.current, "aggregates_breakdown")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div ref={breakdownChartRef}>
                  <ChartContainer
                    config={{
                      Total: { label: "Totals", color: "#232123" },
                    }}
                    className="h-[360px] rounded-[1.5rem] border border-border/60 bg-white px-4 py-5"
                  >
                    <BarChart data={disaggregateBreakdownData} margin={{ top: 24, right: 24, left: 8, bottom: 28 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="rgba(148, 163, 184, 0.28)" />
                      <XAxis
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={-18}
                        textAnchor="end"
                        height={64}
                        tick={{ fill: "#64748b", fontSize: 11 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "#64748b", fontSize: 11 }}
                        tickFormatter={(value: number) => value.toLocaleString()}
                      />
                      <ChartTooltip
                        cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
                        content={
                          <ChartTooltipContent
                            hideIndicator
                            labelFormatter={(value) => (
                              <span className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
                                {String(value || "")}
                              </span>
                            )}
                            formatter={(value) => (
                              <div className="flex min-w-[9rem] items-center justify-between gap-4">
                                <span className="text-muted-foreground">Totals</span>
                                <span className="font-mono font-semibold text-foreground tabular-nums">
                                  {Number(value || 0).toLocaleString()}
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      <Bar dataKey="Total" fill="var(--color-Total)" radius={[6, 6, 0, 0]} maxBarSize={48}>
                        <LabelList
                          dataKey="Total"
                          position="top"
                          offset={8}
                          className="fill-foreground text-[11px] font-semibold"
                          formatter={(value: number) => value.toLocaleString()}
                        />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Matrix Detail</CardTitle>
                <CardDescription>
                  Heatmap view for {selectedDetailGroup?.indicatorName || "the selected indicator"}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedDetailMatrix ? (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    No matrix disaggregation is available for the selected indicator.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="min-w-full border-separate border-spacing-0 text-xs">
                      <thead>
                        <tr>
                          <th className="border-b border-r border-border bg-muted/80 px-3 py-2 text-left font-semibold">
                            {selectedDetailMatrix.primaryDisaggregateLabel}
                          </th>
                          <th className="border-b border-r border-border bg-muted/80 px-3 py-2 text-left font-semibold">
                            Age/Sex
                          </th>
                          {selectedDetailMatrix.ageBands.map((band) => (
                            <th
                              key={band}
                              className="border-b border-r border-border bg-muted/80 px-3 py-2 text-center font-semibold"
                            >
                              {band}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDetailMatrix.keyPops.map((kp) => (
                          <React.Fragment key={kp}>
                            {selectedDetailMatrix.secondDimensionValues.map((dimension, index) => (
                              <tr key={`${kp}-${dimension}`}>
                                {index === 0 ? (
                                  <td
                                    rowSpan={selectedDetailMatrix.secondDimensionValues.length}
                                    className="border-b border-r border-border px-3 py-2 align-top font-medium"
                                  >
                                    {kp}
                                  </td>
                                ) : null}
                                <td className="border-b border-r border-border px-3 py-2">
                                  {dimension}
                                </td>
                                {selectedDetailMatrix.ageBands.map((band) => {
                                  const value = toSafeNumber(
                                    selectedDetailMatrix.matrix[kp]?.[dimension]?.[band],
                                  );
                                  return (
                                    <td
                                      key={`${kp}-${dimension}-${band}`}
                                      className="border-b border-r border-border px-3 py-2 text-center font-medium"
                                      style={{
                                        backgroundColor: getHeatColor(
                                          value,
                                          selectedDetailMatrixMax,
                                        ),
                                      }}
                                    >
                                      {value.toLocaleString()}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle>Service Cascade</CardTitle>
                    <CardDescription>Predefined cascade stages built from filtered indicator totals.</CardDescription>
                  </div>
                  <Select value={selectedCascadeId} onValueChange={setSelectedCascadeId}>
                    <SelectTrigger className="w-full sm:w-[240px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cascadePresets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardHeader>
                <CardContent>
                  <div ref={cascadeChartRef}>
                    <ChartContainer
                      config={{
                        total: { label: "Total", color: "hsl(var(--primary))" },
                      }}
                      className="h-[260px]"
                    >
                      <FunnelChart>
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              formatter={(value, _name, item) => (
                                <div className="flex flex-col">
                                  <span className="font-medium">{item?.payload?.stage}</span>
                                  <span>Total: {Number(value).toLocaleString()}</span>
                                  <span>{item?.payload?.indicatorName}</span>
                                </div>
                              )}
                            />
                          }
                        />
                        <Funnel dataKey="total" data={cascadeData} isAnimationActive>
                          <LabelList position="right" dataKey="stage" fill="hsl(var(--foreground))" stroke="none" />
                          {cascadeData.map((entry, index) => (
                            <Cell key={entry.stage} fill={dashboardSeriesColors[index % dashboardSeriesColors.length]} />
                          ))}
                        </Funnel>
                      </FunnelChart>
                    </ChartContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Message / Category Breakdown</CardTitle>
                  <CardDescription>
                    Category-style outputs such as message types and screening-related indicators.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      total: { label: "Total", color: "hsl(var(--chart-4))" },
                    }}
                    className="h-[260px]"
                  >
                    <BarChart data={messageBreakdownData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickLine={false} axisLine={false} />
                      <YAxis dataKey="name" type="category" width={170} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="total" fill="var(--color-total)" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Table2 className="h-5 w-5" /> Aggregate Data
                </CardTitle>
                <CardDescription>
                  Consolidated matrix view arranged by workbook topic across all reporting organizations in the current scope
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsChartOpen(true)}>
                <BarChart3 className="mr-2 h-4 w-4" /> View Chart
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {dashboardGroups.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Table2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-semibold">No data found</h3>
                <p className="text-muted-foreground mt-1">
                  Try adjusting your filters or add new entries
                </p>
              </div>
            )}

            <div className="space-y-8">
              {dashboardTopicSections.map((section) => (
                <section key={section.id} className="space-y-4">
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold tracking-wide text-foreground">
                          {section.label}
                        </p>
                        <p className="max-w-3xl text-sm text-muted-foreground">
                          {section.description}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {section.groups.length} indicator
                          {section.groups.length === 1 ? "" : "s"}
                        </Badge>
                        <Badge variant="outline">
                          Topic total {section.totalValue.toLocaleString()}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {section.groups.map((group) => {
                const disaggregates = group.disaggregates;
                const projectNames = Array.from(
                  new Set(
                    group.items.map((item) =>
                      item.project_name ||
                      projectNameById.get(String(item.project)) ||
                      "Project",
                    ),
                  ),
                );
                const organizationNames = Array.from(
                  new Set(
                    group.items
                      .map((item) => item.organization_name || "")
                      .filter((name) => name.length > 0),
                  ),
                );
                const periodLabels = Array.from(
                  new Set(group.items.map((item) => getPeriodLabel(item))),
                );
                const totalValue = group.items.reduce(
                  (sum, item) => sum + getAggregateTotal(item),
                  0,
                );
                const contributingOrganizationLabel =
                  organizationNames.length === 1
                    ? organizationNames[0]
                    : `${organizationNames.length} reporting organizations`;
                const projectLabel =
                  projectNames.length === 1
                    ? projectNames[0]
                    : `${projectNames.length} projects`;
                const periodLabel =
                  periodLabels.length === 1
                    ? periodLabels[0]
                    : `${periodLabels.length} periods`;

                if (!disaggregates) {
                  return (
                    <div key={group.key} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-muted-foreground">Indicator</p>
                          <p className="text-base font-semibold">{group.indicatorName}</p>
                          <p className="text-sm text-muted-foreground">
                            {scopeOrganizationLabel} | {projectLabel} | {periodLabel}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">
                            {group.items.length} submissions merged from {contributingOrganizationLabel}
                          </p>
                          <p className="text-sm text-muted-foreground">Total</p>
                          <p className="text-xl font-semibold text-primary">
                            {Number(totalValue).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                }

                const indicator = indicatorById.get(group.indicatorId);
                const indicatorGroups = resolveDisplayDisaggregateGroups(
                  disaggregates,
                  indicator?.sub_labels,
                );
                const primaryDisaggregateLabel = getPrimaryDisaggregateLabel(
                  Array.from(indicatorGroups),
                );
                const {
                  matrix: displayMatrix,
                  keyPops: displayKeyPops,
                  secondDimensionValues,
                  ageBands,
                  showAypColumn,
                } = buildDisplayMatrix(disaggregates, indicatorGroups);

                const safeDimensions = secondDimensionValues.length ? secondDimensionValues : ["All"];
                const safeAgeBands = ageBands.length ? ageBands : ["Value"];
                const dataRowCount = displayKeyPops.length * safeDimensions.length;

                const dimensionTotals: Record<string, Record<string, number>> = {};
                safeDimensions.forEach((dimension) => {
                  dimensionTotals[dimension] = {};
                  safeAgeBands.forEach((band) => {
                    dimensionTotals[dimension][band] = 0;
                  });
                  if (showAypColumn) {
                    dimensionTotals[dimension][aypBandLabel] = 0;
                  }
                });

                displayKeyPops.forEach((kp) => {
                  const kpData = displayMatrix[kp] || {};
                  safeDimensions.forEach((dimension) => {
                    const values = kpData[dimension] || {};
                    safeAgeBands.forEach((band) => {
                      dimensionTotals[dimension][band] += toSafeNumber(values[band]);
                    });
                    if (showAypColumn) {
                      dimensionTotals[dimension][aypBandLabel] += computeAYP(values);
                    }
                  });
                });

                const combinedTotals: Record<string, number> = {};
                safeAgeBands.forEach((band) => {
                  combinedTotals[band] = safeDimensions.reduce(
                    (sum, dimension) => sum + toSafeNumber(dimensionTotals[dimension]?.[band]),
                    0,
                  );
                });
                if (showAypColumn) {
                  combinedTotals[aypBandLabel] = safeDimensions.reduce(
                    (sum, dimension) =>
                      sum + toSafeNumber(dimensionTotals[dimension]?.[aypBandLabel]),
                    0,
                  );
                }
                const combinedSubTotal = sumBands(combinedTotals, safeAgeBands);
                const combinedTotal = combinedSubTotal;
                const maxCellValue = Math.max(
                  0,
                  ...displayKeyPops.flatMap((kp) =>
                    safeDimensions.flatMap((dimension) =>
                      safeAgeBands.map((band) =>
                        toSafeNumber(displayMatrix[kp]?.[dimension]?.[band]),
                      ),
                    ),
                  ),
                );

                return (
                  <div key={group.key} className="rounded-lg border border-border p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-muted-foreground">Indicator</p>
                        <p className="text-base font-semibold">{group.indicatorName}</p>
                        <p className="text-sm text-muted-foreground">
                          {scopeOrganizationLabel} | {projectLabel} | {periodLabel}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{group.items.length} submissions merged</Badge>
                        <Badge variant="secondary">
                          {organizationNames.length} contributing org
                          {organizationNames.length === 1 ? "" : "s"}
                        </Badge>
                        <Badge variant="outline">Total {Number(totalValue).toLocaleString()}</Badge>
                      </div>
                    </div>

                    <div className="w-full overflow-x-auto overflow-y-auto rounded-lg border border-border max-h-[68vh]">
                      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
                        <thead>
                          <tr>
                            <th
                              className="sticky top-0 z-40 border-b border-r border-border bg-muted/90 px-2 py-2 text-center font-semibold"
                              style={{
                                minWidth: matrixColumnWidths.indicator,
                                width: matrixColumnWidths.indicator,
                              }}
                            >
                              Indicator
                            </th>
                            <th
                              className="sticky top-0 z-40 border-b border-r border-border bg-muted/90 px-2 py-2 text-left font-semibold"
                              style={{
                                minWidth: matrixColumnWidths.keyPopulation,
                                width: matrixColumnWidths.keyPopulation,
                              }}
                            >
                              {primaryDisaggregateLabel}
                            </th>
                            <th
                              className="sticky top-0 z-40 border-b border-r border-border bg-muted/90 px-2 py-2 text-left font-semibold"
                              style={{
                                minWidth: matrixColumnWidths.ageSex,
                                width: matrixColumnWidths.ageSex,
                              }}
                            >
                              Age/Sex
                            </th>
                            {safeAgeBands.map((band) => (
                              <th
                                key={band}
                                className="sticky top-0 z-30 border-b border-r border-border bg-muted/90 px-2 py-2 text-center font-semibold whitespace-nowrap"
                                style={{ minWidth: matrixColumnWidths.metric, width: matrixColumnWidths.metric }}
                              >
                                {band}
                              </th>
                            ))}
                            <th
                              className="sticky top-0 z-30 border-b border-r border-border bg-muted/90 px-2 py-2 text-center font-semibold whitespace-nowrap"
                              style={{ minWidth: matrixColumnWidths.metric, width: matrixColumnWidths.metric }}
                            >
                              Sub-total
                            </th>
                            <th
                              className="sticky top-0 z-30 border-b border-r border-border bg-muted/90 px-2 py-2 text-center font-semibold whitespace-nowrap"
                              style={{ minWidth: matrixColumnWidths.metric, width: matrixColumnWidths.metric }}
                            >
                              TOTAL
                            </th>
                            {showAypColumn ? (
                              <th
                                className="sticky top-0 z-30 border-b border-r border-border bg-muted/90 px-2 py-2 text-center font-semibold whitespace-nowrap"
                                style={{ minWidth: matrixColumnWidths.metric, width: matrixColumnWidths.metric }}
                              >
                                {aypBandLabel}
                              </th>
                            ) : null}
                          </tr>
                        </thead>
                        <tbody>
                          {displayKeyPops.map((kp, kpIndex) => {
                            const kpData = displayMatrix[kp] || {};
                            return (
                              <React.Fragment key={kp}>
                                {safeDimensions.map((dimension, dimensionIndex) => {
                                  const values = kpData[dimension] || {};
                                  const subTotal = sumBands(values, safeAgeBands);
                                  const ayp = showAypColumn ? computeAYP(values) : 0;
                                  const total = subTotal;
                                  const rowIndex = kpIndex * safeDimensions.length + dimensionIndex;
                                  const rowBaseClass = rowIndex % 2 === 0 ? "bg-background" : "bg-muted/10";
                                  return (
                                    <tr key={`${kp}-${dimension}`} className={rowBaseClass}>
                                      {kpIndex === 0 && dimensionIndex === 0 && (
                                        <td
                                          className="border-b border-r border-border bg-background px-2 py-2 align-middle text-center font-medium"
                                          rowSpan={dataRowCount}
                                          style={{
                                            minWidth: matrixColumnWidths.indicator,
                                            width: matrixColumnWidths.indicator,
                                          }}
                                        >
                                          <span className="block whitespace-normal break-words leading-snug text-center">
                                            {group.indicatorName}
                                          </span>
                                        </td>
                                      )}
                                      {dimensionIndex === 0 ? (
                                        <td
                                          className={`border-b border-r border-border px-2 py-2 align-top font-medium whitespace-normal break-words ${rowBaseClass}`}
                                          rowSpan={safeDimensions.length}
                                          style={{
                                            minWidth: matrixColumnWidths.keyPopulation,
                                            width: matrixColumnWidths.keyPopulation,
                                          }}
                                        >
                                          {kp}
                                        </td>
                                      ) : null}
                                      <td
                                        className={`border-b border-r border-border px-2 py-2 whitespace-normal break-words ${rowBaseClass}`}
                                        style={{
                                          minWidth: matrixColumnWidths.ageSex,
                                          width: matrixColumnWidths.ageSex,
                                        }}
                                      >
                                        {dimension}
                                      </td>
                                      {safeAgeBands.map((band) => (
                                        <td
                                          key={`${kp}-${dimension}-${band}`}
                                          className={`border-b border-r border-border px-2 py-2 text-center ${rowBaseClass}`}
                                          style={{
                                            backgroundColor: getHeatColor(
                                              toSafeNumber(values[band]),
                                              maxCellValue,
                                            ),
                                          }}
                                        >
                                          {toSafeNumber(values[band]).toLocaleString()}
                                        </td>
                                      ))}
                                      <td className={`border-b border-r border-border px-2 py-2 text-center ${rowBaseClass}`}>
                                        {subTotal.toLocaleString()}
                                      </td>
                                      <td className={`border-b border-r border-border px-2 py-2 text-center font-semibold ${rowBaseClass}`}>
                                        {total.toLocaleString()}
                                      </td>
                                      {showAypColumn ? (
                                        <td className={`border-b border-r border-border px-2 py-2 text-center ${rowBaseClass}`}>
                                          {ayp.toLocaleString()}
                                        </td>
                                      ) : null}
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                          <tr className="bg-muted/20 font-semibold">
                            <td
                              className="border-b border-r border-border bg-muted/20 px-2 py-2"
                              style={{
                                minWidth: matrixColumnWidths.indicator,
                                width: matrixColumnWidths.indicator,
                              }}
                            >
                              Sub-total
                            </td>
                            <td
                              className="border-b border-r border-border bg-muted/20 px-2 py-2 whitespace-normal break-words"
                              style={{
                                minWidth: matrixColumnWidths.keyPopulation,
                                width: matrixColumnWidths.keyPopulation,
                              }}
                            >
                              All
                            </td>
                            <td
                              className="border-b border-r border-border bg-muted/20 px-2 py-2 whitespace-normal break-words"
                              style={{
                                minWidth: matrixColumnWidths.ageSex,
                                width: matrixColumnWidths.ageSex,
                              }}
                            >
                              -
                            </td>
                            {safeAgeBands.map((band) => (
                              <td key={`sub-${band}`} className="border-b border-r border-border px-2 py-2 text-center">
                                {combinedTotals[band].toLocaleString()}
                              </td>
                            ))}
                            <td className="border-b border-r border-border px-2 py-2 text-center">{combinedSubTotal.toLocaleString()}</td>
                            <td className="border-b border-r border-border px-2 py-2 text-center">{combinedTotal.toLocaleString()}</td>
                            {showAypColumn ? (
                              <td className="border-b border-r border-border px-2 py-2 text-center">
                                {toSafeNumber(combinedTotals[aypBandLabel]).toLocaleString()}
                              </td>
                            ) : null}
                          </tr>
                          {safeDimensions.map((dimension) => {
                            const values = dimensionTotals[dimension] || {};
                            const subTotal = sumBands(values, safeAgeBands);
                            const ayp = toSafeNumber(values[aypBandLabel]);
                            const total = subTotal;
                            return (
                              <tr key={`total-${dimension}`} className="bg-muted/30 font-semibold">
                                <td
                                  className="border-b border-r border-border bg-muted/30 px-2 py-2"
                                  style={{
                                    minWidth: matrixColumnWidths.indicator,
                                    width: matrixColumnWidths.indicator,
                                  }}
                                >
                                  TOTAL
                                </td>
                                <td
                                  className="border-b border-r border-border bg-muted/30 px-2 py-2 whitespace-normal break-words"
                                  style={{
                                    minWidth: matrixColumnWidths.keyPopulation,
                                    width: matrixColumnWidths.keyPopulation,
                                  }}
                                >
                                  All
                                </td>
                                <td
                                  className="border-b border-r border-border bg-muted/30 px-2 py-2 whitespace-normal break-words"
                                  style={{
                                    minWidth: matrixColumnWidths.ageSex,
                                    width: matrixColumnWidths.ageSex,
                                  }}
                                >
                                  {dimension}
                                </td>
                                {safeAgeBands.map((band) => (
                                  <td key={`total-${dimension}-${band}`} className="border-b border-r border-border px-2 py-2 text-center">
                                    {toSafeNumber(values[band]).toLocaleString()}
                                  </td>
                                ))}
                                <td className="border-b border-r border-border px-2 py-2 text-center">{subTotal.toLocaleString()}</td>
                                <td className="border-b border-r border-border px-2 py-2 text-center">{total.toLocaleString()}</td>
                                {showAypColumn ? (
                                  <td className="border-b border-r border-border px-2 py-2 text-center">
                                    {ayp.toLocaleString()}
                                  </td>
                                ) : null}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </CardContent>
        </Card>

        <Dialog open={isChartOpen} onOpenChange={setIsChartOpen}>
          <DialogContent className="w-[95vw] sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>Aggregate Totals</DialogTitle>
              <DialogDescription>
                Totals by indicator for the selected filters.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadChartSvg(chartRef.current, "aggregates_indicator_totals")}
              >
                <Download className="mr-2 h-4 w-4" />
                Download Chart
              </Button>
            </div>
            {chartData.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
                No data available for the selected filters.
              </div>
            ) : (
              <div ref={chartRef}>
                <ChartContainer
                  config={{
                    total: { label: "Total", color: "hsl(var(--primary))" },
                  }}
                  className="h-[420px]"
                >
                  <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip
                      cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
                      content={<ChartTooltipContent indicator="dot" />}
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar
                      dataKey="total"
                      fill="var(--color-total)"
                      fillOpacity={0.85}
                      stroke="rgba(16, 24, 40, 0.2)"
                      strokeWidth={1}
                      barSize={32}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Suspense>
  );
}


