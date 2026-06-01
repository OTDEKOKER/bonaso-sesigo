import type { AnalyticsComparisonMode, AnalyticsFact, AnalyticsPeriodMode } from "../analytics/query-builder";
import type { AnalyticsScopeMode } from "../analytics/org-scope";
import type { Indicator, Organization } from "../types";

export type ValidationScenario = {
  id: string;
  label: string;
  legacyFacts: AnalyticsFact[];
  compatFacts: AnalyticsFact[];
  indicators: Indicator[];
  organizations: Organization[];
  scopedOrgIds: string[];
  selectedPeriods: string[];
  periodMode: AnalyticsPeriodMode;
  comparisonMode: AnalyticsComparisonMode;
  dimensions: string[];
  chartMode?: "auto";
  scopeMode?: AnalyticsScopeMode;
  parentOrgId?: string | null;
  selectedOrgIds?: string[];
  currentOrgId?: string | null;
  expected: {
    total: number;
    target?: number | null;
    achievementPercent?: string | null;
    organizationRollups?: Array<{ name: string; actual: number; target?: number }>;
    dimensionOrder?: string[];
    funnelSteps?: Array<{ label: string; value: number }>;
  };
};

const organizations: Organization[] = [
  {
    id: "org-parent",
    name: "Parent Org",
    type: "coordinator",
    createdAt: "2025-04-01",
  },
  {
    id: "org-alpha",
    name: "Alpha Org",
    type: "subgrantee",
    parentId: "org-parent",
    createdAt: "2025-04-01",
  },
  {
    id: "org-beta",
    name: "Beta Org",
    type: "subgrantee",
    parentId: "org-parent",
    createdAt: "2025-04-01",
  },
];

function makeIndicator(input: Partial<Indicator> & Pick<Indicator, "id" | "name" | "code" | "category" | "type">): Indicator {
  return {
    is_active: true,
    created_at: "2025-04-01",
    updated_at: "2025-04-01",
    ...input,
  };
}

function makeFact(input: AnalyticsFact): AnalyticsFact {
  return input;
}

const hivTestingIndicator = makeIndicator({
  id: "ind-hiv-testing",
  name: "HIV testing",
  code: "HTS-1",
  category: "hiv_prevention",
  type: "number",
  project_targets: [
    {
      id: "target-hiv-alpha",
      project: "project-hiv",
      indicator: "ind-hiv-testing",
      organization: "org-alpha",
      q1_target: 60,
      target_value: 60,
      current_value: 0,
      baseline_value: 0,
      progress: 0,
    },
    {
      id: "target-hiv-beta",
      project: "project-hiv",
      indicator: "ind-hiv-testing",
      organization: "org-beta",
      q1_target: 110,
      target_value: 110,
      current_value: 0,
      baseline_value: 0,
      progress: 0,
    },
  ],
});

const hivPositivesIndicator = makeIndicator({
  id: "ind-hiv-positive",
  name: "HIV positives identified",
  code: "HTS-2",
  category: "hiv_prevention",
  type: "number",
  project_targets: [
    {
      id: "target-pos-alpha",
      project: "project-hiv",
      indicator: "ind-hiv-positive",
      organization: "org-alpha",
      q1_target: 20,
      target_value: 20,
      current_value: 0,
      baseline_value: 0,
      progress: 0,
    },
    {
      id: "target-pos-beta",
      project: "project-hiv",
      indicator: "ind-hiv-positive",
      organization: "org-beta",
      q1_target: 30,
      target_value: 30,
      current_value: 0,
      baseline_value: 0,
      progress: 0,
    },
  ],
});

const condomDistributionIndicator = makeIndicator({
  id: "ind-condoms",
  name: "Condoms distributed",
  code: "PREV-1",
  category: "hiv_prevention",
  type: "number",
  project_targets: [
    {
      id: "target-condom-alpha",
      project: "project-hiv",
      indicator: "ind-condoms",
      organization: "org-alpha",
      q1_target: 200,
      target_value: 200,
      current_value: 0,
      baseline_value: 0,
      progress: 0,
    },
    {
      id: "target-condom-beta",
      project: "project-hiv",
      indicator: "ind-condoms",
      organization: "org-beta",
      q1_target: 300,
      target_value: 300,
      current_value: 0,
      baseline_value: 0,
      progress: 0,
    },
  ],
});

