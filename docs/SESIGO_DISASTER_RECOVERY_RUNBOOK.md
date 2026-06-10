# Sesigo Data Portal — Disaster Recovery Runbook (SOP)

**Owner:** BONASO platform admin · **Last updated:** 2026-06-10 · **Closes rollout blocker R2 / finding C1.**

This is the operational procedure for protecting and recovering the Sesigo
production database. The tooling already exists (`backend/scripts/`); this runbook
is the *procedure* for enabling off-site replication, proving backups restore
(the drill), and recovering from catastrophic host loss.

> ⚠️ **Operator actions.** Steps marked **[OPERATOR]** run against production /
> real credentials and must be executed by the BONASO admin on the prod host.
> They are not run from any agent/CI context.

---

## 1. Objectives

| Metric | Target | Basis |
|---|---|---|
| **RPO** (max data loss) | ≤ 24 h (→ near-zero once off-site is hourly-capable) | nightly `pg_dump` + off-site copy |
| **RTO** (max time to restore) | ≤ 2 h to a freshly provisioned host | measured during the drill (§6) — record actual |
| **Backup integrity** | 100 % — every backup sha256-verified against its manifest | `backup_database.sh` + `restore_*` checksum |

---

## 2. Architecture

- **`scripts/backup_database.sh`** — `pg_dump` (custom format) + JSON manifest + `sha256`; prunes older than `BONASO_BACKUP_RETENTION_DAYS` (default 30); pushes off-site; updates `backups/database/latest.json`. Alerts via `BONASO_ALERT_WEBHOOK` or `BONASO_ALERT_COMMAND` on failure.
- **`scripts/restore_verify.sh`** — loads the newest dump into a **throwaway** scratch DB, runs row-count sanity checks, drops it. Safe on the live host (never touches prod).
- **`scripts/restore_database.sh`** — `--verify` (scratch drill) **or** `--target-url …` (explicit recovery DB; refuses to run without an explicit target so it can never clobber prod).
- **`scripts/backup_healthcheck.sh`** — fails if `latest.json` is missing/stale (`> BONASO_BACKUP_MAX_AGE_HOURS`, default 26 h) or, when `BONASO_REQUIRE_OFFSITE=1`, if off-site replication is not confirmed.

Backups live in `BONASO_BACKUP_DIR` (default `backend/backups/database`).

---

## 3. Enable off-site replication **[OPERATOR]**

Pick **one** target and set it in the prod environment (`backend/.env` or the
service env). The backup script auto-detects whichever is set:

| Provider | Env var | Example | Needs |
|---|---|---|---|
| S3 / S3-compatible | `BONASO_OFFSITE_S3_URI` (+ `BONASO_OFFSITE_S3_ENDPOINT` for non-AWS) | `s3://bonaso-backups/db` | `aws` CLI |
| rclone remote | `BONASO_OFFSITE_RCLONE_REMOTE` | `b2:bonaso-backups/db` | `rclone` |
| SSH/SCP host | `BONASO_OFFSITE_SSH_DEST` | `backup@host:/srv/bonaso` | `scp` + key |

Then **require** off-site so the healthcheck alerts if it ever stops:

```bash
# backend/.env  (example: Backblaze B2 via rclone)
BONASO_OFFSITE_RCLONE_REMOTE=b2:bonaso-backups/db
BONASO_REQUIRE_OFFSITE=1
BONASO_ALERT_WEBHOOK=https://hooks.slack.com/services/XXX/YYY/ZZZ
```

Verify the remote is reachable before relying on it:

```bash
rclone lsd b2:bonaso-backups          # or: aws s3 ls s3://bonaso-backups/db/
```

---

## 4. Schedule the jobs **[OPERATOR]**

