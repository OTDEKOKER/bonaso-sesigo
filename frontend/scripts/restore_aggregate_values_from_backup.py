import argparse
import json
import os
import sys
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_ROOT.parent.parent
BACKEND_ROOT = PROJECT_ROOT / "backend"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

import django  # noqa: E402

django.setup()

from django.db import transaction  # noqa: E402

from aggregates.models import Aggregate  # noqa: E402


DEFAULT_BACKUP_PATH = PROJECT_ROOT / "imports" / "q4-2026-04-12" / "bonepwa-q4-backup.json"
DEFAULT_REPORT_PATH = PROJECT_ROOT / "frontend" / "reports" / "restore-indicator-522-q3-from-backup.json"


def build_args():
    parser = argparse.ArgumentParser(
        description="Restore aggregate values for a specific indicator and period from a JSON backup."
    )
    parser.add_argument("--indicator-id", type=int)
    parser.add_argument("--organization-id", type=int)
    parser.add_argument("--period-start", default="2025-10-01")
    parser.add_argument("--period-end", default="2025-12-31")
    parser.add_argument("--backup-path", default=str(DEFAULT_BACKUP_PATH))
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH))
    parser.add_argument("--apply", action="store_true", help="Apply changes. Default is dry run.")
    return parser.parse_args()


def load_rows(path):
    text = Path(path).read_text(encoding="utf-8").lstrip("\ufeff")
    payload = json.loads(text)
    if not isinstance(payload, list):
        raise ValueError(f"Expected a top-level JSON array in {path}")
    return payload


def backup_key(row):
    return (
        int(row["indicator_id"]),
        int(row["organization_id"]),
        str(row["period_start"]),
        str(row["period_end"]),
    )


def live_key(aggregate):
    return (
        int(aggregate.indicator_id),
        int(aggregate.organization_id),
        str(aggregate.period_start),
        str(aggregate.period_end),
    )


def main():
    args = build_args()
    backup_rows = [
        row
        for row in load_rows(args.backup_path)
        if (args.indicator_id is None or int(row.get("indicator_id") or 0) == args.indicator_id)
        and (args.organization_id is None or int(row.get("organization_id") or 0) == args.organization_id)
        and str(row.get("period_start")) == args.period_start
        and str(row.get("period_end")) == args.period_end
    ]
    backup_by_key = {backup_key(row): row for row in backup_rows}

    live_filters = {
        "period_start": args.period_start,
        "period_end": args.period_end,
    }
    if args.indicator_id is not None:
        live_filters["indicator_id"] = args.indicator_id
    if args.organization_id is not None:
        live_filters["organization_id"] = args.organization_id

    live_rows = list(
        Aggregate.objects.filter(**live_filters)
        .order_by("indicator_id", "organization_id", "id")
        .only("id", "indicator_id", "organization_id", "project_id", "period_start", "period_end", "value")
    )

    report = {
        "dry_run": not args.apply,
        "backup_path": str(Path(args.backup_path).resolve()),
        "scope": {
            "indicator_id": args.indicator_id,
            "organization_id": args.organization_id,
            "period_start": args.period_start,
            "period_end": args.period_end,
        },
        "summary": {
            "backup_rows": len(backup_rows),
            "live_rows": len(live_rows),
            "matched_rows": 0,
            "updated_rows": 0,
            "unchanged_rows": 0,
            "missing_in_backup": 0,
            "missing_in_live": 0,
        },
        "updated_rows": [],
        "unchanged_rows": [],
        "missing_in_backup": [],
        "missing_in_live": [],
    }

    rows_to_update = []
    matched_keys = set()

    for aggregate in live_rows:
        key = live_key(aggregate)
        backup_row = backup_by_key.get(key)
        if backup_row is None:
            report["missing_in_backup"].append(
                {
                    "aggregate_id": aggregate.id,
                    "indicator_id": aggregate.indicator_id,
                    "organization_id": aggregate.organization_id,
                    "project_id": aggregate.project_id,
                    "period_start": str(aggregate.period_start),
                    "period_end": str(aggregate.period_end),
                }
            )
            continue

        matched_keys.add(key)
        report["summary"]["matched_rows"] += 1

        current_value = aggregate.value or {}
        backup_value = backup_row.get("value") or {}
        if current_value == backup_value:
            report["summary"]["unchanged_rows"] += 1
            report["unchanged_rows"].append(
                {
                    "aggregate_id": aggregate.id,
                    "indicator_id": aggregate.indicator_id,
                    "organization_id": aggregate.organization_id,
                    "project_id": aggregate.project_id,
                    "backup_row_id": backup_row.get("id"),
                }
            )
            continue

        rows_to_update.append((aggregate, backup_row))
        report["summary"]["updated_rows"] += 1
        report["updated_rows"].append(
            {
                "aggregate_id": aggregate.id,
                "indicator_id": aggregate.indicator_id,
                "organization_id": aggregate.organization_id,
                "project_id": aggregate.project_id,
                "backup_row_id": backup_row.get("id"),
                "from_value": current_value,
                "to_value": backup_value,
            }
        )

    for key, backup_row in sorted(backup_by_key.items()):
        if key in matched_keys:
            continue
        report["missing_in_live"].append(
            {
                "backup_row_id": backup_row.get("id"),
                "indicator_id": backup_row.get("indicator_id"),
                "organization_id": backup_row.get("organization_id"),
                "period_start": backup_row.get("period_start"),
                "period_end": backup_row.get("period_end"),
            }
        )

    report["summary"]["missing_in_backup"] = len(report["missing_in_backup"])
    report["summary"]["missing_in_live"] = len(report["missing_in_live"])

    if args.apply and rows_to_update:
        with transaction.atomic():
            for aggregate, backup_row in rows_to_update:
                aggregate.value = backup_row.get("value") or {}
                aggregate.save(update_fields=["value", "updated_at"])

    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
