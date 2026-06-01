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

from django.db import connection, transaction  # noqa: E402

from indicator_import_aliases import PREFERRED_DUPLICATE_INDICATOR_IDS_BY_KEY  # noqa: E402


NUMERIC_COLUMNS = [
    "q1_target",
    "q2_target",
    "q3_target",
    "q4_target",
    "target_value",
    "current_value",
    "baseline_value",
]


DEFAULT_REPORT_PATH = Path("reports") / "merge-duplicate-indicator-targets.json"


def build_args():
    parser = argparse.ArgumentParser(
        description="Merge duplicate project target rows into canonical indicator IDs."
    )
    parser.add_argument("--apply", action="store_true", help="Apply changes. Default is dry run.")
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH))
    return parser.parse_args()


def fetchone_dict(cursor):
    row = cursor.fetchone()
    if row is None:
        return None
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row))


def fetchall_dict(cursor):
    rows = cursor.fetchall()
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


def get_or_create_project_indicator(cursor, project_id, indicator_id, created_rows):
    cursor.execute(
        """
        SELECT id
        FROM projects_projectindicator
        WHERE project_id = %s AND indicator_id = %s
        """,
        [project_id, indicator_id],
    )
    row = fetchone_dict(cursor)
    if row:
        return int(row["id"])

    cursor.execute(
        """
        INSERT INTO projects_projectindicator (
            target_value,
            current_value,
            baseline_value,
            indicator_id,
            project_id,
            q1_target,
            q2_target,
            q3_target,
            q4_target
        )
        VALUES (0, 0, 0, %s, %s, 0, 0, 0, 0)
        RETURNING id
        """,
        [indicator_id, project_id],
    )
    inserted = fetchone_dict(cursor)
    project_indicator_id = int(inserted["id"])
    created_rows.append(
        {
            "project_id": int(project_id),
            "indicator_id": int(indicator_id),
            "project_indicator_id": project_indicator_id,
        }
    )
    return project_indicator_id


def sum_add_clause():
    return ", ".join([f"{column} = COALESCE({column}, 0) + COALESCE(%s, 0)" for column in NUMERIC_COLUMNS])


