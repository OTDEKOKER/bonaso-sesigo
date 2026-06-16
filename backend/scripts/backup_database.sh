#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BONASO_ENV_FILE:-$ROOT_DIR/.env}"
BACKUP_DIR="${BONASO_BACKUP_DIR:-$ROOT_DIR/backups/database}"
RETENTION_DAYS="${BONASO_BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/bonasov1_db_$TIMESTAMP.dump"
TEMP_BACKUP_FILE="$BACKUP_FILE.tmp.$$"
MANIFEST_FILE="$BACKUP_DIR/bonasov1_db_$TIMESTAMP.json"
LATEST_FILE="$BACKUP_DIR/latest.json"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

# Monitoring/alerting hook (audit C1). On any failure we notify via ONE of:
#   BONASO_ALERT_WEBHOOK  - POST {"text": "..."} (Slack/Teams/generic webhook)
#   BONASO_ALERT_COMMAND  - arbitrary command; the message is passed as $1
# If neither is set the alert is only written to the log (cron captures it).
alert() {
  local message="$1"
  log "ALERT: $message"
  if [ -n "${BONASO_ALERT_WEBHOOK:-}" ] && command -v curl >/dev/null 2>&1; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      --data "{\"text\": \"[BONASO backup] ${message}\"}" \
      "$BONASO_ALERT_WEBHOOK" >/dev/null 2>&1 || log "WARNING: alert webhook failed."
  fi
  if [ -n "${BONASO_ALERT_COMMAND:-}" ]; then
    # shellcheck disable=SC2086
    $BONASO_ALERT_COMMAND "[BONASO backup] ${message}" >/dev/null 2>&1 || log "WARNING: alert command failed."
  fi
}

fail() {
  log "ERROR: $*"
  alert "FAILED: $*"
  exit 1
}

cleanup() {
  rm -f "$TEMP_BACKUP_FILE"
}
trap cleanup EXIT

if ! command -v pg_dump >/dev/null 2>&1; then
  fail "pg_dump is not installed or not in PATH."
fi

if [ ! -f "$ENV_FILE" ]; then
  fail "Environment file not found: $ENV_FILE"
fi

DATABASE_URL="$(grep -m 1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)"
if [ -z "$DATABASE_URL" ]; then
  fail "DATABASE_URL is missing from $ENV_FILE"
fi

# Load optional off-site / alert config from .env so the (minimal) cron
# environment still picks them up. A real environment variable takes precedence.
for _v in BONASO_OFFSITE_S3_URI BONASO_OFFSITE_S3_ENDPOINT BONASO_OFFSITE_RCLONE_REMOTE BONASO_OFFSITE_SSH_DEST BONASO_ALERT_WEBHOOK BONASO_ALERT_COMMAND; do
  if [ -z "${!_v:-}" ]; then
    _val="$(grep -m1 "^${_v}=" "$ENV_FILE" | cut -d= -f2- || true)"
    [ -n "$_val" ] && export "${_v}=${_val}"
  fi
done

# Media + user-upload archive target (audit H3).
ASSET_FILE="$BACKUP_DIR/bonasov1_assets_$TIMESTAMP.tar.gz"
ASSET_DIRS=()
[ -d "$ROOT_DIR/media" ] && ASSET_DIRS+=("media")
[ -d "$ROOT_DIR/uploads" ] && ASSET_DIRS+=("uploads")
ASSET_STATUS="skipped_no_dirs"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

log "Starting BONASOV1 database backup."
log "Backup directory: $BACKUP_DIR"

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$TEMP_BACKUP_FILE"

if [ ! -s "$TEMP_BACKUP_FILE" ]; then
  fail "Backup file was not created or is empty."
fi

mv "$TEMP_BACKUP_FILE" "$BACKUP_FILE"

BACKUP_SIZE_BYTES="$(stat -c '%s' "$BACKUP_FILE")"
BACKUP_SHA256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"

if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$BACKUP_FILE" >/dev/null
  VERIFY_STATUS="pg_restore_list_ok"
else
  VERIFY_STATUS="pg_restore_not_available"
fi

# Environment stamp (LIVE/TRAINING) for restore contamination protection.
BACKUP_ENVIRONMENT="${BONASO_ENVIRONMENT:-LIVE}"

cat >"$MANIFEST_FILE" <<JSON
{
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_file": "$BACKUP_FILE",
  "size_bytes": $BACKUP_SIZE_BYTES,
  "sha256": "$BACKUP_SHA256",
  "verify_status": "$VERIFY_STATUS",
  "environment": "$BACKUP_ENVIRONMENT",
  "retention_days": $RETENTION_DAYS
}
JSON

cp "$MANIFEST_FILE" "$LATEST_FILE"
chmod 600 "$BACKUP_FILE" "$MANIFEST_FILE" "$LATEST_FILE"

# ---- Media + uploads archive (audit H3) ----
if [ "${#ASSET_DIRS[@]}" -gt 0 ]; then
  if tar -czf "$ASSET_FILE" -C "$ROOT_DIR" "${ASSET_DIRS[@]}" 2>/dev/null; then
    chmod 600 "$ASSET_FILE"
    ASSET_STATUS="ok"
    log "Asset backup: $ASSET_FILE ($(stat -c '%s' "$ASSET_FILE") bytes; dirs: ${ASSET_DIRS[*]})"
  else
    ASSET_STATUS="tar_failed"
    log "WARNING: media/uploads archive failed."
  fi
else
  log "WARNING: no media/uploads dirs found under $ROOT_DIR; skipping asset backup."
