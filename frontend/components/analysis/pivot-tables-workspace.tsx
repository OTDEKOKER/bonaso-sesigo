"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Download,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  Search,
  Table2,
  Trash2,
} from "lucide-react";

import { cleanLabel, formatAnalyticsValue, triggerBlobDownload, type BreakdownMap } from "@/components/analysis/analytics-utils";
import { SmartChartRenderer } from "@/components/analysis/smart-chart-renderer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  pivotTablesService,
  type ChartFieldName,
  type PivotTable,
  type PivotTableRequest,
} from "@/lib/api";
import { formatDate } from "@/lib/date-utils";
import {
  useAllIndicators,
  useAllOrganizations,
  useAllProjects,
  useDashboardMeta,
  usePivotTable,
  usePivotTables,
} from "@/lib/hooks/use-api";
import type { BarLikeChart } from "@/lib/visualization/engine";
import { cn } from "@/lib/utils";

const EMPTY_ITEMS: never[] = [];
const SEARCH_DEBOUNCE_MS = 300;
const PIVOT_CHART_COLORS = [
  "#1f6a8a",
  "#e67e22",
  "#2e8b57",
  "#9c2f92",
  "#f2b134",
  "#4472c4",
  "#0f4258",
  "#d1495b",
] as const;

type PivotTableDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: PivotTable, mode: "created" | "updated") => Promise<void> | void;
  existing?: PivotTable | null;
  backendUnavailable?: boolean;
};

type PivotMatrixCell = string | number | null;

type PivotTableFormState = {
  name: string;
  indicatorId: string;
  projectId: string;
  organizationId: string;
  cascadeOrganization: boolean;
  start: string;
  end: string;
  params: ChartFieldName[];
};

const DEFAULT_FORM_STATE: PivotTableFormState = {
  name: "",
  indicatorId: "",
  projectId: "all",
  organizationId: "all",
  cascadeOrganization: false,
  start: "",
  end: "",
  params: [],
};

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timeoutId);
  }, [delay, value]);

  return debouncedValue;
}

function getPivotIndicatorId(value: PivotTable | null | undefined) {
  if (!value) return "";
  return value.indicator ? String(value.indicator) : "";
}

function isBackendUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404 &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.toLowerCase().includes("not available on this backend")
  );
}

function getInitialFormState(existing?: PivotTable | null): PivotTableFormState {
  return {
    name: existing?.name || "",
    indicatorId: getPivotIndicatorId(existing),
    projectId: existing?.project ? String(existing.project) : "all",
    organizationId: existing?.organization ? String(existing.organization) : "all",
    cascadeOrganization: Boolean(existing?.cascade_organization),
    start: existing?.start || "",
    end: existing?.end || "",
    params: getPivotParamNames(existing).filter(Boolean) as ChartFieldName[],
  };
}

function normalizePivotMatrix(matrix: Array<Array<PivotMatrixCell>>) {
  const columnCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  return matrix.map((row) =>
    Array.from({ length: columnCount }, (_, index) => (index < row.length ? row[index] : null)),
  );
}

function getPivotParamNames(pivotTable: PivotTable | null | undefined) {
  if (!Array.isArray(pivotTable?.params)) return [];

  return pivotTable.params
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (typeof entry === "object" && entry !== null && "name" in entry) {
        return String((entry as { name?: unknown }).name ?? "");
      }
      return "";
    })
    .filter(Boolean);
}

function getPivotParamLabels(pivotTable: PivotTable | null | undefined) {
  if (!Array.isArray(pivotTable?.params)) return [];

  return pivotTable.params
    .map((entry) => {
      if (typeof entry === "string") return cleanLabel(entry);
      if (typeof entry === "object" && entry !== null && "label" in entry) {
        return String((entry as { label?: unknown }).label ?? "");
      }
      if (typeof entry === "object" && entry !== null && "name" in entry) {
        return cleanLabel(String((entry as { name?: unknown }).name ?? ""));
      }
      return "";
    })
    .filter(Boolean);
}

