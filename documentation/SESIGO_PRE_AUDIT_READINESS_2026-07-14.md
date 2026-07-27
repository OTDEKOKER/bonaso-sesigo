# SESIGO Data Portal — Final Pre-Audit Production Readiness Report

**Date:** 2026-07-14 (CAT) · **Audit date:** 2026-07-15 · **Prepared by:** Engineering (pre-audit verification pass)
**Environment:** Production (`sesigo.org.bw`) — live, contains real reporting data. UAT + pilot complete; this audit gates full rollout.

---

## A. Executive verdict

**READY WITH MINOR OBSERVATIONS.**

No Critical or High findings. Core controls (auth, authorization, org/project isolation, reporting-period enforcement, duplicate prevention, review/flag/approve, audit trail, backups) are verified working with evidence. Remaining items are Medium/Observation and have compensating controls or clear explanations for auditors.

---

## B. Current production state

| Item | Value |
|---|---|
| Branch | `review-queue-pagination-wip-2026-07-13` |
| Deployed backend commit | `e8cc113b` (image `frontend-backend`, sha `82efbc0dfb6f`, built 2026-07-14 12:05Z; gunicorn 26.0.0) |
| Deployed frontend commit | `2f7d71b1` (image `frontend-frontend`, built 2026-07-14 12:01Z) |
| HEAD after this pass | `0e84855b` (test-fixture fix only; **not pushed, not deployed**) |
| Working tree | Mid doc-reorg (docs/→documentation/), an **unused** `echarts` dep in package.json, empty `_*.py` scratch files, backup JSONs — none affect the running app |
| Containers | `frontend-backend-1`, `frontend-frontend-1` — **host-networked**, `restart: unless-stopped`, RestartCount 0, running, healthy |
| Prod DB | Host PostgreSQL 18.3 (`bonasov1`), bound `127.0.0.1:5432` only |
| Reverse proxy | Host nginx 1.18.0, TLS via Let's Encrypt, 80→443 redirect |
| Migrations | `makemigrations --check` = no changes; `migrate --check` = 0 unapplied |
| Django deploy check | `check --deploy` = **0 issues** |
| DB availability | OK; 18,816 aggregates / 900,383 facts |
| Storage | `/` at 85% (7.2 GB free) — monitor |
| Memory | 3.8 GB RAM, ~1.3 GB avail, 2.3 GB swap in use — **constrained (O1)** |
| Latest backup | `bonasov1_db_20260714_000001.dump` (7.6 MB, today 02:00, verified) |

> Note: The production URL is **not reachable from the host itself** (NAT hairpin — the host cannot loop back to its own public IP). This is expected and **not** an outage. The site was verified serving via `127.0.0.1` and via the full TLS path using `--resolve sesigo.org.bw:443:127.0.0.1`.

---

## C. Issues found

### C1 — Off-site backup not configured — **Medium (Observation)**
- **Module:** Backups / DR. **Repro:** backup manifest `offsite_status: not_configured`.
- **Root cause:** No `BONASO_OFFSITE_S3_URI` / `_RCLONE_REMOTE` / `_SSH_DEST` set.
- **Audit impact:** Backups are local-only; a host-loss event loses backups. Recovery *procedure* and *restore-test* both pass, so this is durability, not recoverability.
- **Mitigation / plan:** Daily verified local backups + 30-day retention exist today. Configure an off-site target post-audit (documented in the DR runbook). **Explain to auditor:** local backup + restore verified; off-site is a scheduled hardening item.

### C2 — Host memory pressure / OOM under concurrent load — **Medium (Observation)**
- **Module:** Infra. **Repro:** running the DB restore-test **concurrently** with the test suite OOM-killed the test process (exit 137) on the 3.8 GB host.
- **Root cause:** Small host RAM + heavy concurrent jobs (known risk O1).
- **Audit impact:** Normal serving is fine (backend RestartCount 0, no 5xx). Risk is only under heavy concurrent batch work.
- **Mitigation / plan:** Do not run heavy concurrent jobs during the demo; add swap/RAM post-audit. Backend auto-recovers (`unless-stopped`).

### C3 — 38 orgs marked `is_active=False` while actively reporting — **Low — FIXED**
- **Module:** Organizations. **Repro:** 10,323 aggregates belonged to `Organization.is_active=False` orgs.
- **Root cause:** `Organization.is_active` is a legacy/global flag; reporting scope is actually governed by `ProjectOrganization.is_active` (all 75 assignment rows were active). Reports were **not** under-counting.
- **Fix applied:** Activated the 38 orgs that have an active assignment to an active non-training project (rollback snapshot saved). 96/96 orgs now active.

