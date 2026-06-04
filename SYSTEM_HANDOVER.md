# BONASOV1 System Handover Guide

Last updated: 2026-06-03

> Update note (2026-06-03): Sections 14 and 15 have been reconciled with the
> live system after the audit-fixes + offline-first deployment. Most of the
> originally-listed risks are now resolved; the remaining open items and the
> features added since 2026-04-24 are documented in Sections 14, 15, and 19.

## 1) Purpose Of This Document

This is the technical and operational handover for the BONASOV1 system running in this workspace:

- Frontend: Next.js app (`/home/bonasoadmin/BONASOV1/frontend`)
- Backend: Django REST API (`/home/bonasoadmin/BONASOV1/backend`)
- Live stack pointer in this host: `LIVE_SYSTEM.md` indicates `compose.server.yaml` is the active deployment entrypoint.

This guide is written for incoming maintainers who need to run, debug, and safely evolve the system.

## 2) System Snapshot

BONASOV1 is a data portal for program monitoring and reporting. It supports:

- User authentication and role-based access by organization scope
- Organizations, projects, indicators, respondents/interactions, events, flags, messages
- Aggregate data entry and approval workflow (pending -> reviewed -> approved/flagged/rejected)
- Workbook upload/import workflows for quarterly reporting
- Dashboard/analysis/trend reporting
- Offline-first frontend behavior (PWA + queued mutations)
- Android shell packaging via Capacitor

## 3) Runtime Architecture

### 3.1 High-level flow

1. Browser/mobile app loads Next.js frontend.
2. Frontend calls `/api/*` on the same host.
3. Next.js catch-all proxy route forwards `/api/*` to Django backend (`BACKEND_API_URL`).
4. Django handles auth and domain APIs, persists to DB, and returns JSON.
5. Frontend renders modules and stores auth tokens client-side.

### 3.2 Live compose topology in this workspace

File: `/home/bonasoadmin/BONASOV1/frontend/compose.server.yaml`

- `frontend` container:
  - Port: `13000` (host mode)
  - `NEXT_PUBLIC_API_URL=/api`
  - `BACKEND_API_URL=http://127.0.0.1:18000/api`
- `backend` container:
  - Port: `18000` (host mode)
  - Reads `/app/.env`
  - Mounts `uploads`, `media`, `staticfiles`, and frontend script folder at `/app/workbook-imports`

### 3.3 API proxy behavior

File: `/home/bonasoadmin/BONASOV1/frontend/app/api/[[...path]]/route.ts`

- Proxies all HTTP methods
- Preserves response status/body
- Strips hop-by-hop headers
- Returns `502` JSON when backend is unreachable

## 4) Technology Stack

## 4.1 Frontend

- Next.js App Router (`next@16`)
- React 19
- TypeScript
- Tailwind + Radix UI components
- SWR data fetching
- Service worker + IndexedDB mutation queue for offline mode
- Capacitor Android integration

## 4.2 Backend

- Django 4.2
- Django REST Framework
- SimpleJWT auth
- Djoser
- django-filter
- django-cors-headers
- WhiteNoise
- PostgreSQL (preferred via `DATABASE_URL`) or SQLite fallback
- OpenPyXL for workbook processing/export

## 5) Repository/Folder Map

## 5.1 Frontend (`/home/bonasoadmin/BONASOV1/frontend`)

- `app/`: route modules (`dashboard`, `aggregates`, `analysis`, `uploads`, `report-workbooks`, etc.)
- `lib/api/`: API client and service modules by domain
- `lib/offline/`: mutation queue and sync logic
- `components/`: reusable UI + feature components
- `scripts/`: operational import/audit/repair scripts
- `public/sw.js`: service worker
- `compose*.yaml`: container run modes

## 5.2 Backend (`/home/bonasoadmin/BONASOV1/backend`)

- `core/`: Django settings and root URLs
- Domain apps:
  - `users`, `organizations`, `indicators`, `projects`
  - `respondents`, `aggregates`, `events`
  - `flags`, `analysis`, `profiles`, `uploads`, `messaging`, `social`
- `uploads/management/commands/`: workbook import management commands
- `docker-entrypoint.sh`: migration/static/bootstrap + gunicorn start

