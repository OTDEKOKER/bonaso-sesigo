"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { aggregatesService } from "@/lib/api";
import type { AggregateChartPoint, AggregateChartSeries } from "@/components/aggregates/AggregateChartDialog";
import {
  buildDisplayMatrix,
  getAggregateTotal,
  getBandsForTotals,
  getIndicatorDisaggregateGroups,
  getPeriodLabel,
  mergeDisaggregatesForGroup,
  normalizeMatrixDisaggregatesForIndicator,
  resolveParentOrganizationId,
  sumBands,
  toSafeNumber,
  type AggregateIndicatorGroup,
  type IndicatorDisaggregationInput,
} from "@/lib/aggregates/aggregate-helpers";
import {
  getEffectiveOrganizationType,
  isBonasoOrganizationName,
  isSeedCoordinatorOrganizationName,
} from "@/lib/organization-hierarchy";
import { isPlatformAdmin } from "@/lib/permissions";
import type { Aggregate, User } from "@/lib/types";
import { getUserOrganizationId } from "@/lib/utils/organization";

type UserLike = User | null | undefined;

export type OrganizationWithParent = {
  id: string | number;
  name?: string;
  type?: string;
  parentId?: string | number | null;
  parent?: string | number | null;
};

export type AggregateEntryDraft = {
  total: string;
  matrixValues: Record<string, Record<string, Record<string, string>>>;
};

const AGGREGATE_ENTRY_DRAFT_STORAGE_KEY = "bonaso:aggregate-entry-draft:v1";

type AggregateEntryFormSnapshot = {
  formProject: string;
  formOrganization: string;
  selectedIndicatorIds: string[];
  indicatorDrafts: Record<string, AggregateEntryDraft>;
  formPeriodStart: string;
  formPeriodEnd: string;
  formNotes: string;
  formDataSource: string;
};

function sanitizeAggregateEntrySnapshot(
  raw: unknown,
): AggregateEntryFormSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<AggregateEntryFormSnapshot>;
  const selectedIndicatorIds = Array.isArray(value.selectedIndicatorIds)
    ? value.selectedIndicatorIds
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    : [];

  const indicatorDraftsInput =
    value.indicatorDrafts && typeof value.indicatorDrafts === "object"
      ? value.indicatorDrafts
      : {};
  const indicatorDrafts: Record<string, AggregateEntryDraft> = {};

  for (const [indicatorId, draft] of Object.entries(indicatorDraftsInput)) {
    if (!draft || typeof draft !== "object") continue;
    const typedDraft = draft as Partial<AggregateEntryDraft>;
    const total = String(typedDraft.total || "");
    const matrixValues =
      typedDraft.matrixValues && typeof typedDraft.matrixValues === "object"
        ? (typedDraft.matrixValues as AggregateEntryDraft["matrixValues"])
        : {};
    indicatorDrafts[String(indicatorId)] = { total, matrixValues };
  }

  return {
    formProject: String(value.formProject || ""),
    formOrganization: String(value.formOrganization || ""),
    selectedIndicatorIds,
    indicatorDrafts,
    formPeriodStart: String(value.formPeriodStart || ""),
    formPeriodEnd: String(value.formPeriodEnd || ""),
    formNotes: String(value.formNotes || ""),
    formDataSource: String(value.formDataSource || ""),
  };
}

function hasAggregateEntrySnapshotContent(snapshot: AggregateEntryFormSnapshot): boolean {
  return Boolean(
    snapshot.formProject ||
      snapshot.formOrganization ||
      snapshot.formPeriodStart ||
      snapshot.formPeriodEnd ||
      snapshot.formNotes ||
      snapshot.formDataSource ||
      snapshot.selectedIndicatorIds.length > 0 ||
      Object.keys(snapshot.indicatorDrafts).length > 0,
  );
}

type ToastFn = (payload: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => void;

const coordinatorOrganizationTypes = new Set([
  "coordinator",
  "senior_coordinator",
  "headquarters",
  "regional",
  "district",
]);

function isCoordinatorPortfolioOrganization(organization: OrganizationWithParent): boolean {
  const organizationName = String(organization.name || "");
  return (
    getEffectiveOrganizationType(organization) === "coordinator" ||
    isSeedCoordinatorOrganizationName(organizationName)
  );
}

function isBonasoRootOrganization(organization: OrganizationWithParent): boolean {
  return isBonasoOrganizationName(String(organization.name || ""));
}

function collectDescendantOrganizationIds(
  rootId: string,
  childrenByParentId: Map<string, string[]>,
): Set<string> {
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    for (const childId of childrenByParentId.get(currentId) || []) {
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    }
  }
  return visited;
}

