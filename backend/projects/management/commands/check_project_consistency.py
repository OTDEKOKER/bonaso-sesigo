"""
Detect (and optionally repair) drift between the canonical project data and the
denormalized copies that are kept "for backward compatibility".

Two redundant-storage patterns exist in the schema, and when a write path updates
the canonical store but not its copies, the UI silently breaks (this is what caused
the NAHPA hierarchy to flatten). This command is the guardrail:

  Hierarchy
    canonical : ProjectOrganization.parent_assignment
    derived   : active ProjectOrganizationHierarchy links + Project.hierarchy_overrides

  Indicator targets
    canonical : ProjectIndicatorOrganizationTarget (per-organization quarterly rows)
    derived   : ProjectIndicator.q1..q4_target / target_value / baseline_value rollups

Usage:
    python manage.py check_project_consistency                # report all projects (read-only)
    python manage.py check_project_consistency --project 3    # one project
    python manage.py check_project_consistency --fix          # repair derived stores from canonical

Exit code is non-zero when drift is found and --fix was not used, so it can be
wired into CI or a scheduled job.
"""

from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum

from projects.models import (
    Project,
    ProjectIndicator,
    ProjectOrganization,
    ProjectOrganizationHierarchy,
)

ROLLUP_FIELDS = ['q1_target', 'q2_target', 'q3_target', 'q4_target', 'target_value', 'baseline_value']


class Command(BaseCommand):
    help = "Detect/repair drift between canonical project data and its denormalized copies."

    def add_arguments(self, parser):
        parser.add_argument('--project', type=int, default=None,
                            help='Limit to a single project id.')
        parser.add_argument('--fix', action='store_true',
                            help='Repair derived stores from the canonical source.')

    def handle(self, *args, **options):
        project_id = options['project']
        do_fix = options['fix']

        projects = Project.objects.all().order_by('id')
        if project_id is not None:
            projects = projects.filter(id=project_id)

        total_drift = 0
        for project in projects:
            drift = self._check_hierarchy(project, do_fix)
            drift += self._check_target_rollups(project, do_fix)
            total_drift += drift

        self.stdout.write("")
        if total_drift == 0:
            self.stdout.write(self.style.SUCCESS("No drift detected. Canonical and derived stores agree."))
            return
        if do_fix:
            self.stdout.write(self.style.SUCCESS(f"Repaired {total_drift} drifted item(s) from canonical source."))
            return
        self.stdout.write(self.style.ERROR(
            f"{total_drift} drifted item(s) detected. Re-run with --fix to repair."))
        raise SystemExit(1)

    # ------------------------------------------------------------------ hierarchy

    def _expected_edges(self, project):
        """Canonical parent_org -> child_org edges from ProjectOrganization.parent_assignment."""
        rows = ProjectOrganization.objects.filter(project=project).select_related('parent_assignment')
        by_id = {r.id: r for r in rows}
        edges = set()
        children_by_parent = defaultdict(list)
        for r in rows:
            pa_id = r.parent_assignment_id
            if pa_id and pa_id in by_id:
                parent_org = by_id[pa_id].organization_id
                child_org = r.organization_id
                if parent_org != child_org:
                    edges.add((parent_org, child_org))
                    children_by_parent[str(parent_org)].append(str(child_org))
        return edges, children_by_parent

    def _check_hierarchy(self, project, do_fix):
        expected, children_by_parent = self._expected_edges(project)

        active_links = set(
            ProjectOrganizationHierarchy.objects
            .filter(project=project, is_active=True)
            .values_list('parent_organization_id', 'child_organization_id')
        )
        link_missing = expected - active_links          # canonical edge with no active link
        link_extra = active_links - expected            # active link with no canonical edge

        overrides = project.hierarchy_overrides or {}
        expected_overrides = {k: set(v) for k, v in children_by_parent.items()}
        actual_overrides = {str(k): set(map(str, v or [])) for k, v in overrides.items()}
        overrides_drifted = expected_overrides != actual_overrides

        drift = 0
        if link_missing or link_extra or overrides_drifted:
            drift = 1
            self.stdout.write(self.style.WARNING(
                f"[hierarchy] project {project.id} ({project.code or project.name}): "
                f"{len(link_missing)} missing link(s), {len(link_extra)} stale link(s), "
                f"overrides {'DRIFTED' if overrides_drifted else 'ok'}"))

            if do_fix:
                with transaction.atomic():
                    if link_extra:
                        active_rows = ProjectOrganizationHierarchy.objects.filter(
                            project=project, is_active=True
                        ).values_list('id', 'parent_organization_id', 'child_organization_id')
                        ids_to_disable = [
                            lid for (lid, p_id, c_id) in active_rows if (p_id, c_id) in link_extra
                        ]
                        ProjectOrganizationHierarchy.objects.filter(id__in=ids_to_disable).update(is_active=False)
                    for parent_org, child_org in expected:
                        ProjectOrganizationHierarchy.objects.update_or_create(
                            project=project,
                            parent_organization_id=parent_org,
                            child_organization_id=child_org,
                            defaults={'is_active': True},
                        )
                    project.hierarchy_overrides = {k: list(v) for k, v in children_by_parent.items()}
                    project.save(update_fields=['hierarchy_overrides', 'updated_at'])
                self.stdout.write(self.style.SUCCESS(
                    f"          repaired hierarchy for project {project.id}"))
        return drift

    # -------------------------------------------------------------- target rollups

    def _check_target_rollups(self, project, do_fix):
        drift = 0
        pis = ProjectIndicator.objects.filter(project=project).prefetch_related('organization_targets')
        for pi in pis:
            org_targets = list(pi.organization_targets.all())
            if not org_targets:
                # No org-scoped rows -> legacy project-level target path; skip rollup check.
                continue
            totals = pi.organization_targets.aggregate(
                q1_target=Sum('q1_target'), q2_target=Sum('q2_target'),
                q3_target=Sum('q3_target'), q4_target=Sum('q4_target'),
                target_value=Sum('target_value'), baseline_value=Sum('baseline_value'),
            )
            expected = {f: (totals.get(f) or Decimal("0")) for f in ROLLUP_FIELDS}
            mismatched = [f for f in ROLLUP_FIELDS if Decimal(getattr(pi, f)) != Decimal(expected[f])]
            if mismatched:
                drift += 1
                self.stdout.write(self.style.WARNING(
                    f"[targets]   project {project.id} indicator_id={pi.id}: "
                    f"rollup drift on {', '.join(mismatched)}"))
                if do_fix:
                    for f in ROLLUP_FIELDS:
                        setattr(pi, f, expected[f])
                    pi.save(update_fields=ROLLUP_FIELDS)
                    self.stdout.write(self.style.SUCCESS(
                        f"          repaired rollup for indicator_id={pi.id}"))
        return drift
