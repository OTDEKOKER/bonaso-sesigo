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

from indicators.models import Indicator  # noqa: E402
from organizations.models import Organization  # noqa: E402
from projects.models import Project, ProjectIndicator  # noqa: E402
from users.models import User  # noqa: E402

from import_selected_q3_workbook import (  # noqa: E402
    DEFAULT_PERIOD_END,
    DEFAULT_PERIOD_START,
    DEFAULT_PROJECT_CODE,
    DEFAULT_WORKBOOK,
    canonical_indicator_key,
    clean_title,
    get_indicator_resolution_priority,
    load_workbook,
    normalize_indicator_title,
    parse_sheet,
    resolve_indicator,
    resolve_sheet_organization,
)


SPECIAL_INDICATOR_NAMES = [
    {
        "code": "16",
        "source_title": "Number of people screened for NCDs behavioural risk factors",
        "indicator_name": "Number of people screened for NCDs behavioural risk factors (tobacco use)",
    },
    {
        "code": "19",
        "source_title": "Number of people screened for NCDs behavioural risk factors",
        "indicator_name": "Number of people screened for NCDs behavioural risk factors (alcohol use)",
    },
    {
        "code": "15f",
        "source_title": "Number of individual counselling sessions conducted for youth and vulnerable groups",
        "indicator_name": "Number of individual counselling sessions conducted for youth and vulnerable groups (15f)",
    },
    {
        "code": "15h",
        "source_title": "Number of individual counselling sessions conducted for youth and vulnerable groups",
        "indicator_name": "Number of individual counselling sessions conducted for youth and vulnerable groups (15h)",
    },
]

KEY_POPULATION_VALUES = {
    "general pop",
    "general population",
    "fsw",
    "msm",
    "pwid",
    "pwids",
    "pwud",
    "pwd",
    "lgbtqi+",
    "lgbtqi",
}
MENTAL_HEALTH_SCREENING_VALUES = {
    "suicide",
    "depression",
    "anxiety",
    "substance use disorder",
    "substance use disorders",
    "sleep hygiene",
    "living with a person with mental illness",
    "others",
}
NCD_SCREENING_VALUES = {
    "blood glucose",
    "bp",
    "bmi",
    "waist circumference",
}


