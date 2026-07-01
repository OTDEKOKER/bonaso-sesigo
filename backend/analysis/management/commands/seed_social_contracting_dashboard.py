"""Seed the "Annual Social Contracting Report 2026" dashboard with editable charts.

This mirrors the visualizations in the Annual Social Contracting Report as normal,
editable/deletable dashboard chart cards — nothing is hardcoded in the UI. Each chart
is a standard entry in ``Report.parameters['charts']`` (same shape the dashboard "Add
analysis" dialog writes), so users can edit or delete any card afterwards.

Design decisions (confirmed with the maintainer):
  * Location   : a new dedicated dashboard Report named below.
  * Data scope : NAHPA Social Contracting (project 2), ALL coordinators rolled up.
                 The dashboard carries no org filter, so it aggregates every
                 coordinator; users apply the dashboard filter bar to drill into an
                 individual coordinator/organisation.
  * Period     : FY 2025/26 (Apr 2025 - Mar 2026).

Charts resolve their indicators by keyword against the indicators actually used in the
project, so the command adapts if indicator ids/codes change. Unresolved specs are
reported (never silently dropped).

Usage:
    # Safe preview — writes nothing, prints the full plan + coverage:
    python manage.py seed_social_contracting_dashboard

    # Actually create/update the dashboard once the preview looks right:
    python manage.py seed_social_contracting_dashboard --apply
"""

from __future__ import annotations

from dataclasses import dataclass, field

from django.core.management.base import BaseCommand
from django.db import transaction

from aggregates.models import Aggregate
from analysis.models import Report
from indicators.models import Indicator

DASHBOARD_NAME = "Annual Social Contracting Report 2026"
PROJECT_ID = 2
FY_DATE_FROM = "2025-04-01"
FY_DATE_TO = "2026-03-31"


@dataclass
class ChartSpec:
    """One dashboard chart. Each ``match`` group resolves to a single indicator."""

    section: str
    name: str
    match: list[list[str]]
    chart_type: str = "bar"          # bar | line | pie
    legend: str | None = "sex"       # sex | organization | age_band | key_population | <dim> | None
    use_target: bool = False
    stack: str | None = None
    tabular: bool = True
    exclude: list[str] = field(default_factory=list)


