import argparse
import json
import numbers
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
from indicator_import_aliases import PREFERRED_DUPLICATE_INDICATOR_IDS_BY_KEY  # noqa: E402
from indicators.models import Indicator  # noqa: E402
from projects.models import ProjectIndicator  # noqa: E402


DEFAULT_REPORT_PATH = Path("reports") / "move-duplicate-indicator-aggregates.json"


def build_args():
    parser = argparse.ArgumentParser(
        description="Move aggregate rows from duplicate indicators to canonical indicators."
    )
    parser.add_argument("--apply", action="store_true", help="Apply changes. Default is dry run.")
    parser.add_argument(
        "--retire-sources",
        action="store_true",
        help="Mark duplicate source indicators inactive after a successful move.",
    )
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH))
    return parser.parse_args()


def aggregate_key(aggregate):
    return (
        aggregate.organization_id,
        aggregate.project_id,
        str(aggregate.period_start),
        str(aggregate.period_end),
    )


def append_note(description, note):
    text = str(description or "").strip()
    if note in text:
        return text
    return f"{text}\n{note}".strip()


def summarize_indicator(indicator_id):
    indicator = Indicator.objects.only("id", "code", "name", "is_active", "description").get(id=indicator_id)
    aggregates = list(Aggregate.objects.filter(indicator_id=indicator_id).order_by("id"))
    return indicator, aggregates


def ensure_project_assignments(preferred_id, project_ids, report, apply_changes):
    created = []
    for project_id in sorted(project_ids):
        exists = ProjectIndicator.objects.filter(project_id=project_id, indicator_id=preferred_id).exists()
        if exists:
            continue
        created.append({"project_id": project_id, "indicator_id": preferred_id})
        if apply_changes:
            ProjectIndicator.objects.create(project_id=project_id, indicator_id=preferred_id)
    report.extend(created)


STATUS_PRIORITY = {
    "approved": 60,
    "reviewed": 50,
    "pending": 40,
    "flagged": 30,
    "draft": 20,
    "rejected": 10,
}


def _is_numeric(value):
    return isinstance(value, numbers.Number) and not isinstance(value, bool)


def _to_number(value):
    if _is_numeric(value):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def merge_json_values(target_value, source_value):
    if target_value is None:
        return source_value
    if source_value is None:
        return target_value

    target_number = _to_number(target_value)
    source_number = _to_number(source_value)
    if target_number is not None and source_number is not None:
        total = target_number + source_number
        return int(total) if float(total).is_integer() else total

    if isinstance(target_value, dict) and isinstance(source_value, dict):
        merged = {}
        for key in sorted(set(target_value.keys()) | set(source_value.keys())):
            merged[key] = merge_json_values(target_value.get(key), source_value.get(key))
        return merged

    if isinstance(target_value, list) and isinstance(source_value, list):
        merged = list(target_value)
        for item in source_value:
            if item not in merged:
                merged.append(item)
        return merged

    if target_value == source_value:
        return target_value

    return {
        "target_value": target_value,
        "source_value": source_value,
    }


def merge_notes(target_notes, source_notes, source_aggregate_id, duplicate_indicator_id):
    target_text = str(target_notes or "").strip()
    source_text = str(source_notes or "").strip()
    merge_note = (
        f"Merged data from aggregate {source_aggregate_id} "
        f"(duplicate indicator {duplicate_indicator_id})."
    )
    if source_text:
        merge_note = f"{merge_note} Source notes: {source_text}"
    if not target_text:
        return merge_note
    if merge_note in target_text:
        return target_text
    return f"{target_text}\n{merge_note}".strip()


def pick_stronger_status(current_status, incoming_status):
    current_rank = STATUS_PRIORITY.get(str(current_status or "").strip().lower(), 0)
    incoming_rank = STATUS_PRIORITY.get(str(incoming_status or "").strip().lower(), 0)
    return incoming_status if incoming_rank > current_rank else current_status


def build_pair_report(indicator_key, preferred_id, duplicate_id):
    preferred, preferred_aggregates = summarize_indicator(preferred_id)
    duplicate, duplicate_aggregates = summarize_indicator(duplicate_id)

    preferred_by_key = {aggregate_key(aggregate): aggregate for aggregate in preferred_aggregates}
    duplicate_by_key = {aggregate_key(aggregate): aggregate for aggregate in duplicate_aggregates}

    conflicting_keys = []
    movable_aggregate_ids = []
    movable_project_ids = set()

    for key, duplicate_aggregate in duplicate_by_key.items():
        preferred_aggregate = preferred_by_key.get(key)
        if preferred_aggregate is not None:
            conflicting_keys.append(
                {
                    "organization_id": key[0],
                    "project_id": key[1],
                    "period_start": key[2],
                    "period_end": key[3],
                    "preferred_aggregate_id": preferred_aggregate.id,
                    "duplicate_aggregate_id": duplicate_aggregate.id,
                }
            )
            continue
        movable_aggregate_ids.append(duplicate_aggregate.id)
        movable_project_ids.add(duplicate_aggregate.project_id)

    return {
        "indicator_key": indicator_key,
        "preferred_indicator": {
            "id": preferred.id,
            "code": preferred.code,
            "name": preferred.name,
            "is_active": preferred.is_active,
            "aggregate_rows": len(preferred_aggregates),
        },
        "duplicate_indicator": {
            "id": duplicate.id,
            "code": duplicate.code,
            "name": duplicate.name,
            "is_active": duplicate.is_active,
            "aggregate_rows": len(duplicate_aggregates),
        },
        "movable_aggregate_ids": movable_aggregate_ids,
        "movable_project_ids": sorted(movable_project_ids),
        "conflicts": conflicting_keys,
    }


