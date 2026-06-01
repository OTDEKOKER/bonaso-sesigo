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
from projects.models import ProjectIndicator, ProjectIndicatorOrganizationTarget  # noqa: E402
from users.models import User  # noqa: E402


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


def is_placeholder_org_target(target_row):
    numeric_values = [
        target_row.target_value,
        target_row.q1_target,
        target_row.q2_target,
        target_row.q3_target,
        target_row.q4_target,
        target_row.baseline_value,
        target_row.current_value,
    ]
    return all(float(value or 0) == 0 for value in numeric_values)


def build_args():
    parser = argparse.ArgumentParser(
        description="Merge a duplicate source indicator into a canonical target indicator."
    )
    parser.add_argument("--source-id", type=int, required=True)
    parser.add_argument("--target-id", type=int, required=True)
    parser.add_argument("--report-path", required=True)
    parser.add_argument("--username", default="admin")
    parser.add_argument(
        "--force-zero-target-org-id",
        dest="force_zero_target_org_ids",
        action="append",
        type=int,
        default=[],
        help="Organization IDs where a same-period zero-value target aggregate should be replaced even if it is already approved.",
    )
    parser.add_argument(
        "--move-project-targets",
        action="store_true",
        help="Also move project indicator organization targets from the source indicator to the target indicator.",
    )
    parser.add_argument(
        "--drop-zero-source-target-conflicts",
        action="store_true",
        help="Delete zero-value source project targets when the canonical target already has a row for the same organization.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main():
    args = build_args()
    forced_zero_target_org_ids = set(args.force_zero_target_org_ids)

    source = Indicator.objects.only("id", "code", "name", "is_active", "description").get(
        id=args.source_id
    )
    target = Indicator.objects.only("id", "code", "name", "is_active", "description").get(
        id=args.target_id
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
        "moved_project_targets": [],
        "replaced_placeholder_project_targets": [],
        "deleted_placeholder_project_targets": [],
        "deleted_zero_source_project_targets": [],
        "deleted_source_project_assignments": [],
        "unresolved_target_conflicts": [],
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
                replace_zero_target = (
                    aggregate.organization_id in forced_zero_target_org_ids
                    and not has_non_zero_number(conflicting_target.value)
                )
                if is_placeholder_aggregate(conflicting_target) or replace_zero_target:
                    report["replaced_placeholders"].append(
                        {
                            "source_aggregate_id": aggregate.id,
                            "target_aggregate_id": conflicting_target.id,
                            "organization_id": aggregate.organization_id,
                            "project_id": aggregate.project_id,
                            "period_start": str(aggregate.period_start),
                            "period_end": str(aggregate.period_end),
                            "forced": replace_zero_target,
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
                        f"Merged duplicate indicator {source.id} into canonical indicator {target.id}."
                    ),
                    changes={
                        "from_indicator_id": source.id,
                        "to_indicator_id": target.id,
                    },
                )
            target_by_key[key] = aggregate

        if args.move_project_targets:
            source_project_indicators = list(
                ProjectIndicator.objects.filter(indicator_id=source.id).order_by("id")
            )
            for source_project_indicator in source_project_indicators:
                target_project_indicator, _ = ProjectIndicator.objects.get_or_create(
                    project_id=source_project_indicator.project_id,
                    indicator_id=target.id,
                )
                target_targets_by_org = {
                    row.organization_id: row
                    for row in ProjectIndicatorOrganizationTarget.objects.filter(
                        project_indicator=target_project_indicator
                    )
                }
                source_targets = list(
                    ProjectIndicatorOrganizationTarget.objects.filter(
                        project_indicator=source_project_indicator
                    ).order_by("id")
                )
                remaining_source_target_ids = {row.id for row in source_targets}

                for source_target in source_targets:
                    conflicting_target = target_targets_by_org.get(source_target.organization_id)
                    replace_zero_target = (
                        source_target.organization_id in forced_zero_target_org_ids
                        and conflicting_target is not None
                        and is_placeholder_org_target(conflicting_target)
                    )
                    if conflicting_target is not None and conflicting_target.id != source_target.id:
                        if is_placeholder_org_target(conflicting_target) or replace_zero_target:
                            report["replaced_placeholder_project_targets"].append(
                                {
                                    "source_target_id": source_target.id,
                                    "target_target_id": conflicting_target.id,
                                    "organization_id": source_target.organization_id,
                                    "project_id": source_project_indicator.project_id,
                                    "forced": replace_zero_target,
                                }
                            )
                            report["deleted_placeholder_project_targets"].append(conflicting_target.id)
                            if not args.dry_run:
                                conflicting_target.delete()
                            target_targets_by_org.pop(source_target.organization_id, None)
                        elif (
                            args.drop_zero_source_target_conflicts
                            and is_placeholder_org_target(source_target)
                        ):
                            report["deleted_zero_source_project_targets"].append(
                                {
                                    "source_target_id": source_target.id,
                                    "target_target_id": conflicting_target.id,
                                    "organization_id": source_target.organization_id,
                                    "project_id": source_project_indicator.project_id,
                                }
                            )
                            if not args.dry_run:
                                source_target.delete()
                            remaining_source_target_ids.discard(source_target.id)
                            continue
                        else:
                            report["unresolved_target_conflicts"].append(
                                {
                                    "source_target_id": source_target.id,
                                    "target_target_id": conflicting_target.id,
                                    "organization_id": source_target.organization_id,
                                    "project_id": source_project_indicator.project_id,
                                }
                            )
                            continue

                    report["moved_project_targets"].append(
                        {
                            "target_row_id": source_target.id,
                            "organization_id": source_target.organization_id,
                            "project_id": source_project_indicator.project_id,
                        }
                    )
                    if not args.dry_run:
                        source_target.project_indicator = target_project_indicator
                        source_target.save(update_fields=["project_indicator"])
                    remaining_source_target_ids.discard(source_target.id)
                    target_targets_by_org[source_target.organization_id] = source_target

                if not remaining_source_target_ids:
                    report["deleted_source_project_assignments"].append(source_project_indicator.id)
                    if not args.dry_run:
                        source_project_indicator.delete()

        remaining_source_aggregates = Aggregate.objects.filter(indicator_id=source.id).count()
        if args.dry_run:
            remaining_source_project_assignments = max(
                0,
                ProjectIndicator.objects.filter(indicator_id=source.id).count()
                - len(report["deleted_source_project_assignments"]),
            )
        else:
            remaining_source_project_assignments = ProjectIndicator.objects.filter(indicator_id=source.id).count()
        if remaining_source_aggregates == 0 and remaining_source_project_assignments == 0:
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
