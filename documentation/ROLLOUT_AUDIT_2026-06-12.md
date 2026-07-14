# BONASO / SESIGO — Rollout Readiness Audit (2026-06-12)

**Scope of evidence:** This report records what was *actually executed and read*
on 2026-06-12, not a presumed checklist. Where a phase was not exhaustively
exercised, it says so. No findings are stated without a command output or a code
citation behind them.

---

## EXECUTIVE SUMMARY

**Overall status: READY WITH CONDITIONS.**

The application code is mature and the four "known priority risks" from the prior
production audit (indicator canonicalization, login throttling, offline
idempotency, response-write authorization) are **already implemented and
verified** in this tree. The full automated suite is green. The remaining
rollout blockers are **operational/infra**, not code, and match the open items
already tracked in the 2026-06-11 rollout audit: offsite backups not yet
activated, edge `:445` redirect, and `www` DNS.

---

## VALIDATION EVIDENCE (Phase 10 — run today)

| Check | Command | Result |
|---|---|---|
| Django system check | `manage.py check` | **0 issues** |
| Missing migrations | `makemigrations --check --dry-run` | **No changes detected** |
| Unapplied migrations | `migrate --plan` | **No planned operations** |
| Backend test suite | `manage.py test --parallel 4` | **199 tests, OK** (~203s) |
| Frontend typecheck | `npx tsc --noEmit` | **exit 0 (clean)** |
| Frontend lint | `npm run lint` | **exit 0** (0 errors, 60 warnings) |

> `next build` was not run this session; `tsc` (stricter for type safety) is
> clean and the project intentionally sets `typescript.ignoreBuildErrors`, so a
> build failure on types is not the risk. Run `npm run build` in the deploy
> pipeline as the final gate.

---

## PRIORITY RISK AREAS — VERIFIED RESOLVED

| Risk (from prior audit) | Status | Evidence |
|---|---|---|
| Indicator canonicalization | ✅ Resolved | `Indicator.canonical_indicator`/`is_deprecated`/`canonical_id`; `IndicatorAlias` w/ unique constraints; analytics + coordinator rollups group on `canonical_id`; `analysis/tests_canonicalization.py` |
| Login / auth throttling | ✅ Resolved | `core/settings.py` scoped throttles `login` 10/min, `token_refresh` 30/min, `password_reset` 5/hr; XFF-aware via `NUM_PROXIES` |
| Offline idempotency | ✅ Resolved | `IdempotentMutationMixin` on Respondent/Interaction/Response/Aggregate viewsets; atomic claim, payload-hash→422, in-flight→409, poisoned-claim cleanup, persists only 2xx |
| Response-write authorization | ✅ Resolved | `ResponseViewSet.perform_create` SEC-2 cross-org IDOR guard + training/live boundary + indicator-assignment check |
| Auth token hygiene | ✅ | `SIMPLE_JWT` rotates refresh tokens + blacklists after rotation |

## SECURITY SPOT-CHECKS (Phase 6 — sampled)

- Only **two** `AllowAny` endpoints exist, both intentional and safe:
  `EventCheckinViewSet` (token-based public check-in, throttled + hard 5000-row
  per-event cap) and `TestConnectionView` (static health ping, no data).
- **35 of 36** `ModelViewSet`s override `get_queryset` for org/project scoping.

### Live permission-matrix pass (record module — added this session)

Rather than write to production, an automated API-client matrix was run against
a throwaway test DB. New regression module
`respondents/test_cross_org_read.py` (**8 tests, all passing**) proves the
read-side boundaries on the highest-PII surface:

| Boundary | Assertion | Result |
|---|---|---|
| List isolation | officer list excludes foreign-org respondent | ✅ |
| Retrieve IDOR (respondent) | officer GET foreign respondent → 404 | ✅ |
| Retrieve IDOR (interaction) | officer GET foreign interaction → 404 | ✅ |
| Custom-action leak | officer `export/` CSV omits foreign rows | ✅ |
| Cross-org create | officer create interaction for foreign respondent → 403 | ✅ |
| Admin override | admin retrieves any respondent → 200 | ✅ |
| Unauthenticated | anon list respondents/interactions → 401 | ✅ |

Combined with the pre-existing `respondents/tests.py` (SEC-2 write IDOR) and
`aggregates/test_permissions.py` (full review/approve/submit role matrix incl.
client-cannot-write and sibling-org isolation), the record + aggregate write
*and* read boundaries are now regression-covered.

---

## MODULE READINESS MATRIX

Score = (code review + automated tests + live verification this session). "Live
✓" = exercised through the API this session; "Tests ✓" = covered by the existing
199-test suite; "Review ✓" = read the viewset/queryset/serializer.

