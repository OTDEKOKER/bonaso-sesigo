"""READ-ONLY: per-project org-scope parity — global Organization.parent tree vs
ProjectOrganizationHierarchy (POH).

This is the Phase-5 safety gate. Before flipping ``HIERARCHY_SOURCE=project`` in
an environment, run this to see EXACTLY how each member organisation's visibility
scope changes, per project:

  * ``global`` mode gives  ``org + org.get_descendants()`` (the single global tree).
  * ``project`` mode gives ``hierarchy_service.get_project_scope(project, org)``
    (the org's POH subtree, or the whole project for a lead/funder).

For every org whose scope differs it reports:
  * ``global_only`` — orgs visible under the global tree but NOT under POH. These
    LOSE visibility on flip; expected when the global tree carries cross-project
    or exited-org relationships the project hierarchy correctly excludes (a
    tightening / correction).
  * ``project_only`` — orgs visible under POH but NOT the global tree. These GAIN
    visibility on flip. Investigate each one before flipping — this is where an
    unexpected widening would show up.

Writes NOTHING. Safe to run in production. Use ``--json`` for machine output and
``--project N`` / ``--live-only`` to scope the run.
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from organizations.models import Organization
from projects.models import Project, ProjectOrganization
from projects import hierarchy_service as hs


class Command(BaseCommand):
    help = (
        "READ-ONLY per-project org-scope parity between the global "
        "Organization.parent tree and ProjectOrganizationHierarchy (Phase-5 gate)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--project", type=int, default=None)
        parser.add_argument("--live-only", action="store_true")
        parser.add_argument("--json", dest="as_json", action="store_true")

    def handle(self, *args, **options):
        qs = Project.objects.all().order_by("id")
        if options.get("project") is not None:
            qs = qs.filter(id=options["project"])
        if options.get("live_only"):
            qs = qs.filter(is_training=False)

        report = {"read_only": True, "writes": 0, "projects": [p and self._project(p) for p in qs]}

        if options.get("as_json"):
            self.stdout.write(json.dumps(report, indent=2, default=str))
        else:
            self._render(report)

    def _global_scope(self, org_id, org_by_id):
        org = org_by_id.get(org_id)
        if org is None:
            return {org_id}
        return {org_id} | {c.id for c in org.get_descendants()}

    def _project(self, project):
        members = list(
            ProjectOrganization.objects.filter(project=project)
            .select_related("organization")
            .values_list("organization_id", flat=True)
        )
        org_by_id = {o.id: o for o in Organization.objects.filter(id__in=members)}

        raw = []  # (oid, g, p) for members whose scope differs
        all_ids: set[int] = set()
        for oid in members:
            g = self._global_scope(oid, org_by_id)
            p = hs.get_project_scope(project, oid)
            if g != p:
                raw.append((oid, g, p))
                all_ids |= g | p | {oid}

        # Hydrate names for EVERY referenced org — global_only orgs are often
        # non-members (that is why they are being removed), so they are not in the
        # member-only map above.
        name = dict(Organization.objects.filter(id__in=all_ids).values_list("id", "name"))

        differences = []
        total_global_only = 0
        total_project_only = 0
        for oid, g, p in raw:
            global_only = sorted(g - p)
            project_only = sorted(p - g)
            total_global_only += len(global_only)
            total_project_only += len(project_only)
            differences.append({
                "org_id": oid,
                "org_name": name.get(oid),
                "global_scope_size": len(g),
                "project_scope_size": len(p),
                "global_only": [{"id": i, "name": name.get(i)} for i in global_only],
                "project_only": [{"id": i, "name": name.get(i)} for i in project_only],
            })

        return {
            "project_id": project.id,
            "project_code": project.code,
            "mode": "TRAINING" if project.is_training else "LIVE",
            "member_orgs": len(members),
            "orgs_with_scope_change": len(differences),
            "total_global_only_removed": total_global_only,
            "total_project_only_added": total_project_only,
            "differences": differences,
        }

    def _render(self, report):
        w = self.stdout.write
        w("=" * 70)
        w("HIERARCHY SCOPE PARITY — global Organization.parent  vs  POH  (READ-ONLY)")
        w("global_only = LOSES visibility on flip (expected: cross-project/exited)")
        w("project_only = GAINS visibility on flip (INVESTIGATE before flipping)")
        w("=" * 70)
        for p in report["projects"]:
            if not p:
                continue
            w(f"\n{p['project_code']} (id={p['project_id']}) [{p['mode']}] — "
              f"{p['member_orgs']} member orgs, {p['orgs_with_scope_change']} change scope")
            w(f"  global_only removed: {p['total_global_only_removed']}  |  "
              f"project_only added: {p['total_project_only_added']}"
              f"{'   <-- ⚠ INVESTIGATE' if p['total_project_only_added'] else ''}")
            for d in p["differences"]:
                go = [x["name"] for x in d["global_only"][:5]]
                po = [x["name"] for x in d["project_only"][:5]]
                w(f"    {d['org_name']}: global={d['global_scope_size']} POH={d['project_scope_size']}"
                  f"  -global_only={go}  +project_only={po}")
        w("\n" + "=" * 70)
        w("READ-ONLY — no data modified. Flip HIERARCHY_SOURCE=project only when "
          "project_only is empty or every entry is understood.")
        w("=" * 70)
