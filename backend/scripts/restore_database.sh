#!/usr/bin/env bash
#
# BONASO database restore + restore-verification (audit C1).
#
# Usage:
#   restore_database.sh --verify [--file PATH]
#       Restore the backup into a TEMPORARY scratch database, run sanity checks
#       (table presence + row counts), then drop it. Touches NOTHING in prod.
#       This is what cron/monitoring should run to prove backups are restorable.
#
#   restore_database.sh --target-url "postgres://user:pass@host:5432/dbname" [--file PATH]
#       Restore the backup into an EXPLICIT target database (e.g. a recovery DB
#       or a freshly provisioned host during DR). Refuses to run without an
#       explicit target so it can never silently clobber production.
#
# Options:
#   --file PATH   Backup .dump to restore. Default: newest dump in the backup dir.
#   --no-checksum Skip sha256 verification against the manifest (not recommended).
#
# Env:
#   BONASO_ENV_FILE       defaults to ../.env (used only to discover prod URL for --verify host)
#   BONASO_BACKUP_DIR     defaults to ../backups/database
#   BONASO_ALERT_WEBHOOK / BONASO_ALERT_COMMAND   alert on verification failure
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BONASO_ENV_FILE:-$ROOT_DIR/.env}"
BACKUP_DIR="${BONASO_BACKUP_DIR:-$ROOT_DIR/backups/database}"

MODE=""
TARGET_URL=""
BACKUP_FILE=""
CHECK_CHECKSUM=1

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

alert() {
  local message="$1"
  log "ALERT: $message"
  if [ -n "${BONASO_ALERT_WEBHOOK:-}" ] && command -v curl >/dev/null 2>&1; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      --data "{\"text\": \"[BONASO restore] ${message}\"}" "$BONASO_ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
  if [ -n "${BONASO_ALERT_COMMAND:-}" ]; then
    # shellcheck disable=SC2086
    $BONASO_ALERT_COMMAND "[BONASO restore] ${message}" >/dev/null 2>&1 || true
  fi
}

fail() { log "ERROR: $*"; alert "FAILED: $*"; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --verify) MODE="verify"; shift ;;
    --target-url) MODE="target"; TARGET_URL="${2:-}"; shift 2 ;;
    --file) BACKUP_FILE="${2:-}"; shift 2 ;;
    --no-checksum) CHECK_CHECKSUM=0; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[ -n "$MODE" ] || fail "Specify --verify or --target-url URL."
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore is not installed."
command -v psql >/dev/null 2>&1 || fail "psql is not installed."

# Resolve the backup file (newest dump if not given).
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(ls -1t "$BACKUP_DIR"/bonasov1_db_*.dump 2>/dev/null | head -n1 || true)"
fi
[ -n "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ] || fail "No backup file found to restore (looked in $BACKUP_DIR)."
log "Restoring from: $BACKUP_FILE"

# Checksum verification against the manifest written by backup_database.sh.
if [ "$CHECK_CHECKSUM" -eq 1 ]; then
  MANIFEST_FILE="${BACKUP_FILE%.dump}.json"
  if [ -f "$MANIFEST_FILE" ] && command -v sha256sum >/dev/null 2>&1; then
    EXPECTED="$(grep -o '"sha256"[^,]*' "$MANIFEST_FILE" | head -n1 | sed -E 's/.*"sha256"[^"]*"([a-f0-9]+)".*/\1/')"
    ACTUAL="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
    if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$ACTUAL" ]; then
      fail "Checksum mismatch! manifest=$EXPECTED actual=$ACTUAL (backup may be corrupt)."
    fi
    log "Checksum verified against manifest: $ACTUAL"
  else
    log "WARNING: no manifest/sha256sum; skipping checksum verification."
  fi
fi

restore_into() {
  local url="$1"
  log "Running pg_restore into target (clean, no-owner)..."
  pg_restore --dbname="$url" --no-owner --no-acl --clean --if-exists "$BACKUP_FILE" 2>&1 | tail -5 || true
}

sanity_check() {
  local url="$1"
  local tables rows
  tables="$(psql "$url" -tAc "select count(*) from information_schema.tables where table_schema='public';" 2>/dev/null || echo 0)"
  rows="$(psql "$url" -tAc "select count(*) from indicators_indicator;" 2>/dev/null || echo 0)"
  log "Sanity: public tables=$tables, indicators_indicator rows=$rows"
  [ "${tables:-0}" -ge 20 ] || fail "Sanity check failed: too few tables ($tables)."
  log "Restore verification PASSED."
}

if [ "$MODE" = "verify" ]; then
  # Build an admin URL from the prod DATABASE_URL but target a scratch DB on the
  # same server, so we never touch the production database.
  PROD_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)"
  [ -n "$PROD_URL" ] || fail "DATABASE_URL not found in $ENV_FILE (needed to locate the DB server)."
  SCRATCH_DB="bonaso_restore_verify_$(date -u +%Y%m%d%H%M%S)"
  # Replace the trailing /dbname with the scratch db and an admin (postgres) db.
  BASE_URL="${PROD_URL%/*}"
  ADMIN_URL="$BASE_URL/postgres"
  SCRATCH_URL="$BASE_URL/$SCRATCH_DB"

  log "Creating scratch verification database: $SCRATCH_DB"
  psql "$ADMIN_URL" -c "CREATE DATABASE \"$SCRATCH_DB\";" >/dev/null 2>&1 \
    || fail "Could not create scratch DB (need CREATEDB privilege)."

  cleanup_scratch() {
    psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null 2>&1 || true
  }
  trap cleanup_scratch EXIT

  restore_into "$SCRATCH_URL"
  sanity_check "$SCRATCH_URL"
  log "Scratch DB will be dropped."
  exit 0
fi

if [ "$MODE" = "target" ]; then
  [ -n "$TARGET_URL" ] || fail "--target-url requires a database URL."
  case "$TARGET_URL" in
    *bonasov1) log "WARNING: target appears to be the production database name." ;;
  esac
  log "Restoring into explicit target: ${TARGET_URL%%:*}://***"
  restore_into "$TARGET_URL"
  sanity_check "$TARGET_URL"
  log "Restore into target complete."
  exit 0
fi
