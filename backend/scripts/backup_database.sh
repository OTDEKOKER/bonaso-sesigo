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

fail() {
  log "ERROR: $*"
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

cat >"$MANIFEST_FILE" <<JSON
{
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_file": "$BACKUP_FILE",
  "size_bytes": $BACKUP_SIZE_BYTES,
  "sha256": "$BACKUP_SHA256",
  "verify_status": "$VERIFY_STATUS",
  "retention_days": $RETENTION_DAYS
}
JSON

cp "$MANIFEST_FILE" "$LATEST_FILE"
chmod 600 "$BACKUP_FILE" "$MANIFEST_FILE" "$LATEST_FILE"

find "$BACKUP_DIR" -type f \( -name 'bonasov1_db_*.dump' -o -name 'bonasov1_db_*.json' \) -mtime "+$RETENTION_DAYS" -delete

log "Backup complete: $BACKUP_FILE"
log "Manifest: $MANIFEST_FILE"
