# SESIGO / BONASO — Final Hardening Pass (2026-06-12)
Environment mode, report isolation, analysis UI, frozen header, module permissions.
Branch: `rollout-blockers-remediation-2026-06-05`. **Deployed live + verified.**

---

## 1. Executive summary
Five hardening items completed, tested, deployed and verified on the live stack:
1. **JWT mode** is now the sole, tamper-proof source of truth for live/training.
2. **Saved analysis artifacts** (Report/ScheduledReport/SavedQuery) are environment-isolated.
3. **Analysis UI** uses the shared `PageHeader` family + a sticky tab bar.
4. **Main header is frozen** (sticky) on scroll, via a reusable CSS variable.
5. **Module permissions are enforced on the backend** (explicit-deny), not just hidden.

Full backend suite: **246 tests OK**. Frontend typecheck: **0 errors**. `makemigrations --check`: clean. 1 additive migration (backfilled cleanly).

---

## 2. Files changed
**Backend**
- `users/views.py` — login stamps `mode` (live/training) on every token; `UserViewSet` module-gated.
- `organizations/access.py` — `is_training_only_request` reads only the JWT claim; `request_mode_value` + `apply_mode_field_filter` helpers.
- `analysis/models.py` — `mode` field on Report/SavedQuery/ScheduledReport.
- `analysis/views.py` — mode filter + create-stamp on the three viewsets and the home dashboard; `ReportViewSet` module-gated; (chart-export from prior pass).
- `analysis/migrations/0004_*` — add `mode` (default live) + smart backfill.
- `users/permissions.py` (new) — `HasModulePermission` + `module_explicitly_denied`.
- `{projects,indicators,organizations,aggregates,respondents,events,uploads}/views.py` — module-gated.
- Tests: `users/tests_token_mode_claim.py`, `analysis/test_report_isolation.py`, `users/tests_module_enforcement.py` (new); updated `organizations/tests_training_separation.py`, `analysis/test_coordinator_rollup_api.py`, `core/tests_offline_bootstrap.py`.

**Frontend**
- `app/globals.css` — `--app-header-height` var.
- `app/(dashboard)/layout.tsx` — `overflow-x-hidden` → `overflow-x-clip` on header ancestors (fixes sticky); var-based min-height.
- `components/layout/app-header.tsx` — header height from the var.
- `app/(dashboard)/analysis/layout.tsx` — shared `PageHeader` + sticky tab bar under the frozen header.
- removed `components/analysis/analytics-filter-bar.tsx` (dead, 509 lines).

---

## 3. Confirmed issues, root causes, fixes

### 3.1 JWT environment mode
- **Before:** only training logins got a `mode` claim; live logins had none, and `is_training_only_request` fell back to the `training_only`/`mode` **query parameter**. A client could influence the environment by adding/removing a param.
- **Fix:** every token now carries a signed `mode` (live/training), set from the login `mode` field, surviving access refresh + rotation. Backend reads **only** the claim. No-claim (legacy) tokens default to **live** (safe — training stays hidden); the query param can no longer force training.
- **Coverage:** the claim drives every mode-isolated surface (projects, indicators, organizations, aggregates, events, respondents, analysis, offline bootstrap, coordinator targets, chart export) because they all route through the central helpers.
- **Tests:** `tests_token_mode_claim` (live/training/unknown→live/refresh+rotation); separation suite updated to drive training via the claim and prove the param cannot override.

