# Final Architecture Report — `aggregate_disaggregation_config` as the Single Runtime Source of Truth

**Date:** 2026-06-25  **Branch:** `retire-sub-labels-2026-06-25`
**Commits:** `e043e397`, `caee4e6e`, `d55127eb`, `45b35f5d`, `d95b4549`
**Scope guard:** aggregate disaggregation architecture only — no unrelated features/migrations/refactors.

---

## 1. Executive Summary
The aggregate reporting module now consumes `aggregate_disaggregation_config` **exclusively** at
runtime. Across three implementation passes the architecture was completed: backend resolvers and the
workbook were already config-only; this work made the **frontend capture/review/matrix path, dashboard,
analysis and reports** config-only, **eliminated every aggregate-runtime read of `sub_labels`**,
backfilled and repaired production configs, added config-change auditing, completed the editor preset
set, and added an **on-save consistency guard**. Backend suite: **167 passing**. eslint + tsc clean.
**Verdict: ⚠ SAFE WITH MINOR RISKS** (frontend rebuild required; deferred UX polish).

## 2. Root Cause Analysis
`sub_labels` was a flat list of dimension *names* with no values/order/enabled state; each consumer
guessed values differently, producing divergent reporting. `aggregate_disaggregation_config` is a
structured superset (keys + labels + ordered values + enabled). Making it the sole runtime source
removes the divergence by construction.

## 3. Architecture Review
Single chain, no parallel value sources:
`config → workbook/capture template (resolve_matrix_config / getAggregateEntryMatrixConfig) → captured
values → analysis/dashboard/exports`. Capture, review queue and report matrices share **one** resolver
(`resolveDisaggregationConfig`), now config-only. Analysis/exports read captured values/facts (which
were shaped by the config at capture time), so they reflect the config without re-reading labels.

## 4. Remaining Legacy Dependencies (full inventory)
| Reference | Layer | Classification |
|-----------|-------|----------------|
| `Indicator.sub_labels` column | DB | **KEEP (deprecated)** — rollback/history; no runtime aggregate read |
| `aggregate-helpers.ts:77` `sub_labels?` | FE type | **KEEP** — documents API shape; not a read |
| `lib/api/services/indicators.ts`, `lib/types.ts` `sub_labels?` | FE types | **KEEP** — API contract |
| `disaggregation-presets.ts migrateLegacySubLabelsToConfig` | FE | **KEEP** — editor seeding for legacy indicators (migration/UI bootstrap) |
| `indicators/page.tsx`, `edit/_PageContent.tsx` derive `sub_labels` on save | FE | **KEEP** — write only; feeds out-of-scope respondent `multi_int` |
| `disaggregation.py config_from_sub_labels`, backfill cmd | BE | **KEEP** — migration utility only |
| Importers write `sub_labels` (`import_reporting_workbook_*`) | BE | **KEEP (deprecated mirror)** — config is built from data, not sub_labels; sub_labels write is a legacy mirror, safe to remove in a later focused pass |
| `Question/AssessmentQuestion.sub_labels` (`response_sub_labels[_display]`) | BE/FE | **OUT OF SCOPE** — separate respondent/assessment feature |
| `getFallbackGroupsFromLegacyLabels` | FE | **REMOVED** — was the last aggregate-runtime sub_labels read |

**Zero aggregate-runtime reads of `Indicator.sub_labels` remain.**

## 5. Files Changed (all passes)
Backend: `indicators/disaggregation.py`, `indicators/serializers.py`, `indicators/views.py`,
`indicators/management/commands/{backfill,repair}_disaggregation_config*.py`,
`indicators/tests_backfill_disaggregation.py`.
Frontend: `lib/aggregates/aggregate-helpers.ts`, `lib/indicators/disaggregation-presets.ts`,
`lib/analytics/disaggregation.ts`, `components/analysis/dashboard-analytics-surface.tsx`,
`components/reports/reports-hub.tsx`, `app/(dashboard)/dashboard/page.tsx`.
Docs: three engineering reports under `docs/engineering/`.

## 6. Backend Changes
Canonical converter + bootstrap (data → sub_labels precedence), backfill & repair commands,
config-change auditing in the viewset, and the on-save consistency guard. `resolve_matrix_config`
unchanged (already config-only).

## 7. Frontend Changes
Capture/review/matrix/dashboard/analysis/reports resolvers are config-only; dead legacy-label fallback
removed; preset catalogue completed.

## 8. Database Changes
No schema migrations. Data-only: 10 indicators backfilled, 3 repaired (lossless). `sub_labels` column
untouched. Snapshot: `backups/disagg_config_snapshot_20260625_110541.json`.

## 9. API Changes
No contract changes. New behaviour: config writes are audited (`AuditEvent`), and structurally-valid
but inconsistent configs (>3 dims / collapsing values) are now rejected with a clear message.

