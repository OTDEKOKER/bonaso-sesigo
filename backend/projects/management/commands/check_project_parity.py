"""
READ-ONLY project parity audit.

Proves — WITHOUT changing anything — whether the several coexisting
representations of a project's structure agree with each other and with the
runtime resolvers, so the "canonical model" question can be answered against the
real live data BEFORE any architectural change.

It reports parity across:
  * Hierarchy      : ProjectOrganizationHierarchy (active edges)
                     vs ProjectOrganization.parent_assignment
                     vs Project.hierarchy_overrides (JSON)
  * Coordinator    : is_coordinator / is_sub_grantee flags
                     vs parent/child edges in ProjectOrganizationHierarchy
                     vs the analytics name-list (if importable)
  * Workbook       : the layout the RUNTIME resolver returns for each org
                     (self vs inherited-from-ancestor vs none) + placed indicators
  * Assignment     : direct ProjectIndicatorAssignment (+ source + can_report)
                     vs target-derived vs all-project fallback
  * Effective set  : assigned INTERSECT resolved-workbook-placed indicators
  * Subtree        : coordinator children / descendants / resolver scope

SAFETY
======
This command is strictly read-only:
  * It performs ONLY SELECT queries (no create/update/delete/save).
  * The whole run is wrapped in a transaction that is ALWAYS rolled back, so even
    an accidental write can never persist.
  * It has NO repair behaviour and NO --fix flag. Repair is a separate task and
    must never be invoked here. (Note: the sibling ``check_project_consistency
    --fix`` treats a DIFFERENT representation as canonical and MUST NOT be run
    during stabilisation.)

It REUSES the same runtime functions the live system uses (workbook resolution,
assignment eligibility, hierarchy scope) so it exposes CURRENT behaviour rather
than inventing a new interpretation.

Usage:
    python manage.py check_project_parity --read-only            # all projects (human)
    python manage.py check_project_parity --read-only --live-only
    python manage.py check_project_parity --read-only --project 3
    python manage.py check_project_parity --read-only --json

Exit status:
    0 = executed successfully (regardless of how many parity issues were found)
    1 = an execution/runtime error occurred

This is an audit, not a gate: detecting mismatches is the POINT and does not fail
the command.
"""
from __future__ import annotations

import json
import traceback
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count

from projects.models import (
    Project,
    ProjectIndicator,
    ProjectIndicatorAssignment,
    ProjectIndicatorOrganizationTarget,
    ProjectOrganization,
    ProjectOrganizationHierarchy,
    WorkbookLayout,
)

# Runtime resolvers — REUSED verbatim so this report reflects live behaviour.
from projects.hierarchy import (
    normalize_project_hierarchy_overrides,
    resolve_organization_scope_with_project_hierarchy,
)
from projects.scope import get_project_subtree_org_ids
from projects.workbook_layout import (
    get_project_ancestor_org_ids,
    resolve_layout_for_org,
)
from projects.assignment_rules import (
    get_assigned_indicator_ids_for_organization,
    _has_project_indicator_assignments,
    _has_project_indicator_targets,
)


def _edges_from_table(project) -> set[tuple[int, int]]:
    """Active ProjectOrganizationHierarchy edges as (parent_org, child_org)."""
    return {
        (int(p), int(c))
        for p, c in ProjectOrganizationHierarchy.objects.filter(
            project=project, is_active=True
        ).values_list("parent_organization_id", "child_organization_id")
    }


def _edges_from_parent_assignment(project) -> set[tuple[int, int]]:
    """Edges derived from ProjectOrganization.parent_assignment (legacy self-FK).

    This only READS the legacy field into an edge set for comparison; it is not a
    resolution algorithm and never writes.
    """
    rows = list(
        ProjectOrganization.objects.filter(project=project).select_related(
            "parent_assignment"
        )
    )
    by_id = {r.id: r for r in rows}
    edges: set[tuple[int, int]] = set()
    for r in rows:
        pa_id = r.parent_assignment_id
        if pa_id and pa_id in by_id:
            parent_org = int(by_id[pa_id].organization_id)
            child_org = int(r.organization_id)
            if parent_org != child_org:
                edges.add((parent_org, child_org))
    return edges


