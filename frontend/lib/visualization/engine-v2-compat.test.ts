import assert from "node:assert/strict";
import { test } from "@playwright/test";

import type { AnalyticsFact } from "../analytics/query-builder.ts";
import type { Indicator, Organization } from "../types.ts";
import {
  analyticsFactToAggregateRecord,
  mapLegacyFiltersToVisualizationRequest,
} from "./adapters.ts";
import { buildVisualizationResult } from "./engine.ts";
import { buildVisualizationResultV2Compat } from "./engine-v2-compat.ts";
import { getVisualizationEngineV2Enabled } from "./feature-flags.ts";
import { isLegacyVisualizationChart, isV2VisualizationResult } from "./guards.ts";
import { buildVisualizationEngine } from "./engine-v2.ts";

const organizations: Organization[] = [
  {
    id: "org-parent",
    name: "Parent Org",
    type: "coordinator",
    createdAt: "2025-04-01",
  },
  {
    id: "org-child",
    name: "Child Org",
    type: "subgrantee",
    parentId: "org-parent",
    createdAt: "2025-04-01",
  },
  {
    id: "org-child-2",
    name: "Child Org 2",
    type: "subgrantee",
    parentId: "org-parent",
    createdAt: "2025-04-01",
  },
];

const indicator: Indicator = {
  id: "indicator-1",
  name: "People reached",
  code: "IND-1",
  category: "ncd",
  type: "number",
  is_active: true,
  created_at: "2025-04-01",
  updated_at: "2025-04-01",
  project_targets: [
    {
      id: "target-1",
      project: "project-1",
      indicator: "indicator-1",
      organization: "org-child",
      q1_target: 30,
      q2_target: 40,
      q3_target: 50,
      q4_target: 60,
      target_value: 180,
      current_value: 0,
      baseline_value: 0,
      progress: 0,
    },
    {
      id: "target-2",
      project: "project-1",
      indicator: "indicator-1",
      organization: "org-child-2",
      q1_target: 25,
      q2_target: 35,
      q3_target: 45,
      q4_target: 55,
      target_value: 160,
      current_value: 0,
      baseline_value: 0,
      progress: 0,
    },
  ],
};

const facts: AnalyticsFact[] = [
  {
    aggregateId: "agg-1",
    organizationId: "org-child",
    organizationName: "Child Org",
    indicatorId: "indicator-1",
    indicatorName: "People reached",
    projectId: "project-1",
    periodLabel: "Q1 2025/26",
    periodStart: "2025-04-01",
    periodEnd: "2025-06-30",
    value: 12,
    disaggregates: { sex: "Female", age_band: "20-24" },
    notes: "note-a",
  },
  {
    aggregateId: "agg-2",
    organizationId: "org-child-2",
    organizationName: "Child Org 2",
    indicatorId: "indicator-1",
    indicatorName: "People reached",
    projectId: "project-1",
    periodLabel: "Q1 2025/26",
    periodStart: "2025-04-01",
    periodEnd: "2025-06-30",
    value: 18,
    disaggregates: { sex: "Male", age_band: "25-29" },
    notes: "note-b",
  },
];

test("analyticsFactToAggregateRecord preserves hierarchy, disaggregations, and target semantics", () => {
  const record = analyticsFactToAggregateRecord(facts[0], {
    organizationsById: new Map(organizations.map((org) => [org.id, org])),
    indicatorsById: new Map([[indicator.id, indicator]]),
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    projectId: "project-1",
  });

  assert.equal(record.organization_type, "subgrantee");
  assert.equal(record.parent_organization_id, "org-parent");
  assert.equal(record.parent_organization_name, "Parent Org");
  assert.equal(record.target, 30);
  assert.deepEqual(record.disaggregations, {
    sex: "Female",
    age_band: "20-24",
    coordinator: "Parent Org",
  });
  assert.equal(record.reporting_period_type, "quarterly");
});

test("mapLegacyFiltersToVisualizationRequest preserves scope and selected dimensions", () => {
  const request = mapLegacyFiltersToVisualizationRequest({
    facts: [...facts],
    scopeMode: "parent_org",
    comparisonMode: "organization",
    periodMode: "quarter",
    disaggregationKeys: ["sex", "age_band"],
    selectedParentOrgId: "org-parent",
    selectedOrgIds: ["org-child"],
    currentOrgId: "org-parent",
    lookups: {
      organizationsById: new Map(organizations.map((org) => [org.id, org])),
      indicatorsById: new Map([[indicator.id, indicator]]),
      selectedPeriods: ["Q1 2025/26"],
      periodMode: "quarter",
      projectId: "project-1",
    },
  });

  assert.equal(request.hierarchyScope, "parent_org");
  assert.equal(request.comparisonMode, "organization");
  assert.equal(request.periodMode, "quarterly");
  assert.deepEqual(request.selectedDimensions, ["sex", "age_band"]);
  assert.equal(request.selectedParentOrgId, "org-parent");
  assert.equal(request.records.length, 2);
});