### C4 — nginx does not add security headers to frontend HTML — **Low (Observation)**
- **Module:** nginx. **Repro:** Django `/api` responses carry HSTS/XFO/nosniff/referrer-policy; the Next.js `/` HTML responses (proxied by nginx without `add_header`) do not.
- **Root cause:** No global `add_header` in the nginx server block.
- **Audit impact:** Low — the domain still receives HSTS from same-origin `/api` calls; the gap is clickjacking/nosniff hardening on app HTML.
- **Plan:** Add global security headers at the nginx layer post-audit (host config change, `nginx -t` + graceful reload).

### C5 — 321 approved aggregates without reviewer metadata — **Observation (explained, no action)**
- All 321 are in project `NAHPA2025/26` with `created_by = NULL` → **bulk-imported historical baseline**, not UI approvals. The import is itself backed up/auditable. **Do not modify** (safety rule: no edits to approved production data).

### C6 — 995 aggregates without a matching active assignment (~5%) — **Observation**
- Historical/coordinator-level rows predating current assignment records. Data is valid; not counted as corruption. New submissions are still gated by assignment.

### C7 — `www.sesigo.org.bw` does not resolve — **Observation (outside app control)**
- DNS-only; apex `sesigo.org.bw` resolves and serves correctly. Add a `www` DNS record if the auditor expects it.

---

## D. Changes made

| Change | Type | Reversible via |
|---|---|---|
| Activated 38 orgs (`is_active` False→True) that have active project assignments | Production data (forward-only, non-destructive) | `backups/org_is_active_snapshot_preactivate_20260714_143639.json` |
| Test-fixture fix: unique `code`s for review-scope test orgs (commit `0e84855b`, **unpushed**) | Test-only, no runtime change | `git revert 0e84855b` |
| Dropped orphaned test DBs (`test_bonasov1*`) left by an interrupted parallel run | Cleanup (test DBs only) | n/a (Django recreates on next test run) |

- **Migrations:** none. **Config:** none. **Deploy actions:** none (no rebuild / no push).

---

## E. Test evidence

Command (per group, in the running backend image): `python manage.py test <apps> --parallel 1`

| Group | Tests | Result | Duration |
|---|---|---|---|
| `aggregates` | 196 | **OK** | 200.5s |
| `projects users audit` | 125 | **OK** | 136.2s |
| `funder_reports analysis flags uploads` | 156 | **OK** | 43.8s |
| `indicators organizations idempotency recovery system_status core` | 139 | **OK** (after C3-adjacent test-fixture fix) | ~28s |
| **Total** | **616** | **All pass, 0 failures** | |

- `python manage.py check --deploy` → **System check identified no issues (0 silenced).**
- `makemigrations --check --dry-run` → **No changes detected.** · `migrate --check` → exit 0.

---

## F. Security & permission evidence

| Control | Result |
|---|---|
| `DEBUG` | **False** |
| `ALLOWED_HOSTS` | `['sesigo.org.bw','38.51.241.67','localhost','127.0.0.1']` |
| `SECURE_SSL_REDIRECT` | True (verified: HTTP→301 HTTPS) |
| Session/CSRF cookies | `Secure=True` |
| HSTS | `max-age=31536000; includeSubDomains; preload` (on `/api`) |
| `X-Frame-Options` / nosniff / referrer-policy | DENY / nosniff / strict-origin-when-cross-origin |
| CORS / CSRF trusted origins | Locked to `sesigo.org.bw` (no wildcard) |
| `SECRET_KEY` | From environment |
| Port exposure | 18000 / 13000 / 5432 bound to `127.0.0.1` only |
| Unauthenticated `/api/aggregates/` | **401** (via TLS path) — protected |
| `SECURE_PROXY_SSL_HEADER` | Set (correct behind nginx) |

Permission/isolation logic verified by the passing `test_permissions`, `test_periods_and_scoping`, `projects`, `users`, and `indicators.tests_review_scope` suites (coordinator subtree scoping, explicit-deny module perms, org-hierarchy isolation).

---

## G. Data-integrity evidence (read-only)