const mentalHealthIndicators = [
  makeIndicator({
    id: "ind-mental-screening",
    name: "Mental health screening",
    code: "MH-1",
    category: "mental_health",
    type: "number",
  }),
  makeIndicator({
    id: "ind-mental-counselling",
    name: "Mental health counselling",
    code: "MH-2",
    category: "mental_health",
    type: "number",
  }),
  makeIndicator({
    id: "ind-mental-referral",
    name: "Mental health referral",
    code: "MH-3",
    category: "mental_health",
    type: "number",
  }),
];

const ncdIndicator = makeIndicator({
  id: "ind-ncd-screening",
  name: "NCD screening",
  code: "NCD-1",
  category: "ncd",
  type: "number",
});

export const dashboardValidationScenarios: ValidationScenario[] = [
  {
    id: "hiv-testing-vs-target-by-organization",
    label: "HIV testing vs target by organization",
    legacyFacts: [
      makeFact({
        aggregateId: "agg-hiv-test-alpha",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-hiv-testing",
        indicatorName: "HIV testing",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 40,
        disaggregates: {},
      }),
      makeFact({
        aggregateId: "agg-hiv-test-beta",
        organizationId: "org-beta",
        organizationName: "Beta Org",
        indicatorId: "ind-hiv-testing",
        indicatorName: "HIV testing",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 55,
        disaggregates: {},
      }),
    ],
    compatFacts: [],
    indicators: [hivTestingIndicator],
    organizations,
    scopedOrgIds: ["org-alpha", "org-beta"],
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    comparisonMode: "organization",
    dimensions: [],
    scopeMode: "all_orgs",
    currentOrgId: "org-parent",
    expected: {
      total: 95,
      target: 170,
      achievementPercent: "55.9%",
      organizationRollups: [
        { name: "Beta Org", actual: 55, target: 110 },
        { name: "Alpha Org", actual: 40, target: 60 },
      ],
    },
  },
  {
    id: "hiv-positives-by-sex-and-age",
    label: "HIV positives by sex and age",
    legacyFacts: [
      makeFact({
        aggregateId: "agg-hiv-pos-alpha",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-hiv-positive",
        indicatorName: "HIV positives identified",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 4,
        disaggregates: { sex: "Female", age_band: "20-24" },
      }),
      makeFact({
        aggregateId: "agg-hiv-pos-alpha",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-hiv-positive",
        indicatorName: "HIV positives identified",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 3,
        disaggregates: { sex: "Male", age_band: "25-29" },
      }),
      makeFact({
        aggregateId: "agg-hiv-pos-beta",
        organizationId: "org-beta",
        organizationName: "Beta Org",
        indicatorId: "ind-hiv-positive",
        indicatorName: "HIV positives identified",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 6,
        disaggregates: { sex: "Female", age_band: "15-19" },
      }),
      makeFact({
        aggregateId: "agg-hiv-pos-beta",
        organizationId: "org-beta",
        organizationName: "Beta Org",
        indicatorId: "ind-hiv-positive",
        indicatorName: "HIV positives identified",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 5,
        disaggregates: { sex: "Male", age_band: "20-24" },
      }),
    ],
    compatFacts: [],
    indicators: [hivPositivesIndicator],
    organizations,
    scopedOrgIds: ["org-alpha", "org-beta"],
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    comparisonMode: "period",
    dimensions: ["age_band", "sex"],
    scopeMode: "all_orgs",
    currentOrgId: "org-parent",
    expected: {
      total: 18,
      target: 50,
      achievementPercent: "36.0%",
      organizationRollups: [
        { name: "Beta Org", actual: 11, target: 30 },
        { name: "Alpha Org", actual: 7, target: 20 },
      ],
      dimensionOrder: ["15-19", "20-24", "25-29"],
    },
  },
  {
    id: "condom-distribution-selected-child-org",
    label: "Condom distribution by selected child org vs target",
    legacyFacts: [
      makeFact({
        aggregateId: "agg-condom-alpha",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-condoms",
        indicatorName: "Condoms distributed",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 140,
        disaggregates: {},
      }),
    ],
    compatFacts: [
      makeFact({
        aggregateId: "agg-condom-alpha",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-condoms",
        indicatorName: "Condoms distributed",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 140,
        disaggregates: {},
      }),
      makeFact({
        aggregateId: "agg-condom-beta",
        organizationId: "org-beta",
        organizationName: "Beta Org",
        indicatorId: "ind-condoms",
        indicatorName: "Condoms distributed",
        projectId: "project-hiv",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 210,
        disaggregates: {},
      }),
    ],
    indicators: [condomDistributionIndicator],
    organizations,
    scopedOrgIds: ["org-alpha"],
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    comparisonMode: "organization",
    dimensions: [],
    scopeMode: "selected_orgs",
    selectedOrgIds: ["org-alpha"],
    currentOrgId: "org-parent",
    expected: {
      total: 140,
      target: 200,
      achievementPercent: "70.0%",
      organizationRollups: [{ name: "Alpha Org", actual: 140, target: 200 }],
    },
  },
  {
    id: "mental-health-funnel",
    label: "Mental health screening to counselling to referral funnel",
    legacyFacts: [
      makeFact({
        aggregateId: "agg-mental-screening",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-mental-screening",
        indicatorName: "Mental health screening",
        projectId: "project-mental",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 120,
        disaggregates: {},
      }),
      makeFact({
        aggregateId: "agg-mental-counselling",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-mental-counselling",
        indicatorName: "Mental health counselling",
        projectId: "project-mental",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 70,
        disaggregates: {},
      }),
      makeFact({
        aggregateId: "agg-mental-referral",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-mental-referral",
        indicatorName: "Mental health referral",
        projectId: "project-mental",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 30,
        disaggregates: {},
      }),
    ],
    compatFacts: [],
    indicators: mentalHealthIndicators,
    organizations,
    scopedOrgIds: ["org-alpha"],
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    comparisonMode: "period",
    dimensions: [],
    scopeMode: "all_orgs",
    currentOrgId: "org-parent",
    expected: {
      total: 220,
      funnelSteps: [
        { label: "screened", value: 120 },
        { label: "counselling", value: 70 },
        { label: "referred", value: 30 },
      ],
    },
  },
  {
    id: "ncd-screening-by-screening-type",
    label: "NCD screening by screening type",
    legacyFacts: [
      makeFact({
        aggregateId: "agg-ncd-bp",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-ncd-screening",
        indicatorName: "NCD screening",
        projectId: "project-ncd",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 18,
        disaggregates: { screening_type: "Blood pressure" },
      }),
      makeFact({
        aggregateId: "agg-ncd-bmi",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-ncd-screening",
        indicatorName: "NCD screening",
        projectId: "project-ncd",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 12,
        disaggregates: { screening_type: "BMI" },
      }),
      makeFact({
        aggregateId: "agg-ncd-bg",
        organizationId: "org-alpha",
        organizationName: "Alpha Org",
        indicatorId: "ind-ncd-screening",
        indicatorName: "NCD screening",
        projectId: "project-ncd",
        periodLabel: "Q1 2025/26",
        periodStart: "2025-04-01",
        periodEnd: "2025-06-30",
        value: 15,
        disaggregates: { screening_type: "Blood glucose" },
      }),
    ],
    compatFacts: [],
    indicators: [ncdIndicator],
    organizations,
    scopedOrgIds: ["org-alpha"],
    selectedPeriods: ["Q1 2025/26"],
    periodMode: "quarter",
    comparisonMode: "period",
    dimensions: ["screening_type"],
    scopeMode: "all_orgs",
    currentOrgId: "org-parent",
    expected: {
      total: 45,
      dimensionOrder: ["Blood glucose", "Blood pressure", "BMI"],
    },
  },
];

dashboardValidationScenarios.forEach((scenario) => {
  if (scenario.compatFacts.length === 0) {
    scenario.compatFacts = [...scenario.legacyFacts];
  }
});
