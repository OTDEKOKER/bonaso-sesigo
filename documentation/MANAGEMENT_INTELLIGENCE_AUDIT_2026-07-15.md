# SESIGO Management Intelligence — Phase 1 Read-Only Audit (2026-07-15)

Branch: `feature/management-intelligence-echarts-2026-07`.
Scope: read-only. No production deploy, no data/schema/migration changes.
Benchmark source: `downloads/Annual Social Contracting Report 2026 (DRAFT).docx`
(Executive Summary, Table 1–2, Figures 1–21, Conclusions, Recommendations) and its
machine-readable twin `backend/funder_reports/management/commands/seed_nahpa_report.py`.

This document is the **gate**: implementation begins only after this matrix + audit.

---

## 1.1 Report benchmark matrix

The report's 21 figures + 3 tables collapse into **8 analytical archetypes**. Each
already has a `funder_reports.ChartType` and curated indicator mapping, so the
intelligence layer re-uses that config rather than re-deriving figures.

| # | Report section / figure | Indicators (source) | Calculation | Grouping (Dimension) | Target | Interpretation the report makes | Proposed SESIGO visual (ECharts) |
|---|---|---|---|---|---|---|---|
| T1 | Table 1 — Compliance to Reporting (Q) | none (submission/period data) | submission status per coord × quarter | coordinator × period | n/a | who submitted / late / missing | **compliance matrix** (status badges) + attention feed |
| T2 | Table 2 — CSO capacity/comms highlights | capacity indicators | sum, count of orgs | coordinator | none | qualitative highlights | **table** + horizontal ranked bar |
| A | Fig 1,5,6 — reached by *message type* / social media | #372/#373 etc. (type carried in disaggregation `primary`) | sum | indicator/`primary` | none/project | dominant channels | **stacked/grouped bar** by message type |
| B | Fig 2,7.1,10,10.2 — reached/tested/condoms *against targets by CSO* | mapped per figure | achievement % = achieved/target×100 | coordinator | **org_quarter** (coordinator target) | best/worst CSO vs target ("BONEPWA+ 150%, MBGE 36%") | **achieved_vs_target** bar + % labels + best/worst callout |
| C | Fig 4,7.2,7.3,10.1,14.2 — by *sex* / *age × sex* / KVP | mapped | sum | sex / age / key_population | project | sex/age skew ("63% female") | **heatmap (age×sex)** / grouped bar by sex |
| D | Fig 8,11,12,13.1,15 — referral & *cascades* (tested→positive→ART; screen→refer→link) | ordered indicators | stage counts + stage-to-stage drop-off | period/indicator | none | conversion/leakage ("51% initiated on ART") | **cascade/funnel** with drop-off % between stages |
| E | Fig 16.1,16.2,17.2 — NCD/mental-health screening by *category* | mapped | sum | key_population/`primary` | project | screening coverage | **grouped bar**/donut by category |
| F | Fig 19,20,21 & Table 3.1/3.2 — activities/training/rights *against targets* | mapped | sum + achievement % | coordinator/indicator | org_quarter/project | activity volume vs target | **achieved_vs_target** + ranked bar |
| G | Conclusions / Recommendations | derived from A–F | — | — | — | Obj-1 strong (awareness), Obj-2 gaps (uptake/continuity, commodities, referral completion, male engagement, WLHIV) | **auto-interpretation + recommendation panel**, data-grounded only |

Interpretation pattern the report uses everywhere (the template for *automated*
interpretation): `achievement % vs target · highest & lowest CSO · non-submission
notes · sex/age skew · cascade drop-off`. All of these are computable from
approved data — **nothing must be invented** (constraint 14).

---

## 1.2 Visualisation-layer audit

**Recharts** — the whole live charting surface (~24 component files): analysis
`render-*-chart` (bar/line/stacked/funnel/heatmap), dashboard widgets,
`components/funder-reports/FigureChart.tsx`, `AggregateChartDialog`,
`components/reports/*`. Bar/line dominant.

**Funder FigureChart chart-type coverage** (recharts): handles `achieved_vs_target`,
`grouped_bar`, `stacked_bar`, `horizontal_bar`, `line`, `pie` (single-series only),
`cascade`, `table`, `compliance` (own badge table). **`heatmap` has no branch →
falls back to the default bar** (the "unsupported type → basic bar" gap the brief
calls out). `pie` with multiple series also degrades.

**Theme SSoT fragmentation (real):**
- `lib/chart-theme.ts` → `SESIGO_CHART_PALETTE` — the documented brand SSoT, kept
  byte-identical to the backend Excel export (`analysis/chart_theme.py`).
- `components/analysis/chart-theme.tsx` → a **separate teal-based** `categorical`
  palette + rich UI helpers (tooltip/legend/axis/formatters). Same series renders
  a different colour on the analysis dashboard vs the funder report / Excel export.
  → Phase 2+ should converge the categorical palette onto the brand SSoT.

**ECharts foundation (added earlier this session, commit `cf19b683`) — status:**
| Piece | State |
|---|---|
| `components/analysis/echarts/echart.tsx` (tree-shaken wrapper + `sesigo` theme from SSoT + `registerSesigoMap`) | **built, not yet rendered anywhere → untested** |
| `components/analysis/echarts/options.ts` (trend / where-bar / pace-gauge builders) | **built, unused** |
| `lib/intelligence/types.ts` (CoordinatorIntelligence contract) | **built, unused** |
| `components/intelligence/intelligence-card.tsx` (5-answer card) | **built, not wired to data, no page, untested** |
Verdict: a correct-looking foundation exists but is **partial + unused + untested**
until a backend contract + page render it. This audit supersedes the ad-hoc plan;
the foundation folds into Phase 2/3.

