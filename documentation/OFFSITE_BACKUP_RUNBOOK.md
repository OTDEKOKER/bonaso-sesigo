# Off-site Backup Runbook

The nightly DB backup (`backend/scripts/backup_database.sh`, cron `0 2 * * *`) already
produces verified, checksummed custom-format dumps in `backend/backups/database/` and
**already implements off-site replication** for S3, rclone, and SSH. It is currently
**LOCAL-ONLY** because no off-site target env var is set (`offsite_status: not_configured`
in `latest.json`). Activating off-site = install one tool + set one env var in
`backend/.env` + run one test. Pick ONE option below.

> Risk while not configured: if this host's disk is lost, **every backup is lost with it.**

---

## Option A — S3 / Backblaze B2 (recommended: cheapest, most durable)

```bash
# 1. Install the AWS CLI
sudo apt-get update && sudo apt-get install -y awscli   # or: pipx install awscli

# 2. Provide credentials (use a key scoped to write-only on this one bucket)
aws configure        # enter Access Key, Secret, region; or write ~/.aws/credentials

# 3. Set the target in backend/.env  (B2/non-AWS also need the endpoint line)
echo 'BONASO_OFFSITE_S3_URI=s3://YOUR-BUCKET/bonaso-db' >> backend/.env
# Backblaze B2 / MinIO / Wasabi only:
# echo 'BONASO_OFFSITE_S3_ENDPOINT=https://s3.us-west-002.backblazeb2.com' >> backend/.env
```

## Option B — rclone remote (widest provider support: Drive, OneDrive, etc.)

```bash
sudo apt-get install -y rclone        # or: curl https://rclone.org/install.sh | sudo bash
rclone config                         # create a remote, e.g. named "offsite"
echo 'BONASO_OFFSITE_RCLONE_REMOTE=offsite:bonaso-backups/db' >> backend/.env
```

## Option C — Another server over SSH/scp

```bash
# Key-based, non-interactive (BatchMode) auth must already work:
ssh-keygen -t ed25519 -f ~/.ssh/backup_key        # if you don't have a key
ssh-copy-id -i ~/.ssh/backup_key.pub backup@OTHER-HOST
# (point the script's user at this key via ~/.ssh/config Host entry if needed)
echo 'BONASO_OFFSITE_SSH_DEST=backup@OTHER-HOST:/srv/bonaso-backups' >> backend/.env
```

---

## Optional — failure alerting (so a broken backup pages you)

```bash
# Slack/Teams/generic incoming webhook:
echo 'BONASO_ALERT_WEBHOOK=https://hooks.slack.com/services/XXX' >> backend/.env
```

## Verify activation (run after setting any option)

```bash
cd /home/bonasoadmin/BONASOV1/backend
bash scripts/backup_database.sh                       # run a manual backup now
grep offsite_status backups/database/latest.json      # expect: s3_ok / rclone_ok / scp_ok
tail -5 backups/database/backup.log                   # no "LOCAL-ONLY" warning
```

A configured-but-failing push makes the script **exit non-zero and alert** — so once
wired, a silent off-site failure cannot happen unnoticed.

## Restore test (do this at least once, and quarterly)

```bash
# List contents without restoring (integrity check the cron already does nightly):
pg_restore --list backups/database/latest.dump >/dev/null && echo "dump readable"

# Full restore drill into a throwaway DB:
createdb bonasov1_restore_test
pg_restore --no-owner --no-acl -d bonasov1_restore_test backups/database/bonasov1_db_YYYYMMDD_HHMMSS.dump
# spot-check row counts, then:
dropdb bonasov1_restore_test
```

## Media

Uploaded media (`backend/media/`, ~2 MB) is NOT in the DB dump. If/when it grows,
add it to the same off-site target, e.g. for S3:
`aws s3 sync backend/media s3://YOUR-BUCKET/bonaso-media`.