```cron
# Nightly backup + off-site at 02:00 UTC
0 2 * * *  /bin/bash /home/bonasoadmin/BONASOV1/backend/scripts/backup_database.sh \
  >> /home/bonasoadmin/BONASOV1/backend/backups/database/backup.log 2>&1

# Backup healthcheck at 06:00 UTC (alerts if stale or off-site unconfirmed)
0 6 * * *  /bin/bash /home/bonasoadmin/BONASOV1/backend/scripts/backup_healthcheck.sh \
  >> /home/bonasoadmin/BONASOV1/backend/backups/database/healthcheck.log 2>&1

# Monthly restore-verify drill at 03:00 UTC on the 1st
0 3 1 * *  /bin/bash /home/bonasoadmin/BONASOV1/backend/scripts/restore_verify.sh \
  >> /home/bonasoadmin/BONASOV1/backend/backups/database/restore_verify.log 2>&1
```

---

## 5. Routine monitoring

- Backup health is asserted daily by `backup_healthcheck.sh` (cron, §4). A failed run alerts via the configured webhook/command.
- After enabling off-site, confirm `backups/database/latest.json` shows `"offsite_status": "rclone_ok"` (or `s3_ok` / `scp_ok`):

```bash
grep offsite_status /home/bonasoadmin/BONASOV1/backend/backups/database/latest.json
```

---

## 6. Restore-verify drill (prove backups restore) **[OPERATOR]**

Run on demand (or rely on the monthly cron). Safe — uses a scratch DB only:

```bash
cd /home/bonasoadmin/BONASOV1/backend
./scripts/restore_verify.sh
# or, equivalently, with checksum + sanity checks:
./scripts/restore_database.sh --verify
```

**Expected:** the script restores the newest dump into a throwaway DB, prints
table/row-count sanity checks, drops the scratch DB, and exits `0`. Any non-zero
exit = the backup is NOT trustworthy → investigate immediately.

Record the result in the drill log (§8).

---

## 7. Catastrophic recovery (host loss) **[OPERATOR]**

1. **Provision** a new host with PostgreSQL (matching major version) + the repo.
2. **Retrieve** the latest off-site dump + manifest:
   ```bash
   rclone copy b2:bonaso-backups/db ./recovered --include "bonasov1_db_*"
   # or: aws s3 cp --recursive s3://bonaso-backups/db ./recovered
   ```
3. **Create** the recovery database and restore into it explicitly (never `--verify` here):
   ```bash
   ./scripts/restore_database.sh \
     --target-url "postgres://USER:PASS@NEWHOST:5432/bonasov1" \
     --file ./recovered/bonasov1_db_<TIMESTAMP>.dump
   ```
   The script refuses to run without an explicit `--target-url`, and sha256-verifies the dump against its manifest before loading.
4. **Point the app** at the recovered DB (`DATABASE_URL` in env), run `python manage.py migrate --check` (should report no pending migrations), then start the service.
5. **Re-enable** backups (§3–4) on the new host.
6. **Validate** (§7a) before announcing recovery.

### 7a. Recovery validation checklist
- [ ] `migrate --check` reports no pending migrations.
- [ ] Login works; an admin can load the dashboard.
- [ ] Spot-check row counts vs. the manifest (`aggregates`, `respondents`, `projects`, `users`).
- [ ] A known recent aggregate is present and `approved`.
- [ ] Nightly backup + healthcheck cron re-installed and a fresh `latest.json` written.
- [ ] Off-site replication confirmed (`offsite_status: *_ok`).

---

## 8. Drill log (append each drill — this is the evidence that closes R2)

| Date (UTC) | Type | Backup tested | Result | RTO observed | Operator | Notes |
|---|---|---|---|---|---|---|
| _2026-06-__ | restore-verify | `bonasov1_db_____.dump` | ☐ pass / ☐ fail | __ min | | first documented drill |

> **R2 is only fully closed once:** (a) off-site is enabled with `BONASO_REQUIRE_OFFSITE=1` and `latest.json` shows `*_ok`, **and** (b) at least one row of this drill log is filled with a passing restore-verify.
