# Funder Report Builder

**Status:** LOCAL (built 2026-07-08, not yet deployed)
**Reference:** *Monitoring and Evaluation Report for NAHPA Social Contracting 2025/26 — Annual Report 2026*

A configuration-driven engine that renders the funder report's figures/tables
straight from **existing approved aggregate data** — no new indicators, no
hard-coded charts. A report figure = *a configurable group of existing
indicators + rules + chart type + narrative template*.

---

## 1. Technical assessment (areas touched)

* `aggregates.AggregateFact` — the flattened, indexed projection of approved
  `Aggregate.value` (one row per disaggregate leaf, carrying alias-safe
  `canonical_indicator`, `organization`, `period`, `primary`=KVP/category,
  `secondary`=sex, `band`=age, `value`). **This is the read source** — grouping
  is a pure SQL `GROUP BY`, no per-row JS summing.
* `projects.ProjectIndicatorOrganizationTarget` — per-org quarterly targets
  (`q1_target…q4_target`, `target_value`) for achieved-vs-target figures.
* `projects.ProjectIndicatorAssignment` / `ProjectOrganization` — reused for the
  "expected to report" completeness check (no new eligibility concept).
* `lib/chart-theme.ts` (FE) + `analysis/chart_theme.py` (BE) — the canonical
  SESIGO palette, now also the funder-chart palette.
* Permissions reuse `organizations.access` + `projects.hierarchy` scoping.

Nothing in the aggregate import / workbook / target pipelines was changed.

## 2. Data model (`funder_reports` app)

| Model | Purpose |
|---|---|
| `ReportTemplate` | name, funder, **project**, reporting_year, is_active |
| `ReportSection` | ordered sections (objectives) within a template |
| `ReportFigure` | figure_number, title, **chart_type**, grouping_dimension, secondary_grouping_dimension, target_mode, calculation_mode, narrative_template |
| `ReportFigureIndicatorMapping` | figure ↔ existing indicator, **role** (achieved/target/numerator/denominator/category/comparison/excluded/supporting_narrative), label_override |
| `ReportFigureFilter` | include/exclude values on a dimension (e.g. only certain NCD message types to avoid double counting) |
| `ReportFigureSnapshot` | frozen generated `data_json` + narrative for a period |

Migration: `funder_reports/0001_initial` (new tables only; additive).

## 3. API (`/api/reports/`)

* `templates/` (CRUD) + `templates/{id}/sections/` + `templates/{id}/generate/`
  (whole dashboard for a project+period)
* `sections/`, `figures/` (CRUD) + `figures/{id}/mappings/` (attach indicator) +
  `figures/{id}/preview/` (one figure, real data) + `figures/{id}/save-snapshot/`
* `figure-mappings/`, `figure-filters/` (CRUD), `snapshots/` (read)

Config writes require **admin**; preview/generate/export require a reporting role
(manager / officer / coordinator) and are **org-scoped** to what the caller may
already see. Every config change + generation is audited.

## 4. Generation service (`funder_reports/generation.py`)

Input: figure + project + period (+ org scope). Steps:
1. Resolve mapped indicators by role.
2. Query `AggregateFact` (approved, non-training, in period, in scope), apply
   figure filters.
3. Pivot into `categories` (primary dim) × `series` (secondary dim).
4. Targets (org-quarter or project) → achievement %.
5. Ratio % (numerator/denominator) for referral-rate figures.
6. Completeness (expected vs reporting orgs) + warnings (no mappings, no data,
   missing target, missing orgs).
7. Narrative from the template placeholders.
Output: normalized chart-ready JSON consumed by `FigureChart` (recharts).

## 5. Frontend

* `lib/api/services/funderReports.ts` — typed client.
* `components/funder-reports/FigureChart.tsx` — **one standardized recharts
  renderer** for every figure (SESIGO palette, thousands-separated numbers,
  uniform axes/tooltip/legend, achieved-vs-target overlay, horizontal ranked
  bars, line trend). Bars preferred over pie by design.
* `app/(dashboard)/funder-reports/page.tsx` — pick template + project + period →
  generate the whole report in order, with narratives, completeness and warnings.

## 6. Configuring the NAHPA report — COMPLETE (all figures/tables present)

The seeder encodes the **entire** funder report: 4 sections and **37
figures/tables** — Tables 1, 2, 3.1, 3.2 and Figures 1–21 (including 7.1–7.3,
10.1–10.2, 13.1–13.2, 14.1–14.2, 16.1–16.2, 17.1–17.4, 18.1–18.3). Run against
the NAHPA SC 2025/26 project (**project id 2**):

```
python manage.py seed_nahpa_report --project 2 --dry-run   # read-only: prints the checklist, writes nothing
python manage.py seed_nahpa_report --project 2             # idempotent write (reconciles in place)
```

`--dry-run` is fully read-only and safe to run against production before the app
is migrated. Normal mode requires the `funder_reports` tables (migrate first).

### Is it 100% configured?

Every figure/table from the report **is present and configured** (chart type,
grouping, target/calculation, narrative). Against the live catalog (dry-run,
project 2): **34 of 37 fully mapped, 3 partially mapped, 0 needing mapping.**
It is therefore **NOT 100% auto-mapped** — three figures matched some but not all
of their indicators and need a quick manual confirmation in the builder:

| Figure | Why partial |
|---|---|
| **Table 2** — CSO Capacity Building / Media Platforms | media-platform usage isn't a single catalog indicator; confirm the intended source or leave as a manual table |
| **Figure 1** — HIV messages by message type | 8 message-type indicators expected; confirm each message-type indicator is mapped (some named differently) |
| **Figure 16.1** — Biological NCD risk factors | Blood glucose/BP/BMI/waist split; confirm each risk-factor indicator (waist may not exist as a separate indicator) |

