#!/usr/bin/env bash
set -euo pipefail

DOMAIN="training.sesigo.org.bw"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <letsencrypt-email>" >&2
  exit 1
fi

LE_EMAIL="$1"

sudo certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$LE_EMAIL" \
  --redirect

sudo nginx -t
sudo systemctl reload nginx

echo "SSL enabled for https://$DOMAIN"