function normalizePivotLabel(value: unknown) {
  return cleanLabel(typeof value === "string" ? value : String(value ?? "")).toLowerCase();
}

function resolvePivotFieldName(header: PivotMatrixCell, columnIndex: number, paramNames: string[]) {
  if (columnIndex === 0) {
    return paramNames[0];
  }

  const normalizedHeader = normalizePivotLabel(header);
  if (!normalizedHeader) return undefined;

  return paramNames.find((param) => {
    const normalizedParam = normalizePivotLabel(param);
    return (
      normalizedParam === normalizedHeader ||
      normalizedHeader.includes(normalizedParam) ||
      normalizedParam.includes(normalizedHeader)
    );
  });
}

function isNumericPivotValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (!trimmed) return false;

  return /^-?\d+(?:[.,]\d+)?$/.test(trimmed.replace(/\s+/g, ""));
}

function inferPivotNumericColumns(rows: Array<Array<PivotMatrixCell>>) {
  if (rows.length === 0) return [];
  const columnCount = rows[0]?.length ?? 0;

  return Array.from({ length: columnCount }, (_, columnIndex) => {
    if (columnIndex === 0) return false;

    let nonEmptyCount = 0;
    let numericCount = 0;

    rows.forEach((row) => {
      const value = row[columnIndex];
      if (value === null || value === undefined || value === "") return;
      nonEmptyCount += 1;
      if (isNumericPivotValue(value)) {
        numericCount += 1;
      }
    });

    return nonEmptyCount > 0 && numericCount / nonEmptyCount >= 0.8;
  });
}

function formatPivotDisplayValue(
  value: PivotMatrixCell,
  options?: {
    field?: string | null;
    breakdowns?: BreakdownMap;
    numeric?: boolean;
  },
) {
  if (value === null || value === undefined || value === "") return "-";

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString();
  }

  if (options?.numeric && typeof value === "string") {
    const normalized = value.replace(/\s+/g, "");
    if (/^-?\d+(?:[.,]\d+)?$/.test(normalized)) {
      const parsed = Number(normalized.replace(",", "."));
      if (Number.isFinite(parsed)) {
        return parsed.toLocaleString();
      }
    }
  }

  return formatAnalyticsValue(value, options);
}

function formatPivotDateRange(pivotTable: PivotTable | null | undefined) {
  if (!pivotTable?.start && !pivotTable?.end) return "All dates";
  return `${formatDate(pivotTable?.start)} - ${formatDate(pivotTable?.end)}`;
}

function toPivotNumericValue(value: PivotMatrixCell) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;

  const normalized = value.replace(/\s+/g, "");
  if (!normalized) return 0;

  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  if (/^-?\d+(?:,\d+)?$/.test(normalized)) return Number(normalized.replace(",", "."));
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(normalized)) return Number(normalized.replace(/,/g, ""));
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(normalized)) {
    return Number(normalized.replace(/\./g, "").replace(",", "."));
  }

  return 0;
}

