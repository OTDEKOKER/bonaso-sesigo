# Quarterly Reporting Control Framework

**Status:** LOCAL (built 2026-07-08, not yet deployed — deploy scheduled for the evening)
**Scope:** backend enforcement + admin API + org status API + frontend display + admin management page
**Branch:** `production-hardening-2026-07-06` (uncommitted working tree)

This framework ensures organisations report **exactly once**, **only after the
reporting quarter has ended**, and **only during an administrator-controlled
window**, while preserving SESIGO's existing project-assignment, workbook,
target and aggregate architecture. The backend is the sole source of truth; the
frontend only displays status.

---

## 1. Architecture summary

The framework is an **overlay** on the existing aggregate write path, not a
rewrite. It adds one new model and one shared service, and hooks them into the
single pre-existing write choke-point.

```
                 ┌─────────────────────────────────────────────┐
   write paths   │  single / bulk / workbook-import /           │
   (all of them) │  interaction-generated / overwrite CLI       │
                 └───────────────────┬─────────────────────────┘
                                     │ every path already calls
                                     ▼
                 AggregateViewSet._assert_write_scope()         ← eligibility
                 (project assignment + indicator assignment,     (UNCHANGED —
                  role gate, training/live boundary)              existing SSoT)
                                     │
                                     ▼
                 AggregateViewSet._assert_period_reporting_eligible()
                                     │ delegates to
                                     ▼
                 aggregates.reporting_control.evaluate_window()  ← THE timing gate
                                     │ reads (0 or 1 indexed query)
                                     ▼
                 aggregates.models.ReportingPeriod (overlay, optional)
```

**Key design decisions**

* **Eligibility is NOT re-implemented.** An org is eligible iff it is assigned
  to the project (`ProjectOrganization`) **and** has an assigned indicator
  (`ProjectIndicatorAssignment`). Those existing checks stay authoritative and
  run before the timing gate. No new eligibility table.
* **Backward-compatible overlay.** `ReportingPeriod` is optional. When **no**
  period is configured for a project+quarter, the write path falls back to the
  always-on **quarter-completion floor** (a period may only be reported after it
  has fully elapsed). So the day this ships, every live project keeps working
  exactly as before, and previously-downloaded workbooks for a completed quarter
  still submit.
* **One shared validation service.** `reporting_control.evaluate_window()` is the
  only place that decides "may this be reported now?". All HTTP write paths and
  the overwrite CLI use it — no duplicated logic.
* **Single fiscal calendar.** Botswana FY (Q1 Apr-Jun … Q4 Jan-Mar) is reused
  from `reporting_workbook.quarter_period_range`; nothing new was created.
* **Backend is source of truth.** The frontend status endpoint only mirrors the
  decision for display; every write re-evaluates independently.

---

## 2. Database changes

**New table `aggregates_reportingperiod`** (migration `aggregates/0009`):

| Field | Type | Notes |
|---|---|---|
| `project` | FK → projects.Project | CASCADE |
| `fiscal_year` | PositiveInteger | Botswana FY start year (2025 = FY 2025/26) |
| `quarter` | PositiveSmallInt (1-4) | |
| `coverage_start` / `coverage_end` | Date | **derived** from (quarter, fiscal_year) in `save()`; authoritative |
| `submission_opens` / `submission_closes` | DateTime (nullable) | admin window |
| `status` | draft / scheduled / open / closed / archived | |
| `allow_late_reporting` | Bool | |
| `late_reporting_opens` / `late_reporting_closes` | DateTime (nullable) | |
| `notes` | Text | |
| `created_by` | FK → users.User (SET_NULL) | |
| `created_at` / `updated_at` | DateTime | |

**Constraints & indexes**

* `UniqueConstraint(project, fiscal_year, quarter)` — exactly one period per
  project+quarter, so "only one Open per project+quarter" is guaranteed
  structurally.
* Indexes: `(project,status)`, `(project,fiscal_year,quarter)`, `(status)`,
  `(fiscal_year,quarter)`, `(submission_opens)`, `(submission_closes)`,
  `(coverage_start,coverage_end)` — the lookup is a single indexed hit.

**No changes** to `Aggregate`, its natural key, indicators, targets, or existing
data. The audit `action` choices are extended (migration `audit/0005`) with the
reporting-control events — additive only.

---

## 3. API changes

**Admin (administrators only — `IsReportingAdmin`):**
`/api/aggregates/reporting-periods/`

* `GET` / `POST` / `PATCH` / `DELETE` (delete allowed only for Draft)
* `POST {id}/schedule/` · `open/` · `close/` · `reopen/` · `archive/`
* `POST {id}/enable-late/` · `disable-late/`
* `POST {id}/duplicate/` → creates the next quarter's Draft
* `GET  {id}/progress/` → completion snapshot (eligible / submitted / approved /
  rejected / outstanding + ids + percentage)

Every transition is fully audited (user, timestamp, project, quarter, reason, IP,
action). `open/` refuses to open before the quarter has elapsed unless a
superuser passes an audited `allow_early_reporting` override.