def main():
    args = build_args()
    apply_changes = args.apply

    pair_reports = []
    created_project_assignments = []
    moved_aggregates = []
    merged_aggregates = []
    retired_sources = []
    reactivated_targets = []

    for indicator_key, indicator_ids in sorted(PREFERRED_DUPLICATE_INDICATOR_IDS_BY_KEY.items()):
        preferred_id, *duplicate_ids = indicator_ids
        for duplicate_id in duplicate_ids:
            pair_reports.append(build_pair_report(indicator_key, preferred_id, duplicate_id))

    report = {
        "dry_run": not apply_changes,
        "retire_sources": args.retire_sources,
        "pairs": pair_reports,
        "created_project_assignments": created_project_assignments,
        "moved_aggregates": moved_aggregates,
        "merged_aggregates": merged_aggregates,
        "retired_sources": retired_sources,
        "reactivated_targets": reactivated_targets,
        "summary": {
            "pairs": len(pair_reports),
            "pairs_with_conflicts": sum(1 for pair in pair_reports if pair["conflicts"]),
            "pairs_ready_to_move": sum(
                1 for pair in pair_reports if pair["movable_aggregate_ids"] and not pair["conflicts"]
            ),
        },
    }

    if apply_changes:
        with transaction.atomic():
            for pair in pair_reports:
                preferred_id = pair["preferred_indicator"]["id"]
                duplicate_id = pair["duplicate_indicator"]["id"]
                source_aggregates = list(
                    Aggregate.objects.filter(indicator_id=duplicate_id).order_by("id")
                )
                source_project_ids = sorted({aggregate.project_id for aggregate in source_aggregates})
                target_by_key = {
                    aggregate_key(aggregate): aggregate
                    for aggregate in Aggregate.objects.filter(indicator_id=preferred_id).order_by("id")
                }

                if source_aggregates and not pair["preferred_indicator"]["is_active"]:
                    target = Indicator.objects.get(id=preferred_id)
                    target.is_active = True
                    target.save(update_fields=["is_active"])
                    reactivated_targets.append(
                        {
                            "indicator_id": preferred_id,
                            "code": target.code,
                            "name": target.name,
                        }
                    )
                    pair["preferred_indicator"]["is_active"] = True

                ensure_project_assignments(
                    preferred_id,
                    source_project_ids,
                    created_project_assignments,
                    apply_changes=True,
                )

                for source_aggregate in source_aggregates:
                    key = aggregate_key(source_aggregate)
                    target_aggregate = target_by_key.get(key)

                    if target_aggregate is not None and target_aggregate.id != source_aggregate.id:
                        target_aggregate.value = merge_json_values(
                            target_aggregate.value,
                            source_aggregate.value,
                        )
                        target_aggregate.status = pick_stronger_status(
                            target_aggregate.status,
                            source_aggregate.status,
                        )
                        target_aggregate.notes = merge_notes(
                            target_aggregate.notes,
                            source_aggregate.notes,
                            source_aggregate.id,
                            duplicate_id,
                        )
                        target_aggregate.save(update_fields=["value", "status", "notes"])
                        merged_aggregates.append(
                            {
                                "target_aggregate_id": target_aggregate.id,
                                "source_aggregate_id": source_aggregate.id,
                                "from_indicator_id": duplicate_id,
                                "to_indicator_id": preferred_id,
                            }
                        )
                        source_aggregate.delete()
                        continue

                    source_aggregate.indicator_id = preferred_id
                    source_aggregate.save(update_fields=["indicator"])
                    target_by_key[key] = source_aggregate
                    moved_aggregates.append(
                        {
                            "aggregate_id": source_aggregate.id,
                            "from_indicator_id": duplicate_id,
                            "to_indicator_id": preferred_id,
                        }
                    )

                if args.retire_sources and not Aggregate.objects.filter(indicator_id=duplicate_id).exists():
                    source = Indicator.objects.get(id=duplicate_id)
                    source.is_active = False
                    source.description = append_note(
                        source.description,
                        f"Alias duplicate retained for import compatibility; aggregate data moved to indicator {preferred_id}.",
                    )
                    source.save(update_fields=["is_active", "description"])
                    retired_sources.append(
                        {
                            "indicator_id": duplicate_id,
                            "canonical_indicator_id": preferred_id,
                        }
                    )

    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