def merge_pair(cursor, canonical_id, duplicate_id, report):
    cursor.execute(
        """
        SELECT id, project_id
        FROM projects_projectindicator
        WHERE indicator_id = %s
        ORDER BY id
        """,
        [duplicate_id],
    )
    duplicate_project_indicators = fetchall_dict(cursor)
    if not duplicate_project_indicators:
        return

    pair_report = {
        "canonical_indicator_id": int(canonical_id),
        "duplicate_indicator_id": int(duplicate_id),
        "created_canonical_project_indicators": [],
        "merged_project_indicators": [],
        "moved_org_targets": [],
        "merged_org_targets": [],
        "deleted_duplicate_project_indicators": [],
        "remaining_duplicate_project_indicators": [],
    }

    for duplicate_pi in duplicate_project_indicators:
        duplicate_pi_id = int(duplicate_pi["id"])
        project_id = int(duplicate_pi["project_id"])

        canonical_pi_id = get_or_create_project_indicator(
            cursor,
            project_id,
            canonical_id,
            pair_report["created_canonical_project_indicators"],
        )

        cursor.execute(
            """
            SELECT {columns}
            FROM projects_projectindicator
            WHERE id = %s
            """.format(columns=", ".join(NUMERIC_COLUMNS)),
            [duplicate_pi_id],
        )
        duplicate_totals = fetchone_dict(cursor) or {}
        duplicate_values = [duplicate_totals.get(column, 0) for column in NUMERIC_COLUMNS]
        cursor.execute(
            f"""
            UPDATE projects_projectindicator
            SET {sum_add_clause()}
            WHERE id = %s
            """,
            [*duplicate_values, canonical_pi_id],
        )
        pair_report["merged_project_indicators"].append(
            {
                "project_id": project_id,
                "canonical_project_indicator_id": canonical_pi_id,
                "duplicate_project_indicator_id": duplicate_pi_id,
            }
        )

        cursor.execute(
            """
            SELECT id, organization_id, {columns}
            FROM projects_projectindicatororganizationtarget
            WHERE project_indicator_id = %s
            ORDER BY id
            """.format(columns=", ".join(NUMERIC_COLUMNS)),
            [duplicate_pi_id],
        )
        duplicate_org_rows = fetchall_dict(cursor)

        for duplicate_org_row in duplicate_org_rows:
            duplicate_org_target_id = int(duplicate_org_row["id"])
            organization_id = int(duplicate_org_row["organization_id"])
            duplicate_org_values = [duplicate_org_row.get(column, 0) for column in NUMERIC_COLUMNS]

            cursor.execute(
                """
                SELECT id
                FROM projects_projectindicatororganizationtarget
                WHERE project_indicator_id = %s AND organization_id = %s
                """,
                [canonical_pi_id, organization_id],
            )
            canonical_org_row = fetchone_dict(cursor)

            if canonical_org_row:
                canonical_org_target_id = int(canonical_org_row["id"])
                cursor.execute(
                    f"""
                    UPDATE projects_projectindicatororganizationtarget
                    SET {sum_add_clause()}
                    WHERE id = %s
                    """,
                    [*duplicate_org_values, canonical_org_target_id],
                )
                cursor.execute(
                    """
                    DELETE FROM projects_projectindicatororganizationtarget
                    WHERE id = %s
                    """,
                    [duplicate_org_target_id],
                )
                pair_report["merged_org_targets"].append(
                    {
                        "project_id": project_id,
                        "organization_id": organization_id,
                        "canonical_project_indicator_id": canonical_pi_id,
                        "duplicate_project_indicator_id": duplicate_pi_id,
                        "canonical_org_target_id": canonical_org_target_id,
                        "duplicate_org_target_id": duplicate_org_target_id,
                    }
                )
                continue

            cursor.execute(
                """
                UPDATE projects_projectindicatororganizationtarget
                SET project_indicator_id = %s
                WHERE id = %s
                """,
                [canonical_pi_id, duplicate_org_target_id],
            )
            pair_report["moved_org_targets"].append(
                {
                    "project_id": project_id,
                    "organization_id": organization_id,
                    "canonical_project_indicator_id": canonical_pi_id,
                    "duplicate_project_indicator_id": duplicate_pi_id,
                    "org_target_id": duplicate_org_target_id,
                }
            )

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM projects_projectindicatororganizationtarget
            WHERE project_indicator_id = %s
            """,
            [canonical_pi_id],
        )
        org_count = int(cursor.fetchone()[0])
        if org_count > 0:
            cursor.execute(
                """
                SELECT
                    COALESCE(SUM(q1_target), 0),
                    COALESCE(SUM(q2_target), 0),
                    COALESCE(SUM(q3_target), 0),
                    COALESCE(SUM(q4_target), 0),
                    COALESCE(SUM(target_value), 0),
                    COALESCE(SUM(current_value), 0),
                    COALESCE(SUM(baseline_value), 0)
                FROM projects_projectindicatororganizationtarget
                WHERE project_indicator_id = %s
                """,
                [canonical_pi_id],
            )
            sums = list(cursor.fetchone())
            cursor.execute(
                """
                UPDATE projects_projectindicator
                SET
                    q1_target = %s,
                    q2_target = %s,
                    q3_target = %s,
                    q4_target = %s,
                    target_value = %s,
                    current_value = %s,
                    baseline_value = %s
                WHERE id = %s
                """,
                [*sums, canonical_pi_id],
            )

        cursor.execute(
            """
            SELECT COUNT(*)
            FROM projects_projectindicatororganizationtarget
            WHERE project_indicator_id = %s
            """,
            [duplicate_pi_id],
        )
        duplicate_remaining_org_rows = int(cursor.fetchone()[0])
        if duplicate_remaining_org_rows == 0:
            cursor.execute(
                """
                DELETE FROM projects_projectindicator
                WHERE id = %s
                """,
                [duplicate_pi_id],
            )
            pair_report["deleted_duplicate_project_indicators"].append(
                {
                    "project_id": project_id,
                    "duplicate_project_indicator_id": duplicate_pi_id,
                }
            )
        else:
            pair_report["remaining_duplicate_project_indicators"].append(
                {
                    "project_id": project_id,
                    "duplicate_project_indicator_id": duplicate_pi_id,
                    "remaining_org_target_rows": duplicate_remaining_org_rows,
                }
            )

    report["pairs"].append(pair_report)


def main():
    args = build_args()
    apply_changes = args.apply

    report = {
        "dry_run": not apply_changes,
        "pairs": [],
        "summary": {
            "pairs_processed": 0,
            "created_canonical_project_indicators": 0,
            "merged_project_indicators": 0,
            "moved_org_targets": 0,
            "merged_org_targets": 0,
            "deleted_duplicate_project_indicators": 0,
            "remaining_duplicate_project_indicators": 0,
        },
    }

    with transaction.atomic():
        with connection.cursor() as cursor:
            for indicator_ids in PREFERRED_DUPLICATE_INDICATOR_IDS_BY_KEY.values():
                canonical_id, *duplicate_ids = indicator_ids
                for duplicate_id in duplicate_ids:
                    merge_pair(cursor, int(canonical_id), int(duplicate_id), report)

        report["summary"]["pairs_processed"] = len(report["pairs"])
        for pair in report["pairs"]:
            report["summary"]["created_canonical_project_indicators"] += len(
                pair["created_canonical_project_indicators"]
            )
            report["summary"]["merged_project_indicators"] += len(pair["merged_project_indicators"])
            report["summary"]["moved_org_targets"] += len(pair["moved_org_targets"])
            report["summary"]["merged_org_targets"] += len(pair["merged_org_targets"])
            report["summary"]["deleted_duplicate_project_indicators"] += len(
                pair["deleted_duplicate_project_indicators"]
            )
            report["summary"]["remaining_duplicate_project_indicators"] += len(
                pair["remaining_duplicate_project_indicators"]
            )

        if not apply_changes:
            transaction.set_rollback(True)

    report_path = Path(args.report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
