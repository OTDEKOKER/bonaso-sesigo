"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Check, Clock3, Eye, Flag, FolderKanban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { FlagModal } from "@/components/flags/FlagModal";
import { ConfirmDelete } from "@/components/reuseables";
import { useToast } from "@/hooks/use-toast";
import {
  AYP_BAND_LABEL,
  buildEmptyEntryMatrix,
  buildEntryMatrixPayload,
  buildDisplayMatrix,
  computeEntryMatrixTotal,
  computeAyp,
  getAggregateTotal,
  getBandsForTotals,
  getAggregateEntryMatrixConfig,
  getDisaggregates,
  getIndicatorDisaggregateGroups,
  getPeriodLabel,
  getPrimaryDisaggregateLabel,
  isValidDateRange,
  normalizeMatrixDisaggregatesForIndicator,
  parseNumberInput,
  parseAggregateValue,
  sumBands,
  toSafeNumber,
  type IndicatorDisaggregationInput,
  type MatrixInputValues,
} from "@/lib/aggregates/aggregate-helpers";
import type { Aggregate, AggregateHistoryEntry } from "@/lib/types";

type AggregateReviewQueueProps = {
  items: Aggregate[];
  indicatorNameById: Map<string, string>;
  indicatorById: Map<string, IndicatorDisaggregationInput>;
  projectNameById: Map<string, string>;
  projects: Array<{ id: string | number; name: string }>;
  organizations: Array<{ id: string | number; name: string }>;
  indicators: Array<{ id: string | number; name: string; code?: string }>;
  onReview: (aggregateId: string, notes: string) => Promise<void>;
  onApprove: (aggregateId: string) => Promise<void>;
  onFlag: (
    aggregateId: string,
    payload: {
      reason: "duplicate" | "incorrect_data" | "suspicious" | "incomplete" | "other";
      description: string;
      severity: "low" | "medium" | "high";
    },
  ) => Promise<void>;
  onApproveAll: (aggregateIds: string[]) => Promise<void>;
  onUpdate: (
    aggregateId: string,
    payload: {
      indicator: number;
      project: number;
      organization: number;
      period_start: string;
      period_end: string;
      notes: string;
      value: unknown;
    },
  ) => Promise<Aggregate>;
  onDelete: (aggregateId: string) => Promise<void>;
  actingAggregateId: string | null;
  actingReviewAction: "review" | "approve" | "bulk_approve" | "flag" | "delete" | null;
  mode?: "review" | "correction";
  embedded?: boolean;
  initialReviewAggregateId?: string | null;
  canBulkApproveAll?: boolean;
  // When false, this is the first-tier reviewer (M&E Officer): they may mark
  // rows as "reviewed" but cannot approve / flag / bulk-approve / delete.
  // Defaults to true to preserve existing manager/admin behaviour.
  canApprove?: boolean;
};

const statusLabelMap: Record<Aggregate["status"], string> = {
  draft: "Draft",
  pending: "Pending review",
  reviewed: "Reviewed",
  flagged: "Flagged",
  approved: "Approved",
  rejected: "Rejected",
};

const flagReasonOptions = [
  { value: "incorrect_data", label: "Incorrect Data" },
  { value: "incomplete", label: "Incomplete Information" },
  { value: "duplicate", label: "Duplicate Entry" },
  { value: "suspicious", label: "Suspicious Values" },
  { value: "other", label: "Other" },
];

type CorrectionDraft = {
  total: string;
  matrixValues: MatrixInputValues;
  indicatorId: string;
  projectId: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  notes: string;
};

const emptyCorrectionDraft: CorrectionDraft = {
  total: "",
  matrixValues: {},
  indicatorId: "",
  projectId: "",
  organizationId: "",
  periodStart: "",
  periodEnd: "",
  notes: "",
};

const historyActionLabel: Record<AggregateHistoryEntry["action"], string> = {
  submitted: "Submitted",
  corrected: "Corrected",
  reviewed: "Reviewed",
  flagged: "Flagged",
  approved: "Approved",
};

function formatHistoryValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getLatestFlagEntry(aggregate: Aggregate | null): AggregateHistoryEntry | null {
  if (!aggregate?.history_entries?.length) return null;

  return [...aggregate.history_entries]
    .reverse()
    .find((entry) => entry.action === "flagged") ?? null;
}

