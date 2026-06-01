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

from aggregates.models import Aggregate  # noqa: E402
from indicators.models import Indicator  # noqa: E402

from indicator_import_aliases import PREFERRED_DUPLICATE_INDICATOR_IDS_BY_KEY  # noqa: E402


DEFAULT_REPORT_PATH = Path("reports") / "duplicate-indicator-aggregate-state.json"


def build_args():
    parser = argparse.ArgumentParser(
        description="Report where duplicate indicator aggregate data currently lives."
    )
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH))
    return parser.parse_args()


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
    return (not notes) and (not has_non_zero_number(aggregate.value))


def aggregate_key(aggregate):
    return (
        aggregate.organization_id,
        aggregate.project_id,
        str(aggregate.period_start),
        str(aggregate.period_end),
    )


def summarize_indicator(indicator_id):
    indicator = Indicator.objects.only("id", "code", "name", "is_active").get(id=indicator_id)
    queryset = Aggregate.objects.filter(indicator_id=indicator_id).order_by("id")
    aggregates = list(queryset)
    return {
        "id": indicator.id,
        "code": indicator.code,
        "name": indicator.name,
        "is_active": indicator.is_active,
        "aggregate_rows": len(aggregates),
        "disaggregate_rows": sum(
            1 for aggregate in aggregates if "disaggregates" in str(aggregate.value or "")
        ),
        "placeholder_rows": sum(1 for aggregate in aggregates if is_placeholder_aggregate(aggregate)),
        "non_zero_rows": sum(1 for aggregate in aggregates if has_non_zero_number(aggregate.value)),
    }, aggregates


def build_pair_report(indicator_key, preferred_id, duplicate_id):
    preferred_summary, preferred_aggregates = summarize_indicator(preferred_id)
    duplicate_summary, duplicate_aggregates = summarize_indicator(duplicate_id)

    preferred_by_key = {aggregate_key(aggregate): aggregate for aggregate in preferred_aggregates}
    duplicate_by_key = {aggregate_key(aggregate): aggregate for aggregate in duplicate_aggregates}

    conflicting_periods = []
    placeholder_replacements = []
    duplicate_only_periods = []
    preferred_only_periods = []

    all_keys = sorted(set(preferred_by_key) | set(duplicate_by_key))
    for key in all_keys:
        preferred_aggregate = preferred_by_key.get(key)
        duplicate_aggregate = duplicate_by_key.get(key)
        if preferred_aggregate and duplicate_aggregate:
            if is_placeholder_aggregate(preferred_aggregate):
                placeholder_replacements.append(
                    {
                        "organization_id": key[0],
                        "project_id": key[1],
                        "period_start": key[2],
                        "period_end": key[3],
                        "preferred_aggregate_id": preferred_aggregate.id,
                        "duplicate_aggregate_id": duplicate_aggregate.id,
                    }
                )
            else:
                conflicting_periods.append(
                    {
                        "organization_id": key[0],
                        "project_id": key[1],
                        "period_start": key[2],
                        "period_end": key[3],
                        "preferred_aggregate_id": preferred_aggregate.id,
                        "duplicate_aggregate_id": duplicate_aggregate.id,
                    }
                )
        elif duplicate_aggregate:
            duplicate_only_periods.append(
                {
                    "organization_id": key[0],
                    "project_id": key[1],
                    "period_start": key[2],
                    "period_end": key[3],
                    "aggregate_id": duplicate_aggregate.id,
                }
            )
        elif preferred_aggregate:
            preferred_only_periods.append(
                {
                    "organization_id": key[0],
                    "project_id": key[1],
                    "period_start": key[2],
                    "period_end": key[3],
                    "aggregate_id": preferred_aggregate.id,
                }
            )

    return {
        "indicator_key": indicator_key,
        "preferred_indicator": preferred_summary,
        "duplicate_indicator": duplicate_summary,
        "duplicate_only_periods": duplicate_only_periods,
        "preferred_only_periods": preferred_only_periods,
        "placeholder_replacements": placeholder_replacements,
        "conflicting_periods": conflicting_periods,
    }


def main():
    args = build_args()

    pair_reports = []
    for indicator_key, indicator_ids in sorted(PREFERRED_DUPLICATE_INDICATOR_IDS_BY_KEY.items()):
        preferred_id, *duplicate_ids = indicator_ids
        for duplicate_id in duplicate_ids:
            pair_reports.append(build_pair_report(indicator_key, preferred_id, duplicate_id))

    report = {
        "pair_count": len(pair_reports),
        "pairs": pair_reports,
        "summary": {
            "pairs_with_duplicate_data": sum(
                1 for pair in pair_reports if pair["duplicate_indicator"]["aggregate_rows"] > 0
            ),
            "pairs_with_conflicts": sum(
                1 for pair in pair_reports if pair["conflicting_periods"]
            ),
            "pairs_with_placeholder_replacements": sum(
                1 for pair in pair_reports if pair["placeholder_replacements"]
            ),
        },
    }

    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
