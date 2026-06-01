from __future__ import annotations

from django.db import DatabaseError
from django.db import transaction

from .models import ProjectIndicatorAssignment, ProjectOrganization

_SOURCE_PRECEDENCE = {
    'project_scope': 10,
    'aggregate_history': 20,
    'organization_target': 30,
    'manual': 40,
}


def _source_rank(source: str) -> int:
    return _SOURCE_PRECEDENCE.get(str(source or ''), 0)


def _active_project_org_ids(project) -> set[int]:
    try:
        scoped_org_ids = set(
            ProjectOrganization.objects.filter(
                project=project,
                is_active=True,
            ).values_list('organization_id', flat=True)
        )
    except DatabaseError:
        scoped_org_ids = set()

    if scoped_org_ids:
        return scoped_org_ids

    try:
        return set(project.organizations.values_list('id', flat=True))
    except DatabaseError:
        return set()


def _active_project_org_assignment_ids(project) -> dict[int, int]:
    try:
        rows = ProjectOrganization.objects.filter(
            project=project,
            is_active=True,
        ).values_list('organization_id', 'id')
        mapping = {int(organization_id): int(assignment_id) for organization_id, assignment_id in rows}
        if mapping:
            return mapping
    except DatabaseError:
        pass

    try:
        rows = ProjectOrganization.objects.filter(
            project=project,
        ).values_list('organization_id', 'id')
        return {int(organization_id): int(assignment_id) for organization_id, assignment_id in rows}
    except DatabaseError:
        return {}


@transaction.atomic
def ensure_project_indicator_assignments(
    project_indicator,
    *,
    organization_ids: list[int] | set[int] | tuple[int, ...] | None = None,
    source: str = 'project_scope',
) -> None:
    """
    Ensure assignment rows exist while preserving legacy behavior.

    Phase 3 foundation only: this writes additive assignment rows but does not
    change existing API filtering behavior yet.
    """

    if project_indicator is None:
        return

    if organization_ids is None:
        organization_ids = _active_project_org_ids(project_indicator.project)
    target_org_ids = {
        int(org_id)
        for org_id in organization_ids
        if isinstance(org_id, int) or str(org_id).isdigit()
    }
    if not target_org_ids:
        return

    assignment_id_by_org_id = _active_project_org_assignment_ids(project_indicator.project)

    try:
        existing_rows = {
            row.organization_id: row
            for row in ProjectIndicatorAssignment.objects.filter(
                project_indicator=project_indicator,
                organization_id__in=target_org_ids,
            )
        }
    except DatabaseError:
        return

    for organization_id in target_org_ids:
        row = existing_rows.get(organization_id)
        if row is None:
            try:
                assignment_id = assignment_id_by_org_id.get(int(organization_id))
                ProjectIndicatorAssignment.objects.create(
                    project_indicator=project_indicator,
                    project_organization_id=assignment_id,
                    organization_id=organization_id,
                    assignment_source=source,
                    is_active=True,
                )
            except DatabaseError:
                return
            continue

        should_promote_source = _source_rank(source) > _source_rank(row.assignment_source)
        assignment_id = assignment_id_by_org_id.get(int(organization_id))
        should_link_assignment = assignment_id and row.project_organization_id != assignment_id
        if row.is_active and not should_promote_source and not should_link_assignment:
            continue

        row.is_active = True
        if should_promote_source:
            row.assignment_source = source
        if should_link_assignment:
            row.project_organization_id = assignment_id
            row.organization_id = organization_id
            row.save(update_fields=['is_active', 'assignment_source', 'project_organization', 'organization', 'updated_at'])
        else:
            row.save(update_fields=['is_active', 'assignment_source', 'updated_at'])