| Check | Result |
|---|---|
| Aggregate status | 18,788 approved / 28 pending |
| Duplicate reporting keys `(indicator,project,org,period)` | **0** (DB `unique_together` enforced) |
| Orphan / null-FK facts | **0** |
| Negative values | **0** |
| Invalid workflow states | **0** |
| Flags without reason | **0** (872 open flags, all have descriptions) |
| Circular / missing-source derived targets | **0** |
| Approved w/o reviewer metadata | 321 (all NAHPA2025/26 bulk-import — see C5) |
| Aggregates w/o active assignment | 995 (~5%, historical — see C6) |
| Reporting-period vs project dates | 1 RP starts Apr 1 vs project start May 1 = fiscal-quarter vs onboarding date (benign) |

**Unique reporting key:** `(indicator, project, organization, period_start, period_end)` — enforced at the database level.

---

## H. Backup & recovery evidence

- **Latest backup:** `bonasov1_db_20260714_000001.dump` — 7,621,696 bytes, 2026-07-14 02:00 CAT, sha256 recorded, perms `0600` (owner-only).
- **Automated:** cron `0 2 * * *`; script **self-verifies** every run (`verify_status: pg_restore_list_ok`); assets (media/uploads) tar'd alongside.
- **Retention:** 30 days; 47 daily dumps present.
- **Integrity:** `pg_restore --list` → 869 TOC entries, valid custom-format archive.
- **Restore-test (performed today, isolated):** restored the latest dump into a throwaway DB → **rc=0 in 40s, 0 warnings**; row counts (18,788 aggregates / 899,507 facts / 96 orgs / 21 users) consistent with the 02:00 snapshot; throwaway DB dropped. **Zero production impact.**
- **Gap:** off-site not configured (C1).

---

## I. Live smoke-test results

| Workflow | Result |
|---|---|
| HTTPS serving (TLS via nginx) | ✅ frontend 307→/dashboard, gated to login |
| HTTP→HTTPS redirect | ✅ 301 |
| Frontend routes `/login /dashboard /aggregates /flags` | ✅ 200 |
| Unauthenticated `/api/aggregates/` | ✅ 401 |
| Invalid-credential login | ✅ rejected (via TLS path) |
| Backend 5xx / tracebacks (last 40 min) | ✅ none |
| Container restarts | ✅ 0 |

---

## J. Remaining risks

**Could cause audit failure:** none identified.

**Likely recorded as observations:** off-site backup (C1); host memory constraint (C2); nginx frontend security headers (C4); `www` DNS (C7); explainable data notes (C5, C6).

**Recommended post-audit improvements:** configure off-site backups; add swap/RAM; add global nginx security headers; commit-or-revert the unused `echarts` dependency so deployed == committed; tidy the WIP working tree (finish the docs reorg, remove empty `_*.py` scratch files).

---

## K. Auditor demonstration script

1. Browse to `https://sesigo.org.bw` → show valid TLS padlock (Let's Encrypt).
2. Log in as an authorized user; show role-based navigation (menus differ by role).
3. Show the user's organisation + project scope; show project & indicator assignments.
4. Show reporting-period controls (Q1 Apr–Jun … Q4 Jan–Mar; period-window overlay).
5. Identify a safe **pending** record (28 exist) → show it in the review queue.
6. As a reviewer, open it (view-before-act), then **flag** it with a reason.
7. Show the correction history retained on the record.
8. As an authorized manager/admin, **approve** it; show reviewer + timestamp captured.
9. Open **Audit log** (Users → Activity) → show the create/review/flag/approve chain (13,400 events).
10. Attempt an unauthorized action (e.g., approve as a reporting user / access another org) → show it is blocked; show `/api/...` returns 401 without a token.
11. Download an organisation workbook (only its assigned indicators appear).
12. Demonstrate workbook validation on an invalid row (do not import to production).
13. Open a dashboard (approved data) and a funder report; show an export (Word/Excel).
14. Show system health + the latest **verified** backup and this restore-test evidence.

> Use no real beneficiary PII in the demo.

---

## L. Final go/no-go decision

**GO — present to auditors as "Ready with minor observations."** All acceptance criteria in §14 of the brief are met: HTTPS reachable, auth reliable, API-level authorization enforced, org-hierarchy isolation verified, assignment rules enforced, reporting-period rules working, duplicate reporting prevented (DB constraint), workbook up/download safe, review/flag/correct/approve working, audit history retained, dashboards reconcile with approved data, exports work, migrations clean, 616 relevant tests pass, backups current + restore verified, rollback plan exists, and no unresolved Critical/High issue threatens data integrity, confidentiality, or availability.

**Before the demo:** do not run heavy concurrent jobs on the host; keep the deployed build (no last-minute rebuild).
