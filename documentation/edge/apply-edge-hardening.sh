#!/usr/bin/env bash
# Apply the SESIGO edge security hardening (audit WS3).
#
#   sudo bash documentation/edge/apply-edge-hardening.sh
#
# Safe by construction:
#   * backs up the live site config first;
#   * runs `nginx -t` and ONLY reloads if it passes;
#   * if `nginx -t` fails, restores the backup and exits non-zero (live nginx
#     keeps running its already-loaded config the whole time — a failed test
#     never touches the running server).
# Idempotent-ish: re-running just re-copies the same files and reloads.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EDGE="$REPO_ROOT/documentation/edge"
SITE=/etc/nginx/sites-available/sesigo.org.bw
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP="${SITE}.bak.${STAMP}"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi

echo "1/5 Backing up live site config -> $BACKUP"
cp "$SITE" "$BACKUP"

echo "2/5 Installing snippets"
install -d /etc/nginx/snippets
cp "$EDGE/sesigo-security-headers.conf" /etc/nginx/snippets/
cp "$EDGE/sesigo-ratelimit.conf"        /etc/nginx/conf.d/

echo "3/5 Applying hardened site config"
cp "$EDGE/sesigo.org.bw.hardened.conf" "$SITE"

echo "4/5 Testing config (nginx -t)"
if ! nginx -t; then
  echo "!! nginx -t FAILED — restoring backup, NOT reloading." >&2
  cp "$BACKUP" "$SITE"
  rm -f /etc/nginx/conf.d/sesigo-ratelimit.conf
  echo "Restored $SITE from $BACKUP. Live nginx untouched." >&2
  exit 1
fi

echo "5/5 Reloading nginx (graceful)"
systemctl reload nginx

echo
echo "Done. Verifying headers (each should appear exactly once):"
curl -sSI https://sesigo.org.bw/ | grep -iE 'strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy' || true
echo
echo "Rollback if needed:"
echo "  sudo cp $BACKUP $SITE && sudo rm -f /etc/nginx/conf.d/sesigo-ratelimit.conf && sudo nginx -t && sudo systemctl reload nginx"