## 6) Domain Model (Practical)

Core entities and links:

- `Organization`: hierarchical (`parent`, descendants)
- `User`: role + linked organization
- `Project`: linked organizations and indicators
- `Indicator`: category/type + optional org scoping + aliases
- `Aggregate`: indicator + project + organization + period + JSON value + review status
- `Respondent` -> `Interaction` -> `Response`
- `Event` + `Participant` + token-based check-in
- `Flag` + `FlagComment`
- `Report`, `SavedQuery`, `ScheduledReport`, `CoordinatorTarget`

Key behavior:

- Most querysets are org-scoped unless user is admin/staff/superuser.
- Approved aggregates drive analysis totals and project indicator current values.

## 7) Authentication And Access Control

Main auth endpoints:

- `POST /api/users/request-token/`
- `POST /api/users/token/refresh/`
- `GET /api/users/me/`
- `POST /api/users/logout/`

Frontend behavior:

- Access/refresh tokens are stored in browser storage.
- API client injects `Authorization: Bearer`.
- Offline mutation replay refreshes auth header from current local token.

Roles in use:

- `admin`, `manager`, `officer`, `collector`, `client`

Org scope helper:

- `backend/organizations/access.py` is the central org-scope utility (`get_user_organization_ids`, `is_organization_admin`, queryset filtering helpers).

## 8) Aggregates Workflow (Critical Operations Path)

## 8.1 Status lifecycle

`draft` -> `pending` -> `reviewed` -> `approved` or `flagged` or `rejected`

Important behavior:

- Create/update resets row to `pending`.
- Approve updates project-indicator rolled-up current totals.
- Bulk approve available at `/api/aggregates/bulk_approve/` (admin scope).
- Flagging creates a `Flag` record and marks aggregate as `flagged`.

## 8.2 Review queue in frontend

Frontend supports:

- Single review
- Single approve
- Bulk approve
- Flag for correction
- Edit and re-submit
- Delete

Main files:

- `frontend/components/aggregates/AggregateReviewQueue.tsx`
- `frontend/app/(dashboard)/aggregates/hooks.ts`
- `frontend/lib/api/services/aggregates.ts`

## 9) Workbook Import Pipeline

There are two active patterns:

## 9.1 API-driven upload -> queue aggregate review

Endpoint: `POST /api/uploads/{id}/start_import/`

Implemented in:

- `backend/uploads/views.py`

Flow:

1. Upload file via `/api/uploads/`.
2. Call `start_import` with:
   - `queue_aggregate_review=true`
   - `project_id`
   - `reporting_period` or `period_start`+`period_end`
   - optional `sheet_names`
   - optional `indicator_overrides`
   - optional `sheet_org_overrides`
   - optional `dry_run`
3. Backend invokes script `import_selected_q3_workbook.py`.
4. Script output report is parsed; import job status updated (`validated` for dry-run, `imported` for live).

Script location used by backend:

- `/app/workbook-imports/import_selected_q3_workbook.py` (mounted from frontend scripts), or fallback to `../frontend/scripts/`.

## 9.2 Management command imports

Available Django commands:

- `import_reporting_workbook_live`
- `import_reporting_workbook_overwrite`

Path:

- `backend/uploads/management/commands/`

Used for structured quarterly imports, indicator creation/linking, and matrix-based assignments.

## 9.3 Workbook support scripts in frontend

Important scripts:

- `frontend/scripts/import_selected_q3_workbook.py`
- `frontend/scripts/review_selected_q3_workbook.py`
- `frontend/scripts/import_reporting_workbook_overwrite.py`
- `frontend/scripts/import_social_contracting_quarter_targets.py`

Common usage mode:

- Dry-run first and inspect generated JSON report before non-dry-run import.

## 10) Offline And Mobile

## 10.1 PWA/offline

Files:

- `frontend/public/sw.js`
- `frontend/lib/offline/mutation-queue.ts`
- `frontend/components/pwa/*`

Behavior:

- Caches shell + API GET responses
- Queues POST/PUT/PATCH/DELETE when offline
- Replays queued mutations when online or background sync triggers
- Sync audit history stored in IndexedDB

