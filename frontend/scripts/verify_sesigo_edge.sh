#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-sesigo.org.bw}"
EXPECTED_IP="${2:-38.51.241.67}"
API_PATH="${3:-/api/users/test-connection/}"

echo "== BONASOV1 Edge Verification =="
echo "Domain: ${DOMAIN}"
echo "Expected A record: ${EXPECTED_IP}"
echo

if ! command -v dig >/dev/null 2>&1; then
  echo "ERROR: dig not found. Install dnsutils and retry."
  exit 2
fi

echo "[1/4] DNS A record"
A_RECORDS="$(dig +short A "${DOMAIN}" | tr '\n' ' ' | sed 's/[[:space:]]\+$//')"
echo "A records: ${A_RECORDS:-<none>}"
if [[ -z "${A_RECORDS}" ]]; then
  echo "FAIL: no A record found for ${DOMAIN}"
  exit 1
fi
if ! grep -qE "(^| )${EXPECTED_IP}( |$)" <<<"${A_RECORDS}"; then
  echo "FAIL: expected IP ${EXPECTED_IP} not found in A records"
  exit 1
fi
echo "PASS"
echo

echo "[2/4] HTTP redirect target"
HTTP_HEADERS="$(curl -sSI --max-time 12 "http://${DOMAIN}" || true)"
HTTP_STATUS="$(awk 'NR==1{print $2}' <<<"${HTTP_HEADERS}")"
HTTP_LOCATION="$(awk 'BEGIN{IGNORECASE=1} /^Location:/{print $2}' <<<"${HTTP_HEADERS}" | tr -d '\r')"
echo "Status: ${HTTP_STATUS:-<none>}"
echo "Location: ${HTTP_LOCATION:-<none>}"
if [[ "${HTTP_STATUS}" != "301" && "${HTTP_STATUS}" != "302" ]]; then
  echo "FAIL: expected 301/302 redirect from http://${DOMAIN}"
  exit 1
fi
if [[ "${HTTP_LOCATION}" == *":445"* ]]; then
  echo "FAIL: redirect still points to :445 (${HTTP_LOCATION})"
  exit 1
fi
echo "PASS"
echo

echo "[3/4] HTTPS root response"
HTTPS_STATUS="$(curl -sS --max-time 12 -o /dev/null -w '%{http_code}' "https://${DOMAIN}" || true)"
echo "Status: ${HTTPS_STATUS:-<none>}"
if [[ "${HTTPS_STATUS}" != "200" && "${HTTPS_STATUS}" != "301" && "${HTTPS_STATUS}" != "302" && "${HTTPS_STATUS}" != "307" && "${HTTPS_STATUS}" != "308" ]]; then
  echo "FAIL: unexpected HTTPS status from https://${DOMAIN}"
  exit 1
fi
echo "PASS"
echo

echo "[4/4] API health over HTTPS"
API_BODY="$(curl -sS --max-time 12 "https://${DOMAIN}${API_PATH}" || true)"
echo "Body: ${API_BODY:-<empty>}"
if ! grep -q '"status":"ok"' <<<"${API_BODY}"; then
  echo "FAIL: API health response did not contain expected marker"
  exit 1
fi
echo "PASS"
echo
echo "SUCCESS: edge route for ${DOMAIN} looks healthy."