type AggregateVisibilityScopeArgs = {
  organizations: OrganizationWithParent[];
  user: UserLike;
};

export function useAggregateVisibilityScope(args: AggregateVisibilityScopeArgs) {
  const { organizations, user } = args;
  const userOrganizationId = useMemo(() => getUserOrganizationId(user), [user]);
  const canReportAcrossOrganizations = useMemo(() => isPlatformAdmin(user), [user]);
  const canReviewAggregates = Boolean(user && (isPlatformAdmin(user) || user.role === "manager"));
  const ownOrganizationId = userOrganizationId ? String(userOrganizationId) : "";

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, string[]>();
    organizations.forEach((organization) => {
      const organizationId = String(organization.id);
      const parentId = resolveParentOrganizationId(organization);
      if (!parentId) return;
      const children = map.get(parentId) || [];
      children.push(organizationId);
      map.set(parentId, children);
    });
    return map;
  }, [organizations]);

  const ownOrganization = useMemo(
    () => organizations.find((organization) => String(organization.id) === ownOrganizationId) || null,
    [organizations, ownOrganizationId],
  );

  const ownDescendantIds = useMemo(() => {
    if (!ownOrganizationId) return new Set<string>();
    return collectDescendantOrganizationIds(ownOrganizationId, childrenByParentId);
  }, [childrenByParentId, ownOrganizationId]);

  const isCoordinatorUser = useMemo(() => {
    if (!ownOrganizationId || !ownOrganization) return false;
    const effectiveType = getEffectiveOrganizationType(ownOrganization);
    if (coordinatorOrganizationTypes.has(effectiveType)) return true;
    if (coordinatorOrganizationTypes.has(String(ownOrganization.type || "").toLowerCase())) return true;
    return ownDescendantIds.size > 1;
  }, [ownDescendantIds, ownOrganization, ownOrganizationId]);

  const visibleOrganizationIds = useMemo(() => {
    if (canReportAcrossOrganizations) {
      return new Set(organizations.map((organization) => String(organization.id)));
    }
    if (!ownOrganizationId) return new Set<string>();
    if (canReviewAggregates || isCoordinatorUser) return ownDescendantIds;
    return new Set<string>([ownOrganizationId]);
  }, [
    canReportAcrossOrganizations,
    canReviewAggregates,
    isCoordinatorUser,
    organizations,
    ownDescendantIds,
    ownOrganizationId,
  ]);

  const visibleOrganizations = useMemo(
    () =>
      organizations
        .filter((organization) => visibleOrganizationIds.has(String(organization.id)))
        .slice()
        .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""))),
    [organizations, visibleOrganizationIds],
  );

  const availableCoordinatorOrganizations = useMemo(() => {
    if (!canReportAcrossOrganizations && !canReviewAggregates && !isCoordinatorUser) {
      return [];
    }

    const coordinatorOptions = visibleOrganizations.filter(isCoordinatorPortfolioOrganization);

    if (
      !canReportAcrossOrganizations &&
      !canReviewAggregates &&
      isCoordinatorUser &&
      ownOrganization &&
      isCoordinatorPortfolioOrganization(ownOrganization)
    ) {
      return [ownOrganization];
    }

    if (ownOrganization && isBonasoRootOrganization(ownOrganization)) {
      return coordinatorOptions;
    }

    return coordinatorOptions;
  }, [
    canReportAcrossOrganizations,
    canReviewAggregates,
    isCoordinatorUser,
    ownOrganization,
    visibleOrganizations,
  ]);

  const writableOrganizations = useMemo(() => {
    if (canReportAcrossOrganizations) return organizations;
    if (!ownOrganizationId) return [];
    return organizations.filter((organization) => String(organization.id) === ownOrganizationId);
  }, [canReportAcrossOrganizations, organizations, ownOrganizationId]);

  const writableOrganizationIds = useMemo(
    () => new Set<string>(writableOrganizations.map((organization) => String(organization.id))),
    [writableOrganizations],
  );

  return {
    availableCoordinatorOrganizations,
    canReportAcrossOrganizations,
    canReviewAggregates,
    defaultOwnOrganizationValue: ownOrganizationId,
    isOrganizationSelectionLocked: !canReportAcrossOrganizations,
    userOrganizationId,
    visibleOrganizationIds,
    visibleOrganizations,
    writableOrganizationIds,
    writableOrganizations,
  };
}