## 10.2 Android

File:

- `frontend/capacitor.config.ts`

Notes:

- Defaults server URL to `https://sesigo.org.bw` if `CAP_SERVER_URL` is not provided.
- Commands in package scripts: `mobile:doctor`, `mobile:sync`, `mobile:open:android`.

## 11) Setup And Runbook

## 11.1 Local backend (without Docker)

1. `cd /home/bonasoadmin/BONASOV1/backend`
2. `python -m venv venv`
3. `./venv/bin/pip install -r requirements.txt`
4. Configure `.env`
5. `./venv/bin/python manage.py migrate`
6. `./venv/bin/python manage.py runserver 0.0.0.0:8000`

## 11.2 Local frontend (without Docker)

1. `cd /home/bonasoadmin/BONASOV1/frontend`
2. `npm install`
3. Set `.env.local` (at least `NEXT_PUBLIC_API_URL`)
4. `npm run dev`

## 11.3 Server stack (current host pattern)

1. `cd /home/bonasoadmin/BONASOV1/frontend`
2. `docker compose -f compose.server.yaml up -d --build`
3. Check logs:
   - `docker compose -f compose.server.yaml logs -f frontend`
   - `docker compose -f compose.server.yaml logs -f backend`

## 11.4 Backend container startup behavior

`backend/docker-entrypoint.sh` does:

- `migrate`
- `collectstatic`
- optional fixture load
- optional admin bootstrap
- optional user activation/admin-role sync
- starts gunicorn

## 12) Operations Checklist

Before each quarter import:

1. Confirm project exists and target period dates are correct.
2. Run import in dry-run mode first.
3. Review unknown indicator titles in report output.
4. Apply indicator/sheet overrides if needed.
5. Run live import.
6. Use aggregate review queue to approve only validated rows.
7. Run post-import audit/report comparison script.

Daily ops:

1. Monitor failed import jobs (`/api/uploads/imports/`).
2. Monitor flagged aggregates and resolve comments.
3. Track overdue deadlines and pending approvals.

## 13) Troubleshooting Guide

## 13.1 401/403 issues

- Token expired or invalid -> refresh/login again.
- Verify user role and organization scope.

## 13.2 API unreachable from frontend

- Check `BACKEND_API_URL` and `/app/api/[[...path]]` proxy route.
- Verify backend container listening on expected port.

## 13.3 Workbook import failures

- Validate required `project_id` + period.
- Confirm script path exists in backend mount.
- Check unresolved organization sheets in error payload.
- Re-run with `indicator_overrides` or `sheet_org_overrides`.

## 13.4 Aggregate totals not updating

- Approved status is required for rollup.
- Check `respondents/rollups.py` and `sync_project_indicator_total`.

## 14) Known Risks / Technical Debt

Status legend: 🔴 open · 🟡 partially addressed · ✅ resolved

1. ✅ `report-workbooks` dead module — RESOLVED (removed 2026-06-03).
- The orphaned `/report-workbooks` route (+ training mirror), `lib/api/services/report-workbooks.ts`, and its `lib/api` exports were deleted. The backend never implemented `/report-workbooks/*`.
- The working import path remains the separate `uploads` app (`POST /api/uploads/{id}/start_import/`).

2. ✅ Analysis pivot-tables & line-lists dead UI — RESOLVED (removed 2026-06-03).
- Removed routes `analysis/{pivot-tables,line-lists,tables,lists}` (+ training mirrors), the `PivotTablesWorkspace`/`LineListsWorkspace` components, the `pivotTablesService`/`lineListsService` and their hooks/types, and the sidebar + analysis-tab entries.
- The analysis router exposes only `reports`, `scheduled-reports`, `saved-queries`, `dashboard`, `coordinator-targets`, and `trends`. Dashboards is retained.

