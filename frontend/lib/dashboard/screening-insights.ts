import { getAggregateTotal, resolveParentOrganizationId, toSafeNumber } from "@/lib/aggregates/aggregate-helpers";
import { formatMonthBucket, getMonthBucket, type MonthBucket } from "@/lib/aggregates/quarter-buckets";
import { resolveCanonicalIndicator, type CanonicalIndicatorDefinition } from "@/lib/indicators/canonical";
import { getIndicatorChartLabel } from "@/lib/indicators/display-name";
import {
  getEffectiveOrganizationType,
  isSeedCoordinatorOrganizationName,
} from "@/lib/organization-hierarchy";
import type { Aggregate, Indicator, Organization, Project } from "@/lib/types";

type HivTestingComparisonKey = "tested-total" | "tested-positive";

type ScreeningStageDefinition = {
  id: string;
  label: string;
  color: string;
  anyPatterns?: string[];
  allPatterns?: string[];
  excludePatterns?: string[];
};

type PathwayCardDefinition = {
  id: string;
  label: string;
  matchTokens: string[];
  stages: Array<{
    color: string;
    id: string;
    label: string;
    anyPatterns?: string[];
    allPatterns?: string[];
  }>;
};

export type ScreeningDashboardInsights = {
  isLoading: boolean;
  hasError: boolean;
  totalScreeningValue: number;
  indicatorCount: number;
  indicatorMetrics: Array<{
    indicatorId: string;
    label: string;
    percentage: number;
    target: number;
    value: number;
  }>;
  reportingOrganizationsCount: number;
  activeProjectsCount: number;
  topIndicators: Array<{ label: string; percentage: number; target: number; value: number }>;
  organizations: Array<{ label: string; percentage: number; target: number; value: number }>;
  projects: Array<{ label: string; percentage: number; target: number; value: number }>;
  hivPreventionMessageTypeByCso: {
    rows: Array<Record<string, number | string>>;
    series: Array<{ color: string; key: string; label: string }>;
  };
  hivPreventionMessagesByCso: Array<{ label: string; percentage: number; target: number; value: number }>;
  ncdMessageDisaggregates: Array<{ color: string; label: string; value: number }>;
  stages: Array<{ color: string; label: string; value: number }>;
  servicePathways: Array<{
    id: string;
    title: string;
    stages: Array<{ id: string; color: string; label: string; value: number }>;
    total: number;
    indicatorDetails: Array<{
      stageId: string;
      stageLabel: string;
      code: string;
      name: string;
      value: number;
    }>;
  }>;
  hivTestingComparison: Array<{ label: string; actual: number; target: number }>;
  trend: Array<Record<string, number | string>>;
  trendSeries: Array<{ color: string; key: string; label: string }>;
};

const screeningSeriesColors = ["#22C55E", "#0EA5E9", "#F59E0B", "#A855F7", "#14B8A6"] as const;
const hivPreventionMessageKeys = new Set([
  "hiv_messages_reached",
  "hiv_testing_messages_reached",
  "prep_messages_reached",
  "pep_messages_reached",
  "gbv_messages_reached",
]);
const explicitMessageIndicatorIds = new Set([
  "321", // HIV testing messages
  "322", // PEP messages
  "323", // PrEP messages
  "324", // GBV messages
  "325", // Condom use messages
  "326", // HIV treatment messages
  "327", // ARV-based prevention messages
  "328", // EMTCT messages
  "329", // HIV messages
  "330", // Stigma reduction messages
  "523", // PLWH condom use messages
  "522", // PLWH PrEP messages
]);
const hivPreventionMessageTypePalette = [
  "#4F81BD",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#4472C4",
  "#70AD47",
  "#255E91",
  "#9E480E",
] as const;
// Fallback stage colors for configured pathway stages that don't specify one.
const PATHWAY_STAGE_FALLBACK_COLORS = [
  "#22C55E",
  "#0EA5E9",
  "#F59E0B",
  "#A855F7",
  "#EF4444",
  "#14B8A6",
  "#64748B",
] as const;
const ncdMessageTypeDefinitions = [
  {
    label: "Alcohol Reduction Messages",
    color: "#1f6a8a",
    aliases: ["alcohol reduction messages", "alcohol abuse messages"],
  },
  {
    label: "Blood Glucose Messages",
    color: "#e67e22",
    aliases: ["blood glucose messages"],
  },
  {
    label: "Blood Pressure Messages",
    color: "#2e8b57",
    aliases: ["blood pressure messages", "bp messages"],
  },
  {
    label: "Healthy Diet Messages",
    color: "#1f9ac7",
    aliases: ["healthy diet messages"],
  },
  {
    label: "Physical Activity Messages",
    color: "#9c2f92",
    aliases: ["physical activity messages"],
  },
  {
    label: "Psychoeducation",
    color: "#48a535",
    aliases: ["psychoeducation"],
  },
  {
    label: "Tobacco Control Messages",
    color: "#0f4258",
    aliases: ["tobacco control messages", "tobacco control mssages", "tobacco cessation messages"],
  },
  {
    label: "Waist Circumference Messages",
    color: "#b55a18",
    aliases: ["waist circumference messages"],
  },
  {
    label: "Weight Management Messages",
    color: "#0b4d18",
    aliases: ["weight management messages"],
  },
] as const;
const ncdDisaggregateFallbackPalette = [
  "#0f766e",
  "#2563eb",
  "#f97316",
  "#7c3aed",
  "#be123c",
  "#0891b2",
  "#65a30d",
  "#92400e",
] as const;

const hivTestingComparisonDefinitions = [
  { id: "tested-total", label: "People tested for HIV" },
  { id: "tested-positive", label: "People tested HIV positive" },
] as const;

const screeningStageDefinitions = [
  { id: "screened", label: "Screened", anyPatterns: ["screened", "screening"], color: "#22C55E" },
  { id: "eligible", label: "Eligible", anyPatterns: ["eligible"], color: "#0EA5E9" },
  { id: "referred", label: "Referred", anyPatterns: ["referred", "referral"], color: "#F59E0B" },
  {
    id: "linked-hiv",
    label: "Linked HIV care",
    anyPatterns: ["linked", "linkage"],
    allPatterns: ["hiv"],
    color: "#A855F7",
  },
  {
    id: "linked-prep",
    label: "Linked PrEP",
    anyPatterns: ["linked", "linkage"],
    allPatterns: ["prep"],
    color: "#14B8A6",
  },
  {
    id: "linked-pep",
    label: "Linked PEP",
    anyPatterns: ["linked", "linkage"],
    allPatterns: ["pep"],
    color: "#F97316",
  },
  {
    id: "linked-other",
    label: "Linked (Other)",
    anyPatterns: ["linked", "linkage"],
    excludePatterns: ["hiv", "prep", "pep"],
    color: "#64748B",
  },
] as const satisfies readonly ScreeningStageDefinition[];

