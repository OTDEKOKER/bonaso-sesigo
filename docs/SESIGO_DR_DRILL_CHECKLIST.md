# Sesigo — Production Recovery Drill Checklist (OPERATOR)

**Purpose:** the step-by-step procedure to *execute and record* the disaster-recovery drill that closes blocker **R2**. Companion to [`SESIGO_DISASTER_RECOVERY_RUNBOOK.md`](./SESIGO_DISASTER_RECOVERY_RUNBOOK.md). This checklist is **prepared, not simulated** — fill in the real values when you run it. Nothing here fabricates results.

> All steps run on the production host as the BONASO admin. Scripts live in `BONASOV1/backend/scripts/`.

**Drill metadata (fill in at execution)**
- Date/time started (UTC): `__________`
- Operator: `__________`
- Backup file under test: `bonasov1_db_______________.dump`
- Off-site target configured: ☐ S3 ☐ rclone ☐ SSH — remote: `__________`

---

## A. Backup verification
| # | Step | Command | Pass? | Notes / value |
|---|------|---------|:---:|---|
| A1 | A fresh backup exists & is recent | `cat backend/backups/database/latest.json` | ☐ | age = `__` h |
| A2 | Off-site replication confirmed | `grep offsite_status backend/backups/database/latest.json` | ☐ | status = `______` (expect `*_ok`) |
| A3 | Checksum present in manifest | inspect manifest `*.json` `sha256` field | ☐ | |
| A4 | Healthcheck passes (offsite required) | `BONASO_REQUIRE_OFFSITE=1 ./scripts/backup_healthcheck.sh` | ☐ | exit `__` (expect 0) |

## B. Restore verification (non-destructive, scratch DB)
| # | Step | Command | Pass? | Notes |
|---|------|---------|:---:|---|
| B1 | Restore newest dump into a throwaway DB + sanity checks | `./scripts/restore_database.sh --verify` | ☐ | exit `__` (expect 0) |
| B2 | Row-count sanity (aggregates/respondents/projects/users non-zero & plausible) | review B1 output | ☐ | |
| B3 | Scratch DB dropped automatically | confirm in B1 output | ☐ | |

## C. Full recovery rehearsal (explicit target DB — NOT production)
> Use a *separate* recovery database/host so production is never touched.
| # | Step | Command | Pass? | Notes |
|---|------|---------|:---:|---|
| C1 | Provision recovery DB (matching PG major version) | (provisioning) | ☐ | host = `______` |
| C2 | Restore into explicit target | `./scripts/restore_database.sh --target-url "postgres://USER:PASS@HOST:5432/bonasov1_recovery" --file backend/backups/database/<DUMP>` | ☐ | exit `__` |
| C3 | Migrations consistent | point app env at recovery DB → `python manage.py migrate --check` | ☐ | "No planned migrations" |
| C4 | App boots & login works against recovery DB | start service, log in as admin | ☐ | |
| C5 | Spot-check a known recent approved aggregate is present | query/UI | ☐ | id = `______` |

## D. Rollback verification (deploy-rollback path, independent of DB restore)
| # | Step | Command | Pass? | Notes |
|---|------|---------|:---:|---|
| D1 | A rollback point exists for the current release | list `~/rollback_*` (see deploy notes) | ☐ | tag = `______` |
| D2 | Rollback procedure documented & runnable | dry-run the documented rollback to the prior release on a staging/replica | ☐ | |
| D3 | Post-rollback healthcheck | `./scripts/backup_healthcheck.sh` + app smoke test | ☐ | |

## E. Recovery timing (RTO/RPO evidence)
| Metric | Target | Measured | Pass? |
|---|---|---|:---:|
| Restore-verify duration (B1) | informational | `__` min | ☐ |
| Full recovery rehearsal (C1→C4) | RTO ≤ 2 h | `__` min | ☐ |
| Backup age at drill (RPO proxy) | ≤ 24 h | `__` h | ☐ |

## F. Success criteria (all must pass to close R2)
- ☐ A2 off-site confirmed (`*_ok`) **and** A4 healthcheck exit 0.
- ☐ B1 restore-verify exit 0 with plausible row counts.
- ☐ C3 `migrate --check` clean **and** C4 login works on the recovered DB.
- ☐ D2 rollback path validated on a non-prod target.
- ☐ E full-recovery time within RTO.

## G. Record & sign-off
- Outcome: ☐ PASS ☐ FAIL (attach logs from B1/C2)
- Append a row to the drill log in `SESIGO_DISASTER_RECOVERY_RUNBOOK.md` §8.
- Operator signature: `__________`  Date: `__________`

> **R2 closes only when section F is fully ticked from a real run and the runbook §8 drill log has a passing row.** Until then, DR remains "tooling + runbook complete; drill pending."