## 10. UI Improvements
Editor now exposes all required presets (Age, Sex, Key Population, District, Location, Disability,
Citizenship, HIV Status, Pregnancy, Service Provider, Facility, Funding Source, Partner) plus custom
dimensions, add/edit/remove/reorder of values and dimensions, and a **live matrix preview generated by
the exact capture resolver** (so preview == output by construction). **Deferred (UX polish, non-blocking):**
HTML5 drag-and-drop (arrow reorder works today), duplicate-dimension button, and separate per-surface
preview panels (one resolver-backed preview already represents all surfaces identically).

## 11. Workbook Improvements
Confirmed config-only with no fallback/heuristics. Backfilled indicators now generate correct matrices
(verified live: #426 Mental Health Screening × Sex × Age).

## 12. Aggregate Capture Improvements
Capture matrix rows/columns/headers derive solely from config via `getAggregateEntryMatrixConfig`; the
sub_labels fallback was removed from the underlying resolver.

## 13. Dashboard Improvements
Widget disaggregate options read config only.

## 14. Analysis Improvements
`getIndicatorDisaggregationConfig` and the analysis surface read config only; no legacy label lookups.

## 15. Export Improvements
Excel/CSV/PDF/charts/scheduled reports operate on captured values/facts (config-shaped) and contain no
`sub_labels` references — labels/structures are consistent across surfaces.

## 16. Validation Improvements
Structural rules (JSON object, enabled bool, ≥1 dim when enabled, key+label+≥1 value, unique
keys/labels/values, no empties, preserved order) **plus** the new on-save consistency guard (≤3
dimensions, no column-collapsing values). 100% of production configs valid; the guard rejects 0 of 249.

## 17. Migration Results (verified live, read-only)
sub_labels-carrying indicators 184→184 (untouched); enabled configs 175→185 + 3 repaired; invalid
configs 3→0; duplicate dim keys 0; aggregates 16,103 unchanged; inconsistency surface 12→2 (both need
UI config). Training/live isolation via `apply_training_filter_via_projects`; no contamination path.

## 18. Performance Review
No new per-request work. Read paths do strictly less (no fallback branch). Audit recording is one
insert on the rare admin config write, fully swallowed on error. Backfill/repair are offline. No N+1
introduced. (Config-object caching was assessed and judged unnecessary for the current query profile —
deliberately not added to avoid cache-invalidation risk.)

## 19. Security Review
Two server-side layers: module RBAC (`HasModulePermission`, `indicators`) for create/edit/delete, and
field-level admin-only gating of `aggregate_disaggregation_config` in `IndicatorSerializer` (non-admin
change → `PermissionDenied`; unchanged echo allowed). Managers/standard users cannot mutate config
regardless of client. Verified by `AdminGateTests`. No reliance on frontend restrictions.

## 20. Test Coverage
31 new tests across passes: converter precedence, data recovery, sub_labels synthesis, workbook-matrix
parity, backfill safety, lossless repair, config-change auditing, and **on-save consistency** (dim
cap, collapsing values, disabled-OK). Plus pre-existing validation/admin-gate/workbook suites.

## 21. Test Results
- `indicators` + `aggregates`: **167 passed**, 0 failures.
- Frontend eslint (changed files): **0 errors**; `tsc --noEmit`: clean on changed files.

## 22. Deployment Risk Assessment
Low. Backend changes are additive/defensive (audit hook swallows errors; commands are offline; new
validation rejects nothing existing). Frontend changes are config-only reads + data-only preset
additions, lint/type clean. The only behavioural change for end users is that the 2 unconfigured
ambiguous indicators show no breakdown until configured in the UI (intended).

## 23. Rollback Procedure
- **Config data:** restore from `backups/disagg_config_snapshot_20260625_110541.json` (covers backfill
  + repairs); `sub_labels` never modified.
- **Code:** revert commits `d95b4549`, `d55127eb`, `e043e397` (and docs). No migrations to reverse;
  audit rows are additive.

## 24. Production Readiness
The data-integrity and single-source-of-truth objectives are met and verified live. Remaining items are
a standard frontend rebuild (to ship the config-only reads + presets) and deferred editor UX polish —
neither affects correctness. Two indicators (#492, #439) await UI configuration.

---

## Conclusion
**⚠ SAFE WITH MINOR RISKS.**
Deploy the committed backend (additive/defensive) and rebuild the frontend to ship the config-only reads
and completed preset catalogue. Minor, non-blocking risks: 2 indicators await UI config; importer
`sub_labels` mirror and editor UX polish (drag-and-drop, duplicate-dimension) are follow-ups. The
aggregate reporting ecosystem now behaves identically from a single configuration defined in the
Indicator Configuration UI.