# Report chart patterns, grouped by report section. Keyword groups are matched
# case-insensitively against indicator names within the project (all words must be
# present). "organization" legend => per-coordinator bars (the "see individuals"
# view); "sex" legend => male/female split, as in the report.
CHART_SPECS: list[ChartSpec] = [
    # --- Reach / prevention messages ---
    ChartSpec("Reach", "People reached with PEP messages by sex", [["reached with pep messages"]]),
    ChartSpec("Reach", "People reached with PrEP messages by sex", [["reached with prep messages"]]),
    ChartSpec("Reach", "People reached with condom use messages by sex", [["reached with", "condom use"]]),
    ChartSpec("Reach", "People reached with ARV-based prevention messages", [["reached with arv based prevention"]]),
    ChartSpec("Reach", "People reached with EMTCT messages", [["reached with emtct"]]),
    ChartSpec("Reach", "People reached with treatment literacy messages", [["treatment literacy"]]),
    ChartSpec("Reach", "People reached with psychoeducation", [["reached with psychoeducation"]]),
    ChartSpec("Reach", "People reached with GBV messages by sex", [["reached with gbv messages"]]),
    ChartSpec("Reach", "People reached with NCD prevention messages", [["reached with ncd"]]),
    ChartSpec("Reach", "People engaged with NCD messages (social media)", [["engaged with ncd"]], legend="age_band"),
    ChartSpec("Reach", "People reached with stigma reduction messages", [["reached with stigma reduction"]]),
    # --- HIV testing cascade ---
    ChartSpec("HIV testing", "Referred for HIV testing by sex", [["referred for hiv testing"]]),
    ChartSpec("HIV testing", "Tested for HIV by sex", [["people tested for hiv"]]),
    ChartSpec("HIV testing", "Tested positive for HIV", [["tested positive for hiv"]], legend="age_band"),
    ChartSpec("HIV testing", "Initiated on ART by sex", [["people initiated on art"]]),
    ChartSpec("HIV testing", "Linked to care by sex", [["people linked to care"]]),
    # --- STI ---
    ChartSpec("STI", "Screened for syndromic STIs by sex", [["screened for syndromic stis"]]),
    ChartSpec("STI", "STI positive referred for services", [["screened positive for stis referred"]]),
    # --- PrEP / PEP ---
    ChartSpec("PrEP/PEP", "Assessed for PrEP eligibility by sex", [["assessed for prep"]]),
    ChartSpec("PrEP/PEP", "Eligible for PrEP by sex", [["eligible for prep"]]),
    ChartSpec("PrEP/PEP", "Referred for PrEP by sex", [["referred for prep"]]),
    ChartSpec("PrEP/PEP", "Assessed for PEP eligibility by sex", [["assessed for pep"]]),
    ChartSpec("PrEP/PEP", "Eligible for PEP by sex", [["eligible for pep"]]),
    ChartSpec("PrEP/PEP", "Referred for PEP by sex", [["referred for pep"]]),
    # --- Treatment continuity (tracing) ---
    ChartSpec("Treatment continuity", "Missed appointments (1-13 days) followed", [["missed appointment", "followed"]]),
    ChartSpec("Treatment continuity", "ART defaulters (14-89 days) followed", [["art defaulters", "followed"]]),
    ChartSpec("Treatment continuity", "LTFU (90+ days) followed", [["ltfu", "followed"]]),
    # --- Condoms & lubricants ---
    ChartSpec("Condoms", "Condoms distributed by sex", [["number of condoms distributed"]], exclude=["brailed", "non-traditional"]),
    ChartSpec("Condoms", "Condoms distributed via non-traditional sites", [["non-traditional sites"]], legend="non_traditional_sites"),
    ChartSpec("Condoms", "Brailed condoms distributed to PWDs", [["brailed condoms"]]),
    ChartSpec("Condoms", "Collecting condoms for a repeated time", [["collecting condoms for a repea"]]),
    ChartSpec("Condoms", "Lubricants distributed by sex", [["lubricants distributed"]]),
    # --- GBV cascade ---
    ChartSpec("GBV", "Screened for GBV by sex", [["screened for gbv"]]),
    ChartSpec("GBV", "Eligible for GBV services by sex", [["individuals eligible for gbv services"]]),
    ChartSpec("GBV", "Referred for clinical GBV services by sex", [["referred for clinical services for gbv"]]),
    ChartSpec("GBV", "Referred for psychosocial GBV support by sex", [["referred for psychosocial support on gbv"]]),
    ChartSpec("GBV", "Referred for justice services (GBV) by sex", [["referred for justice services for gbv"]]),
    # --- TB cascade ---
    ChartSpec("TB", "PLHIV screened for TB by sex", [["plhiv screened for tb"]]),
    ChartSpec("TB", "PLHIV positive for TB & on treatment", [["tested positive for tb and are on treatm"]]),
    ChartSpec("TB", "PLHIV on TB treatment by sex", [["plhiv on tb treatment"]], exclude=["interrupting"]),
    ChartSpec("TB", "PLHIV interrupting TB treatment reinitiated", [["tb treatment interrupters reinitiated"]]),
    # --- NCD screening ---
    ChartSpec("NCD", "Screened for NCD risk factors by sex", [["screened for ncds risk factors"]]),
    ChartSpec("NCD", "Suspected of NCD biological risk factors", [["suspected", "ncds risk factors"]]),
    ChartSpec("NCD", "Screened for NCD behavioural risk factors (tobacco)", [["screened for ncds behavioural risk factors("]], legend="tobacco_use"),
    ChartSpec("NCD", "Screened for NCD behavioural risk factors (alcohol)", [["screened for ncds behavioural risk factors "]], legend="alcohol_use"),
    ChartSpec("NCD", "Eligible for tobacco cessation program", [["eligible for tobacco cessation"]]),
    ChartSpec("NCD", "Referred for tobacco cessation program", [["referred for tobacco cessation"]]),
    ChartSpec("NCD", "Eligible for alcohol management program", [["eligible for alcohol management"]]),
    ChartSpec("NCD", "Referred for alcohol management program", [["referred for alcohol management"]]),
    ChartSpec("NCD", "Eligible for breast cancer screening by sex", [["eligible for breast cancer screening"]]),
    ChartSpec("NCD", "Screened for breast cancer by sex", [["screened for breast cancer"]]),
    # --- Mental health ---
    ChartSpec("Mental health", "Screened for mental health by sex", [["screened for mental health"]]),
    ChartSpec("Mental health", "Receiving counselling by sex", [["people receiving counselling"]]),
    ChartSpec("Mental health", "Eligible for counselling", [["eligible for counselling"]]),
    ChartSpec("Mental health", "Eligible for mental health management/services", [["eligible for mental health management"]], legend="mental_health_management_treatment_services"),
    ChartSpec("Mental health", "Referred for mental health management/services", [["referred for mental health management"]], legend="mental_health_management_treatment_services"),
    # --- Human rights / redress ---
    ChartSpec("Rights", "Community leaders sensitised on human rights", [["community leaders sensitised"]]),
    ChartSpec("Rights", "People sensitised on basic human rights and HIV", [["sensitised on basic human rights"]]),
    ChartSpec("Rights", "People who sought redress", [["sought redress"]]),
    # --- Capacity building / trainings (per coordinator) ---
    ChartSpec("Trainings", "Service providers receiving training by coordinator", [["service providers receiving training"]], legend="organization"),
    ChartSpec("Trainings", "CSOs who received refresher training by coordinator", [["refresher training"]], legend="organization"),
    ChartSpec("Trainings", "Healthcare workers trained on medical ethics/human rights", [["healthcare workers trained"]], legend="organization"),
    # --- Targets vs achievement (per coordinator) ---
    ChartSpec("Targets", "HIV testing achieved vs target by coordinator", [["people tested for hiv"]], legend="organization", use_target=True),
    ChartSpec("Targets", "Condoms distributed achieved vs target by coordinator", [["number of condoms distributed"]], legend="organization", use_target=True, exclude=["brailed", "non-traditional"]),
    ChartSpec("Targets", "GBV screened achieved vs target by coordinator", [["screened for gbv"]], legend="organization", use_target=True),
]


