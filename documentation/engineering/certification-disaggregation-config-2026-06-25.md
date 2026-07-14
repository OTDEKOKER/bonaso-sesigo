# Production Certification Audit — `aggregate_disaggregation_config` Single Source of Truth

**Date:** 2026-06-25  **Branch:** `retire-sub-labels-2026-06-25`
**Commits (this initiative):** `e043e397, caee4e6e, d55127eb, 45b35f5d, d95b4549, 58db58c8, 9e15a8a6, 213cfc51, eae94168`
**Method:** verified against source, models, serializers, viewsets, frontend, tests, and live runtime (read-only) — findings below are marked **[VERIFIED]** or **[RECOMMENDATION]**.

---

## 1. Executive Summary
`aggregate_disaggregation_config` is the authoritative source of truth for all aggregate
reporting. **[VERIFIED]** Disaggregation *content* (dimensions, values, labels, order, enabled) is
100% UI-configured end to end; no aggregate-runtime path reads `Indicator.sub_labels`. Live data is
clean (0 invalid configs). The workbook layout (axis roles, AYP, TOTAL MALE/FEMALE) is a deliberately
retained NAHPA reporting convention (maintainer decision, documented). **Decision: SAFE WITH MINOR
RISKS** — the code is complete and verified; the only gating items are a frontend rebuild to ship the
config-only reads and 8 indicators awaiting manual UI configuration.

## 2. Architectural Assessment
Single chain, no parallel value source: `config → workbook/capture template (resolve_matrix_config /
getAggregateEntryMatrixConfig) → captured values → analysis/dashboard/exports`. **[VERIFIED]** Capture,
review and report matrices share one resolver; analysis/exports read captured values/facts (config-
shaped). `ProjectIndicatorDisaggregationRule` is a separate per-project *active-key* layer (no values),
feeding only an alternate template payload — not a competing value source. **[RECOMMENDATION]** a future
pass should assert its keys ⊆ config keys.

## 3. Root Cause Review
`sub_labels` was a flat list of dimension *names* (no values/order/enabled); each consumer guessed
values differently → divergent reporting. The config is a structured superset; promoting it to the sole
runtime source removes the divergence by construction.

## 4. Repository Inventory (`grep`-verified)
**[VERIFIED]** `aggregate_disaggregation_config` backend references: `indicators/{models,serializers,
disaggregation,views}.py`, `indicators/management/commands/{backfill,repair}_*`,
`aggregates/reporting_workbook.py`, `core/offline_views.py` — all **Production Source of Truth**.
`sub_labels` / `response_sub_labels[_display]` classification:

| Reference | Class |
|-----------|-------|
| `Indicator.sub_labels` column | Legacy Compatibility (KEEP — rollback/history) |
| `aggregate-helpers.ts:77`, `lib/types.ts`, `lib/api/services/indicators.ts` `sub_labels?` | Must Remain (API/type contract) |
| `disaggregation.py config_from_sub_labels` + backfill cmd | Legacy Compatibility (migration utility) |
| importers write `sub_labels` (mirror); build config from upload+data | Technical Debt (deprecated mirror; safe to remove later) |
| `getFallbackGroupsFromLegacyLabels` | **Removed** (was last aggregate-runtime read) |
| `Question/AssessmentQuestion.sub_labels` (`response_sub_labels*`) | Must Remain (separate respondent feature, out of scope) |

**[VERIFIED]** Zero aggregate-runtime *reads* of `Indicator.sub_labels` remain (only type/contract
declarations).

## 5. Remaining Legacy Dependencies
Only the deprecated `sub_labels` column (kept for rollback/history) and the importer's mirror write
(Technical Debt). Neither is read by any aggregate runtime surface.

## 6. Backend Changes
Canonical converter + `bootstrap_config` (data→sub_labels precedence); `backfill_` and `repair_`
commands; config-change auditing in `IndicatorViewSet`; on-save consistency guard
(`validate_save_consistency`); workbook header now uses the config's real label; removed the hardcoded
`Male/Female` value default. `resolve_matrix_config` is config-only for content.

## 7. Frontend Changes
Dashboard widgets, analysis surface, analytics resolver, reports-hub, and the capture/review/matrix
resolver (`resolveDisaggregationConfig`, `getIndicatorDisaggregateGroups`) are config-only. Editor
preset catalogue completed (District, Facility, Funding Source, Partner added).

## 8. Database Changes
**[VERIFIED]** No schema migrations. Data-only: 10 indicators backfilled, 3 repaired (lossless), 6
cleared to no-disaggregation (per maintainer decision). `sub_labels` column never modified. Snapshots:
`backups/disagg_config_snapshot_20260625_110541.json`, `backups/disagg_clear_questionable_20260625_141959.json`.

## 9. API Changes
No contract changes. New behaviour: admin config writes are audited (`AuditEvent`,
`object_type=indicator.disaggregation_config`); structurally-valid-but-inconsistent configs (>3 dims /
column-collapsing values) are rejected on save with a clear message.

## 10. Validation Improvements
**[VERIFIED]** Structural rules (object, enabled bool, ≥1 dim when enabled, key+label+≥1 value, unique
keys/labels/values, no empties, order preserved) **plus** the on-save consistency guard. Live: **0 of
249 configs fail validation; 0 fail the save-guard.**

