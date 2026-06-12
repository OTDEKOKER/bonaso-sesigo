# BONASO / SESIGO — Module System Map (Phase 1)

Generated 2026-06-12 from the live `BONASOV1` tree. Backend is Django/DRF
(`backend/`), frontend is Next.js App Router (`frontend/`).

## Backend app → API mount → responsibility

| App | URL mount (`core/urls.py`) | Responsibility | Migrations |
|---|---|---|---|
| `users` | `/api/users/` | Auth (JWT), UserViewSet, password reset, request-access | 4 |
| `profiles` | `/api/profiles/` | User profile data | — |
| `organizations` | `/api/organizations/` | Orgs, coordinator/subgrantee hierarchy | 3 |
| `projects` | `/api/manage/` | Projects, project-indicators, targets (POT/CT sync) | 19 |
| `indicators` | `/api/indicators/` | Indicators, **canonicalization**, aliases | 9 |
| `respondents` | `/api/record/` | Respondents, Interactions, Responses | 3 |
| `aggregates` | `/api/aggregates/` | Aggregate submissions, review workflow | 4 |
| `events` | `/api/activities/` | Events + public check-in | — |
| `social` | `/api/social/` | Social posts | — |
| `flags` | `/api/flags/` | Data-quality flags | — |
| `analysis` | `/api/analysis/` | Dashboards, coordinator rollups, exports | — |
| `uploads` | `/api/uploads/` | Workbook import/export, file validation | — |
| `messaging` | `/api/messages/` | Notifications | — |
| `audit` | `/api/audit/` | Audit log | — |
| `idempotency` | (mixin, no mount) | Offline replay dedup (`X-Idempotency-Key`) | yes |
| `core` | `/api/system/status/`, `/api/offline/bootstrap/` | System status, offline bootstrap | — |

## Frontend route groups (`frontend/app/`)

`(auth)`, `(dashboard)`, `checkin`, `offline`, `request-access`, `training`,
`users`, `maintenance`, plus `api/` (route handlers). 41 `.tsx` route/page files.

## Cross-module data flow (verified key paths)

- **Respondent → Interaction → Response**: all three viewsets in
  `respondents/views.py`; each carries `IdempotentMutationMixin` and
  org/project-scoped `get_queryset`. Response create enforces cross-org IDOR
  guard (SEC-2).
- **Indicator → Aggregate/Analytics**: analytics groups on `Indicator.canonical_id`
  via `indicators/canonical.py::canonical_id_map()` (`analysis/views.py`,
  `analysis/services/coordinator_rollups.py`).
- **POT ↔ CoordinatorTarget**: bidirectional signal sync in
  `projects/target_sync.py` (errors swallowed+logged, non-fatal).
- **Offline → Respondents/Interactions/Responses/Aggregates**: idempotency mixin
  on all four mutation viewsets.

## Scoping helpers (org/project/training isolation)

`respondents/views.py` and peers use `is_organization_admin`,
`filter_queryset_by_assigned_projects`, `get_user_organization_ids`,
`filter_queryset_by_org_ids`, `apply_training_filter`,
`assert_project_write_allowed`.
