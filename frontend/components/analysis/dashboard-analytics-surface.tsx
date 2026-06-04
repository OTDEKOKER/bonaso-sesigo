"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, RotateCcw } from "lucide-react";

import { CompactAnalyticsFilterBar } from "@/components/analysis/compact-analytics-filter-bar";
import type { CustomAnalysisState } from "@/components/analysis/custom-analysis-builder";
import { KPIGrid } from "@/components/analysis/kpi-grid";
import { RawRecordsTable } from "@/components/analysis/raw-records-table";
import { ReportingCompleteness } from "@/components/analysis/reporting-completeness";
import { SmartChartRenderer } from "@/components/analysis/smart-chart-renderer";
import { VisualizationMatrixTable } from "@/components/analysis/visualization-matrix-table";
import { cleanLabel } from "@/components/analysis/analytics-utils";
import {
  AnalyticsEmptyState,
  ChartInsightFooter,
  type ChartDensity,
  type ChartSizeTier,
} from "@/components/analysis/chart-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnalyticsInteractions } from "@/hooks/use-analytics-interactions";
import { useAnalyticsFilters, type AnalyticsFilterState } from "@/hooks/use-analytics-filters";
import { compareMonthLabels, compareQuarterLabels, compareYearLabels } from "@/lib/aggregates/quarter-buckets";
import {
  buildAnalyticsFacts,
  computeReportingCompleteness,
  type AnalyticsQueryContract,
} from "@/lib/analytics/query-builder";
import { resolveOrgScope } from "@/lib/analytics/org-scope";
import { useAuth } from "@/lib/contexts/auth-context";
import { formatDate } from "@/lib/date-utils";
import { useAllAggregates, useAllIndicators, useAllOrganizations, useAllProjects } from "@/lib/hooks/use-api";
import type { DashboardSetting } from "@/lib/api";
import type { Indicator, Organization } from "@/lib/types";
import { getUserOrganizationId } from "@/lib/utils/organization";
import {
  buildVisualizationResult,
  type DrilldownTarget,
  type NormalizedAggregateRecord,
  type VisualizationChart,
} from "@/lib/visualization/engine";

type DashboardAnalyticsSurfaceProps = {
  dashboard: DashboardSetting;
  onEditChart?: (draft: Partial<CustomAnalysisState>) => void;
};

type DashboardTabKey = "overview" | "comparison" | "trends" | "table";
type DashboardLayoutMode = "quad" | "focus";

type DashboardChartCardConfig = {
  id: string;
  title: string;
  description: string;
  chart: VisualizationChart | null;
  size: ChartSizeTier;
  footerText?: string | null;
};

const EMPTY_DATE_LABEL = "—";

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function sortPeriods(periods: string[], mode: AnalyticsFilterState["periodMode"]) {
  const deduped = Array.from(new Set(periods.filter(Boolean)));
  if (mode === "quarter") return deduped.sort(compareQuarterLabels);
  if (mode === "month") return deduped.sort(compareMonthLabels);
  if (mode === "year") return deduped.sort(compareYearLabels);
  return deduped.sort((left, right) => left.localeCompare(right));
}

function resolveAnalyticsProjectLabel(input: {
  projectId: string | null;
  projects: Array<{ id: string | number; name?: string }>;
  fallbackProjectName?: string | null;
}) {
  const { projectId, projects, fallbackProjectName } = input;
  if (projectId) {
    const match = projects.find((project) => String(project.id) === projectId);
    return match?.name || fallbackProjectName || `Project ${projectId}`;
  }
  return fallbackProjectName || "All Projects";
}

function resolveAnalyticsPeriodLabel(input: {
  selectedPeriods: string[];
  periodMode: AnalyticsFilterState["periodMode"];
  dateFrom: string;
  dateTo: string;
}) {
  const { selectedPeriods, periodMode, dateFrom, dateTo } = input;

  if (periodMode === "date-range") {
    const startLabel = formatDate(dateFrom);
    const endLabel = formatDate(dateTo);

    if (startLabel !== EMPTY_DATE_LABEL && endLabel !== EMPTY_DATE_LABEL) {
      return `${startLabel} - ${endLabel}`;
    }
    if (startLabel !== EMPTY_DATE_LABEL) return `From ${startLabel}`;
    if (endLabel !== EMPTY_DATE_LABEL) return `Until ${endLabel}`;
    return selectedPeriods[0] || "Selected Range";
  }

  const orderedPeriods = sortPeriods(selectedPeriods, periodMode);
  if (orderedPeriods.length === 0) {
    if (periodMode === "quarter") return "All Quarters";
    if (periodMode === "month") return "All Months";
    if (periodMode === "year") return "All Years";
    return "All Periods";
  }
  if (orderedPeriods.length === 1) return orderedPeriods[0];
  return `${orderedPeriods[0]} to ${orderedPeriods[orderedPeriods.length - 1]}`;
}

