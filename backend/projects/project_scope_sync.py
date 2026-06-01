from __future__ import annotations

from django.db import DatabaseError, transaction
from django.utils import timezone

from .hierarchy import normalize_project_hierarchy_overrides
from .models import (
    ProjectIndicatorAssignment,
    ProjectOrganization,
    ProjectOrganizationHierarchy,
)
from .project_indicator_scope_sync import ensure_project_indicator_assignments


@transaction.atomic
def sync_project_scope_tables(project) -> None:
    """
    Keep additive Phase 2 project-scope tables in sync with legacy fields.

    Legacy source-of-truth (for now):
      - Project.organizations M2M
      - Project.hierarchy_overrides JSON

    This preserves existing behavior while enabling migration to project-scoped
    hierarchy tables without forcing endpoint changes yet.
    """

    if project is None or project.pk is None:
        return

    now = timezone.now()
    try:
        project_org_ids = set(project.organizations.values_list('id', flat=True))
    except DatabaseError:
        return

    try:
        existing_memberships = {
            row.organization_id: row
            for row in ProjectOrganization.objects.filter(project=project)
        }
    except DatabaseError:
        # Phase 2 table not migrated yet; preserve legacy behavior.
        return

    for organization_id in project_org_ids:
        membership = existing_memberships.get(organization_id)
        if membership is None:
            ProjectOrganization.objects.create(
                project=project,
                organization_id=organization_id,
                is_active=True,
            )
            continue
        if not membership.is_active:
            membership.is_active = True
            membership.save(update_fields=['is_active', 'updated_at'])

    stale_membership_ids = [
        membership.id
        for organization_id, membership in existing_memberships.items()
        if organization_id not in project_org_ids and membership.is_active
    ]
    if stale_membership_ids:
        ProjectOrganization.objects.filter(id__in=stale_membership_ids).update(
            is_active=False,
            updated_at=now,
        )

    try:
        normalized_overrides = normalize_project_hierarchy_overrides(
            getattr(project, 'hierarchy_overrides', {}) or {},
            allowed_org_ids=project_org_ids,
        )
    except ValueError:
        normalized_overrides = {}

    desired_links = {
        (int(parent_organization_id), int(child_organization_id))
        for parent_organization_id, children in normalized_overrides.items()
        for child_organization_id in children
        if int(parent_organization_id) != int(child_organization_id)
    }

    try:
        existing_links = {
            (row.parent_organization_id, row.child_organization_id): row
            for row in ProjectOrganizationHierarchy.objects.filter(project=project)
        }
    except DatabaseError:
        existing_links = {}

    for parent_organization_id, child_organization_id in desired_links:
        hierarchy_link = existing_links.get((parent_organization_id, child_organization_id))
        if hierarchy_link is None:
            ProjectOrganizationHierarchy.objects.create(
                project=project,
                parent_organization_id=parent_organization_id,
                child_organization_id=child_organization_id,
                is_active=True,
            )
            continue
        if not hierarchy_link.is_active:
            hierarchy_link.is_active = True
            hierarchy_link.save(update_fields=['is_active', 'updated_at'])

    stale_hierarchy_ids = [
        hierarchy_link.id
        for hierarchy_key, hierarchy_link in existing_links.items()
        if hierarchy_key not in desired_links and hierarchy_link.is_active
    ]
    if stale_hierarchy_ids:
        ProjectOrganizationHierarchy.objects.filter(id__in=stale_hierarchy_ids).update(
            is_active=False,
            updated_at=now,
        )

    # Keep project-scope indicator assignments aligned for compatibility.
    project_indicators = list(project.projectindicator_set.only('id', 'project_id').all())
    for project_indicator in project_indicators:
        ensure_project_indicator_assignments(
            project_indicator,
            organization_ids=project_org_ids,
            source='project_scope',
        )

    if project_org_ids:
        try:
            ProjectIndicatorAssignment.objects.filter(
                project_indicator__project=project,
                assignment_source='project_scope',
                is_active=True,
            ).exclude(
                organization_id__in=project_org_ids
            ).update(
                is_active=False,
                updated_at=now,
            )
        except DatabaseError:
            return
