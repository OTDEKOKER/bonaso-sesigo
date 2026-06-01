import argparse
import json
from pathlib import Path

from import_selected_q3_workbook import (  # noqa: E402
    Aggregate,
    DEFAULT_PERIOD_END,
    DEFAULT_PERIOD_START,
    DEFAULT_PROJECT_CODE,
    DEFAULT_WORKBOOK,
    Indicator,
    IndicatorAlias,
    Organization,
    Project,
    canonical_indicator_key,
    canonical_resolution_aliases,
    get_indicator_resolution_priority,
    load_workbook,
    parse_sheet,
    resolve_sheet_organization,
    resolve_indicator,
)


def to_number(value):
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def flatten_disaggregates(source):
    flattened = {}
    if not isinstance(source, dict):
        return flattened

    for primary, secondary_map in source.items():
        if not isinstance(secondary_map, dict):
            continue
        for secondary, band_map in secondary_map.items():
            if not isinstance(band_map, dict):
                continue
            for band, value in band_map.items():
                flattened[(str(primary), str(secondary), str(band))] = to_number(value)
    return flattened


def compare_values(expected, actual):
    differences = []

    for field in ("total", "male", "female"):
        left = to_number(expected.get(field))
        right = to_number(actual.get(field))
        if abs(left - right) > 1e-9:
            differences.append(
                {
                    "type": "summary",
                    "field": field,
                    "expected": left,
                    "actual": right,
                }
            )

    expected_disaggregates = flatten_disaggregates(expected.get("disaggregates"))
    actual_disaggregates = flatten_disaggregates(actual.get("disaggregates"))
    keys = sorted(set(expected_disaggregates) | set(actual_disaggregates))
    for key in keys:
        left = expected_disaggregates.get(key, 0.0)
        right = actual_disaggregates.get(key, 0.0)
        if abs(left - right) > 1e-9:
            differences.append(
                {
                    "type": "disaggregate",
                    "primary": key[0],
                    "secondary": key[1],
                    "band": key[2],
                    "expected": left,
                    "actual": right,
                }
            )

    return differences


def build_args():
    parser = argparse.ArgumentParser(description="Review imported workbook data against saved aggregates.")
    parser.add_argument("--workbook", default=DEFAULT_WORKBOOK)
    parser.add_argument("--project-code", default=DEFAULT_PROJECT_CODE)
    parser.add_argument("--period-start", default=DEFAULT_PERIOD_START)
    parser.add_argument("--period-end", default=DEFAULT_PERIOD_END)
    parser.add_argument("--sheets", nargs="+", default=None)
    parser.add_argument("--report-path", default="")
    return parser.parse_args()