function buildPivotPreviewChart(input: {
  headerRow: Array<PivotMatrixCell>;
  bodyRows: Array<Array<PivotMatrixCell>>;
  numericColumns: boolean[];
  pivotParamNames: string[];
  dashboardBreakdowns?: BreakdownMap;
}): BarLikeChart | null {
  const { headerRow, bodyRows, numericColumns, pivotParamNames, dashboardBreakdowns } = input;
  if (headerRow.length < 2 || bodyRows.length === 0) return null;

  const numericColumnIndexes = headerRow
    .map((_, index) => index)
    .filter((index) => index > 0 && Boolean(numericColumns[index]));
  if (numericColumnIndexes.length === 0) return null;

  const firstColumnField = resolvePivotFieldName(headerRow[0] ?? null, 0, pivotParamNames);
  const series = numericColumnIndexes.map((columnIndex, seriesIndex) => ({
    key: `series_${seriesIndex}`,
    label: String(formatAnalyticsValue(headerRow[columnIndex])),
    color: PIVOT_CHART_COLORS[seriesIndex % PIVOT_CHART_COLORS.length],
  }));

  const data = bodyRows.map((row) => {
    const entry: Record<string, string | number> = {
      category: String(
        formatPivotDisplayValue(row[0], {
          field: firstColumnField,
          breakdowns: dashboardBreakdowns,
        }),
      ),
    };

    numericColumnIndexes.forEach((columnIndex, seriesIndex) => {
      entry[`series_${seriesIndex}`] = toPivotNumericValue(row[columnIndex] ?? null);
    });

    return entry;
  });

  return {
    kind: "grouped-bar",
    title: "Pivot chart preview",
    description: "Grouped comparison generated from numeric columns in this pivot output.",
    xKey: "category",
    yAxisLabel: "Reported value",
    data,
    series,
  };
}

