#!/usr/bin/env bash
#
# Install the daily CSO Mapping draft-cleanup cron for the current user.
# Idempotent: re-running replaces the prior entry for this wrapper.
#
# Schedule: 03:15 daily (kept clear of the 03:30 consistency cron).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/cso-mapping-cleanup.sh"
LOG_DIR="/home/bonasoadmin/logs"
LOG="$LOG_DIR/cso-mapping-cleanup.log"
CRON_LINE="15 3 * * * $WRAPPER >> $LOG 2>&1"

chmod +x "$WRAPPER"
mkdir -p "$LOG_DIR"

# Remove any existing entry for this wrapper, then append the fresh one.
( crontab -l 2>/dev/null | grep -vF "$WRAPPER" || true; echo "$CRON_LINE" ) | crontab -

echo "Installed daily CSO draft-cleanup cron:"
echo "  $CRON_LINE"