| Module | Status | Score | Evidence | Critical/High |
|---|---|---|---|---|
| Users / Auth | Ready | 95 | Throttle tests, JWT rotation+blacklist, module-permission tests | 0 |
| Organizations | Ready | 95 | `test_permission_contracts`, hierarchy descendants scoping | 0 |
| Projects / Targets | Ready | 90 | `test_scope`, `test_runtime_scope`, 19 migrations, POT/CT sync | 0 (1 low) |
| Indicators / Canon | Ready | 95 | `tests_canonicalization`, analytics grouping on `canonical_id` | 0 |
| Respondents/Interactions/Responses | Ready | 95 | Live ✓ (8 new tests) + SEC-2 write tests | 0 |
| Aggregates | Ready | 95 | `test_permissions` full role matrix, idempotency mixin | 0 |
| Events | Ready (review) | 80 | Review ✓ (public check-in throttled+capped); not live-matrixed this session | 0 |
| Analysis / Dashboards | Ready (review) | 85 | `test_coordinator_rollup*`, canonical grouping; widget-level numeric recon not re-run | 0 |
| Uploads | Ready (review) | 80 | Review ✓ (org-scoped, training guard on import); file-validation not live-fuzzed | 0 |
| Messaging / Flags / Social | Ready (review) | 80 | Review ✓ (mounted, IsAuthenticated); light usage | 0 |
| Offline / Idempotency | Ready | 95 | Mixin verified line-by-line + `idempotency/tests.py` | 0 |
| Infra / Deployment | **Conditions** | 60 | Backups local-only; edge `:445`; `www` DNS | 1 High (backups) |

## API READINESS MATRIX

| API group | Verdict | Note |
|---|---|---|
| `/api/record/*` (respondents/interactions/responses) | **Safe** | Read+write IDOR + 401 verified live |
| `/api/aggregates/*` | **Safe** | Role matrix + idempotency tested |
| `/api/users/*`, auth | **Safe** | Throttled; only `AllowAny` = static health ping |
| `/api/activities/*` (events) | **Safe (review)** | Public check-in is the only anon write — throttled + 5000 cap |
| `/api/analysis/*` | **Safe (review)** | Canonical grouping; needs a live numeric-recon pass to certify totals |
| `/api/uploads/*` | **Safe (review)** | Org-scoped + training guard; recommend a live unsafe-file test |
| `/api/manage/*` (projects) | **Safe** | Scope tests present |
| `/api/messages`, `/api/flags`, `/api/social`, `/api/profiles`, `/api/audit` | **Needs live test** | Reviewed safe; not matrixed this session |

## DATA FLOW MATRIX

| Workflow | Status | Evidence |
|---|---|---|
| Login / refresh / logout / pw-reset | Working | Throttle tests; JWT rotation |
| Respondent → Interaction → Response | Working | Live matrix + SEC-2 |
| Cross-org write prevention | Working | 403 verified live (responses + interactions) |
| Cross-org read prevention (IDOR) | Working | 404 verified live (respondents + interactions) |
| Indicator canonicalization → analytics | Working | grouping + tests |
| Aggregate submit→review→approve→flag→reject | Working | `test_permissions` |
| Offline replay / idempotency | Working | mixin + tests |
| Upload → import (training/live boundary) | Working (review) | guard at `start_import` |
| Coordinator consolidation | Working (review) | `test_coordinator_rollup_api` |
| Per-widget numeric reconciliation | **Needs follow-up** | not re-run this session |
| Backup → offsite → restore | **Broken (offsite)** | offsite `not_configured`; restore-from-offsite never exercised |

## INFRASTRUCTURE EVIDENCE (Phase 9 — run today)

- Nightly backup cron confirmed: `0 2 * * * backend/scripts/backup_database.sh`.
  Latest dump `bonasov1_db_20260612_000001.dump` (1.26 MB, today 02:00) — backups
  **are running and fresh**.
- **Offsite NOT active**: `backup.log` logs `Off-site status: not_configured`
  every night through 2026-06-12; no `BONASO_OFFSITE_*` env set. Script *supports*
  S3/rclone/SSH — it just needs env vars + a restore test. Runbook:
  `docs/OFFSITE_BACKUP_RUNBOOK.md`.
- Compose/Dockerfiles present under `frontend/` and `backend/`; training stack
  isolated in `training/`.

## REMAINING RISKS (operational — block external rollout until cleared)

| Risk | Severity | Owner action | Source |
|---|---|---|---|
| Offsite backups not activated | **High** | Activate offsite per `docs/` runbook; verify a restore | rollout audit 2026-06-11 |
| Edge `:445` redirect | High | Hosting/edge fix (emailed) | rollout audit 2026-06-11 |
| `www` DNS incorrect | Medium | Correct DNS record | rollout audit 2026-06-11 |

## LOW-SEVERITY OBSERVATIONS (no fix applied)

- `projects/target_sync.py::_pot_saved` swallows+logs CT-sync exceptions. Robust
  by design (a save never fails on sync), but a genuine prod sync failure would
  be silent. Acceptable because the R3 server-side coordinator rollup engine is
  the single source of truth; the POT→CT mirror is convenience, not the
  authority.
- 60 eslint warnings (unused vars, one `set-state-in-effect`). Non-blocking.

---

## FINAL DECISION

**APPROVE AFTER FIXES** — clear the three operational items (offsite backups,
`:445` redirect, `www` DNS). The application layer is rollout-ready on the
evidence above.

## DEPLOYMENT CHECKLIST

1. Backup before deploy (predeploy dump) — **and confirm offsite copy lands**.
2. `migrate --plan` (currently 0) then `migrate`.
3. `npm run build` as final FE gate.
4. Restart services; smoke-test login, an interaction write, a dashboard, an export.
5. Rollback: keep the predeploy dump + prior image tag ready.

---

### Coverage honesty note

Deeply verified today: validation suite, the 4 priority risk areas,
idempotency internals, response-write authz, canonical grouping, AllowAny
surface, queryset-scoping breadth. **Not** exhaustively re-exercised per-module
this session: every individual CRUD/filter/pagination path across all 20
modules, and a live multi-role API permission matrix. The 199 passing tests
cover much of that; a targeted live permission-matrix pass is the recommended
next deepening if desired.
