"use client";

import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FileText,
  FolderKanban,
  Loader2,
  RotateCcw,
  Users,
} from "lucide-react";
import {
  DASHBOARD_CUSTOM_WIDGET_STYLE_OPTIONS,
  DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE,
  DashboardExecutiveBoard,
  type DashboardAggregateReviewSnapshot,
  type DashboardAggregateFilterContext,
  parseDashboardCustomWidgetType,
  type DashboardChartPreferences,
  type DashboardCustomWidget,
} from "@/components/dashboard/executive-dashboard-board";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { useAuth } from "@/lib/contexts/auth-context";
import { useSessionMode } from "@/lib/contexts/session-mode-context";
import { organizationsService, usersService } from "@/lib/api";
import { ServicePathwayConfigDialog } from "@/components/dashboard/service-pathway-config-dialog";
import {
  useAllIndicators,
  useAllAggregates,
  useAggregates,
  useAllOrganizations,
  useAllProjectDetails,
  useDashboardMessageAnalytics,
  useDashboardStats,
  useDeadlines,
  useHomeDashboard,
} from "@/lib/hooks/use-api";
import { DashboardAnalyticsSurface } from "@/components/analysis/dashboard-analytics-surface";
import { useAggregateVisibilityScope } from "@/app/(dashboard)/aggregates/hooks";
import { getAggregateTotal } from "@/lib/aggregates/aggregate-helpers";
import { getQuarterBucket } from "@/lib/aggregates/quarter-buckets";
import { getAggregateValueDisaggregateRows } from "@/lib/aggregates/disaggregate-normalization";
import { buildOrganizationDescendantMap } from "@/lib/analytics/org-scope";
import {
  buildHomeDashboardScreeningInsights,
  type ConfiguredPathway,
  type ScreeningDashboardInsights,
} from "@/lib/dashboard/screening-insights";
import {
  INDICATOR_CATEGORY_OPTIONS,
  getIndicatorCategoryLabel,
} from "@/lib/indicators/categories";
import { getIndicatorChartLabel } from "@/lib/indicators/display-name";
import { normalizeAggregateDisaggregationConfig } from "@/lib/indicators/disaggregation-presets";
import { isReadOnlyClient } from "@/lib/permissions";
import type { Aggregate, Indicator, IndicatorCategory, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toSafeNumber } from "@/components/dashboard/engine/normalize-indicators";

const HOME_DASHBOARD_STORAGE_KEY = "bonaso-home-dashboard-preferences";
const dashboardQuickLinks = [
  {
    id: "respondents",
    href: "/respondents",
    label: "Respondents",
    description: "Open tracked people and their interaction history.",
    icon: Users,
    readOnlyHidden: true,
  },
  {
    id: "aggregates",
    href: "/aggregates",
    label: "Aggregates",
    description: "Review reported totals and auto-calculated indicators.",
    icon: BarChart3,
    readOnlyHidden: true,
  },
  {
    id: "projects",
    href: "/projects",
    label: "Projects",
    description: "Jump into active grants, deadlines, and targets.",
    icon: FolderKanban,
    readOnlyHidden: false,
  },
  {
    id: "reports",
    href: "/analysis/reports",
    label: "Reports",
    description: "Open reporting views, exports, and summaries.",
    icon: FileText,
    readOnlyHidden: false,
  },
];

const summaryCardDefinitions = [
  {
    id: "respondents",
    label: "Respondents",
    note: "people recorded in the portal",
    icon: Users,
  },
  {
    id: "interactions",
    label: "Interactions",
    note: "assessments and service touchpoints",
    icon: Activity,
  },
  {
    id: "active-projects",
    label: "Active Projects",
    note: "currently running delivery streams",
    icon: FolderKanban,
  },
  {
    id: "flags-behind",
    label: "Flags Behind",
    note: "indicator areas needing attention",
    icon: AlertTriangle,
  },
] as const;

const heroActionDefinitions = [
  {
    id: "new-interaction",
    label: "New Interaction",
    href: "/respondents/interactions",
    readOnlyHidden: true,
  },
  {
    id: "view-reports",
    label: "View Reports",
    href: "/analysis/reports",
    readOnlyHidden: false,
  },
] as const;

type UpdatesTab = "activity" | "deadlines" | "projects";
type HomeDashboardFilters = {
  projectId: string;
  coordinatorId: string;
  organizationId: string;
  dateFrom: string;
  dateTo: string;
};

type HomeDashboardPreferences = {
  showWelcomeBanner: boolean;
  showSummaryStrip: boolean;
  showUpdatesBoard: boolean;
  showFavoritesPanel: boolean;
  showSpotlightPanel: boolean;
  defaultUpdatesTab: UpdatesTab;
  heroActions: Record<string, boolean>;
  summaryCards: Record<string, boolean>;
  quickLinks: Record<string, boolean>;
  chartPreferences: DashboardChartPreferences;
  customWidgets: DashboardCustomWidget[];
};

const defaultDashboardChartPreferences: DashboardChartPreferences = {
  pathwayStyle: "pie",
  showTrendLegend: false,
  trendLayout: "grouped",
  trendSeriesLimit: 3,
};

const defaultHomeDashboardPreferences: HomeDashboardPreferences = {
  showWelcomeBanner: false,
  showSummaryStrip: true,
  showUpdatesBoard: true,
  showFavoritesPanel: false,
  showSpotlightPanel: false,
  defaultUpdatesTab: "deadlines",
  heroActions: {
    "new-interaction": true,
    "view-reports": false,
  },
  summaryCards: {
    respondents: true,
    interactions: true,
    "active-projects": true,
    "flags-behind": false,
  },
  quickLinks: {
    respondents: false,
    aggregates: false,
    projects: true,
    reports: true,
  },
  chartPreferences: defaultDashboardChartPreferences,
  customWidgets: [],
};

const defaultHomeDashboardFilters: HomeDashboardFilters = {
  projectId: "all",
  coordinatorId: "all",
  organizationId: "all",
  dateFrom: "",
  dateTo: "",
};
const defaultWidgetBuilderFilters: HomeDashboardFilters = {
  ...defaultHomeDashboardFilters,
};

function normalizeDashboardText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NO_WIDGET_DISAGGREGATE = "none";
type DashboardWidgetMetric = ScreeningDashboardInsights["indicatorMetrics"][number];
type WidgetDisaggregateOption = {
  key: string;
  label: string;
  values: string[];
};

