# SESIGO / BONASO Audit — Environment Separation, Chart Export, UI Consistency
**Date:** 2026-06-12  •  **Auditor:** automated, evidence-based  •  **Live URL:** https://sesigo.org.bw

---

## 1. Executive summary

A live-reported symptom — **training projects appearing in the live SESIGO project
dropdowns** — was confirmed, root-caused, fixed, deployed, and proven via the live
API. The two demo/training projects are correctly tagged `is_training=True` in the
database; they leaked because **admin users bypassed the training/live filter** in
`ProjectViewSet`. Indicators, organizations, aggregates, events, respondents and
analysis surfaces were already correctly isolated for admins (verified live), so
the project dropdown was the **only** leak.

Separately, the **chart download** was rebuilt: it now produces a donor/M&E-style
Excel workbook with a **native, editable Excel chart + a data table with legend
colour keys** (matching the Social Contracting report house style), plus Pivot,
Summary and Raw Data sheets. Chart colours now come from **one shared palette**
used by both the web charts and the Excel file, so a series keeps its colour
everywhere instead of Excel re-colouring randomly.

UI consistency was **assessed**: the shared `PageHeader` primitive already exists
and is adopted across every module except the **analysis workspace** components.
A low-risk migration plan is documented (see §6); it was not executed because it
is a broad visual change best done with on-screen review.

---

## 2. Confirmed bugs, root causes, fixes

### BUG-1 — Training projects visible in live project dropdowns (CONFIRMED, FIXED, DEPLOYED)
- **Symptom:** On `https://sesigo.org.bw/aggregates` (live), the Project filter listed
  *DEMO — Sesigo Training Project* and *SESIGO TRAINING PROJECT - DO NOT USE FOR REAL REPORTING*.
- **Root cause:** `backend/projects/views.py` `ProjectViewSet.get_queryset` returned
  **all** projects for any admin (`is_organization_admin`) and skipped
  `apply_training_filter_to_projects` entirely. Comment even read "never silently
  hide the training project from a live admin session." Any admin browsing live saw
  training projects in every project dropdown. The reporting user is an admin.
- **Why only projects leaked:** the indicator, organization, aggregate, event and
  respondent viewsets apply the training filter **before** their admin branch, so
  admins were already isolated there. Only the project viewset returned early.
- **Fix:** route admins through `apply_training_filter_to_projects` like everyone
  else. Admins keep cross-project visibility (no project-assignment gate); live mode
  excludes `is_training` projects; training mode shows only them; the explicit admin
  opt-in `?include_training=true` still surfaces everything.
- **Data:** the two training projects are correctly tagged — no data change needed.

### Issue — Chart Excel download did not preserve chart/colours (CONFIRMED, FIXED, DEPLOYED)
- **Symptom:** the chart "download" produced an SVG / plain data table; colours were
  inconsistent because they came from 3+ unrelated sources (a hard-coded array in
  `AggregateChartDialog`, theme CSS vars like `hsl(var(--chart-2))`, one-off hex such
  as `#232123`), and the Excel path used none of them.
- **Fix:** new `POST /api/analysis/chart-export/` renders a spec to a native Excel
  workbook (embedded chart + data table with legend keys + Pivot/Summary/Raw sheets).
  Colours resolve from one shared palette (`backend/analysis/chart_theme.py` ==
  `frontend/lib/chart-theme.ts`).

---

## 3. Files changed

**Separation fix**
- `backend/projects/views.py` — admins now go through the project training filter.
- `backend/organizations/tests_training_separation.py` — +4 `ProjectViewSet` tests.

**Chart export (native Excel + shared palette)**
- `backend/analysis/chart_theme.py` (new) — canonical palette + colour helpers.
- `backend/analysis/chart_export.py` (new) — multi-sheet workbook builder + native chart.
- `backend/analysis/views.py` — `chart_export_excel` view.
- `backend/analysis/urls.py` — `/chart-export/` route.
- `backend/analysis/test_chart_export.py` (new) — 12 tests.
- `frontend/lib/chart-theme.ts` (new) — palette (mirror of backend).
- `frontend/lib/chart-export.ts` (new) — spec builder + download.
- `frontend/components/analysis/chart-excel-export-button.tsx` (new) — reusable button.
- `frontend/components/analysis/analytics-chart-panel.tsx` — `excelExport` prop.
- `frontend/components/aggregates/AggregateChartDialog.tsx` — "Download Excel" via the
  new endpoint; local palette now points at the shared one.

---

## 4. Affected records (enumerated from the live DB)

| Type | IDs | Tagging | Live visibility after fix |
|------|-----|---------|-----------------------------|
| Training projects | 4, 6 | `is_training=True` ✓ | Hidden in live (was leaking) |
| Training aggregates | 24 rows on projects 4/6 | linked to training projects | Excluded (9,516 live-visible of 9,540) |
| Demo orgs | 187, 188, 189 | linked only to training projects | Already hidden (verified) |
| Demo indicators | 553, 554, 555, 556 | linked only to training projects | Already hidden (verified) |

