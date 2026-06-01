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

from aggregates.models import Aggregate  # noqa: E402
from indicators.models import Indicator  # noqa: E402
from projects.models import ProjectIndicator  # noqa: E402


RENAME_ONLY = {
    321: "Total Number of People Reached with HIV Testing Messages",
    322: "Total Number of People Reached with PEP Messages",
    323: "Total Number of People Reached with PrEP Messages",
    324: "Total Number of People Reached with GBV Messages",
    325: "Total Number of People Reached with Condom Use Messages",
    326: "Total Number of People Reached with HIV Treatment Messages",
    327: "Total Number of People Reached with ARV Based Prevention Messages",
    328: "Total Number of People Reached with eMTCT Messages",
    329: "Total Number of People Reached with HIV Messages",
    445: "Number of people referred for HIV testing.",
    448: "Number of braille labelled condoms distributed to PWDs",
    452: "Number of people who tested positive for HIV.",
    340: "Number of people provided with legal aid services.",
    341: "Number of people linked to justice services.",
    457: "Number of people eligible for legal aid services.",
    459: "Number of people eligible for justice services.",
    463: "Number of people eligible for clinical services for GBV.",
    464: "Number of people referred for clinical services for GBV.",
    465: "Number of people eligible for justice services for GBV.",
    466: "Number of people referred for justice services for GBV.",
    467: "Number of people eligible for psychosocial support on GBV.",
    468: "Number of people screened positive for STIs referred for services",
    469: "Number of STI cases linked to care",
    470: "Number of STI cases referrals completed",
    473: "Number of people provided with legal aid services.",
    474: "Number of people linked to justice services.",
    479: "Number of people referred for psychosocial support on GBV.",
}

MERGE_PLAN = [
    {"source": 332, "target": 451},
    {"source": 344, "target": 463},
    {"source": 345, "target": 464},
    {"source": 346, "target": 465},
    {"source": 347, "target": 466},
    {"source": 348, "target": 467},
    {"source": 349, "target": 479},
]


def get_indicator_row(indicator_id):
    return Indicator.objects.filter(id=indicator_id).values(
        "id",
        "code",
        "name",
        "is_active",
        "description",
    ).first()


def append_description_note(description, note):
    base = str(description or "").strip()
    if note in base:
        return base
    return f"{base}\n{note}".strip()


def rename_indicator(indicator_id, new_name, report, dry_run):
    indicator = get_indicator_row(indicator_id)
    if not indicator:
        report["missing_indicators"].append({"id": indicator_id, "expected_name": new_name})
        return
    if indicator["name"] == new_name:
        return
    report["renamed_indicators"].append(
        {
            "id": indicator_id,
            "code": indicator["code"],
            "from": indicator["name"],
            "to": new_name,
        }
    )
    if not dry_run:
        Indicator.objects.filter(id=indicator_id).update(name=new_name)


def ensure_project_assignments(target_indicator_id, aggregates, dry_run, report):
    seen = set()
    for aggregate in aggregates:
        key = (aggregate["project_id"], target_indicator_id)
        if key in seen:
            continue
        seen.add(key)
        exists = ProjectIndicator.objects.filter(
            project_id=aggregate["project_id"],
            indicator_id=target_indicator_id,
        ).exists()
        if exists:
            continue
        report["project_assignments_created"].append(
            {"project_id": aggregate["project_id"], "indicator_id": target_indicator_id}
        )
        if not dry_run:
            ProjectIndicator.objects.create(
                project_id=aggregate["project_id"],
                indicator_id=target_indicator_id,
            )


