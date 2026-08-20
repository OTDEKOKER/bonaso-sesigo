"""
READ-ONLY dry-run: what a hierarchy canonicalization WOULD change.

Treats ``ProjectOrganizationHierarchy`` (active edges) as the single source of
truth and shows, per project, what the legacy/denormalised copies WOULD become if
derived from it — and the diff against what is currently stored:

  * ProjectOrganization.is_coordinator / is_sub_grantee   (derived via
    projects.derived_roles: coordinator = parent-edge AND role NOT IN {lead,funder})
  * ProjectOrganization.parent_assignment                 (the parent org's PO)
  * Project.hierarchy_overrides JSON                       ({parent_org: [children]})

It writes NOTHING. There is no --apply / --fix here; applying is a separate,
approval-gated task. The whole run is wrapped in an always-rolled-back
transaction as defence in depth.

Usage:
    python manage.py dry_run_hierarchy_canonicalization --read-only --live-only
    python manage.py dry_run_hierarchy_canonicalization --read-only --project 3 --json
"""
from __future__ import annotations

import json
import traceback

from django.core.management.base import BaseCommand
from django.db import transaction

from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy
from projects.derived_roles import derive_role_flags
from projects.hierarchy import normalize_project_hierarchy_overrides
from projects.assignment_rules import get_project_organization_scope_ids


class Command(BaseCommand):
    help = (
        "READ-ONLY dry-run of hierarchy canonicalization: shows what the legacy "
        "fields would become if derived from ProjectOrganizationHierarchy, and the "
        "diff vs stored. Writes nothing; no --apply."
    )

    def add_arguments(self, parser):
        parser.add_argument("--project", type=int, default=None)
        parser.add_argument("--live-only", action="store_true")
        parser.add_argument("--json", dest="as_json", action="store_true")
        parser.add_argument("--read-only", dest="read_only", action="store_true", default=True,
                            help="Read-only (DEFAULT and only mode). No --apply exists.")

    def handle(self, *args, **options):
        try:
            with transaction.atomic():
                report = self._build(options)
                transaction.set_rollback(True)
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"dry_run_hierarchy_canonicalization failed: {exc}"))
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
        return {
            "meta": {"read_only": True, "writes": 0, "no_apply": True,
                     "canonical": "ProjectOrganizationHierarchy",
                     "project_count": qs.count()},
            "projects": [self._project(p) for p in qs],
        }

    def _project(self, project):
        po_rows = list(ProjectOrganization.objects.filter(project=project).select_related("organization"))
        po_by_org = {r.organization_id: r for r in po_rows}
        name = {r.organization_id: getattr(r.organization, "name", str(r.organization_id)) for r in po_rows}

        edges = [(int(p), int(c)) for p, c in ProjectOrganizationHierarchy.objects
                 .filter(project=project, is_active=True)
                 .values_list("parent_organization_id", "child_organization_id")]
        parent_by_child = {c: p for p, c in edges}
        children_by_parent: dict[int, list[int]] = {}
        for p, c in edges:
            children_by_parent.setdefault(p, []).append(c)

        derived = derive_role_flags(project)

        # --- flag diffs ---
        flag_changes = []
        for r in po_rows:
            d = derived.get(r.organization_id, {"is_coordinator": False, "is_sub_grantee": False})
            if bool(r.is_coordinator) != d["is_coordinator"] or bool(r.is_sub_grantee) != d["is_sub_grantee"]:
                flag_changes.append({
                    "org_id": r.organization_id, "org_name": name.get(r.organization_id),
                    "role": r.role,
                    "is_coordinator": {"stored": bool(r.is_coordinator), "derived": d["is_coordinator"]},
                    "is_sub_grantee": {"stored": bool(r.is_sub_grantee), "derived": d["is_sub_grantee"]},
                })

        # --- parent_assignment diffs (derived parent PO id per child) ---
        pa_changes = []
        for r in po_rows:
            derived_parent_org = parent_by_child.get(r.organization_id)
            derived_pa_id = po_by_org[derived_parent_org].id if derived_parent_org in po_by_org else None
            if r.parent_assignment_id != derived_pa_id:
                pa_changes.append({
                    "org_id": r.organization_id, "org_name": name.get(r.organization_id),
                    "stored_parent_assignment_id": r.parent_assignment_id,
                    "derived_parent_assignment_id": derived_pa_id,
                    "derived_parent_org": derived_parent_org,
                })

        # --- hierarchy_overrides JSON diff ---
        derived_json = {str(p): sorted(str(c) for c in cs) for p, cs in children_by_parent.items()}
        try:
            stored_json_norm = normalize_project_hierarchy_overrides(
                project.hierarchy_overrides or {},
                allowed_org_ids=get_project_organization_scope_ids(project),
            )
        except ValueError:
            stored_json_norm = {}
        stored_json = {str(k): sorted(str(x) for x in v) for k, v in stored_json_norm.items()}
        json_differs = derived_json != stored_json

        return {
            "project_id": project.id, "project_code": project.code, "project_name": project.name,
            "mode": "TRAINING" if project.is_training else "LIVE",
            "active_edges": len(edges),
            "would_change": {
                "flags": len(flag_changes),
                "parent_assignment": len(pa_changes),
                "hierarchy_overrides_json": bool(json_differs),
            },
            "flag_changes": flag_changes,
            "parent_assignment_changes": pa_changes,
            "hierarchy_overrides": {"stored": stored_json, "derived_from_canonical": derived_json,
                                     "differs": json_differs},
        }

    def _render(self, report):
        w = self.stdout.write
        w("=" * 66)
        w("HIERARCHY CANONICALIZATION — DRY RUN (READ-ONLY, WRITES 0)")
        w("Canonical = ProjectOrganizationHierarchy. Legacy shown as derived-vs-stored.")
        w("=" * 66)
        for p in report["projects"]:
            wc = p["would_change"]
            w(f"\n{p['project_name']} ({p['project_code']}, id={p['project_id']}) [{p['mode']}] "
              f"— {p['active_edges']} active edges")
            w(f"  would change: flags={wc['flags']}  parent_assignment={wc['parent_assignment']}  "
              f"hierarchy_overrides_json={'YES' if wc['hierarchy_overrides_json'] else 'no'}")
            for fc in p["flag_changes"]:
                w(f"    flag  {fc['org_name']} (id {fc['org_id']}, {fc['role']}): "
                  f"coord {fc['is_coordinator']['stored']}->{fc['is_coordinator']['derived']}  "
                  f"sub {fc['is_sub_grantee']['stored']}->{fc['is_sub_grantee']['derived']}")
            for pc in p["parent_assignment_changes"]:
                w(f"    parent_assignment  {pc['org_name']} (id {pc['org_id']}): "
                  f"{pc['stored_parent_assignment_id']} -> {pc['derived_parent_assignment_id']}")
        w("\n" + "=" * 66)
        w("DRY RUN ONLY — NO DATA MODIFIED (transaction rolled back). No --apply exists here.")
        w("=" * 66)