fi

# Files to replicate off-site: db dump, manifest, and the asset archive if made.
PUSH_FILES=("$BACKUP_FILE" "$MANIFEST_FILE")
[ "$ASSET_STATUS" = "ok" ] && PUSH_FILES+=("$ASSET_FILE")

find "$BACKUP_DIR" -type f \( -name 'bonasov1_db_*.dump' -o -name 'bonasov1_db_*.json' -o -name 'bonasov1_assets_*.tar.gz' \) -mtime "+$RETENTION_DAYS" -delete

log "Backup complete: $BACKUP_FILE"
log "Manifest: $MANIFEST_FILE"

# ---------------------------------------------------------------------------
# Off-site replication (audit finding C1).
#
# A local-only backup does not survive host/disk loss. Configure ONE of:
#   BONASO_OFFSITE_RCLONE_REMOTE  e.g. "b2:bonaso-backups/db"    (needs rclone)
#   BONASO_OFFSITE_SSH_DEST       e.g. "backup@host:/srv/bonaso" (needs ssh/scp)
# Both the .dump and the .json manifest are pushed. If a target IS configured
# but the push fails, we exit non-zero so the cron log / monitoring alerts.
# If NO target is configured we log a loud WARNING (so the gap stays visible)
# but do not fail the local backup.
# ---------------------------------------------------------------------------
OFFSITE_RCLONE_REMOTE="${BONASO_OFFSITE_RCLONE_REMOTE:-}"
OFFSITE_SSH_DEST="${BONASO_OFFSITE_SSH_DEST:-}"
OFFSITE_S3_URI="${BONASO_OFFSITE_S3_URI:-}"   # e.g. s3://bonaso-backups/db (needs aws cli)
OFFSITE_STATUS="not_configured"

push_offsite() {
  # Native S3 (AWS S3, Backblaze B2 S3-compatible, etc.) via the aws CLI. Use
  # BONASO_OFFSITE_S3_ENDPOINT for non-AWS S3-compatible providers.
  if [ -n "$OFFSITE_S3_URI" ]; then
    command -v aws >/dev/null 2>&1 || { log "ERROR: aws CLI not installed but BONASO_OFFSITE_S3_URI is set."; return 1; }
    local endpoint_args=()
    [ -n "${BONASO_OFFSITE_S3_ENDPOINT:-}" ] && endpoint_args=(--endpoint-url "$BONASO_OFFSITE_S3_ENDPOINT")
    log "Off-site (s3) -> $OFFSITE_S3_URI (${#PUSH_FILES[@]} files)"
    for _f in "${PUSH_FILES[@]}"; do
      aws s3 cp "${endpoint_args[@]}" "$_f" "$OFFSITE_S3_URI/" || return 1
    done
    OFFSITE_STATUS="s3_ok"
    return 0
  fi
  if [ -n "$OFFSITE_RCLONE_REMOTE" ]; then
    command -v rclone >/dev/null 2>&1 || { log "ERROR: rclone not installed but BONASO_OFFSITE_RCLONE_REMOTE is set."; return 1; }
    log "Off-site (rclone) -> $OFFSITE_RCLONE_REMOTE (${#PUSH_FILES[@]} files)"
    for _f in "${PUSH_FILES[@]}"; do
      rclone copy "$_f" "$OFFSITE_RCLONE_REMOTE" || return 1
    done
    OFFSITE_STATUS="rclone_ok"
    return 0
  fi
  if [ -n "$OFFSITE_SSH_DEST" ]; then
    command -v scp >/dev/null 2>&1 || { log "ERROR: scp not installed but BONASO_OFFSITE_SSH_DEST is set."; return 1; }
    log "Off-site (scp) -> $OFFSITE_SSH_DEST (${#PUSH_FILES[@]} files)"
    scp -q -o BatchMode=yes "${PUSH_FILES[@]}" "$OFFSITE_SSH_DEST/" || return 1
    OFFSITE_STATUS="scp_ok"
    return 0
  fi
  return 2  # not configured
}

if push_offsite; then
  [ "$OFFSITE_STATUS" = "not_configured" ] || log "Off-site replication complete: $OFFSITE_STATUS"
else
  rc=$?
  if [ "$rc" -eq 2 ]; then
    log "WARNING: no off-site backup target configured (set BONASO_OFFSITE_S3_URI, BONASO_OFFSITE_RCLONE_REMOTE or BONASO_OFFSITE_SSH_DEST). Backup is LOCAL-ONLY and will not survive host loss."
  else
    alert "off-site replication FAILED. Local backup intact at $BACKUP_FILE but NOT replicated."
    exit 1
  fi
fi

# Record off-site status into the manifest/latest for the health-check to read.
if command -v python3 >/dev/null 2>&1; then
  python3 - "$MANIFEST_FILE" "$LATEST_FILE" "$OFFSITE_STATUS" "$ASSET_STATUS" "${ASSET_FILE:-}" <<'PY' || true
import json, os, sys
manifest, latest, status, asset_status, asset_file = sys.argv[1:6]
for path in (manifest, latest):
    try:
        with open(path) as fh:
            data = json.load(fh)
        data["offsite_status"] = status
        data["asset_status"] = asset_status
        if asset_status == "ok" and asset_file and os.path.exists(asset_file):
            data["asset_file"] = asset_file
            data["asset_size_bytes"] = os.path.getsize(asset_file)
        with open(path, "w") as fh:
            json.dump(data, fh, indent=2)
    except Exception:
        pass
PY
fi

log "Off-site status: $OFFSITE_STATUS"
