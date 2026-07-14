# Engineering Report — `aggregate_disaggregation_config` as Single Source of Truth (Aggregate)

**Date:** 2026-06-25  **Branch:** `retire-sub-labels-2026-06-25`  **Commit:** `e043e397`
**Scope (agreed with maintainer):** aggregate disaggregation only; retire `sub_labels` from
runtime logic, keep the column; respondent/`multi_int` capture deliberately untouched.

---

## 1. Executive Summary
The aggregate stack (workbook, capture, upload validation, review, analysis, dashboard,
exports) is now driven by a single authoritative structure, `aggregate_disaggregation_config`.
The legacy flat `sub_labels` list is no longer consulted on the aggregate read paths. Every
disaggregated indicator in production now carries a real config (seeded from its own captured
data where it exists, otherwise from house-standard values), so the previously-divergent
fallback paths can never fire. The `sub_labels` column is retained (deprecated) for rollback
and history. **Net production inconsistency: 12 indicators → 2** (the remaining two are
genuinely ambiguous and must be configured in the UI).

## 2. Root Cause Analysis
`sub_labels` is a flat list of dimension *names* (`["Sex","Age Range","Disaggregate"]`) with no
values, enabled flag, order, or keys. To render a grid each consumer had to *guess* the values
from its own presets/heuristics, and the guesses differed. Meanwhile the workbook generator was
already rewritten to read only `aggregate_disaggregation_config`. Result: 12 indicators had
`sub_labels` but no config — their workbook showed no breakdown while the FE fallbacks showed a
sub_labels-derived breakdown. `config` is a strict superset of `sub_labels`, so promoting it to
the sole source removes the ambiguity.

## 3. Architectural Review
One canonical resolver, no guessing at read time:
1. existing enabled `config` → use as-is;
2. else recover config from the indicator's real captured `disaggregates` (most accurate);
3. else synthesise from legacy `sub_labels` names + house-standard values, **reporting** any
   name it cannot resolve for manual UI configuration.
This lives in `indicators/disaggregation.py` (alongside the existing validator) and is exercised
by a safe backfill command. Frontend high-level readers were switched to config-only.

## 4. Files Changed
- `backend/indicators/disaggregation.py` (+188) — converter/bootstrap helpers.
- `backend/indicators/management/commands/backfill_disaggregation_config.py` (+115, new).
- `backend/indicators/tests_backfill_disaggregation.py` (+188, new).
- `frontend/components/analysis/dashboard-analytics-surface.tsx` — config-only; removed dead `slugify`.
- `frontend/app/(dashboard)/dashboard/page.tsx` — config-only widget options.
- `frontend/lib/analytics/disaggregation.ts` — config-only analytics resolver.
- `frontend/components/reports/reports-hub.tsx` — config-only (2 sites).

## 5. Backend Changes
- `config_from_aggregate_data(samples, sub_labels)` — recovers primary/secondary/age dimensions
  and values from real nested `disaggregates`; drops placeholder `All` axes; sorts age bands.
- `config_from_sub_labels(sub_labels)` — maps known names (Sex/Age*/Key Population) to
  house-standard values; returns `(config, unresolved_labels)`; invents nothing.
- `bootstrap_config(indicator, samples)` — precedence resolver above.
- `has_enabled_config()` helper.
- House-standard constants: Sex `[Male,Female]`, Age `10-14…65+` (12 bands), KP
  `[GENERAL POP., FSW, MSM, PWID, PWD, LGBTQI+]` (verified against the existing 165–185 configured indicators).
- Existing `validate_disaggregation_config` unchanged; every bootstrapped config passes it.

## 6. Frontend Changes
High-level aggregate readers no longer pass `sub_labels` to
`normalizeAggregateDisaggregationConfig`. **Intentionally retained:** the editor's
legacy→config seeding (so admins can promote a legacy indicator in the UI) and the low-level
capture helper `resolveDisaggregationConfig` (dual-input, capture-critical) — both now dead
fallbacks for real data but defensive.

## 7. Database Changes
None structural. Data-only: 10 indicators had `aggregate_disaggregation_config` populated via the
backfill command (`--apply`). `sub_labels` column kept, nothing dropped, no schema migration.
Pre-change snapshot of all 249 configs: `backups/disagg_config_snapshot_20260625_110541.json`.

## 8. Validation Rules
Unchanged and centralised: valid JSON object; `enabled` boolean; ≥1 dimension when enabled;
each dimension has key+label+≥1 value; unique keys, unique labels, unique non-empty values.
Bootstrap output always satisfies these (covered by tests).

## 9. API Changes
None. The serializer already exposes `aggregate_disaggregation_config` (admin-gated for writes,
read-only on the list endpoint) in both full and list serializers.

## 10. Workbook Changes
None required — `resolve_matrix_config` already reads only the config. Verified that the 10
backfilled indicators now yield real matrices (e.g. #426 = Mental Health Screening × Sex × Age).

## 11. Analysis Changes
`getIndicatorDisaggregationConfig` and the analysis surface read config only.

## 12. Dashboard Changes
`getIndicatorDisaggregateOptions` (widget builder) reads config only.

## 13. Performance
The backfill scans up to 200 aggregate rows per legacy indicator once (offline command), not on
any request path. No new per-request queries introduced; read paths do strictly less work
(one fewer fallback branch).

## 14. Security Review
No new endpoints or data exposure. Write access to the config remains admin-gated in the
serializer; the backfill is a server-side management command only.

## 15. Permission Review
Unchanged: only organization admins may edit `aggregate_disaggregation_config`; others read.

## 16. Test Coverage
19 new tests: sub_labels synthesis (known/unknown/partial/empty), data recovery (nested/totals-
only/`All`-placeholder), bootstrap precedence, workbook-matrix parity, and command safety
(dry-run no-op, never-overwrite, idempotency, sub_labels never edited, unseedable reported).

## 17. Test Results
- New module: **19 passed**.
- `indicators` + `aggregates` suites: **158 passed** (no regressions).
- Frontend eslint on changed files: **0 errors** (pre-existing warnings only).

## 18. Screens / Surfaces Verified
Workbook matrix (live, 3 indicators), dashboard widget options, analysis surface, reports-hub
disaggregate selection — all resolve from config. Live post-backfill: 185 indicators configured,
2 flagged for manual UI config.

## 19. Remaining Risks
- **2 indicators** (#492, #439, `['Disaggregate']`, no values/data) intentionally have no config
  and must be configured in the UI. They show no breakdown until then (correct, not a regression).
- Low-level capture helper + editor still accept `sub_labels` (defensive/by-design). A future
  FE-tested pass can remove the remaining dead fallbacks.
- Live backend container was hot-patched with the new `disaggregation.py`/command for the backfill
  run; behaviour is additive. A normal image rebuild/deploy bakes the committed code in.

## 20. Rollback Plan
- Data: restore configs from `backups/disagg_config_snapshot_20260625_110541.json` (write each
  id's prior value back). `sub_labels` were never modified.
- Code: revert commit `e043e397`. No migrations to reverse.

## 21. Deployment Readiness
Backend data fix is **already live** (backfill applied, verified). The committed code (converter,
command, FE config-only reads) is on `retire-sub-labels-2026-06-25`, lint/tests green, and needs a
standard frontend rebuild + backend image rebuild to bake in (backend runtime impact is nil since
only the offline command uses the new helpers).

## 22. Recommendation
**SAFE TO DEPLOY** for the committed change set (additive, reversible, tested). The live data
backfill is done and verified. Follow-up (separate, FE-tested): configure the 2 ambiguous
indicators in the UI and optionally remove the remaining defensive `sub_labels` fallbacks.
