#!/usr/bin/env bash
set -euo pipefail

SRC_CONF="/home/bonasoadmin/BONASOV1/training/nginx-training.http-only.conf"
DST_CONF="/etc/nginx/sites-available/training.sesigo.org.bw"
ENABLED_LINK="/etc/nginx/sites-enabled/training.sesigo.org.bw"

if [[ ! -f "$SRC_CONF" ]]; then
  echo "Missing source config: $SRC_CONF" >&2
  exit 1
fi

sudo cp "$SRC_CONF" "$DST_CONF"
sudo ln -sfn "$DST_CONF" "$ENABLED_LINK"
sudo nginx -t
sudo systemctl reload nginx

echo "Nginx training HTTP site enabled."
echo "Test URL: http://training.sesigo.org.bw"