class Command(BaseCommand):
    help = "Seed the Annual Social Contracting Report 2026 dashboard with editable chart cards."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Write the dashboard. Without this flag the command only prints the plan (dry-run).",
        )
        parser.add_argument(
            "--replace-charts",
            action="store_true",
            help="Replace all existing charts on the dashboard instead of only adding missing ones.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]
        replace = options["replace_charts"]

        # Index the indicators actually used in this project (canonical first).
        used_ids = set(Aggregate.objects.filter(project_id=PROJECT_ID).values_list("indicator_id", flat=True))
        indicators = list(Indicator.objects.filter(id__in=used_ids))
        index = [
            {
                "id": ind.id,
                "name": (ind.name or "").lower(),
                "code": (ind.code or "").lower(),
                "deprecated": bool(getattr(ind, "is_deprecated", False)),
            }
            for ind in indicators
        ]

        def resolve(keywords: list[str], exclude: list[str]) -> int | None:
            kws = [k.lower() for k in keywords]
            exc = [e.lower() for e in exclude]
            candidates = [
                entry
                for entry in index
                if all(k in entry["name"] for k in kws) and not any(e in entry["name"] for e in exc)
            ]
            if not candidates:
                return None
            # Prefer non-deprecated, then shortest name (most specific canonical match).
            candidates.sort(key=lambda e: (e["deprecated"], len(e["name"])))
            return candidates[0]["id"]

        planned_charts: list[dict] = []
        unresolved: list[str] = []
        current_section = None

        self.stdout.write(self.style.MIGRATE_HEADING(f"\nDashboard: {DASHBOARD_NAME}"))
        self.stdout.write(f"Project: {PROJECT_ID} (NAHPA Social Contracting)  Period: {FY_DATE_FROM} .. {FY_DATE_TO}")
        self.stdout.write(f"Scope: all coordinators (no org filter); drill down via dashboard filters\n")

        for spec in CHART_SPECS:
            if spec.section != current_section:
                current_section = spec.section
                self.stdout.write(self.style.HTTP_INFO(f"\n[{spec.section}]"))

            indicator_ids: list[int] = []
            missing_groups: list[str] = []
            for group in spec.match:
                found = resolve(group, spec.exclude)
                if found:
                    indicator_ids.append(found)
                else:
                    missing_groups.append(" & ".join(group))

            if not indicator_ids:
                unresolved.append(f"{spec.section} / {spec.name} (no match for: {'; '.join(missing_groups)})")
                self.stdout.write(self.style.ERROR(f"  ✗ {spec.name}  — UNRESOLVED ({'; '.join(missing_groups)})"))
                continue

            note = ""
            if missing_groups:
                note = self.style.WARNING(f"  [partial: missing {'; '.join(missing_groups)}]")
            self.stdout.write(
                f"  ✓ {spec.name}  → indicators {indicator_ids}"
                f" [type={spec.chart_type}, legend={spec.legend}, target={spec.use_target}]{note}"
            )

            planned_charts.append(
                {
                    "name": spec.name,
                    "chart_type": spec.chart_type,
                    "axis": "quarter",
                    "legend": spec.legend,
                    "stack": spec.stack,
                    "use_target": spec.use_target,
                    "tabular": spec.tabular,
                    "average": False,
                    "repeat_only": False,
                    "repeat_n": None,
                    "start": None,
                    "end": None,
                    "filters": [],
                    "indicators": indicator_ids,
                    "indicator_details": [],
                    "created_by": None,
                }
            )

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\nPlanned: {len(planned_charts)} charts,  Unresolved: {len(unresolved)}"
            )
        )

        if not apply:
            self.stdout.write(
                self.style.WARNING(
                    "\nDRY-RUN — nothing written. Re-run with --apply to create the dashboard."
                )
            )
            return

        with transaction.atomic():
            dashboard, created = Report.objects.get_or_create(
                name=DASHBOARD_NAME,
                report_type="dashboard",
                mode="live",
                defaults={
                    "description": "Auto-seeded charts mirroring the Annual Social Contracting Report 2026.",
                    "parameters": {},
                    "is_public": True,
                },
            )
            params = dashboard.parameters or {}
            existing = [] if replace else list(params.get("charts") or [])
            existing_names = {c.get("name") for c in existing}

            base_id = dashboard.id * 1000
            next_seq = 1 + max(
                [int(c.get("id", 0)) - base_id for c in existing if isinstance(c.get("id"), int)] or [0]
            )

            added = 0
            for chart in planned_charts:
                if not replace and chart["name"] in existing_names:
                    continue
                chart = dict(chart, id=base_id + next_seq)
                next_seq += 1
                existing.append(chart)
                added += 1

            params.update(
                {
                    "project_id": PROJECT_ID,
                    "organization_id": None,
                    "cascade_organization": False,
                    "date_from": FY_DATE_FROM,
                    "date_to": FY_DATE_TO,
                    "charts": existing,
                    "legacy_dashboard": True,
                }
            )
            dashboard.parameters = params
            dashboard.save(update_fields=["parameters", "description", "is_public", "updated_at"])

            self.stdout.write(
                self.style.SUCCESS(
                    f"\n{'Created' if created else 'Updated'} dashboard #{dashboard.id} "
                    f"'{DASHBOARD_NAME}' — {added} chart(s) added, {len(existing)} total."
                )
            )
