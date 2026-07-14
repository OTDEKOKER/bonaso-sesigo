# V2 — Server-Side Aggregation (Phase 2)

Deferred to **version 2, after rollout**. Phase 1 is DONE + LIVE; this is the
performance follow-up. Not a rollout blocker — current pages work.

## Phase 1 (DONE / LIVE — the foundation)
- `aggregates.AggregateFact` — flattened one-row-per-leaf projection of every
  `Aggregate.value` (denormalised + indexed). Migrations `aggregates/0005` + `0006` applied.
- `aggregates/facts.py` — `flatten_value` (single source of truth value→leaves) + sync.
- post_save (on_commit) signal in `aggregates/signals.py` keeps facts current automatically.
- `manage.py backfill_aggregate_facts` — idempotent rebuild (ran on prod: 9,540 aggregates → 646,304 facts).
- `GET /api/aggregates/rollup/` (`aggregates/rollups.py` + viewset action) — SQL GROUP BY,
  `group_by=indicator,sex,age,kp,organization,project`, approved-only default, server-side
  single-age→5-year folding, reuses the viewset's training/project-assignment/org scope.
- Tests: `aggregates/test_facts_rollup.py` (9). Frontend UNCHANGED (still client-side).

## Phase 2 (TODO in v2) — point heavy consumers at the server
Goal: stop pulling all ~9.5k aggregate rows to the browser for fixed dashboards/reports.

### Consumers (frontend) and disposition
Rollup-suitable (fixed totals) — migrate to `/rollup`:
- `components/reports/reports-hub.tsx` (indicator + disaggregate matrices)
- `app/(dashboard)/aggregates/page.tsx` (consolidated matrix view)

Interactive analytics — need raw rows OR a richer endpoint; do NOT force onto fixed `/rollup`:
- `app/(dashboard)/dashboard/page.tsx` (home dashboard; **time-series trends** + screening insights)
- `components/analysis/dashboard-analytics-surface.tsx` (overview/comparison/**trends**/table)
- `components/analysis/visualizer-workspace.tsx` (ad-hoc dims/pivots via lib/analytics/query-builder)
- `components/analysis/dashboard-chart-card.tsx` (configurable disaggregate matrices/charts)
- `components/reports/report-builder-dialog.tsx` (target-vs-achieved)

### Recommended approach (incremental, each browser-verified + individually revertible)
1. **Extend `/rollup`**: add period bucketing (`bucket=month|quarter` → time series) and
   optional target join, plus any missing group-by dims the dashboards need.
2. Migrate the **home dashboard** first (highest traffic), verifying numbers match the current
   client-side output before/after. Then reports matrices, then analytics surfaces.
3. For the truly ad-hoc visualizer/query-builder, prefer **server-side filtering/pagination**
   (period/project scope) over a full rewrite — they legitimately need row-level data.
   `?light=` projection already exists as a cheap interim payload trim.

### Why not a big-bang rewire
~5 of the 7 consumers are interactive (arbitrary group-by, trends, pivots, targets). A fixed
rollup can't serve them without becoming a query engine; rewiring blind would break analytics
and can't be number-verified without an authenticated browser + data.

## Rollback / ops notes
- Migrations reversible: `manage.py migrate aggregates 0004` drops the fact table.
- Re-sync anytime: `manage.py backfill_aggregate_facts` (idempotent).
