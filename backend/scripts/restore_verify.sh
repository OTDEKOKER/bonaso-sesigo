#!/usr/bin/env bash
#
# Restore-verification drill (audit finding M6).
#
# Loads the most recent backup dump into a THROWAWAY database and runs row-count
# sanity checks, proving the backup actually restores. The scratch DB is dropped
# at the end. Safe to run on the live host: it never touches the live database.
#
# Usage:  ./scripts/restore_verify.sh [path/to/backup.dump]
# Cron (monthly):
#   0 3 1 * * /bin/bash /home/bonasoadmin/BONASOV1/backend/scripts/restore_verify.sh \
#     >> /home/bonasoadmin/BONASOV1/backend/backups/database/restore_verify.log 2>&1
#
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BONASO_ENV_FILE:-$ROOT_DIR/.env}"
BACKUP_DIR="${BONASO_BACKUP_DIR:-$ROOT_DIR/backups/database}"
SCRATCH_DB="${BONASO_RESTORE_VERIFY_DB:-bonasov1_restore_check}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not installed."
command -v psql       >/dev/null 2>&1 || fail "psql not installed."
[ -f "$ENV_FILE" ] || fail "Environment file not found: $ENV_FILE"

DATABASE_URL="$(grep -m 1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)"
[ -n "$DATABASE_URL" ] || fail "DATABASE_URL missing from $ENV_FILE"

# Pick the dump: explicit arg, else newest in BACKUP_DIR.
BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(ls -1t "$BACKUP_DIR"/bonasov1_db_*.dump 2>/dev/null | head -n1 || true)"
fi
[ -n "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ] || fail "No non-empty backup dump found."
log "Verifying restore of: $BACKUP_FILE"

# Build an admin connection URL (same server/creds, db=postgres) to create/drop
# the scratch database without touching the live one.
ADMIN_URL="$(python3 - "$DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
u = urlsplit(sys.argv[1])
print(urlunsplit((u.scheme, u.netloc, "/postgres", u.query, "")))
PY
)"
SCRATCH_URL="$(python3 - "$DATABASE_URL" "$SCRATCH_DB" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
u = urlsplit(sys.argv[1])
print(urlunsplit((u.scheme, u.netloc, "/" + sys.argv[2], u.query, "")))
PY
)"

cleanup() {
  psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Creating scratch database: $SCRATCH_DB"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$SCRATCH_DB\";"

log "Restoring dump..."
# --no-owner/--no-acl: ignore ownership; non-zero exit on hard failure only.
pg_restore --no-owner --no-acl --dbname="$SCRATCH_URL" "$BACKUP_FILE" 2>&1 | tail -5 || true

# Sanity checks: core tables must exist and have rows.
CHECK_SQL="
SELECT
  (SELECT count(*) FROM users_user)        AS users,
  (SELECT count(*) FROM projects_project)  AS projects,
  (SELECT count(*) FROM aggregates_aggregate) AS aggregates;
"
RESULT="$(psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -tAF',' -c "$CHECK_SQL")" \
  || fail "Sanity query failed - restore is NOT usable."

USERS="$(echo "$RESULT" | cut -d',' -f1)"
PROJECTS="$(echo "$RESULT" | cut -d',' -f2)"
AGGREGATES="$(echo "$RESULT" | cut -d',' -f3)"
log "Restored row counts -> users=$USERS projects=$PROJECTS aggregates=$AGGREGATES"

[ "${USERS:-0}" -ge 1 ] || fail "No users in restored DB - backup likely corrupt."
[ "${PROJECTS:-0}" -ge 1 ] || fail "No projects in restored DB - backup likely corrupt."

log "RESTORE VERIFICATION PASSED."