const pathwayCardDefinitions: PathwayCardDefinition[] = [
  {
    id: "hiv",
    label: "HIV",
    matchTokens: ["hiv"],
    stages: [
      { id: "tested", label: "Tested", color: "#22C55E", anyPatterns: ["tested", "testing"] },
      { id: "positive", label: "Positive", color: "#EF4444", anyPatterns: ["positive"] },
      { id: "referred", label: "Referred", color: "#F59E0B", anyPatterns: ["referred", "referral"] },
      { id: "linked-care", label: "Linked to care", color: "#A855F7", anyPatterns: ["linked", "linkage"], allPatterns: ["care"] },
    ],
  },
  {
    id: "prep",
    label: "PrEP",
    matchTokens: ["prep"],
    stages: [
      { id: "eligible", label: "Eligible", color: "#0EA5E9", anyPatterns: ["eligible"] },
      { id: "referred", label: "Referred", color: "#F59E0B", anyPatterns: ["referred", "referral"] },
      { id: "linked", label: "Linked", color: "#14B8A6", anyPatterns: ["linked", "linkage"] },
    ],
  },
  {
    id: "pep",
    label: "PEP",
    matchTokens: ["pep"],
    stages: [
      { id: "eligible", label: "Eligible", color: "#0EA5E9", anyPatterns: ["eligible"] },
      { id: "referred", label: "Referred", color: "#F59E0B", anyPatterns: ["referred", "referral"] },
      { id: "linked", label: "Linked", color: "#14B8A6", anyPatterns: ["linked", "linkage"] },
    ],
  },
  {
    id: "gbv",
    label: "GBV",
    matchTokens: ["gbv", "violence"],
    stages: [
      { id: "screened", label: "Screened", color: "#22C55E", anyPatterns: ["screened", "screening"] },
      { id: "eligible", label: "Eligible", color: "#0EA5E9", anyPatterns: ["eligible"] },
      { id: "referred", label: "Referred", color: "#F59E0B", anyPatterns: ["referred", "referral"] },
    ],
  },
];

// User-configured service pathways (per org, stored in Organization.dashboard_config.servicePathways).
// When present, these REPLACE the hardcoded heuristic pathways: each pathway is a funnel of stages, and
// each stage lists the indicator ids the org chose to include in it.
export type ConfiguredPathwayStage = {
  id: string;
  label: string;
  color?: string;
  indicatorIds: Array<string | number>;
};
export type ConfiguredPathway = {
  id: string;
  label: string;
  stages: ConfiguredPathwayStage[];
};

type BuildHomeDashboardScreeningInsightsInput = {
  aggregatesData?: Aggregate[] | null;
  indicatorsData?: Indicator[] | null;
  organizations: Organization[];
  activeProjects: Project[];
  scopedOrganizationIds: Set<string> | null;
  rollupLevel?: "organization" | "coordinator";
  selectedQuarter?: 1 | 2 | 3 | 4 | null;
  includeHivPreventionMessageTypeByCso?: boolean;
  servicePathwayConfig?: ConfiguredPathway[] | null;
  isLoading: boolean;
  hasError: boolean;
};

type DashboardTargetRow = {
  project: string;
  project_name?: string;
  organization?: string;
  organization_name?: string;
  q1_target?: number;
  q2_target?: number;
  q3_target?: number;
  q4_target?: number;
  target_value: number;
};

function normalizeDashboardText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isTotalLikeDisaggregateLabel(rawLabel: string) {
  const normalized = normalizeDashboardText(rawLabel);
  if (!normalized) return false;
  return (
    normalized === "total" ||
    normalized === "totals" ||
    normalized === "overall" ||
    normalized === "value" ||
    normalized === "values" ||
    normalized.startsWith("total ")
  );
}

function hasToken(text: string, token: string) {
  return text.includes(token);
}

function hasAnyToken(text: string, tokens: string[]) {
  return tokens.some((token) => hasToken(text, token));
}

function hasAllTokens(text: string, tokens: string[]) {
  return tokens.every((token) => hasToken(text, token));
}

function dedupeDashboardTargetRows(rows: DashboardTargetRow[]) {
  const seen = new Set<string>();
  const deduped: DashboardTargetRow[] = [];

  for (const row of rows) {
        const key = [
      String(row.project || "").trim(),
      String(row.project_name || "").trim(),
      String(row.organization || "").trim(),
      String(row.organization_name || "").trim(),
      String(toSafeNumber(row.q1_target)),
      String(toSafeNumber(row.q2_target)),
      String(toSafeNumber(row.q3_target)),
      String(toSafeNumber(row.q4_target)),
      String(toSafeNumber(row.target_value)),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function isCoordinatorPortfolioOrganization(subject: {
  name?: string | null;
  type?: string | null;
}) {
  return (
    getEffectiveOrganizationType(subject) === "coordinator" ||
    isSeedCoordinatorOrganizationName(String(subject.name || ""))
  );
}

function resolveRollupOrganization({
  organizationById,
  organizationId,
  organizationName,
  rollupLevel,
}: {
  organizationById: Map<string, Organization>;
  organizationId: string;
  organizationName: string;
  rollupLevel: "organization" | "coordinator";
}) {
  const fallbackLabel = organizationName || "Unassigned org";
  if (rollupLevel !== "coordinator") {
    return {
      key: organizationId || `name:${fallbackLabel}`,
      label: fallbackLabel,
    };
  }

  if (!organizationId) {
    return {
      key: `name:${fallbackLabel}`,
      label: fallbackLabel,
    };
  }

  let current = organizationById.get(organizationId);
  let lastKnownNode: Organization | null = current || null;
  const visited = new Set<string>();

  while (current) {
    const currentId = String(current.id || "").trim();
    if (!currentId || visited.has(currentId)) break;
    visited.add(currentId);
    lastKnownNode = current;

    if (rollupLevel === "coordinator" && isCoordinatorPortfolioOrganization(current)) {
      const label = String(current.name || fallbackLabel);
      return {
        key: currentId || `name:${label}`,
        label,
      };
    }

    const parentId = resolveParentOrganizationId(current as { id: string | number; parent?: string | number | null; parentId?: string | number | null });
    if (!parentId) break;
    current = organizationById.get(String(parentId));
  }

  if (lastKnownNode) {
    const label = String(lastKnownNode.name || fallbackLabel);
    const id = String(lastKnownNode.id || "").trim();
    return {
      key: id || `name:${label}`,
      label,
    };
  }

  return {
    key: organizationId || `name:${fallbackLabel}`,
    label: fallbackLabel,
  };
}

function resolveQuarterTargetValue(
  targetRow: DashboardTargetRow,
  selectedQuarter: 1 | 2 | 3 | 4 | null,
) {
  if (!selectedQuarter) return null;
  const fieldName = `q${selectedQuarter}_target` as
    | "q1_target"
    | "q2_target"
    | "q3_target"
    | "q4_target";
  const quarterValue = targetRow[fieldName];
  // Runtime guard kept for API rows that may arrive as an empty string even
  // though the type is number; cast so the comparison type-checks.
  if (quarterValue === null || quarterValue === undefined || (quarterValue as unknown) === "") return null;
  return toSafeNumber(quarterValue);
}

function resolveHivTestingCanonicalKey(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const canonical = resolveCanonicalIndicator(candidate);
    if (!canonical) continue;
    if (canonical.key === "hiv_tested" || canonical.key === "hiv_positive") {
      return canonical.key;
    }
  }
  return null;
}

function resolveCanonicalIndicatorDefinition(
  ...candidates: Array<string | null | undefined>
): CanonicalIndicatorDefinition | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const canonical = resolveCanonicalIndicator(candidate);
    if (canonical) return canonical;
  }
  return null;
}

function isHivPreventionMessagingIndicator(
  matchText: string,
  canonical: CanonicalIndicatorDefinition | null,
  indicatorId?: string | null,
  category?: string | null,
) {
  if (indicatorId && explicitMessageIndicatorIds.has(String(indicatorId).trim())) return true;
  if (canonical && hivPreventionMessageKeys.has(canonical.key)) return true;

  const normalizedCategory = normalizeDashboardText(category);
  const isHivPreventionCategory =
    normalizedCategory === "hiv prevention" ||
    normalizedCategory === "hiv prevention messages" ||
    normalizedCategory.includes("hiv prevention");
  const hasMessagingToken =
    /\bmessage(?:s)?\b/.test(matchText) ||
    /\breached\b/.test(matchText) ||
    /\bsensiti[sz]ed\b/.test(matchText) ||
    /\bengaged\b/.test(matchText);
  const hasHivProgramToken =
    /\bhiv\b/.test(matchText) ||
    /\bprep\b/.test(matchText) ||
    /\bpep\b/.test(matchText) ||
    /\bgbv\b/.test(matchText) ||
    /\bcondom(?:s)?\b/.test(matchText) ||
    /\barv\b/.test(matchText) ||
    /\bemtct\b/.test(matchText) ||
    /\bstigma\b/.test(matchText);
  const isCanonicalMessagingIndicator = canonical?.stage === "messaging";

  return hasMessagingToken && (
    isCanonicalMessagingIndicator ||
    isHivPreventionCategory ||
    hasHivProgramToken
  );
}

