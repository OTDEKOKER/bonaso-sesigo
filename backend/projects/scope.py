"""Project-hierarchy scope resolution.

This is the single place that answers "which organizations may a user see WITHIN
a given project" using the project hierarchy (``ProjectOrganizationHierarchy``)
as the source of truth — NOT the global ``Organization.parent`` tree.

Product decisions encoded here (2026-06-09):
  * Project hierarchy is the official source of truth for org relationships.
  * Hierarchy-scoped data requires a project: with no project there is no
    hierarchy scope, so the resolvers return an empty set rather than falling
    back to the global tree.

These helpers are intentionally side-effect free and are NOT yet wired into the
dashboard/aggregate/respondent read paths — that wiring is staged separately
behind ``HIERARCHY_SOURCE`` (see docs/SESIGO_HIERARCHY_AND_IMPLEMENTATION_PLAN).
"""

from __future__ import annotations

from collections import defaultdict

from django.db import DatabaseError

from organizations.access import is_organization_admin

from .assignment_rules import get_project_organization_scope_ids
from .models import ProjectOrganization, ProjectOrganizationHierarchy

# Project roles whose holders see the WHOLE project (overseer / funder view),
# rather than just their own subtree.
PROJECT_WIDE_ROLES = {"lead", "funder"}


def get_user_project_ids(user):
    """Return the set of project ids a user is assigned to, or ``None`` for
    admins (meaning "all projects — no project-assignment restriction").

    Non-admin users only see data for projects in ``user.assigned_projects``.
    """
    if is_organization_admin(user):
        return None
    if user is None or not getattr(user, "pk", None):
        return set()
    try:
        return set(user.assigned_projects.values_list("id", flat=True))
    except DatabaseError:
        return set()


def get_default_project_id(user, *, include_training: bool = False):
    """The project a user should land on by default (the "current project").

    Because hierarchy-scoped data requires a selected project, the UI should
    always preselect one. We pick the most recent **active** project the user can
    access; if none is active, fall back to the most recent accessible project of
    any status. Returns a project id, or ``None`` if the user can access none.

    Live mode excludes training projects by default; pass ``include_training`` in
    Training Mode.
    """
    from .models import Project

    base = Project.objects.all()
    # Live mode → live projects only; Training Mode → training projects only.
    base = base.filter(is_training=bool(include_training))

    project_ids = get_user_project_ids(user)  # None = admin (all projects)
    if project_ids is not None:
        if not project_ids:
            return None
        base = base.filter(id__in=project_ids)

    active = base.filter(status="active").order_by("-start_date").values_list("id", flat=True).first()
    if active is not None:
        return active
    return base.order_by("-start_date").values_list("id", flat=True).first()


def filter_queryset_by_assigned_projects(
    queryset,
    user,
    project_field: str = "project_id",
    *,
    include_null_project: bool = False,
):
    """Narrow a queryset to rows whose project the user is assigned to.

    Additive, safe gate for list endpoints: admins/staff are unaffected (see
    all); other users see only rows linked to a project in their
    ``assigned_projects``. ``project_field`` is the lookup to the project id
    (e.g. ``project_id``, ``project__id``, ``event__project_id``).

    By default rows with a NULL project are excluded for non-admins (no project
    → no project assignment can authorize them). Pass ``include_null_project``
    for models where a NULL project is legitimate and authorized by other scope
    (e.g. org-level events): such rows are then kept.

    This gate only ever NARROWS visibility, never widens it. A non-admin user
    with NO project assignments is treated as "not yet scoped by project" and
    the queryset is returned unchanged so the caller's existing organization
    scope still governs — this keeps the rollout safe (no user is locked out
    before admins assign them) while strictly scoping any user who HAS
    assignments.
    """
    from django.db.models import Q

    project_ids = get_user_project_ids(user)  # None = admin (all projects)
    if project_ids is None:
        return queryset
    if not project_ids:
        # No assignments yet → do not restrict by project (org scope applies).
        return queryset
    condition = Q(**{f"{project_field}__in": project_ids})
    if include_null_project:
        condition = condition | Q(**{f"{project_field}__isnull": True})
    return queryset.filter(condition)


def user_can_access_project(user, project) -> bool:
    """True if the user may access this project at all (project-assignment gate).

    Admins/staff may access any project; other users must be explicitly assigned.
    """
    if project is None:
        return False
    if is_organization_admin(user):
        return True
    if user is None or not getattr(user, "pk", None):
        return False
    try:
        return user.assigned_projects.filter(id=project.id).exists()
    except DatabaseError:
        return False


def get_project_subtree_org_ids(project, root_org_id) -> set[int]:
    """Return ``root_org_id`` plus all of its descendants in *this project's*
    hierarchy (active ``ProjectOrganizationHierarchy`` edges only).

    A coordinator therefore resolves to itself + its sub-grantees; a leaf
    sub-grantee resolves to just itself. The walk is cycle-safe.
    """
    if project is None or root_org_id is None:
        return set()
    try:
        root_org_id = int(root_org_id)
    except (TypeError, ValueError):
        return set()

    try:
        edges = list(
            ProjectOrganizationHierarchy.objects.filter(
                project=project,
                is_active=True,
            ).values_list("parent_organization_id", "child_organization_id")
        )
    except DatabaseError:
        return {root_org_id}

    children: dict[int, list[int]] = defaultdict(list)
    for parent_id, child_id in edges:
        children[parent_id].append(child_id)

    seen: set[int] = {root_org_id}
    stack = [root_org_id]
    while stack:
        current = stack.pop()
        for child_id in children.get(current, []):
            if child_id not in seen:
                seen.add(child_id)
                stack.append(child_id)
    return seen


def get_user_project_scope(user, project) -> set[int]:
    """Org ids a ``user`` may see WITHIN ``project``, via project hierarchy.

    Rules:
      * No project → empty set (hierarchy-scoped data requires a project).
      * Platform admin / staff / superuser → all active orgs in the project.
      * User NOT assigned to the project → empty set (project-assignment gate).
      * User whose org is not in the project → empty set.
      * Project role lead/funder → the whole project (overseer / funder view).
      * Otherwise → the user's own org + its project subtree (coordinators get
        their cluster; sub-grantees / implementers get just themselves).
    """
    if project is None:
        return set()

    all_project_orgs = get_project_organization_scope_ids(project)

    if is_organization_admin(user):
        return set(all_project_orgs)

    # Project-assignment gate: non-admins must be assigned to the project.
    if not user_can_access_project(user, project):
        return set()

    user_org_id = getattr(user, "organization_id", None)
    if not user_org_id or user_org_id not in all_project_orgs:
        return set()

    try:
        membership = (
            ProjectOrganization.objects.filter(
                project=project,
                organization_id=user_org_id,
                is_active=True,
            )
            .only("role")
            .first()
        )
    except DatabaseError:
        membership = None

    if membership and membership.role in PROJECT_WIDE_ROLES:
        return set(all_project_orgs)

    subtree = get_project_subtree_org_ids(project, user_org_id)
    # Never widen beyond the active project scope.
    return subtree & set(all_project_orgs)
