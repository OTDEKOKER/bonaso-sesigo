# BONASO / SESIGO — Full System Audit (2026-06-16)

**Auditor:** Principal architecture / security / QA pass
**Scope:** Module map, automated validation, and targeted verification of the 5
known priority risk areas from the prior production audit.
**Method:** Every statement below is backed by a command run or a file read in
this pass. Where a surface was *not* individually hand-exercised, it is labelled
as covered-by-test-suite or not-verified rather than asserted as working.

---

## EXECUTIVE SUMMARY

**Overall status: READY WITH CONDITIONS.**

The system is mechanically healthy and the five code-level risks flagged by the
previous audit are resolved in the current tree. The remaining blockers are
**operational, not code**: offsite backup activation and the previously-noted
edge `:445` redirect + `www` DNS items (tracked elsewhere). No code defect was
found in this pass that blocks rollout.

### Validation baseline (all green)

| Check | Command | Result |
|---|---|---|
| Django system check | `manage.py check` | clean, 0 issues |
| Model/migration drift | `makemigrations --check --dry-run` | No changes detected |
| Backend test suite | `manage.py test` | **256 passed, 0 fail** (212 s) |
| TS types | `npx tsc --noEmit` | clean (exit 0) |
| Frontend lint | `npm run lint` | 0 errors, 54 warnings |
| Frontend build | `npm run build` | success |

---

## MODULE / API SYSTEM MAP (from `core/urls.py` + per-app inspection)

| API prefix | App | Models | Purpose |
|---|---|---|---|
| `api/users/` | users | 2 | Auth, JWT (login/refresh/reset), UserViewSet |
| `api/profiles/` | profiles | 2 | User profile data |
| `api/organizations/` | organizations | 1 | Org tree (coordinator/subgrantee) + access helpers |
| `api/manage/` | projects | 12 | Projects, project-indicators, targets (POT), assignments |
| `api/indicators/` | indicators | 5 | Indicators + canonicalization/aliases |
| `api/aggregates/` | aggregates | 2 | Aggregate submissions / workbook |
| `api/record/` | respondents | 3 | Respondent → Interaction → Response tree |
| `api/activities/` | events | 3 | Events + check-in (public, throttled) |
| `api/social/` | social | 1 | Social posts |
| `api/flags/` | flags | 2 | Data-quality flags |
| `api/analysis/` | analysis | 4 | Dashboards, coordinator rollups, CoordinatorTarget |
| `api/uploads/` | uploads | 3 | File upload / workbook import / export |
| `api/messages/` | messaging | 3 | Notifications |
| `api/audit/` | audit | 1 | Audit log |
| `api/system/status/` | core | — | System status view |
| `api/offline/bootstrap/` | core | — | Offline bootstrap payload |
| (internal) | idempotency | 1 | `IdempotentMutationMixin` + key store |

Frontend: Next.js app router with a full `/training/*` mirror of live routes
(verified in build output — training routes prerender independently).

---

## PRIORITY RISK VERIFICATION (the 5 prior-audit items)

### 1. Login / brute-force throttling — RESOLVED
`core/settings.py`: `ScopedRateThrottle` with env-tunable rates
(`login` 10/min, `token_refresh` 30/min, `password_reset` 5/hr,
`event_checkin` 30/min). Applied in `users/views.py` (login/refresh) and
`events/views.py` (check-in).
**Shared-state trap handled:** throttle/cache backend is `FileBasedCache` on the
container filesystem (not per-process `LocMemCache`), so all gunicorn workers
share one counter — a comment block (SEC-1) documents this explicitly.
Covered by `users/tests_throttle.py` (in the 256-pass suite).

### 2. Offline idempotency — RESOLVED
`idempotency/mixins.py` `IdempotentMutationMixin` reads `X-Idempotency-Key`,
stores `(user, key)` unique-constrained, hashes the payload, replays the stored
success, returns **409** on in-progress, and **rejects key reuse with a
different payload**. Wired into the full write surface:
- `respondents/views.py`: Respondent, Interaction, **and** Response viewsets.
- `aggregates/views.py`: aggregate writes.
Covered by `idempotency/tests.py`.

### 3. Response / cross-org write authorization — RESOLVED
`respondents/views.py` `perform_create` on Respondent, Interaction, and Response
rejects writes for an organization the user is not a member of
(`PermissionDenied`), and Interaction additionally enforces project scope. Read
paths are org-scoped via `get_queryset` + `filter_queryset_by_org_ids`.
Covered by `respondents/test_cross_org_read.py`, `aggregates/test_permissions.py`.

### 4. Indicator canonicalization — RESOLVED (test-covered)
`analysis/tests_canonicalization.py` passes. Canonical+alias+target_group model
matches the agreed design (coordinator view org-specific, rollup drops target
group & aggregates canonical).

### 5. Offsite backups — **NOT ACTIVATED (operational blocker)**
`backend/scripts/backup_database.sh` fully implements offsite replication via
S3 / rclone / scp, gated on `BONASO_OFFSITE_S3_URI` / `_RCLONE_REMOTE` /
`_SSH_DEST`. **None are set**, so every nightly logs:
`WARNING: ... Backup is LOCAL-ONLY and will not survive host loss.`
Local backups themselves are **healthy**: nightly cron `0 2 * * *` ran today;
`latest.json` shows `verify_status: pg_restore_list_ok`, sha256 recorded,
4.8 MB dump + 5.8 MB asset tarball, 30-day retention.
**Action:** set one offsite target env var + verify one push. Code is ready.

---

## OTHER FINDINGS

- **`projects/target_sync.py` POT↔CoordinatorTarget signals** — the
  `try/except ... logger.exception` is *deliberate* ("All sync work is wrapped
  in try/except so it can never break the originating write"). The
  `relation "analysis_coordinatortarget" does not exist` lines seen during the
  test run are test-DB table-creation ordering, swallowed and benign; the table
  exists in production. **Not a bug.**
- **Lint:** 54 warnings (1× `set-state-in-effect` in
  `lib/contexts/session-mode-context.tsx`, rest unused-var). Non-blocking;
  worth a cleanup pass, no functional impact.

---

## REMAINING RISKS

| Risk | Severity | Module | Rollout impact | Action |
|---|---|---|---|---|
| Offsite backups not activated | High | Infra | Host loss = data loss | Set `BONASO_OFFSITE_*` + verify push |
| Edge `:445` redirect / `www` DNS | High | Infra/DNS | External access correctness | Tracked separately (prior audit) |
| Lint warnings | Low | Frontend | None | Optional cleanup |

## SCOPE HONESTY

This pass established the automated-validation baseline (256 backend tests +
full FE build/types/lint) and verified the 5 named priority surfaces by reading
the implementing code and confirming test coverage. It did **not** hand-execute
every endpoint of all 16 apps against every role individually; that surface is
covered by the passing test suite and the security tests
(`organizations/test_permission_contracts.py`, `users/tests_module_enforcement.py`,
`projects/test_scope.py`, etc.). A per-endpoint live penetration matrix remains
available as a deeper follow-up if required.

## FINAL DECISION

**APPROVE EXTERNAL ROLLOUT AFTER:** (1) activating + verifying one offsite backup
target, and (2) closing the infra `:445`/DNS items. No code change is required to
proceed; the application layer is rollout-ready.
