import assert from "node:assert/strict";
import { test } from "@playwright/test";

import type { VisualizationChart, VisualizationKpi, VisualizationResult } from "./engine.ts";
import { buildVisualizationResult } from "./engine.ts";
import { buildVisualizationResultV2Compat } from "./engine-v2-compat.ts";
import {
  dashboardValidationScenarios,
  type ValidationScenario,
} from "./dashboard-analytics-validation.fixtures.ts";

type ScenarioOutputs = {
  legacy: VisualizationResult;
  compat: VisualizationResult;
};

type Mismatch = {
  scenarioId: string;
  field: string;
  legacy: unknown;
  compat: unknown;
  classification: "expected" | "unexpected";
};

const EXPECTED_MISMATCHES = new Set([
  "hiv-positives-by-sex-and-age::target",
  "hiv-positives-by-sex-and-age::achievement",
  "hiv-positives-by-sex-and-age::disaggregation-order",
  "mental-health-funnel::funnel-steps",
  "ncd-screening-by-screening-type::disaggregation-order",
]);

function buildScenarioOutputs(scenario: ValidationScenario): ScenarioOutputs {
  const common = {
    dimensions: scenario.dimensions,
    indicators: scenario.indicators,
    organizations: scenario.organizations,
    scopedOrgIds: scenario.scopedOrgIds,
    selectedPeriods: scenario.selectedPeriods,
    periodMode: scenario.periodMode,
    projectId: scenario.legacyFacts[0]?.projectId ?? scenario.compatFacts[0]?.projectId ?? null,
    comparisonMode: scenario.comparisonMode,
    drilldownFilters: {},
    chartMode: scenario.chartMode ?? "auto",
  } as const;

  return {
    legacy: buildVisualizationResult({
      ...common,
      records: scenario.legacyFacts,
    }),
    compat: buildVisualizationResultV2Compat({
      ...common,
      records: scenario.compatFacts,
      currentOrgId: scenario.currentOrgId ?? null,
      scopeMode: scenario.scopeMode ?? "all_orgs",
      parentOrgId: scenario.parentOrgId ?? null,
      selectedOrgIds: scenario.selectedOrgIds ?? [],
    }),
  };
}

function getKpi(result: VisualizationResult, title: string): VisualizationKpi {
  const kpi = result.kpis.find((entry) => entry.title === title);
  assert.ok(kpi, `Expected KPI "${title}" to exist`);
  return kpi;
}

