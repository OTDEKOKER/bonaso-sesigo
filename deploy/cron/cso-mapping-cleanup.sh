#!/usr/bin/env bash
#
# Delete expired CSO Mapping questionnaire drafts (personal-data minimisation).
# Intended to run daily from the host crontab (SESIGO's scheduling convention).
#
# Safety properties:
#   * Overlap-protected with flock (a slow run never overlaps the next).
#   * Exits non-zero on failure (so cron/monitoring notices).
#   * Logs only the timestamp, outcome and deleted count — never answers, names,
#     emails, IDs or resume tokens.
set -euo pipefail

LOCKFILE="/tmp/cso-mapping-cleanup.lock"
COMPOSE_DIR="/home/bonasoadmin/BONASOV1/frontend"
COMPOSE_FILE="compose.server.yaml"
SERVICE="backend"

# Non-blocking lock: if a previous run is still going, skip this one.
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "$(date -Is) cso-drafts-cleanup: another run in progress; skipping."
  exit 0
fi

cd "$COMPOSE_DIR"
if docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" python manage.py cleanup_cso_drafts; then
  echo "$(date -Is) cso-drafts-cleanup: success."
else
  echo "$(date -Is) cso-drafts-cleanup: FAILED." >&2
  exit 1
fi
