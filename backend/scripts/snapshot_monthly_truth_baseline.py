#!/usr/bin/env python3
"""Export a monthly-workbook baseline snapshot for parity tracking."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

import django  # noqa: E402

django.setup()

from django.core.serializers.json import DjangoJSONEncoder  # noqa: E402

from aggregates.models import Aggregate  # noqa: E402
from indicators.models import Indicator  # noqa: E402
from organizations.models import Organization  # noqa: E402
from projects.models import Project, ProjectIndicator  # noqa: E402


DEFAULT_OUTPUT_ROOT = Path("/home/bonasoadmin/BONASOV1/backend/reports/monthly_truth_snapshots")
DEFAULT_PERIOD_START = date(2025, 7, 1)
DEFAULT_PERIOD_END = date(2026, 3, 31)


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a DB baseline snapshot for workbook parity scope.",
    )
    parser.add_argument("--project-id", type=int, default=2)
    parser.add_argument("--parent-org-id", type=int, default=5)
    parser.add_argument("--period-start", type=parse_date, default=DEFAULT_PERIOD_START)
    parser.add_argument("--period-end", type=parse_date, default=DEFAULT_PERIOD_END)
    parser.add_argument(
        "--out-dir",
        help=(
            "Output directory for snapshot files. "
            "Defaults to backend/reports/monthly_truth_snapshots/<label>_<timestamp>/"
        ),
    )
    parser.add_argument(
        "--manifest-out",
        help="Optional explicit path for manifest JSON (defaults to <out-dir>/manifest.json).",
    )
    parser.add_argument(
        "--label",
        default="monthly_truth",
        help="Folder label when --out-dir is omitted.",
    )
    parser.add_argument(
        "--include-zero-totals",
        action="store_true",
        help="Include aggregate rows with total=0 payloads.",
    )
    return parser.parse_args()


def to_decimal(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return Decimal("0")


def iter_descendants(parent: Organization) -> list[Organization]:
    descendants: list[Organization] = []
    queue = list(parent.children.order_by("id"))
    while queue:
        current = queue.pop(0)
        descendants.append(current)
        queue.extend(list(current.children.order_by("id")))
    return descendants


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, cls=DjangoJSONEncoder, sort_keys=True))
            handle.write("\n")
            count += 1
    return count


def safe_slug(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "").strip())
    return text.strip("-._") or "snapshot"


def main() -> int:
    args = parse_args()

    if args.period_start > args.period_end:
        raise SystemExit("--period-start must be <= --period-end")

    project = Project.objects.filter(id=args.project_id).first()
    if project is None:
        raise SystemExit(f"Project not found: {args.project_id}")

    parent = Organization.objects.filter(id=args.parent_org_id).first()
    if parent is None:
        raise SystemExit(f"Parent organization not found: {args.parent_org_id}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if args.out_dir:
        out_dir = Path(args.out_dir).expanduser()
    else:
        out_dir = DEFAULT_OUTPUT_ROOT / f"{safe_slug(args.label)}_{timestamp}"
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest_out = Path(args.manifest_out).expanduser() if args.manifest_out else (out_dir / "manifest.json")
    manifest_out.parent.mkdir(parents=True, exist_ok=True)

    descendants = iter_descendants(parent)
    scoped_organizations = [parent, *descendants]
    scoped_org_ids = {org.id for org in scoped_organizations}

    aggregates_qs = (
        Aggregate.objects.filter(
            project_id=project.id,
            organization_id__in=scoped_org_ids,
            period_start__gte=args.period_start,
            period_end__lte=args.period_end,
        )
        .select_related("organization", "indicator")
        .order_by("organization_id", "period_start", "period_end", "indicator_id")
    )

    aggregate_rows: list[dict[str, Any]] = []
    aggregate_indicator_ids: set[int] = set()
    for aggregate in aggregates_qs:
        payload = aggregate.value if isinstance(aggregate.value, dict) else {}
        if not args.include_zero_totals and to_decimal(payload.get("total")) == 0:
            continue
        aggregate_indicator_ids.add(aggregate.indicator_id)
        aggregate_rows.append(
            {
                "id": aggregate.id,
                "project_id": aggregate.project_id,
                "organization_id": aggregate.organization_id,
                "organization_name": aggregate.organization.name,
                "indicator_id": aggregate.indicator_id,
                "indicator_code": aggregate.indicator.code,
                "indicator_name": aggregate.indicator.name,
                "period_start": aggregate.period_start,
                "period_end": aggregate.period_end,
                "status": aggregate.status,
                "value": payload,
                "notes": aggregate.notes,
                "reviewed_at": aggregate.reviewed_at,
                "reviewed_by_id": aggregate.reviewed_by_id,
                "created_at": aggregate.created_at,
                "updated_at": aggregate.updated_at,
                "created_by_id": aggregate.created_by_id,
            }
        )

    project_indicator_qs = (
        ProjectIndicator.objects.filter(project_id=project.id)
        .select_related("indicator")
        .order_by("indicator_id")
    )
    project_indicator_rows = []
    project_indicator_ids: set[int] = set()
    for row in project_indicator_qs:
        project_indicator_ids.add(row.indicator_id)
        project_indicator_rows.append(
            {
                "project_id": row.project_id,
                "indicator_id": row.indicator_id,
                "indicator_code": row.indicator.code,
                "indicator_name": row.indicator.name,
                "target_value": row.target_value,
                "current_value": row.current_value,
                "baseline_value": row.baseline_value,
            }
        )

    indicator_ids = sorted(aggregate_indicator_ids | project_indicator_ids)
    indicator_rows = []
    if indicator_ids:
        for indicator in Indicator.objects.filter(id__in=indicator_ids).order_by("id"):
            indicator_rows.append(
                {
                    "id": indicator.id,
                    "code": indicator.code,
                    "name": indicator.name,
                    "description": indicator.description,
                    "type": indicator.type,
                    "category": indicator.category,
                    "unit": indicator.unit,
                    "options": indicator.options,
                    "sub_labels": indicator.sub_labels,
                    "is_active": indicator.is_active,
                    "created_at": indicator.created_at,
                    "updated_at": indicator.updated_at,
                    "created_by_id": indicator.created_by_id,
                }
            )

    through = Project.organizations.through
    project_org_rows = []
    for row in through.objects.filter(project_id=project.id, organization_id__in=scoped_org_ids).order_by(
        "organization_id"
    ):
        project_org_rows.append(
            {
                "project_id": row.project_id,
                "organization_id": row.organization_id,
            }
        )

    organization_rows = []
    for organization in sorted(scoped_organizations, key=lambda item: item.id):
        organization_rows.append(
            {
                "id": organization.id,
                "name": organization.name,
                "code": organization.code,
                "type": organization.type,
                "parent_id": organization.parent_id,
                "is_active": organization.is_active,
            }
        )

    files = {
        "aggregates": out_dir / "aggregates.jsonl",
        "indicators": out_dir / "indicators.jsonl",
        "project_indicators": out_dir / "project_indicators.jsonl",
        "project_organizations": out_dir / "project_organizations.jsonl",
        "organizations": out_dir / "organizations.jsonl",
    }

    counts = {
        "aggregates": write_jsonl(files["aggregates"], aggregate_rows),
        "indicators": write_jsonl(files["indicators"], indicator_rows),
        "project_indicators": write_jsonl(files["project_indicators"], project_indicator_rows),
        "project_organizations": write_jsonl(files["project_organizations"], project_org_rows),
        "organizations": write_jsonl(files["organizations"], organization_rows),
    }

    manifest = {
        "generated_at": datetime.now().isoformat(),
        "project": {"id": project.id, "code": project.code, "name": project.name},
        "parent_org": {"id": parent.id, "name": parent.name},
        "period": {
            "start": args.period_start.isoformat(),
            "end": args.period_end.isoformat(),
        },
        "filters": {"include_zero_totals": args.include_zero_totals},
        "out_dir": str(out_dir.resolve()),
        "counts": counts,
        "files": {name: str(path.resolve()) for name, path in files.items()},
    }

    manifest_out.write_text(json.dumps(manifest, indent=2, cls=DjangoJSONEncoder), encoding="utf-8")
    print(json.dumps(counts, sort_keys=True))
    print(f"SNAPSHOT_MANIFEST={manifest_out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
