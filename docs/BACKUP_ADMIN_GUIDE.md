# SESIGO / BONASO — Backup Admin Guide

Audience: system administrators. Covers the on-demand backup tools on the
**System Status** page (Settings area) and how to store and restore them.

## What backups exist
- **Automatic nightly DB backup** — host cron `02:00`, PostgreSQL custom-format
  dump, verified with `pg_restore`, plus a media/uploads archive. 30-day retention.
- **On-demand backup** — admins can generate/download from the **Backups** card.
- **Encrypted off-site backup** — admins can generate an AES-256 encrypted package
  (DB dump + media) for storage on an external drive.

All actions are recorded in the audit log (who, when, IP, size, outcome).

## How to generate & download a backup
1. Go to **System Status** (admin only).
2. In the **Backups** card:
   - **Generate backup now** — runs a fresh verified backup.
   - **Download latest backup** — downloads the latest verified dump (unencrypted).

## How to create an encrypted off-site backup (recommended for external drives)
1. In the **Backups** card, click **Encrypted off-site backup**.
2. Re-enter **your account password** (confirms it's really you).
3. Set an **encryption password** (≥ 12 chars). **This is never stored — if you
   lose it the file cannot be recovered.** Keep it in a password manager.
4. Click **Generate & download encrypted backup**. You'll receive a
   `sesigo_backup_<timestamp>.tar.gz.enc` file.

### Where to store it
On an **encrypted external drive** kept in a secure location, separate from the
server. Do **not** email it or store it in shared/cloud folders unencrypted.

### How often
At minimum **weekly** (the Backups card shows a reminder when a download is due:
🟢 < 7 days, 🟠 7–13 days, 🔴 14+ days). Also before any risky change or upgrade.

### How to decrypt and restore
Needs `openssl` and `tar`:
```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in sesigo_backup_<timestamp>.tar.gz.enc -out backup.tar.gz -pass pass:'YOUR_PASSWORD'
tar -xzf backup.tar.gz
```
This yields the `bonasov1_db_*.dump` (and media archive if included). Restore the
database following `docs/SESIGO_DISASTER_RECOVERY_RUNBOOK.md` (supervised
restore: validate-on-web, apply-on-CLI). The included `RESTORE_README.txt` repeats
these steps.

## Off-site replication (automatic)
The Backups card shows **Off-site replication: 🟢 Configured / 🔴 Not configured**.
When 🔴, automatic off-site copies are not running. To activate, set one of the
following in `backend/.env`, then run `bash scripts/backup_database.sh`:
- `BONASO_OFFSITE_S3_URI` (+ `BONASO_OFFSITE_S3_ENDPOINT` for Backblaze B2 / S3-compatible)
- `BONASO_OFFSITE_RCLONE_REMOTE`
- `BONASO_OFFSITE_SSH_DEST`
Confirm `offsite_status` in `backups/database/latest.json` becomes `s3_ok` /
`rclone_ok` / `scp_ok`. See `docs/OFFSITE_BACKUP_RUNBOOK.md`.

## Security notes
- All backup endpoints are admin-only and enforced on the backend.
- The encrypted-download endpoint requires account-password re-confirmation and is
  rate-limited. The encryption password is passed to `openssl` via the environment
  (never argv) and is never stored or logged.
- Temporary plaintext/encrypted files are deleted after the download completes.