function resolveAnalyticsScopeLabel(input: {
  filters: AnalyticsFilterState;
  organizationsById: Map<string, Organization>;
  userOrgId: string;
}) {
  const { filters, organizationsById, userOrgId } = input;

  if (filters.scopeMode === "all_orgs") {
    return "All organizations";
  }

  if (filters.scopeMode === "parent_org" && filters.parentOrgId) {
    const label = organizationsById.get(filters.parentOrgId)?.name || `Org ${filters.parentOrgId}`;
    return `${label} + subgrantees`;
  }

  if (filters.selectedOrgIds.length > 0) {
    if (filters.selectedOrgIds.length === 1) {
      const onlyId = filters.selectedOrgIds[0];
      return organizationsById.get(onlyId)?.name || `Org ${onlyId}`;
    }
    return `${filters.selectedOrgIds.length} selected organizations`;
  }

  if (userOrgId) {
    return organizationsById.get(userOrgId)?.name || `Org ${userOrgId}`;
  }

  return "Organization scope";
}

function buildAnalyticsChartSubtitle(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" • ");
}

function buildIndicatorGroupOptions(indicators: Indicator[]) {
  const groups = new Map<string, string>();
  groups.set("all", "All indicator groups");

  indicators.forEach((indicator) => {
    const key = String(indicator.category || "").trim();
    if (!key || groups.has(key)) return;
    groups.set(
      key,
      key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    );
  });

  return Array.from(groups.entries()).map(([value, label]) => ({ value, label }));
}

function indicatorInGroup(indicator: Indicator, group: string) {
  if (group === "all") return true;
  return (
    normalizeText(indicator.category || "") === normalizeText(group) ||
    normalizeText(indicator.name).includes(normalizeText(group))
  );
}

function inferDisaggregationOptions(indicators: Indicator[]) {
  const options = new Map<string, string>();

  indicators.forEach((indicator) => {
    const dimensions = indicator.aggregate_disaggregation_config?.dimensions || [];

    if (dimensions.length > 0) {
      dimensions.forEach((dimension) => {
        const key = String(dimension.key || "").trim();
        const label = String(dimension.label || key).trim();
        if (!key || options.has(key)) return;
        options.set(key, label || key);
      });
      return;
    }

    (indicator.sub_labels || []).forEach((label) => {
      const key = slugify(String(label));
      if (!key || options.has(key)) return;
      options.set(key, String(label));
    });
  });

  return Array.from(options.entries()).map(([key, label]) => ({ key, label }));
}

function getRelevantInsight(insights: string[], keywords: string[]) {
  const match = insights.find((insight) =>
    keywords.some((keyword) => normalizeText(insight).includes(normalizeText(keyword))),
  );
  return match ?? insights[0] ?? null;
}