function toSeriesKey(value: string) {
  const normalized = normalizeDashboardText(value).replace(/\s+/g, "_");
  return normalized || "other";
}

function getHivPreventionMessageType(
  matchText: string,
  canonical: CanonicalIndicatorDefinition | null,
  indicatorLabel: string,
) {
  const canonicalKey = canonical?.key || "";
  if (canonicalKey === "hiv_testing_messages_reached") return "HIV Testing";
  if (canonicalKey === "pep_messages_reached") return "PEP";
  if (canonicalKey === "prep_messages_reached") return "PrEP";
  if (canonicalKey === "gbv_messages_reached") return "GBV";
  if (canonicalKey === "hiv_messages_reached") return "HIV Messages";

  if (/\bprep\b/.test(matchText)) return "PrEP";
  if (/\bpep\b/.test(matchText)) return "PEP";
  if (/\bgbv\b/.test(matchText)) return "GBV";
  if (/\bemtct\b/.test(matchText)) return "EMTCT";
  if (/\bcondom(?:s)?\b/.test(matchText)) return "Condom Use";
  if (/\btreatment\b/.test(matchText)) return "HIV Treatment";
  if (/\barv\b/.test(matchText)) return "ARV Based Prevention";
  if (/\bstigma\b/.test(matchText)) return "Stigma Reduction";
  if (/\btesting\b/.test(matchText)) return "HIV Testing";
  if (/\bhiv\b/.test(matchText)) return "HIV Messages";

  return indicatorLabel || "Other HIV Messaging";
}

function isMessagingLikeIndicator(
  matchText: string,
  canonical: CanonicalIndicatorDefinition | null,
) {
  if (canonical?.stage === "messaging") return true;
  return /\bmessage(?:s)?\b/.test(matchText) || /\breached\b/.test(matchText);
}

function isNcdMessagingIndicator(
  matchText: string,
  canonical: CanonicalIndicatorDefinition | null,
  category?: string | null,
) {
  const normalizedCategory = normalizeDashboardText(category);
  const hasNcdToken =
    /\bncd\b/.test(matchText) ||
    /\bnon communicable\b/.test(matchText) ||
    /\bnoncommunicable\b/.test(matchText) ||
    normalizedCategory.includes("ncd");
  const hasMessagingToken =
    /\bmessage(?:s)?\b/.test(matchText) ||
    /\breached\b/.test(matchText) ||
    /\bsensiti[sz]ed\b/.test(matchText) ||
    /\bengaged\b/.test(matchText);
  return hasNcdToken && (hasMessagingToken || canonical?.stage === "messaging");
}

function resolveNcdMessageTypeDefinition(rawLabel: string) {
  const normalized = normalizeDashboardText(rawLabel);
  if (!normalized) return null;
  for (const definition of ncdMessageTypeDefinitions) {
    const matches = definition.aliases.some((alias) =>
      normalized.includes(normalizeDashboardText(alias)),
    );
    if (matches) return definition;
  }
  return null;
}

function getDisaggregatesMap(value: unknown): Record<string, Record<string, Record<string, unknown>>> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (!source.disaggregates || typeof source.disaggregates !== "object") return null;
  return source.disaggregates as Record<string, Record<string, Record<string, unknown>>>;
}

function readDisaggregateEntryTotal(entry: Record<string, unknown> | undefined) {
  if (!entry) return 0;
  const preferredKeys = ["TOTAL", "Total", "total", "Value", "value"];
  for (const key of preferredKeys) {
    if (entry[key] !== undefined) return toSafeNumber(entry[key]);
  }
  return Object.entries(entry).reduce((sum, [rawKey, rawValue]) => {
    const normalizedKey = normalizeDashboardText(rawKey);
    if (normalizedKey.includes("ayp")) return sum;
    return sum + toSafeNumber(rawValue);
  }, 0);
}

// Returns the pathway card+stage assignments for a canonical indicator.
// Returns null  → indicator is not in the canonical map; caller may use text fallback.
// Returns []    → indicator IS canonical but belongs to no pathway card; skip text fallback.
// Returns [...] → explicit card+stage assignments.
function getCanonicalPathwayStageMatches(
  canonical: CanonicalIndicatorDefinition | null,
): Array<{ cardId: string; stageId: string }> | null {
  if (!canonical) return null;

  const key = canonical.key;

  // ── HIV pathway ──────────────────────────────────────────────────────────
  if (key === "hiv_tested") return [{ cardId: "hiv", stageId: "tested" }];
  if (key === "hiv_positive") return [{ cardId: "hiv", stageId: "positive" }];
  if (key === "referred_hiv_testing") return [{ cardId: "hiv", stageId: "referred" }];
  if (key === "linked_to_care") return [{ cardId: "hiv", stageId: "linked-care" }];
  if (key === "ayp_linked_to_care") return [{ cardId: "hiv", stageId: "linked-care" }];
  if (key === "initiated_on_art") return [{ cardId: "hiv", stageId: "linked-care" }];
  if (key === "art_defaulters_reinitiated_14_89") return [{ cardId: "hiv", stageId: "linked-care" }];
  if (key === "ltfu_reinitiated_90_plus") return [{ cardId: "hiv", stageId: "linked-care" }];

  // ── PrEP pathway ─────────────────────────────────────────────────────────
  if (key === "prep_assessed" || key === "prep_eligible") return [{ cardId: "prep", stageId: "eligible" }];
  if (key === "referred_prep") return [{ cardId: "prep", stageId: "referred" }];
  if (key === "linked_to_prep" || key === "prep_linked") return [{ cardId: "prep", stageId: "linked" }];

  // ── PEP pathway ──────────────────────────────────────────────────────────
  if (key === "pep_assessed" || key === "pep_eligible") return [{ cardId: "pep", stageId: "eligible" }];
  if (key === "referred_pep") return [{ cardId: "pep", stageId: "referred" }];
  if (key === "linked_to_pep" || key === "pep_linked") return [{ cardId: "pep", stageId: "linked" }];

  // ── GBV pathway ──────────────────────────────────────────────────────────
  if (key === "gbv_screened") return [{ cardId: "gbv", stageId: "screened" }];
  if (
    key === "gbv_eligible" ||
    key === "gbv_eligible_clinical" ||
    key === "gbv_eligible_justice" ||
    key === "gbv_eligible_psychosocial"
  ) {
    return [{ cardId: "gbv", stageId: "eligible" }];
  }
  if (
    key === "gbv_referred_clinical" ||
    key === "gbv_referred_justice" ||
    key === "gbv_referred_psychosocial"
  ) {
    return [{ cardId: "gbv", stageId: "referred" }];
  }

  // Known canonical but not assigned to any pathway card — return [] so the
  // caller does NOT fall back to text matching (which would misplace STI linked-
  // to-care into HIV, or TB/legal referrals into HIV referred, etc.).
  return [];
}