function buildCorrectionDraft(
  aggregate: Aggregate,
  indicatorById: Map<string, IndicatorDisaggregationInput>,
): CorrectionDraft {
  const indicator = indicatorById.get(String(aggregate.indicator));
  const config = getAggregateEntryMatrixConfig(indicator);
  const parsedValue = parseAggregateValue(aggregate.value);
  const nextMatrix = buildEmptyEntryMatrix(config);

  if (config.hasDisaggregates) {
    for (const primaryValue of config.primaryValues) {
      for (const secondaryValue of config.secondaryValues) {
        for (const bandValue of config.bandValues) {
          const rawValue = parsedValue.disaggregates?.[primaryValue]?.[secondaryValue]?.[bandValue];
          nextMatrix[primaryValue][secondaryValue][bandValue] =
            rawValue === undefined || rawValue === null ? "" : String(rawValue);
        }
      }
    }
  }

  return {
    total:
      config.hasDisaggregates
        ? ""
        : parsedValue.total !== undefined
          ? String(parsedValue.total)
          : String(getAggregateTotal(aggregate) || ""),
    matrixValues: config.hasDisaggregates ? nextMatrix : {},
    indicatorId: String(aggregate.indicator),
    projectId: String(aggregate.project),
    organizationId: String(aggregate.organization),
    periodStart: aggregate.period_start || "",
    periodEnd: aggregate.period_end || "",
    notes: aggregate.notes || "",
  };
}

