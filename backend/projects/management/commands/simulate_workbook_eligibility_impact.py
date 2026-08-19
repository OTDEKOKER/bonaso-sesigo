"""
READ-ONLY what-if simulation: the eligibility impact of switching from per-org
indicator assignment to inherited-coordinator-workbook eligibility (the approved
"workbook = the reporting set" model).

For every organisation it compares, WITHOUT changing anything:

    current  = get_assigned_indicator_ids_for_organization(...)   # live behaviour
    proposed = the org's resolved (own or inherited) workbook's placed indicators
    gained   = proposed - current      (would newly become eligible)
    lost     = current - proposed      (would lose eligibility)

Because ``resolve_layout_for_org`` already walks the project hierarchy, a
sub-grantee's ``proposed`` set is its coordinator's workbook (inheritance) — which
is exactly the target model.

No-workbook rule (``--no-workbook-rule``): how to treat an org whose resolved
workbook places no indicators:
    deny             proposed = {}                 (the workbook is the contract) [default]
    keep_assignment  proposed = current assignment  (today's per-org set)
    all_project      proposed = all project indicators

SAFETY
======
Strictly read-only:
  * SELECTs only; wrapped in a transaction that is ALWAYS rolled back.
  * No --apply, no --fix, no writes, no migration, no deploy.
  * It SIMULATES a not-yet-implemented behaviour. It does NOT change
    get_assigned_indicator_ids_for_organization or any data. Reuses the live
    runtime resolvers so the "current" side is real behaviour.

Usage:
    python manage.py simulate_workbook_eligibility_impact --read-only --live-only
    python manage.py simulate_workbook_eligibility_impact --read-only --project 3 --json
    python manage.py simulate_workbook_eligibility_impact --read-only --no-workbook-rule keep_assignment

Exit status: 0 on success regardless of impact size; 1 only on execution error.
"""
from __future__ import annotations

import json
import traceback

from django.core.management.base import BaseCommand
from django.db import transaction

from projects.models import (
    Project,
    ProjectIndicator,
    ProjectOrganization,
)
from projects.workbook_layout import resolve_layout_for_org
from projects.assignment_rules import get_assigned_indicator_ids_for_organization

NO_WORKBOOK_RULES = ("deny", "keep_assignment", "all_project")


