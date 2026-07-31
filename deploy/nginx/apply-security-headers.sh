#!/usr/bin/env bash
# Apply the version-controlled hardened nginx config (adds HSTS + X-Frame-Options)
# to the live site. Safe: timestamped backup, diff, validate-before-reload,
# auto-rollback on nginx -t failure. Run interactively (needs sudo password):
#   bash deploy/nginx/apply-security-headers.sh
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/sesigo.org.bw.conf"
CONF=/etc/nginx/sites-available/sesigo.org.bw
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="${CONF}.backup-${TS}"

[ -r "$SRC" ] || { echo "!! source $SRC not found"; exit 1; }

echo ">> backup current live config"
sudo cp -p "$CONF" "$BACKUP"
echo "   backup: $BACKUP"

echo ">> diff (live -> hardened; should show ONLY the two add_header lines + comments)"
sudo diff -u "$CONF" "$SRC" || true

echo ">> install hardened config"
sudo install -m 0644 -o root -g root "$SRC" "$CONF"

echo ">> validate"
if ! sudo nginx -t; then
  echo "!! nginx -t FAILED -- restoring backup and re-validating"
  sudo cp -p "$BACKUP" "$CONF"
  sudo nginx -t
  echo "!! Rolled back. No reload performed."; exit 1
fi

echo ">> graceful reload"
sudo systemctl reload nginx
sudo systemctl is-active nginx

echo ">> verify security headers now present (loopback-safe)"
curl -sS -D - -o /dev/null --resolve sesigo.org.bw:443:127.0.0.1 https://sesigo.org.bw/ \
  | grep -iE 'strict-transport-security|x-frame-options|x-content-type|content-security-policy' | sed 's/^/   /'
echo ">> regression:"
for p in / /dashboard /cso-mapping /cso-mapping/questionnaire /api/health/; do
  curl -sS -o /dev/null -w "   ${p} -> HTTP %{http_code}\n" --resolve sesigo.org.bw:443:127.0.0.1 "https://sesigo.org.bw${p}"
done
echo ">> Done. Backup retained at: $BACKUP"
echo ">> If anything looks wrong: sudo cp -p $BACKUP $CONF && sudo nginx -t && sudo systemctl reload nginx"