def main():
    args = build_args()

    workbook = load_workbook(Path(args.workbook), data_only=True)
    project = Project.objects.only("id", "code", "name").filter(code__iexact=args.project_code).first()
    if not project:
        raise SystemExit(f"Project not found: {args.project_code}")

    organizations = list(Organization.objects.only("id", "name"))
    candidate_sheets = args.sheets or [
        sheet_name
        for sheet_name in workbook.sheetnames
        if resolve_sheet_organization(sheet_name, organizations) is not None
    ]
    selected_sheets = []
    missing_sheets = []
    for sheet_name in candidate_sheets:
        if sheet_name in workbook.sheetnames:
            selected_sheets.append(sheet_name)
        else:
            missing_sheets.append(sheet_name)

    if args.sheets and missing_sheets:
        raise SystemExit(f"Sheets not found in workbook: {', '.join(missing_sheets)}")

    indicators = list(Indicator.objects.only("id", "name", "code", "is_active"))
    indicator_by_key = {}
    for indicator in indicators:
        for candidate in [indicator.name, *canonical_resolution_aliases(indicator.name)]:
            key = canonical_indicator_key(candidate)
            if not key:
                continue
            existing = indicator_by_key.get(key)
            if existing is None or get_indicator_resolution_priority(indicator) < get_indicator_resolution_priority(existing):
                indicator_by_key[key] = indicator
    for alias in IndicatorAlias.objects.select_related("indicator").filter(is_active=True):
        indicator = alias.indicator
        for candidate in [alias.name, *canonical_resolution_aliases(alias.name)]:
            key = canonical_indicator_key(candidate)
            if not key:
                continue
            existing = indicator_by_key.get(key)
            if existing is None or get_indicator_resolution_priority(indicator) < get_indicator_resolution_priority(existing):
                indicator_by_key[key] = indicator

    report = {
        "workbook": str(args.workbook),
        "project": {"id": project.id, "code": project.code, "name": project.name},
        "period_start": args.period_start,
        "period_end": args.period_end,
        "summary": {},
        "findings": [],
        "sheets": {},
    }

    matched = 0
    exact_matches = 0
    missing_aggregates = 0
    unmatched_indicators = 0
    mismatched_rows = 0

    for sheet_name in selected_sheets:
        sheet_items = parse_sheet(workbook[sheet_name])
        organization = resolve_sheet_organization(sheet_name, organizations)
        if not organization:
            report["findings"].append(
                {
                    "severity": "high",
                    "sheet": sheet_name,
                    "issue": "Organization missing",
                    "detail": f"No organization record found for sheet {sheet_name}.",
                }
            )
            continue

        sheet_report = {
            "organization_id": organization.id,
            "parsed_rows": len(sheet_items),
            "matched_rows": 0,
            "exact_matches": 0,
            "missing_aggregates": [],
            "unmatched_indicators": [],
            "mismatches": [],
        }

        for item in sheet_items:
            indicator = resolve_indicator(item["title"], indicator_by_key, code=item["code"])
            if indicator is None:
                unmatched_indicators += 1
                sheet_report["unmatched_indicators"].append(item["title"])
                continue

            matched += 1
            sheet_report["matched_rows"] += 1

            aggregate = Aggregate.objects.only("id", "value").filter(
                indicator=indicator,
                project=project,
                organization=organization,
                period_start=args.period_start,
                period_end=args.period_end,
            ).first()

            if aggregate is None:
                missing_aggregates += 1
                sheet_report["missing_aggregates"].append(
                    {
                        "indicator_id": indicator.id,
                        "indicator_name": indicator.name,
                        "workbook_title": item["title"],
                    }
                )
                continue

            differences = compare_values(item["value"], aggregate.value if isinstance(aggregate.value, dict) else {})
            if differences:
                mismatched_rows += 1
                sheet_report["mismatches"].append(
                    {
                        "indicator_id": indicator.id,
                        "indicator_name": indicator.name,
                        "workbook_title": item["title"],
                        "difference_count": len(differences),
                        "differences_preview": differences[:10],
                    }
                )
                continue

            exact_matches += 1
            sheet_report["exact_matches"] += 1

        report["sheets"][sheet_name] = sheet_report

    if unmatched_indicators:
        report["findings"].append(
            {
                "severity": "medium",
                "issue": "Workbook indicators skipped",
                "detail": f"{unmatched_indicators} workbook rows could not be matched to existing indicators and therefore cannot match the system.",
            }
        )
    if missing_aggregates:
        report["findings"].append(
            {
                "severity": "high",
                "issue": "Missing saved aggregates",
                "detail": f"{missing_aggregates} matched workbook rows have no saved aggregate for the selected project/org/period.",
            }
        )
    if mismatched_rows:
        report["findings"].append(
            {
                "severity": "high",
                "issue": "Workbook/data mismatches",
                "detail": f"{mismatched_rows} matched workbook rows differ from the saved aggregate values.",
            }
        )

    report["summary"] = {
        "matched_rows": matched,
        "exact_matches": exact_matches,
        "unmatched_indicator_rows": unmatched_indicators,
        "missing_aggregate_rows": missing_aggregates,
        "mismatched_rows": mismatched_rows,
    }

    report_path = (
        Path(args.report_path)
        if args.report_path
        else Path.cwd() / "reports" / "selected-q3-workbook-review.json"
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report["summary"], indent=2))
    print(f"Saved report: {report_path}")


if __name__ == "__main__":
    main()
