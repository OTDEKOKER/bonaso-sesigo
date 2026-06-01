import argparse
import json
import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(os.environ.get("BONASO_DJANGO_ROOT", r"C:\Projects\django_backend"))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

import django  # noqa: E402

django.setup()

from django.db import transaction  # noqa: E402

from aggregates.models import Aggregate, AggregateChangeLog  # noqa: E402
from indicators.models import Indicator  # noqa: E402
from projects.models import ProjectIndicator  # noqa: E402
from users.models import User  # noqa: E402


SOURCE_INDICATOR_ID = 357
TARGET_INDICATOR_ID = 472
DEFAULT_REPORT_PATH = Path("reports") / "merge-lubricants-distributed-indicators.json"


def has_non_zero_number(value):
    if isinstance(value, (int, float)):
        return float(value) != 0
    if isinstance(value, dict):
        return any(has_non_zero_number(item) for item in value.values())
    if isinstance(value, list):
        return any(has_non_zero_number(item) for item in value)
    return False


def is_placeholder_aggregate(aggregate):
    notes = str(aggregate.notes or "").strip()
    return (
        aggregate.status == Aggregate.STATUS_PENDING
        and not notes
        and not has_non_zero_number(aggregate.value)
    )


def ensure_project_assignment(target_indicator_id, project_id):
    ProjectIndicator.objects.get_or_create(
        project_id=project_id,
        indicator_id=target_indicator_id,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Merge duplicate lubricants distributed indicators into the official target indicator."
    )
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--username", default="admin")
    args = parser.parse_args()

    source = Indicator.objects.only("id", "code", "name", "is_active", "description").get(
        id=SOURCE_INDICATOR_ID
    )
    target = Indicator.objects.only("id", "code", "name", "is_active", "description").get(
        id=TARGET_INDICATOR_ID
    )
    changed_by = User.objects.only("id").filter(username__iexact=args.username).first()

    report = {
        "dry_run": args.dry_run,
        "source_indicator": {
            "id": source.id,
            "code": source.code,
            "name": source.name,
            "is_active": source.is_active,
        },
        "target_indicator": {
            "id": target.id,
            "code": target.code,
            "name": target.name,
            "is_active": target.is_active,
        },
        "moved_aggregates": [],
        "replaced_placeholders": [],
        "deleted_placeholder_aggregates": [],
        "unresolved_conflicts": [],
        "retired_source_indicator": False,
    }

    with transaction.atomic():
        target_by_key = {}
        for aggregate in Aggregate.objects.filter(indicator_id=target.id):
            key = (
                aggregate.organization_id,
                aggregate.project_id,
                str(aggregate.period_start),
                str(aggregate.period_end),
            )
            target_by_key[key] = aggregate

        for aggregate in Aggregate.objects.filter(indicator_id=source.id).order_by("id"):
            key = (
                aggregate.organization_id,
                aggregate.project_id,
                str(aggregate.period_start),
                str(aggregate.period_end),
            )
            conflicting_target = target_by_key.get(key)

            if conflicting_target is not None and conflicting_target.id != aggregate.id:
                if is_placeholder_aggregate(conflicting_target):
                    report["replaced_placeholders"].append(
                        {
                            "source_aggregate_id": aggregate.id,
                            "target_aggregate_id": conflicting_target.id,
                            "organization_id": aggregate.organization_id,
                            "project_id": aggregate.project_id,
                            "period_start": str(aggregate.period_start),
                            "period_end": str(aggregate.period_end),
                        }
                    )
                    report["deleted_placeholder_aggregates"].append(conflicting_target.id)
                    if not args.dry_run:
                        conflicting_target.delete()
                    target_by_key.pop(key, None)
                else:
                    report["unresolved_conflicts"].append(
                        {
                            "source_aggregate_id": aggregate.id,
                            "target_aggregate_id": conflicting_target.id,
                            "organization_id": aggregate.organization_id,
                            "project_id": aggregate.project_id,
                            "period_start": str(aggregate.period_start),
                            "period_end": str(aggregate.period_end),
                        }
                    )
                    continue

            report["moved_aggregates"].append(
                {
                    "aggregate_id": aggregate.id,
                    "organization_id": aggregate.organization_id,
                    "project_id": aggregate.project_id,
                    "period_start": str(aggregate.period_start),
                    "period_end": str(aggregate.period_end),
                    "status": aggregate.status,
                }
            )
            ensure_project_assignment(target.id, aggregate.project_id)
            if not args.dry_run:
                aggregate.indicator = target
                aggregate.save(update_fields=["indicator"])
                AggregateChangeLog.objects.create(
                    aggregate=aggregate,
                    action=AggregateChangeLog.ACTION_CORRECTED,
                    changed_by=changed_by,
                    comment=(
                        f"Merged duplicate indicator {source.id} into official indicator {target.id}."
                    ),
                    changes={
                        "from_indicator_id": source.id,
                        "to_indicator_id": target.id,
                    },
                )
            target_by_key[key] = aggregate

        remaining_source_aggregates = Aggregate.objects.filter(indicator_id=source.id).count()
        if remaining_source_aggregates == 0:
            report["retired_source_indicator"] = True
            if not args.dry_run:
                description = str(source.description or "").strip()
                note = f"Retired after duplicate merge into indicator {target.id}."
                source.name = target.name
                source.is_active = False
                source.description = f"{description}\n{note}".strip() if description else note
                source.save(update_fields=["name", "is_active", "description"])

        if args.dry_run:
            transaction.set_rollback(True)

    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
