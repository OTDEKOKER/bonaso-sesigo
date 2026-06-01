"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { AnalyticsComparisonMode, AnalyticsPeriodMode } from "@/lib/analytics/query-builder";
import type { AnalyticsScopeMode } from "@/lib/analytics/org-scope";

export type AnalyticsFilterState = {
  projectId: string;
  reportingPeriodId: string;
  selectedPeriods: string[];
  periodMode: AnalyticsPeriodMode;
  dateFrom: string;
  dateTo: string;
  scopeMode: AnalyticsScopeMode;
  parentOrgId: string;
  selectedOrgIds: string[];
  indicatorIds: string[];
  indicatorGroup: string;
  disaggregationKeys: string[];
  cascadeOrganization: boolean;
  comparisonMode: AnalyticsComparisonMode;
};

export const defaultAnalyticsFilters: AnalyticsFilterState = {
  projectId: "all",
  reportingPeriodId: "",
  selectedPeriods: [],
  periodMode: "quarter",
  dateFrom: "",
  dateTo: "",
  scopeMode: "all_orgs",
  parentOrgId: "",
  selectedOrgIds: [],
  indicatorIds: [],
  indicatorGroup: "all",
  disaggregationKeys: [],
  cascadeOrganization: true,
  comparisonMode: "period",
};

type AnalyticsFiltersContextValue = {
  filters: AnalyticsFilterState;
  setFilters: (next: Partial<AnalyticsFilterState>) => void;
  resetFilters: () => void;
  saveFilters: () => void;
};

const AnalyticsFiltersContext = createContext<AnalyticsFiltersContextValue | undefined>(
  undefined,
);

export function AnalyticsFiltersProvider(props: {
  children: React.ReactNode;
  dashboardId?: number | null;
  initialState?: Partial<AnalyticsFilterState>;
}) {
  const { children, dashboardId, initialState } = props;
  const storageKey = useMemo(
    () =>
      dashboardId
        ? `bonaso.analytics.dashboard.${dashboardId}.filters`
        : "bonaso.analytics.dashboard.filters",
    [dashboardId],
  );

  const mergedDefaults = useMemo(
    () => ({
      ...defaultAnalyticsFilters,
      ...(initialState || {}),
    }),
    [initialState],
  );

  const [filters, setFiltersState] = useState<AnalyticsFilterState>(() => {
    if (typeof window === "undefined") return mergedDefaults;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return mergedDefaults;
      const parsed = JSON.parse(raw) as Partial<AnalyticsFilterState>;
      return {
        ...mergedDefaults,
        ...(parsed || {}),
      };
    } catch {
      return mergedDefaults;
    }
  });

  const setFilters = useCallback((next: Partial<AnalyticsFilterState>) => {
    setFiltersState((previous) => ({
      ...previous,
      ...next,
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(mergedDefaults);
  }, [mergedDefaults]);

  const saveFilters = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(filters));
    } catch {
      // Ignore storage failures and keep runtime state.
    }
  }, [filters, storageKey]);

  const value = useMemo(
    () => ({
      filters,
      setFilters,
      resetFilters,
      saveFilters,
    }),
    [filters, resetFilters, saveFilters, setFilters],
  );

  return (
    <AnalyticsFiltersContext.Provider value={value}>
      {children}
    </AnalyticsFiltersContext.Provider>
  );
}

export function useAnalyticsFilters() {
  const context = useContext(AnalyticsFiltersContext);
  if (!context) {
    throw new Error(
      "useAnalyticsFilters must be used within an AnalyticsFiltersProvider.",
    );
  }
  return context;
}