3. ✅ Frontend↔backend path drift — RESOLVED (2026-06-03).
- `coordinator-targets.ts` rewritten to call the single real endpoint `/analysis/coordinator-targets/`; the `localStorage` fabrication fallback and path-probing were removed, so failures now surface as errors.
- `analytics.ts` `dashboardSettingsService` rewritten to target `/analysis/reports/` directly (saved dashboards are `Report(report_type='dashboard')`). The phantom `/analysis/dashboards/*` probes — which 404'd on every load — were removed; `getMeta`/`getBreakdowns` now return their client-side values without a doomed request. Behaviour is unchanged because those endpoints never existed.
- Note: the singular `/analysis/dashboard/` (overview + message_analytics stats, used by the main dashboard page) is a separate, correctly-wired endpoint — there was never an actual singular/plural bug, just two similarly-named features.
- Residual (cosmetic): the old fallback machinery in `analytics.ts` (`tryEndpointVariants`, session-cache helpers, `LEGACY_ANALYTICS_FEATURES`, `normalizeDashboard`/`normalizePaginatedDashboards`/`isDashboardLikeResponse`/`normalizeDashboardMeta`) is now unreferenced dead code, interleaved with still-used normalizers. Safe to delete in a dedicated cleanup; tree-shaken out of the client bundle regardless.

4. ✅ Script/module naming drift — RESOLVED.
- No script imports the bare `import_reporting_workbook` module anymore. Canonical commands are `import_reporting_workbook_live.py` and `import_reporting_workbook_overwrite.py` (a `.bak` backup file remains but is inert).

5. ✅ ProjectIndicator quarter-target schema mismatch — RESOLVED.
- `projects/models.py` defines `q1_target..q4_target` on both `ProjectIndicator` and `ProjectIndicatorOrganizationTarget`, with migration `0002_projectindicator_quarterly_targets`. Raw SQL and model/migrations now agree.

