# SESIGO Service Pathway (Client Cascade) — Design Note

*Captured 2026-06-23 from a whiteboard/sticky-note sketch. Confirmed reading. Not yet built — design only. To be folded into the workbook redesign.*

## Concept

A **service pathway** models a client moving through an ordered **cascade** of
stages, tracked **per service area**.

**Cascade stages (ordered funnel — each stage count should be ≤ the previous):**

1. Messages (reached / received a message)
2. Screened
3. Eligible
4. Refer (referred)
5. Linked to Care

**Service areas / topics:**

Testing · GBV · STI · TB · PSS · Justice · Condoms · Lubs

The conceptual grid is **service area × stage**, e.g. "GBV — Screened", "TB —
Linked to Care". Drop-off between consecutive stages is the key analytic.

## Gap vs current system

The current model ([indicators/models.py](../backend/indicators/models.py),
[resolve_matrix_config](../backend/aggregates/reporting_workbook.py)) stores flat
indicator counts disaggregated by sex / age band / key-population. There is:

- no ordered **stage** dimension,
- no **stage ≤ previous-stage** validation (cascade monotonicity),
- no first-class **service area × stage** matrix or drop-off analytic.

## Candidate approaches (to decide later)

1. **Stage as a disaggregation dimension** — add an ordered `stage` dimension
   (Messages…Linked to Care) to `aggregate_disaggregation_config`, with one
   indicator per service area. Lowest schema impact; reuses the matrix workbook;
   needs ordered-validation + cascade rollups bolted on.
2. **Naming convention of existing indicators** — one indicator per
   (service area, stage), tagged so analytics can assemble the cascade. No schema
   change; relies on discipline; weakest integrity.
3. **First-class Pathway model** — explicit `ServiceArea`, `PathwayStage`, and a
   cascade fact, with built-in monotonicity validation and a dedicated cascade
   view. Strongest integrity; largest build.

**Open questions:** Are the 5 stages identical across every service area? Is data
captured per client (line-list) or as aggregate stage counts? Should the workbook
present a cascade grid (areas as rows, stages as columns)? Funnel charts in
analytics? These drive which approach fits.
