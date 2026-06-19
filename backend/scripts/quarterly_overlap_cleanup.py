"""Resolve Makgabaneng quarterly/monthly double-count.

For the 18 Makgabaneng sub-orgs, each pre-existing QUARTERLY aggregate is
compared against the sum of its new MONTHLY rows (same org+indicator+quarter):

  * monthly_sum >= quarterly  -> quarterly is redundant -> DELETE (no data loss)
  * monthly_sum <  quarterly  -> monthly under-reports  -> KEEP + write to review CSV
  * no monthly counterpart     -> KEEP (no overlap)

Before deleting, every row to be removed is written (with full value JSON) to a
restore file so the operation is reversible. Set APPLY=1 to delete; otherwise it
only reports + writes the export files.
"""
import csv
import datetime
import json
import os

from aggregates.models import Aggregate
from organizations.models import Organization
from indicators.models import Indicator

ORG_IDS = list(range(94, 112))  # the 18 Makgabaneng subs (#94..#111)
APPLY = os.environ.get("APPLY") == "1"
TS = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
RESTORE = f"/app/backups/quarterly_deleted_restore_{TS}.json"
REVIEW = f"/app/backups/quarterly_monthly_lower_review_{TS}.csv"

QUARTERS = {
    ("2025-04-01", "2025-06-30"): ["2025-04-01", "2025-05-01", "2025-06-01"],
    ("2025-07-01", "2025-09-30"): ["2025-07-01", "2025-08-01", "2025-09-01"],
    ("2025-10-01", "2025-12-31"): ["2025-10-01", "2025-11-01", "2025-12-01"],
    ("2026-01-01", "2026-03-31"): ["2026-01-01", "2026-02-01", "2026-03-01"],
}


def _total(v):
    if isinstance(v, dict):
        return v.get("total") or 0
    return v or 0


name_cache = {}
def iname(iid):
    if iid not in name_cache:
        name_cache[iid] = Indicator.objects.filter(id=iid).values_list("name", flat=True).first() or str(iid)
    return name_cache[iid]
oname_cache = {}
def oname(oid):
    if oid not in oname_cache:
        oname_cache[oid] = Organization.objects.filter(id=oid).values_list("name", flat=True).first() or str(oid)
    return oname_cache[oid]

to_delete = []   # Aggregate rows (quarterly, monthly_sum >= quarterly)
review = []      # (org, ind, quarter, quarterly_total, monthly_sum)

for a in Aggregate.objects.filter(project_id=2, organization_id__in=ORG_IDS):
    key = (str(a.period_start), str(a.period_end))
    months = QUARTERS.get(key)
    if not months:
        continue  # not a quarterly row
    msum = 0
    mcount = 0
    for ms in months:
        for m in Aggregate.objects.filter(
            project_id=2, organization_id=a.organization_id,
            indicator_id=a.indicator_id, period_start=ms,
        ):
            if (m.period_end - m.period_start).days <= 40:
                msum += _total(m.value)
                mcount += 1
    if mcount == 0:
        continue  # no monthly counterpart -> keep
    qv = _total(a.value)
    if msum >= qv:
        to_delete.append(a)
    else:
        review.append((a.organization_id, a.indicator_id, key[0][:7], qv, msum))

print(f"quarterly rows to DELETE (monthly_sum >= quarterly): {len(to_delete)}")
print(f"quarterly rows to KEEP+REVIEW (monthly_sum < quarterly): {len(review)}")

# Always write the export/restore artifacts.
with open(RESTORE, "w") as fh:
    json.dump([
        {
            "id": a.id, "indicator_id": a.indicator_id, "project_id": a.project_id,
            "organization_id": a.organization_id,
            "period_start": str(a.period_start), "period_end": str(a.period_end),
            "value": a.value, "status": a.status, "notes": a.notes,
        }
        for a in to_delete
    ], fh, default=str)
print("restore file (deleted rows, full value):", RESTORE)

with open(REVIEW, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["organization", "indicator", "quarter", "quarterly_total", "monthly_sum", "difference"])
    for oid, iid, q, qv, mv in sorted(review):
        w.writerow([oname(oid), iname(iid), q, qv, mv, qv - mv])
print("review CSV (monthly < quarterly):", REVIEW)

if APPLY:
    ids = [a.id for a in to_delete]
    from django.db import transaction
    with transaction.atomic():
        deleted, _ = Aggregate.objects.filter(id__in=ids).delete()
    print(f"DELETED {deleted} rows (aggregates + cascaded facts).")
else:
    print("DRY RUN — nothing deleted. Set APPLY=1 to apply.")