export type PeriodFilterOption = {
  id: string;
  label: string;
  periodEnd: string;
  periodStart: string;
};

type ProjectHierarchyLinkLike = {
  parent_organization: string | number;
  child_organization: string | number;
  is_active: boolean;
};

type AggregateFiltersArgs = {
  aggregates: Aggregate[];
  availableCoordinatorOrganizations: OrganizationWithParent[];
  /** Controlled: caller owns this state and passes the setter separately. */
  projectFilter: string;
  /** When provided and non-empty, scopes coordinator children via project hierarchy instead of global org.parent. */
  projectHierarchyLinks?: ProjectHierarchyLinkLike[];
  visibleOrganizations: OrganizationWithParent[];
};

export function useAggregateFilters(args: AggregateFiltersArgs) {
  const {
    aggregates,
    availableCoordinatorOrganizations,
    projectFilter,
    projectHierarchyLinks,
    visibleOrganizations,
  } = args;
  const [searchQuery, setSearchQuery] = useState("");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [parentOrgFilter, setParentOrgFilter] = useState("all");
  const [selectedOrganizationIdsList, setSelectedOrganizationIdsList] = useState<string[]>([]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, string[]>();
    if (projectHierarchyLinks && projectHierarchyLinks.length > 0) {
      // Phase 6: use project-scoped hierarchy links when available
      projectHierarchyLinks
        .filter((link) => link.is_active)
        .forEach((link) => {
          const parentId = String(link.parent_organization);
          const childId = String(link.child_organization);
          const existing = map.get(parentId) || [];
          existing.push(childId);
          map.set(parentId, existing);
        });
    } else {
      visibleOrganizations.forEach((organization) => {
        const organizationId = String(organization.id);
        const parentId = resolveParentOrganizationId(organization);
        if (!parentId) return;
        const children = map.get(parentId) || [];
        children.push(organizationId);
        map.set(parentId, children);
      });
    }
    return map;
  }, [projectHierarchyLinks, visibleOrganizations]);

  const effectiveParentOrgFilter = useMemo(() => {
    if (parentOrgFilter === "all") return "all";
    const isKnownCoordinator = availableCoordinatorOrganizations.some(
      (organization) => String(organization.id) === parentOrgFilter,
    );
    return isKnownCoordinator ? parentOrgFilter : "all";
  }, [availableCoordinatorOrganizations, parentOrgFilter]);

  const scopedOrganizations = useMemo(() => {
    if (effectiveParentOrgFilter === "all") {
      return visibleOrganizations;
    }
    const scopedIds = collectDescendantOrganizationIds(effectiveParentOrgFilter, childrenByParentId);
    scopedIds.add(effectiveParentOrgFilter);
    return visibleOrganizations
      .filter((organization) => scopedIds.has(String(organization.id)))
      .slice()
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
  }, [childrenByParentId, effectiveParentOrgFilter, visibleOrganizations]);

  const scopedOrganizationIds = useMemo(
    () => new Set(scopedOrganizations.map((organization) => String(organization.id))),
    [scopedOrganizations],
  );

  const normalizedSelectedOrganizationIdsList = useMemo(
    () =>
      selectedOrganizationIdsList.filter((organizationId) =>
        scopedOrganizationIds.has(organizationId),
      ),
    [scopedOrganizationIds, selectedOrganizationIdsList],
  );

  const selectedOrganizationIds = useMemo(() => {
    if (normalizedSelectedOrganizationIdsList.length === 0) {
      return scopedOrganizationIds;
    }
    return new Set(
      normalizedSelectedOrganizationIdsList.filter((organizationId) => scopedOrganizationIds.has(organizationId)),
    );
  }, [normalizedSelectedOrganizationIdsList, scopedOrganizationIds]);

  const periodOptions = useMemo<PeriodFilterOption[]>(() => {
    const periodMap = new Map<string, PeriodFilterOption>();
    aggregates.forEach((aggregate) => {
      if (aggregate.status !== "approved") return;
      const organizationId = String(aggregate.organization);
      if (!selectedOrganizationIds.has(organizationId)) return;
      if (projectFilter !== "all" && String(aggregate.project) !== projectFilter) return;
      const periodStart = aggregate.period_start || "";
      const periodEnd = aggregate.period_end || "";
      if (!periodStart || !periodEnd) return;
      const optionId = `${periodStart}|${periodEnd}`;
      if (periodMap.has(optionId)) return;
      periodMap.set(optionId, {
        id: optionId,
        label: getPeriodLabel(aggregate),
        periodEnd,
        periodStart,
      });
    });
    return Array.from(periodMap.values()).sort((left, right) =>
      String(right.periodEnd).localeCompare(String(left.periodEnd)),
    );
  }, [aggregates, projectFilter, selectedOrganizationIds]);

  const effectivePeriodFilter = useMemo(
    () => (periodFilter === "all" || periodOptions.some((option) => option.id === periodFilter) ? periodFilter : "all"),
    [periodFilter, periodOptions],
  );
  const selectedPeriodOption = useMemo(
    () => periodOptions.find((option) => option.id === effectivePeriodFilter) || null,
    [effectivePeriodFilter, periodOptions],
  );

  const setCoordinatorFilter = useCallback((value: string) => {
    setParentOrgFilter(value);
    setSelectedOrganizationIdsList([]);
  }, []);

  return {
    parentOrgFilter: effectiveParentOrgFilter,
    periodFilter: effectivePeriodFilter,
    periodOptions,
    projectFilter,
    scopedOrganizations,
    searchQuery,
    selectedOrganizationIds,
    selectedOrganizationIdsList: normalizedSelectedOrganizationIdsList,
    selectedPeriodOption,
    setCoordinatorFilter,
    setPeriodFilter,
    setSearchQuery,
    setSelectedOrganizationIdsList,
  };
}