def merge_indicator(source_id, target_id, report, dry_run):
    source = get_indicator_row(source_id)
    target = get_indicator_row(target_id)
    if not source or not target:
        report["missing_indicators"].append(
            {"source": source_id, "target": target_id, "source_found": bool(source), "target_found": bool(target)}
        )
        return

    source_aggregates = list(
        Aggregate.objects.filter(indicator_id=source_id).values(
            "id",
            "organization_id",
            "project_id",
            "period_start",
            "period_end",
            "status",
        )
    )
    target_aggregates = list(
        Aggregate.objects.filter(indicator_id=target_id).values(
            "id",
            "organization_id",
            "project_id",
            "period_start",
            "period_end",
        )
    )
    target_by_key = {
        (
            row["organization_id"],
            row["project_id"],
            str(row["period_start"]),
            str(row["period_end"]),
        ): row["id"]
        for row in target_aggregates
    }

    moved = []
    conflicts = []
    for aggregate in source_aggregates:
        key = (
            aggregate["organization_id"],
            aggregate["project_id"],
            str(aggregate["period_start"]),
            str(aggregate["period_end"]),
        )
        target_aggregate_id = target_by_key.get(key)
        if target_aggregate_id is not None:
            conflicts.append(
                {
                    "source_aggregate_id": aggregate["id"],
                    "target_aggregate_id": target_aggregate_id,
                    "organization_id": aggregate["organization_id"],
                    "project_id": aggregate["project_id"],
                    "period_start": str(aggregate["period_start"]),
                    "period_end": str(aggregate["period_end"]),
                }
            )
            continue
        moved.append(
            {
                "aggregate_id": aggregate["id"],
                "organization_id": aggregate["organization_id"],
                "project_id": aggregate["project_id"],
                "period_start": str(aggregate["period_start"]),
                "period_end": str(aggregate["period_end"]),
                "status": aggregate["status"],
            }
        )
        if not dry_run:
            Aggregate.objects.filter(id=aggregate["id"]).update(indicator_id=target_id)

    ensure_project_assignments(target_id, source_aggregates, dry_run, report)

    source_note = append_description_note(
        source["description"],
        f"Retired after typo cleanup merge into indicator {target_id}.",
    )
    merge_entry = {
        "source_indicator_id": source_id,
        "source_code": source["code"],
        "source_name": source["name"],
        "target_indicator_id": target_id,
        "target_code": target["code"],
        "target_name": get_indicator_row(target_id)["name"] if not dry_run else target["name"],
        "moved_aggregates": moved,
        "conflicts": conflicts,
    }
    report["merged_indicators"].append(merge_entry)

    if not dry_run:
        Indicator.objects.filter(id=source_id).update(
            name=get_indicator_row(target_id)["name"],
            is_active=False,
            description=source_note,
        )


def main():
    parser = argparse.ArgumentParser(description="Rename typo indicators and merge safe typo-generated duplicates.")
    parser.add_argument(
        "--report-path",
        default=str(Path.cwd() / "reports" / "fix-indicator-typos.json"),
        help="Where to write the JSON report.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    report = {
        "dry_run": args.dry_run,
        "renamed_indicators": [],
        "merged_indicators": [],
        "project_assignments_created": [],
        "missing_indicators": [],
        "skipped_groups": [
            {
                "indicator_ids": [331, 445],
                "reason": "Same-period aggregate conflicts exist, so this duplicate pair was not auto-merged.",
            },
            {
                "indicator_ids": [339, 446],
                "reason": "Same-period aggregate conflicts exist, so this duplicate pair was not auto-merged.",
            },
            {
                "indicator_ids": [340, 473],
                "reason": "TEBELOPELE already has same-period legal-aid aggregates on both indicators, so this pair was left for manual review.",
            },
            {
                "indicator_ids": [341, 474],
                "reason": "TEBELOPELE already has same-period justice-service aggregates on both indicators, so this pair was left for manual review.",
            },
        ],
    }

    with transaction.atomic():
        for indicator_id, new_name in RENAME_ONLY.items():
            rename_indicator(indicator_id, new_name, report, args.dry_run)
        for entry in MERGE_PLAN:
            merge_indicator(entry["source"], entry["target"], report, args.dry_run)
        if args.dry_run:
            transaction.set_rollback(True)

    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
