from __future__ import annotations

from django.db import DatabaseError
from django.db.models import Q

from .models import (
    Project,
    ProjectIndicator,
    ProjectIndicatorAssignment,
    ProjectIndicatorDisaggregationRule,
    ProjectIndicatorOrganizationTarget,
    ProjectOrganization,
)


def get_project_organization_scope_ids(project: Project) -> set[int]:
    """Return project-scoped organization ids with legacy-safe fallbacks."""

    if project is None:
        return set()

    try:
        scoped_org_ids = set(
            ProjectOrganization.objects.filter(
                project=project,
                is_active=True,
            ).values_list('organization_id', flat=True)
        )
        if scoped_org_ids:
            return scoped_org_ids
    except DatabaseError:
        pass

    try:
        return set(project.organizations.values_list('id', flat=True))
    except DatabaseError:
        return set()


def is_organization_in_project_scope(project: Project, organization_id: int) -> bool:
    scoped_org_ids = get_project_organization_scope_ids(project)
    if not scoped_org_ids:
        return True
    return int(organization_id) in scoped_org_ids


def _project_indicator_ids(project_id: int) -> set[int]:
    try:
        return set(
            ProjectIndicator.objects.filter(project_id=project_id).values_list(
                'indicator_id',
                flat=True,
            )
        )
    except DatabaseError:
        return set()


def _has_project_indicator_assignments(project_id: int) -> bool:
    try:
        return ProjectIndicatorAssignment.objects.filter(
            project_indicator__project_id=project_id
        ).exists()
    except DatabaseError:
        return False


def _has_project_indicator_targets(project_id: int) -> bool:
    try:
        return ProjectIndicatorOrganizationTarget.objects.filter(
            project_indicator__project_id=project_id
        ).exists()
    except DatabaseError:
        return False


def get_assigned_indicator_ids_for_organization(
    *,
    project: Project,
    organization_id: int,
) -> set[int]:
    """
    Resolve assigned indicator ids for a project/organization.

    Priority:
      1) ProjectIndicatorAssignment rows when present for the project.
      2) ProjectIndicatorOrganizationTarget rows when present for the project.
      3) All project indicators (legacy fallback) for organizations in scope.
    """

    project_id = int(project.id)
    organization_id = int(organization_id)

    if not is_organization_in_project_scope(project, organization_id):
        return set()

    if _has_project_indicator_assignments(project_id):
        try:
            queryset = ProjectIndicatorAssignment.objects.filter(
                project_indicator__project_id=project_id,
                organization_id=organization_id,
                is_active=True,
            ).filter(
                Q(project_organization__isnull=True)
                | Q(
                    project_organization__is_active=True,
                    project_organization__can_report_indicators=True,
                )
            )
            return set(
                queryset.values_list(
                    'project_indicator__indicator_id',
                    flat=True,
                )
            )
        except DatabaseError:
            return set()

    if _has_project_indicator_targets(project_id):
        try:
            return set(
                ProjectIndicatorOrganizationTarget.objects.filter(
                    project_indicator__project_id=project_id,
                    organization_id=organization_id,
                ).values_list(
                    'project_indicator__indicator_id',
                    flat=True,
                )
            )
        except DatabaseError:
            return set()

    return _project_indicator_ids(project_id)


def is_indicator_assigned_to_organization(
    *,
    project: Project,
    indicator_id: int,
    organization_id: int,
) -> bool:
    indicator_id = int(indicator_id)
    assigned_indicator_ids = get_assigned_indicator_ids_for_organization(
        project=project,
        organization_id=int(organization_id),
    )
    return indicator_id in assigned_indicator_ids


def count_project_indicators_for_organization_scope(
    *,
    project: Project,
    organization_ids: set[int] | None,
) -> int:
    project_id = int(project.id)

    if _has_project_indicator_assignments(project_id):
        try:
            queryset = ProjectIndicatorAssignment.objects.filter(
                project_indicator__project_id=project_id,
                is_active=True,
            ).filter(
                Q(project_organization__isnull=True)
                | Q(
                    project_organization__is_active=True,
                    project_organization__can_report_indicators=True,
                )
            )
            if organization_ids is not None:
                if len(organization_ids) == 0:
                    return 0
                queryset = queryset.filter(organization_id__in=organization_ids)
            return queryset.values('project_indicator__indicator_id').distinct().count()
        except DatabaseError:
            return 0

    if _has_project_indicator_targets(project_id):
        try:
            queryset = ProjectIndicatorOrganizationTarget.objects.filter(
                project_indicator__project_id=project_id,
            )
            if organization_ids is not None:
                if len(organization_ids) == 0:
                    return 0
                queryset = queryset.filter(organization_id__in=organization_ids)
            return queryset.values('project_indicator__indicator_id').distinct().count()
        except DatabaseError:
            return 0

    project_scope_org_ids = get_project_organization_scope_ids(project)
    if organization_ids is not None and project_scope_org_ids:
        if len(project_scope_org_ids.intersection(organization_ids)) == 0:
            return 0
    return len(_project_indicator_ids(project_id))


def disaggregation_fields_by_indicator(
    *,
    project: Project,
    organization_id: int | None = None,
    indicator_ids: list[int] | set[int] | tuple[int, ...] | None = None,
) -> dict[int, list[str]]:
    """Return ordered disaggregation dimension keys per indicator for a project."""

    try:
        queryset = ProjectIndicatorDisaggregationRule.objects.filter(
            project_indicator__project=project,
            is_active=True,
        ).select_related('project_indicator')
    except DatabaseError:
        return {}

    if indicator_ids is not None:
        normalized_ids = {
            int(indicator_id)
            for indicator_id in indicator_ids
            if isinstance(indicator_id, int) or str(indicator_id).isdigit()
        }
        if not normalized_ids:
            return {}
        queryset = queryset.filter(project_indicator__indicator_id__in=normalized_ids)

    if organization_id is None:
        queryset = queryset.filter(organization_id__isnull=True)
    else:
        queryset = queryset.filter(
            Q(organization_id=int(organization_id)) | Q(organization_id__isnull=True)
        )

    rows = queryset.order_by(
        'project_indicator__indicator_id',
        'organization_id',
        'sort_order',
        'id',
    )

    fields_map: dict[int, list[str]] = {}
    seen: dict[int, set[str]] = {}

    for row in rows:
        indicator_id = int(row.project_indicator.indicator_id)
        field_key = str(row.dimension_key or '').strip()
        if not field_key:
            continue
        fields_map.setdefault(indicator_id, [])
        seen.setdefault(indicator_id, set())
        normalized = field_key.lower()
        if normalized in seen[indicator_id]:
            continue
        seen[indicator_id].add(normalized)
        fields_map[indicator_id].append(field_key)

    return fields_map