export function useAggregateEntryForm() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [formProject, setFormProject] = useState("");
  const [formOrganization, setFormOrganization] = useState("");
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<string[]>([]);
  const [indicatorDrafts, setIndicatorDrafts] = useState<Record<string, AggregateEntryDraft>>({});
  const [formPeriodStart, setFormPeriodStart] = useState("");
  const [formPeriodEnd, setFormPeriodEnd] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formDataSource, setFormDataSource] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(AGGREGATE_ENTRY_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const snapshot = sanitizeAggregateEntrySnapshot(parsed);
      if (!snapshot) return;
      setFormProject(snapshot.formProject);
      setFormOrganization(snapshot.formOrganization);
      setSelectedIndicatorIds(snapshot.selectedIndicatorIds);
      setIndicatorDrafts(snapshot.indicatorDrafts);
      setFormPeriodStart(snapshot.formPeriodStart);
      setFormPeriodEnd(snapshot.formPeriodEnd);
      setFormNotes(snapshot.formNotes);
      setFormDataSource(snapshot.formDataSource);
    } catch {
      // Ignore malformed local draft payloads.
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    const snapshot: AggregateEntryFormSnapshot = {
      formProject,
      formOrganization,
      selectedIndicatorIds,
      indicatorDrafts,
      formPeriodStart,
      formPeriodEnd,
      formNotes,
      formDataSource,
    };
    if (!hasAggregateEntrySnapshotContent(snapshot)) {
      window.localStorage.removeItem(AGGREGATE_ENTRY_DRAFT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(AGGREGATE_ENTRY_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
  }, [
    formDataSource,
    formNotes,
    formOrganization,
    formPeriodEnd,
    formPeriodStart,
    formProject,
    indicatorDrafts,
    isHydrated,
    selectedIndicatorIds,
  ]);

  const resetForm = useCallback(() => {
    setFormProject("");
    setFormOrganization("");
    setSelectedIndicatorIds([]);
    setIndicatorDrafts({});
    setFormPeriodStart("");
    setFormPeriodEnd("");
    setFormNotes("");
    setFormDataSource("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AGGREGATE_ENTRY_DRAFT_STORAGE_KEY);
    }
  }, []);

  const handleFormProjectChange = useCallback((value: string) => {
    setFormProject(value);
    setFormOrganization("");
    setSelectedIndicatorIds([]);
    setIndicatorDrafts({});
  }, []);

  const handleFormOrganizationChange = useCallback((value: string) => {
    setFormOrganization(value);
    setSelectedIndicatorIds([]);
    setIndicatorDrafts({});
  }, []);

  return {
    formDataSource,
    formNotes,
    formOrganization,
    formPeriodEnd,
    formPeriodStart,
    formProject,
    handleFormOrganizationChange,
    handleFormProjectChange,
    indicatorDrafts,
    resetForm,
    selectedIndicatorIds,
    setFormDataSource,
    setFormNotes,
    setFormOrganization,
    setFormPeriodEnd,
    setFormPeriodStart,
    setFormProject,
    setIndicatorDrafts,
    setSelectedIndicatorIds,
  };
}

type AggregateReviewActionsArgs = {
  mutate: () => Promise<unknown>;
  mutateQueue?: () => Promise<unknown>;
  toast: ToastFn;
};

export function useAggregateReviewActions(args: AggregateReviewActionsArgs) {
  const { mutate, mutateQueue, toast } = args;
  const [actingAggregateId, setActingAggregateId] = useState<string | null>(null);
  const [actingReviewAction, setActingReviewAction] = useState<"review" | "approve" | "bulk_approve" | "flag" | "delete" | null>(null);

  const requireOnlineReviewAction = useCallback((actionLabel: string) => {
    if (typeof navigator === "undefined" || navigator.onLine) return true;
    toast({
      title: `${actionLabel} unavailable offline`,
      description: "Review, approvals, flagging, and deletes require an online connection.",
      variant: "destructive",
    });
    return false;
  }, [toast]);

  const handleReviewAggregate = useCallback(
    async (aggregateId: string, notes: string) => {
      if (!requireOnlineReviewAction("Review")) return;
      setActingAggregateId(aggregateId);
      setActingReviewAction("review");
      try {
        await aggregatesService.review(Number(aggregateId), { notes });
        await mutate();
        void mutateQueue?.();
        toast({
          title: "Aggregate reviewed",
          description: "The aggregate has been reviewed and is now ready for approval.",
        });
      } catch (error) {
        console.error("Failed to review aggregate", error);
        toast({
          title: "Review failed",
          description: error instanceof Error ? error.message : "Unable to review this aggregate.",
          variant: "destructive",
        });
      } finally {
        setActingAggregateId(null);
        setActingReviewAction(null);
      }
    },
    [mutate, mutateQueue, requireOnlineReviewAction, toast],
  );

  const handleApproveAggregate = useCallback(
    async (aggregateId: string) => {
      if (!requireOnlineReviewAction("Approval")) return;
      setActingAggregateId(aggregateId);
      setActingReviewAction("approve");
      try {
        await aggregatesService.approve(Number(aggregateId));
        await mutate();
        void mutateQueue?.();
        toast({
          title: "Aggregate approved",
          description: "The aggregate entry is now approved.",
        });
      } catch (error) {
        console.error("Failed to approve aggregate", error);
        toast({
          title: "Approval failed",
          description: error instanceof Error ? error.message : "Unable to approve this aggregate.",
          variant: "destructive",
        });
      } finally {
        setActingAggregateId(null);
        setActingReviewAction(null);
      }
    },
    [mutate, mutateQueue, requireOnlineReviewAction, toast],
  );

  const handleBulkApproveAggregates = useCallback(
    async (aggregateIds: string[]) => {
      if (!requireOnlineReviewAction("Bulk approval")) return;
      const ids = aggregateIds
        .map((aggregateId) => Number(aggregateId))
        .filter((aggregateId) => Number.isFinite(aggregateId));

      if (ids.length === 0) return;

      setActingAggregateId("bulk");
      setActingReviewAction("bulk_approve");
      try {
        const result = await aggregatesService.bulkApprove(ids);
        await mutate();
        void mutateQueue?.();
        toast({
          title: "Aggregates approved",
          description:
            result.skipped > 0
              ? `${result.approved} aggregate(s) approved. ${result.skipped} skipped because they were not ready for bulk approval.`
              : `${result.approved} aggregate(s) approved successfully.`,
        });
      } catch (error) {
        console.error("Failed to bulk approve aggregates", error);
        toast({
          title: "Bulk approval failed",
          description: error instanceof Error ? error.message : "Unable to approve these aggregates.",
          variant: "destructive",
        });
      } finally {
        setActingAggregateId(null);
        setActingReviewAction(null);
      }
    },
    [mutate, mutateQueue, requireOnlineReviewAction, toast],
  );

  const handleFlagAggregate = useCallback(
    async (
      aggregateId: string,
      payload: {
        reason: "duplicate" | "incorrect_data" | "suspicious" | "incomplete" | "other";
        description: string;
        severity: "low" | "medium" | "high";
      },
    ) => {
      if (!requireOnlineReviewAction("Flagging")) return;
      setActingAggregateId(aggregateId);
      setActingReviewAction("flag");
      try {
        await aggregatesService.flag(Number(aggregateId), payload);
        await mutate();
        void mutateQueue?.();
        toast({
          title: "Aggregate flagged",
          description: "The aggregate was flagged for correction and a data-quality flag was created.",
        });
      } catch (error) {
        console.error("Failed to flag aggregate", error);
        toast({
          title: "Flagging failed",
          description: error instanceof Error ? error.message : "Unable to flag this aggregate.",
          variant: "destructive",
        });
      } finally {
        setActingAggregateId(null);
        setActingReviewAction(null);
      }
    },
    [mutate, mutateQueue, requireOnlineReviewAction, toast],
  );

  const handleUpdateAggregate = useCallback(
    async (
      aggregateId: string,
      payload: {
        indicator: number;
        notes: string;
        organization: number;
        period_end: string;
        period_start: string;
        project: number;
        value: unknown;
      },
    ) => {
      setActingAggregateId(aggregateId);
      setActingReviewAction("review");
      try {
        const updated = await aggregatesService.update(Number(aggregateId), payload);
        await mutate();
        void mutateQueue?.();
        toast({
          title: "Corrections saved",
          description: "The aggregate was updated and sent back for review.",
        });
        return updated;
      } catch (error) {
        console.error("Failed to update aggregate", error);
        toast({
          title: "Update failed",
          description: error instanceof Error ? error.message : "Unable to save corrections.",
          variant: "destructive",
        });
        throw error;
      } finally {
        setActingAggregateId(null);
        setActingReviewAction(null);
      }
    },
    [mutate, mutateQueue, toast],
  );

  const handleDeleteAggregate = useCallback(
    async (aggregateId: string) => {
      if (!requireOnlineReviewAction("Delete")) return;
      setActingAggregateId(aggregateId);
      setActingReviewAction("delete");
      try {
        await aggregatesService.delete(Number(aggregateId));
        await mutate();
        void mutateQueue?.();
        toast({
          title: "Aggregate deleted",
          description: "The aggregate record was deleted successfully.",
        });
      } catch (error) {
        console.error("Failed to delete aggregate", error);
        toast({
          title: "Delete failed",
          description: error instanceof Error ? error.message : "Unable to delete this aggregate.",
          variant: "destructive",
        });
        throw error;
      } finally {
        setActingAggregateId(null);
        setActingReviewAction(null);
      }
    },
    [mutate, mutateQueue, requireOnlineReviewAction, toast],
  );

  return {
    actingAggregateId,
    actingReviewAction,
    handleApproveAggregate,
    handleBulkApproveAggregates,
    handleDeleteAggregate,
    handleFlagAggregate,
    handleReviewAggregate,
    handleUpdateAggregate,
  };
}

type AggregateChartStateArgs = {
  aggregateGroups: AggregateIndicatorGroup[];
  indicatorById?: Map<string, IndicatorDisaggregationInput>;
};

const aggregateChartPalette = [
  "#1f6b8b",
  "#ed7d31",
  "#2f855a",
  "#7c3aed",
  "#c2410c",
  "#0f766e",
] as const;

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateLabel(value: string) {
  const trimmed = String(value || "").trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!isoMatch) return null;
  const year = Number(isoMatch[1]);
  const month = Number(isoMatch[2]);
  const day = Number(isoMatch[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

type AggregateChartView =
  | "total"
  | "key_population"
  | "age_group"
  | "sex"
  | "key_population_age_group";

function buildAggregateChartTitle(chartView: AggregateChartView) {
  switch (chartView) {
    case "key_population":
      return "Reached by Key Population";
    case "age_group":
      return "Reached by Age Group";
    case "sex":
      return "Reached by Sex";
    case "key_population_age_group":
      return "Key Population by Age Group";
    case "total":
    default:
      return "Total Reach";
  }
}

function getAggregateChartColor(index: number) {
  return aggregateChartPalette[index % aggregateChartPalette.length];
}

export function useAggregateChartState(args: AggregateChartStateArgs) {
  const { aggregateGroups, indicatorById } = args;
  const safeIndicatorById = useMemo(
    () => indicatorById ?? new Map<string, IndicatorDisaggregationInput>(),
    [indicatorById],
  );
  const [isChartOpen, setIsChartOpen] = useState(false);
  const [selectedChartGroupKey, setSelectedChartGroupKey] = useState("");

  const selectedChartGroup = useMemo(
    () => aggregateGroups.find((group) => group.key === selectedChartGroupKey) || null,
    [aggregateGroups, selectedChartGroupKey],
  );

  const chartData = useMemo<AggregateChartPoint[]>(() => {
    if (!selectedChartGroup) return [];
    const indicator = safeIndicatorById.get(selectedChartGroup.indicatorId);
    const mergedDisaggregates = mergeDisaggregatesForGroup(selectedChartGroup.items);

    if (mergedDisaggregates) {
      const alignedDisaggregates = normalizeMatrixDisaggregatesForIndicator(
        mergedDisaggregates,
        indicator,
      );
      const indicatorGroups = getIndicatorDisaggregateGroups(indicator);
      const { matrix, keyPops, secondDimensionValues, ageBands } = buildDisplayMatrix(
        alignedDisaggregates,
        indicatorGroups,
        indicator,
      );
      const totalBands = getBandsForTotals(ageBands);
      const hasSecondDimensionView =
        secondDimensionValues.length > 1 ||
        (secondDimensionValues.length === 1 && secondDimensionValues[0] !== "All");
      const hasAgeBandView = ageBands.length > 1 || (ageBands.length === 1 && ageBands[0] !== "Value");

      const hasKeyPopulationView =
        keyPops.length > 1 || (keyPops.length === 1 && keyPops[0] !== "All");
      if (hasKeyPopulationView && hasSecondDimensionView) {
        return keyPops.map((keyPopulation) => {
          const row: AggregateChartPoint = { name: keyPopulation };
          secondDimensionValues.forEach((dimension) => {
            const values = matrix[keyPopulation]?.[dimension] || {};
            row[dimension] = sumBands(values, totalBands);
          });
          return row;
        });
      }

      if (hasKeyPopulationView && hasAgeBandView && !hasSecondDimensionView) {
        return keyPops.map((keyPopulation) => {
          const row: AggregateChartPoint = { name: keyPopulation };
          ageBands.forEach((band) => {
            row[band] = secondDimensionValues.reduce((sum, dimension) => {
              const values = matrix[keyPopulation]?.[dimension] || {};
              return sum + toSafeNumber(values[band]);
            }, 0);
          });
          return row;
        });
      }

      if (hasKeyPopulationView) {
        return keyPops.map((keyPopulation) => {
          const total = secondDimensionValues.reduce((sum, dimension) => {
            const values = matrix[keyPopulation]?.[dimension] || {};
            return sum + sumBands(values, totalBands);
          }, 0);
          return {
            name: keyPopulation,
            total,
          };
        });
      }

      if (hasSecondDimensionView && hasAgeBandView) {
        return ageBands.map((band) => {
          const row: AggregateChartPoint = { name: band };
          secondDimensionValues.forEach((dimension) => {
            row[dimension] = keyPops.reduce((sum, keyPopulation) => {
              const values = matrix[keyPopulation]?.[dimension] || {};
              return sum + toSafeNumber(values[band]);
            }, 0);
          });
          return row;
        });
      }

      if (hasSecondDimensionView) {
        return secondDimensionValues.map((dimension) => {
          const total = keyPops.reduce((sum, keyPopulation) => {
            const values = matrix[keyPopulation]?.[dimension] || {};
            return sum + sumBands(values, totalBands);
          }, 0);
          return {
            name: dimension,
            total,
          };
        });
      }

      if (hasAgeBandView) {
        return ageBands.map((band) => {
          const total = keyPops.reduce((sum, keyPopulation) => {
            return (
              sum +
              secondDimensionValues.reduce((dimensionSum, dimension) => {
                const values = matrix[keyPopulation]?.[dimension] || {};
                return dimensionSum + toSafeNumber(values[band]);
              }, 0)
            );
          }, 0);
          return {
            name: band,
            total,
          };
        });
      }
    }

    const totalsByPeriod = new Map<string, { label: string; periodEnd: string; total: number }>();
    selectedChartGroup.items.forEach((aggregate) => {
      const periodStart = String(aggregate.period_start || "");
      const periodEnd = String(aggregate.period_end || "");
      const periodKey = `${periodStart}|${periodEnd}`;
      const current = totalsByPeriod.get(periodKey) || {
        label: getPeriodLabel(aggregate),
        periodEnd,
        total: 0,
      };
      current.total += getAggregateTotal(aggregate);
      totalsByPeriod.set(periodKey, current);
    });
    return Array.from(totalsByPeriod.values())
      .sort((left, right) => String(left.periodEnd).localeCompare(String(right.periodEnd)))
      .map((entry) => ({ name: entry.label, total: entry.total }));
  }, [safeIndicatorById, selectedChartGroup]);

  const chartView = useMemo<AggregateChartView>(() => {
    if (!selectedChartGroup) return "total";
    const indicator = safeIndicatorById.get(selectedChartGroup.indicatorId);
    const mergedDisaggregates = mergeDisaggregatesForGroup(selectedChartGroup.items);
    if (!mergedDisaggregates) return "total";

    const alignedDisaggregates = normalizeMatrixDisaggregatesForIndicator(mergedDisaggregates, indicator);
    const indicatorGroups = getIndicatorDisaggregateGroups(indicator);
    const { keyPops, secondDimensionValues, ageBands } = buildDisplayMatrix(
      alignedDisaggregates,
      indicatorGroups,
      indicator,
    );
    const hasKeyPopulationView = keyPops.length > 1 || (keyPops.length === 1 && keyPops[0] !== "All");
    const hasSecondDimensionView =
      secondDimensionValues.length > 1 ||
      (secondDimensionValues.length === 1 && secondDimensionValues[0] !== "All");
    const hasAgeBandView = ageBands.length > 1 || (ageBands.length === 1 && ageBands[0] !== "Value");

    if (hasKeyPopulationView && hasAgeBandView && !hasSecondDimensionView) {
      return "key_population_age_group";
    }
    if (hasKeyPopulationView) {
      return "key_population";
    }
    if (hasSecondDimensionView) {
      return "sex";
    }
    if (hasAgeBandView) {
      return "age_group";
    }
    return "total";
  }, [safeIndicatorById, selectedChartGroup]);

  const chartSeries = useMemo<AggregateChartSeries[]>(() => {
    if (chartData.length === 0) {
      return [{ key: "total", label: "Total", color: getAggregateChartColor(0) }];
    }

    const seriesKeys = Object.keys(chartData[0]).filter((key) => key !== "name");
    if (seriesKeys.length === 0) {
      return [{ key: "total", label: "Total", color: getAggregateChartColor(0) }];
    }

    return seriesKeys.map((key, index) => ({
      key,
      label: key,
      color: getAggregateChartColor(index),
    }));
  }, [chartData]);

  const chartMeta = useMemo(() => {
    if (!selectedChartGroup) return "";

    const organizationIds = new Set<string>();
    const projectNames = new Set<string>();
    let minStart = "";
    let maxEnd = "";

    selectedChartGroup.items.forEach((aggregate) => {
      const organizationId = String(aggregate.organization || "").trim();
      if (organizationId) organizationIds.add(organizationId);

      const projectName = String(aggregate.project_name || "").trim();
      if (projectName) projectNames.add(projectName);

      const periodStart = String(aggregate.period_start || "").trim();
      const periodEnd = String(aggregate.period_end || "").trim();

      if (periodStart && (!minStart || periodStart < minStart)) {
        minStart = periodStart;
      }

      if (periodEnd && (!maxEnd || periodEnd > maxEnd)) {
        maxEnd = periodEnd;
      }
    });

    const parts: string[] = [];

    if (organizationIds.size > 0) {
      parts.push(
        `${formatCount(organizationIds.size)} organization${organizationIds.size === 1 ? "" : "s"}`,
      );
    }

    if (projectNames.size === 1) {
      parts.push(Array.from(projectNames)[0]);
    } else if (projectNames.size > 1) {
      parts.push(`${formatCount(projectNames.size)} projects`);
    }

    const formattedStart = minStart ? formatDateLabel(minStart) : null;
    const formattedEnd = maxEnd ? formatDateLabel(maxEnd) : null;
    if (formattedStart && formattedEnd) {
      parts.push(`${formattedStart} – ${formattedEnd}`);
    } else if (formattedStart) {
      parts.push(formattedStart);
    } else if (formattedEnd) {
      parts.push(formattedEnd);
    }

    return parts.join(" | ");
  }, [selectedChartGroup]);

  const openChartForGroup = useCallback((group: AggregateIndicatorGroup) => {
    setSelectedChartGroupKey(group.key);
    setIsChartOpen(true);
  }, []);

  return {
    chartData,
    chartMeta,
    chartSeries,
    chartSubtitle: selectedChartGroup?.indicatorName || "",
    chartTitle: selectedChartGroup ? buildAggregateChartTitle(chartView) : "Aggregate Totals",
    isChartOpen,
    openChartForGroup,
    selectedChartGroup,
    setIsChartOpen,
  };
}