function getPivotScopeLabel(pivotTable: PivotTable | null | undefined) {
  return (
    pivotTable?.organization_name ||
    pivotTable?.organization_detail?.name ||
    pivotTable?.project_name ||
    pivotTable?.project_detail?.name ||
    "All data"
  );
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: typeof Table2;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
          <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-3 text-primary">
          <Icon className="h-6 w-6" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatePanel({
  title,
  description,
  action,
  icon: Icon = Table2,
  variant = "default",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: typeof Table2;
  variant?: "default" | "error";
}) {
  return (
    <div
      className={cn(
        "flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-10 text-center",
        variant === "error" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div
        className={cn(
          "rounded-full border p-3 text-muted-foreground",
          variant === "error" && "border-destructive/30 text-destructive",
        )}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-1.5">
        <div className="text-lg font-semibold text-foreground">{title}</div>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function PivotTableListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border/70 p-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function PivotDetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border/70 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-5 w-2/3" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}

function PivotMatrixSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function PivotTableSettingsDialog(props: PivotTableDialogProps) {
  const { open, onOpenChange, onSaved, existing, backendUnavailable = false } = props;
  const { toast } = useToast();
  const { data: indicatorsData } = useAllIndicators();
  const { data: organizationsData } = useAllOrganizations();
  const { data: projectsData } = useAllProjects();
  const { data: dashboardMeta } = useDashboardMeta();

  const indicators = indicatorsData ?? EMPTY_ITEMS;
  const organizations = organizationsData?.results ?? EMPTY_ITEMS;
  const projects = projectsData?.results ?? EMPTY_ITEMS;
  const fieldOptions = dashboardMeta?.fields ?? EMPTY_ITEMS;

  const [form, setForm] = useState<PivotTableFormState>(DEFAULT_FORM_STATE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(getInitialFormState(existing));
    setSaving(false);
  }, [existing, open]);

  const selectedIndicator = useMemo(
    () => indicators.find((indicator) => String(indicator.id) === form.indicatorId),
    [form.indicatorId, indicators],
  );

  const visibleFieldOptions = useMemo(() => {
    if (!selectedIndicator) return fieldOptions;

    const allowsOptionField = Array.isArray(selectedIndicator.options) && selectedIndicator.options.length > 0;
    return fieldOptions.filter((field) => allowsOptionField || field.value !== "option");
  }, [fieldOptions, selectedIndicator]);

  const supportedFieldValues = useMemo(
    () => new Set(visibleFieldOptions.map((field) => field.value)),
    [visibleFieldOptions],
  );

  useEffect(() => {
    setForm((current) => {
      const nextParams = current.params.filter((param) => supportedFieldValues.has(param));
      return nextParams.length === current.params.length ? current : { ...current, params: nextParams };
    });
  }, [supportedFieldValues]);

  const hasInvalidDateRange = Boolean(form.start && form.end && form.start > form.end);

  const toggleParam = (value: ChartFieldName, checked: boolean) => {
    setForm((current) => {
      const nextParams = checked
        ? current.params.includes(value)
          ? current.params
          : [...current.params, value]
        : current.params.filter((item) => item !== value);

      return nextParams === current.params ? current : { ...current, params: nextParams };
    });
  };

  const handleSave = async () => {
    if (backendUnavailable) {
      toast({
        title: "Preview only",
        description: "Pivot tables are not available on this backend yet.",
      });
      return;
    }

    if (!form.indicatorId) {
      toast({
        title: "Indicator required",
        description: "Choose an indicator before saving this pivot table.",
        variant: "destructive",
      });
      return;
    }

    if (hasInvalidDateRange) {
      toast({
        title: "Invalid date range",
        description: "The start date must be earlier than or equal to the end date.",
        variant: "destructive",
      });
      return;
    }

    const payload: PivotTableRequest = {
      name: form.name.trim() || null,
      indicator: Number(form.indicatorId),
      project: form.projectId !== "all" ? Number(form.projectId) : null,
      organization: form.organizationId !== "all" ? Number(form.organizationId) : null,
      cascade_organization: form.organizationId !== "all" ? form.cascadeOrganization : false,
      params: form.params,
      start: form.start || null,
      end: form.end || null,
    };

    setSaving(true);
    try {
      const saved = existing?.id
        ? await pivotTablesService.update(existing.id, payload)
        : await pivotTablesService.create(payload);

      await onSaved(saved, existing?.id ? "updated" : "created");
      onOpenChange(false);

      toast({
        title: existing?.id ? "Pivot table updated" : "Pivot table created",
        description: saved.display_name || saved.name || selectedIndicator?.name || "Saved view",
      });
    } catch (error) {
      if (!isBackendUnavailable(error)) {
        console.error("Failed to save pivot table", error);
      }

      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unable to save this pivot table.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing?.id ? "Edit Pivot Table" : "New Pivot Table"}</DialogTitle>
          <DialogDescription>Save a reusable indicator table with scoped filters and supported breakdowns.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          {backendUnavailable ? (
            <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              Pivot tables are available in preview mode only because this backend does not yet support saving them.
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="pivot-name">Name</Label>
            <Input
              id="pivot-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Quarterly HIV status by sex"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Indicator</Label>
              <Select
                value={form.indicatorId}
                onValueChange={(value) => setForm((current) => ({ ...current, indicatorId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select indicator" />
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

            <div className="grid gap-2">
              <Label>Project</Label>
              <Select
                value={form.projectId}
                onValueChange={(value) => setForm((current) => ({ ...current, projectId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All projects" />
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
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Organization</Label>
              <Select
                value={form.organizationId}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    organizationId: value,
                    cascadeOrganization: value === "all" ? false : current.cascadeOrganization,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All organizations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All organizations</SelectItem>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={String(organization.id)}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Date Range</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={form.start}
                  onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))}
                />
                <Input
                  type="date"
                  value={form.end}
                  onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))}
                />
              </div>
              {hasInvalidDateRange ? (
                <p className="text-xs text-destructive">The end date must be the same as or later than the start date.</p>
              ) : null}
            </div>
          </div>

          {form.organizationId !== "all" ? (
            <label className="flex items-center gap-3 rounded-xl border border-border px-3 py-3 text-sm">
              <Checkbox
                checked={form.cascadeOrganization}
                onCheckedChange={(checked) =>
                  setForm((current) => ({ ...current, cascadeOrganization: checked === true }))
                }
              />
              <span>Include subgrantees</span>
            </label>
          ) : null}

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Breakdowns</Label>
              <Badge variant="outline">{form.params.length} selected</Badge>
            </div>
            <ScrollArea className="h-48 rounded-xl border border-border">
              {visibleFieldOptions.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  No supported breakdowns are available for the selected indicator.
                </div>
              ) : (
                <div className="grid gap-2 p-3 sm:grid-cols-2">
                  {visibleFieldOptions.map((field) => (
                    <label
                      key={field.value}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={form.params.includes(field.value)}
                        onCheckedChange={(checked) => toggleParam(field.value, checked === true)}
                      />
                      <span>{field.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || backendUnavailable || hasInvalidDateRange || !form.indicatorId}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {existing?.id ? "Save Changes" : "Save Pivot Table"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PivotTablesWorkspace() {
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const debouncedSearch = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  const isSearchPending = searchInput.trim() !== debouncedSearch;

  const {
    data: pivotTablesData,
    mutate: mutatePivotTables,
    isLoading: listLoading,
    error: listError,
  } = usePivotTables({
    search: debouncedSearch || undefined,
    page,
  });
  const {
    data: selectedPivotTable,
    mutate: mutateSelectedPivotTable,
    isLoading: detailLoading,
    error: detailError,
  } = usePivotTable(selectedId);
  const dashboardBreakdowns = undefined;

  const pivotTablesUnavailable = isBackendUnavailable(listError);
  const pivotTables = pivotTablesData?.results ?? EMPTY_ITEMS;
  const totalCount = pivotTablesData?.count ?? 0;
  const hasNextPage = Boolean(pivotTablesData?.next);
  const hasPrevPage = Boolean(pivotTablesData?.previous);
  const selectedListItem = pivotTables.find((table) => table.id === selectedId) ?? null;
  const selectedPivotDetail = selectedPivotTable?.id === selectedId ? selectedPivotTable : null;
  const selectedPivotOverview = selectedPivotDetail ?? selectedListItem ?? null;

  const detailPending = Boolean(selectedId) && (detailLoading || (!selectedPivotDetail && !detailError));
  const detailUnavailable = isBackendUnavailable(detailError);

  useEffect(() => {
    if (listLoading) return;

    if (pivotTables.length === 0) {
      if (!selectedPivotDetail) {
        setSelectedId(null);
      }
      return;
    }

    if (!selectedId) {
      setSelectedId(pivotTables[0].id);
      return;
    }

    const selectedVisible = pivotTables.some((table) => table.id === selectedId);
    if (!selectedVisible && !selectedPivotDetail && !detailPending) {
      setSelectedId(pivotTables[0].id);
    }
  }, [detailPending, listLoading, pivotTables, selectedId, selectedPivotDetail]);

  const dataMatrix = useMemo(
    () => (Array.isArray(selectedPivotDetail?.data) ? normalizePivotMatrix(selectedPivotDetail.data) : []),
    [selectedPivotDetail?.data],
  );
  const headerRow = useMemo<Array<PivotMatrixCell>>(() => dataMatrix[0] ?? [], [dataMatrix]);
  const bodyRows = useMemo(() => dataMatrix.slice(1), [dataMatrix]);
  const pivotParamNames = useMemo(() => getPivotParamNames(selectedPivotDetail), [selectedPivotDetail]);
  const paramLabels = useMemo(() => getPivotParamLabels(selectedPivotOverview), [selectedPivotOverview]);
  const numericColumns = useMemo(() => inferPivotNumericColumns(bodyRows), [bodyRows]);
  const pivotPreviewChart = useMemo(
    () =>
      buildPivotPreviewChart({
        headerRow,
        bodyRows,
        numericColumns,
        pivotParamNames,
        dashboardBreakdowns,
      }),
    [bodyRows, dashboardBreakdowns, headerRow, numericColumns, pivotParamNames],
  );
  const selectedScopeLabel = getPivotScopeLabel(selectedPivotOverview);

  const handleSaved = async (saved: PivotTable, mode: "created" | "updated") => {
    setSelectedId(saved.id);

    if (mode === "updated" && saved.id === selectedId) {
      await Promise.all([mutatePivotTables(), mutateSelectedPivotTable()]);
      return;
    }

    await mutatePivotTables();
  };

  const handleDelete = async () => {
    if (!selectedId) return;

    const currentIndex = pivotTables.findIndex((table) => table.id === selectedId);
    const fallbackSelection = pivotTables[currentIndex + 1]?.id ?? pivotTables[currentIndex - 1]?.id ?? null;

    setDeleting(true);
    try {
      await pivotTablesService.delete(selectedId);
      setDeleteConfirmOpen(false);
      setSelectedId(fallbackSelection);
      await mutatePivotTables();

      toast({
        title: "Pivot table deleted",
        description: "The saved pivot table has been removed.",
      });
    } catch (error) {
      console.error("Failed to delete pivot table", error);
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Unable to delete this pivot table.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedId) return;

    setDownloading(true);
    try {
      const blob = await pivotTablesService.download(selectedId);
      const safeName = (selectedPivotOverview?.display_name || selectedPivotOverview?.name || "pivot_table")
        .replace(/[^a-z0-9_-]+/gi, "_")
        .slice(0, 60);

      triggerBlobDownload(blob, `${safeName || "pivot_table"}.csv`);
    } catch (error) {
      console.error("Failed to download pivot table", error);
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Unable to download this pivot table.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleCreateRequest = () => {
    if (pivotTablesUnavailable) {
      toast({
        title: "Preview only",
        description: "Pivot tables are not available on this backend yet.",
      });
      return;
    }

    setCreateOpen(true);
  };

  const handleEditRequest = () => {
    if (!selectedPivotOverview || detailPending) return;

    if (pivotTablesUnavailable || detailUnavailable) {
      toast({
        title: "Preview only",
        description: "This pivot table can be viewed, but editing is not supported on this backend.",
      });
      return;
    }

    setEditOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Build reusable indicator cross-tabs for repeat analysis, QA review, and export.
          </p>
        </div>
        <Button onClick={handleCreateRequest}>
          <Plus className="mr-2 h-4 w-4" />
          New Pivot Table
        </Button>
      </div>

      {pivotTablesUnavailable ? (
        <Card className="border-border/70 bg-muted/40">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              Pivot table saving is not available on this backend. Existing previews can still be reviewed when returned by
              the API.
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Saved Views"
          value={totalCount}
          description="Reusable pivot definitions available to the current workspace."
          icon={Table2}
        />
        <MetricCard
          title="Active Breakdowns"
          value={paramLabels.length}
          description="Breakdown dimensions applied to the currently selected definition."
          icon={Layers3}
        />
        <MetricCard
          title="Selected Scope"
          value={selectedScopeLabel}
          description={selectedPivotOverview ? formatPivotDateRange(selectedPivotOverview) : "Choose a saved view to inspect its scope."}
          icon={Search}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit border-border/70 shadow-sm">
          <CardHeader className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Your Pivot Tables</CardTitle>
                <CardDescription>Saved indicator views for consistent review and export.</CardDescription>
              </div>
              <Badge variant="outline">{totalCount}</Badge>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setPage(1);
                }}
                placeholder="Search pivot tables..."
                className="pl-9 pr-9"
              />
              {isSearchPending ? (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {listLoading && pivotTables.length === 0 ? (
              <PivotTableListSkeleton />
            ) : listError && !pivotTablesUnavailable && pivotTables.length === 0 ? (
              <StatePanel
                icon={AlertCircle}
                title="Unable to load pivot tables"
                description="The saved pivot table list could not be loaded. Retry the request to continue."
                variant="error"
                action={
                  <Button variant="outline" size="sm" onClick={() => void mutatePivotTables()}>
                    Retry
                  </Button>
                }
              />
            ) : pivotTables.length === 0 ? (
              <StatePanel
                title={debouncedSearch ? "No matching pivot tables" : "No pivot tables yet"}
                description={
                  debouncedSearch
                    ? `No saved pivot tables matched "${debouncedSearch}". Adjust the search or create a new one.`
                    : "Create a reusable pivot table to compare indicator results across supported breakdowns."
                }
                action={
                  !debouncedSearch && !pivotTablesUnavailable ? (
                    <Button size="sm" onClick={handleCreateRequest}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create pivot table
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="space-y-2">
                  {pivotTables.map((table) => {
                    const isSelected = selectedId === table.id;

                    return (
                      <button
                        key={table.id}
                        type="button"
                        onClick={() => setSelectedId(table.id)}
                        aria-pressed={isSelected}
                        className={cn(
                          "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border hover:border-primary/40 hover:bg-muted/40",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {table.display_name || table.name || "Pivot Table"}
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {table.indicator_name || table.indicator_detail?.display_name || table.indicator_detail?.name || "Indicator pivot"}
                            </div>
                          </div>
                          {isSelected ? <Badge variant="secondary">Open</Badge> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <Button variant="outline" size="sm" onClick={() => setPage((value) => value - 1)} disabled={!hasPrevPage}>
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">Page {page}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={!hasNextPage}>
                    Next
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          {!selectedId ? (
            <Card className="border-dashed border-border/80 shadow-sm">
              <CardContent className="p-0">
                <StatePanel
                  title="Select or create a pivot table"
                  description="Pivot tables turn indicator data into structured cross-tab views that teams can review and export on demand."
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-border/70 shadow-sm">
                <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{selectedPivotOverview?.display_name || selectedPivotOverview?.name || "Pivot Table"}</CardTitle>
                      {selectedPivotOverview?.indicator_name ? (
                        <Badge variant="outline">{selectedPivotOverview.indicator_name}</Badge>
                      ) : null}
                    </div>
                    <CardDescription>Configuration summary, scope, and export actions for the selected view.</CardDescription>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={handleEditRequest} disabled={!selectedPivotOverview || detailPending}>
                      {detailPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
                      Edit
                    </Button>
                    <Button variant="outline" onClick={handleDownload} disabled={downloading}>
                      {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                      Download CSV
                    </Button>
                    <Button variant="ghost" onClick={() => setDeleteConfirmOpen(true)} disabled={deleting}>
                      {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      Delete
                    </Button>
                  </div>
                </CardHeader>

                <CardContent>
                  {detailPending && !selectedPivotDetail ? (
                    <PivotDetailSkeleton />
                  ) : detailError && !detailUnavailable && !selectedPivotDetail ? (
                    <StatePanel
                      icon={AlertCircle}
                      title="Unable to load this pivot table"
                      description="The selected pivot table could not be retrieved. Retry the request or choose another saved view."
                      variant="error"
                      action={
                        <Button variant="outline" size="sm" onClick={() => void mutateSelectedPivotTable()}>
                          Retry
                        </Button>
                      }
                    />
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Indicator</div>
                        <div className="mt-2 font-medium text-foreground">
                          {selectedPivotOverview?.indicator_name ||
                            selectedPivotOverview?.indicator_detail?.display_name ||
                            selectedPivotOverview?.indicator_detail?.name ||
                            "-"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Breakdowns</div>
                        <div className="mt-2 font-medium text-foreground">
                          {paramLabels.length ? paramLabels.join(", ") : "None"}
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Date Range</div>
                        <div className="mt-2 font-medium text-foreground">{formatPivotDateRange(selectedPivotOverview)}</div>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scope</div>
                        <div className="mt-2 font-medium text-foreground">
                          {selectedScopeLabel}
                          {selectedPivotOverview?.cascade_organization ? " + subgrantees" : ""}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle>Data Preview</CardTitle>
                  <CardDescription>
                    Live output for the selected pivot table. Scroll horizontally and vertically to review the full matrix.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {detailPending ? (
                    <PivotMatrixSkeleton />
                  ) : detailError && !detailUnavailable && headerRow.length === 0 ? (
                    <StatePanel
                      icon={AlertCircle}
                      title="Unable to load data preview"
                      description="The pivot matrix could not be loaded. Retry the request or select another saved view."
                      variant="error"
                      action={
                        <Button variant="outline" size="sm" onClick={() => void mutateSelectedPivotTable()}>
                          Retry
                        </Button>
                      }
                    />
                  ) : headerRow.length === 0 ? (
                    <StatePanel
                      title="No data available"
                      description="This pivot table returned no rows for the current filters. Edit the definition to widen the scope or change the breakdowns."
                    />
                  ) : (
                    <div className="space-y-4">
                      {pivotPreviewChart ? (
                        <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
                          <SmartChartRenderer chart={pivotPreviewChart} size="medium" density="compact" />
                        </div>
                      ) : null}

                      <div className="overflow-hidden rounded-xl border border-border bg-background">
                        <ScrollArea className="h-[min(72vh,38rem)] w-full">
                          <div className="min-w-max">
                            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
                              <thead>
                                <tr>
                                  {headerRow.map((header, index) => (
                                    <th
                                      key={`${String(header)}-${index}`}
                                      className={cn(
                                        "min-w-[8rem] border-b border-r border-border px-3 py-4 text-center align-middle text-sm font-medium leading-snug text-foreground",
                                        index === 0
                                          ? "sticky left-0 top-0 z-40 min-w-[10rem] bg-muted/95 backdrop-blur"
                                          : "sticky top-0 z-30 bg-muted/95 backdrop-blur",
                                      )}
                                    >
                                      <span className="block whitespace-normal break-words">
                                        {formatAnalyticsValue(header)}
                                      </span>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {bodyRows.map((row, rowIndex) => (
                                  <tr
                                    key={`row-${rowIndex}`}
                                    className={rowIndex % 2 === 0 ? "bg-background" : "bg-muted/20"}
                                  >
                                    {row.map((cell, columnIndex) => {
                                      const fieldName = resolvePivotFieldName(
                                        headerRow[columnIndex] ?? null,
                                        columnIndex,
                                        pivotParamNames,
                                      );
                                      const isNumericColumn = Boolean(numericColumns[columnIndex]);

                                      if (columnIndex === 0) {
                                        return (
                                          <th
                                            key={`cell-${rowIndex}-${columnIndex}`}
                                            scope="row"
                                            className="sticky left-0 z-20 min-w-[10rem] border-b border-r border-border bg-background px-3 py-2.5 text-center align-middle font-medium text-foreground"
                                          >
                                            <span className="block whitespace-normal break-words leading-snug">
                                              {formatPivotDisplayValue(cell, {
                                                field: fieldName,
                                                breakdowns: dashboardBreakdowns,
                                              })}
                                            </span>
                                          </th>
                                        );
                                      }

                                      return (
                                        <td
                                          key={`cell-${rowIndex}-${columnIndex}`}
                                          className={cn(
                                            "border-b border-r border-border px-3 py-2.5 align-middle text-sm text-foreground",
                                            isNumericColumn ? "text-right tabular-nums" : "text-left",
                                          )}
                                        >
                                          <span className="block whitespace-normal break-words leading-snug">
                                            {formatPivotDisplayValue(cell, {
                                              field: fieldName,
                                              breakdowns: dashboardBreakdowns,
                                              numeric: isNumericColumn,
                                            })}
                                          </span>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <ScrollBar orientation="horizontal" />
                          <ScrollBar orientation="vertical" />
                        </ScrollArea>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <PivotTableSettingsDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={handleSaved}
        backendUnavailable={pivotTablesUnavailable}
      />
      <PivotTableSettingsDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={handleSaved}
        existing={selectedPivotOverview}
        backendUnavailable={pivotTablesUnavailable || detailUnavailable}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pivot table?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved pivot table definition. The underlying source data will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
