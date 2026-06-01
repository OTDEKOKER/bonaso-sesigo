import argparse
import json
import os
import re
import sys
from pathlib import Path


BACKEND_ROOT = Path(os.environ.get("BONASO_DJANGO_ROOT", r"C:\Projects\django_backend"))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

import django  # noqa: E402

django.setup()

from django.db import transaction  # noqa: E402
from django.utils import timezone  # noqa: E402

from aggregates.models import Aggregate, AggregateChangeLog  # noqa: E402
from indicators.models import Indicator  # noqa: E402
from organizations.models import Organization  # noqa: E402
from projects.models import Project, ProjectIndicator  # noqa: E402
from users.models import User  # noqa: E402

from import_selected_q3_workbook import (  # noqa: E402
    DEFAULT_PERIOD_END,
    DEFAULT_PERIOD_START,
    DEFAULT_PROJECT_CODE,
    DEFAULT_WORKBOOK,
    load_workbook,
    parse_sheet,
    update_indicator_disaggregation,
)


TARGET_TITLES = [
    "Number eligible for GBV services who experienced PHYSICAL VIOLENCE",
    "Number eligible for GBV services who experienced SEXUAL VIOLENCE",
    "Number eligible for GBV services who experienced EMOTIONAL VIOLENCE",
]


