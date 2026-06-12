# Rollout Blockers — Remediation Status (verified 2026-06-12)

Consolidated verification of the five Production Readiness Audit blockers. Each
priority's detailed report lives alongside this file; this document records the
**current implemented + deployed state** and the evidence gathered on 2026-06-12.

Branch: `rollout-blockers-remediation-2026-06-05` (HEAD `3b0e0495`).
Remediation code landed in commit `fc1fb6a4` and is **running live** in
`frontend-backend-1` (verified by grepping the container's running source).

| # | Blocker | Code | Deployed live | Tests | Status |
|---|---------|------|---------------|-------|--------|
| 1 | Indicator canonicalization | ✅ | ✅ (16 deprecated/linked) | 4/4 pass | **Resolved** |
| 2 | Login rate limiting | ✅ | ✅ | 3/3 pass | **Resolved** |
| 3 | Off-site backups | ✅ (capability) | ⚠️ target not activated | scripts syntax-OK | **Resolved w/ condition** |
| 4 | Offline idempotency | ✅ | ✅ | 5/5 pass | **Resolved** |
| 5 | Response write security | ✅ | ✅ | 3/3 pass | **Resolved** |

Total automated tests run for this remediation: **15 pass, 0 fail**.

---

## P1 — Indicator Canonicalization  ✅ Resolved (applied live)

**Design.** No aggregates are moved or deleted. `Indicator.canonical_indicator`
(FK, `SET_NULL`) + `is_deprecated` mark a row as a duplicate; analytics groups by
the canonical id via `indicators.canonical.canonical_id_map()`.

- Model/migration: `indicators/models.py`, `indicators/migrations/0007_indicator_deduplication.py`.
- Clustering + canonical selection (prefers non-`AUTO_*` code, then most data):
  `indicators/canonical.py`.
- Apply path: `python manage.py canonicalize_indicators` (dry-run → `--apply`).
- Analytics consumers using canonical rollup: `analysis/views.py`
  (`_canonical_indicator_resolver`, AN-1 stranded-data pull),
  `analysis/services/coordinator_rollups.py`, `aggregates/views.py`,
  `aggregates/reporting_workbook.py`.

**Evidence (live DB, 2026-06-12):** 276 indicators, **16 deprecated with
`canonical_indicator` set** (e.g. `AUTO_NUMBER_OF_PEOPLE_WHO_REPEATED_COLL` 356 →
449 and `SC_NUMBER_OF_PEOPLE_WHO_REPORTED_COLLECTING_CONDOM` 480 → 449, the exact
split called out in the audit). Tests in `analysis/tests_canonicalization.py`
prove the command is idempotent and that bulk trends fold duplicate data into the
canonical id. Detail: `INDICATOR_CANONICALIZATION_REPORT.md`.

## P2 — Login Rate Limiting  ✅ Resolved (live)

DRF `ScopedRateThrottle`, scopes wired onto the real auth views:
- `login` 10/min/IP — `CookieTokenObtainPairView` (`users/views.py:78`)
- `token_refresh` 30/min/IP — `CookieTokenRefreshView` (`users/views.py:106`)
- `password_reset` 5/hour — `users/views.py:194`

Rates env-overridable (`THROTTLE_LOGIN` etc.). Throttle state lives in a
**shared filesystem cache** so all gunicorn workers share one counter;
`NUM_PROXIES=1` makes throttling key off the real client IP behind nginx.

**Evidence:** `users/tests_throttle.py` — repeated failed logins eventually
return **429**, a successful login within the limit is unaffected, and buckets
are per-client-IP. 3/3 pass. Detail: `LOGIN_SECURITY_REPORT.md`.

## P3 — Off-site Backups  ⚠️ Resolved with condition (TARGET NOT ACTIVATED)

Capability is fully built and nightly local backups are healthy; the only
outstanding item is **operational activation of an off-site destination**, which
needs a provider choice + credentials.

- `scripts/backup_database.sh` — `pg_dump` custom format, checksum + JSON
  manifest, 30-day retention, failure alerting (`BONASO_ALERT_WEBHOOK` /
  `BONASO_ALERT_COMMAND`), and off-site push to **S3 / Backblaze (S3) / rclone /
  scp**, selected by env var. Writes `offsite_status` into the manifest.
- `scripts/restore_database.sh` — guarded restore from a dump.
- `scripts/restore_verify.sh` — restores the newest dump into a **throwaway** DB
  and row-count-checks it; safe to cron monthly.
- Runbook: `OFFSITE_BACKUP_RUNBOOK.md`.

**Evidence:** nightly cron `0 2 * * *` is running; `latest.json` (2026-06-12)
shows `verify_status: pg_restore_list_ok`, sha256 present — **but
`offsite_status: "not_configured"`**. No `BONASO_OFFSITE_*` env var is set, so
backups are **local-only on the VPS**. Loss of the VPS = loss of backups.

> **Condition to clear:** set one of `BONASO_OFFSITE_S3_URI` /
> `BONASO_OFFSITE_RCLONE_REMOTE` / `BONASO_OFFSITE_SSH_DEST` (+ credentials),
> re-run the nightly backup, and confirm `offsite_status` flips to `*_ok`.

## P4 — Offline Idempotency  ✅ Resolved (live)

`idempotency` app: `IdempotencyKey` model with a unique `(user, key)` constraint
(atomic claim across workers) + request-body hash. `IdempotentMutationMixin`
claims the key before the write, replays the stored response on retry, rejects a
key reused with a **different** payload (422), and never persists a poisoned claim
on failure (so genuine errors can be retried).

Applied to all four offline-replayed write surfaces:
`RespondentViewSet`, `InteractionViewSet`, `ResponseViewSet`
(`respondents/views.py`) and `AggregateViewSet` (`aggregates/views.py`).
Frontend stamps `X-Idempotency-Key` on queueable mutations
(`frontend/lib/api/client.ts:584`), closing the loop end-to-end. The offline
sync writes go through these same viewsets (the bootstrap endpoint is read-only).

**Evidence:** `idempotency/tests.py` — replayed POST creates a **single** record,
keys are per-user, a different payload on the same key is rejected, and a failed
write leaves no key behind. 5/5 pass. Detail: `OFFLINE_IDEMPOTENCY_REPORT.md`.

## P5 — Response Write Security  ✅ Resolved (live)

`ResponseViewSet.perform_create()` (`respondents/views.py:297`) now enforces that
a non-admin may only attach a response to an interaction belonging to one of
their own organizations — mirroring `InteractionViewSet`. Closes the cross-org
write / IDOR gap (SEC-2).

**Evidence:** `respondents/tests.py::ResponseWriteSecurityTests` — an officer
**cannot** create a response for a foreign-org interaction (403), can for their
own org, and an admin can for any. 3/3 pass. Detail: `RESPONSE_SECURITY_REPORT.md`.

---

## Deployment / rollback

All five fixes are already deployed live (migrations applied:
`idempotency.0001`, `indicators.0007`, `users.0004`). No further migration is
required to clear P1/P2/P4/P5. The one remaining action is **P3 off-site
activation**, which is config-only (env var + credentials), not a code deploy.

- **Code backup risk:** the branch is local-only — `git push` to back it up.
- **Rollback:** revert commit `fc1fb6a4` and redeploy; the canonical links are
  additive (deprecated rows + FKs) and reverting analytics simply stops rolling
  duplicates up — no historical aggregate is lost.

## ROLLOUT STATUS:  READY WITH CONDITIONS

Application-level blockers (P1, P2, P4, P5) are **fully resolved, deployed, and
test-backed**. The sole condition is **P3: activate an off-site backup target**
(provider + credentials) so backups survive VPS loss. Until then the system is
production-ready *operationally at risk of total data loss on host failure*.
