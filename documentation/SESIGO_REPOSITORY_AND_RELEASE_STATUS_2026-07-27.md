# SESIGO Repository & Release Status — 2026-07-27 (WS5)

## Deployment facts (verified)
| Item | Value |
|---|---|
| Production backend image | `frontend-backend:latest` = `8d800aca` (built from commit `21fcddc0`) |
| Production frontend image | `frontend-frontend:latest` = `f5f25e49` |
| Deployed source commit | `21fcddc0` (confidentiality-gate work) on `feature/management-intelligence-echarts-2026-07` |
| Applied DB migrations | **126 applied, 0 pending** on the live database |
| Static assets | WhiteNoise `CompressedManifestStaticFilesStorage` (content-hashed) |
| Environment | `backend/.env` — `BONASO_ENVIRONMENT=LIVE`, loopback PostgreSQL 18 (secrets not reproduced) |
| Rollback point | `frontend-backend:rollback_confgate_20260724` (`b1f1072f`) / `frontend-frontend:rollback_confgate_20260724` (`b681d222`) |
| This work | branch `feature/ops-readiness-2026-07` (off `21fcddc0`); **not yet deployed** |

Pending migration introduced by this work: `support/0001_initial` (additive; new
tables only — no change to existing tables). It applies on the next gated rebuild.

## Working-tree classification
| Item | Classification | Action taken / recommended |
|---|---|---|
| Repo-root `backups/` (19 real-data JSON dumps + `manual-patches/`) | **Ignore** (real programme data) | `.gitignore` now covers `/backups/` (done). **Archive off-repo** for retention. |
| `audit_2026-06-22/`, root `*.jsonl`, `*.csv` (Q4 audit artefacts) | **Archive outside repo** | Already gitignored (`/audit_[0-9]*/`, `*.jsonl`, `*.csv`). Move to off-repo archive. |
| `backend/db.sqlite3` | **Ignore** | Already ignored; dev artefact, not used in prod (Postgres). |
| `documentation/edge/*` (staged nginx) | **Commit** | Committed (WS3). |
| `documentation/SESIGO_PRE_AUDIT_READINESS_2026-07-14.md` | **Commit** | Committed (WS5). |
| `documentation/*` new guides/runbooks | **Commit** | Committed (WS6). |
| `backend/support/*`, WS2 command, health endpoint | **Commit** | Committed (WS1/WS2/WS3). |
| `frontend/lib/api/services/projects.ts.bak_*` | **Review before deciding** | A `.bak_*` file is gitignored; leave as-is or delete after confirming it's a stale backup. |
| `.next/` at repo root, `training/state/` | **Ignore** | Already ignored (build/runtime state). |

After this workstream the tracked working tree is clean; no real programme data is
stage-able (root `backups/` and dated audit dirs are now ignored).

## Branches
- `feature/management-intelligence-echarts-2026-07` — carries the deployed commit
  `21fcddc0` plus unshipped "management intelligence" echarts work.
- `feature/ops-readiness-2026-07` — **this** engagement (WS1–WS6), branched from
  the deployed commit. Reviewable in isolation; merge/deploy is gated.