function matchesScreeningStage(matchText: string, stage: ScreeningStageDefinition) {
  const hasAny =
    !stage.anyPatterns || stage.anyPatterns.length === 0
      ? true
      : hasAnyToken(matchText, stage.anyPatterns);
  const hasAll =
    !stage.allPatterns || stage.allPatterns.length === 0
      ? true
      : hasAllTokens(matchText, stage.allPatterns);
  const hasExcluded =
    !!stage.excludePatterns && hasAnyToken(matchText, stage.excludePatterns);

  return hasAny && hasAll && !hasExcluded;
}

function getBestScreeningStage(matchText: string): ScreeningStageDefinition | null {
  const matches = screeningStageDefinitions.filter((stage) =>
    matchesScreeningStage(matchText, stage),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const stagePriority = new Map<string, number>([
    ["linked-hiv", 70],
    ["linked-prep", 69],
    ["linked-pep", 68],
    ["linked-other", 67],
    ["referred", 50],
    ["eligible", 30],
    ["screened", 10],
  ]);

  return matches.sort(
    (left, right) => (stagePriority.get(right.id) || 0) - (stagePriority.get(left.id) || 0),
  )[0];
}

function getHivTestingComparisonKey(
  matchText: string,
  canonicalHivKey: "hiv_tested" | "hiv_positive" | null,
): HivTestingComparisonKey | null {
  if (canonicalHivKey === "hiv_tested") return "tested-total";
  if (canonicalHivKey === "hiv_positive") return "tested-positive";

  const isPositiveTestingIndicator =
    matchText.includes("hiv") &&
    matchText.includes("test") &&
    matchText.includes("positive");
  if (isPositiveTestingIndicator) return "tested-positive";

  const isTotalTestingIndicator =
    matchText.includes("tested for hiv") &&
    !matchText.includes("positive") &&
    !matchText.includes("referred");
  if (isTotalTestingIndicator) return "tested-total";

  return null;
}

function getPathwayStageValue(matchText: string, definition: PathwayCardDefinition) {
  if (!hasAnyToken(matchText, definition.matchTokens)) {
    return null;
  }

  const matchedStages = definition.stages.filter((stage) => {
    const hasAny =
      !stage.anyPatterns || stage.anyPatterns.length === 0
        ? true
        : hasAnyToken(matchText, stage.anyPatterns);
    const hasAll =
      !stage.allPatterns || stage.allPatterns.length === 0
        ? true
        : hasAllTokens(matchText, stage.allPatterns);
    return hasAny && hasAll;
  });

  if (matchedStages.length <= 1) {
    return matchedStages[0] ?? null;
  }

  const stagePriorityByCard: Record<string, string[]> = {
    hiv: ["linked-care", "referred", "positive", "tested"],
    prep: ["linked", "referred", "eligible"],
    pep: ["linked", "referred", "eligible"],
    gbv: ["referred", "eligible", "screened"],
  };
  const priority = stagePriorityByCard[definition.id] || [];
  for (const stageId of priority) {
    const prioritizedMatch = matchedStages.find((stage) => stage.id === stageId);
    if (prioritizedMatch) return prioritizedMatch;
  }

  return matchedStages[0] ?? null;
}

function toMonthBucketKey(bucket: MonthBucket) {
  return `${bucket.year}-${String(bucket.month).padStart(2, "0")}`;
}

function formatMonthBucketKey(bucketKey: string) {
  const [yearValue, monthValue] = bucketKey.split("-");
  const year = Number(yearValue);
  const month = Number(monthValue);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return bucketKey;
  return formatMonthBucket({ year, month });
}

function buildEmptyScreeningInsights(isLoading: boolean, hasError: boolean): ScreeningDashboardInsights {
  return {
    isLoading,
    hasError,
    totalScreeningValue: 0,
    indicatorCount: 0,
    indicatorMetrics: [],
    reportingOrganizationsCount: 0,
    activeProjectsCount: 0,
    topIndicators: [],
    organizations: [],
    projects: [],
    hivPreventionMessageTypeByCso: {
      rows: [],
      series: [],
    },
    hivPreventionMessagesByCso: [],
    ncdMessageDisaggregates: [],
    stages: screeningStageDefinitions.map((stage) => ({
      color: stage.color,
      label: stage.label,
      value: 0,
    })),
    servicePathways: pathwayCardDefinitions.map((card) => ({
      id: card.id,
      title: card.label,
      stages: card.stages.map((stage) => ({
        id: stage.id,
        color: stage.color,
        label: stage.label,
        value: 0,
      })),
      total: 0,
      indicatorDetails: [],
    })),
    hivTestingComparison: hivTestingComparisonDefinitions.map((definition) => ({
      actual: 0,
      label: definition.label,
      target: 0,
    })),
    trend: [],
    trendSeries: [],
  };
}

export function buildHomeDashboardScreeningInsights({
  aggregatesData,
  indicatorsData,
  organizations,
  activeProjects,
  scopedOrganizationIds,
  rollupLevel = "organization",
  selectedQuarter = null,
  includeHivPreventionMessageTypeByCso = true,
  servicePathwayConfig = null,
  isLoading,
  hasError,
}: BuildHomeDashboardScreeningInsightsInput): ScreeningDashboardInsights {
  if (!aggregatesData) {
    return buildEmptyScreeningInsights(isLoading, hasError);
  }

  const aggregateRows = scopedOrganizationIds
    ? aggregatesData.filter((aggregate) => scopedOrganizationIds.has(String(aggregate.organization || "")))
    : aggregatesData;

  const indicatorMetaById = new Map<
    string,
    { id: string; category?: Indicator["category"]; code?: string; name: string; short_name?: string }
  >(
    (indicatorsData ?? []).map((indicator) => [
      String(indicator.id),
      {
        id: String(indicator.id),
        category: indicator.category,
        code: indicator.code,
        name: indicator.name,
        short_name: indicator.short_name,
      },
    ]),
  );
  const indicatorMetaByNormalizedName = new Map<
    string,
    { id: string; category?: Indicator["category"]; code?: string; name: string; short_name?: string }
  >(
    (indicatorsData ?? [])
      .map((indicator) => [
        normalizeDashboardText(indicator.name),
        {
          id: String(indicator.id),
          category: indicator.category,
          code: indicator.code,
          name: indicator.name,
          short_name: indicator.short_name,
        },
      ] as const)
      .filter(([name]) => Boolean(name)),
  );
  const organizationNameById = new Map(
    organizations.map((organization) => [String(organization.id), organization.name || "Unassigned org"]),
  );
  const organizationById = new Map(
    organizations.map((organization) => [String(organization.id), organization]),
  );
  const coordinatorRollupOrganizations = organizations
    .filter((organization) => isCoordinatorPortfolioOrganization(organization))
    .filter((organization) =>
      scopedOrganizationIds ? scopedOrganizationIds.has(String(organization.id)) : true,
    )
    .map((organization) => ({
      key: String(organization.id),
      label: String(organization.name || "Unassigned coordinator"),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const coordinatorRollupKeys = new Set(
    coordinatorRollupOrganizations.map((organization) => organization.key),
  );
  const coordinatorLabelByKey = new Map(
    coordinatorRollupOrganizations.map((organization) => [organization.key, organization.label]),
  );
  const coordinatorKeyByNormalizedLabel = new Map(
    coordinatorRollupOrganizations.map((organization) => [normalizeDashboardText(organization.label), organization.key]),
  );
  const resolveCoordinatorRollupKey = (
    rollupOrganization: { key: string; label: string },
    fallbackLabel?: string,
  ) => {
    if (coordinatorRollupKeys.has(rollupOrganization.key)) return rollupOrganization.key;

    const normalizedPrimaryLabel = normalizeDashboardText(rollupOrganization.label || "");
    if (normalizedPrimaryLabel) {
      const matchedKey = coordinatorKeyByNormalizedLabel.get(normalizedPrimaryLabel);
      if (matchedKey) return matchedKey;
    }

    const normalizedFallbackLabel = normalizeDashboardText(fallbackLabel || "");
    if (normalizedFallbackLabel) {
      const matchedKey = coordinatorKeyByNormalizedLabel.get(normalizedFallbackLabel);
      if (matchedKey) return matchedKey;
    }

    return null;
  };
  const projectNameById = new Map(
    activeProjects.map((project) => [String(project.id), project.name || project.code || "Unassigned project"]),
  );
  const fallbackTargetsByIndicatorId = new Map<string, DashboardTargetRow[]>();

  for (const project of activeProjects) {
    const projectId = String(project.id || "");
    const projectName = project.name || project.code || "Unassigned project";

    const projectOrganizationTargets = project.organization_targets || [];
    const projectHasOrganizationTargets = projectOrganizationTargets.length > 0;
    if (projectHasOrganizationTargets) {
      for (const targetRow of projectOrganizationTargets) {
        const indicatorId = String(targetRow.indicator || "").trim();
        if (!indicatorId) continue;
        const targetValue = toSafeNumber(targetRow.target_value);
        if (targetValue <= 0) continue;

        const targetOrganizationId = String(targetRow.organization || "").trim();
        if (scopedOrganizationIds && targetOrganizationId && !scopedOrganizationIds.has(targetOrganizationId)) {
          continue;
        }

        const current = fallbackTargetsByIndicatorId.get(indicatorId) || [];
        current.push({
          project: projectId,
          project_name: projectName,
          organization: targetOrganizationId || undefined,
          organization_name: targetRow.organization_name,
          q1_target: targetRow.q1_target,
          q2_target: targetRow.q2_target,
          q3_target: targetRow.q3_target,
          q4_target: targetRow.q4_target,
          target_value: targetValue,
        });
        fallbackTargetsByIndicatorId.set(indicatorId, current);
      }
    } else {
      for (const targetRow of project.project_indicators || []) {
        const indicatorId = String(targetRow.indicator || "").trim();
        if (!indicatorId) continue;
        const targetValue = toSafeNumber(targetRow.target_value);
        if (targetValue <= 0) continue;

        const current = fallbackTargetsByIndicatorId.get(indicatorId) || [];
        current.push({
          project: projectId,
          project_name: projectName,
          q1_target: targetRow.q1_target,
          q2_target: targetRow.q2_target,
          q3_target: targetRow.q3_target,
          q4_target: targetRow.q4_target,
          target_value: targetValue,
        });
        fallbackTargetsByIndicatorId.set(indicatorId, current);
      }
    }
  }

  const approvedAggregates = aggregateRows.filter((aggregate) => aggregate.status === "approved");
  const screeningIndicatorTotals = new Map<string, { indicatorId: string; label: string; target: number; total: number }>();
  const trendIndicatorTotals = new Map<string, { label: string; total: number }>();
  const organizationTotals = new Map<string, { label: string; target: number; total: number }>();
  const hivPreventionMessageTypeTotals = new Map<string, { label: string; total: number }>();
  const hivPreventionMessageTypeByOrganization = new Map<
    string,
    { label: string; total: number; totalsByType: Map<string, number> }
  >();
  const hivPreventionMessagesOrganizationTotals = new Map<
    string,
    { label: string; target: number; total: number }
  >();
  const ncdMessageDisaggregateTotals = new Map<
    string,
    { color: string; label: string; total: number }
  >();
  const ncdDisaggregateFallbackColorByKey = new Map<string, string>();
  const projectTotals = new Map<string, { label: string; target: number; total: number }>();
  const stageTotals = new Map<string, number>(
    screeningStageDefinitions.map((stage) => [stage.id, 0] as [string, number]),
  );
  const servicePathwayTotals = new Map<string, Map<string, number>>(
    pathwayCardDefinitions.map((card) => [
      card.id,
      new Map(card.stages.map((stage) => [stage.id, 0])),
    ]),
  );
  const pathwayCardById = new Map(pathwayCardDefinitions.map((card) => [card.id, card]));
  const servicePathwayDetails = new Map<
    string,
    Map<
      string,
      {
        stageId: string;
        stageLabel: string;
        code: string;
        name: string;
        value: number;
      }
    >
  >(pathwayCardDefinitions.map((card) => [card.id, new Map()]));
  // Config-driven service pathways: when the org configured pathways, accumulate
  // stage totals by the explicitly chosen indicator ids (parallel to the heuristic
  // accumulation above). configuredPathways is non-empty only when valid config exists.
  const configuredPathways = (servicePathwayConfig ?? []).filter(
    (pathway) => pathway && Array.isArray(pathway.stages) && pathway.stages.length > 0,
  );
  const hasConfiguredPathways = configuredPathways.length > 0;
  // indicatorId -> [{ cardId, stageId, stageLabel, color }]
  const configStageByIndicatorId = new Map<
    string,
    Array<{ cardId: string; stageId: string; stageLabel: string; color?: string }>
  >();
  const configPathwayTotals = new Map<string, Map<string, number>>();
  const configPathwayDetails = new Map<
    string,
    Map<string, { stageId: string; stageLabel: string; code: string; name: string; value: number }>
  >();
  if (hasConfiguredPathways) {
    for (const pathway of configuredPathways) {
      configPathwayTotals.set(pathway.id, new Map(pathway.stages.map((stage) => [stage.id, 0])));
      configPathwayDetails.set(pathway.id, new Map());
      for (const stage of pathway.stages) {
        for (const indicatorId of stage.indicatorIds || []) {
          const key = String(indicatorId);
          const matches = configStageByIndicatorId.get(key) ?? [];
          matches.push({ cardId: pathway.id, stageId: stage.id, stageLabel: stage.label, color: stage.color });
          configStageByIndicatorId.set(key, matches);
        }
      }
    }
  }
  const hivTestingTotals = new Map<string, { actual: number; label: string; target: number }>(
    hivTestingComparisonDefinitions.map((definition) => [
      definition.id,
      { actual: 0, label: definition.label, target: 0 },
    ]),
  );
  const screeningPeriodTotals = new Map<string, Map<string, number>>();
  const trendPeriodTotals = new Map<string, Map<string, number>>();
  let totalScreeningValue = 0;

  for (const aggregate of approvedAggregates) {
    const aggregateIndicatorId = String(aggregate.indicator || "");
    const indicatorMeta =
      indicatorMetaById.get(aggregateIndicatorId) ||
      indicatorMetaByNormalizedName.get(normalizeDashboardText(aggregate.indicator_name));
    if (!indicatorMeta) continue;
    const indicatorId = indicatorMeta.id;
    const indicatorName = aggregate.indicator_name || indicatorMeta.name || "Indicator";
    const indicatorCode = aggregate.indicator_code || indicatorMeta?.code || "";
    const indicatorCategory = indicatorMeta?.category;
    const matchText = normalizeDashboardText(`${indicatorCode} ${indicatorName}`);
    const canonicalIndicator = resolveCanonicalIndicatorDefinition(
      indicatorCode,
      indicatorName,
      indicatorMeta?.short_name,
    );
    const indicatorLabel =
      canonicalIndicator?.label ||
      getIndicatorChartLabel(
        {
          code: indicatorCode,
          name: indicatorName,
          short_name: indicatorMeta?.short_name,
        },
        "Indicator",
      );
    const isHivPreventionMessage = includeHivPreventionMessageTypeByCso
      ? isHivPreventionMessagingIndicator(
          matchText,
          canonicalIndicator,
          indicatorId,
          indicatorCategory,
        )
      : false;
    const isNcdMessage = isNcdMessagingIndicator(
      matchText,
      canonicalIndicator,
      indicatorCategory,
    );
    const canonicalHivKey =
      canonicalIndicator?.key === "hiv_tested" || canonicalIndicator?.key === "hiv_positive"
        ? canonicalIndicator.key
        : resolveHivTestingCanonicalKey(indicatorCode, indicatorName, indicatorMeta?.short_name);
    const matchedStage = getBestScreeningStage(matchText);
    const total = getAggregateTotal(aggregate);
    if (total <= 0) continue;

    const indicatorKey = indicatorCode.trim() || indicatorName.trim() || indicatorId;
    const organizationId = String(aggregate.organization || "");
    const organizationLabel =
      aggregate.organization_name || organizationNameById.get(organizationId) || "Unassigned org";
    const rollupOrganization = resolveRollupOrganization({
      organizationById,
      organizationId,
      organizationName: organizationLabel,
      rollupLevel,
    });
    const organizationKey = rollupOrganization.key;
    const messagingRollupOrganization = resolveRollupOrganization({
      organizationById,
      organizationId,
      organizationName: organizationLabel,
      rollupLevel: "coordinator",
    });

    const hivTestingKey = getHivTestingComparisonKey(matchText, canonicalHivKey);
    if (hivTestingKey) {
      const hivTestingEntry = hivTestingTotals.get(hivTestingKey);
      if (hivTestingEntry) {
        hivTestingEntry.actual += total;
        hivTestingTotals.set(hivTestingKey, hivTestingEntry);
      }
    }

    if (isNcdMessage) {
      const ncdDisaggregates = getDisaggregatesMap(aggregate.value);
      let hasCategorizedDisaggregates = false;
      if (ncdDisaggregates) {
        Object.entries(ncdDisaggregates).forEach(([categoryLabel, sexMap]) => {
          if (isTotalLikeDisaggregateLabel(categoryLabel)) return;
          const definition = resolveNcdMessageTypeDefinition(categoryLabel);
          // NCD aggregates can include different disaggregate dimensions
          // (for example key population and message category). This panel
          // should only roll up message-category entries.
          if (!definition) return;
          const categoryTotal = Object.values(sexMap || {}).reduce(
            (sum, entry) => sum + readDisaggregateEntryTotal(entry),
            0,
          );
          if (categoryTotal <= 0) return;
          hasCategorizedDisaggregates = true;

          const disaggregateKey =
            definition.label ||
            normalizeDashboardText(indicatorLabel) ||
            "other";
          const disaggregateLabel =
            definition.label ||
            categoryLabel.trim() ||
            indicatorLabel ||
            "Other";

          if (!ncdDisaggregateFallbackColorByKey.has(disaggregateKey)) {
            const paletteIndex =
              ncdDisaggregateFallbackColorByKey.size % ncdDisaggregateFallbackPalette.length;
            ncdDisaggregateFallbackColorByKey.set(
              disaggregateKey,
              ncdDisaggregateFallbackPalette[paletteIndex],
            );
          }

          const current = ncdMessageDisaggregateTotals.get(disaggregateKey) ?? {
            color:
              definition.color ||
              ncdDisaggregateFallbackColorByKey.get(disaggregateKey) ||
              "#64748B",
            label: disaggregateLabel,
            total: 0,
          };
          current.total += categoryTotal;
          ncdMessageDisaggregateTotals.set(disaggregateKey, current);
        });
      }

      if (!hasCategorizedDisaggregates) {
        const fallbackDefinition = resolveNcdMessageTypeDefinition(indicatorLabel);
        if (fallbackDefinition) {
          const current = ncdMessageDisaggregateTotals.get(fallbackDefinition.label) ?? {
            color: fallbackDefinition.color,
            label: fallbackDefinition.label,
            total: 0,
          };
          current.total += total;
          ncdMessageDisaggregateTotals.set(fallbackDefinition.label, current);
        }
      }
    }

    const applyPathwayStage = (
      cardId: string,
      matchedPathwayStage: PathwayCardDefinition["stages"][number],
    ) => {
      const cardTotals = servicePathwayTotals.get(cardId);
      if (!cardTotals) return;
      cardTotals.set(
        matchedPathwayStage.id,
        (cardTotals.get(matchedPathwayStage.id) || 0) + total,
      );

      const pathwayDetails = servicePathwayDetails.get(cardId);
      if (!pathwayDetails) return;
      const detailKey = `${matchedPathwayStage.id}:${indicatorKey}`;
      const currentDetail = pathwayDetails.get(detailKey) ?? {
        stageId: matchedPathwayStage.id,
        stageLabel: matchedPathwayStage.label,
        code: indicatorCode,
        name: indicatorName,
        value: 0,
      };
      currentDetail.value += total;
      pathwayDetails.set(detailKey, currentDetail);
    };

    const canonicalPathwayMatches = getCanonicalPathwayStageMatches(canonicalIndicator);
    if (canonicalPathwayMatches !== null && canonicalPathwayMatches.length > 0) {
      // Explicit canonical → pathway card assignment
      for (const match of canonicalPathwayMatches) {
        const pathwayCard = pathwayCardById.get(match.cardId);
        const matchedPathwayStage = pathwayCard?.stages.find((stage) => stage.id === match.stageId);
        if (!pathwayCard || !matchedPathwayStage) continue;
        applyPathwayStage(pathwayCard.id, matchedPathwayStage);
      }
    } else if (canonicalPathwayMatches === null && !isMessagingLikeIndicator(matchText, canonicalIndicator)) {
      // Truly unknown indicator — use text-pattern fallback
      for (const pathwayCard of pathwayCardDefinitions) {
        const matchedPathwayStage = getPathwayStageValue(matchText, pathwayCard);
        if (!matchedPathwayStage) continue;
        applyPathwayStage(pathwayCard.id, matchedPathwayStage);
      }
    }
    // canonicalPathwayMatches === [] means the canonical is known but has no
    // pathway card — skip both paths to prevent misclassification.

    // Config-driven pathways: accumulate by the org's explicitly chosen indicator
    // ids, independent of the heuristics above.
    if (hasConfiguredPathways) {
      const configMatches = configStageByIndicatorId.get(aggregateIndicatorId);
      if (configMatches) {
        for (const match of configMatches) {
          const totals = configPathwayTotals.get(match.cardId);
          if (totals) totals.set(match.stageId, (totals.get(match.stageId) || 0) + total);
          const details = configPathwayDetails.get(match.cardId);
          if (details) {
            const detailKey = `${match.stageId}:${aggregateIndicatorId}`;
            const current = details.get(detailKey) ?? {
              stageId: match.stageId,
              stageLabel: match.stageLabel,
              code: indicatorCode,
              name: indicatorName,
              value: 0,
            };
            current.value += total;
            details.set(detailKey, current);
          }
        }
      }
    }

    // Messaging panels are driven directly from aggregate rows and should not
    // depend on screening stage heuristics.
    const messagingCoordinatorKey = resolveCoordinatorRollupKey(messagingRollupOrganization, organizationLabel);
    if (isHivPreventionMessage && messagingCoordinatorKey) {
      const coordinatorLabel =
        coordinatorLabelByKey.get(messagingCoordinatorKey) ||
        messagingRollupOrganization.label ||
        organizationLabel;
      const hivMessagingEntry = hivPreventionMessagesOrganizationTotals.get(messagingCoordinatorKey) ?? {
        label: coordinatorLabel,
        target: 0,
        total: 0,
      };
      hivMessagingEntry.total += total;
      hivPreventionMessagesOrganizationTotals.set(messagingCoordinatorKey, hivMessagingEntry);

      const messageTypeLabel = getHivPreventionMessageType(matchText, canonicalIndicator, indicatorLabel);
      const messageTypeKey = toSeriesKey(messageTypeLabel);
      const messageTypeTotalEntry = hivPreventionMessageTypeTotals.get(messageTypeKey) ?? {
        label: messageTypeLabel,
        total: 0,
      };
      messageTypeTotalEntry.total += total;
      hivPreventionMessageTypeTotals.set(messageTypeKey, messageTypeTotalEntry);

      const organizationTypeEntry = hivPreventionMessageTypeByOrganization.get(messagingCoordinatorKey) ?? {
        label: coordinatorLabel,
        total: 0,
        totalsByType: new Map<string, number>(),
      };
      organizationTypeEntry.total += total;
      organizationTypeEntry.totalsByType.set(
        messageTypeKey,
        (organizationTypeEntry.totalsByType.get(messageTypeKey) || 0) + total,
      );
      hivPreventionMessageTypeByOrganization.set(messagingCoordinatorKey, organizationTypeEntry);
    }

    if (!matchedStage) continue;

    const trendEntry = trendIndicatorTotals.get(indicatorKey) ?? {
      label: indicatorLabel,
      total: 0,
    };
    trendEntry.total += total;
    trendIndicatorTotals.set(indicatorKey, trendEntry);

    const periodBucket = getMonthBucket(aggregate.period_end || aggregate.period_start);
    if (periodBucket) {
      const periodBucketKey = toMonthBucketKey(periodBucket);
      if (!trendPeriodTotals.has(periodBucketKey)) {
        trendPeriodTotals.set(periodBucketKey, new Map<string, number>());
      }
      const periodEntry = trendPeriodTotals.get(periodBucketKey);
      if (periodEntry) {
        periodEntry.set(indicatorKey, (periodEntry.get(indicatorKey) || 0) + total);
      }
    }

    totalScreeningValue += total;
    const screeningEntry = screeningIndicatorTotals.get(indicatorKey) ?? {
      indicatorId,
      label: indicatorLabel,
      target: 0,
      total: 0,
    };
    screeningEntry.total += total;
    screeningIndicatorTotals.set(indicatorKey, screeningEntry);

    const organizationEntry = organizationTotals.get(organizationKey) ?? {
      label: rollupOrganization.label,
      target: 0,
      total: 0,
    };
    organizationEntry.total += total;
    organizationTotals.set(organizationKey, organizationEntry);

    const projectId = String(aggregate.project || "");
    const projectKey = projectId || `name:${String(aggregate.project_name || "Unassigned project")}`;
    const projectLabel = aggregate.project_name || projectNameById.get(projectId) || "Unassigned project";
    const projectEntry = projectTotals.get(projectKey) ?? {
      label: projectLabel,
      target: 0,
      total: 0,
    };
    projectEntry.total += total;
    projectTotals.set(projectKey, projectEntry);

    stageTotals.set(matchedStage.id, (stageTotals.get(matchedStage.id) || 0) + total);

    if (!periodBucket) continue;
    const screeningPeriodKey = toMonthBucketKey(periodBucket);
    if (!screeningPeriodTotals.has(screeningPeriodKey)) {
      screeningPeriodTotals.set(screeningPeriodKey, new Map<string, number>());
    }
    const screeningPeriodEntry = screeningPeriodTotals.get(screeningPeriodKey);
    if (!screeningPeriodEntry) continue;
    screeningPeriodEntry.set(indicatorKey, (screeningPeriodEntry.get(indicatorKey) || 0) + total);
  }

  for (const indicator of indicatorsData ?? []) {
    const indicatorId = String(indicator.id);
    const indicatorCode = indicator.code || "";
    const indicatorName = indicator.name || "Indicator";
    const matchText = normalizeDashboardText(`${indicatorCode} ${indicatorName}`);
    const canonicalIndicator = resolveCanonicalIndicatorDefinition(
      indicatorCode,
      indicatorName,
      indicator.short_name,
    );
    const canonicalHivKey =
      canonicalIndicator?.key === "hiv_tested" || canonicalIndicator?.key === "hiv_positive"
        ? canonicalIndicator.key
        : resolveHivTestingCanonicalKey(indicatorCode, indicatorName, indicator.short_name);
    const matchedStage = getBestScreeningStage(matchText);
    const hivTestingKey = getHivTestingComparisonKey(matchText, canonicalHivKey);
    const indicatorKey = indicatorCode.trim() || indicatorName.trim() || indicatorId;
    const isHivPreventionMessage = includeHivPreventionMessageTypeByCso
      ? isHivPreventionMessagingIndicator(
          matchText,
          canonicalIndicator,
          indicatorId,
          indicator.category,
        )
      : false;
    const indicatorTargetRows =
      indicator.project_targets && indicator.project_targets.length > 0
        ? indicator.project_targets
        : fallbackTargetsByIndicatorId.get(indicatorId) || [];
    const dedupedIndicatorTargetRows = dedupeDashboardTargetRows(indicatorTargetRows);

    for (const targetRow of dedupedIndicatorTargetRows) {
      const targetProjectId = String(targetRow.project || "");

      const targetOrganizationId = String(targetRow.organization || "");
      if (
        scopedOrganizationIds &&
        targetOrganizationId &&
        !scopedOrganizationIds.has(targetOrganizationId)
      ) {
        continue;
      }

      const quarterTargetValue = resolveQuarterTargetValue(targetRow, selectedQuarter);
      const targetValue =
        quarterTargetValue !== null ? quarterTargetValue : toSafeNumber(targetRow.target_value);
      if (targetValue <= 0) continue;

      if (hivTestingKey) {
        const hivTestingEntry = hivTestingTotals.get(hivTestingKey);
        if (hivTestingEntry) {
          hivTestingEntry.target += targetValue;
          hivTestingTotals.set(hivTestingKey, hivTestingEntry);
        }
      }

      const targetOrganizationLabel =
        targetRow.organization_name ||
        organizationNameById.get(targetOrganizationId) ||
        "Unassigned org";
      const rollupTargetOrganization = resolveRollupOrganization({
        organizationById,
        organizationId: targetOrganizationId,
        organizationName: targetOrganizationLabel,
        rollupLevel,
      });
      const organizationKey = rollupTargetOrganization.key;
      const messagingRollupTargetOrganization = resolveRollupOrganization({
        organizationById,
        organizationId: targetOrganizationId,
        organizationName: targetOrganizationLabel,
        rollupLevel: "coordinator",
      });
      const messagingTargetCoordinatorKey = resolveCoordinatorRollupKey(
        messagingRollupTargetOrganization,
        targetOrganizationLabel,
      );
      if (isHivPreventionMessage && messagingTargetCoordinatorKey) {
        const coordinatorLabel =
          coordinatorLabelByKey.get(messagingTargetCoordinatorKey) ||
          messagingRollupTargetOrganization.label ||
          targetOrganizationLabel;
        const hivMessagingEntry = hivPreventionMessagesOrganizationTotals.get(messagingTargetCoordinatorKey) ?? {
          label: coordinatorLabel,
          target: 0,
          total: 0,
        };
        hivMessagingEntry.target += targetValue;
        hivPreventionMessagesOrganizationTotals.set(messagingTargetCoordinatorKey, hivMessagingEntry);
      }

      if (!matchedStage) continue;

      const indicatorEntry = screeningIndicatorTotals.get(indicatorKey);
      if (indicatorEntry) {
        indicatorEntry.target += targetValue;
        screeningIndicatorTotals.set(indicatorKey, indicatorEntry);
      }

      const organizationEntry = organizationTotals.get(organizationKey) ?? {
        label: rollupTargetOrganization.label,
        target: 0,
        total: 0,
      };
      organizationEntry.target += targetValue;
      organizationTotals.set(organizationKey, organizationEntry);

      const projectKey = targetProjectId || `name:${String(targetRow.project_name || "Unassigned project")}`;
      const projectEntry = projectTotals.get(projectKey) ?? {
        label: targetRow.project_name || projectNameById.get(targetProjectId) || "Unassigned project",
        target: 0,
        total: 0,
      };
      projectEntry.target += targetValue;
      projectTotals.set(projectKey, projectEntry);
    }
  }

  const topIndicators = Array.from(screeningIndicatorTotals.values())
    .sort((left, right) => right.total - left.total)
    .slice(0, 5)
    .map((entry) => ({
      label: entry.label,
      percentage: entry.target > 0 ? (entry.total / entry.target) * 100 : 0,
      target: entry.target,
      value: entry.total,
    }));
  const indicatorMetrics = Array.from(screeningIndicatorTotals.values())
    .sort((left, right) => right.total - left.total)
    .map((entry) => ({
      indicatorId: entry.indicatorId,
      label: entry.label,
      percentage: entry.target > 0 ? (entry.total / entry.target) * 100 : 0,
      target: entry.target,
      value: entry.total,
    }));

  const useTrendFallback = screeningIndicatorTotals.size <= 1 && trendIndicatorTotals.size > 1;
  const selectedTrendTotals = useTrendFallback ? trendIndicatorTotals : screeningIndicatorTotals;
  const selectedTrendPeriods = useTrendFallback ? trendPeriodTotals : screeningPeriodTotals;

  const trendKeys = Array.from(selectedTrendTotals.entries())
    .sort((left, right) => right[1].total - left[1].total)
    .slice(0, 5)
    .map(([key]) => key);

  const trendSeries = trendKeys.map((key, index) => ({
    color: screeningSeriesColors[index % screeningSeriesColors.length],
    key,
    label: selectedTrendTotals.get(key)?.label || key,
  }));

  const trend = Array.from(selectedTrendPeriods.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-6)
    .map(([bucketKey, totals]) => {
      const row: Record<string, number | string> = {
        period: formatMonthBucketKey(bucketKey),
      };
      for (const series of trendSeries) {
        row[series.key] = totals.get(series.key) || 0;
      }
      return row;
    });

  const hivPreventionMessageTypeSeries = includeHivPreventionMessageTypeByCso
    ? Array.from(hivPreventionMessageTypeTotals.entries())
        .sort((left, right) => right[1].total - left[1].total)
        .slice(0, 8)
        .map(([key, value], index) => ({
          color: hivPreventionMessageTypePalette[index % hivPreventionMessageTypePalette.length],
          key,
          label: value.label,
        }))
    : [];
  const hivPreventionMessageTypeSeriesKeys = hivPreventionMessageTypeSeries.map((series) => series.key);
  const hivPreventionMessageTypeRows = includeHivPreventionMessageTypeByCso
    ? (
        coordinatorRollupOrganizations.length > 0
          ? coordinatorRollupOrganizations.map((coordinator) => {
              const entry = hivPreventionMessageTypeByOrganization.get(coordinator.key);
              const row: Record<string, number | string> = {
                cso: coordinator.label,
              };
              hivPreventionMessageTypeSeriesKeys.forEach((seriesKey) => {
                row[seriesKey] = entry?.totalsByType.get(seriesKey) || 0;
              });
              return row;
            })
          : Array.from(hivPreventionMessageTypeByOrganization.values())
              .sort((left, right) => right.total - left.total)
              .slice(0, 8)
              .map((entry) => {
                const row: Record<string, number | string> = {
                  cso: entry.label,
                };
                hivPreventionMessageTypeSeriesKeys.forEach((seriesKey) => {
                  row[seriesKey] = entry.totalsByType.get(seriesKey) || 0;
                });
                return row;
              })
      )
    : [];

  const hivPreventionMessagesByCso =
    coordinatorRollupOrganizations.length > 0
      ? coordinatorRollupOrganizations.map((coordinator) => {
          const entry = hivPreventionMessagesOrganizationTotals.get(coordinator.key);
          const value = entry?.total || 0;
          const target = entry?.target || 0;
          return {
            label: coordinator.label,
            percentage: target > 0 ? (value / target) * 100 : 0,
            target,
            value,
          };
        })
      : Array.from(hivPreventionMessagesOrganizationTotals.values())
          .sort((left, right) => {
            if (right.total !== left.total) return right.total - left.total;
            return right.target - left.target;
          })
          .slice(0, 8)
          .map((entry) => ({
            label: entry.label,
            percentage: entry.target > 0 ? (entry.total / entry.target) * 100 : 0,
            target: entry.target,
            value: entry.total,
          }));
  const ncdMessageDisaggregates = Array.from(ncdMessageDisaggregateTotals.values())
    .sort((left, right) => right.total - left.total)
    .map((entry) => ({
      color: entry.color,
      label: entry.label,
      value: entry.total,
    }));

  return {
    isLoading: false,
    hasError: false,
    totalScreeningValue,
    indicatorCount: screeningIndicatorTotals.size,
    indicatorMetrics,
    reportingOrganizationsCount: Array.from(organizationTotals.values()).filter((entry) => entry.total > 0).length,
    activeProjectsCount: Array.from(projectTotals.values()).filter((entry) => entry.total > 0).length,
    topIndicators,
    organizations: Array.from(organizationTotals.values())
      .sort((left, right) => right.total - left.total)
      .slice(0, 5)
      .map((entry) => ({
        label: entry.label,
        percentage: entry.target > 0 ? (entry.total / entry.target) * 100 : 0,
        target: entry.target,
        value: entry.total,
      })),
    projects: Array.from(projectTotals.values())
      .sort((left, right) => right.total - left.total)
      .slice(0, 5)
      .map((entry) => ({
        label: entry.label,
        percentage: entry.target > 0 ? (entry.total / entry.target) * 100 : 0,
        target: entry.target,
        value: entry.total,
      })),
    hivPreventionMessageTypeByCso: {
      rows: hivPreventionMessageTypeRows,
      series: hivPreventionMessageTypeSeries,
    },
    hivPreventionMessagesByCso,
    ncdMessageDisaggregates,
    stages: screeningStageDefinitions.map((stage) => ({
      color: stage.color,
      label: stage.label,
      value: stageTotals.get(stage.id) || 0,
    })),
    servicePathways: hasConfiguredPathways
      ? configuredPathways.map((pathway, pathwayIndex) => {
          const stageValues = configPathwayTotals.get(pathway.id);
          const stages = pathway.stages.map((stage, stageIndex) => ({
            id: stage.id,
            color: stage.color || PATHWAY_STAGE_FALLBACK_COLORS[stageIndex % PATHWAY_STAGE_FALLBACK_COLORS.length],
            label: stage.label,
            value: stageValues?.get(stage.id) || 0,
          }));
          return {
            id: pathway.id || `pathway-${pathwayIndex}`,
            title: pathway.label,
            stages,
            total: stages.reduce((sum, stage) => sum + stage.value, 0),
            indicatorDetails: Array.from(configPathwayDetails.get(pathway.id)?.values() || []),
          };
        })
      : pathwayCardDefinitions.map((card) => {
          const stageValues = servicePathwayTotals.get(card.id);
          const stages = card.stages.map((stage) => ({
            id: stage.id,
            color: stage.color,
            label: stage.label,
            value: stageValues?.get(stage.id) || 0,
          }));
          return {
            id: card.id,
            title: card.label,
            stages,
            total: stages.reduce((sum, stage) => sum + stage.value, 0),
            indicatorDetails: Array.from(servicePathwayDetails.get(card.id)?.values() || []),
          };
        }),
    hivTestingComparison: hivTestingComparisonDefinitions.map((definition) => {
      const entry = hivTestingTotals.get(definition.id);
      return {
        actual: entry?.actual || 0,
        label: definition.label,
        target: entry?.target || 0,
      };
    }),
    trend,
    trendSeries,
  };
}