**Drill-down / filters / export (existing, reuse):** `lib/visualization/engine.ts`
(`DrilldownTarget`, dimension model), analysis dashboard filters + dashboard
preferences, `lib/chart-export.ts` + `chart-excel-export-button` (PNG/Excel).

---

## 1.3 Backend analytics — authoritative source map

| Concept | Authoritative source (SSoT) | Notes |
|---|---|---|
| Approved achievement (totals) | `analysis/services/coordinator_rollups.py` reading `Aggregate` filtered `status='approved'` | display-only FE; immune to fact-table drift |
| Approved achievement (disaggregated) | `AggregateFact` (`primary`=KVP/category, `secondary`=sex, `band`=age), `status='approved'`, `is_training=False` | 900k facts, verified coherent 2026-07-15 |
| Effective / derived target | derived-targets engine (fixed/achieved/percentage) over `ProjectIndicatorOrganizationTarget` | **coordinator-keyed rows only** are populated (user-confirmed); sub rows are zero placeholders; `ProjectIndicator.q*_target` is a *derived rollup* |
| Reporting expectation + completeness | `aggregates/reporting_control.py` + `ReportingPeriod` + quarter-completion rule | late / missing / open / duplicate |
| Indicator assignment (who reports what) | `ProjectIndicatorAssignment` (`is_active`); **download gate = `WorkbookLayout`** | assignment ≠ downloadable |
| Organisation hierarchy | `ProjectOrganization.parent_assignment` + `Project.hierarchy_overrides` | 6 P3 coordinators; consistency check now cron'd |
| Disaggregation config | `Indicator.aggregate_disaggregation_config` (SSoT) | sub_labels retired |
| Reporting period / trend | `ReportingPeriod` (coverage + submission windows) | quarterly |
| Training vs live | `Project.is_training` → `AggregateFact.is_training`; JWT `mode` claim | never mix |
| Canonical indicator | `Indicator.canonical_indicator` + `canonical_id_map()` | rollups fold duplicates |
| Permission / scope | `get_user_organization_ids(user, project=)`; module perms; funder `_coordinator_map` restricts to caller | no cross-coordinator leak |
| Existing figure engine | `funder_reports` (`ReportFigure` + `ReportFigureIndicatorMapping`, 10 `ChartType`s, `Dimension`, `TargetMode`, `CalculationMode`) | **reproduces the report already — compose this** |

---

## Data-state taxonomy (constraint 15 — must be visually distinct)

| State | How determined |
|---|---|
| **Approved** | `Aggregate.status='approved'` |
| **Pending** | `status='pending'` (submitted, awaiting review) |
| **Reviewed** | `status='reviewed'` (mid two-tier, not yet approved) |
| **Rejected** | `status='rejected'` |
| **Flagged** | `status='flagged'` or open `Flag` |
| **Zero (reported)** | approved row with value 0 — a real reported zero |
| **Not reported / missing** | assigned indicator × org × elapsed period with **no** Aggregate row (`reporting_control` gap) |
| **Not applicable** | indicator not assigned to the org (no `ProjectIndicatorAssignment`) |
| **Incomplete** | period not fully elapsed (quarter-completion) or partial disaggregation |

Visual rule: a "reported 0" bar must never look like "not reported"; unapproved
data must never be summed into an approved total.

---

## Architectural recommendation (for Phase 2)

Build **one** project+period-scoped endpoint that *composes existing SSoTs*
(`coordinator_rollups` + derived targets + `reporting_control` + `flags` +
`funder_reports` figure config) into the intelligence contract. Do **not** add a
per-chart endpoint, re-implement targets/rollups, or touch the workbook path.
Every card carries: chart · principal finding · supporting evidence · DQ/completeness
qualifier · recommended action (data-grounded) · drill-down path. Approved data only.

---

## Phase 4 — Topography ('Where') read-only audit

**Coverage data reality (verified live):**
- **Project 2 (Annual Report dataset): NO district coverage** (0/89 orgs). A
  geographic map is not possible for the report's data; its "Where" is by-CSO.
- **Project 3: 73/89 orgs carry coverage**, but the 14 raw labels have DQ issues:
  `North West` vs `North-West`; `Gaborone` vs `Greater Gaborone`; `Gantsi`
  (=Ghanzi); `Francistown` (a city, not a district).
- Attribution is **org-level coverage** (which districts an org operates in), not
  per-record geo. So **presence counts are exact; per-district value sums would
  double-count** a multi-district org and are deliberately NOT produced.

**Normalisation (`analysis/services/geography.py`, DISPLAY mapping, reversible):**
14 raw labels → **11 standard Botswana regions**. Unambiguous fixes:
`North-West→North West`, `Gantsi→Ghanzi`. Documented judgement folds (easy to
change): `Francistown→North East`, `Greater Gaborone→Gaborone`. Validated live:
Central 22 orgs, North West 14, Kweneng 14, Gaborone 14, Southern 11, North East
11, Kgatleng 9, South East 8, Chobe 4, Kgalagadi 2, Ghanzi 1.

**Status:** exact presence-coverage service built + validated (read-only). The
echarts choropleth **frontend is blocked on a Botswana districts GeoJSON** (none
in the repo; provenance is the operator's call) + a build (runs on CI). The
intelligence cards already answer "Where" precisely via per-sub contributions;
the map is an additive spatial view on approximate coverage data, to be clearly
labelled as such.