test("buildVisualizationResultV2Compat returns legacy-safe charts and current table contract", () => {
  const result = buildVisualizationResultV2Compat({
    records: [...facts],
    dimensions: ["sex", "age_band"],
    indicators: [indicator],
    organizations: [...organizations],
    scopedOrgIds: ["org-child", "org-child-2"],
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    projectId: "project-1",
    comparisonMode: "organization",
    drilldownFilters: {},
    chartMode: "auto",
    currentOrgId: "org-parent",
    scopeMode: "parent_org",
    parentOrgId: "org-parent",
    selectedOrgIds: ["org-child", "org-child-2"],
  });

  assert.equal(result.kpis.length, 4);
  assert.equal(result.kpis[0]?.title, "Total reported");
  assert.ok(result.table.matrix);
  assert.equal(result.table.rawRows.length, 2);
  assert.ok(result.comparisonChart);
  assert.ok(isLegacyVisualizationChart(result.comparisonChart));
  assert.equal(result.comparisonChart?.kind, "grouped-bar");
  assert.equal(result.normalizedRecords[0]?.source.aggregateId, "agg-1");
});

test("v2 engine result passes guard checks", () => {
  const request = mapLegacyFiltersToVisualizationRequest({
    facts: [...facts],
    scopeMode: "all_orgs",
    comparisonMode: "organization",
    periodMode: "quarter",
    disaggregationKeys: ["sex"],
    lookups: {
      organizationsById: new Map(organizations.map((org) => [org.id, org])),
      indicatorsById: new Map([[indicator.id, indicator]]),
      selectedPeriods: ["Q1 2025/26"],
      periodMode: "quarter",
      projectId: "project-1",
    },
  });
  const result = buildVisualizationEngine(request);

  assert.ok(isV2VisualizationResult(result));
  assert.equal(result.recommendedChart, "grouped-bar");
});

test("feature flag helper respects both legacy and client-safe env keys", () => {
  assert.equal(
    getVisualizationEngineV2Enabled({
      NEXT_PUBLIC_ENABLE_VISUALIZATION_ENGINE_V2: "true",
    }),
    true,
  );
  assert.equal(
    getVisualizationEngineV2Enabled({
      ENABLE_VISUALIZATION_ENGINE_V2: "true",
    }),
    true,
  );
  assert.equal(getVisualizationEngineV2Enabled({}), false);
});

test("coordinator comparison mode rolls child organizations into coordinator groups", () => {
  const legacy = buildVisualizationResult({
    records: [...facts],
    dimensions: [],
    indicators: [indicator],
    organizations: [...organizations],
    scopedOrgIds: ["org-child", "org-child-2"],
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    projectId: "project-1",
    comparisonMode: "coordinator",
    drilldownFilters: {},
    chartMode: "auto",
  });

  const compat = buildVisualizationResultV2Compat({
    records: [...facts],
    dimensions: [],
    indicators: [indicator],
    organizations: [...organizations],
    scopedOrgIds: ["org-child", "org-child-2"],
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    projectId: "project-1",
    comparisonMode: "coordinator",
    drilldownFilters: {},
    chartMode: "auto",
    currentOrgId: "org-parent",
    scopeMode: "all_orgs",
    parentOrgId: null,
    selectedOrgIds: [],
  });

  assert.ok(legacy.comparisonChart);
  assert.ok(compat.comparisonChart);
  assert.equal(legacy.comparisonChart?.kind, "grouped-bar");
  assert.equal(compat.comparisonChart?.kind, "grouped-bar");
  assert.equal(legacy.comparisonChart?.drilldownDimension, "coordinator");
  assert.equal(compat.comparisonChart?.drilldownDimension, "coordinator");

  if (legacy.comparisonChart?.kind !== "grouped-bar" || compat.comparisonChart?.kind !== "grouped-bar") {
    return;
  }

  assert.deepEqual(legacy.comparisonChart.data, [
    { category: "Parent Org", actual: 30, target: 55 },
  ]);
  assert.deepEqual(compat.comparisonChart.data, [
    { category: "Parent Org", actual: 30, target: 55 },
  ]);
});