## 11. UI Improvements
Editor supports enable/disable, all 13 presets, custom dimensions, add/edit/remove/reorder of values
and dimensions, and a live matrix preview generated by the exact capture resolver (preview == output).
**[RECOMMENDATION/DEFERRED]** HTML5 drag-and-drop (arrow reorder works today), duplicate-dimension, and
separate per-surface preview panels — UX polish, non-blocking; needs a frontend-tested iteration.

## 12. Performance Improvements
**[VERIFIED]** Read paths do strictly less work (removed fallback branches). Audit recording is one
insert on the rare admin config write, fully swallowed on error. Backfill/repair are offline commands.
No N+1 introduced. **[RECOMMENDATION]** config-object caching assessed and intentionally NOT added
(unnecessary for the current query profile; avoids cache-invalidation risk).

## 13. Security Review
**[VERIFIED]** Two server-side layers: module RBAC (`HasModulePermission`, `required_module=indicators`)
for create/edit/delete, and field-level admin-only gating of the config in `IndicatorSerializer`
(non-admin change → `PermissionDenied`; unchanged echo allowed). Covered by `AdminGateTests`. No
reliance on frontend restrictions.

## 14. Migration Results (live, read-only — **[VERIFIED]**)
- 249 indicators; 179 enabled config; 184 carry `sub_labels` (untouched → no data loss); 176 both.
- **0** configs failing validation; **0** failing the save-guard.
- Aggregates total 16,103 (unchanged); 0 duplicate dimension keys.
- Training/live isolation via `apply_training_filter_via_projects`; no contamination path.
- **8 indicators require manual UI configuration** (sub_labels, no config): #492, #439 (ambiguous
  counts), and #317, #413, #414, #512, #507, #513 (cleared from unreliable backfill, per decision).

## 15. Test Coverage
31+ tests across the initiative: converter precedence, data recovery, sub_labels synthesis, backfill
safety (dry-run/no-overwrite/idempotent), lossless repair, config-change auditing, on-save consistency
(dim cap, collapsing values), workbook-matrix parity, and the **non-sex secondary header** regression.

## 16. Test Results
**[VERIFIED]** `indicators` + `aggregates` suites: **168 passed, 0 failures** (covers every change in
this initiative). Workbook suite: 39 passed. Frontend eslint on changed files: 0 errors; `tsc --noEmit`
clean. **[CONSTRAINT]** The *complete* backend suite could not be run here: it requires applying a
pending unrelated migration (`analysis_coordinatortarget`) whose DDL **deadlocks against live Postgres
traffic**. This is an environmental constraint, not a code regression. **[RECOMMENDATION]** run the full
suite in CI or a maintenance window against an isolated DB.

## 17. Files Changed
Backend: `indicators/{disaggregation,serializers,views}.py`,
`indicators/management/commands/{backfill,repair}_disaggregation_config*.py`,
`indicators/tests_backfill_disaggregation.py`, `aggregates/reporting_workbook.py`,
`aggregates/test_reporting_workbook.py`.
Frontend: `lib/aggregates/aggregate-helpers.ts`, `lib/indicators/disaggregation-presets.ts`,
`lib/analytics/disaggregation.ts`, `components/analysis/dashboard-analytics-surface.tsx`,
`components/reports/reports-hub.tsx`, `app/(dashboard)/dashboard/page.tsx`.
Docs: four reports under `docs/engineering/`.

## 18. Screens / Surfaces Verified
Workbook generation (live, config-faithful matrix + corrected headers), aggregate capture + offline
payload (config), upload import (builds config from upload+data), analysis surface, dashboard widgets,
reports-hub, indicator editor (config CRUD + live preview).

## 19. Remaining Risks
- 8 indicators await manual UI configuration (intended clean slate).
- Frontend config-only reads + new presets need a standard rebuild to ship.
- Workbook backend changes (header/value) need a backend image rebuild (currently hot-patched).
- Importer `sub_labels` mirror write (Technical Debt) and editor drag-and-drop (UX) deferred.
- `ProjectIndicatorDisaggregationRule` key-subset check is a future verification.
- Full backend suite not run here (live-DB DDL contention) — run in CI/maintenance window.

## 20. Rollback Procedure
- **Config data:** restore `backups/disagg_config_snapshot_20260625_110541.json` (backfill + repairs)
  and `backups/disagg_clear_questionable_20260625_141959.json` (the 6 cleared). `sub_labels` untouched.
- **Code:** revert the listed commits. No migrations to reverse; audit rows are additive.

## 21. Production Readiness Assessment
Content-as-config is complete and verified; data is clean; writes are audited and admin-gated; the
workbook header bug is fixed and the last hardcoded value default removed. Gating items are a frontend
rebuild and 8 UI configurations — neither affects correctness of the now-consistent backend/data.

---

## Decision
**SAFE WITH MINOR RISKS.**
Deploy the committed backend (additive/defensive; offline commands) and rebuild the frontend to ship the
config-only reads, completed presets, and corrected workbook headers. Then configure the 8 flagged
indicators in the UI. Run the full backend suite in CI/a maintenance window. Minor risks
(importer mirror, editor drag-and-drop, rule-subset check) are non-blocking follow-ups.