def normalize(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def make_indicator_code(name, existing_codes):
    base = (
        str(name or "")
        .strip()
        .upper()
        .replace("&", "AND")
    )
    base = re.sub(r"[^A-Z0-9]+", "_", base).strip("_")[:34] or "GBV_INDICATOR"
    candidate = f"AUTO_{base}"[:50]
    suffix = 1

    while normalize(candidate) in existing_codes:
        tail = f"_{suffix}"
        base_limit = max(1, 50 - 5 - len(tail))
        candidate = f"AUTO_{base[:base_limit]}{tail}"
        suffix += 1

    existing_codes.add(normalize(candidate))
    return candidate


def build_args():
    parser = argparse.ArgumentParser(
        description="Create three BONELA GBV violence indicators and import their Q3 workbook aggregates."
    )
    parser.add_argument("--workbook", default=DEFAULT_WORKBOOK)
    parser.add_argument("--sheet", default="BONELA")
    parser.add_argument("--organization", default="BONELA")
    parser.add_argument("--project-code", default=DEFAULT_PROJECT_CODE)
    parser.add_argument("--period-start", default=DEFAULT_PERIOD_START)
    parser.add_argument("--period-end", default=DEFAULT_PERIOD_END)
    parser.add_argument("--username", default="odekoker")
    parser.add_argument("--report-path", default="")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def ensure_indicator(indicator, workbook_item, organization, admin_user, dry_run):
    changed = False

    if indicator.category != "gbv":
        indicator.category = "gbv"
        changed = True
    if indicator.type != "number":
        indicator.type = "number"
        changed = True
    if indicator.aggregation_method != "sum":
        indicator.aggregation_method = "sum"
        changed = True
    if not indicator.is_active:
        indicator.is_active = True
        changed = True
    if indicator.created_by_id is None:
        indicator.created_by = admin_user
        changed = True

    labels_changed = update_indicator_disaggregation(
        indicator,
        workbook_item.get("sub_labels") or [],
        apply_changes=not dry_run,
    )
    changed = changed or labels_changed

    if changed and not dry_run:
        indicator.save(
            update_fields=[
                "category",
                "type",
                "aggregation_method",
                "is_active",
                "created_by",
            ]
        )

    if not dry_run:
        indicator.organizations.add(organization)

    return changed


def ensure_aggregate(indicator, workbook_item, project, organization, admin_user, args):
    created = False
    changed = False

    aggregate, created = Aggregate.objects.get_or_create(
        indicator=indicator,
        project=project,
        organization=organization,
        period_start=args.period_start,
        period_end=args.period_end,
        defaults={
            "value": workbook_item["value"],
            "notes": (
                f"Imported from {Path(args.workbook).name} | sheet={args.sheet} | "
                f"code={workbook_item['code']}"
            ),
            "status": Aggregate.STATUS_APPROVED,
            "reviewed_at": timezone.now(),
            "reviewed_by": admin_user,
            "created_by": admin_user,
        },
    )

    update_fields = []
    next_notes = (
        f"Imported from {Path(args.workbook).name} | sheet={args.sheet} | code={workbook_item['code']}"
    )

    if aggregate.value != workbook_item["value"]:
        aggregate.value = workbook_item["value"]
        update_fields.append("value")
    if aggregate.notes != next_notes:
        aggregate.notes = next_notes
        update_fields.append("notes")
    if aggregate.status != Aggregate.STATUS_APPROVED:
        aggregate.status = Aggregate.STATUS_APPROVED
        update_fields.append("status")
    if aggregate.reviewed_by_id != admin_user.id:
        aggregate.reviewed_by = admin_user
        update_fields.append("reviewed_by")
    if aggregate.reviewed_at is None:
        aggregate.reviewed_at = timezone.now()
        update_fields.append("reviewed_at")
    if aggregate.created_by_id is None:
        aggregate.created_by = admin_user
        update_fields.append("created_by")

    if update_fields:
        aggregate.save(update_fields=update_fields)
        changed = True

    if created:
        AggregateChangeLog.objects.create(
            aggregate=aggregate,
            action=AggregateChangeLog.ACTION_SUBMITTED,
            changed_by=admin_user,
            comment="Imported from BONELA workbook.",
            changes={"source": str(Path(args.workbook).name), "sheet": args.sheet},
        )
        AggregateChangeLog.objects.create(
            aggregate=aggregate,
            action=AggregateChangeLog.ACTION_APPROVED,
            changed_by=admin_user,
            comment="Approved during BONELA GBV violence import.",
            changes={"status": Aggregate.STATUS_APPROVED},
        )

    return aggregate, created, changed


def main():
    args = build_args()

    workbook_path = Path(args.workbook)
    if not workbook_path.exists():
        raise SystemExit(f"Workbook not found: {workbook_path}")

    workbook = load_workbook(workbook_path, data_only=True)
    if args.sheet not in workbook.sheetnames:
        raise SystemExit(f"Sheet not found: {args.sheet}")

    parsed_rows = {
        item["title"]: item
        for item in parse_sheet(workbook[args.sheet])
    }

    missing_titles = [title for title in TARGET_TITLES if title not in parsed_rows]
    if missing_titles:
        raise SystemExit(f"Workbook rows not found: {', '.join(missing_titles)}")

    project = Project.objects.filter(code__iexact=args.project_code).first()
    if project is None:
        raise SystemExit(f"Project not found: {args.project_code}")

    organization = Organization.objects.filter(name__iexact=args.organization).first()
    if organization is None:
        raise SystemExit(f"Organization not found: {args.organization}")

    admin_user = User.objects.filter(username__iexact=args.username).first()
    if admin_user is None:
        raise SystemExit(f"User not found: {args.username}")

    existing_codes = {
        normalize(code)
        for code in Indicator.objects.values_list("code", flat=True)
    }

    summary = {
        "created_indicators": [],
        "updated_indicators": [],
        "created_project_assignments": [],
        "created_aggregates": [],
        "updated_aggregates": [],
    }

    with transaction.atomic():
        for title in TARGET_TITLES:
            workbook_item = parsed_rows[title]
            indicator = Indicator.objects.filter(name__iexact=title).first()
            indicator_created = False

            if indicator is None:
                indicator = Indicator(
                    name=title,
                    code=make_indicator_code(title, existing_codes),
                    category="gbv",
                    type="number",
                    aggregation_method="sum",
                    is_active=True,
                    created_by=admin_user,
                )
                indicator_created = True
                if not args.dry_run:
                    indicator.save()

            indicator_changed = ensure_indicator(
                indicator,
                workbook_item,
                organization,
                admin_user,
                args.dry_run,
            )

            assignment_created = False
            if not args.dry_run:
                _, assignment_created = ProjectIndicator.objects.get_or_create(
                    project=project,
                    indicator=indicator,
                )

                aggregate, aggregate_created, aggregate_changed = ensure_aggregate(
                    indicator,
                    workbook_item,
                    project,
                    organization,
                    admin_user,
                    args,
                )
            else:
                aggregate = None
                aggregate_created = False
                aggregate_changed = False
                assignment_created = not ProjectIndicator.objects.filter(
                    project=project,
                    indicator=indicator,
                ).exists()

            if indicator_created:
                summary["created_indicators"].append(
                    {"id": indicator.id, "code": indicator.code, "name": indicator.name}
                )
            elif indicator_changed:
                summary["updated_indicators"].append(
                    {"id": indicator.id, "code": indicator.code, "name": indicator.name}
                )

            if assignment_created:
                summary["created_project_assignments"].append(
                    {"indicator_id": indicator.id, "indicator_name": indicator.name}
                )

            if aggregate_created and aggregate is not None:
                summary["created_aggregates"].append(
                    {"id": aggregate.id, "indicator_id": indicator.id, "indicator_name": indicator.name}
                )
            elif aggregate_changed and aggregate is not None:
                summary["updated_aggregates"].append(
                    {"id": aggregate.id, "indicator_id": indicator.id, "indicator_name": indicator.name}
                )

        if args.dry_run:
            transaction.set_rollback(True)

    report = {
        "workbook": str(workbook_path),
        "sheet": args.sheet,
        "organization": {"id": organization.id, "name": organization.name},
        "project": {"id": project.id, "code": project.code, "name": project.name},
        "period_start": args.period_start,
        "period_end": args.period_end,
        "dry_run": args.dry_run,
        "summary": summary,
    }

    report_path = (
        Path(args.report_path)
        if args.report_path
        else Path.cwd() / "reports" / "bonela-gbv-violence-import-report.json"
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    print(f"Saved report: {report_path}")


if __name__ == "__main__":
    main()