function parseFormattedNumber(value: string) {
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function getTargetValue(result: VisualizationResult) {
  const kpi = getKpi(result, "Target");
  return kpi.value === "No target" ? null : parseFormattedNumber(kpi.value);
}

function getAchievementValue(result: VisualizationResult) {
  const kpi = getKpi(result, "Target");
  const match = kpi.helper.match(/(\d+(?:\.\d+)?)%/);
  return match ? `${Number(match[1]).toFixed(1)}%` : null;
}

function getTotalValue(result: VisualizationResult) {
  const kpi = getKpi(result, "Total reported");
  return parseFormattedNumber(kpi.value);
}

function getComparisonRows(chart: VisualizationChart | null) {
  if (!chart) return [];
  if (chart.kind !== "grouped-bar" && chart.kind !== "bar") return [];
  return chart.data.map((row) => ({
    name: String(row[chart.xKey] ?? row.category ?? ""),
    actual: Number(row.actual ?? row.value ?? 0),
    target:
      row.target === undefined || row.target === null ? undefined : Number(row.target),
  }));
}

function getDisaggregationOrder(chart: VisualizationChart | null) {
  if (!chart) return [];
  if (
    chart.kind !== "bar" &&
    chart.kind !== "grouped-bar" &&
    chart.kind !== "stacked-bar" &&
    chart.kind !== "trend"
  ) {
    return [];
  }

  return chart.data.map((row) => String(row[chart.xKey] ?? row.category ?? ""));
}

function getFunnelSteps(chart: VisualizationChart | null) {
  if (!chart || (chart.kind !== "funnel" && chart.kind !== "cascade")) return [];
  return chart.steps.map((step) => ({
    label: step.label.toLowerCase(),
    value: step.value,
  }));
}

function getExpectedMismatchClassification(scenarioId: string, field: string) {
  return EXPECTED_MISMATCHES.has(`${scenarioId}::${field}`) ? "expected" : "unexpected";
}

function collectMismatchReport(): Mismatch[] {
  const mismatches: Mismatch[] = [];

  dashboardValidationScenarios.forEach((scenario) => {
    const { legacy, compat } = buildScenarioOutputs(scenario);
    const legacyTarget = getTargetValue(legacy);
    const compatTarget = getTargetValue(compat);
    if (legacyTarget !== compatTarget) {
      mismatches.push({
        scenarioId: scenario.id,
        field: "target",
        legacy: legacyTarget,
        compat: compatTarget,
        classification: getExpectedMismatchClassification(scenario.id, "target"),
      });
    }

    const legacyAchievement = getAchievementValue(legacy);
    const compatAchievement = getAchievementValue(compat);
    if (legacyAchievement !== compatAchievement) {
      mismatches.push({
        scenarioId: scenario.id,
        field: "achievement",
        legacy: legacyAchievement,
        compat: compatAchievement,
        classification: getExpectedMismatchClassification(scenario.id, "achievement"),
      });
    }

    if (scenario.expected.dimensionOrder) {
      const legacyDisaggregationOrder = getDisaggregationOrder(legacy.disaggregationChart);
      const compatDisaggregationOrder = getDisaggregationOrder(compat.disaggregationChart);
      if (legacyDisaggregationOrder.join("|") !== compatDisaggregationOrder.join("|")) {
        mismatches.push({
          scenarioId: scenario.id,
          field: "disaggregation-order",
          legacy: legacyDisaggregationOrder,
          compat: compatDisaggregationOrder,
          classification: getExpectedMismatchClassification(
            scenario.id,
            "disaggregation-order",
          ),
        });
      }
    }

    if (scenario.expected.funnelSteps) {
      const legacyFunnelSteps = getFunnelSteps(legacy.funnelChart);
      const compatFunnelSteps = getFunnelSteps(compat.funnelChart);
      if (JSON.stringify(legacyFunnelSteps) !== JSON.stringify(compatFunnelSteps)) {
        mismatches.push({
          scenarioId: scenario.id,
          field: "funnel-steps",
          legacy: legacyFunnelSteps,
          compat: compatFunnelSteps,
          classification: getExpectedMismatchClassification(
            scenario.id,
            "funnel-steps",
          ),
        });
      }
    }
  });

  return mismatches;
}

for (const scenario of dashboardValidationScenarios) {
  test(`dashboard analytics scenario: ${scenario.label}`, () => {
    const { legacy, compat } = buildScenarioOutputs(scenario);

    assert.equal(getTotalValue(legacy), scenario.expected.total);
    assert.equal(getTotalValue(compat), scenario.expected.total);

    if (scenario.expected.target !== undefined) {
      assert.equal(getTargetValue(compat), scenario.expected.target);
    }

    if (scenario.expected.achievementPercent !== undefined) {
      assert.equal(getAchievementValue(compat), scenario.expected.achievementPercent);
    }

    if (scenario.expected.organizationRollups) {
      assert.deepEqual(
        getComparisonRows(legacy.comparisonChart),
        scenario.expected.organizationRollups,
      );
      assert.deepEqual(
        getComparisonRows(compat.comparisonChart),
        scenario.expected.organizationRollups,
      );
    }

    if (scenario.id === "condom-distribution-selected-child-org") {
      assert.deepEqual(
        Array.from(new Set(compat.normalizedRecords.map((record) => record.organizationId))),
        ["org-alpha"],
      );
      assert.equal(compat.table.rawRows.length, 1);
    }

    if (scenario.expected.dimensionOrder) {
      assert.deepEqual(
        getDisaggregationOrder(compat.disaggregationChart),
        scenario.expected.dimensionOrder,
      );
    }

    if (scenario.expected.funnelSteps) {
      assert.deepEqual(getFunnelSteps(compat.funnelChart), scenario.expected.funnelSteps);
    }
  });
}

test("mismatch report contains only expected smarter-v2 differences", () => {
  const mismatches = collectMismatchReport();

  assert.deepEqual(
    mismatches.map((entry) => ({
      scenarioId: entry.scenarioId,
      field: entry.field,
      classification: entry.classification,
    })),
    [
      {
        scenarioId: "hiv-positives-by-sex-and-age",
        field: "disaggregation-order",
        classification: "expected",
      },
      {
        scenarioId: "mental-health-funnel",
        field: "funnel-steps",
        classification: "expected",
      },
      {
        scenarioId: "ncd-screening-by-screening-type",
        field: "disaggregation-order",
        classification: "expected",
      },
    ],
  );

  assert.equal(
    mismatches.filter((entry) => entry.classification === "unexpected").length,
    0,
  );
});

test("hiv positives targets and achievement stay aligned across engines", () => {
  const scenario = dashboardValidationScenarios.find(
    (entry) => entry.id === "hiv-positives-by-sex-and-age",
  );
  assert.ok(scenario, "Expected HIV positives scenario fixture");

  const { legacy, compat } = buildScenarioOutputs(scenario);

  assert.equal(getTargetValue(legacy), 50);
  assert.equal(getTargetValue(compat), 50);
  assert.equal(getAchievementValue(legacy), "36.0%");
  assert.equal(getAchievementValue(compat), "36.0%");
});

test("selected child organization scope filters compat facts before aggregation", () => {
  const scenario = dashboardValidationScenarios.find(
    (entry) => entry.id === "condom-distribution-selected-child-org",
  );
  assert.ok(scenario, "Expected condom distribution scenario fixture");

  const { compat } = buildScenarioOutputs(scenario);

  assert.equal(compat.normalizedRecords.length, 1);
  assert.equal(compat.normalizedRecords[0]?.organizationId, "org-alpha");
  assert.equal(compat.normalizedRecords[0]?.value, 140);
});

test("v2 funnel keeps screening to counselling to referral order", () => {
  const scenario = dashboardValidationScenarios.find(
    (entry) => entry.id === "mental-health-funnel",
  );
  assert.ok(scenario, "Expected mental health scenario fixture");

  const { legacy, compat } = buildScenarioOutputs(scenario);

  assert.deepEqual(getFunnelSteps(compat.funnelChart), [
    { label: "screened", value: 120 },
    { label: "counselling", value: 70 },
    { label: "referred", value: 30 },
  ]);
  assert.notDeepEqual(getFunnelSteps(legacy.funnelChart), getFunnelSteps(compat.funnelChart));
});

test("v2 dimension ordering is stable for age bands and screening types", () => {
  const expectations = [
    {
      id: "hiv-positives-by-sex-and-age",
      expected: ["15-19", "20-24", "25-29"],
    },
    {
      id: "ncd-screening-by-screening-type",
      expected: ["Blood glucose", "Blood pressure", "BMI"],
    },
  ];

  expectations.forEach(({ id, expected }) => {
    const scenario = dashboardValidationScenarios.find((entry) => entry.id === id);
    assert.ok(scenario, `Expected scenario fixture for ${id}`);

    const { legacy, compat } = buildScenarioOutputs(scenario);

    assert.deepEqual(getDisaggregationOrder(compat.disaggregationChart), expected);
    assert.notDeepEqual(getDisaggregationOrder(legacy.disaggregationChart), expected);
  });
});
