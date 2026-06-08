#!/usr/bin/env bash
#
# BONASO backup health check (audit C1 monitoring).
#
# Alerts (and exits non-zero) when:
#   * latest.json is missing or older than BONASO_BACKUP_MAX_AGE_HOURS (default 26h)
#   * the latest backup .dump is missing/empty
#   * off-site replication status is not "*_ok" (when BONASO_REQUIRE_OFFSITE=1)
#
# Intended to run on its own cron a little after the nightly backup, e.g.:
#   0 3 * * * /bin/bash scripts/backup_healthcheck.sh >> reports/backup_health.log 2>&1
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BONASO_BACKUP_DIR:-$ROOT_DIR/backups/database}"
LATEST_FILE="$BACKUP_DIR/latest.json"
MAX_AGE_HOURS="${BONASO_BACKUP_MAX_AGE_HOURS:-26}"
REQUIRE_OFFSITE="${BONASO_REQUIRE_OFFSITE:-0}"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

alert() {
  local message="$1"
  log "ALERT: $message"
  if [ -n "${BONASO_ALERT_WEBHOOK:-}" ] && command -v curl >/dev/null 2>&1; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      --data "{\"text\": \"[BONASO backup-health] ${message}\"}" "$BONASO_ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
  if [ -n "${BONASO_ALERT_COMMAND:-}" ]; then
    # shellcheck disable=SC2086
    $BONASO_ALERT_COMMAND "[BONASO backup-health] ${message}" >/dev/null 2>&1 || true
  fi
}

fail() { alert "$*"; exit 1; }

[ -f "$LATEST_FILE" ] || fail "No latest.json — nightly backup has never completed."

# Age check.
NOW="$(date -u +%s)"
MTIME="$(stat -c '%Y' "$LATEST_FILE" 2>/dev/null || echo 0)"
AGE_HOURS=$(( (NOW - MTIME) / 3600 ))
if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  fail "Latest backup is ${AGE_HOURS}h old (> ${MAX_AGE_HOURS}h). Nightly backup may be failing."
fi

# Referenced dump exists and is non-empty.
DUMP="$(grep -o '"backup_file"[^,]*' "$LATEST_FILE" | sed -E 's/.*"backup_file"[^"]*"([^"]+)".*/\1/' || true)"
if [ -n "$DUMP" ] && [ ! -s "$DUMP" ]; then
  fail "Latest backup dump missing or empty: $DUMP"
fi

# Off-site status.
OFFSITE="$(grep -o '"offsite_status"[^,]*' "$LATEST_FILE" | sed -E 's/.*"offsite_status"[^"]*"([^"]+)".*/\1/' || echo unknown)"
if [ "$REQUIRE_OFFSITE" = "1" ]; then
  case "$OFFSITE" in
    *_ok) : ;;
    *) fail "Off-site replication not confirmed (offsite_status=$OFFSITE) but BONASO_REQUIRE_OFFSITE=1." ;;
  esac
fi

log "Backup health OK: age=${AGE_HOURS}h, offsite_status=${OFFSITE}."
