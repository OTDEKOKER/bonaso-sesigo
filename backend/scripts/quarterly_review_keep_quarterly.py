"""Resolve the 52 'monthly < quarterly' review rows: QUARTERLY wins.

User decision: where the monthly sum under-reports vs the existing quarterly
(the 52 review rows), the QUARTERLY figure is authoritative, so the MONTHLY rows
for those (org, indicator, quarter) are removed and the quarterly is kept.
Exports the removed monthly rows (full value) to a restore file first.
Set APPLY=1 to delete.
"""
import datetime
import json
import os

from aggregates.models import Aggregate

ORG_IDS = list(range(94, 112))
APPLY = os.environ.get("APPLY") == "1"
TS = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
RESTORE = f"/app/backups/monthly_removed_keep_quarterly_restore_{TS}.json"

QUARTERS = {
    ("2025-04-01", "2025-06-30"): ["2025-04-01", "2025-05-01", "2025-06-01"],
    ("2025-07-01", "2025-09-30"): ["2025-07-01", "2025-08-01", "2025-09-01"],
    ("2025-10-01", "2025-12-31"): ["2025-10-01", "2025-11-01", "2025-12-01"],
    ("2026-01-01", "2026-03-31"): ["2026-01-01", "2026-02-01", "2026-03-01"],
}


def _total(v):
    return (v.get("total") or 0) if isinstance(v, dict) else (v or 0)


monthly_to_delete = []   # the under-reporting monthly rows for the 52 review combos
review_combos = 0
for a in Aggregate.objects.filter(project_id=2, organization_id__in=ORG_IDS):
    key = (str(a.period_start), str(a.period_end))
    months = QUARTERS.get(key)
    if not months:
        continue
    rows = []
    for ms in months:
        for m in Aggregate.objects.filter(
            project_id=2, organization_id=a.organization_id,
            indicator_id=a.indicator_id, period_start=ms,
        ):
            if (m.period_end - m.period_start).days <= 40:
                rows.append(m)
    if rows and sum(_total(m.value) for m in rows) < _total(a.value):   # the 52
        review_combos += 1
        monthly_to_delete.extend(rows)

print(f"review combos (quarterly kept): {review_combos}")
print(f"monthly rows to delete (under-reporting): {len(monthly_to_delete)}")
with open(RESTORE, "w") as fh:
    json.dump([
        {"id": m.id, "indicator_id": m.indicator_id, "project_id": m.project_id,
         "organization_id": m.organization_id, "period_start": str(m.period_start),
         "period_end": str(m.period_end), "value": m.value, "status": m.status,
         "notes": m.notes}
        for m in monthly_to_delete
    ], fh, default=str)
print("restore file:", RESTORE)

if APPLY:
    from django.db import transaction
    ids = [m.id for m in monthly_to_delete]
    with transaction.atomic():
        deleted, _ = Aggregate.objects.filter(id__in=ids).delete()
    print(f"DELETED {deleted} rows (aggregates + cascaded facts).")
else:
    print("DRY RUN — set APPLY=1 to apply.")