**Organisation (display only, scoped to the caller's orgs):**
`GET /api/aggregates/reporting-status/?project=&quarter=&fiscal_year=[&organization=]`
returns the window `state`, `can_submit`, `message`, window dates, `days_remaining`,
late-reporting info and (if `organization` given) that org's submission status.

---

## 4. UI changes

* **`components/reporting/ReportingStatusBanner.tsx`** — drop-in banner for the
  organisation dashboard / reporting form. Fetches `reporting-status`, shows the
  quarter, coverage dates, window dates, countdown, late status and submission
  status, and calls back `onStatus(status)` so the host form can enable/disable
  Upload Workbook / Submit / Data Entry / Bulk Upload to match `can_submit`.
* **`app/(dashboard)/reporting-periods/page.tsx`** — admin management page:
  create periods, open/schedule/close/reopen/archive, enable/disable late,
  duplicate to next quarter, and a per-period + overall completion view
  (submitted vs eligible, outstanding count). Admin-gated (`role === 'admin'`).
* **`lib/api/services/reportingPeriods.ts`** — typed client for all of the above.

The frontend performs **no** authoritative validation — buttons are a UX nicety;
the backend rejects any out-of-window write regardless.

---

## 5. Validation flow (write path)

For every attempted aggregate write, in order:

1. **Role gate** — `can_submit_aggregates` (existing).
2. **Training/live boundary** — `assert_project_write_allowed` (existing).
3. **Project status** — archived/completed projects reject (existing M6).
4. **Org assigned to project** — `is_organization_in_project_scope` (existing).
5. **Org has the indicator assigned** — `is_indicator_assigned_to_organization`
   (existing).
6. **Timing gate** — `reporting_control.evaluate_window`:
   1. Quarter fully elapsed? (floor — always on)
   2. If a `ReportingPeriod` exists: is it Open (within announced dates) or in an
      active Late window?
   3. Deadline passed → only late reporting keeps it open.
7. **Duplicate prevention** — the `Aggregate` natural key
   `(indicator, project, organization, period_start, period_end)` upserts:
   an existing row is updated in place (never a second row); a *real* change
   returns it to `pending` (existing IMP-1 lifecycle). Editing an existing row is
   **not** re-gated by the window, so an in-flight/downloaded workbook can always
   be corrected.

Only NEW rows are gated by steps 6; the override (superuser +
`allow_early_reporting=true`) is audited once per request.

---

## 6. Tests added

`aggregates/tests_reporting_control.py` (26 tests) covers:

* Full decision matrix: no-period-elapsed (open by default), no-period-future
  (blocked by floor), draft, scheduled, open, open-before-announced, open-past-
  deadline, late, closed, archived, and open-future-still-blocked-by-floor.
* Model invariants: derived coverage, uniqueness per project+quarter, clean()
  rejects opening before the quarter elapses.
* Central write-path enforcement via the real API: blocked when Draft, allowed
  when Open, allowed with no period (backward compat), existing row editable
  when window Closed, superuser override + audit.
* Admin lifecycle API: non-admin 403, create/open/close with audit, cannot open
  a future quarter, enable/disable late with audit, duplicate → next quarter,
  progress snapshot.
* Org status endpoint.

Existing `aggregates/test_hardening.py::QuarterCompletionRuleTests` updated for
the renamed override audit action. **Full `aggregates`+`audit` suite: 191 tests
green** (sqlite).

---

## 7. Migration plan

1. Ship `aggregates/0009_reportingperiod_and_more` and `audit/0005_alter_auditevent_action`.
   Both are additive: one new table + one `AlterField` on `action` choices
   (choices are not enforced at the DB level → no data rewrite).
2. `python manage.py migrate` — fast (create table + indexes on an empty table).
3. **No backfill.** With zero `ReportingPeriod` rows, behaviour is identical to
   today (quarter-completion floor only). Admins opt in per project+quarter by
   creating periods when ready.
4. Rebuild the backend image (models/service/views baked in) and the frontend
   image (new page/component/service). Standard local-first: build locally, deploy
   in the evening.

---

## 8. Rollback plan

* **Frontend:** revert to the previous image tag; the new page/component simply
  disappear. No data impact.
* **Backend, non-destructive:** to disable enforcement without a migration, the
  overlay is inert whenever no `ReportingPeriod` rows exist — deleting/closing
  them reverts to floor-only behaviour. Setting a period back to any non-open
  state immediately stops new submissions for that quarter.
* **Full rollback:** `migrate aggregates 0008` drops `aggregates_reportingperiod`
  (safe — no other table references it) and `migrate audit 0004` restores the
  prior action choices (choices-only change, no data loss). Redeploy the prior
  backend image. Existing aggregates are untouched throughout.

---

## 9. Before / after workflow

**Before**

```
Org downloads workbook → uploads any time → aggregate created (only gated by the
quarter-completion floor: must be after the quarter ends).
```

**After**

```
Admin creates ReportingPeriod(Q, FY) → Draft
     → (optionally) Schedule (announce dates)
     → Open  ── org may now upload/submit/enter data (window enforced)
     → deadline passes → Closed  ── submissions blocked
     → (optional) Enable late → Late window ── submissions accepted again
     → Archive → read-only

Org dashboard shows the live state + countdown; buttons enable only while
can_submit is true. Every write is re-checked server-side. No period configured
⇒ identical to "Before".
```

---

## 10. Deployment checklist

- [ ] `python manage.py migrate` (aggregates 0009, audit 0005) on the backend.
- [ ] Rebuild + restart **backend** image (service/views/model baked in).
- [ ] Rebuild + restart **frontend** image (new page + component + service).
- [ ] Smoke: `GET /api/aggregates/reporting-status/?project=<id>&quarter=1&fiscal_year=2025`
      returns a decision.
- [ ] Smoke: as admin, create a period, open it, confirm audit rows appear in the
      Users → Activity tab (`/api/audit/events/`).
- [ ] Confirm an org with **no** configured period can still submit a completed
      quarter (backward-compat guard).
- [ ] Add a `Reporting Periods` nav entry (admin) pointing at `/reporting-periods`.
- [ ] Record deploy in memory per convention; tag rollback images.

### Guardrails honoured
Workbook layouts, indicator config, target config and existing aggregates are
untouched; no duplicate aggregate rows are ever created; coordinator hierarchy
and permissions are unchanged; the reporting-period lookup is a single indexed
query (no N+1); backward compatibility with existing projects is preserved.
