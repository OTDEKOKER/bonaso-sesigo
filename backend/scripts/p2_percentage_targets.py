"""
Make project 2 (NAHPA 2025/26) consistent with the percent-number convention now
used by the indicators that became type='percentage' during the 2026/27 load.

For every indicator currently type='percentage' that project 2 uses, re-store any
project-2 org-target quarter value that is a fraction (0 < v <= 1) as a percent-
number (x100): 1.0 -> 100, 0.8 -> 80, 0.014 -> 1.4. Values already > 1 (e.g. an
already-converted 100) and 0 are left as-is. Aggregates/actuals are NOT touched.

Scope = the indicators my global type flip affected (percentage-type indicators
also used by project 3). Dry-run by default; --apply to persist.
"""
import argparse
import os
import sys
from decimal import Decimal
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
import django  # noqa: E402

django.setup()

from django.db import transaction  # noqa: E402
from django.db.models import Sum  # noqa: E402

from indicators.models import Indicator  # noqa: E402
from projects.models import ProjectIndicator, ProjectIndicatorOrganizationTarget as OT  # noqa: E402

P2 = 2
ONE = Decimal(1)
ZERO = Decimal(0)


def conv(v):
    return v * 100 if ZERO < v <= ONE else v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    # indicators affected by the global flip = percentage-type AND used by project 3
    pct_ids = set(ProjectIndicator.objects.filter(project_id=3, indicator__type="percentage").values_list("indicator_id", flat=True))

    changed = 0
    touched_pi = set()
    examples = []
    with transaction.atomic():
        for ot in OT.objects.filter(project_indicator__project_id=P2, project_indicator__indicator_id__in=pct_ids):
            old = [ot.q1_target, ot.q2_target, ot.q3_target, ot.q4_target]
            new = [conv(v) for v in old]
            if new == old:
                continue
            tv = sum(new)
            if args.apply:
                ot.q1_target, ot.q2_target, ot.q3_target, ot.q4_target, ot.target_value = new[0], new[1], new[2], new[3], tv
                ot.save(update_fields=["q1_target", "q2_target", "q3_target", "q4_target", "target_value"])
            changed += 1
            touched_pi.add(ot.project_indicator_id)
            if len(examples) < 20:
                examples.append((ot.project_indicator.indicator_id, ot.organization_id,
                                 [float(x) for x in old], [float(x) for x in new]))

        for pi_id in touched_pi:
            agg = OT.objects.filter(project_indicator_id=pi_id).aggregate(
                q1=Sum("q1_target"), q2=Sum("q2_target"), q3=Sum("q3_target"), q4=Sum("q4_target"), tv=Sum("target_value"))
            if args.apply:
                ProjectIndicator.objects.filter(id=pi_id).update(
                    q1_target=agg["q1"] or 0, q2_target=agg["q2"] or 0, q3_target=agg["q3"] or 0,
                    q4_target=agg["q4"] or 0, target_value=agg["tv"] or 0)

        if not args.apply:
            transaction.set_rollback(True)

    print(("APPLIED" if args.apply else "DRY-RUN") + " ----------------------------------")
    print(f"percentage indicators in scope: {len(pct_ids)} | project-2 org-targets converted: {changed} | project-indicators re-rolled: {len(touched_pi)}")
    for iid, oid, old, new in examples:
        print(f"  I{iid} org={oid}: {old} -> {new}")


if __name__ == "__main__":
    main()
