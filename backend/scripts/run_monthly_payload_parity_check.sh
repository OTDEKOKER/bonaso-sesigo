#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-${BACKEND_DIR}/venv/bin/python}"
REPORTS_DIR="${REPORTS_DIR:-${BACKEND_DIR}/reports/monthly_parity_checks}"

SNAPSHOT_ON_PASS=0
PROJECT_ID=2
PARENT_ORG_ID=5
PERIOD_START="2025-07-01"
PERIOD_END="2026-03-31"

print_usage() {
  cat <<'EOF'
Usage: run_monthly_payload_parity_check.sh [options] [parity-args...]

Options:
  --snapshot-on-pass         Run DB snapshot export when parity succeeds.
  --period-start YYYY-MM-DD  Snapshot filter start date (default: 2025-07-01).
  --period-end YYYY-MM-DD    Snapshot filter end date (default: 2026-03-31).
  -h, --help                 Show this help message.

All other arguments are passed to verify_monthly_payload_parity.py.
EOF
}

PARITY_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      print_usage
      exit 0
      ;;
    --snapshot-on-pass)
      SNAPSHOT_ON_PASS=1
      shift
      ;;
    --project-id)
      PROJECT_ID="${2:-}"
      PARITY_ARGS+=("$1" "${2:-}")
      shift 2
      ;;
    --parent-org-id)
      PARENT_ORG_ID="${2:-}"
      PARITY_ARGS+=("$1" "${2:-}")
      shift 2
      ;;
    --period-start)
      PERIOD_START="${2:-}"
      shift 2
      ;;
    --period-end)
      PERIOD_END="${2:-}"
      shift 2
      ;;
    *)
      PARITY_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Python binary not executable: ${PYTHON_BIN}" >&2
  exit 2
fi

mkdir -p "${REPORTS_DIR}"
timestamp="$(date +%Y%m%d_%H%M%S)"

parity_json="${REPORTS_DIR}/parity_${timestamp}.json"
parity_log="${REPORTS_DIR}/parity_${timestamp}.log"

set +e
"${PYTHON_BIN}" "${BACKEND_DIR}/scripts/verify_monthly_payload_parity.py" \
  "${PARITY_ARGS[@]}" \
  --json-out "${parity_json}" | tee "${parity_log}"
parity_exit=${PIPESTATUS[0]}
set -e

echo "PARITY_EXIT_CODE=${parity_exit}"
if [[ -f "${parity_json}" ]]; then
  echo "PARITY_REPORT_JSON=${parity_json}"
else
  echo "PARITY_REPORT_JSON_MISSING=${parity_json}"
fi
echo "PARITY_LOG=${parity_log}"

if [[ "${SNAPSHOT_ON_PASS}" -eq 1 ]]; then
  if [[ "${parity_exit}" -eq 0 && -f "${parity_json}" ]]; then
    snapshot_dir="${REPORTS_DIR}/snapshot_${timestamp}"
    snapshot_manifest="${REPORTS_DIR}/snapshot_manifest_${timestamp}.json"
    "${PYTHON_BIN}" "${BACKEND_DIR}/scripts/snapshot_monthly_truth_baseline.py" \
      --project-id "${PROJECT_ID}" \
      --parent-org-id "${PARENT_ORG_ID}" \
      --period-start "${PERIOD_START}" \
      --period-end "${PERIOD_END}" \
      --out-dir "${snapshot_dir}" \
      --manifest-out "${snapshot_manifest}"
  elif [[ "${parity_exit}" -ne 0 ]]; then
    echo "Snapshot skipped because parity check failed."
  else
    echo "Snapshot skipped because parity report was not generated."
  fi
fi

exit "${parity_exit}"