Everything else is fully mapped. Finish the three above in the builder
(`/funder-reports/builder`) — no code change needed. Use `ReportFigureFilter`
to include/exclude NCD message types where the report limits them to avoid double
counting.

## 6a. Editable, filter-aware, permission-safe (mandatory requirement)

* **Editable — persisted to the DB.** Every figure attribute (title, number,
  section, order, chart type, contributing indicators + role, grouping +
  secondary dimension, target mode, calculation mode, filters/exclusions, label
  overrides, narrative template, active status) is editable via
  `/funder-reports/builder` → **FigureEditor**, saved through the report-figure
  models; saving re-runs the preview so the chart updates immediately. Buttons:
  Edit / Preview / Save / Duplicate / Enable-Disable; panels: chart settings,
  indicators, filters, narrative, warnings + status badges.
* **Filter-aware in the backend.** `generate/preview/export` accept
  project, period (quarter/annual), coordinator, CSO/organization, sex, age, KVP,
  message type/service category/indicator group and approval status. Filtering
  happens in the generation **service** (`_apply_request_filters`), never only in
  the UI; district is reported as unsupported (not on aggregate facts) with a
  warning. Empty results produce a clear "No data matches the selected filters"
  warning, and the dashboard shows the active-filter context.
* **Permission-safe.** `allowed_org_ids_for_report` + `scoped_org_filter`
  intersect any org/coordinator filter with the caller's allowed scope, so
  changing `?organization=`/`?coordinator=` can never widen access (tested).
  Unapproved data is included only for approvers (`can_view_unapproved` →
  `can_approve_aggregates`); training data is always excluded. Granular
  permissions: `can_configure_reports` (admin), `can_edit_mappings`
  (admin/manager), `can_generate_reports`, `can_edit_narrative`,
  `can_save_snapshot`, `can_export_reports`, `can_publish_reports`.
* **Snapshots reproduce exports.** `save-snapshot` stores figure id, project,
  period + mode, applied filters, permission scope, frozen chart config, returned
  data, narrative, warnings and generator. `snapshots/{id}/publish/` finalizes it;
  a published snapshot's data stays stable even if the figure is later edited
  (tested).
* **Export parity.** `figures/{id}/export/` returns an `.xlsx` (data table +
  Context sheet with applied filters, scope, narrative, warnings, who/when) using
  the SAME filters and permission scope as the preview.

## 7. Deployment checklist

- [ ] `migrate funder_reports` (+ `aggregates 0009`, `audit 0005` from the
      reporting-control change if shipping together).
- [ ] Rebuild backend + frontend images.
- [ ] `seed_nahpa_report --project <id> --dry-run`, review the checklist, then run
      for real; finish unmatched figure mappings in the UI.
- [ ] Confirm `AggregateFact` is populated (it is, via the fact-sync signals /
      `backfill_aggregate_facts`) so generation has data.
- [ ] Add nav entries: **Funder Reports** (`/funder-reports`) for M&E,
      builder/admin via Django admin (or extend the FE builder later).
- [ ] Smoke: generate Q4 2025/26 for NAHPA and compare a couple of figures to the
      manual report totals.

## 6b. Self-service, sharing, funders & full-report export (finalisation)

* **Self-service (not admin-only).** Any authorized user — including **funder /
  client** users — can create and own **personal** templates + figures and
  generate/preview/export within their permission scope. `ReportTemplate.owner`
  marks personal templates; a user edits their **own** templates, admins edit
  anything, and M&E **Managers** curate the shared **system** template (owner
  NULL, e.g. the seeded NAHPA report — this is how the 3 partial figures get
  finished). Enforced at the object level (`can_edit_report_object`), so one user
  can never edit another's personal charts.
* **Funders are read-restricted by the same backend rules.** Clients may build
  personal dashboards, filter, save views, export and view published reports, but
  are always limited to **approved/published** data in their scope (they are not
  approvers, so `include_unapproved` is ignored for them), and they cannot touch
  raw aggregates, approvals, targets or the workbook (no such endpoints for them).
* **Sharing with viewer re-scoping.** `ReportTemplate.visibility`
  (private / organization / network / project / funder / public) + explicit
  `shared_with_users`. `visible_templates()` filters the list to what a user may
  open; **generation still re-scopes the data to the viewer**, so sharing a chart
  never grants data access. Published **snapshots** remain the separate, frozen
  artefact (data + filters + config + narrative + warnings + who/when).
* **Full-report Word export.** `POST /api/reports/templates/{id}/export-word/`
  renders the whole report to `.docx` (title, each section, each figure with a
  data table + narrative + warnings) using the **same** scope-safe filters as the
  dashboard. Per-figure `.xlsx` export is retained. **PDF is the documented next
  step** (render the same payload server-side, e.g. via a headless print of the
  dashboard or a docx→pdf converter).

## 7a. Rollback plan
* **Frontend:** redeploy the previous image; the new pages/buttons disappear. No
  data impact.
* **Backend (non-destructive):** the whole feature is additive. To disable it
  without a migration, remove the `/api/reports/` include (or set every template
  `is_active=False`). To fully revert: `migrate funder_reports zero` drops all six
  `funder_reports` tables (nothing else references them) and redeploy the prior
  image. `aggregates`/`indicators`/`projects`/`audit` are untouched by a revert,
  and **no existing aggregate/indicator/target/workbook data is ever modified**.

## Guardrails honoured
No new indicators; no workbook/aggregate-import change; approved aggregates are
the source of truth; targets come from existing records; figures are configured,
not hard-coded; org/project/hierarchy/indicator/approval/training permissions
enforced server-side (shares + filters + exports + snapshots all re-scoped);
existing tests pass; new tests added (`funder_reports/tests.py`, 31 cases).