### 3.2 Report / ScheduledReport / SavedQuery isolation
- **Before:** no project FK or environment field → a training-generated report/dashboard could surface in live.
- **Fix:** `mode` field (live/training, indexed); viewsets filter by request mode and stamp on create (incl. the per-org home dashboard, now separate per environment). Migration defaults existing rows to live and smart-flags any report whose params reference a training project (**0 on live**). Admin `include_training=true` shows both.
- **Tests:** `test_report_isolation` — list/detail/download/create/scheduled/admin-opt-in (live can't retrieve or download a training report → 404).
- **Live:** all 10 existing reports backfilled to `live`.

### 3.3 Analysis UI consistency
- **Before:** analysis used a bespoke `<h1>` header; two filter bars existed (`analytics-filter-bar`, `compact-analytics-filter-bar`) but the full one was **imported nowhere**.
- **Fix:** analysis section header now uses the shared `PageHeader`; tab bar is sticky directly below the frozen app header (`top: var(--app-header-height)`); removed the dead filter bar. `CompactAnalyticsFilterBar` is the single analysis filter component.

### 3.4 Frozen main header
- **Before:** `AppHeader` was `position: sticky` but two ancestor wrappers used `overflow-x-hidden`, which establishes a scroll container and **breaks sticky** — the header scrolled away.
- **Fix:** ancestors use `overflow-x-clip` (prevents horizontal overflow without a scrollport), so the header stays frozen on desktop/tablet/mobile. Reusable `--app-header-height` (4rem) drives the header height, the content min-height, and the analysis tab offset. z-index unchanged (header z-30; mobile drawer z-50 still covers it; dialogs/dropdowns use portals). No content hidden underneath.

### 3.5 Module-level permissions (backend enforcement)
- **Before:** module permissions were **frontend-only** (sidebar hide + route guard); the API was reachable directly.
- **Fix:** `HasModulePermission` applied to the users/projects/indicators/organizations/aggregates/respondents/events/uploads/reports viewsets. It blocks **only** modules an admin has **explicitly denied** for a user (disabled or empty-action `UserModulePermission` row) — so it can't lock out un-configured users and never breaks shared cross-module reference loads (e.g. the aggregates page reading `/api/organizations/`). Admins bypass. User create/edit already supports assigning modules (`UserViewSet.module_permissions` action; FE wired previously).
- **Tests:** `tests_module_enforcement` — denied module 403s on direct API; un-configured user and non-denied modules stay 200; admin bypasses.
- **Live:** 0 `UserModulePermission` rows, so this changes nothing until an admin restricts a user.

---

## 4. Tests & results
- Backend full suite: `Ran 246 tests ... OK`.
- New: 4 token-claim, 10 report-isolation, 6 module-enforcement; separation suite updated (claim-driven).
- `makemigrations --check --dry-run`: *No changes detected*. `manage.py check`: 0 issues.
- Frontend `tsc --noEmit`: 0 errors.

## 5. Live verification (post-deploy)
```
report modes on live: {'live': 10}                # backfill correct
deployed token issuance: live->live, training->training
LIVE projects (deployed ProjectViewSet): [(2,False),(3,False)]   # training hidden
chart-export endpoint: HTTP 200 spreadsheetml      # no regression
frontend loopback: 307 (login redirect)            # healthy
```

## 6. Migrations
- `analysis/0004_report_mode_savedquery_mode_scheduledreport_mode` — adds `mode` (default `live`, indexed) to Report/SavedQuery/ScheduledReport + `RunPython` smart backfill (flips rows whose saved params reference a training project; 0 on live). Reverse = `noop` for data, field-drop for schema.

## 7. Deployment & rollback
- **Deployed 2026-06-12:** backend (JWT + report isolation + module gate) with migration `analysis.0004`; frontend (header freeze + analysis layout).
- **DB backup:** `/home/bonasoadmin/backups/predeploy_hardening_20260612_162710.dump` (pg_dump -Fc).
- **Rollback images:** `frontend-backend:rollback_20260612_162617`, `frontend-frontend:rollback_20260612_162617`.
- **Rollback:** `docker tag <rollback> <name>:latest && docker compose -f frontend/compose.server.yaml up -d <svc>`; migration reverse: `python manage.py migrate analysis 0003` (drops the additive `mode` columns — safe, no live data depends on them yet).

## 8. Remaining risks / follow-ups
- **Action-level module control:** the backend gate is module-level (explicit deny blocks the whole module). Finer per-action enforcement (e.g. view-but-not-delete) still relies on the existing role gates; documented, not changed.
- **Module gate scope:** applied to the main module viewsets. Smaller/auxiliary endpoints (messages, social, system-status, flags, batch-record, targets) are not yet gated — additive follow-up using the same `required_module` pattern.
- **Legacy tokens:** until they expire (refresh ≤ 7 days), no-claim tokens are treated as live; training sessions must re-login to get the claim (the training login already does).
- **Deeper analysis-state standardisation** (shared loading/empty/error component swap inside each workspace) is partial — the family structure (PageHeader + sticky tabs + consistent chart export) is in place.
- Branch is local-only — **push to back up.**