6. ✅ Production security env vars not wired — RESOLVED.
- `core/settings.py` now applies `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, HSTS, referrer policy, and `X_FRAME_OPTIONS` from env, and hard-fails at boot on open CORS or SQLite when `DEBUG=False`.

7. 🟡 Automated tests still thin on critical paths.
- ~46 backend tests across 5 files (projects, training separation, aggregates, offline bootstrap, users) + 2 frontend tests.
- Uncovered: auth login/refresh, `uploads start_import` dry-run/live, aggregate approve→rollup, offline mutation replay, and all frontend↔backend contracts.

8. ✅ Production error tracking / structured logging — RESOLVED (2026-06-03).
- `core/settings.py` now defines a `LOGGING` config (stdout, `LOG_LEVEL`-configurable, optional rotating file via `LOG_DIR`, `django.request` ERROR with tracebacks) and optional Sentry that activates only when `SENTRY_DSN` is set and `sentry-sdk` is installed. See Section 19.7 and `.env.production.example`.

9. 🟡 Mobile app is not offline-first as shipped.
- `capacitor.config.ts` defaults to the remote wrapper (needs internet to launch). The true offline `CAP_LOCAL_BUNDLE` mode exists but is not the default and not released.

10. 🟡 Dependencies unpinned + Django LTS clock.
- `backend/requirements.txt` uses `>=` ranges (non-reproducible builds). Django is pinned `>=4.2,<5.0`; plan the 5.x migration ahead of 4.2 LTS EOL.

11. 🟡 Backups are local-only.
- Daily `pg_dump` output lives on the same host/disk as the DB; no off-site copy or tested restore procedure yet (see Section 19).

## 15) Recommended Immediate Stabilization Tasks

Completed 2026-06-03: dead UI removal (report-workbooks, pivot-tables, line-lists), the
coordinator-targets fabrication fallback, and the error-tracking/`LOGGING` config — see
Section 14 items 1–3, 8 and Section 19.7. Remaining priorities:

1. ✅ Done — analysis/report-workbooks dead UI removed and the coordinator-targets fabrication fallback stripped (Section 14, items 1–3).
2. ✅ Done — `/analysis/pivot-tables`, `/analysis/line-lists`, and `/report-workbooks` removed from navigation and routing (Section 14, items 1–2).
3. ✅ Done — error tracking + `LOGGING` config added (Section 14, item 8; Section 19.7).
4. ✅ Done — `dashboardSettingsService` now targets `/analysis/reports/` directly; phantom `/analysis/dashboards/*` probes removed (Section 14, item 3). There was no real route mismatch — `/analysis/dashboard/` is a separate, correctly-wired stats endpoint.
5. 🟡 (Cleanup) Delete the now-dead `analytics.ts` fallback machinery (Section 14, item 3 residual).
6. 🔴 Off-site backup replication + a written, tested restore procedure.
7. 🟡 Pin dependencies for reproducible builds; schedule the Django 4.2→5.x migration.
8. 🟡 Add smoke tests for:
   - auth login/refresh
   - aggregate review/approve lifecycle
   - upload `start_import` dry-run + live path
   - offline mutation replay

## 16) Handover Day-1 Checklist

1. Confirm access to host, containers, DB, and environment files.
2. Bring stack up and validate login + dashboard load.
3. Validate backend health endpoint (`/api/users/test-connection/`).
4. Run one import dry-run and inspect output report.
5. Review aggregate queue and approve a test row.
6. Confirm export works (`aggregates/export` CSV and Excel).
7. Document production credentials and secret rotation process separately (not in repo).

## 17) Reference Files

- Frontend runtime/deploy:
  - `/home/bonasoadmin/BONASOV1/frontend/compose.server.yaml`
  - `/home/bonasoadmin/BONASOV1/frontend/Dockerfile`
  - `/home/bonasoadmin/BONASOV1/frontend/app/api/[[...path]]/route.ts`
- Backend runtime/deploy:
  - `/home/bonasoadmin/BONASOV1/backend/core/settings.py`
  - `/home/bonasoadmin/BONASOV1/backend/core/urls.py`
  - `/home/bonasoadmin/BONASOV1/backend/docker-entrypoint.sh`
- Import and aggregate workflow:
  - `/home/bonasoadmin/BONASOV1/backend/uploads/views.py`
  - `/home/bonasoadmin/BONASOV1/backend/aggregates/views.py`
  - `/home/bonasoadmin/BONASOV1/frontend/scripts/import_selected_q3_workbook.py`
  - `/home/bonasoadmin/BONASOV1/backend/uploads/management/commands/import_reporting_workbook_live.py`
  - `/home/bonasoadmin/BONASOV1/backend/uploads/management/commands/import_reporting_workbook_overwrite.py`
  - `/home/bonasoadmin/BONASOV1/backend/scripts/verify_monthly_payload_parity.py`
  - `/home/bonasoadmin/BONASOV1/backend/scripts/snapshot_monthly_truth_baseline.py`
  - `/home/bonasoadmin/BONASOV1/backend/scripts/run_monthly_payload_parity_check.sh`

## 18) Monthly Workbook Source-Of-Truth Controls

Monthly workbooks are the source of truth for scoped CSO reporting.

Use these scripts from:

1. `cd /home/bonasoadmin/BONASOV1/backend`

### 18.1 Full payload parity check (workbook vs aggregate JSON)

1. `./venv/bin/python scripts/verify_monthly_payload_parity.py --project-id 2 --parent-org-id 5 --json-out reports/monthly_parity_latest.json`

Expected behavior:

1. Exit code `0`: exact parity for compared payloads.
2. Exit code `1`: one or more gaps/mismatches found (see `summary` + `diff_sample` in report JSON).

### 18.2 Baseline snapshot export (DB truth at a point in time)

1. `./venv/bin/python scripts/snapshot_monthly_truth_baseline.py --project-id 2 --parent-org-id 5 --period-start 2025-07-01 --period-end 2026-03-31`

Outputs:

1. `aggregates.jsonl`
2. `indicators.jsonl`
3. `project_indicators.jsonl`
4. `project_organizations.jsonl`
5. `organizations.jsonl`
6. `manifest.json`

### 18.3 Cron-safe wrapper (parity + optional snapshot on pass)

1. `./scripts/run_monthly_payload_parity_check.sh`
2. `./scripts/run_monthly_payload_parity_check.sh --snapshot-on-pass`

Wrapper behavior:

1. Writes timestamped parity JSON + log to `backend/reports/monthly_parity_checks/`.
2. Returns the parity script exit code.
3. If `--snapshot-on-pass` is set, writes a snapshot only when parity passes.

### 18.4 Cron example

Run every day at 01:30 (server time):

1. `30 1 * * * cd /home/bonasoadmin/BONASOV1/backend && /bin/bash ./scripts/run_monthly_payload_parity_check.sh --snapshot-on-pass >> /home/bonasoadmin/BONASOV1/backend/reports/monthly_parity_checks/cron.log 2>&1`

## 19) Changes Since 2026-04-24 (Current State)

These were added/changed after the original handover and are now part of the live system.

### 19.1 Repository / layout
- The git repository now lives at the `BONASOV1/` root (frontend + backend + training together), re-initialised 2026-06-01. There is no remote — history is local only.

### 19.2 New backend endpoints
- `GET /api/system/status/` — system status (`core/status_views.py`); backs the frontend `/system-status` page and `lib/api/services/system.ts`.
- `GET /api/offline/bootstrap/` — offline sync-down package for field capture (`core/offline_views.py`); org/user-scoped, includes assigned respondents (PII), projects, indicators, periods.

### 19.3 Security hardening (live)
- Production boot guards: refuses to start with `CORS_ALLOW_ALL_ORIGINS=True` or on SQLite when `DEBUG=False` (`core/settings.py`).
- Security headers/cookies (SSL redirect, HSTS, secure + CSRF cookies, referrer policy, `X_FRAME_OPTIONS`) wired from env.
- Scoped throttling: public event check-in is `AllowAny` + `event_checkin` throttle (default `30/minute`).
- `no-store` cache-control on `/api/record` responses (respondent/interaction PII) via `core/middleware.ApiCacheControlMiddleware`.

### 19.4 Offline-first field capture + mobile
- Web PWA offline stack: `frontend/public/sw.js`, `lib/offline/mutation-queue.ts`, `lib/offline/offline-auth.ts`, `lib/offline/local-store.ts`. UI: download-for-offline control + offline-data status in the sync panel.
- Capacitor supports a `CAP_LOCAL_BUNDLE=1` offline bundle mode (DHIS2 Tracker Capture style) in addition to the default remote wrapper. See `docs/OFFLINE_ANDROID.md`.

### 19.5 Backups & data-integrity automation (cron)
- Daily DB backup: `backend/scripts/backup_database.sh` → `backend/backups/database/*.dump` + `.json` + manifest. Cron `0 2 * * *`.
- Monthly payload parity check: `backend/scripts/run_monthly_payload_parity_check.sh --snapshot-on-pass`. Cron `30 1 * * *`.
- Nightly consistency check: `backend/scripts/nightly_consistency_check.sh` (+ `projects` management command `check_project_consistency`). Cron `15 2 * * *`.
- All three write logs/reports under `backend/backups/` and `backend/reports/`. Note: backup output is local-only (see Section 14, item 11).

### 19.6 Training stack separation
- `training/compose.training.yaml` is a fully isolated, bridge-networked stack: its own `training-db` (Postgres 18), its own `TRAINING_SECRET_KEY`, `ALLOWED_HOSTS`, and locked CORS. Gunicorn binds `0.0.0.0` inside the bridge network (the live stack binds loopback for nginx). nginx configs: `training/nginx-training.*.conf`.

### 19.7 Logging & error tracking (added 2026-06-03)
- `core/settings.py` defines a `LOGGING` config: logs to stdout (captured by Docker/journald), level via `LOG_LEVEL` (default INFO), optional rotating file when `LOG_DIR` is set, and `django.request` at ERROR so unhandled 500s log a traceback. Skipped under the test runner.
- Optional Sentry: activates only when `SENTRY_DSN` is set AND `sentry-sdk` is installed (commented in `requirements.txt`); otherwise a no-op. Env vars documented in `.env.production.example` (`LOG_LEVEL`, `LOG_DIR`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`).

### 19.8 Dead-UI removal (2026-06-03)
- Removed the orphaned `report-workbooks` module and the analysis `pivot-tables`/`line-lists` (and their `tables`/`lists` redirect aliases + training mirrors), including services, hooks, types, and nav entries — none had backend support. The `uploads` app remains the supported import path; Reports and Dashboards remain under Analysis.
- `coordinator-targets.ts` now calls the single real endpoint `/analysis/coordinator-targets/` with no local fabrication; coordinator performance rows are still computed client-side in `components/targets/coordinator-targets-page.tsx`.
