#!/bin/bash
# Nightly project-data consistency check.
#
# Detects drift between canonical project data and its denormalized copies:
#   hierarchy : ProjectOrganization.parent_assignment  -> active ProjectOrganizationHierarchy
#               links + Project.hierarchy_overrides
#   targets   : ProjectIndicatorOrganizationTarget     -> ProjectIndicator rollups
#
# Report-only (no --fix); output is appended to the log below.
# Exit code is non-zero when drift is found (kept for visibility in the log).
#
# Known/expected residual drift (intentional headline targets, leave as-is):
#   project 2, indicator_id 1 and 32
# Anything beyond those should be investigated and, once confirmed, repaired with:
#   ./venv/bin/python manage.py check_project_consistency --project <id> --fix

set -uo pipefail
cd /home/bonasoadmin/BONASOV1/backend || exit 1

echo "===== consistency check: $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
./venv/bin/python manage.py check_project_consistency
status=$?
if [ "$status" -eq 0 ]; then
  echo "result: clean (no drift)"
else
  echo "result: drift detected (exit $status) — review above; expected residual is project 2 indicators 1 & 32"
fi
echo ""
exit 0
