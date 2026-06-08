"""Canonicalize duplicate indicators (DI-1).

Clusters indicators by normalized name and links each duplicate to a single
canonical row (``canonical_indicator`` + ``is_deprecated=True``). Historical
aggregates are NEVER moved or deleted — analytics rolls them up to the canonical
indicator via ``indicators.canonical.canonical_id_map``.

Safe by default: runs as a DRY-RUN unless ``--apply`` is given. Idempotent: a
second run makes no further changes. Reversible with ``--undo``.

Examples
--------
    # Preview the plan and write a markdown report
    python manage.py canonicalize_indicators --report INDICATOR_CANONICALIZATION_REPORT.md

    # Apply the links inside a transaction
    python manage.py canonicalize_indicators --apply

    # Undo (clear all canonical links / deprecation we set)
    python manage.py canonicalize_indicators --undo --apply
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count, Sum

from aggregates.models import Aggregate
from indicators.canonical import plan_canonicalization
from indicators.models import Indicator


def _approved_total_for(indicator_ids):
    """Sum the JSONB ``value->total`` for approved aggregates on these ids."""
    total = 0.0
    rows = (
        Aggregate.objects.filter(indicator_id__in=indicator_ids, status="approved")
        .values_list("value", flat=True)
    )
    for value in rows:
        if isinstance(value, dict) and value.get("total") is not None:
            try:
                total += float(value.get("total") or 0)
            except (TypeError, ValueError):
                continue
        elif isinstance(value, (int, float)):
            total += float(value)
    return total


class Command(BaseCommand):
    help = "Link duplicate indicators to a single canonical indicator (DI-1)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="Persist changes. Without this the command is a dry run.")
        parser.add_argument("--undo", action="store_true",
                            help="Clear canonical_indicator links and deprecation flags we set.")
        parser.add_argument("--report", metavar="PATH",
                            help="Write a markdown canonicalization report to PATH.")

    def handle(self, *args, **options):
        if options["undo"]:
            return self._handle_undo(options)

        plan = plan_canonicalization()
        lines = []

        def out(msg=""):
            lines.append(msg)
            self.stdout.write(msg)

        active_total = Indicator.objects.filter(is_deprecated=False).count()
        out(f"# Indicator Canonicalization Report")
        out("")
        out(f"- Indicators total: {Indicator.objects.count()}")
        out(f"- Active (pre-run): {active_total}")
        out(f"- Duplicate clusters found: {len(plan)}")
        dupes = sum(len(item['duplicates']) for item in plan)
        out(f"- Rows that will be deprecated: {dupes}")
        out("")

        grand_before = grand_after = 0.0
        for item in plan:
            canonical = item["canonical"]
            duplicates = item["duplicates"]
            all_ids = [canonical.id] + [d.id for d in duplicates]
            before = _approved_total_for([canonical.id])
            cluster_total = _approved_total_for(all_ids)
            grand_before += before
            grand_after += cluster_total
            out(f"## {canonical.name}")
            out(f"- Canonical: `{canonical.code}` (id {canonical.id}) — "
                f"{item['canonical_aggregates']} aggregates")
            for d in duplicates:
                out(f"- Deprecate: `{d.code}` (id {d.id}) -> canonical id {canonical.id}")
            out(f"- Approved total on canonical BEFORE rollup: {before:g}")
            out(f"- Approved total for whole cluster (AFTER canonical rollup): {cluster_total:g}")
            out("")

        out("## Reconciliation")
        out(f"- Sum of canonical-only totals BEFORE: {grand_before:g}")
        out(f"- Sum of canonical-rollup totals AFTER: {grand_after:g}")
        out(f"- Data recovered into canonical rollups: {grand_after - grand_before:g}")
        out("")
        out("> No aggregates are moved or deleted; analytics rolls duplicates up "
            "to the canonical indicator. Totals AFTER include data previously "
            "stranded on the deprecated duplicate rows.")

        if options["apply"]:
            with transaction.atomic():
                changed = 0
                for item in plan:
                    canonical = item["canonical"]
                    for d in item["duplicates"]:
                        if d.canonical_indicator_id != canonical.id or not d.is_deprecated:
                            d.canonical_indicator_id = canonical.id
                            d.is_deprecated = True
                            d.save(update_fields=["canonical_indicator", "is_deprecated", "updated_at"])
                            changed += 1
                    # Ensure the canonical row itself is not flagged deprecated.
                    if canonical.is_deprecated or canonical.canonical_indicator_id:
                        canonical.is_deprecated = False
                        canonical.canonical_indicator = None
                        canonical.save(update_fields=["canonical_indicator", "is_deprecated", "updated_at"])
            out("")
            out(f"APPLIED: {changed} duplicate indicator(s) linked to a canonical row.")
        else:
            out("")
            out("DRY RUN: no changes written. Re-run with --apply to persist.")

        if options.get("report"):
            with open(options["report"], "w") as fh:
                fh.write("\n".join(lines) + "\n")
            self.stdout.write(self.style.SUCCESS(f"Report written to {options['report']}"))

    def _handle_undo(self, options):
        qs = Indicator.objects.filter(canonical_indicator__isnull=False)
        count = qs.count()
        if options["apply"]:
            with transaction.atomic():
                for ind in qs:
                    ind.canonical_indicator = None
                    ind.is_deprecated = False
                    ind.save(update_fields=["canonical_indicator", "is_deprecated", "updated_at"])
            self.stdout.write(self.style.SUCCESS(f"UNDO applied: cleared {count} canonical link(s)."))
        else:
            self.stdout.write(f"DRY RUN undo: would clear {count} canonical link(s). Use --apply.")
