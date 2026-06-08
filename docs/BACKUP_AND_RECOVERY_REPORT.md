# BACKUP AND RECOVERY REPORT (P3 / audit INF-1 / C1)

## Problem
Nightly backups ran but were **local-only** on the same host as the database;
host loss = loss of app + DB + backups. No restore script, no monitoring.

## Fix

### 1. Off-site replication (`backend/scripts/backup_database.sh`)
The script already had rclone + SSH hooks; this remediation adds:
- **Native S3** branch via the `aws` CLI — covers AWS S3 **and** Backblaze B2 /
  any S3-compatible provider (`BONASO_OFFSITE_S3_ENDPOINT`).
- `rclone` remote (S3, B2, GDrive, …) and `scp`/SSH targets retained.
- The chosen `offsite_status` is written into the manifest + `latest.json`.

Configure exactly one (env, e.g. in `backend/.env`):
| Target | Variable | Example |
|---|---|---|
| S3 / B2 (aws cli) | `BONASO_OFFSITE_S3_URI` | `s3://bonaso-backups/db` |
| S3-compatible endpoint | `BONASO_OFFSITE_S3_ENDPOINT` | `https://s3.us-west-002.backblazeb2.com` |
| rclone remote | `BONASO_OFFSITE_RCLONE_REMOTE` | `b2:bonaso-backups/db` |
| SSH/scp | `BONASO_OFFSITE_SSH_DEST` | `backup@host:/srv/bonaso` |

If a target is configured but the push fails → script **exits non-zero and
alerts**. If none is configured → loud WARNING (gap stays visible).

### 2. Restore + verification (`backend/scripts/restore_database.sh`, new)
- `--verify` — restores the newest dump into a **throwaway scratch database**,
  runs sanity checks (≥20 public tables, indicator row count), then drops it.
  **Never touches production.** Verifies the sha256 against the manifest first.
- `--target-url URL` — restores into an explicit target (DR / recovery host);
  refuses to run without an explicit target so prod cannot be silently clobbered.
- `--file PATH`, `--no-checksum` options.

**Proven end-to-end on the live server:**
```
Checksum verified against manifest: 254f6faf...c32eec619b
Creating scratch verification database: bonaso_restore_verify_20260605143803
Sanity: public tables=63, indicators_indicator rows=277
Restore verification PASSED.
```
(backup → checksum → restore → sanity → drop). Scratch DB confirmed dropped.

### 3. Monitoring / alerting
- `backup_database.sh` and `restore_database.sh` now call an `alert()` hook on
  failure: `BONASO_ALERT_WEBHOOK` (Slack/Teams/generic JSON POST) or
  `BONASO_ALERT_COMMAND`.
- New `backend/scripts/backup_healthcheck.sh` — alerts + exits non-zero when:
  the latest backup is missing / older than `BONASO_BACKUP_MAX_AGE_HOURS` (26h),
  the dump is missing/empty, or (when `BONASO_REQUIRE_OFFSITE=1`) off-site
  replication is not confirmed. Reads `offsite_status` from `latest.json`.

## Suggested cron (in addition to the existing 02:00 backup)
```
0 3 * * *  /bin/bash /home/bonasoadmin/BONASOV1/backend/scripts/backup_healthcheck.sh >> reports/backup_health.log 2>&1
30 3 * * 0 /bin/bash /home/bonasoadmin/BONASOV1/backend/scripts/restore_database.sh --verify >> reports/restore_verify.log 2>&1
```

## Risk
Before: **High** (single point of failure; backups die with the host; restores
never tested).
After: **Resolved in code** — off-site replication, tested restore path, and
failure alerting are implemented. **Action required at deploy:** set one
`BONASO_OFFSITE_*` target + `BONASO_ALERT_WEBHOOK` and add the two cron lines.
Until an off-site target is configured the nightly run keeps warning, by design.
