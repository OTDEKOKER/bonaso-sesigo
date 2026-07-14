# Workbook Layout — coordinator-level indicator ordering (2026-06-17)

## What this adds

Programme teams want reporting-workbook indicators arranged in a specific order,
not the backend's automatic order. **Workbook Layout** lets a coordinator define
that order once; all of its sub-organisations inherit it when they download a
reporting workbook.

A Workbook Layout controls **only the indicator order** (and optional section
headings). It is deliberately independent of project, year, quarter, month and
period type. Those are still chosen at download time to fetch the right data —
they never define the saved order.

## How it works

- A layout belongs to a **coordinator organization**. One *active* layout per
  coordinator per environment (live/training).
- Items are an ordered list: each item is either an **indicator row** or a
  **section heading** (e.g. "HIV Testing", "Prevention", "NCD", "GBV",
  "Referrals"). Headings and indicators share one ordered sequence so headings
  can sit between indicators.
- At download time the coordinator's layout is resolved (a sub-organisation
  walks up the project hierarchy to its coordinator):
  - **Layout indicator not applicable** to the selected project/org → skipped.
  - **Applicable indicator not yet in the layout** → appended at the bottom
    under an **"Unordered Indicators"** section (so adding indicators never
    breaks generation).
  - **No layout for the coordinator** → falls back to the existing default
    ordering, unchanged.

## Backend

- Models (`projects/models.py`): `WorkbookLayout`, `WorkbookLayoutItem`.
  - One active layout per coordinator+mode (partial unique constraint).
  - The same indicator cannot appear twice in one layout (partial unique
    constraint, indicator not null).
- Migration: `projects/migrations/0019_workbook_layout.py` (2 new tables, **0
  data migration**; additive only).
- Ordering service: `projects/workbook_layout.py`
  - `resolve_layout_for_org(project, org, mode)` — sub inherits coordinator.
  - `order_plans_by_layout(plans, layout)` — reorder + sections + skip + append.
- API (`projects/workbook_layout_views.py`, routed at
  `/api/manage/workbook-layouts/`):
  - `GET/POST/PATCH/DELETE` workbook-layouts (list filter `?coordinator=`).
  - `GET available-indicators/?coordinator=<id>` for the editor.
  - **Permissions enforced server-side** (not just UI hiding):
    admin & M&E manager → any coordinator; a user whose org *is* the coordinator
    → that coordinator only; everyone else → read-only (they consume the layout
    on download). Live/Training isolation via the signed JWT `mode` claim.
- Workbook generation (`aggregates/reporting_workbook.py` +
  `aggregates/views.py`): section-heading rows added; both the single-org
  `reporting-workbook` and the `coordinator-workbook` endpoints reorder plans by
  the resolved layout. The hidden `_cellmap`/`Metadata` sheets and the
  upload/round-trip are **unaffected** (headings carry no input cells).

## Tests

`projects/test_workbook_layout.py` (19 tests, all green): admin/coordinator/
sub-grantee permissions, layout-driven ordering with sections, sub-org
inheritance, non-applicable indicators skipped, new indicators appended under
"Unordered Indicators", duplicate-indicator prevention (serializer + DB
constraint), one-active-layout guard, and the missing-layout default fallback.
Existing reporting-workbook / coordinator-workbook / period suites still pass.

## Frontend

- Service: `lib/api/services/workbook-layouts.ts` (`workbookLayoutsService`,
  upsert `save()`).
- Dialog: `components/projects/ManageWorkbookLayoutDialog.tsx` — select
  coordinator, name (defaults to "<Coordinator> Workbook Layout"), drag-and-drop
  reorder (native HTML5) with move up/down buttons as the accessibility
  fallback, add indicators, add section headings, and a warning that changes
  affect the coordinator and its sub-organisations.
- Button **"Manage Workbook Layout"** on the project detail page
  (`app/(dashboard)/projects/[id]/_PageContent.tsx`, Organizations tab toolbar).
  Coordinators are derived from the project's coordinator memberships.

## Rollout notes

- **Migration is additive** (0019, two new tables, no backfill). Safe to apply
  with the standard deploy (`docker compose ... up -d --build`; the entrypoint
  runs migrate + collectstatic).
- **No behaviour change until a layout is created** — every workbook keeps its
  current default order until a coordinator saves a layout, then only that
  coordinator's subtree is affected.
- **Live/Training:** layouts are environment-scoped; a training session only
  sees/edits training layouts and vice-versa. Create live layouts from a live
  login.
- **Rollback:** code-only + additive migration. Reverting the code leaves the
  two unused tables in place (harmless); `migrate projects 0018` drops them if a
  full rollback is wanted.