No production data was altered. No cleanup migration was required — records were
already correctly tagged; the bug was purely a read-filter bypass.

---

## 5. Tests added & evidence

- **Backend, separation:** `organizations.tests_training_separation` — 23 tests (incl. 4
  new: admin live hides training, admin training shows only training, admin
  `include_training` shows all, training-token JWT hides live). **All pass.**
  - `test_project_viewset_admin_live_hides_training` fails on the pre-fix code.
- **Backend, chart export:** `analysis.test_chart_export` — 12 tests (palette parity,
  4 sheets, series colours match spec, native data table + clustered column in XML,
  pie per-slice colours, endpoint returns xlsx / rejects empty / requires auth). **All pass.**
- **Combined run:** `Ran 36 tests ... OK`.

**Live API proof (separation), run against the live DB through the deployed code:**
```
LIVE  : (2 NAHPA Social Contracting), (3 NAHPA SC 2026/27)        # training 4 & 6 GONE
TRAIN : (4 SESIGO TRAINING ...), (6 DEMO ...)
INCL  : 2, 3, 4, 6                                                # admin opt-in
LIVE  demo indicators visible: 0 | demo orgs visible: 0
TRAIN demo indicators visible: 4 | demo orgs visible: 3
```

**Live API proof (chart export), authenticated POST to the deployed backend:**
```
HTTP 200 | type=...spreadsheetml.sheet | size=9945
file: Microsoft Excel 2007+ ; sheets: 4
dTable: True | clustered-col: True
palette colors: 0FA546, 20A3D3, 6F35A5, CC0000
```

---

## 6. UI consistency — assessment + plan (NOT yet executed)

- `frontend/components/shared/page-header.tsx` (`PageHeader`) is the established
  family header and is already used by organizations, indicators, projects,
  aggregates, users, respondents, uploads, events, social, settings, system-status,
  data-quality, search, training, flags, etc. (detail/edit `[id]` routes and
  `training/*` routes inherit it via `_PageContent`/re-exports).
- **Gap:** the **analysis module** (`analysis/dashboards|reports|visualizer|line-lists`)
  renders bespoke workspace headers instead of `PageHeader`, and ships **two** parallel
  filter bars (`analytics-filter-bar` + `compact-analytics-filter-bar`).
- **Plan (low-risk, reviewable):**
  1. Wrap each analysis workspace in `PageHeader` (title/description/actions) to match
     the other modules; keep the in-page filter bar below it.
  2. Consolidate the two analysis filter bars into one.
  3. Standardise empty/loading/error states on the existing shared components.
  - Deferred for on-screen review — it is a visual change with regression surface and
    no behavioural bug, so it should be verified live before shipping.

---

## 7. Exact commands run (key)
```
# DB enumeration / live proof
docker exec frontend-backend-1 python manage.py shell -c "<ProjectViewSet/Indicator/Org checks>"
# Tests
DEBUG=True SECRET_KEY=testkey ./venv/bin/python manage.py test \
  organizations.tests_training_separation analysis.test_chart_export
# Build + deploy
docker tag frontend-backend:latest  frontend-backend:rollback_<ts>
docker tag frontend-frontend:latest frontend-frontend:rollback_<ts>
docker compose -f frontend/compose.server.yaml build backend frontend
docker compose -f frontend/compose.server.yaml up -d backend frontend
# Live chart-export round trip (Bearer token, X-Forwarded-Proto: https)
curl -X POST http://127.0.0.1:18000/api/analysis/chart-export/ ...
```

## 8. Deployment & rollback
- **Deployed live 2026-06-12:** backend (separation fix + chart-export) and frontend
  (Download Excel UI). Zero migrations.
- **Rollback images:**
  - Pre-separation-fix backend: `frontend-backend:rollback_20260612_140906`
  - Pre-chart-export (both): `…:rollback_20260612_144615`
  - Rollback = `docker tag <rollback> <name>:latest && docker compose -f frontend/compose.server.yaml up -d <svc>`.
- **Branch:** `rollout-blockers-remediation-2026-06-05` (local only — push to back up).

## 9. Remaining risks / follow-ups
- **Mode still derives from a client signal for already-issued tokens.** The H1 JWT
  `mode` claim binds training sessions server-side when present; tokens minted before
  H1 fall back to the `training_only` query param. Full hardening = require the claim.
  (Pre-existing; unchanged by this work.)
- **`Report` / `ScheduledReport`** have no project FK or `is_training` path (org-scoped
  saved outputs), so they are not training-filtered. Low risk; would need a data-model
  field to isolate. Noted, not changed.
- **UI consistency** for the analysis module is assessed but not executed (§6).
- Branch is local-only; push to back up.