export function AggregateReviewQueue(props: AggregateReviewQueueProps) {
  const { toast } = useToast();
  const {
    items,
    indicatorNameById,
    indicatorById,
    projectNameById,
    projects,
    organizations,
    indicators,
    onReview,
    onApprove,
    onApproveAll,
    onFlag,
    onUpdate,
    onDelete,
    actingAggregateId,
    actingReviewAction,
    mode = "review",
    embedded = false,
    initialReviewAggregateId = null,
    canBulkApproveAll = false,
    canApprove: canApproveRows = true,
  } = props;

  const initialReviewAggregate =
    initialReviewAggregateId
      ? items.find((item) => String(item.id) === initialReviewAggregateId) ?? null
      : null;
  const initialCorrectionDraft = initialReviewAggregate
    ? buildCorrectionDraft(initialReviewAggregate, indicatorById)
    : emptyCorrectionDraft;

  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [organizationFilter, setOrganizationFilter] = useState("all");
  const [reviewingAggregate, setReviewingAggregate] = useState<Aggregate | null>(initialReviewAggregate);
  const [isManualEditMode, setIsManualEditMode] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [flaggingAggregate, setFlaggingAggregate] = useState<Aggregate | null>(null);
  const [correctionTotal, setCorrectionTotal] = useState(initialCorrectionDraft.total);
  const [correctionMatrixValues, setCorrectionMatrixValues] = useState<MatrixInputValues>(
    initialCorrectionDraft.matrixValues,
  );
  const [correctionIndicatorId, setCorrectionIndicatorId] = useState(initialCorrectionDraft.indicatorId);
  const [correctionProjectId, setCorrectionProjectId] = useState(initialCorrectionDraft.projectId);
  const [correctionOrganizationId, setCorrectionOrganizationId] = useState(
    initialCorrectionDraft.organizationId,
  );
  const [correctionPeriodStart, setCorrectionPeriodStart] = useState(initialCorrectionDraft.periodStart);
  const [correctionPeriodEnd, setCorrectionPeriodEnd] = useState(initialCorrectionDraft.periodEnd);
  const [correctionNotes, setCorrectionNotes] = useState(initialCorrectionDraft.notes);

  const projectOptions = useMemo(
    () =>
      Array.from(
        new Map(
          items.map((item) => [
            String(item.project),
            item.project_name || projectNameById.get(String(item.project)) || "Project",
          ]),
        ).entries(),
      ).sort((left, right) => left[1].localeCompare(right[1])),
    [items, projectNameById],
  );

  const organizationOptions = useMemo(
    () =>
      Array.from(
        new Map(
          items.map((item) => [String(item.organization), item.organization_name || "Organization"]),
        ).entries(),
      ).sort((left, right) => left[1].localeCompare(right[1])),
    [items],
  );

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return items.filter((item) => {
      if (projectFilter !== "all" && String(item.project) !== projectFilter) return false;
      if (organizationFilter !== "all" && String(item.organization) !== organizationFilter) {
        return false;
      }

      if (!query) return true;

      const indicatorId = String(item.indicator || "");
      const indicatorLabel =
        item.indicator_name || indicatorNameById.get(indicatorId) || "Indicator";
      const indicatorCode = String(item.indicator_code || "");
      const projectLabel =
        item.project_name || projectNameById.get(String(item.project)) || "Project";
      const organizationLabel = item.organization_name || "Organization";
      const periodLabel = getPeriodLabel(item);
      const notes = item.notes || "";

      return [indicatorLabel, indicatorCode, indicatorId, projectLabel, organizationLabel, periodLabel, notes].some((value) =>
        value.toLowerCase().includes(query),
      );
    });
  }, [
    indicatorNameById,
    items,
    organizationFilter,
    projectFilter,
    projectNameById,
    searchQuery,
  ]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 || projectFilter !== "all" || organizationFilter !== "all";
  const bulkApproveableItems = filteredItems.filter(
    (item) => item.status === "pending" || item.status === "reviewed",
  );
  const canShowBulkApproveAll =
    canApproveRows && Boolean(canBulkApproveAll) && mode === "review" && bulkApproveableItems.length > 0;

  const activeCorrectionConfig = useMemo(() => {
    if (!reviewingAggregate) return null;
    const activeIndicatorId =
      reviewingAggregate.status === "flagged" && correctionIndicatorId
        ? correctionIndicatorId
        : String(reviewingAggregate.indicator);
    const indicator = indicatorById.get(String(activeIndicatorId));
    return getAggregateEntryMatrixConfig(indicator);
  }, [correctionIndicatorId, indicatorById, reviewingAggregate]);

  const isCorrectionMode =
    mode === "correction" || reviewingAggregate?.status === "flagged" || isManualEditMode;
  const latestFlagEntry = useMemo(
    () => getLatestFlagEntry(reviewingAggregate),
    [reviewingAggregate],
  );

  const loadCorrectionDraft = (aggregate: Aggregate) => {
    const draft = buildCorrectionDraft(aggregate, indicatorById);
    setCorrectionIndicatorId(draft.indicatorId);
    setCorrectionProjectId(draft.projectId);
    setCorrectionOrganizationId(draft.organizationId);
    setCorrectionPeriodStart(draft.periodStart);
    setCorrectionPeriodEnd(draft.periodEnd);
    setCorrectionNotes(draft.notes);
    setCorrectionMatrixValues(draft.matrixValues);
    setCorrectionTotal(draft.total);
  };

  const handleReviewSubmit = async () => {
    if (!reviewingAggregate) return;
    await onReview(String(reviewingAggregate.id), reviewNotes);
    setReviewingAggregate(null);
    setIsManualEditMode(false);
    setReviewNotes("");
  };

  const handleCorrectionSubmit = async () => {
    if (!reviewingAggregate || !activeCorrectionConfig) return;
    if (!isValidDateRange(correctionPeriodStart, correctionPeriodEnd)) {
      toast({
        title: "Invalid reporting period",
        description: "Period end must be on or after period start.",
        variant: "destructive",
      });
      return;
    }

    let nextValue: unknown;
    if (activeCorrectionConfig.hasDisaggregates) {
      nextValue = {
        total: computeEntryMatrixTotal(correctionMatrixValues, activeCorrectionConfig),
        disaggregates: buildEntryMatrixPayload(correctionMatrixValues, activeCorrectionConfig),
      };
    } else {
      const parsed = parseNumberInput(correctionTotal);
      if (parsed === undefined) {
        toast({
          title: "Invalid total",
          description: "Provide a valid finite total before saving corrections.",
          variant: "destructive",
        });
        return;
      }
      nextValue = { total: parsed };
    }

    const updated = await onUpdate(String(reviewingAggregate.id), {
      indicator: Number(correctionIndicatorId),
      project: Number(correctionProjectId),
      organization: Number(correctionOrganizationId),
      period_start: correctionPeriodStart,
      period_end: correctionPeriodEnd,
      notes: correctionNotes,
      value: nextValue,
    });
    if (mode === "correction") {
      setReviewingAggregate(null);
      setIsManualEditMode(false);
      setReviewNotes("");
      return;
    }

    setReviewingAggregate(updated);
    setIsManualEditMode(false);
    setReviewNotes("");
    loadCorrectionDraft(updated);
  };

  const handleCorrectionCellChange = (
    primaryValue: string,
    secondaryValue: string,
    bandValue: string,
    value: string,
  ) => {
    setCorrectionMatrixValues((previous) => ({
      ...previous,
      [primaryValue]: {
        ...previous[primaryValue],
        [secondaryValue]: {
          ...previous[primaryValue]?.[secondaryValue],
          [bandValue]: value,
        },
      },
    }));
  };

  const renderAggregatePreview = (aggregate: Aggregate) => {
    const indicator = indicatorById.get(String(aggregate.indicator));
    const disaggregates = getDisaggregates(aggregate.value);
    const config = getAggregateEntryMatrixConfig(indicator);
    const editable =
      isCorrectionMode &&
      Boolean(reviewingAggregate) &&
      String(reviewingAggregate?.id) === String(aggregate.id);

    if (!disaggregates) {
      return (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Captured total</p>
              <p className="text-sm text-muted-foreground">
                {aggregate.organization_name || "Organization"} | {getPeriodLabel(aggregate)}
              </p>
            </div>
            {editable ? (
              <div className="w-full max-w-xs space-y-2">
                <Label htmlFor="aggregate-inline-correction-total" className="text-xs text-muted-foreground">
                  Total
                </Label>
                <Input
                  id="aggregate-inline-correction-total"
                  type="number"
                  value={correctionTotal}
                  onChange={(event) => setCorrectionTotal(event.target.value)}
                  className="h-10"
                />
              </div>
            ) : (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-2xl font-semibold">{getAggregateTotal(aggregate).toLocaleString()}</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    const indicatorGroups = getIndicatorDisaggregateGroups(indicator);
    const primaryDisaggregateLabel = getPrimaryDisaggregateLabel(indicator);
    const alignedDisaggregates = normalizeMatrixDisaggregatesForIndicator(
      disaggregates,
      indicator,
    );
    const { matrix, keyPops, secondDimensionValues, ageBands, showAypColumn } =
      buildDisplayMatrix(alignedDisaggregates, indicatorGroups);
    const safeDimensions = secondDimensionValues.length ? secondDimensionValues : ["All"];
    const safeAgeBands = ageBands.length ? ageBands : ["Value"];
    const totalBands = getBandsForTotals(safeAgeBands);
    const showSecondaryColumn = !(
      config.secondaryValues.length === 1 && config.secondaryValues[0] === "All"
    );

    if (editable && config.hasDisaggregates) {
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Correct submitted data</p>
              <p className="text-sm text-muted-foreground">
                {aggregate.organization_name || "Organization"} | {getPeriodLabel(aggregate)}
              </p>
            </div>
            <Badge variant="outline">
              Total {computeEntryMatrixTotal(correctionMatrixValues, config).toLocaleString()}
            </Badge>
          </div>

          <div className="w-full overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[680px] border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky top-0 z-20 border-b border-r border-border bg-muted/90 px-1.5 py-1 text-left font-semibold">
                    {config.primaryLabel}
                  </th>
                  {showSecondaryColumn ? (
                    <th className="sticky top-0 z-20 border-b border-r border-border bg-muted/90 px-1.5 py-1 text-left font-semibold">
                      {config.secondaryLabel}
                    </th>
                  ) : null}
                  {config.bandValues.map((bandValue) => (
                    <th
                      key={bandValue}
                      className="sticky top-0 z-10 border-b border-r border-border bg-muted/90 px-1.5 py-1 text-center font-semibold whitespace-nowrap"
                    >
                      {bandValue}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {config.primaryValues.map((primaryValue) =>
                  config.secondaryValues.map((secondaryValue) => (
                    <tr key={`${primaryValue}-${secondaryValue}`} className="bg-background">
                      <td className="border-b border-r border-border px-1.5 py-1 font-medium whitespace-nowrap">
                        {primaryValue}
                      </td>
                      {showSecondaryColumn ? (
                        <td className="border-b border-r border-border px-1.5 py-1 whitespace-nowrap">
                          {secondaryValue}
                        </td>
                      ) : null}
                      {config.bandValues.map((bandValue) => (
                        <td
                          key={`${primaryValue}-${secondaryValue}-${bandValue}`}
                          className="border-b border-r border-border px-1 py-0.5"
                        >
                          <Input
                            type="number"
                            value={
                              correctionMatrixValues[primaryValue]?.[secondaryValue]?.[bandValue] ??
                              ""
                            }
                            onChange={(event) =>
                              handleCorrectionCellChange(
                                primaryValue,
                                secondaryValue,
                                bandValue,
                                event.target.value,
                              )
                            }
                            className="h-8 min-w-[72px] px-2 text-center shadow-sm"
                          />
                        </td>
                      ))}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Captured data table</p>
            <p className="text-sm text-muted-foreground">
              {aggregate.organization_name || "Organization"} | {getPeriodLabel(aggregate)}
            </p>
          </div>
          <Badge variant="outline">Total {getAggregateTotal(aggregate).toLocaleString()}</Badge>
        </div>
        <div className="max-h-[420px] overflow-auto rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky top-0 z-20 border-b border-r border-border bg-muted/90 px-2 py-1 text-left font-semibold">
                  {primaryDisaggregateLabel}
                </th>
                <th className="sticky top-0 z-20 border-b border-r border-border bg-muted/90 px-2 py-1 text-left font-semibold">
                  {config.secondaryLabel}
                </th>
                {safeAgeBands.map((band) => (
                  <th
                    key={band}
                    className="sticky top-0 z-10 border-b border-r border-border bg-muted/90 px-2 py-1 text-center font-semibold whitespace-nowrap"
                  >
                    {band}
                  </th>
                ))}
                <th className="sticky top-0 z-10 border-b border-r border-border bg-muted/90 px-2 py-1 text-center font-semibold">
                  TOTAL
                </th>
                {showAypColumn ? (
                  <th className="sticky top-0 z-10 border-b border-r border-border bg-muted/90 px-2 py-1 text-center font-semibold whitespace-nowrap">
                    {AYP_BAND_LABEL}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {keyPops.map((kp, kpIndex) => {
                const kpData = matrix[kp] || {};
                return safeDimensions.map((dimension, dimensionIndex) => {
                  const values = kpData[dimension] || {};
                  const total = sumBands(values, totalBands);
                  const ayp = showAypColumn ? computeAyp(values) : 0;
                  const rowBaseClass =
                    (kpIndex * safeDimensions.length + dimensionIndex) % 2 === 0
                      ? "bg-background"
                      : "bg-muted/10";

                  return (
                    <tr key={`${kp}-${dimension}`} className={rowBaseClass}>
                      {dimensionIndex === 0 ? (
                        <td
                          className={`border-b border-r border-border px-2 py-1 font-medium ${rowBaseClass}`}
                          rowSpan={safeDimensions.length}
                        >
                          {kp}
                        </td>
                      ) : null}
                      <td className={`border-b border-r border-border px-2 py-1 ${rowBaseClass}`}>
                        {dimension}
                      </td>
                      {safeAgeBands.map((band) => (
                        <td
                          key={`${kp}-${dimension}-${band}`}
                          className={`border-b border-r border-border px-2 py-1 text-center ${rowBaseClass}`}
                        >
                          {editable && config.hasDisaggregates ? (
                            <Input
                              type="number"
                              value={correctionMatrixValues[kp]?.[dimension]?.[band] ?? ""}
                              onChange={(event) =>
                                handleCorrectionCellChange(kp, dimension, band, event.target.value)
                              }
                              className="h-8 min-w-[72px] border-0 bg-transparent px-1 text-center shadow-none"
                            />
                          ) : (
                            toSafeNumber(values[band]).toLocaleString()
                          )}
                        </td>
                      ))}
                      <td className={`border-b border-r border-border px-2 py-1 text-center font-semibold ${rowBaseClass}`}>
                        {editable && config.hasDisaggregates
                          ? sumBands(
                              Object.fromEntries(
                                Object.entries(correctionMatrixValues[kp]?.[dimension] || {}).map(
                                  ([bandKey, bandValue]) => [bandKey, Number(bandValue) || 0],
                                ),
                              ),
                              totalBands,
                            ).toLocaleString()
                          : total.toLocaleString()}
                      </td>
                      {showAypColumn ? (
                        <td className={`border-b border-r border-border px-2 py-1 text-center ${rowBaseClass}`}>
                          {editable && config.hasDisaggregates
                            ? computeAyp(
                                Object.fromEntries(
                                  Object.entries(correctionMatrixValues[kp]?.[dimension] || {}).map(
                                    ([bandKey, bandValue]) => [bandKey, Number(bandValue) || 0],
                                  ),
                                ),
                              ).toLocaleString()
                            : ayp.toLocaleString()}
                        </td>
                      ) : null}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderHistory = (aggregate: Aggregate) => {
    const historyEntries = aggregate.history_entries || [];

    return (
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <p className="text-sm font-semibold">Change history</p>
          <p className="text-sm text-muted-foreground">
            Track what changed, when it changed, and who made each step in the review cycle.
          </p>
        </div>

        {historyEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            No change history has been recorded for this aggregate yet.
          </div>
        ) : (
          <div className="space-y-3">
            {historyEntries.map((entry) => {
              const changes = Object.entries(entry.changes || {});
              return (
                <div key={entry.id} className="rounded-xl border border-border/80 bg-muted/10 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {historyActionLabel[entry.action] || entry.action}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {entry.changed_by_name || "System"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {entry.comment ? (
                    <p className="mt-3 text-sm leading-relaxed text-foreground/90">{entry.comment}</p>
                  ) : null}

                  {changes.length > 0 ? (
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {changes.map(([fieldName, change]) => (
                        <div key={`${entry.id}-${fieldName}`} className="rounded-lg border border-border/70 bg-background px-3 py-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {change.label || fieldName}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            From: <span className="font-medium text-foreground">{formatHistoryValue(change.from)}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            To: <span className="font-medium text-foreground">{formatHistoryValue(change.to)}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const content = (
    <>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          {mode === "correction"
            ? "No flagged aggregates need correction right now."
            : "No aggregates are waiting for review."}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/15 p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Filter queue</p>
                <p className="text-xs text-muted-foreground">
                  {filteredItems.length} of {items.length} queued
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canShowBulkApproveAll ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-border bg-background px-3 text-foreground hover:bg-muted"
                    disabled={Boolean(actingAggregateId)}
                    onClick={async () => {
                      const ids = bulkApproveableItems.map((item) => String(item.id));
                      const confirmed = window.confirm(
                        `Approve all ${ids.length} queued aggregate${ids.length === 1 ? "" : "s"}? ` +
                          "Pending and reviewed rows will be approved. Flagged rows are skipped.",
                      );
                      if (!confirmed) return;

                      await onApproveAll(ids);
                    }}
                  >
                    {actingReviewAction === "bulk_approve"
                      ? "Approving..."
                      : `Approve all (${bulkApproveableItems.length})`}
                  </Button>
                ) : null}

                {hasActiveFilters ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground"
                    onClick={() => {
                      setSearchQuery("");
                      setProjectFilter("all");
                      setOrganizationFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="min-w-0 space-y-1.5 md:col-span-2 xl:col-span-1">
                <p className="text-sm font-medium">Search</p>
                <Input
                  placeholder="Search indicator, project, organization, notes..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="h-9 w-full min-w-0 bg-background"
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <p className="text-sm font-medium">Project</p>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="h-9 w-full min-w-0 bg-background">
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {projectOptions.map(([projectId, projectName]) => (
                      <SelectItem key={projectId} value={projectId}>
                        {projectName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0 space-y-1.5">
                <p className="text-sm font-medium">Organization</p>
                <Select value={organizationFilter} onValueChange={setOrganizationFilter}>
                  <SelectTrigger className="h-9 w-full min-w-0 bg-background">
                    <SelectValue placeholder="All organizations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All organizations</SelectItem>
                    {organizationOptions.map(([organizationId, organizationName]) => (
                      <SelectItem key={organizationId} value={organizationId}>
                        {organizationName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              {mode === "correction"
                ? "No flagged aggregates match the selected filters."
                : "No queued reviews match the selected filters."}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => {
                const aggregateId = String(item.id);
                const isReviewing =
                  actingAggregateId === aggregateId && actingReviewAction === "review";
                const isApproving =
                  actingAggregateId === aggregateId && actingReviewAction === "approve";
                const isFlagging =
                  actingAggregateId === aggregateId && actingReviewAction === "flag";
                const isDeleting =
                  actingAggregateId === aggregateId && actingReviewAction === "delete";
                const canApprove = item.status === "reviewed";
                const canReview = item.status === "pending" || item.status === "flagged";
                const latestItemFlagEntry = getLatestFlagEntry(item);

                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium leading-tight">
                          {item.indicator_name ||
                            indicatorNameById.get(String(item.indicator)) ||
                            "Indicator"}
                        </p>
                        <Badge variant="outline">{statusLabelMap[item.status] || item.status}</Badge>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {item.organization_name || "Organization"} |{" "}
                        {item.project_name ||
                          projectNameById.get(String(item.project)) ||
                          "Project"}{" "}
                        | {getPeriodLabel(item)}
                      </p>
                      {item.notes ? (
                        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                          {item.notes}
                        </p>
                      ) : null}
                      {latestItemFlagEntry?.comment ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                          <p className="font-medium">Latest coordinator feedback</p>
                          <p className="line-clamp-2 leading-relaxed">{latestItemFlagEntry.comment}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 lg:shrink-0">
                      {mode === "correction" ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setReviewingAggregate(item);
                            setIsManualEditMode(false);
                            setReviewNotes("");
                            loadCorrectionDraft(item);
                          }}
                          disabled={Boolean(actingAggregateId)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          {isReviewing ? "Opening..." : "Review & Correct"}
                        </Button>
                      ) : (
                        <>
                          {canReview ? (
                            <Button
                              variant="outline"
                              onClick={() => {
                                setReviewingAggregate(item);
                                setIsManualEditMode(false);
                                setReviewNotes("");
                                loadCorrectionDraft(item);
                              }}
                              disabled={Boolean(actingAggregateId)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              {isReviewing ? "Reviewing..." : "Review"}
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            onClick={() => setFlaggingAggregate(item)}
                            disabled={Boolean(actingAggregateId)}
                          >
                            <Flag className="mr-2 h-4 w-4" />
                            {isFlagging ? "Flagging..." : "Flag"}
                          </Button>
                          {canApproveRows ? (
                            <Button
                              onClick={() => void onApprove(aggregateId)}
                              disabled={Boolean(actingAggregateId) || !canApprove}
                            >
                              <Check className="mr-2 h-4 w-4" />
                              {isApproving ? "Approving..." : "Approve"}
                            </Button>
                          ) : null}
                          <Button
                            variant="destructive"
                            onClick={() => {
                              setReviewingAggregate(item);
                              setIsDeleteConfirmOpen(true);
                            }}
                            disabled={Boolean(actingAggregateId)}
                          >
                            {isDeleting ? "Deleting..." : "Delete"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={Boolean(reviewingAggregate)}
        onOpenChange={(open) => {
          if (!open) {
            setReviewingAggregate(null);
            setIsManualEditMode(false);
            setReviewNotes("");
          }
        }}
      >
        <DialogContent className="fixed inset-0 !top-0 !left-0 !translate-x-0 !translate-y-0 !flex !h-screen !w-screen !max-w-none !flex-col overflow-hidden rounded-none border-0 bg-background p-0">
          <DialogHeader className="border-b border-border/70 bg-background/95 px-8 py-5 backdrop-blur">
            <DialogTitle className="text-2xl">
              {mode === "correction" ? "Correct Flagged Aggregate" : "Review Aggregate"}
            </DialogTitle>
            <DialogDescription>
              {mode === "correction"
                ? "Review the coordinator feedback, update the record, and resubmit it for approval."
                : "Confirm this aggregate has been checked before it can be approved."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-8 py-6">
                <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-semibold tracking-tight">
                          {reviewingAggregate?.indicator_name ||
                            (reviewingAggregate
                              ? indicatorNameById.get(String(reviewingAggregate.indicator))
                              : "")}
                        </h2>
                        {reviewingAggregate ? (
                          <Badge variant="outline">
                            {statusLabelMap[reviewingAggregate.status] || reviewingAggregate.status}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                        {mode === "correction"
                          ? "This record was flagged for correction. Update the submitted values, confirm the reporting details, and resubmit it when the record is ready for another coordinator review."
                          : isManualEditMode
                            ? "Edit the submitted values directly, save the corrections, and then mark the record reviewed when everything is correct."
                          : "Review the submitted aggregate values, confirm the reporting period and source context, then record your review notes before marking it reviewed."}
                      </p>
                    </div>
                    {reviewingAggregate ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {isCorrectionMode ? (
                          <>
                            <div className="min-w-[200px] rounded-xl border border-border bg-muted/20 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <FolderKanban className="h-3.5 w-3.5" />
                                Indicator
                              </div>
                              <Select value={correctionIndicatorId} onValueChange={setCorrectionIndicatorId}>
                                <SelectTrigger className="h-9 bg-background">
                                  <SelectValue placeholder="Select indicator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {indicators.map((indicatorOption) => (
                                    <SelectItem key={indicatorOption.id} value={String(indicatorOption.id)}>
                                      {indicatorOption.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="min-w-[200px] rounded-xl border border-border bg-muted/20 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <FolderKanban className="h-3.5 w-3.5" />
                                Project
                              </div>
                              <Select value={correctionProjectId} onValueChange={setCorrectionProjectId}>
                                <SelectTrigger className="h-9 bg-background">
                                  <SelectValue placeholder="Select project" />
                                </SelectTrigger>
                                <SelectContent>
                                  {projects.map((projectOption) => (
                                    <SelectItem key={projectOption.id} value={String(projectOption.id)}>
                                      {projectOption.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="min-w-[200px] rounded-xl border border-border bg-muted/20 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                Submitted by
                              </div>
                              <Select
                                value={correctionOrganizationId}
                                onValueChange={setCorrectionOrganizationId}
                              >
                                <SelectTrigger className="h-9 bg-background">
                                  <SelectValue placeholder="Select organization" />
                                </SelectTrigger>
                                <SelectContent>
                                  {organizations.map((organizationOption) => (
                                    <SelectItem
                                      key={organizationOption.id}
                                      value={String(organizationOption.id)}
                                    >
                                      {organizationOption.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="min-w-[200px] rounded-xl border border-border bg-muted/20 p-3 sm:col-span-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <CalendarRange className="h-3.5 w-3.5" />
                                Period
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <Label htmlFor="review-period-start" className="text-xs text-muted-foreground">
                                    Period start
                                  </Label>
                                  <Input
                                    id="review-period-start"
                                    type="date"
                                    value={correctionPeriodStart}
                                    onChange={(event) => setCorrectionPeriodStart(event.target.value)}
                                    className="h-9 bg-background"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="review-period-end" className="text-xs text-muted-foreground">
                                    Period end
                                  </Label>
                                  <Input
                                    id="review-period-end"
                                    type="date"
                                    value={correctionPeriodEnd}
                                    onChange={(event) => setCorrectionPeriodEnd(event.target.value)}
                                    className="h-9 bg-background"
                                  />
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="min-w-[180px] rounded-xl border border-border bg-muted/20 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <FolderKanban className="h-3.5 w-3.5" />
                                Project
                              </div>
                              <p className="text-sm font-medium">
                                {reviewingAggregate.project_name ||
                                  projectNameById.get(String(reviewingAggregate.project)) ||
                                  "Project"}
                              </p>
                            </div>
                            <div className="min-w-[180px] rounded-xl border border-border bg-muted/20 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <CalendarRange className="h-3.5 w-3.5" />
                                Period
                              </div>
                              <p className="text-sm font-medium">{getPeriodLabel(reviewingAggregate)}</p>
                            </div>
                            <div className="min-w-[180px] rounded-xl border border-border bg-muted/20 p-3">
                              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                Submitted by
                              </div>
                              <p className="text-sm font-medium">
                                {reviewingAggregate.organization_name || "Organization"}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </section>

                {latestFlagEntry?.comment ? (
                  <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-amber-950">Latest coordinator feedback</p>
                      <p className="text-sm leading-relaxed text-amber-950/90">
                        {latestFlagEntry.comment}
                      </p>
                      <p className="text-xs text-amber-900/80">
                        {latestFlagEntry.changed_by_name || "Coordinator"} |{" "}
                        {new Date(latestFlagEntry.created_at).toLocaleString()}
                      </p>
                    </div>
                  </section>
                ) : null}

                {reviewingAggregate ? renderAggregatePreview(reviewingAggregate) : null}
                {reviewingAggregate ? renderHistory(reviewingAggregate) : null}

                <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <div className="mb-3">
                    <p className="text-sm font-semibold">
                      {isCorrectionMode
                        ? mode === "correction"
                          ? "Resubmission notes"
                          : isManualEditMode
                            ? "Edit notes"
                          : "Correction notes"
                        : "Review notes"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {isCorrectionMode
                        ? mode === "correction"
                          ? "Add any context about what you changed before you send the record back for review."
                          : isManualEditMode
                            ? "Add a short note about the changes you made before returning to review."
                          : "Update the values directly in the table above, then leave any correction notes here before saving."
                        : "Record the checks you performed or anything the next reviewer should know."}
                    </p>
                  </div>
                  <Textarea
                    rows={6}
                    placeholder={
                      isCorrectionMode
                        ? mode === "correction"
                          ? "Summarize the fixes you made before resubmitting"
                          : isManualEditMode
                            ? "Describe the edits you made"
                          : "Add correction notes for the resubmission"
                        : "Add review notes for the coordinator record"
                    }
                    value={isCorrectionMode ? correctionNotes : reviewNotes}
                    onChange={(event) =>
                      isCorrectionMode
                        ? setCorrectionNotes(event.target.value)
                        : setReviewNotes(event.target.value)
                    }
                    className="min-h-36 resize-y"
                  />
                </section>
              </div>
            </div>
            <DialogFooter className="sticky bottom-0 border-t border-border/70 bg-background/95 px-8 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
              <Button
                variant="outline"
                onClick={() => {
                  setReviewingAggregate(null);
                  setReviewNotes("");
                }}
                disabled={Boolean(actingAggregateId)}
              >
                Cancel
              </Button>
              {mode === "review" ? (
                <Button
                  variant="destructive"
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  disabled={Boolean(actingAggregateId)}
                >
                  Delete Record
                </Button>
              ) : null}
              {isCorrectionMode ? (
                <>
                  {mode === "review" && reviewingAggregate?.status !== "flagged" ? (
                    <Button
                      variant="outline"
                      onClick={() => setIsManualEditMode(false)}
                      disabled={Boolean(actingAggregateId)}
                    >
                      Back to Review
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => void handleCorrectionSubmit()}
                    disabled={Boolean(actingAggregateId)}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    {mode === "correction" ? "Save Changes & Resubmit" : "Save Corrections"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!reviewingAggregate) return;
                      loadCorrectionDraft(reviewingAggregate);
                      setIsManualEditMode(true);
                    }}
                    disabled={Boolean(actingAggregateId)}
                  >
                    Edit Record
                  </Button>
                  <Button
                    onClick={() => void handleReviewSubmit()}
                    disabled={Boolean(actingAggregateId)}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    Mark Reviewed
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <FlagModal
        isOpen={Boolean(flaggingAggregate)}
        onClose={() => setFlaggingAggregate(null)}
        title="Flag Aggregate for Correction"
        reasonOptions={flagReasonOptions}
        requireDescription
        onSubmit={async (data) => {
          if (!flaggingAggregate) return;
          await onFlag(String(flaggingAggregate.id), {
            reason: data.reason as
              | "duplicate"
              | "incorrect_data"
              | "suspicious"
              | "incomplete"
              | "other",
            description: data.description,
            severity: data.severity,
          });
          setFlaggingAggregate(null);
        }}
      />

      <ConfirmDelete
        isOpen={isDeleteConfirmOpen}
        name={
          reviewingAggregate?.indicator_name ||
          (reviewingAggregate
            ? indicatorNameById.get(String(reviewingAggregate.indicator)) || `Aggregate #${reviewingAggregate.id}`
            : "this aggregate")
        }
        requireConfirmText
        confirmText="delete"
        title="Delete Aggregate Record"
        description="Delete this aggregate record permanently? Type delete to confirm. This action cannot be undone."
        destructiveText="Delete Record"
        onCancel={() => setIsDeleteConfirmOpen(false)}
        onConfirm={async () => {
          if (!reviewingAggregate) return;
          await onDelete(String(reviewingAggregate.id));
          setIsDeleteConfirmOpen(false);
          setReviewingAggregate(null);
          setIsManualEditMode(false);
          setReviewNotes("");
        }}
      />
    </>
  );

  if (embedded) {
    return <div>{content}</div>;
  }

  return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock3 className="h-5 w-5" />
            {mode === "correction" ? "Corrections Required" : "Review Queue"}
          </CardTitle>
          <CardDescription>
            {mode === "correction"
              ? "Flagged aggregate submissions that need updates before a coordinator can approve them."
              : "Pending and reviewed aggregate submissions that need coordinator action."}
          </CardDescription>
        </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