function SectionHeader(props: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  const { eyebrow, title, description } = props;

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {eyebrow}
      </div>
      <div className="text-xl font-semibold tracking-[-0.03em] text-foreground">{title}</div>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function DashboardChartCard(props: {
  config: DashboardChartCardConfig;
  density: ChartDensity;
  onEdit?: () => void;
  onDrilldown?: (target: DrilldownTarget) => void;
}) {
  const { config, density, onEdit } = props;

  const sizeClass =
    config.size === "large"
      ? "col-span-12"
      : config.size === "medium"
        ? "col-span-12 xl:col-span-6"
        : "col-span-12 md:col-span-6 xl:col-span-4";

  return (
    <Card className={sizeClass}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{config.title}</CardTitle>
          <CardDescription>{config.description}</CardDescription>
        </div>
        {onEdit ? (
          <Button size="icon" variant="ghost" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {config.chart ? (
          <SmartChartRenderer chart={config.chart} density={density} />
        ) : (
          <AnalyticsEmptyState
            title="No chart available"
            message="There is no visualization available for this section."
            compact
          />
        )}
        {config.footerText ? <ChartInsightFooter text={config.footerText} /> : null}
      </CardContent>
    </Card>
  );
}

function DashboardVisualizationPanels(props: {
  dashboardId: number;
  facts: NormalizedAggregateRecord["source"][];
  selectedIndicators: Indicator[];
  organizations: Organization[];
  organizationsById: Map<string, Organization>;
  scopedOrgIds: string[];
  currentOrgId: string | null;
  selectedPeriods: string[];
  filters: AnalyticsFilterState;
  projectId: string | null;
  selectedIndicatorIds: string[];
  headerSubtitle: string;
  onEditChart?: (draft: Partial<CustomAnalysisState>) => void;
}) {
  const {
    dashboardId,
    facts,
    selectedIndicators,
    organizations,
    organizationsById,
    scopedOrgIds,
    selectedPeriods,
    filters,
    projectId,
    headerSubtitle,
    onEditChart,
  } = props;

  const [activeTab, setActiveTab] = useState<DashboardTabKey>("overview");
  const [density, setDensity] = useState<ChartDensity>("normal");
  const [layoutMode, setLayoutMode] = useState<DashboardLayoutMode>("quad");

  const {
    interactionFilters,
    hasInteraction,
    applyInteraction,
    clearInteraction,
  } = useAnalyticsInteractions();

  const visualization = useMemo(
    () =>
      buildVisualizationResult({
        records: facts,
        dimensions: filters.disaggregationKeys,
        indicators: selectedIndicators,
        organizations,
        scopedOrgIds,
        selectedPeriods,
        periodMode: filters.periodMode,
        projectId,
        comparisonMode: filters.comparisonMode,
        drilldownFilters: interactionFilters,
        chartMode: "auto",
      }),
    [
      facts,
      filters.comparisonMode,
      filters.disaggregationKeys,
      filters.periodMode,
      interactionFilters,
      organizations,
      projectId,
      scopedOrgIds,
      selectedIndicators,
      selectedPeriods,
    ],
  );

  const completeness = useMemo(
    () =>
      computeReportingCompleteness({
        facts: visualization.normalizedRecords.map((record) => record.source),
        scopedOrgIds,
      }),
    [scopedOrgIds, visualization.normalizedRecords],
  );

  const handleDrilldown = (sourceChartId: string, target: DrilldownTarget) =>
    applyInteraction(sourceChartId, target);

  const draftPeriodMode: CustomAnalysisState["periodMode"] =
    filters.periodMode === "month"
      ? "month"
      : filters.periodMode === "date-range"
        ? "date-range"
        : "quarter";
  const draftCompareBy: CustomAnalysisState["compareBy"] =
    filters.comparisonMode === "period" ||
    filters.comparisonMode === "organization" ||
    filters.comparisonMode === "coordinator" ||
    filters.comparisonMode === "indicator"
      ? filters.comparisonMode
      : "none";

  const buildDraft = (): Partial<CustomAnalysisState> => ({
    indicatorIds: selectedIndicators.map((indicator) => String(indicator.id)),
    projectId: filters.projectId,
    periodMode: draftPeriodMode,
    selectedPeriods: [...selectedPeriods],
    selectedOrgIds: [...filters.selectedOrgIds],
    parentOrgId: filters.parentOrgId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    compareBy: draftCompareBy,
    breakDownBy: filters.disaggregationKeys[0] || "none",
    secondaryBreakdown: filters.disaggregationKeys[1] || "none",
    scopeMode: filters.scopeMode,
    useDashboardFilters: true,
  });

  const cards: DashboardChartCardConfig[] = [
    {
      id: "overview",
      title: visualization.overviewChart?.title || "Overview",
      description:
        visualization.overviewChart?.description ||
        "Automatically selected summary chart for the current reporting context.",
      chart: visualization.overviewChart,
      size: layoutMode === "focus" ? "large" : "medium",
      footerText: getRelevantInsight(visualization.insights ?? [], ["total", "overview", "share"]),
    },
    {
      id: "comparison",
      title: visualization.comparisonChart?.title || "Comparison",
      description:
        visualization.comparisonChart?.description ||
        "Compare indicators, organizations, or disaggregations.",
      chart: visualization.comparisonChart,
      size: "medium",
      footerText: getRelevantInsight(visualization.insights ?? [], ["highest", "organization", "comparison"]),
    },
    {
      id: "trend",
      title: visualization.trendChart?.title || "Trend",
      description:
        visualization.trendChart?.description ||
        "Time-based movement across the selected period range.",
      chart: visualization.trendChart,
      size: layoutMode === "focus" ? "large" : "medium",
      footerText: getRelevantInsight(visualization.insights ?? [], ["trend", "period", "increase", "decrease"]),
    },
  ];

  return (
    <>
      {/* KPI summary + subtitle bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
          <div className="flex items-center gap-2">
            {hasInteraction && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearInteraction}>
                <RotateCcw className="mr-1 h-3 w-3" />
                Clear drilldown
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setLayoutMode((v) => (v === "focus" ? "quad" : "focus"))}
            >
              {layoutMode === "focus" ? "Quad view" : "Focus view"}
            </Button>
          </div>
        </div>
        {(visualization.kpis?.length ?? 0) > 0 && (
          <KPIGrid items={visualization.kpis} />
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DashboardTabKey)}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <TabsList className="h-auto flex-wrap rounded-2xl border border-border bg-card p-1.5 shadow-sm md:w-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="comparison">Comparison</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
          </TabsList>
          <div className="text-xs text-muted-foreground">
            {layoutMode === "quad" ? "Quad view" : "Focus view"} |{" "}
            {density === "compact" ? "Compact mode" : "Normal mode"}
          </div>
        </div>

        <TabsContent value="overview" className="space-y-5">
          <SectionHeader
            eyebrow="Performance"
            title="Performance overview"
            description="Headline KPIs and the most important summary visuals for the current scope."
          />
          <div className="grid grid-cols-12 gap-5">
            {cards.slice(0, 2).map((card) => (
              <DashboardChartCard
                key={card.id}
                config={card}
                density={density}
                onEdit={onEditChart ? () => onEditChart(buildDraft()) : undefined}
                onDrilldown={(target) => handleDrilldown(card.id, target)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="comparison" className="space-y-5">
          <SectionHeader
            eyebrow="Comparison"
            title="Comparison analysis"
            description="Benchmark selected reporting units without overloading the screen."
          />
          <div className="grid grid-cols-12 gap-5">
            {cards
              .filter((card) => card.id === "comparison")
              .map((card) => (
                <DashboardChartCard
                  key={card.id}
                  config={card}
                  density={density}
                  onEdit={onEditChart ? () => onEditChart(buildDraft()) : undefined}
                  onDrilldown={(target) => handleDrilldown(card.id, target)}
                />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="trends" className="space-y-5">
          <SectionHeader
            eyebrow="Trends"
            title="Time series"
            description="Review reporting movement across time with a layout optimized for temporal interpretation."
          />
          <div className="grid grid-cols-12 gap-5">
            {cards
              .filter((card) => card.id === "trend")
              .map((card) => (
                <DashboardChartCard
                  key={card.id}
                  config={card}
                  density={density}
                  onEdit={onEditChart ? () => onEditChart(buildDraft()) : undefined}
                  onDrilldown={(target) => handleDrilldown(card.id, target)}
                />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="table" className="space-y-5">
          <SectionHeader
            eyebrow="Detailed Data"
            title="Matrix and audit detail"
            description="Validate the visual summaries with exportable tabular detail and raw aggregate records."
          />
          <VisualizationMatrixTable
            title={`Matrix: ${cleanLabel(visualization.table?.rowDimensionKey ?? "Rows")} x ${cleanLabel(visualization.table?.columnDimensionKey ?? "Columns")}`}
            description="This table is retained for QA review, reconciliation, and audit traceability."
            matrix={visualization.table?.matrix ?? null}
            exportBaseName={`dashboard_${dashboardId}_matrix`}
            insightText={getRelevantInsight(visualization.insights ?? [], ["total", "organization", "highest", "share"])}
          />

          <ReportingCompleteness
            title="Reporting completeness"
            summary={completeness}
            organizationsById={organizationsById}
          />

          <RawRecordsTable title="Raw aggregate records" records={visualization.table?.rawRows ?? []} />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function DashboardAnalyticsSurface(props: DashboardAnalyticsSurfaceProps) {
  const { dashboard, onEditChart } = props;
  const { user } = useAuth();
  const { filters, setFilters, resetFilters, saveFilters } = useAnalyticsFilters();

  const { data: projectsData } = useAllProjects();
  const { data: organizationsData } = useAllOrganizations();
  const { data: indicatorsData } = useAllIndicators();

  const aggregateFilters = useMemo(
    () => ({
      project:
        filters.projectId && filters.projectId !== "all"
          ? filters.projectId
          : dashboard.project
            ? String(dashboard.project)
            : undefined,
      date_from: filters.dateFrom || undefined,
      date_to: filters.dateTo || undefined,
      status: "approved",
    }),
    [dashboard.project, filters.dateFrom, filters.dateTo, filters.projectId],
  );

  const { data: aggregates = [], isLoading, error } = useAllAggregates(aggregateFilters);

  const projects = useMemo(
    () => (projectsData?.results || []) as Array<{ id: string | number; name?: string }>,
    [projectsData?.results],
  );
  const organizations = useMemo<Organization[]>(
    () => (organizationsData?.results || []) as Organization[],
    [organizationsData?.results],
  );
  const indicators = useMemo<Indicator[]>(
    () => (indicatorsData || []) as Indicator[],
    [indicatorsData],
  );

  const organizationsById = useMemo(
    () => new Map(organizations.map((org) => [String(org.id), org])),
    [organizations],
  );
  const indicatorsById = useMemo(
    () => new Map(indicators.map((indicator) => [String(indicator.id), indicator])),
    [indicators],
  );

  const groupOptions = useMemo(() => buildIndicatorGroupOptions(indicators), [indicators]);
  const groupedIndicators = useMemo(
    () =>
      indicators.filter((indicator) =>
        indicatorInGroup(indicator, filters.indicatorGroup || "all"),
      ),
    [filters.indicatorGroup, indicators],
  );

  const selectedIndicators = useMemo(() => {
    const explicit = indicators.filter((indicator) =>
      filters.indicatorIds.includes(String(indicator.id)),
    );
    return explicit.length > 0 ? explicit : groupedIndicators;
  }, [filters.indicatorIds, groupedIndicators, indicators]);

  const selectedIndicatorIds = useMemo(
    () => selectedIndicators.map((indicator) => String(indicator.id)),
    [selectedIndicators],
  );

  const disaggregationOptions = useMemo(
    () => inferDisaggregationOptions(selectedIndicators),
    [selectedIndicators],
  );

  const parentOrganizations = useMemo(
    () =>
      organizations.filter((organization) =>
        organizations.some((candidate) => candidate.parentId === organization.id),
      ),
    [organizations],
  );

  const userOrgId = useMemo(() => String(getUserOrganizationId(user) ?? ""), [user]);

  const scope = useMemo(
    () =>
      resolveOrgScope({
        organizations,
        scopeMode: filters.scopeMode,
        currentUserOrgId: userOrgId || null,
        parentOrgId: filters.parentOrgId || null,
        selectedOrgIds: filters.selectedOrgIds,
      }),
    [
      filters.parentOrgId,
      filters.scopeMode,
      filters.selectedOrgIds,
      organizations,
      userOrgId,
    ],
  );

  const scopedOrganizations = useMemo(
    () =>
      organizations.filter((organization) =>
        scope.resolvedOrgIds.includes(String(organization.id)),
      ),
    [organizations, scope.resolvedOrgIds],
  );

  const baseQuery = useMemo<AnalyticsQueryContract>(
    () => ({
      project_id: aggregateFilters.project || null,
      indicator_ids: selectedIndicatorIds,
      scope_mode: filters.scopeMode,
      parent_org_id: filters.parentOrgId || null,
      selected_org_ids: filters.selectedOrgIds,
      reporting_period_id: filters.reportingPeriodId || null,
      period_mode: filters.periodMode,
      date_from: filters.dateFrom || null,
      date_to: filters.dateTo || null,
      comparison_mode: filters.comparisonMode,
      disaggregation_keys: filters.disaggregationKeys,
      cascade_organization: filters.cascadeOrganization,
    }),
    [
      aggregateFilters.project,
      filters.cascadeOrganization,
      filters.comparisonMode,
      filters.dateFrom,
      filters.dateTo,
      filters.disaggregationKeys,
      filters.parentOrgId,
      filters.periodMode,
      filters.reportingPeriodId,
      filters.scopeMode,
      filters.selectedOrgIds,
      selectedIndicatorIds,
    ],
  );

  const baselineFacts = useMemo(
    () =>
      buildAnalyticsFacts({
        aggregates,
        organizationsById,
        indicatorsById,
        query: baseQuery,
        scopedOrgIds: scope.resolvedOrgIds,
      }),
    [aggregates, baseQuery, indicatorsById, organizationsById, scope.resolvedOrgIds],
  );

  const periodOptions = useMemo(
    () => sortPeriods(baselineFacts.map((fact) => fact.periodLabel), filters.periodMode),
    [baselineFacts, filters.periodMode],
  );

  const selectedPeriods = useMemo(() => {
    if (filters.periodMode === "date-range") {
      return [filters.reportingPeriodId || "Selected Range"];
    }
    if (filters.selectedPeriods.length > 0) return filters.selectedPeriods;
    if (filters.reportingPeriodId) return [filters.reportingPeriodId];
    return periodOptions;
  }, [
    filters.periodMode,
    filters.reportingPeriodId,
    filters.selectedPeriods,
    periodOptions,
  ]);

  const query = useMemo<AnalyticsQueryContract>(
    () => ({
      ...baseQuery,
      selected_periods: filters.periodMode === "date-range" ? [] : selectedPeriods,
      reporting_period_id:
        filters.periodMode === "date-range" ? selectedPeriods[0] : null,
    }),
    [baseQuery, filters.periodMode, selectedPeriods],
  );

  const facts = useMemo(
    () =>
      buildAnalyticsFacts({
        aggregates,
        organizationsById,
        indicatorsById,
        query,
        scopedOrgIds: scope.resolvedOrgIds,
      }),
    [aggregates, indicatorsById, organizationsById, query, scope.resolvedOrgIds],
  );

  const analyticsChartSubtitle = useMemo(
    () =>
      buildAnalyticsChartSubtitle([
        resolveAnalyticsProjectLabel({
          projectId: aggregateFilters.project || null,
          projects,
          fallbackProjectName: dashboard.project_name,
        }),
        resolveAnalyticsPeriodLabel({
          selectedPeriods,
          periodMode: filters.periodMode,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        }),
        resolveAnalyticsScopeLabel({
          filters,
          organizationsById,
          userOrgId,
        }),
      ]),
    [
      aggregateFilters.project,
      dashboard.project_name,
      filters,
      organizationsById,
      projects,
      selectedPeriods,
      userOrgId,
    ],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-border bg-card">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--green-primary)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Unable to load analytics data.
      </div>
    );
  }

  if (selectedIndicators.length === 0) {
    return (
      <section className="space-y-4">
        <CompactAnalyticsFilterBar
          filters={filters}
          projects={projects}
          organizations={organizations}
          indicators={groupedIndicators}
          periodOptions={periodOptions}
          indicatorGroupOptions={groupOptions}
          parentOrganizations={parentOrganizations}
          onChangeFilters={setFilters}
          onResetFilters={resetFilters}
          recordCount={facts.length}
        />
        <AnalyticsEmptyState
          title="No data found"
          message="No approved aggregate records match the current filters. Try changing the project, period, or organization scope."
        />
      </section>
    );
  }

  const drilldownResetKey = [
    dashboard.id,
    filters.projectId,
    filters.reportingPeriodId,
    filters.selectedPeriods.join("|"),
    filters.dateFrom,
    filters.dateTo,
    filters.scopeMode,
    filters.parentOrgId,
    filters.selectedOrgIds.join("|"),
    filters.indicatorIds.join("|"),
    filters.indicatorGroup,
    filters.disaggregationKeys.join("|"),
    filters.comparisonMode,
    String(filters.cascadeOrganization),
  ].join("::");

  return (
    <section className="space-y-8">
      <CompactAnalyticsFilterBar
        filters={filters}
        projects={projects}
        organizations={organizations}
        indicators={groupedIndicators}
        periodOptions={periodOptions}
        indicatorGroupOptions={groupOptions}
        parentOrganizations={parentOrganizations}
        onChangeFilters={setFilters}
        onResetFilters={resetFilters}
        recordCount={facts.length}
      />

      <DashboardVisualizationPanels
        key={drilldownResetKey}
        dashboardId={dashboard.id}
        facts={facts}
        selectedIndicators={selectedIndicators}
        organizations={organizations}
        organizationsById={organizationsById}
        scopedOrgIds={scope.resolvedOrgIds}
        currentOrgId={userOrgId || null}
        selectedPeriods={selectedPeriods}
        filters={filters}
        projectId={aggregateFilters.project || null}
        selectedIndicatorIds={selectedIndicatorIds}
        headerSubtitle={analyticsChartSubtitle}
        onEditChart={onEditChart}
      />
    </section>
  );
}