def _edges_from_json(project, allowed_org_ids) -> set[tuple[int, int]]:
    """Edges derived from Project.hierarchy_overrides via the SAME normaliser the
    runtime resolver uses."""
    try:
        normalized = normalize_project_hierarchy_overrides(
            project.hierarchy_overrides or {},
            allowed_org_ids=allowed_org_ids,
        )
    except ValueError:
        normalized = {}
    edges: set[tuple[int, int]] = set()
    for parent_id, child_ids in normalized.items():
        for child_id in child_ids:
            try:
                edges.add((int(parent_id), int(child_id)))
            except (TypeError, ValueError):
                continue
    return edges


def _load_name_list_checker():
    """Return the analytics name-list coordinator predicate, or None if the
    optional analytics module cannot be imported (kept non-fatal)."""
    try:
        from analysis.views import _is_coordinator_portfolio_organization

        return _is_coordinator_portfolio_organization
    except Exception:
        return None


class Command(BaseCommand):
    help = (
        "READ-ONLY audit of project hierarchy / coordinator / workbook / "
        "assignment parity. Never writes; has no --fix. --read-only is the "
        "default and the only mode."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--project", type=int, default=None,
            help="Limit to a single project id.",
        )
        parser.add_argument(
            "--live-only", action="store_true",
            help="Only non-training (live) projects (is_training=False).",
        )
        parser.add_argument(
            "--json", dest="as_json", action="store_true",
            help="Emit structured machine-readable JSON instead of text.",
        )
        parser.add_argument(
            "--read-only", dest="read_only", action="store_true", default=True,
            help="Read-only audit (DEFAULT and only mode). No repair is performed; "
                 "there is deliberately no --fix.",
        )

    # ------------------------------------------------------------------ entry
    def handle(self, *args, **options):
        try:
            # Defence in depth: run inside a transaction that is ALWAYS rolled
            # back, so even an accidental write can never persist. The command
            # itself issues only SELECTs.
            with transaction.atomic():
                report = self._build_report(options)
                transaction.set_rollback(True)
        except Exception as exc:  # execution failure -> exit 1
            self.stderr.write(self.style.ERROR(f"check_project_parity failed: {exc}"))
            self.stderr.write(traceback.format_exc())
            raise SystemExit(1)

        if options.get("as_json"):
            self.stdout.write(json.dumps(report, indent=2, default=str))
        else:
            self._render_text(report)
        # Always exit 0: mismatches are the finding, not a failure.

    # ---------------------------------------------------------------- builder
    def _build_report(self, options):
        qs = Project.objects.all().order_by("id")
        if options.get("project") is not None:
            qs = qs.filter(id=options["project"])
        if options.get("live_only"):
            qs = qs.filter(is_training=False)

        name_list_checker = _load_name_list_checker()

        report = {
            "meta": {
                "read_only": True,
                "raw_data_unchanged": True,
                "uses_current_runtime_hierarchy": True,
                "historical_attribution_note": (
                    "RAW DATA IS UNCHANGED. THIS REPORT USES CURRENT RUNTIME "
                    "HIERARCHY. HISTORICAL COORDINATOR ATTRIBUTION MAY THEREFORE "
                    "REFLECT CURRENT HIERARCHY."
                ),
                "name_list_available": bool(name_list_checker),
                "project_count": qs.count(),
            },
            "projects": [],
        }
        for project in qs:
            report["projects"].append(
                self._project_report(project, name_list_checker)
            )
        return report

    def _project_report(self, project, name_list_checker):
        mode = "training" if project.is_training else "live"

        # Project org rows + Organization objects (single fetch, read-only).
        po_rows = list(
            ProjectOrganization.objects.filter(project=project).select_related(
                "organization"
            )
        )
        org_by_id = {r.organization_id: r.organization for r in po_rows}
        po_by_org = {r.organization_id: r for r in po_rows}
        active_scope_ids = {
            r.organization_id for r in po_rows if r.is_active
        } or set(project.organizations.values_list("id", flat=True))

        # --- Hierarchy parity (three representations) ---
        e_table = _edges_from_table(project)
        e_pa = _edges_from_parent_assignment(project)
        e_json = _edges_from_json(project, active_scope_ids)

        parents_table = {p for p, _ in e_table}
        children_table = {c for _, c in e_table}
        children_by_parent = defaultdict(set)
        parents_by_child = defaultdict(set)
        parent_by_child = {}
        for p, c in e_table:
            children_by_parent[p].add(c)
            parents_by_child[c].add(p)
            parent_by_child[c] = p  # last wins; multi-parent is flagged separately

        # Structural hierarchy warnings (read-only). POH's unique_together already
        # blocks exact duplicate edges, so we surface the states it does NOT: an
        # org under more than one coordinator (conflicting parents) and 2-cycles.
        multi_parent_orgs = sorted(c for c, ps in parents_by_child.items() if len(ps) > 1)
        cyclic_edge_pairs = sorted(
            [sorted((a, b)) for (a, b) in e_table if (b, a) in e_table and a < b]
        )
        # Duplicate ACTIVE indicator assignments per (project_indicator, org).
        # unique_together(project_indicator, organization) makes this structurally
        # impossible; we still check so the report PROVES it rather than assuming.
        duplicate_active_assignments = [
            {"project_indicator_id": r["project_indicator_id"],
             "organization_id": r["organization_id"], "count": r["n"]}
            for r in ProjectIndicatorAssignment.objects.filter(
                project_indicator__project=project, is_active=True,
            ).values("project_indicator_id", "organization_id")
            .annotate(n=Count("id")).filter(n__gt=1)
        ]

        hierarchy_parity = {
            "table_edges": sorted(map(list, e_table)),
            "parent_assignment_edges": sorted(map(list, e_pa)),
            "json_edges": sorted(map(list, e_json)),
            "table_vs_parent_assignment_symdiff": sorted(map(list, e_table ^ e_pa)),
            "table_vs_json_symdiff": sorted(map(list, e_table ^ e_json)),
            "parent_assignment_vs_json_symdiff": sorted(map(list, e_pa ^ e_json)),
            "status": "HIERARCHY_MATCH"
            if (e_table == e_pa == e_json)
            else "HIERARCHY_MISMATCH",
            "structural_warnings": {
                "multi_parent_orgs": multi_parent_orgs,
                "cyclic_edge_pairs": cyclic_edge_pairs,
                "duplicate_active_assignments": duplicate_active_assignments,
            },
        }
        multi_parent_set = set(multi_parent_orgs)

        # Indicator code lookup for readable output (bounded to this project).
        ind_code = {
            pi_ind_id: code
            for pi_ind_id, code in ProjectIndicator.objects.filter(project=project)
            .values_list("indicator_id", "indicator__code")
        }

        # Fallback classification for the whole project (mirrors the priority in
        # get_assigned_indicator_ids_for_organization).
        proj_has_assignments = _has_project_indicator_assignments(project.id)
        proj_has_targets = _has_project_indicator_targets(project.id)
        if proj_has_assignments:
            eligibility_source = "assignment"
        elif proj_has_targets:
            eligibility_source = "target_derived"
        else:
            eligibility_source = "all_project_fallback"

        organizations = []
        coordinators = []
        for r in po_rows:
            organizations.append(
                self._org_report(
                    project, r, org_by_id, mode, eligibility_source,
                    ind_code, parents_table, children_table, parent_by_child,
                    multi_parent_set, name_list_checker,
                )
            )

        # --- Coordinator subtree (per parent-edge coordinator) ---
        for coord_org_id in sorted(parents_table):
            direct_children = sorted(children_by_parent.get(coord_org_id, set()))
            descendants = sorted(
                get_project_subtree_org_ids(project, coord_org_id) - {coord_org_id}
            )
            resolver_scope = sorted(
                resolve_organization_scope_with_project_hierarchy(
                    coord_org_id, project=project
                )
            )
            coordinators.append({
                "coordinator_org_id": coord_org_id,
                "coordinator_name": getattr(
                    org_by_id.get(coord_org_id), "name", str(coord_org_id)
                ),
                "direct_children": direct_children,
                "descendants": descendants,
                "resolver_scope": resolver_scope,
                "subtree_vs_resolver_symdiff": sorted(
                    set(descendants + [coord_org_id]) ^ set(resolver_scope)
                ),
            })

        return {
            "project_id": project.id,
            "project_code": project.code,
            "project_name": project.name,
            "mode": mode.upper(),
            "is_training": project.is_training,
            "eligibility_source": eligibility_source,
            "hierarchy_parity": hierarchy_parity,
            "organizations": organizations,
            "coordinators": coordinators,
        }

    def _org_report(
        self, project, po_row, org_by_id, mode, eligibility_source,
        ind_code, parents_table, children_table, parent_by_child,
        multi_parent_orgs, name_list_checker,
    ):
        org = po_row.organization
        org_id = po_row.organization_id
        flags = []
        if org_id in multi_parent_orgs:
            # Org sits under more than one coordinator in the active hierarchy.
            flags.append("MULTIPLE_ACTIVE_PARENTS")

        # --- Hierarchy position (from the table) ---
        table_parent = parent_by_child.get(org_id)
        is_parent_edge = org_id in parents_table
        is_child_edge = org_id in children_table

        # --- Coordinator parity (flags vs edges vs name-list) ---
        name_list_coord = None
        if name_list_checker is not None:
            try:
                name_list_coord = bool(name_list_checker({
                    "name": getattr(org, "name", ""),
                    "type": getattr(org, "type", ""),
                }))
            except Exception:
                name_list_coord = None

        if po_row.is_coordinator and not is_parent_edge:
            flags.append("COORDINATOR_FLAG_BUT_NO_PARENT_EDGE")
        if is_parent_edge and not po_row.is_coordinator:
            flags.append("PARENT_EDGE_BUT_NOT_COORDINATOR")
        if po_row.is_sub_grantee and not is_child_edge:
            flags.append("SUBGRANTEE_FLAG_WITHOUT_PARENT")
        determinations = {po_row.is_coordinator, is_parent_edge}
        if name_list_coord is not None:
            determinations.add(name_list_coord)
        if len(determinations) > 1:
            flags.append("MULTIPLE_COORDINATOR_DETERMINATIONS")

        # --- Workbook resolution (SAME runtime resolver) ---
        layout = resolve_layout_for_org(project, org, mode=mode)
        ancestors = get_project_ancestor_org_ids(project, org_id)  # [self, ...ancestors]
        if layout is None:
            wb_resolution = "NONE"
            wb_owner = None
            placed_ids = set()
        else:
            wb_owner = layout.coordinator_organization_id
            wb_resolution = "SELF" if wb_owner == org_id else "ANCESTOR"
            placed_ids = {
                it.indicator_id for it in layout.items.all() if it.indicator_id
            }
            # nearest coordinator ancestor per the table (excluding self unless
            # self is a parent-edge)
            nearest_coord = next(
                (a for a in ancestors if a in parents_table), None
            )
            if wb_resolution == "ANCESTOR" and nearest_coord is not None and wb_owner != nearest_coord:
                flags.append("INHERITED_FROM_UNEXPECTED_ANCESTOR")
            if wb_owner not in parents_table and wb_resolution != "SELF":
                flags.append("WORKBOOK_OWNER_NOT_A_COORDINATOR")
            elif wb_owner not in parents_table and wb_resolution == "SELF" and not is_parent_edge:
                # self owns a layout but is not a coordinator in the hierarchy
                flags.append("NON_COORDINATOR_OWNS_WORKBOOK")

        # --- Assignments / eligibility ---
        direct_rows = list(
            ProjectIndicatorAssignment.objects.filter(
                project_indicator__project=project,
                organization_id=org_id,
                is_active=True,
            ).values_list(
                "project_indicator__indicator_id", "assignment_source"
            )
        )
        direct_ids = {ind for ind, _ in direct_rows}
        direct_sources = sorted({src for _, src in direct_rows})

        target_ids = set(
            ProjectIndicatorOrganizationTarget.objects.filter(
                project_indicator__project=project,
                organization_id=org_id,
            ).values_list("project_indicator__indicator_id", flat=True)
        )

        # The effective assigned pool exactly as the runtime computes it.
        assigned_ids = get_assigned_indicator_ids_for_organization(
            project=project, organization_id=org_id
        )

        # Effective workbook set mirrors order_plans_by_layout: intersect with the
        # layout's placed indicators when the layout actually places any; else the
        # full assigned pool (no-layout / headings-only fallback).
        layout_places_indicators = bool(placed_ids)
        if layout_places_indicators:
            effective_ids = assigned_ids & placed_ids
        else:
            effective_ids = set(assigned_ids)

        assigned_not_in_workbook = (
            sorted(assigned_ids - placed_ids) if layout_places_indicators else []
        )
        workbook_not_assigned = (
            sorted(placed_ids - assigned_ids) if layout_places_indicators else []
        )

        # Eligibility flags.
        if po_row.can_report_indicators and not assigned_ids:
            flags.append("CAN_REPORT_TRUE_NO_ASSIGNMENTS")
        if direct_ids and not po_row.can_report_indicators:
            flags.append("ASSIGNMENTS_BUT_CANNOT_REPORT")
        if assigned_not_in_workbook:
            flags.append("ASSIGNED_NOT_IN_WORKBOOK")
        if workbook_not_assigned:
            flags.append("WORKBOOK_NOT_ASSIGNED")
        if eligibility_source == "all_project_fallback" and assigned_ids:
            flags.append("INDICATORS_VIA_ALL_PROJECT_FALLBACK")
        if eligibility_source == "target_derived" and assigned_ids:
            flags.append("INDICATORS_VIA_TARGET_DERIVED")
        # Assignment vs target-derived contradiction (only meaningful when the
        # project uses assignments as the primary source).
        if eligibility_source == "assignment" and target_ids and (target_ids - direct_ids):
            flags.append("TARGET_INDICATORS_NOT_DIRECTLY_ASSIGNED")

        # --- Historical attribution warning (read-only counts) ---
        historical = self._historical_note(project, org_id, table_parent, org_by_id)
        if historical.get("current_coordinator_org_id") and historical.get("aggregate_count"):
            flags.append("HISTORICAL_ATTRIBUTION_USES_CURRENT_HIERARCHY")

        return {
            "org_id": org_id,
            "org_name": getattr(org, "name", str(org_id)),
            "org_code": getattr(org, "code", ""),
            "role": po_row.role,
            "flags_stored": {
                "is_coordinator": bool(po_row.is_coordinator),
                "is_sub_grantee": bool(po_row.is_sub_grantee),
                "is_implementer": bool(po_row.is_implementer),
                "can_report_indicators": bool(po_row.can_report_indicators),
            },
            "hierarchy": {
                "parent_org_id_table": table_parent,
                "children_table": sorted(
                    c for (p, c) in [(table_parent, org_id)] if False
                ) or sorted(
                    [c for c in children_table if parent_by_child.get(c) == org_id]
                ),
                "is_parent_edge": is_parent_edge,
                "is_child_edge": is_child_edge,
                "name_list_coordinator": name_list_coord,
            },
            "workbook": {
                "resolution": wb_resolution,
                "owner_org_id": wb_owner,
                "owner_name": getattr(org_by_id.get(wb_owner), "name", None) if wb_owner else None,
                "mode": mode,
                "placed_indicator_ids": sorted(placed_ids),
                "placed_indicator_codes": sorted(
                    ind_code.get(i, str(i)) for i in placed_ids
                ),
                "ancestor_chain": ancestors,
            },
            "assignments": {
                "direct_indicator_ids": sorted(direct_ids),
                "direct_sources": direct_sources,
                "target_derived_indicator_ids": sorted(target_ids),
                "eligibility_source": eligibility_source,
            },
            "effective": {
                "assigned_indicator_ids": sorted(assigned_ids),
                "workbook_indicator_ids": sorted(placed_ids),
                "effective_indicator_ids": sorted(effective_ids),
                "assigned_not_in_workbook": assigned_not_in_workbook,
                "workbook_not_assigned": workbook_not_assigned,
            },
            "historical": historical,
            "flags": flags,
        }

    def _historical_note(self, project, org_id, table_parent, org_by_id):
        """Read-only counts + a plain statement that current hierarchy drives
        attribution. Never reconstructs historical hierarchy."""
        from aggregates.models import Aggregate
        from respondents.models import Respondent

        aggregate_count = Aggregate.objects.filter(
            project=project, organization_id=org_id
        ).count()
        # Respondents carry no project FK; count by org and note the caveat.
        respondent_count = Respondent.objects.filter(organization_id=org_id).count()

        return {
            "aggregate_count": aggregate_count,
            "respondent_count_org_wide": respondent_count,
            "respondent_count_caveat": "Respondents are not project-scoped; org-wide count.",
            "current_coordinator_org_id": table_parent,
            "current_coordinator_name": getattr(
                org_by_id.get(table_parent), "name", None
            ) if table_parent else None,
            "note": (
                "Raw rows are unchanged. If this org's hierarchy parent changes, "
                "these historical records would be attributed to the new "
                "coordinator by all read-time rollups."
            ) if aggregate_count else "",
        }

    # ------------------------------------------------------------------ render
    def _render_text(self, report):
        w = self.stdout.write
        w("=" * 60)
        w("PROJECT PARITY REPORT (READ-ONLY)")
        w("=" * 60)
        w("RAW DATA IS UNCHANGED.")
        w("THIS REPORT USES CURRENT RUNTIME HIERARCHY.")
        w("HISTORICAL COORDINATOR ATTRIBUTION MAY THEREFORE REFLECT CURRENT HIERARCHY.")
        w(f"Projects audited: {report['meta']['project_count']}  "
          f"(name-list check available: {report['meta']['name_list_available']})")
        w("")

        for p in report["projects"]:
            w("-" * 60)
            w(f"Project: {p['project_name']} ({p['project_code']}, id={p['project_id']})")
            w(f"Mode: {p['mode']}    Read-only: YES    Eligibility source: {p['eligibility_source']}")
            hp = p["hierarchy_parity"]
            w(f"Hierarchy parity: {hp['status']}")
            if hp["status"] != "HIERARCHY_MATCH":
                w(f"  table vs parent_assignment symdiff: {hp['table_vs_parent_assignment_symdiff']}")
                w(f"  table vs json symdiff:              {hp['table_vs_json_symdiff']}")
                w(f"  parent_assignment vs json symdiff:  {hp['parent_assignment_vs_json_symdiff']}")
            sw = hp.get("structural_warnings", {})
            if sw.get("multi_parent_orgs") or sw.get("cyclic_edge_pairs") or sw.get("duplicate_active_assignments"):
                w(f"  Structural warnings: multi_parent_orgs={sw.get('multi_parent_orgs')} "
                  f"cyclic_edge_pairs={sw.get('cyclic_edge_pairs')} "
                  f"duplicate_active_assignments={sw.get('duplicate_active_assignments')}")
            w("")

            for o in p["organizations"]:
                w(f"  Organization: {o['org_name']} ({o['org_code']}, id={o['org_id']})  role={o['role']}")
                sf = o["flags_stored"]
                w(f"    Stored flags: coord={sf['is_coordinator']} sub={sf['is_sub_grantee']} "
                  f"impl={sf['is_implementer']} can_report={sf['can_report_indicators']}")
                h = o["hierarchy"]
                w(f"    Hierarchy: parent(POH)={h['parent_org_id_table']} "
                  f"children(POH)={h['children_table']} "
                  f"parent_edge={h['is_parent_edge']} child_edge={h['is_child_edge']} "
                  f"name_list_coord={h['name_list_coordinator']}")
                wb = o["workbook"]
                w(f"    Workbook: resolution={wb['resolution']} owner={wb['owner_org_id']} "
                  f"({wb['owner_name']}) mode={wb['mode']} placed={wb['placed_indicator_codes']}")
                a = o["assignments"]
                w(f"    Assignments: direct={a['direct_indicator_ids']} sources={a['direct_sources']} "
                  f"target_derived={a['target_derived_indicator_ids']}")
                e = o["effective"]
                w(f"    Effective: assigned={e['assigned_indicator_ids']} "
                  f"workbook={e['workbook_indicator_ids']} effective={e['effective_indicator_ids']}")
                if e["assigned_not_in_workbook"]:
                    w(f"      assigned-but-not-in-workbook: {e['assigned_not_in_workbook']}")
                if e["workbook_not_assigned"]:
                    w(f"      workbook-but-not-assigned:    {e['workbook_not_assigned']}")
                hist = o["historical"]
                if hist.get("aggregate_count"):
                    w(f"    Historical: {hist['aggregate_count']} aggregate row(s) "
                      f"currently attributed under coordinator "
                      f"{hist['current_coordinator_name']} (org {hist['current_coordinator_org_id']}).")
                if o["flags"]:
                    w("    Flags:")
                    for f in o["flags"]:
                        w(f"      - {f}")
                w("")

            if p["coordinators"]:
                w("  Coordinator subtrees:")
                for c in p["coordinators"]:
                    w(f"    {c['coordinator_name']} (org {c['coordinator_org_id']}): "
                      f"children={c['direct_children']} descendants={c['descendants']} "
                      f"resolver_scope={c['resolver_scope']}")
                    if c["subtree_vs_resolver_symdiff"]:
                        w(f"      subtree vs resolver symdiff: {c['subtree_vs_resolver_symdiff']}")
                w("")

        w("=" * 60)
        w("END OF REPORT — NO DATA WAS MODIFIED (transaction rolled back).")
        w("=" * 60)