function normalizeDisaggregateToken(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getIndicatorDisaggregateOptions(indicator?: Indicator): WidgetDisaggregateOption[] {
  if (!indicator) return [];
  const config = normalizeAggregateDisaggregationConfig(
    indicator.aggregate_disaggregation_config || undefined,
    indicator.sub_labels || undefined,
  );
  const seen = new Set<string>();
  return config.dimensions
    .map((dimension) => {
      const normalizedKey = normalizeDisaggregateToken(dimension.key);
      const key = String(dimension.key || "").trim();
      const label = String(dimension.label || "").trim();
      if (!key || !label || !normalizedKey || seen.has(normalizedKey)) return null;
      seen.add(normalizedKey);
      return {
        key,
        label,
        values: Array.isArray(dimension.values)
          ? dimension.values.map((value) => String(value || "").trim()).filter(Boolean)
          : [],
      };
    })
    .filter((option): option is WidgetDisaggregateOption => Boolean(option));
}

function getDisaggregateDimensionRowIndex(
  indicator: Indicator | undefined,
  dimensionKey: string,
  rows?: ReturnType<typeof getAggregateValueDisaggregateRows>,
): number {
  if (!indicator || !dimensionKey) return -1;
  const normalizedTarget = normalizeDisaggregateToken(dimensionKey);
  const options = getIndicatorDisaggregateOptions(indicator);
  const configuredIndex = options.findIndex(
    (option) => normalizeDisaggregateToken(option.key) === normalizedTarget,
  );
  if (configuredIndex < 0) return -1;

  if (!rows || rows.length === 0) return configuredIndex;

  const selectedOption = options[configuredIndex];
  const expectedValues = new Set(
    selectedOption.values
      .map((value) => normalizeDisaggregateToken(value))
      .filter((value) => value && !isTotalLikeDisaggregateLabel(value)),
  );
  if (expectedValues.size === 0) return configuredIndex;

  const scoreColumns = [0, 0, 0];
  for (const row of rows) {
    const candidates = [String(row.first || ""), String(row.second || ""), String(row.third || "")];
    for (let index = 0; index < candidates.length; index += 1) {
      const normalized = normalizeDisaggregateToken(candidates[index]);
      if (!normalized || isTotalLikeDisaggregateLabel(normalized)) continue;
      if (expectedValues.has(normalized)) scoreColumns[index] += 1;
    }
  }

  const bestScore = Math.max(...scoreColumns);
  if (bestScore <= 0) return -1;
  return scoreColumns.indexOf(bestScore);
}

function getDisaggregateRowValueAtIndex(
  row: ReturnType<typeof getAggregateValueDisaggregateRows>[number],
  index: number,
) {
  if (index === 0) return String(row.first || "").trim();
  if (index === 1) return String(row.second || "").trim();
  return String(row.third || "").trim();
}

function isTotalLikeDisaggregateLabel(value: string) {
  const normalized = normalizeDisaggregateToken(value);
  return (
    !normalized ||
    normalized === "total" ||
    normalized === "sub total" ||
    normalized === "subtotal" ||
    normalized === "value" ||
    normalized === "amount" ||
    normalized === "count"
  );
}

function fallsWithinDateRange(value?: string | null, fromDate?: string, toDate?: string) {
  if (!fromDate && !toDate) return true;
  if (!value) return false;

  const valueTime = new Date(value).getTime();
  if (Number.isNaN(valueTime)) return false;

  if (fromDate) {
    const fromTime = new Date(fromDate).getTime();
    if (!Number.isNaN(fromTime) && valueTime < fromTime) return false;
  }

  if (toDate) {
    const toTime = new Date(`${toDate}T23:59:59.999`).getTime();
    if (!Number.isNaN(toTime) && valueTime > toTime) return false;
  }

  return true;
}

function normalizeWidgetFilterId(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 && normalized !== "all" ? normalized : undefined;
}

function normalizeWidgetFilterDate(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeWidgetFilter(value: unknown): DashboardCustomWidget["filter"] {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const projectId = normalizeWidgetFilterId(source.projectId);
  const coordinatorId = normalizeWidgetFilterId(source.coordinatorId);
  const organizationId = normalizeWidgetFilterId(source.organizationId);
  const dateFrom = normalizeWidgetFilterDate(source.dateFrom);
  const dateTo = normalizeWidgetFilterDate(source.dateTo);
  if (!projectId && !coordinatorId && !organizationId && !dateFrom && !dateTo) {
    return undefined;
  }
  return {
    projectId,
    coordinatorId,
    organizationId,
    dateFrom,
    dateTo,
  };
}

function coerceId(value: unknown): string {
  return String(value ?? "").trim();
}

function toProjectOrganizationIds(project: Project | null | undefined): string[] {
  if (!project || !Array.isArray(project.organizations)) return [];
  return Array.from(
    new Set(
      project.organizations
        .map((organizationId) => coerceId(organizationId))
        .filter((organizationId) => organizationId.length > 0),
    ),
  );
}

function normalizeHierarchyOverrides(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, string[]> = {};

  Object.entries(value as Record<string, unknown>).forEach(([rawParentId, rawChildren]) => {
    const parentId = coerceId(rawParentId);
    if (!parentId || !Array.isArray(rawChildren)) return;
    const childIds = Array.from(
      new Set(
        rawChildren
          .map((rawChildId) => coerceId(rawChildId))
          .filter((childId) => childId.length > 0 && childId !== parentId),
      ),
    );
    normalized[parentId] = childIds;
  });

  return normalized;
}

function getHomeDashboardStorageKey(userKey: string) {
  return `${HOME_DASHBOARD_STORAGE_KEY}:${userKey}`;
}

function normalizeHomeDashboardPreferences(
  value: Partial<HomeDashboardPreferences> | null | undefined,
): HomeDashboardPreferences {
  const parsed = value ?? {};
  const parsedTrendSeriesLimit =
    typeof parsed.chartPreferences?.trendSeriesLimit === "number"
      ? parsed.chartPreferences.trendSeriesLimit
      : defaultDashboardChartPreferences.trendSeriesLimit;
  const trendSeriesLimit = [1, 2, 3, 4, 5].includes(parsedTrendSeriesLimit)
    ? parsedTrendSeriesLimit
    : defaultDashboardChartPreferences.trendSeriesLimit;

  return {
    ...defaultHomeDashboardPreferences,
    ...parsed,
    defaultUpdatesTab:
      parsed.defaultUpdatesTab === "activity" ||
      parsed.defaultUpdatesTab === "deadlines" ||
      parsed.defaultUpdatesTab === "projects"
        ? parsed.defaultUpdatesTab
        : defaultHomeDashboardPreferences.defaultUpdatesTab,
    heroActions: {
      ...defaultHomeDashboardPreferences.heroActions,
      ...(parsed.heroActions ?? {}),
    },
    summaryCards: {
      ...defaultHomeDashboardPreferences.summaryCards,
      ...(parsed.summaryCards ?? {}),
    },
    quickLinks: {
      ...defaultHomeDashboardPreferences.quickLinks,
      ...(parsed.quickLinks ?? {}),
    },
    customWidgets: Array.isArray(parsed.customWidgets)
      ? parsed.customWidgets
          .map((widget) => ({
            id:
              typeof widget?.id === "string" && widget.id.trim().length > 0
                ? widget.id
                : `widget-${Math.random().toString(36).slice(2, 10)}`,
            indicatorIds: Array.isArray(widget?.indicatorIds)
              ? widget.indicatorIds
                  .map((indicatorId) => String(indicatorId))
                  .filter((indicatorId) => indicatorId.length > 0)
              : [],
            title:
              typeof widget?.title === "string" && widget.title.trim().length > 0
                ? widget.title
                : "Custom widget",
            type: parseDashboardCustomWidgetType(widget?.type),
            includeTarget:
              typeof widget?.includeTarget === "boolean" ? widget.includeTarget : true,
            filter: normalizeWidgetFilter(widget?.filter),
            disaggregateDimensionKey:
              typeof widget?.disaggregateDimensionKey === "string" &&
              widget.disaggregateDimensionKey.trim().length > 0
                ? widget.disaggregateDimensionKey.trim()
                : undefined,
            disaggregateDimensionLabel:
              typeof widget?.disaggregateDimensionLabel === "string" &&
              widget.disaggregateDimensionLabel.trim().length > 0
                ? widget.disaggregateDimensionLabel.trim()
                : undefined,
          }))
          .filter((widget) => widget.indicatorIds.length > 0)
      : defaultHomeDashboardPreferences.customWidgets,
    chartPreferences: {
      ...defaultDashboardChartPreferences,
      ...(parsed.chartPreferences ?? {}),
      pathwayStyle:
        parsed.chartPreferences?.pathwayStyle === "pie" ||
        parsed.chartPreferences?.pathwayStyle === "donut"
          ? parsed.chartPreferences.pathwayStyle
          : defaultDashboardChartPreferences.pathwayStyle,
      showTrendLegend:
        typeof parsed.chartPreferences?.showTrendLegend === "boolean"
          ? parsed.chartPreferences.showTrendLegend
          : defaultDashboardChartPreferences.showTrendLegend,
      trendLayout:
        parsed.chartPreferences?.trendLayout === "stacked" ? "stacked" : defaultDashboardChartPreferences.trendLayout,
      trendSeriesLimit,
    },
  };
}

function readHomeDashboardPreferences(storageKey: string): HomeDashboardPreferences {
  if (typeof window === "undefined") return defaultHomeDashboardPreferences;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultHomeDashboardPreferences;
    return normalizeHomeDashboardPreferences(
      JSON.parse(raw) as Partial<HomeDashboardPreferences>,
    );
  } catch (error) {
    console.error("Failed to read home dashboard preferences", error);
    return defaultHomeDashboardPreferences;
  }
}

function writeHomeDashboardPreferences(
  storageKey: string,
  preferences: HomeDashboardPreferences,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch (error) {
    console.error("Failed to write home dashboard preferences", error);
  }
}

type DashboardPageErrorBoundaryProps = {
  children: ReactNode;
};

type DashboardPageErrorBoundaryState = {
  hasError: boolean;
  componentStack?: string;
  errorMessage?: string;
};

class DashboardPageErrorBoundary extends Component<
  DashboardPageErrorBoundaryProps,
  DashboardPageErrorBoundaryState
> {
  state: DashboardPageErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Dashboard page render failed", error, errorInfo);
    this.setState({
      componentStack:
        typeof errorInfo?.componentStack === "string"
          ? errorInfo.componentStack.split("\n").slice(0, 6).join("\n")
          : undefined,
      errorMessage: error?.message || "Unknown dashboard render error",
    });
  }

  private handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card px-6 py-10 text-center">
          <h2 className="text-xl font-semibold text-foreground">Dashboard temporarily unavailable</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            We hit a dashboard rendering problem in this browser session. Reload to retry while we keep the rest of the app available.
          </p>
          {this.state.errorMessage ? (
            <p className="mx-auto mt-3 max-w-2xl rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground">
              Error: {this.state.errorMessage}
            </p>
          ) : null}
          {this.state.componentStack ? (
            <details className="mx-auto mt-2 max-w-2xl text-left text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Component stack (debug)</summary>
              <pre className="mt-2 overflow-x-hidden rounded-md border border-border bg-muted/30 p-3 whitespace-pre-wrap break-words">
                {this.state.componentStack}
              </pre>
            </details>
          ) : null}
          <Button type="button" className="mt-5" onClick={this.handleReload}>
            Reload dashboard
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

function createCustomWidgetId() {
  return `widget-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const storageKey = useMemo(() => {
    const userKey = String(user?.email || user?.id || "default");
    return getHomeDashboardStorageKey(userKey);
  }, [user]);

  if (!hydrated) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <DashboardPageErrorBoundary>
      <DashboardPageContent key={storageKey} storageKey={storageKey} user={user} />
    </DashboardPageErrorBoundary>
  );
}

function DashboardPageContent({
  storageKey,
  user,
}: {
  storageKey: string;
  user: ReturnType<typeof useAuth>["user"];
}) {
  const { toast } = useToast();
  const { isTrainingMode, trainingProjectId } = useSessionMode();
  const initialPreferences = useMemo(() => readHomeDashboardPreferences(storageKey), [storageKey]);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [widgetDialogOpen, setWidgetDialogOpen] = useState(false);
  const [dashboardFilters, setDashboardFilters] = useState<HomeDashboardFilters>(
    defaultHomeDashboardFilters,
  );
  const [dashboardPreferences, setDashboardPreferences] = useState<HomeDashboardPreferences>(
    initialPreferences,
  );
  const [activeUpdatesTab, setActiveUpdatesTab] = useState<UpdatesTab>(
    initialPreferences.defaultUpdatesTab,
  );
  const [widgetBuilderType, setWidgetBuilderType] = useState<DashboardCustomWidget["type"]>(
    DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE,
  );
  const [widgetBuilderDisaggregateKey, setWidgetBuilderDisaggregateKey] = useState(
    NO_WIDGET_DISAGGREGATE,
  );
  const [widgetBuilderIncludeTarget, setWidgetBuilderIncludeTarget] = useState(true);
  const [widgetBuilderFilters, setWidgetBuilderFilters] = useState<HomeDashboardFilters>(
    defaultWidgetBuilderFilters,
  );
  const [widgetBuilderTitle, setWidgetBuilderTitle] = useState("");
  const [widgetSearch, setWidgetSearch] = useState("");
  const [widgetCategoryFilter, setWidgetCategoryFilter] = useState<"all" | IndicatorCategory>(
    "all",
  );
  const [selectedWidgetIndicatorIds, setSelectedWidgetIndicatorIds] = useState<string[]>([]);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [preferencesSourceReady, setPreferencesSourceReady] = useState(false);
  const lastServerSavedPreferences = useRef<string | null>(null);
  // Defer the heavy all-aggregates fetch (the dashboard analytics payload) off
  // the critical render path. The summary cards/deadlines/activity come from the
  // lightweight dashboardStats endpoint and paint immediately; the ~MB aggregate
  // pull only starts once the user shows intent to view the analytics (first
  // scroll) or shortly after first paint (idle fallback). On slow links this lets
  // the small critical requests win the connection first.
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  useEffect(() => {
    if (analyticsEnabled) return;
    let done = false;
    const enable = () => {
      if (done) return;
      done = true;
      setAnalyticsEnabled(true);
    };
    window.addEventListener("scroll", enable, { passive: true });
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idleId = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(enable, { timeout: 2500 })
      : window.setTimeout(enable, 1500);
    return () => {
      window.removeEventListener("scroll", enable);
      if (idleWindow.cancelIdleCallback && idleWindow.requestIdleCallback) {
        idleWindow.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [analyticsEnabled]);

  useEffect(() => {
    let isActive = true;
    setPreferencesSourceReady(false);

    const loadDashboardPreferences = () => {
      // The auth context already fetched (and revalidates) /api/users/me/, and
      // the user object carries home_dashboard_preferences — so read it from
      // there instead of firing a second, duplicate /me/ request on every
      // dashboard load.
      if (!user?.id) {
        if (!isActive) return;
        lastServerSavedPreferences.current = JSON.stringify(initialPreferences);
        setPreferencesSourceReady(true);
        return;
      }

      try {
        const serverPreferencesRaw = (user as { home_dashboard_preferences?: unknown })
          .home_dashboard_preferences;

        if (
          serverPreferencesRaw &&
          typeof serverPreferencesRaw === "object" &&
          !Array.isArray(serverPreferencesRaw)
        ) {
          const normalized = normalizeHomeDashboardPreferences(
            serverPreferencesRaw as Partial<HomeDashboardPreferences>,
          );
          const serialized = JSON.stringify(normalized);
          if (!isActive) return;
          lastServerSavedPreferences.current = serialized;
          setDashboardPreferences(normalized);
          setActiveUpdatesTab(normalized.defaultUpdatesTab);
          writeHomeDashboardPreferences(storageKey, normalized);
        } else if (isActive) {
          lastServerSavedPreferences.current = JSON.stringify(initialPreferences);
        }
      } catch (error) {
        console.error("Failed to read dashboard preferences", error);
        if (isActive) {
          lastServerSavedPreferences.current = JSON.stringify(initialPreferences);
        }
      } finally {
        if (isActive) {
          setPreferencesSourceReady(true);
        }
      }
    };

    loadDashboardPreferences();

    return () => {
      isActive = false;
    };
  }, [initialPreferences, storageKey, user?.id]);

  const selectedProjectId =
    dashboardFilters.projectId !== "all" ? dashboardFilters.projectId : undefined;
  const selectedCoordinatorId =
    dashboardFilters.coordinatorId !== "all" ? dashboardFilters.coordinatorId : undefined;
  const selectedOrganizationId =
    dashboardFilters.organizationId !== "all" ? dashboardFilters.organizationId : undefined;
  const selectedProjectNumericId = useMemo(() => {
    if (!selectedProjectId) return undefined;
    const parsed = Number(selectedProjectId);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [selectedProjectId]);
  const selectedCoordinatorNumericId = useMemo(() => {
    if (!selectedCoordinatorId) return undefined;
    const parsed = Number(selectedCoordinatorId);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [selectedCoordinatorId]);
  const selectedOrganizationNumericId = useMemo(() => {
    if (!selectedOrganizationId) return undefined;
    const parsed = Number(selectedOrganizationId);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [selectedOrganizationId]);
  const {
    data: dashboardStats,
    isLoading: statsLoading,
    error: statsError,
    mutate: mutateStats,
  } = useDashboardStats({
    projectId: selectedProjectNumericId,
    coordinatorId: selectedCoordinatorNumericId,
    organizationId: selectedOrganizationNumericId,
    dateFrom: dashboardFilters.dateFrom || undefined,
    dateTo: dashboardFilters.dateTo || undefined,
  });
  const {
    data: dashboardMessageAnalytics,
    isLoading: dashboardMessageAnalyticsLoading,
    error: dashboardMessageAnalyticsError,
    mutate: mutateMessageAnalytics,
  } = useDashboardMessageAnalytics({
    projectId: selectedProjectNumericId,
    coordinatorId: selectedCoordinatorNumericId,
    organizationId: selectedOrganizationNumericId,
    dateFrom: dashboardFilters.dateFrom || undefined,
    dateTo: dashboardFilters.dateTo || undefined,
  });
  const { data: organizationsData, mutate: mutateOrganizations } = useAllOrganizations();
  // Org "home" dashboard: charts shared from the Analysis Visualizer. Resolve the
  // org from the dashboard filter, falling back to the user's own organization.
  const homeDashboardOrgId =
    selectedOrganizationNumericId ??
    (user?.organizationId ? Number(user.organizationId) : undefined);
  const { data: homeDashboard } = useHomeDashboard(homeDashboardOrgId);
  const homeDashboardCharts = homeDashboard?.charts ?? [];
  const {
    data: projectsData,
    isLoading: projectsLoading,
    error: projectsError,
    mutate: mutateProjects,
  } = useAllProjectDetails();
  const {
    data: deadlinesData,
    isLoading: deadlinesLoading,
    error: deadlinesError,
    mutate: mutateDeadlines,
  } = useDeadlines({
    upcoming: "true",
    project: selectedProjectId,
    coordinator: selectedCoordinatorId,
    organization: selectedOrganizationId,
    date_from: dashboardFilters.dateFrom || undefined,
    date_to: dashboardFilters.dateTo || undefined,
  });
  const aggregatesFilters = useMemo(
    () =>
      analyticsEnabled
        ? {
            project: isTrainingMode ? (trainingProjectId ?? undefined) : selectedProjectId,
            coordinator: isTrainingMode ? undefined : selectedCoordinatorId,
            organization: isTrainingMode ? undefined : selectedOrganizationId,
            include_org_descendants: (!isTrainingMode && selectedOrganizationId) ? "true" : undefined,
            include_training: isTrainingMode ? "true" : undefined,
            date_from: dashboardFilters.dateFrom || undefined,
            date_to: dashboardFilters.dateTo || undefined,
            status: "approved",
            light: "1",
          }
        : null,
    [
      analyticsEnabled,
      dashboardFilters.dateFrom,
      dashboardFilters.dateTo,
      isTrainingMode,
      trainingProjectId,
      selectedCoordinatorId,
      selectedOrganizationId,
      selectedProjectId,
    ],
  );
  const {
    data: aggregatesData,
    isLoading: aggregatesLoading,
    error: aggregatesError,
    mutate: mutateAggregates,
  } = useAllAggregates(aggregatesFilters);
  const aggregateReviewScopeFilters = useMemo(
    () => ({
      project: isTrainingMode ? (trainingProjectId ?? undefined) : selectedProjectId,
      coordinator: isTrainingMode ? undefined : selectedCoordinatorId,
      organization: isTrainingMode ? undefined : selectedOrganizationId,
      include_org_descendants: (!isTrainingMode && selectedOrganizationId) ? "true" : undefined,
      include_training: isTrainingMode ? "true" : undefined,
      date_from: dashboardFilters.dateFrom || undefined,
      date_to: dashboardFilters.dateTo || undefined,
      page_size: "1",
    }),
    [
      dashboardFilters.dateFrom,
      dashboardFilters.dateTo,
      isTrainingMode,
      trainingProjectId,
      selectedCoordinatorId,
      selectedOrganizationId,
      selectedProjectId,
    ],
  );
  const { data: pendingReviewAggregatesData } = useAggregates({
    ...aggregateReviewScopeFilters,
    status: "pending,reviewed",
  });
  const { data: mismatchesAggregatesData } = useAggregates({
    ...aggregateReviewScopeFilters,
    status: "flagged",
  });
  const widgetAggregateFilters = useMemo(
    () =>
      widgetDialogOpen
        ? {
            project: isTrainingMode ? (trainingProjectId ?? undefined) : selectedProjectId,
            coordinator: isTrainingMode ? undefined : selectedCoordinatorId,
            organization: isTrainingMode ? undefined : selectedOrganizationId,
            include_org_descendants: (!isTrainingMode && selectedOrganizationId) ? "true" : undefined,
            include_training: isTrainingMode ? "true" : undefined,
            status: "approved",
            light: "1",
          }
        : null,
    [isTrainingMode, trainingProjectId, selectedCoordinatorId, selectedOrganizationId, selectedProjectId, widgetDialogOpen],
  );
  const { data: widgetAggregatesData } = useAllAggregates(widgetAggregateFilters);
  const { data: indicatorsData, isLoading: indicatorsLoading } = useAllIndicators({ is_active: "true" });

  useEffect(() => {
    writeHomeDashboardPreferences(storageKey, dashboardPreferences);
  }, [dashboardPreferences, storageKey]);

  useEffect(() => {
    if (!preferencesSourceReady || !user?.id) return;
    const serialized = JSON.stringify(dashboardPreferences);
    if (serialized === lastServerSavedPreferences.current) return;

    let isActive = true;
    const timer = window.setTimeout(async () => {
      try {
        await usersService.updateCurrentUserDashboardPreferences({
          home_dashboard_preferences: dashboardPreferences,
        });
        if (isActive) {
          lastServerSavedPreferences.current = serialized;
        }
      } catch (error) {
        console.error("Failed to save dashboard preferences to API", error);
      }
    }, 700);

    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [dashboardPreferences, preferencesSourceReady, user?.id]);

  useEffect(() => {
    const handleOpenCustomize = () => setPreferencesOpen(true);
    window.addEventListener("bonaso:open-dashboard-customize", handleOpenCustomize);
    return () => {
      window.removeEventListener("bonaso:open-dashboard-customize", handleOpenCustomize);
    };
  }, []);

  const organizations = useMemo(() => organizationsData?.results || [], [organizationsData]);
  // Per-org configured service pathways (Organization.dashboard_config.servicePathways).
  const servicePathwayConfig = useMemo<ConfiguredPathway[] | null>(() => {
    const org = organizations.find((item) => String(item.id) === String(homeDashboardOrgId));
    const cfg = (org?.dashboard_config as { servicePathways?: unknown } | undefined)?.servicePathways;
    return Array.isArray(cfg) ? (cfg as ConfiguredPathway[]) : null;
  }, [organizations, homeDashboardOrgId]);
  const [pathwayConfigOpen, setPathwayConfigOpen] = useState(false);
  const [savingPathways, setSavingPathways] = useState(false);
  const pathwayIndicatorOptions = useMemo(
    () =>
      (indicatorsData ?? []).map((indicator) => ({
        id: String(indicator.id),
        name: indicator.name,
        code: indicator.code,
      })),
    [indicatorsData],
  );
  const handleSavePathways = async (next: ConfiguredPathway[]) => {
    if (!homeDashboardOrgId) {
      toast({
        title: "No organization in scope",
        description: "Select an organization in the dashboard filter to configure its pathways.",
        variant: "destructive",
      });
      return;
    }
    setSavingPathways(true);
    try {
      const org = organizations.find((item) => String(item.id) === String(homeDashboardOrgId));
      const existing = (org?.dashboard_config as Record<string, unknown>) ?? {};
      await organizationsService.saveDashboardConfig(Number(homeDashboardOrgId), {
        ...existing,
        servicePathways: next,
      });
      await mutateOrganizations?.();
      toast({ title: "Service pathways saved", description: "The home dashboard now reflects your configuration." });
      setPathwayConfigOpen(false);
    } catch (error) {
      console.error("Failed to save service pathways", error);
      toast({
        title: "Save failed",
        description: "Unable to save service pathways. Confirm you have permission for this organization.",
        variant: "destructive",
      });
    } finally {
      setSavingPathways(false);
    }
  };
  const allProjects = useMemo(() => {
    const raw = projectsData?.results || [];
    return isTrainingMode ? raw.filter((p) => p.is_training) : raw.filter((p) => !p.is_training);
  }, [projectsData, isTrainingMode]);
  const selectedProjectForHierarchy = useMemo(
    () =>
      selectedProjectId
        ? ((allProjects.find((project) => String(project.id) === selectedProjectId) as Project | undefined) || null)
        : null,
    [allProjects, selectedProjectId],
  );
  const selectedProjectHierarchy = useMemo(
    () => normalizeHierarchyOverrides(selectedProjectForHierarchy?.hierarchy_overrides),
    [selectedProjectForHierarchy?.hierarchy_overrides],
  );
  const selectedProjectOrganizationIds = useMemo(
    () => toProjectOrganizationIds(selectedProjectForHierarchy),
    [selectedProjectForHierarchy],
  );
  const widgetProjectId =
    widgetBuilderFilters.projectId !== "all"
      ? widgetBuilderFilters.projectId
      : selectedProjectId;
  const widgetProjectForHierarchy = useMemo(
    () =>
      widgetProjectId
        ? ((allProjects.find((project) => String(project.id) === widgetProjectId) as Project | undefined) || null)
        : null,
    [allProjects, widgetProjectId],
  );
  const widgetProjectHierarchy = useMemo(
    () => normalizeHierarchyOverrides(widgetProjectForHierarchy?.hierarchy_overrides),
    [widgetProjectForHierarchy?.hierarchy_overrides],
  );
  const widgetProjectOrganizationIds = useMemo(
    () => toProjectOrganizationIds(widgetProjectForHierarchy),
    [widgetProjectForHierarchy],
  );
  const { availableCoordinatorOrganizations } = useAggregateVisibilityScope({
    organizations,
    user,
  });
  const descendantsByParent = useMemo(
    () =>
      buildOrganizationDescendantMap(
        organizations,
        selectedProjectForHierarchy
          ? {
              hierarchyOverrides: selectedProjectHierarchy,
              scopedOrganizationIds: selectedProjectOrganizationIds,
            }
          : undefined,
      ),
    [
      organizations,
      selectedProjectForHierarchy,
      selectedProjectHierarchy,
      selectedProjectOrganizationIds,
    ],
  );
  const widgetDescendantsByParent = useMemo(
    () =>
      buildOrganizationDescendantMap(
        organizations,
        widgetProjectForHierarchy
          ? {
              hierarchyOverrides: widgetProjectHierarchy,
              scopedOrganizationIds: widgetProjectOrganizationIds,
            }
          : undefined,
      ),
    [
      organizations,
      widgetProjectForHierarchy,
      widgetProjectHierarchy,
      widgetProjectOrganizationIds,
    ],
  );
  const coordinatorOptions = useMemo(
    () => availableCoordinatorOrganizations,
    [availableCoordinatorOrganizations],
  );
  const coordinatorScopedOrganizationIds = useMemo(() => {
    if (!selectedCoordinatorId) return null;
    return new Set([
      selectedCoordinatorId,
      ...(descendantsByParent[selectedCoordinatorId] || []),
    ]);
  }, [descendantsByParent, selectedCoordinatorId]);
  const organizationOptions = useMemo(() => {
    if (!coordinatorScopedOrganizationIds) return organizations;
    return organizations.filter((organization) =>
      coordinatorScopedOrganizationIds.has(String(organization.id)),
    );
  }, [coordinatorScopedOrganizationIds, organizations]);
  const widgetCoordinatorId =
    widgetBuilderFilters.coordinatorId !== "all" ? widgetBuilderFilters.coordinatorId : undefined;
  const widgetCoordinatorScopedOrganizationIds = useMemo(() => {
    if (!widgetCoordinatorId) return null;
    return new Set([
      widgetCoordinatorId,
      ...(widgetDescendantsByParent[widgetCoordinatorId] || []),
    ]);
  }, [widgetCoordinatorId, widgetDescendantsByParent]);
  const widgetOrganizationOptions = useMemo(() => {
    if (!widgetCoordinatorScopedOrganizationIds) return organizations;
    return organizations.filter((organization) =>
      widgetCoordinatorScopedOrganizationIds.has(String(organization.id)),
    );
  }, [organizations, widgetCoordinatorScopedOrganizationIds]);
  const scopedOrganizationIds = useMemo(() => {
    if (!selectedOrganizationId) return coordinatorScopedOrganizationIds;
    const organizationScopeIds = new Set([
      selectedOrganizationId,
      ...(descendantsByParent[selectedOrganizationId] || []),
    ]);
    if (!coordinatorScopedOrganizationIds) return organizationScopeIds;
    return new Set(
      Array.from(organizationScopeIds).filter((organizationId) =>
        coordinatorScopedOrganizationIds.has(organizationId),
      ),
    );
  }, [coordinatorScopedOrganizationIds, descendantsByParent, selectedOrganizationId]);
  const activeProjects = useMemo(() => {
    const items = allProjects;
    return items.filter((project) => {
      if (selectedProjectId && String(project.id) !== selectedProjectId) return false;
      if (!scopedOrganizationIds) return true;
      const projectOrganizationIds = new Set<string>((project.organizations || []).map((organizationId) => String(organizationId)));
      return Array.from(projectOrganizationIds).some((organizationId) =>
        scopedOrganizationIds.has(organizationId),
      );
    });
  }, [allProjects, scopedOrganizationIds, selectedProjectId]);
  const allUpcomingDeadlines = useMemo(() => {
    const items = deadlinesData?.results || [];
    if (!dashboardFilters.dateFrom && !dashboardFilters.dateTo) return items;
    return items.filter((deadline) =>
      fallsWithinDateRange(deadline.due_date, dashboardFilters.dateFrom, dashboardFilters.dateTo),
    );
  }, [dashboardFilters.dateFrom, dashboardFilters.dateTo, deadlinesData]);
  const recentActivity = useMemo(() => {
    const items = dashboardStats?.recent_activity || [];
    if (!dashboardFilters.dateFrom && !dashboardFilters.dateTo) return items;
    return items.filter((item) =>
      fallsWithinDateRange(item.timestamp, dashboardFilters.dateFrom, dashboardFilters.dateTo),
    );
  }, [dashboardFilters.dateFrom, dashboardFilters.dateTo, dashboardStats]);
  const screeningInsights = useMemo(
    () => {
      const fromQuarter = dashboardFilters.dateFrom ? getQuarterBucket(dashboardFilters.dateFrom) : null;
      const toQuarter = dashboardFilters.dateTo ? getQuarterBucket(dashboardFilters.dateTo) : null;
      const selectedQuarter =
        fromQuarter && toQuarter
          ? fromQuarter.year === toQuarter.year && fromQuarter.quarter === toQuarter.quarter
            ? fromQuarter.quarter
            : null
          : fromQuarter?.quarter ?? toQuarter?.quarter ?? null;

      return buildHomeDashboardScreeningInsights({
        aggregatesData,
        indicatorsData,
        organizations,
        activeProjects,
        scopedOrganizationIds,
        selectedQuarter,
        includeHivPreventionMessageTypeByCso: false,
        servicePathwayConfig,
        isLoading: aggregatesLoading || indicatorsLoading || !analyticsEnabled,
        hasError: Boolean(aggregatesError),
      });
    },
    [
      activeProjects,
      aggregatesData,
      aggregatesError,
      aggregatesLoading,
      analyticsEnabled,
      dashboardFilters.dateFrom,
      dashboardFilters.dateTo,
      indicatorsData,
      indicatorsLoading,
      organizations,
      scopedOrganizationIds,
      servicePathwayConfig,
    ],
  );
  const aggregateReviewSnapshot = useMemo<DashboardAggregateReviewSnapshot>(() => {
    const approved = Array.isArray(aggregatesData) ? aggregatesData.length : 0;
    const pendingReview = pendingReviewAggregatesData?.count ?? 0;
    const mismatches = mismatchesAggregatesData?.count ?? 0;
    return {
      approved,
      pendingReview,
      mismatches,
    };
  }, [
    aggregatesData,
    mismatchesAggregatesData?.count,
    pendingReviewAggregatesData?.count,
  ]);
  const isReadOnlyUser = isReadOnlyClient(user);

  const setSectionPreference = (
    key:
      | "showWelcomeBanner"
      | "showSummaryStrip"
      | "showUpdatesBoard"
      | "showFavoritesPanel"
      | "showSpotlightPanel",
    checked: boolean,
  ) => {
    setDashboardPreferences((current) => ({
      ...current,
      [key]: checked,
    }));
  };

  const setSummaryCardPreference = (cardId: string, checked: boolean) => {
    setDashboardPreferences((current) => ({
      ...current,
      summaryCards: {
        ...current.summaryCards,
        [cardId]: checked,
      },
    }));
  };

  const setHeroActionPreference = (actionId: string, checked: boolean) => {
    setDashboardPreferences((current) => ({
      ...current,
      heroActions: {
        ...current.heroActions,
        [actionId]: checked,
      },
    }));
  };

  const setQuickLinkPreference = (linkId: string, checked: boolean) => {
    setDashboardPreferences((current) => ({
      ...current,
      quickLinks: {
        ...current.quickLinks,
        [linkId]: checked,
      },
    }));
  };

  const setChartPreference = <K extends keyof DashboardChartPreferences>(
    key: K,
    value: DashboardChartPreferences[K],
  ) => {
    setDashboardPreferences((current) => ({
      ...current,
      chartPreferences: {
        ...current.chartPreferences,
        [key]: value,
      },
    }));
  };

  const setDefaultUpdatesTab = (tab: UpdatesTab) => {
    setDashboardPreferences((current) => ({
      ...current,
      defaultUpdatesTab: tab,
    }));
    setActiveUpdatesTab(tab);
  };

  const resetDashboardPreferences = () => {
    setDashboardPreferences(defaultHomeDashboardPreferences);
    setActiveUpdatesTab(defaultHomeDashboardPreferences.defaultUpdatesTab);
  };

  const clearDashboardFilters = () => {
    setDashboardFilters(defaultHomeDashboardFilters);
  };

  const activeFilterCount = [
    dashboardFilters.projectId !== "all",
    dashboardFilters.coordinatorId !== "all",
    dashboardFilters.organizationId !== "all",
    Boolean(dashboardFilters.dateFrom),
    Boolean(dashboardFilters.dateTo),
  ].filter(Boolean).length;

  const summaryCards = [
    {
      id: "respondents",
      label: "Respondents",
      value: dashboardStats?.total_respondents ?? 0,
      note: "people recorded in the portal",
      icon: Users,
    },
    {
      id: "interactions",
      label: "Interactions",
      value: dashboardStats?.total_assessments ?? 0,
      note: "assessments and service touchpoints",
      icon: Activity,
    },
    {
      id: "active-projects",
      label: "Active Projects",
      value: dashboardStats?.active_projects ?? activeProjects.length,
      note: "currently running delivery streams",
      icon: FolderKanban,
    },
    {
      id: "flags-behind",
      label: "Flags Behind",
      value: dashboardStats?.indicators_behind ?? 0,
      note: "indicator areas needing attention",
      icon: AlertTriangle,
    },
  ];

  const visibleSummaryCards = summaryCards.filter(
    (card) => dashboardPreferences.summaryCards[card.id] !== false,
  );
  const visibleQuickLinks = dashboardQuickLinks.filter((link) => {
    if (isReadOnlyUser && (link.id === "respondents" || link.id === "aggregates")) return false;
    return dashboardPreferences.quickLinks[link.id] !== false;
  });
  const configurableHeroActions = heroActionDefinitions.filter(
    (action) => !(isReadOnlyUser && action.readOnlyHidden),
  );
  const configurableQuickLinks = dashboardQuickLinks.filter(
    (link) => !(isReadOnlyUser && link.readOnlyHidden),
  );
  const indicatorById = useMemo(
    () =>
      new Map(
        ((indicatorsData ?? []) as Indicator[]).map(
          (indicator) => [String(indicator.id), indicator] as const,
        ),
      ),
    [indicatorsData],
  );
  const activeIndicatorIds = useMemo(
    () => new Set(Array.from(indicatorById.keys())),
    [indicatorById],
  );
  const activeIndicatorIdByName = useMemo(
    () =>
      new Map(
        ((indicatorsData ?? []) as Indicator[]).map(
          (indicator) => [normalizeDashboardText(indicator.name), String(indicator.id)] as const,
        ),
      ),
    [indicatorsData],
  );
  const sourceWidgetAggregates = useMemo(
    () => widgetAggregatesData || aggregatesData || [],
    [aggregatesData, widgetAggregatesData],
  );
  const scopedWidgetAggregates = useMemo(
    () =>
      sourceWidgetAggregates.filter((aggregate) => {
        if (
          scopedOrganizationIds &&
          !scopedOrganizationIds.has(String(aggregate.organization || ""))
        ) {
          return false;
        }
        return true;
      }),
    [scopedOrganizationIds, sourceWidgetAggregates],
  );
  const widgetIndicatorValuesById = useMemo(() => {
    const totalsByIndicatorId = new Map<string, number>();
    for (const aggregate of scopedWidgetAggregates) {
      const aggregateIndicatorId = String(aggregate.indicator || "").trim();
      const indicatorId = activeIndicatorIds.has(aggregateIndicatorId)
        ? aggregateIndicatorId
        : activeIndicatorIdByName.get(normalizeDashboardText(aggregate.indicator_name)) || "";
      if (!indicatorId) continue;
      const total = getAggregateTotal(aggregate);
      if (total <= 0) continue;
      totalsByIndicatorId.set(
        indicatorId,
        (totalsByIndicatorId.get(indicatorId) || 0) + total,
      );
    }

    return totalsByIndicatorId;
  }, [activeIndicatorIdByName, activeIndicatorIds, scopedWidgetAggregates]);
  const indicatorMetricsById = useMemo(
    () =>
      new Map(
        screeningInsights.indicatorMetrics.map((metric) => [String(metric.indicatorId), metric]),
      ),
    [screeningInsights.indicatorMetrics],
  );
  const customWidgetMetricsById = useMemo(() => {
    const metricsByWidgetId: Record<string, DashboardWidgetMetric[]> = {};
    const descendantsByProjectId = new Map<string, Record<string, string[]>>();
    const intersectScopeSets = (left: Set<string> | null, right: Set<string> | null) => {
      if (!left) return right;
      if (!right) return left;
      return new Set(Array.from(left).filter((value) => right.has(value)));
    };
    const resolveAggregateIndicatorId = (aggregate: Aggregate) => {
      const aggregateIndicatorId = String(aggregate.indicator || "").trim();
      return activeIndicatorIds.has(aggregateIndicatorId)
        ? aggregateIndicatorId
        : activeIndicatorIdByName.get(normalizeDashboardText(aggregate.indicator_name)) || "";
    };
    const resolveDescendantsByProject = (projectId?: string) => {
      if (!projectId) return descendantsByParent;
      const cached = descendantsByProjectId.get(projectId);
      if (cached) return cached;

      const project = allProjects.find((entry) => String(entry.id) === String(projectId));
      if (!project) {
        descendantsByProjectId.set(projectId, descendantsByParent);
        return descendantsByParent;
      }

      const map = buildOrganizationDescendantMap(organizations, {
        hierarchyOverrides: normalizeHierarchyOverrides(project.hierarchy_overrides),
        scopedOrganizationIds: toProjectOrganizationIds(project as Project),
      });
      descendantsByProjectId.set(projectId, map);
      return map;
    };

    for (const widget of dashboardPreferences.customWidgets) {
      const includeTarget = widget.includeTarget !== false;
      const widgetFilter = widget.filter;
      const widgetDescendantsByParent = resolveDescendantsByProject(widgetFilter?.projectId);
      const hasWidgetSpecificFilter = Boolean(
        widgetFilter?.projectId ||
          widgetFilter?.coordinatorId ||
          widgetFilter?.organizationId ||
          widgetFilter?.dateFrom ||
          widgetFilter?.dateTo,
      );
      let widgetOrganizationScope: Set<string> | null = scopedOrganizationIds
        ? new Set(scopedOrganizationIds)
        : null;

      if (widgetFilter?.coordinatorId) {
        const coordinatorScope = new Set([
          widgetFilter.coordinatorId,
          ...(widgetDescendantsByParent[widgetFilter.coordinatorId] || []),
        ]);
        widgetOrganizationScope = intersectScopeSets(widgetOrganizationScope, coordinatorScope);
      }

      if (widgetFilter?.organizationId) {
        const organizationScope = new Set([
          widgetFilter.organizationId,
          ...(widgetDescendantsByParent[widgetFilter.organizationId] || []),
        ]);
        widgetOrganizationScope = intersectScopeSets(widgetOrganizationScope, organizationScope);
      }

      const selectedIndicatorIds = new Set(widget.indicatorIds);
      const widgetScopedAggregates = scopedWidgetAggregates.filter((aggregate) => {
        if (
          widgetFilter?.projectId &&
          String(aggregate.project || "") !== String(widgetFilter.projectId)
        ) {
          return false;
        }
        if (
          widgetOrganizationScope &&
          !widgetOrganizationScope.has(String(aggregate.organization || ""))
        ) {
          return false;
        }
        if (
          !fallsWithinDateRange(
            aggregate.period_end || aggregate.period_start || aggregate.updated_at,
            widgetFilter?.dateFrom,
            widgetFilter?.dateTo,
          )
        ) {
          return false;
        }
        return true;
      });

      const totalsByIndicatorId = new Map<string, number>();
      for (const aggregate of widgetScopedAggregates) {
        const indicatorId = resolveAggregateIndicatorId(aggregate);
        if (!indicatorId || !selectedIndicatorIds.has(indicatorId)) continue;
        const total = getAggregateTotal(aggregate);
        if (total <= 0) continue;
        totalsByIndicatorId.set(
          indicatorId,
          (totalsByIndicatorId.get(indicatorId) || 0) + total,
        );
      }

      const defaultMetrics = widget.indicatorIds
        .map((indicatorId) => {
          const baseMetric = indicatorMetricsById.get(indicatorId);
          const fallbackValue = hasWidgetSpecificFilter ? 0 : toSafeNumber(baseMetric?.value);
          const value = totalsByIndicatorId.get(indicatorId) ?? fallbackValue;
          const baseTarget = includeTarget ? toSafeNumber(baseMetric?.target) : 0;
          const target = baseTarget > 0 ? baseTarget : 0;
          const percentage = target > 0 ? (value / target) * 100 : 0;
          const label =
            indicatorById.get(indicatorId)?.name ||
            baseMetric?.label ||
            `Indicator ${indicatorId}`;

          return {
            indicatorId,
            label,
            value,
            target,
            percentage,
          };
        })
        .filter((metric) => metric.value > 0 || metric.target > 0);
      const disaggregateDimensionKey = String(widget.disaggregateDimensionKey || "").trim();
      if (
        !disaggregateDimensionKey ||
        disaggregateDimensionKey === NO_WIDGET_DISAGGREGATE ||
        widget.indicatorIds.length !== 1
      ) {
        metricsByWidgetId[widget.id] = defaultMetrics;
        continue;
      }

      const selectedIndicatorId = widget.indicatorIds[0];
      const selectedIndicator = indicatorById.get(selectedIndicatorId);
      const sampleRows = widgetScopedAggregates
        .filter((aggregate) => resolveAggregateIndicatorId(aggregate) === selectedIndicatorId)
        .flatMap((aggregate) => getAggregateValueDisaggregateRows(aggregate.value))
        .filter((row) => row.value > 0);
      const dimensionIndex = getDisaggregateDimensionRowIndex(
        selectedIndicator,
        disaggregateDimensionKey,
        sampleRows,
      );
      if (dimensionIndex < 0) {
        metricsByWidgetId[widget.id] = defaultMetrics;
        continue;
      }

      const disaggregateTotals = new Map<string, number>();
      for (const aggregate of widgetScopedAggregates) {
        const resolvedIndicatorId = resolveAggregateIndicatorId(aggregate);
        if (resolvedIndicatorId !== selectedIndicatorId) continue;

        const rows = getAggregateValueDisaggregateRows(aggregate.value);
        for (const row of rows) {
          const disaggregateLabel = getDisaggregateRowValueAtIndex(row, dimensionIndex);
          if (isTotalLikeDisaggregateLabel(disaggregateLabel)) continue;
          if (row.value <= 0) continue;
          disaggregateTotals.set(
            disaggregateLabel,
            (disaggregateTotals.get(disaggregateLabel) || 0) + row.value,
          );
        }
      }

      if (disaggregateTotals.size === 0) {
        metricsByWidgetId[widget.id] = defaultMetrics;
        continue;
      }

      const disaggregateTotal = Array.from(disaggregateTotals.values()).reduce(
        (sum, value) => sum + value,
        0,
      );
      metricsByWidgetId[widget.id] = Array.from(disaggregateTotals.entries())
        .map(([label, value]) => ({
          indicatorId: `${selectedIndicatorId}::${normalizeDashboardText(label).replace(/\s+/g, "-") || label}`,
          label,
          percentage: disaggregateTotal > 0 ? (value / disaggregateTotal) * 100 : 0,
          target: includeTarget ? disaggregateTotal : 0,
          value,
        }))
        .sort((left, right) => {
          if (right.value !== left.value) return right.value - left.value;
          return left.label.localeCompare(right.label);
        });
    }

    return metricsByWidgetId;
  }, [
    activeIndicatorIdByName,
    activeIndicatorIds,
    allProjects,
    dashboardPreferences.customWidgets,
    descendantsByParent,
    indicatorById,
    indicatorMetricsById,
    organizations,
    scopedOrganizationIds,
    scopedWidgetAggregates,
  ]);
  const availableIndicatorOptions = useMemo(() => {
    return (indicatorsData ?? [])
      .map((indicator) => {
        const indicatorId = String(indicator.id);
        return {
          id: indicatorId,
          label: getIndicatorChartLabel(indicator, "Indicator"),
          category: indicator.category,
          metricValue: widgetIndicatorValuesById.get(indicatorId) || 0,
        };
      })
      .sort((left, right) => {
        if (right.metricValue !== left.metricValue) {
          return right.metricValue - left.metricValue;
        }
        return left.label.localeCompare(right.label);
      });
  }, [indicatorsData, widgetIndicatorValuesById]);
  const widgetCategoryOptions = useMemo(() => {
    const availableCategories = new Set(
      availableIndicatorOptions
        .map((indicator) => indicator.category)
        .filter((category): category is IndicatorCategory => Boolean(category)),
    );

    return INDICATOR_CATEGORY_OPTIONS.filter((option) => availableCategories.has(option.value));
  }, [availableIndicatorOptions]);
  const filteredIndicatorOptions = useMemo(() => {
    const query = normalizeDashboardText(widgetSearch);
    return availableIndicatorOptions
      .filter((indicator) =>
        widgetCategoryFilter === "all" ? true : indicator.category === widgetCategoryFilter,
      )
      .filter((indicator) =>
        !query ? true : normalizeDashboardText(indicator.label).includes(query),
      )
      .slice(0, 18);
  }, [availableIndicatorOptions, widgetCategoryFilter, widgetSearch]);
  const selectedSingleWidgetIndicator = useMemo(
    () =>
      selectedWidgetIndicatorIds.length === 1
        ? indicatorById.get(selectedWidgetIndicatorIds[0])
        : undefined,
    [indicatorById, selectedWidgetIndicatorIds],
  );
  const widgetDisaggregateOptions = useMemo(
    () => getIndicatorDisaggregateOptions(selectedSingleWidgetIndicator),
    [selectedSingleWidgetIndicator],
  );
  const widgetBuilderResolvedDisaggregateKey = useMemo(() => {
    const hasDisaggregateOption = widgetDisaggregateOptions.some(
      (option) => option.key === widgetBuilderDisaggregateKey,
    );
    if (selectedWidgetIndicatorIds.length !== 1 || !hasDisaggregateOption) {
      return NO_WIDGET_DISAGGREGATE;
    }
    return widgetBuilderDisaggregateKey;
  }, [
    selectedWidgetIndicatorIds.length,
    widgetBuilderDisaggregateKey,
    widgetDisaggregateOptions,
  ]);

  const toggleWidgetIndicator = (indicatorId: string) => {
    setSelectedWidgetIndicatorIds((current) =>
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId],
    );
  };
  const aggregateFilterContext = useMemo<DashboardAggregateFilterContext>(
    () => ({
      coordinatorId: selectedCoordinatorId,
      dateFrom: dashboardFilters.dateFrom || undefined,
      dateTo: dashboardFilters.dateTo || undefined,
      organizationId: selectedOrganizationId,
      projectId: selectedProjectId,
    }),
    [
      dashboardFilters.dateFrom,
      dashboardFilters.dateTo,
      selectedCoordinatorId,
      selectedOrganizationId,
      selectedProjectId,
    ],
  );

  const resetWidgetBuilder = () => {
    setEditingWidgetId(null);
    setWidgetBuilderTitle("");
    setWidgetSearch("");
    setWidgetCategoryFilter("all");
    setSelectedWidgetIndicatorIds([]);
    setWidgetBuilderType(DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE);
    setWidgetBuilderDisaggregateKey(NO_WIDGET_DISAGGREGATE);
    setWidgetBuilderIncludeTarget(true);
    setWidgetBuilderFilters(defaultWidgetBuilderFilters);
  };

  const addCustomWidget = () => {
    if (selectedWidgetIndicatorIds.length === 0) return;
    const fallbackTitleSource = availableIndicatorOptions.find(
      (indicator) => indicator.id === selectedWidgetIndicatorIds[0],
    );
    const nextTitle =
      widgetBuilderTitle.trim() ||
      (selectedWidgetIndicatorIds.length === 1
        ? fallbackTitleSource?.label || "Custom widget"
        : `${selectedWidgetIndicatorIds.length} indicators`);
    const selectedDisaggregateOption = widgetDisaggregateOptions.find(
      (option) => option.key === widgetBuilderResolvedDisaggregateKey,
    );
    const nextDisaggregate = selectedDisaggregateOption
      ? {
          disaggregateDimensionKey: selectedDisaggregateOption.key,
          disaggregateDimensionLabel: selectedDisaggregateOption.label,
        }
      : {
          disaggregateDimensionKey: undefined,
          disaggregateDimensionLabel: undefined,
        };
    const normalizedWidgetFilter = normalizeWidgetFilter({
      projectId: widgetBuilderFilters.projectId,
      coordinatorId: widgetBuilderFilters.coordinatorId,
      organizationId: widgetBuilderFilters.organizationId,
      dateFrom: widgetBuilderFilters.dateFrom,
      dateTo: widgetBuilderFilters.dateTo,
    });

    setDashboardPreferences((current) => ({
      ...current,
      customWidgets: editingWidgetId
        ? current.customWidgets.map((widget) =>
            widget.id === editingWidgetId
              ? {
                  ...widget,
                  indicatorIds: selectedWidgetIndicatorIds,
                  includeTarget: widgetBuilderIncludeTarget,
                  filter: normalizedWidgetFilter,
                  title: nextTitle,
                  type: widgetBuilderType,
                  ...nextDisaggregate,
                }
              : widget,
          )
        : [
            ...current.customWidgets,
            {
              id: createCustomWidgetId(),
              indicatorIds: selectedWidgetIndicatorIds,
              includeTarget: widgetBuilderIncludeTarget,
              filter: normalizedWidgetFilter,
              title: nextTitle,
              type: widgetBuilderType,
              ...nextDisaggregate,
            },
        ],
    }));
    resetWidgetBuilder();
  };

  const removeCustomWidget = (widgetId: string) => {
    if (editingWidgetId === widgetId) {
      resetWidgetBuilder();
    }
    setDashboardPreferences((current) => ({
      ...current,
      customWidgets: current.customWidgets.filter((widget) => widget.id !== widgetId),
    }));
  };

  const editCustomWidget = (widgetId: string) => {
    const widget = dashboardPreferences.customWidgets.find((item) => item.id === widgetId);
    if (!widget) return;
    setEditingWidgetId(widget.id);
    setWidgetBuilderType(widget.type);
    setWidgetBuilderDisaggregateKey(
      widget.disaggregateDimensionKey || NO_WIDGET_DISAGGREGATE,
    );
    setWidgetBuilderTitle(widget.title);
    setSelectedWidgetIndicatorIds(widget.indicatorIds);
    setWidgetBuilderIncludeTarget(widget.includeTarget !== false);
    setWidgetBuilderFilters({
      projectId: widget.filter?.projectId || "all",
      coordinatorId: widget.filter?.coordinatorId || "all",
      organizationId: widget.filter?.organizationId || "all",
      dateFrom: widget.filter?.dateFrom || "",
      dateTo: widget.filter?.dateTo || "",
    });
    setWidgetSearch("");
    setWidgetCategoryFilter("all");
    setWidgetDialogOpen(true);
  };

  const dashboardFetchErrors = useMemo(() => {
    const sources: { id: string; label: string; error: unknown; retry: () => void }[] = [];
    if (statsError) {
      sources.push({ id: "stats", label: "Summary stats", error: statsError, retry: () => { void mutateStats(); } });
    }
    if (aggregatesError) {
      sources.push({ id: "aggregates", label: "Aggregates", error: aggregatesError, retry: () => { void mutateAggregates(); } });
    }
    if (dashboardMessageAnalyticsError) {
      sources.push({ id: "messages", label: "Message analytics", error: dashboardMessageAnalyticsError, retry: () => { void mutateMessageAnalytics(); } });
    }
    if (deadlinesError) {
      sources.push({ id: "deadlines", label: "Deadlines", error: deadlinesError, retry: () => { void mutateDeadlines(); } });
    }
    if (projectsError) {
      sources.push({ id: "projects", label: "Projects", error: projectsError, retry: () => { void mutateProjects(); } });
    }
    return sources;
  }, [
    aggregatesError,
    dashboardMessageAnalyticsError,
    deadlinesError,
    mutateAggregates,
    mutateDeadlines,
    mutateMessageAnalytics,
    mutateProjects,
    mutateStats,
    projectsError,
    statsError,
  ]);
  const retryAllFailedFetches = () => {
    dashboardFetchErrors.forEach((source) => source.retry());
  };

  const isInitialDashboardLoad = statsLoading && !dashboardStats;
  const dashboardFiltersAreDefault =
    dashboardFilters.projectId === "all" &&
    dashboardFilters.coordinatorId === "all" &&
    dashboardFilters.organizationId === "all" &&
    !dashboardFilters.dateFrom &&
    !dashboardFilters.dateTo;
  const hasAnyDashboardData =
    Boolean(dashboardStats?.respondents_count) ||
    Boolean(dashboardStats?.interactions_count) ||
    activeProjects.length > 0 ||
    allUpcomingDeadlines.length > 0 ||
    recentActivity.length > 0 ||
    (Array.isArray(aggregatesData) && aggregatesData.length > 0);
  const showEmptyWelcomeState =
    !isInitialDashboardLoad &&
    !statsError &&
    !hasAnyDashboardData &&
    dashboardFiltersAreDefault &&
    // Don't conclude "no data" until the deferred aggregate fetch has resolved,
    // otherwise an aggregate-only portal would briefly flash the welcome state.
    analyticsEnabled &&
    !aggregatesLoading;

  return (
    <div className="mx-auto w-full max-w-[1440px] min-w-0 space-y-6 overflow-x-hidden px-3 pb-8 sm:px-4 lg:px-6">
      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customize Home Dashboard</DialogTitle>
            <DialogDescription>
              Pick which sections, summary cards, and shortcut links you want to see on your home dashboard.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="space-y-4 rounded-xl border border-border bg-transparent p-4">
              <div>
                <h3 className="font-semibold text-foreground">Sections</h3>
                <p className="text-sm text-muted-foreground">
                  Control the major panels that appear on the page.
                </p>
              </div>

              {[
                ["showWelcomeBanner", "Welcome banner", "The greeting, quick actions, and intro copy."],
                ["showSummaryStrip", "Summary strip", "The four KPI cards below the hero."],
                ["showUpdatesBoard", "Updates board", "The activity, deadlines, and projects board."],
                ["showFavoritesPanel", "Favorites panel", "Your quick-access shortcut cards."],
                ["showSpotlightPanel", "Project spotlight", "The current-focus projects panel."],
              ].map(([key, title, description]) => (
                <label
                  key={key}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3"
                >
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">{title}</div>
                    <div className="text-sm text-muted-foreground">{description}</div>
                  </div>
                  <Switch
                    checked={
                      dashboardPreferences[
                        key as keyof Pick<
                          HomeDashboardPreferences,
                          | "showWelcomeBanner"
                          | "showSummaryStrip"
                          | "showUpdatesBoard"
                          | "showFavoritesPanel"
                          | "showSpotlightPanel"
                        >
                      ]
                    }
                    onCheckedChange={(checked) =>
                      setSectionPreference(
                        key as
                          | "showWelcomeBanner"
                          | "showSummaryStrip"
                          | "showUpdatesBoard"
                          | "showFavoritesPanel"
                          | "showSpotlightPanel",
                        checked,
                      )
                    }
                  />
                </label>
              ))}
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-transparent p-4">
              <div>
                <h3 className="font-semibold text-foreground">Widgets</h3>
                <p className="text-sm text-muted-foreground">
                  Fine-tune the cards and shortcuts inside the dashboard.
                </p>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">Summary cards</div>
                {summaryCardDefinitions.map((card) => (
                  <label
                    key={card.id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3"
                  >
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{card.label}</div>
                      <div className="text-sm text-muted-foreground">{card.note}</div>
                    </div>
                    <Switch
                      checked={dashboardPreferences.summaryCards[card.id] !== false}
                      onCheckedChange={(checked) => setSummaryCardPreference(card.id, checked)}
                    />
                  </label>
                ))}
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">Hero action buttons</div>
                {configurableHeroActions.map((action) => (
                  <label
                    key={action.id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3"
                  >
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{action.label}</div>
                      <div className="text-sm text-muted-foreground">Show this shortcut in the welcome banner.</div>
                    </div>
                    <Switch
                      checked={dashboardPreferences.heroActions[action.id] !== false}
                      onCheckedChange={(checked) => setHeroActionPreference(action.id, checked)}
                    />
                  </label>
                ))}
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">Quick links</div>
                {configurableQuickLinks.map((link) => (
                  <label
                    key={link.id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3"
                  >
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{link.label}</div>
                      <div className="text-sm text-muted-foreground">{link.description}</div>
                    </div>
                    <Switch
                      checked={dashboardPreferences.quickLinks[link.id] !== false}
                      onCheckedChange={(checked) => setQuickLinkPreference(link.id, checked)}
                    />
                  </label>
                ))}
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-background px-4 py-3">
                <div>
                  <div className="font-medium text-foreground">Default board tab</div>
                  <div className="text-sm text-muted-foreground">
                    Choose which tab opens first in the updates board.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["activity", "deadlines", "projects"] as UpdatesTab[]).map((tab) => (
                    <Button
                      key={tab}
                      type="button"
                      variant={dashboardPreferences.defaultUpdatesTab === tab ? "default" : "outline"}
                      className={cn(
                        "capitalize",
                        dashboardPreferences.defaultUpdatesTab !== tab &&
                          "border-border bg-background text-foreground hover:bg-muted",
                      )}
                      onClick={() => setDefaultUpdatesTab(tab)}
                    >
                      {tab}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-background px-4 py-3">
                <div>
                  <div className="font-medium text-foreground">Charts</div>
                  <div className="text-sm text-muted-foreground">
                    Control how dashboard charts are rendered.
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trend-layout-select">Trend layout</Label>
                  <Select
                    value={dashboardPreferences.chartPreferences.trendLayout}
                    onValueChange={(value) =>
                      setChartPreference("trendLayout", value === "stacked" ? "stacked" : "grouped")
                    }
                  >
                    <SelectTrigger id="trend-layout-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="grouped">Grouped bars</SelectItem>
                      <SelectItem value="stacked">Stacked bars</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="trend-series-limit-select">Visible trend series</Label>
                  <Select
                    value={String(dashboardPreferences.chartPreferences.trendSeriesLimit)}
                    onValueChange={(value) => {
                      const parsed = Number(value);
                      const seriesLimit = [1, 2, 3, 4, 5].includes(parsed) ? parsed : 3;
                      setChartPreference("trendSeriesLimit", seriesLimit as 1 | 2 | 3 | 4 | 5);
                    }}
                  >
                    <SelectTrigger id="trend-series-limit-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 series</SelectItem>
                      <SelectItem value="2">2 series</SelectItem>
                      <SelectItem value="3">3 series</SelectItem>
                      <SelectItem value="4">4 series</SelectItem>
                      <SelectItem value="5">5 series</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pathway-style-select">Pathway chart style</Label>
                  <Select
                    value={dashboardPreferences.chartPreferences.pathwayStyle}
                    onValueChange={(value) =>
                      setChartPreference("pathwayStyle", value === "pie" ? "pie" : "donut")
                    }
                  >
                    <SelectTrigger id="pathway-style-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pie">Pie</SelectItem>
                      <SelectItem value="donut">Donut</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3">
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">Trend legend</div>
                    <div className="text-sm text-muted-foreground">Show color labels below the monthly chart.</div>
                  </div>
                  <Switch
                    checked={dashboardPreferences.chartPreferences.showTrendLegend}
                    onCheckedChange={(checked) => setChartPreference("showTrendLegend", checked)}
                  />
                </label>
              </div>
            </div>
          </div>

          <DialogFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              className="border-border bg-background text-foreground hover:bg-muted"
              onClick={resetDashboardPreferences}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset Defaults
            </Button>
            <Button type="button" onClick={() => setPreferencesOpen(false)}>
              Save Layout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={widgetDialogOpen}
        onOpenChange={(open) => {
          setWidgetDialogOpen(open);
          if (!open) resetWidgetBuilder();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingWidgetId ? "Edit dashboard card" : "Add dashboard card"}</DialogTitle>
            <DialogDescription>
              Build a card from one or more indicators and place it directly on the dashboard.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="widget-title">Card title</Label>
                <Input
                  id="widget-title"
                  value={widgetBuilderTitle}
                  placeholder="Example: HIV linkage watch"
                  onChange={(event) => setWidgetBuilderTitle(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="widget-type">Card style</Label>
                <Select
                  value={widgetBuilderType}
                  onValueChange={(value) => setWidgetBuilderType(parseDashboardCustomWidgetType(value))}
                >
                  <SelectTrigger id="widget-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DASHBOARD_CUSTOM_WIDGET_STYLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="widget-indicator-category">Indicator category</Label>
                <Select
                  value={widgetCategoryFilter}
                  onValueChange={(value) =>
                    setWidgetCategoryFilter(
                      value === "all" ? "all" : (value as IndicatorCategory),
                    )
                  }
                >
                  <SelectTrigger id="widget-indicator-category">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {widgetCategoryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="widget-indicator-search">Choose indicators</Label>
                <Input
                  id="widget-indicator-search"
                  value={widgetSearch}
                  placeholder="Search indicators..."
                  onChange={(event) => setWidgetSearch(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="widget-disaggregate">Disaggregate breakdown</Label>
              <Select
                value={widgetBuilderResolvedDisaggregateKey}
                onValueChange={(value) => setWidgetBuilderDisaggregateKey(value)}
                disabled={
                  selectedWidgetIndicatorIds.length !== 1 ||
                  widgetDisaggregateOptions.length === 0
                }
              >
                <SelectTrigger id="widget-disaggregate">
                  <SelectValue placeholder="Totals only" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_WIDGET_DISAGGREGATE}>Totals only</SelectItem>
                  {widgetDisaggregateOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedWidgetIndicatorIds.length === 0
                  ? "Select one indicator to enable disaggregate visualization."
                  : selectedWidgetIndicatorIds.length > 1
                    ? "Disaggregate view is available when exactly one indicator is selected."
                    : widgetDisaggregateOptions.length === 0
                      ? "This indicator has no configured disaggregates."
                      : "The chart will visualize values by the selected disaggregate dimension."}
              </p>
            </div>

            <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3">
              <div className="space-y-1">
                <div className="font-medium text-foreground">Include target values</div>
                <div className="text-sm text-muted-foreground">
                  Turn this off to show actuals only for this dashboard card.
                </div>
              </div>
              <Switch
                checked={widgetBuilderIncludeTarget}
                onCheckedChange={(checked) => setWidgetBuilderIncludeTarget(checked)}
              />
            </label>

            <div className="space-y-3 rounded-lg border border-border bg-background p-3">
              <div>
                <div className="font-medium text-foreground">Card filters</div>
                <div className="text-sm text-muted-foreground">
                  Optional filters applied only to this card.
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="widget-filter-project">Project</Label>
                  <Select
                    value={widgetBuilderFilters.projectId}
                    onValueChange={(value) =>
                      setWidgetBuilderFilters((current) => ({
                        ...current,
                        projectId: value,
                      }))
                    }
                  >
                    <SelectTrigger id="widget-filter-project">
                      <SelectValue placeholder="All projects" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All projects</SelectItem>
                      {allProjects.map((project) => (
                        <SelectItem key={`widget-project-${project.id}`} value={String(project.id)}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widget-filter-coordinator">Coordinator</Label>
                  <Select
                    value={widgetBuilderFilters.coordinatorId}
                    onValueChange={(value) =>
                      setWidgetBuilderFilters((current) => ({
                        ...current,
                        coordinatorId: value,
                        organizationId: "all",
                      }))
                    }
                  >
                    <SelectTrigger id="widget-filter-coordinator">
                      <SelectValue placeholder="All coordinators" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All coordinators</SelectItem>
                      {coordinatorOptions.map((organization) => (
                        <SelectItem
                          key={`widget-coordinator-${organization.id}`}
                          value={String(organization.id)}
                        >
                          {organization.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="widget-filter-organization">Organization</Label>
                  <OrganizationSelect
                    organizations={widgetOrganizationOptions}
                    value={widgetBuilderFilters.organizationId}
                    onChange={(value) =>
                      setWidgetBuilderFilters((current) => ({
                        ...current,
                        organizationId: value,
                      }))
                    }
                    includeAll
                    allLabel={
                      widgetCoordinatorId
                        ? "All organizations in coordinator scope"
                        : "All organizations"
                    }
                    placeholder="All organizations"
                    className="h-10 w-full"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="widget-filter-date-from">Date from</Label>
                    <Input
                      id="widget-filter-date-from"
                      type="date"
                      value={widgetBuilderFilters.dateFrom}
                      onChange={(event) =>
                        setWidgetBuilderFilters((current) => ({
                          ...current,
                          dateFrom: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="widget-filter-date-to">Date to</Label>
                    <Input
                      id="widget-filter-date-to"
                      type="date"
                      value={widgetBuilderFilters.dateTo}
                      onChange={(event) =>
                        setWidgetBuilderFilters((current) => ({
                          ...current,
                          dateTo: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
              {filteredIndicatorOptions.length === 0 ? (
                <div className="px-2 py-4 text-sm text-muted-foreground">
                  No indicators match the current filters.
                </div>
              ) : (
                filteredIndicatorOptions.map((indicator) => {
                  const selected = selectedWidgetIndicatorIds.includes(indicator.id);
                  return (
                    <button
                      key={indicator.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:bg-muted",
                      )}
                      onClick={() => toggleWidgetIndicator(indicator.id)}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm text-foreground">{indicator.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {getIndicatorCategoryLabel(indicator.category)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {indicator.metricValue.toLocaleString()}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                {selectedWidgetIndicatorIds.length} selected
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    resetWidgetBuilder();
                    setWidgetDialogOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    addCustomWidget();
                    setWidgetDialogOpen(false);
                  }}
                  disabled={selectedWidgetIndicatorIds.length === 0}
                >
                  {editingWidgetId ? "Save card" : "Add card"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <section className="min-w-0 w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Dashboard Filters
          </h2>
          {activeFilterCount > 0 ? (
            <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {activeFilterCount} active
            </span>
          ) : null}
        </div>

        <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="home-dashboard-project-filter">Project</Label>
            <Select
              value={dashboardFilters.projectId}
              onValueChange={(value) => {
                const cleared: string[] = [];
                if (dashboardFilters.coordinatorId !== "all") cleared.push("coordinator");
                if (dashboardFilters.organizationId !== "all") cleared.push("organization");
                setDashboardFilters((current) => ({
                  ...current,
                  projectId: value,
                  coordinatorId: "all",
                  organizationId: "all",
                }));
                if (cleared.length > 0) {
                  toast({
                    title: "Filters updated",
                    description: `Cleared ${cleared.join(" and ")} to match project scope.`,
                  });
                }
              }}
            >
              <SelectTrigger id="home-dashboard-project-filter" className="h-10 w-full">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {activeProjects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="home-dashboard-coordinator-filter">Coordinator</Label>
            <Select
              value={dashboardFilters.coordinatorId}
              onValueChange={(value) => {
                const cleared: string[] = [];
                if (dashboardFilters.projectId !== "all") cleared.push("project");
                if (dashboardFilters.organizationId !== "all") cleared.push("organization");
                setDashboardFilters((current) => ({
                  ...current,
                  coordinatorId: value,
                  organizationId: "all",
                  projectId: "all",
                }));
                if (cleared.length > 0) {
                  toast({
                    title: "Filters updated",
                    description: `Cleared ${cleared.join(" and ")} to match coordinator scope.`,
                  });
                }
              }}
            >
              <SelectTrigger id="home-dashboard-coordinator-filter" className="h-10 w-full">
                <SelectValue placeholder="All coordinators" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All coordinators</SelectItem>
                {coordinatorOptions.map((organization) => (
                  <SelectItem key={organization.id} value={String(organization.id)}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="home-dashboard-organization-filter">Organization</Label>
            <OrganizationSelect
              organizations={organizationOptions}
              value={dashboardFilters.organizationId}
              onChange={(value) => {
                const willClearProject = dashboardFilters.projectId !== "all";
                setDashboardFilters((current) => ({
                  ...current,
                  organizationId: value,
                  projectId: "all",
                }));
                if (willClearProject) {
                  toast({
                    title: "Filters updated",
                    description: "Cleared project filter to match organization scope.",
                  });
                }
              }}
              includeAll
              allLabel={
                selectedCoordinatorId
                  ? "All organizations in coordinator scope"
                  : "All organizations"
              }
              placeholder="All organizations"
              className="h-10 w-full"
            />
          </div>

          <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-2">
            <Label>Reporting window</Label>
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">From</p>
                <Input
                  id="home-dashboard-date-from"
                  type="date"
                  className="h-10 w-full"
                  value={dashboardFilters.dateFrom}
                  onChange={(event) =>
                    setDashboardFilters((current) => ({
                      ...current,
                      dateFrom: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">To</p>
                <Input
                  id="home-dashboard-date-to"
                  type="date"
                  className="h-10 w-full"
                  value={dashboardFilters.dateTo}
                  onChange={(event) =>
                    setDashboardFilters((current) => ({
                      ...current,
                      dateTo: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="min-w-0 flex items-end">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full"
              onClick={clearDashboardFilters}
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </section>

      {dashboardFetchErrors.length > 0 ? (
        <section
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="font-medium">
                {dashboardFetchErrors.length === 1
                  ? "One dashboard area couldn't load"
                  : `${dashboardFetchErrors.length} dashboard areas couldn't load`}
              </div>
              <div className="text-xs text-destructive/80">
                Affected: {dashboardFetchErrors.map((source) => source.label).join(", ")}. The rest of the dashboard is still usable.
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-destructive/40 bg-background text-destructive hover:bg-destructive/10"
                onClick={retryAllFailedFetches}
              >
                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {isInitialDashboardLoad ? (
        <section
          aria-busy="true"
          aria-label="Dashboard loading"
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm"
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-4 h-8 w-32" />
                <Skeleton className="mt-3 h-3 w-40" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-4 h-48 w-full" />
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <Skeleton className="h-5 w-32" />
              <div className="mt-4 space-y-3">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : projectsLoading || deadlinesLoading || aggregatesLoading ? (
        <section className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
          Refreshing dashboard data...
        </section>
      ) : null}

      {showEmptyWelcomeState ? (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold text-foreground sm:text-2xl">
            Welcome{user?.firstName ? `, ${user.firstName}` : ""} 👋
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Your dashboard is ready. As your team enters data — interactions, aggregates, deadlines — it will appear here.
            Get started below.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link
              href="/projects"
              className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <FolderKanban className="mb-2 h-5 w-5 text-primary" />
              <div>View Projects</div>
              <div className="mt-1 text-xs font-normal text-muted-foreground">
                See active grants, indicators, and targets.
              </div>
            </Link>
            <Link
              href="/aggregates"
              className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <BarChart3 className="mb-2 h-5 w-5 text-primary" />
              <div>Enter Aggregates</div>
              <div className="mt-1 text-xs font-normal text-muted-foreground">
                Submit reported totals for review.
              </div>
            </Link>
            <Link
              href="/analysis/reports"
              className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <FileText className="mb-2 h-5 w-5 text-primary" />
              <div>Open Reports</div>
              <div className="mt-1 text-xs font-normal text-muted-foreground">
                Exports, summaries, and saved views.
              </div>
            </Link>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            If you expect to see data here, contact your coordinator or admin to confirm your organization scope.
          </p>
        </section>
      ) : null}

      {isInitialDashboardLoad ? null : <DashboardExecutiveBoard
        activeProjects={activeProjects}
        activeUpdatesTab={activeUpdatesTab}
        aggregateReviewSnapshot={aggregateReviewSnapshot}
        aggregateFilterContext={aggregateFilterContext}
        chartPreferences={dashboardPreferences.chartPreferences}
        customWidgets={dashboardPreferences.customWidgets}
        customWidgetMetricsById={customWidgetMetricsById}
        deadlines={allUpcomingDeadlines}
        onDeleteCustomWidget={removeCustomWidget}
        onEditCustomWidget={editCustomWidget}
        onOpenCustomizeDashboard={() => setWidgetDialogOpen(true)}
        onConfigureServicePathways={() => setPathwayConfigOpen(true)}
        recentActivity={recentActivity}
        screeningInsights={screeningInsights}
        messageAnalyticsRows={dashboardMessageAnalytics?.rows || []}
        messageAnalyticsSeries={dashboardMessageAnalytics?.series || []}
        messageAnalyticsIsLoading={dashboardMessageAnalyticsLoading}
        messageAnalyticsHasError={Boolean(dashboardMessageAnalyticsError)}
        showFavoritesPanel={dashboardPreferences.showFavoritesPanel}
        showSpotlightPanel={dashboardPreferences.showSpotlightPanel}
        showSummaryStrip={dashboardPreferences.showSummaryStrip}
        showUpdatesBoard={dashboardPreferences.showUpdatesBoard}
        visibleQuickLinks={visibleQuickLinks}
        visibleSummaryCards={visibleSummaryCards}
        onActiveUpdatesTabChange={setActiveUpdatesTab}
      />}

      {isInitialDashboardLoad ? null : (
        <section className="mt-4 min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Shared charts
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                Home dashboard
              </h2>
            </div>
            <Link href="/analysis/visualizer">
              <Button type="button" variant="outline">
                Add chart from Analysis
              </Button>
            </Link>
          </div>
          {homeDashboard && homeDashboardCharts.length > 0 ? (
            <DashboardAnalyticsSurface dashboard={homeDashboard} />
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              No shared charts yet. Build a chart under{" "}
              <Link href="/analysis/visualizer" className="font-medium text-foreground underline underline-offset-4">
                Analysis → Visualizer
              </Link>{" "}
              and use “Add to home dashboard” to pin it here for your organization.
            </div>
          )}
        </section>
      )}

      <ServicePathwayConfigDialog
        open={pathwayConfigOpen}
        onOpenChange={setPathwayConfigOpen}
        indicators={pathwayIndicatorOptions}
        value={servicePathwayConfig}
        saving={savingPathways}
        onSave={handleSavePathways}
      />
    </div>
  );
}