class Command(BaseCommand):
    help = (
        "READ-ONLY what-if: eligibility impact of moving from per-org assignment "
        "to inherited-coordinator-workbook eligibility. Never writes; no --apply."
    )

    def add_arguments(self, parser):
        parser.add_argument("--project", type=int, default=None,
                            help="Limit to a single project id.")
        parser.add_argument("--live-only", action="store_true",
                            help="Only non-training (live) projects.")
        parser.add_argument("--json", dest="as_json", action="store_true",
                            help="Structured JSON output.")
        parser.add_argument("--read-only", dest="read_only", action="store_true", default=True,
                            help="Read-only simulation (DEFAULT and only mode). No --apply exists.")
        parser.add_argument("--no-workbook-rule", dest="no_workbook_rule",
                            choices=NO_WORKBOOK_RULES, default="deny",
                            help="Proposed eligibility when a resolved workbook places no indicators.")

    def handle(self, *args, **options):
        try:
            with transaction.atomic():
                report = self._build(options)
                transaction.set_rollback(True)  # guarantee zero writes persist
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"simulate_workbook_eligibility_impact failed: {exc}"))
            self.stderr.write(traceback.format_exc())
            raise SystemExit(1)

        if options.get("as_json"):
            self.stdout.write(json.dumps(report, indent=2, default=str))
        else:
            self._render(report)

    def _build(self, options):
        qs = Project.objects.all().order_by("id")
        if options.get("project") is not None:
            qs = qs.filter(id=options["project"])
        if options.get("live_only"):
            qs = qs.filter(is_training=False)

        rule = options["no_workbook_rule"]
        report = {
            "meta": {
                "read_only": True,
                "simulation_only": True,
                "no_data_modified": True,
                "no_workbook_rule": rule,
                "note": (
                    "SIMULATION. 'current' is live behaviour (per-org assignment); "
                    "'proposed' is the inherited-coordinator-workbook model. Nothing "
                    "is changed; this only shows the effect."
                ),
                "project_count": qs.count(),
            },
            "projects": [],
        }
        for project in qs:
            report["projects"].append(self._project(project, rule))
        return report

    def _project(self, project, rule):
        mode = "training" if project.is_training else "live"
        ind_code = {
            ind_id: code for ind_id, code in ProjectIndicator.objects.filter(project=project)
            .values_list("indicator_id", "indicator__code")
        }
        all_project_ids = set(ind_code.keys())

        orgs = []
        n_gain = n_lose = n_no_wb = n_unchanged = 0
        for r in ProjectOrganization.objects.filter(project=project).select_related("organization"):
            org = r.organization
            org_id = r.organization_id

            current = get_assigned_indicator_ids_for_organization(
                project=project, organization_id=org_id
            )

            layout = resolve_layout_for_org(project, org, mode=mode)
            placed = {it.indicator_id for it in layout.items.all() if it.indicator_id} if layout else set()

            if placed:
                proposed = set(placed)
                owner = layout.coordinator_organization_id
                proposed_source = "workbook_self" if owner == org_id else f"workbook_inherited_from_{owner}"
                no_workbook = False
            else:
                no_workbook = True
                n_no_wb += 1
                if rule == "keep_assignment":
                    proposed = set(current)
                    proposed_source = "no_workbook_keep_assignment"
                elif rule == "all_project":
                    proposed = set(all_project_ids)
                    proposed_source = "no_workbook_all_project"
                else:  # deny
                    proposed = set()
                    proposed_source = "no_workbook_deny"

            gained = sorted(proposed - current)
            lost = sorted(current - proposed)
            if gained:
                n_gain += 1
            if lost:
                n_lose += 1
            if not gained and not lost:
                n_unchanged += 1

            flags = []
            if no_workbook:
                flags.append("NO_WORKBOOK")
            if lost and not proposed:
                flags.append("WOULD_LOSE_ALL_ELIGIBILITY")
            if gained:
                flags.append("WOULD_GAIN")
            if lost:
                flags.append("WOULD_LOSE")

            orgs.append({
                "org_id": org_id,
                "org_name": getattr(org, "name", str(org_id)),
                "role": r.role,
                "proposed_source": proposed_source,
                "current_eligible_ids": sorted(current),
                "proposed_eligible_ids": sorted(proposed),
                "gained_ids": gained,
                "lost_ids": lost,
                "gained_codes": sorted(ind_code.get(i, str(i)) for i in gained),
                "lost_codes": sorted(ind_code.get(i, str(i)) for i in lost),
                "flags": flags,
            })

        return {
            "project_id": project.id,
            "project_code": project.code,
            "project_name": project.name,
            "mode": mode.upper(),
            "summary": {
                "organizations": len(orgs),
                "would_gain": n_gain,
                "would_lose": n_lose,
                "no_workbook": n_no_wb,
                "unchanged": n_unchanged,
            },
            "organizations": orgs,
        }

    def _render(self, report):
        w = self.stdout.write
        w("=" * 64)
        w("WORKBOOK-ELIGIBILITY IMPACT SIMULATION (READ-ONLY, NO DATA MODIFIED)")
        w("=" * 64)
        w(f"No-workbook rule: {report['meta']['no_workbook_rule']}    "
          f"Projects: {report['meta']['project_count']}")
        w("current = live per-org assignment   proposed = inherited coordinator workbook")
        w("")
        for p in report["projects"]:
            s = p["summary"]
            w("-" * 64)
            w(f"Project: {p['project_name']} ({p['project_code']}, id={p['project_id']}) [{p['mode']}]")
            w(f"  orgs={s['organizations']}  would_gain={s['would_gain']}  "
              f"would_lose={s['would_lose']}  no_workbook={s['no_workbook']}  unchanged={s['unchanged']}")
            for o in p["organizations"]:
                if not o["gained_ids"] and not o["lost_ids"] and "NO_WORKBOOK" not in o["flags"]:
                    continue  # only show orgs with an actual change / no-workbook
                w(f"    {o['org_name']} (id={o['org_id']}, {o['role']}) via {o['proposed_source']}")
                if o["gained_codes"]:
                    w(f"      + gains:  {o['gained_codes']}")
                if o["lost_codes"]:
                    w(f"      - loses:  {o['lost_codes']}")
                if o["flags"]:
                    w(f"      flags: {o['flags']}")
            w("")
        w("=" * 64)
        w("SIMULATION ONLY — NO DATA WAS MODIFIED (transaction rolled back).")
        w("=" * 64)
