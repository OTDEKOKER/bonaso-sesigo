"""Configure home-dashboard service pathways for all service categories.

The home/dashboard page renders "service pathways" — the client cascade
(Reached -> Screened -> Eligible -> Referred -> Linked/Received) per service
area — from ``Organization.dashboard_config['servicePathways']`` (a list of
``ConfiguredPathway`` objects: ``{id, label, stages:[{id,label,color,
indicatorIds[]}]}``). They are fully editable/deletable afterwards via the
"Configure service pathways" dialog on the home page.

This command builds one pathway per category for all categories, resolving each
stage's indicators by keyword against the indicators actually used in the
project, and writes them to the chosen organisation (default: BONASO, the prime
that rolls up every coordinator, so the home page shows the full cascade with
the filter bar to drill into an individual coordinator).

Usage:
    python manage.py seed_service_pathways            # dry-run (writes nothing)
    python manage.py seed_service_pathways --apply     # write to BONASO (org 174)
    python manage.py seed_service_pathways --org 112 --apply
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from aggregates.models import Aggregate
from indicators.models import Indicator
from organizations.models import Organization

PROJECT_ID = 2
DEFAULT_ORG_ID = 174  # BONASO (prime; parent of every coordinator)

# Stage palette (cascade shading, light -> dark).
COLORS = ["#cfe8f3", "#9ecfe6", "#6cb2d6", "#3f93c4", "#1f6a8a", "#134a63"]

# (pathway label, [(stage label, [keyword-groups]) ...], exclude)
# Each keyword-group (all words must match) resolves to one indicator; a stage
# may list several groups (e.g. GBV "Referred" = clinical + psychosocial + justice).
# Cascade × service-area matrix (per the maintainer's note). Messaging is
# EXCLUDED: no Messaging pathway and no "Messages/Reached" stage — the clinical
# cascade (Screened -> Eligible -> Referred -> Linked to care) across each
# service area. Distribution services (Condoms, Lubricants) use a distribution step.
PATHWAYS: list[tuple[str, list[tuple[str, list[list[str]]]], list[str]]] = [
    ("HIV testing", [
        ("Screened", [["people tested for hiv"]]),
        ("Eligible", [["tested positive for hiv"]]),
        ("Referred", [["referred for hiv testing"]]),
        ("Linked to care", [["people linked to care"]]),
    ], []),
    ("GBV", [
        ("Screened", [["screened for gbv"]]),
        ("Eligible", [["individuals eligible for gbv services"]]),
        ("Referred", [["referred for clinical services for gbv"],
                       ["referred for psychosocial support on gbv"],
                       ["referred for justice services for gbv"]]),
        ("Linked to care", [["received psychosocial support on gbv"]]),
    ], []),
    ("STI", [
        ("Screened", [["screened for syndromic stis"]]),
        ("Referred", [["screened positive for stis referred"]]),
        ("Linked to care", [["sti cases referrals completed"]]),
    ], []),
    ("TB", [
        ("Screened", [["plhiv screened for tb"]]),
        ("Eligible", [["tested positive for tb and are on treatm"]]),
        ("Linked to care", [["plhiv on tb treatment"]]),
    ], []),
    ("PSS", [
        ("Eligible", [["eligible", "psychosocial support"]]),
        ("Referred", [["referred for psychosocial support on gbv"]]),
        ("Linked to care", [["received psychosocial support on gbv"]]),
    ], []),
    ("Justice", [
        ("Eligible", [["eligible for legal aid"]]),
        ("Referred", [["provided with legal aid"]]),
        ("Linked to care", [["linked to justice"]]),
    ], []),
    ("Condoms", [
        ("Distributed", [["number of condoms distributed"]]),
        ("Repeat collection", [["collecting condoms for a repea"]]),
    ], ["brailed", "non-traditional"]),
    ("Lubricants", [
        ("Distributed", [["lubricants distributed"]]),
    ], []),
]


def _slug(text: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in text.lower()).strip("-")


class Command(BaseCommand):
    help = "Configure home-dashboard service pathways for all service categories."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="Write the config. Without this flag the command only prints the plan.")
        parser.add_argument("--org", type=int, default=DEFAULT_ORG_ID,
                            help=f"Organisation id to configure (default {DEFAULT_ORG_ID} = BONASO).")

    def handle(self, *args, **options):
        apply = options["apply"]
        org_id = options["org"]

        org = Organization.objects.filter(id=org_id).first()
        if org is None:
            self.stderr.write(self.style.ERROR(f"Organisation {org_id} not found."))
            return

        used_ids = set(Aggregate.objects.filter(project_id=PROJECT_ID).values_list("indicator_id", flat=True))
        index = [
            {"id": i.id, "name": (i.name or "").lower(), "deprecated": bool(getattr(i, "is_deprecated", False))}
            for i in Indicator.objects.filter(id__in=used_ids)
        ]

        def resolve(keywords: list[str], exclude: list[str]) -> int | None:
            kws = [k.lower() for k in keywords]
            exc = [e.lower() for e in exclude]
            cands = [e for e in index if all(k in e["name"] for k in kws) and not any(x in e["name"] for x in exc)]
            if not cands:
                return None
            cands.sort(key=lambda e: (e["deprecated"], len(e["name"])))
            return cands[0]["id"]

        configured: list[dict] = []
        unresolved: list[str] = []

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\nService pathways for org #{org.id} ({org.name}) — project {PROJECT_ID}\n"))

        for label, stages, exclude in PATHWAYS:
            self.stdout.write(self.style.HTTP_INFO(f"[{label}]"))
            stage_dicts = []
            for si, (stage_label, groups) in enumerate(stages):
                ids: list[str] = []
                misses: list[str] = []
                for group in groups:
                    found = resolve(group, exclude)
                    if found:
                        ids.append(str(found))
                    else:
                        misses.append(" & ".join(group))
                if misses:
                    unresolved.append(f"{label} / {stage_label}: {'; '.join(misses)}")
                mark = "✓" if ids else "✗"
                self.stdout.write(f"   {mark} {stage_label:24} -> {ids or 'UNRESOLVED'}"
                                  + (f"  (missing: {'; '.join(misses)})" if misses else ""))
                if ids:
                    stage_dicts.append({
                        "id": f"{_slug(label)}--{_slug(stage_label)}",
                        "label": stage_label,
                        "color": COLORS[si % len(COLORS)],
                        "indicatorIds": ids,
                    })
            if stage_dicts:
                configured.append({"id": _slug(label), "label": label, "stages": stage_dicts})

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\nPathways: {len(configured)}  Stages: {sum(len(p['stages']) for p in configured)}  "
            f"Unresolved stage-groups: {len(unresolved)}"))

        if not apply:
            self.stdout.write(self.style.WARNING(
                "\nDRY-RUN — nothing written. Re-run with --apply to save to the organisation."))
            return

        cfg = dict(org.dashboard_config or {})
        cfg["servicePathways"] = configured
        org.dashboard_config = cfg
        org.save(update_fields=["dashboard_config"])
        self.stdout.write(self.style.SUCCESS(
            f"\nSaved {len(configured)} service pathways to org #{org.id} ({org.name}). "
            f"They now show on the home dashboard and are editable there."))