def normalize(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def ordered_unique(values):
    ordered = []
    seen = set()
    for value in values:
        key = str(value or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def make_indicator_code(name, existing_codes):
    base = (
        str(name or "")
        .strip()
        .upper()
        .replace("&", "AND")
    )
    base = re.sub(r"[^A-Z0-9]+", "_", base).strip("_")[:34] or "REPORT_INDICATOR"
    candidate = f"AUTO_{base}"[:50]
    suffix = 1

    while normalize(candidate) in existing_codes:
        tail = f"_{suffix}"
        base_limit = max(1, 50 - 5 - len(tail))
        candidate = f"AUTO_{base[:base_limit]}{tail}"
        suffix += 1

    existing_codes.add(normalize(candidate))
    return candidate


def get_special_indicator_name(code, source_title):
    code_token = str(code or "").strip().lower()
    title_key = canonical_indicator_key(source_title)
    for entry in SPECIAL_INDICATOR_NAMES:
        if entry["code"] != code_token:
            continue
        if canonical_indicator_key(entry["source_title"]) != title_key:
            continue
        return entry["indicator_name"]
    return None


def infer_category(title):
    token = normalize(title)
    if "sti" in token:
        return "sti"
    if "gbv" in token:
        return "gbv"
    if any(value in token for value in ("mental health", "counselling", "counseling", "psychosocial", "trauma")):
        return "mental_health"
    if any(value in token for value in ("ncd", "diabetes", "blood glucose", "blood pressure", "bmi", "waist", "alcohol", "tobacco", "cancer")):
        return "ncd"
    if any(value in token for value in ("training", "mentored")):
        return "trainings"
    return "hiv_prevention"


def infer_primary_dimension(title, primary_values):
    normalized_values = {normalize(value) for value in primary_values}

    if normalized_values and normalized_values <= KEY_POPULATION_VALUES:
        return {
            "key": "key_population",
            "label": "Key Population",
            "values": primary_values,
        }
    if normalized_values == {"tobacco use"}:
        return {
            "key": "tobacco_use",
            "label": "Tobacco Use",
            "values": primary_values,
        }
    if normalized_values == {"alcohol use"}:
        return {
            "key": "alcohol_use",
            "label": "Alcohol Use",
            "values": primary_values,
        }
    if normalized_values and normalized_values <= NCD_SCREENING_VALUES:
        return {
            "key": "ncd_screening",
            "label": "NCD Screening",
            "values": primary_values,
        }
    if normalized_values and normalized_values <= MENTAL_HEALTH_SCREENING_VALUES:
        return {
            "key": "mental_health_screening",
            "label": "Mental Health Screening",
            "values": primary_values,
        }

    title_token = normalize(title)
    if "condom" in title_token:
        return {
            "key": "condom_type",
            "label": "Condom Type",
            "values": primary_values,
        }

    return {
        "key": "category",
        "label": "Category",
        "values": primary_values,
    }


def infer_disaggregation(item):
    value = item.get("value") if isinstance(item, dict) else None
    disaggregates = value.get("disaggregates") if isinstance(value, dict) else None
    if not isinstance(disaggregates, dict) or not disaggregates:
        return [], {}

    primary_values = ordered_unique(disaggregates.keys())
    secondary_values = ordered_unique(
        secondary
        for secondary_map in disaggregates.values()
        if isinstance(secondary_map, dict)
        for secondary in secondary_map.keys()
    )
    tertiary_values = ordered_unique(
        band
        for secondary_map in disaggregates.values()
        if isinstance(secondary_map, dict)
        for band_map in secondary_map.values()
        if isinstance(band_map, dict)
        for band in band_map.keys()
    )

    normalized_secondary = {normalize(value) for value in secondary_values}
    if normalized_secondary and normalized_secondary <= {"male", "female"} and tertiary_values:
        primary_dimension = infer_primary_dimension(item.get("title"), primary_values)
        dimensions = [
            primary_dimension,
            {"key": "sex", "label": "Sex", "values": secondary_values},
            {"key": "age_band", "label": "Age Range", "values": tertiary_values},
        ]
        return (
            [primary_dimension["label"], "Sex", "Age Range"],
            {
                "enabled": True,
                "layout": "nested-matrix",
                "dimensions": dimensions,
            },
        )

    return [], {}


def ensure_indicator_metadata(indicator, item, organization, admin_user, dry_run):
    changed_fields = []

    category = infer_category(indicator.name)
    if indicator.category != category:
        indicator.category = category
        changed_fields.append("category")

    if indicator.type != "number":
        indicator.type = "number"
        changed_fields.append("type")

    if indicator.aggregation_method != "sum":
        indicator.aggregation_method = "sum"
        changed_fields.append("aggregation_method")

    if not indicator.is_active:
        indicator.is_active = True
        changed_fields.append("is_active")

    if indicator.created_by_id is None:
        indicator.created_by = admin_user
        changed_fields.append("created_by")

    if not indicator.description:
        indicator.description = (
            f"Auto-created from workbook import for sheet {organization.name} "
            f"(code {item['code']})."
        )
        changed_fields.append("description")

    sub_labels, config = infer_disaggregation(item)
    if sub_labels and list(indicator.sub_labels or []) != sub_labels:
        indicator.sub_labels = sub_labels
        changed_fields.append("sub_labels")

    if config and dict(indicator.aggregate_disaggregation_config or {}) != config:
        indicator.aggregate_disaggregation_config = config
        changed_fields.append("aggregate_disaggregation_config")

    if changed_fields and not dry_run:
        indicator.save(update_fields=changed_fields)

    if not dry_run:
        indicator.organizations.add(organization)

    return changed_fields


def build_args():
    parser = argparse.ArgumentParser(
        description="Create missing indicators for unmatched report workbook rows."
    )
    parser.add_argument("--workbook", default=DEFAULT_WORKBOOK)
    parser.add_argument("--project-code", default=DEFAULT_PROJECT_CODE)
    parser.add_argument("--period-start", default=DEFAULT_PERIOD_START)
    parser.add_argument("--period-end", default=DEFAULT_PERIOD_END)
    parser.add_argument("--sheets", nargs="+", default=None)
    parser.add_argument("--username", default="admin")
    parser.add_argument("--only-codes", nargs="+", default=[])
    parser.add_argument("--report-path", default="")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main():
    args = build_args()
    workbook_path = Path(args.workbook)
    if not workbook_path.exists():
        raise SystemExit(f"Workbook not found: {workbook_path}")

    project = Project.objects.filter(code__iexact=args.project_code).first()
    if project is None:
        raise SystemExit(f"Project not found: {args.project_code}")

    admin_user = User.objects.filter(username__iexact=args.username).first()
    if admin_user is None:
        raise SystemExit(f"User not found: {args.username}")

    workbook = load_workbook(workbook_path, data_only=True)
    organizations = list(Organization.objects.only("id", "name"))
    candidate_sheets = args.sheets or [
        sheet_name
        for sheet_name in workbook.sheetnames
        if resolve_sheet_organization(sheet_name, organizations) is not None
    ]
    selected_sheets = []
    missing_sheets = []
    missing_orgs = []
    for sheet_name in candidate_sheets:
        if sheet_name not in workbook.sheetnames:
            missing_sheets.append(sheet_name)
            continue
        if resolve_sheet_organization(sheet_name, organizations) is None:
            missing_orgs.append(sheet_name)
            continue
        selected_sheets.append(sheet_name)

    if args.sheets and missing_sheets:
        raise SystemExit(f"Sheets not found in workbook: {', '.join(missing_sheets)}")
    if args.sheets and missing_orgs:
        raise SystemExit(f"Organizations not found for sheets: {', '.join(missing_orgs)}")
    if not selected_sheets:
        raise SystemExit("No organization sheets found in workbook.")

    indicators = list(Indicator.objects.all())
    indicator_by_key = {}
    for indicator in indicators:
        key = canonical_indicator_key(indicator.name)
        if not key:
            continue
        existing = indicator_by_key.get(key)
        if existing is None or get_indicator_resolution_priority(indicator) < get_indicator_resolution_priority(existing):
            indicator_by_key[key] = indicator

    existing_codes = {
        normalize(code)
        for code in Indicator.objects.values_list("code", flat=True)
    }

    report = {
        "workbook": str(workbook_path),
        "project": {"id": project.id, "code": project.code, "name": project.name},
        "period_start": args.period_start,
        "period_end": args.period_end,
        "dry_run": args.dry_run,
        "summary": {
            "created_indicators": [],
            "updated_indicators": [],
            "project_assignments_created": [],
            "matched_existing_rows": 0,
            "processed_existing_rows": 0,
            "created_for_rows": [],
        },
    }

    only_codes = {str(code).strip().lower() for code in args.only_codes if str(code).strip()}
    process_existing_matches = bool(only_codes)

    with transaction.atomic():
        for sheet_name in selected_sheets:
            organization = resolve_sheet_organization(sheet_name, organizations)
            if organization is None:
                raise SystemExit(f"Organization not found for sheet: {sheet_name}")
            for item in parse_sheet(workbook[sheet_name]):
                item_code = str(item["code"]).strip().lower()
                if only_codes and item_code not in only_codes:
                    continue

                indicator = resolve_indicator(item["title"], indicator_by_key, code=item["code"])
                if indicator is not None and not process_existing_matches:
                    report["summary"]["matched_existing_rows"] += 1
                    continue

                indicator_name = get_special_indicator_name(item["code"], item["title"]) or normalize_indicator_title(item["title"])
                if indicator is None:
                    indicator = Indicator.objects.filter(name__iexact=indicator_name).first()
                created = False
                if indicator is None:
                    indicator = Indicator(
                        name=indicator_name,
                        code=make_indicator_code(indicator_name, existing_codes),
                        category=infer_category(indicator_name),
                        type="number",
                        aggregation_method="sum",
                        is_active=True,
                        created_by=admin_user,
                        description=(
                            f"Auto-created from {workbook_path.name} | "
                            f"sheet={sheet_name} | code={item['code']} | source title={normalize_indicator_title(item['title'])}"
                        ),
                    )
                    created = True
                    if not args.dry_run:
                        indicator.save()

                changed_fields = ensure_indicator_metadata(
                    indicator,
                    item,
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

                indicator_by_key[canonical_indicator_key(indicator.name)] = indicator

                row_info = {
                    "sheet": sheet_name,
                    "code": item["code"],
                    "source_title": normalize_indicator_title(item["title"]),
                    "indicator_name": indicator.name,
                }
                report["summary"]["created_for_rows"].append(row_info)

                if created:
                    report["summary"]["created_indicators"].append(
                        {
                            "id": indicator.id,
                            "indicator_code": indicator.code,
                            "name": indicator.name,
                            **row_info,
                        }
                    )
                elif changed_fields:
                    report["summary"]["updated_indicators"].append(
                        {
                            "id": indicator.id,
                            "indicator_code": indicator.code,
                            "name": indicator.name,
                            **row_info,
                        }
                    )
                elif indicator is not None:
                    report["summary"]["processed_existing_rows"] += 1

                if assignment_created:
                    report["summary"]["project_assignments_created"].append(
                        {"indicator_id": indicator.id, "indicator_name": indicator.name}
                    )

        if args.dry_run:
            transaction.set_rollback(True)

    report_path = (
        Path(args.report_path)
        if args.report_path
        else Path.cwd() / "reports" / "missing-report-indicators-report.json"
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report["summary"], indent=2))
    print(f"Saved report: {report_path}")


if __name__ == "__main__":
    main()
