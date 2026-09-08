"""Single interface for PROJECT-scoped hierarchy questions (POH-authoritative).

Architectural rule: any question about an organisation's parent/child,
position, ancestors/descendants, visibility scope, or coordinator/sub-grantee
role *within a project* must be answered from that project's
``ProjectOrganizationHierarchy`` (POH) — never the global ``Organization.parent``
tree (which is a directory of general organisational identity, not a programme
hierarchy, and cannot represent per-programme-year structures).

This module is a thin FACADE that reuses the existing project-scoped primitives
rather than reimplementing them, so runtime code stops independently
interpreting hierarchy:

  * ``projects.scope.get_project_subtree_org_ids`` — cycle-safe POH descent.
  * ``projects.derived_roles.derive_role_flags``   — POH-derived roles
    (coordinator = parent of a non-overseer edge; sub-grantee = child of a
    non-overseer edge; overseer = lead / funder).
  * ``ProjectOrganizationHierarchy`` active edges  — the canonical relation.

Read-only. No writes, no global-tree reads, no HIERARCHY_SOURCE dependency
(these answers are ALWAYS from POH by definition). ``project`` and
``organization`` accept either a model instance or an integer id.
"""
from __future__ import annotations

from projects.models import ProjectOrganization, ProjectOrganizationHierarchy

# Roles that sit ABOVE coordinators — an org directly under one of these is not
# a sub-grantee of it. Mirrors projects.derived_roles.OVERSEER_ROLES.
OVERSEER_ROLES = frozenset({"lead", "funder"})


def _id(obj):
    return getattr(obj, "id", obj)


def _active_edges(project_id):
    return list(
        ProjectOrganizationHierarchy.objects.filter(
            project_id=project_id, is_active=True
        ).values_list("parent_organization_id", "child_organization_id")
    )


def _member_org_ids(project_id) -> set[int]:
    return set(
        ProjectOrganization.objects.filter(project_id=project_id)
        .values_list("organization_id", flat=True)
    )


def _role(project_id, org_id):
    return (
        ProjectOrganization.objects.filter(project_id=project_id, organization_id=org_id)
        .values_list("role", flat=True)
        .first()
    )


# --- structural queries -----------------------------------------------------

def get_project_parents(project, organization) -> set[int]:
    """All active POH parent org ids of ``organization`` in ``project``.

    POH permits multiple parents; use :func:`get_project_parent` for the single
    canonical parent when a tree (one-parent) shape is expected.
    """
    pid, oid = _id(project), _id(organization)
    return {p for p, c in _active_edges(pid) if c == oid}


def get_project_parent(project, organization) -> int | None:
    """The single POH parent org id, or ``None`` (root / not a child)."""
    parents = get_project_parents(project, organization)
    return next(iter(parents)) if len(parents) == 1 else (min(parents) if parents else None)


def get_project_children(project, organization) -> set[int]:
    """Direct active POH child org ids of ``organization`` in ``project``."""
    pid, oid = _id(project), _id(organization)
    return {c for p, c in _active_edges(pid) if p == oid}


def get_project_ancestors(project, organization) -> list[int]:
    """Ancestor org ids up the project's POH, nearest first. Cycle-safe."""
    pid, oid = _id(project), _id(organization)
    parent_by_child: dict[int, list[int]] = {}
    for p, c in _active_edges(pid):
        parent_by_child.setdefault(c, []).append(p)
    seen: set[int] = set()
    order: list[int] = []
    frontier = [oid]
    while frontier:
        nxt: list[int] = []
        for node in frontier:
            for parent in parent_by_child.get(node, []):
                if parent != oid and parent not in seen:
                    seen.add(parent)
                    order.append(parent)
                    nxt.append(parent)
        frontier = nxt
    return order


def get_project_descendants(project, organization) -> set[int]:
    """All org ids beneath ``organization`` in the project's POH (excludes self)."""
    from projects.scope import get_project_subtree_org_ids

    pid, oid = _id(project), _id(organization)
    return set(get_project_subtree_org_ids(pid, oid)) - {oid}


# --- scope + roles ----------------------------------------------------------

def get_project_scope(project, organization) -> set[int]:
    """Org ids an organisation at this POH position may see WITHIN the project.

    Overseer (lead / funder) → every member org of the project. Otherwise the
    org's own POH subtree (itself + descendants), never widened beyond the
    project's membership. Always POH-derived — the global tree is not consulted.
    """
    from projects.scope import get_project_subtree_org_ids

    pid, oid = _id(project), _id(organization)
    members = _member_org_ids(pid)
    if _role(pid, oid) in OVERSEER_ROLES:
        return members
    return set(get_project_subtree_org_ids(pid, oid)) & members


def get_project_rollup_coordinator(project, organization) -> int | None:
    """The coordinator org id that ``organization`` rolls up to in this project.

    The org itself if it is a POH coordinator, else its nearest POH ancestor that
    is a coordinator, else ``None``. Coordinator status is POH-derived (parent of
    a non-overseer edge) — NOT inferred from organisation names — so it is
    correct per programme year (e.g. HPP/Mopipi are coordinators in NSC 2026/27
    even though they are not in any hardcoded name list).
    """
    from projects.derived_roles import derive_role_flags

    pid, oid = _id(project), _id(organization)
    coords = {o for o, f in derive_role_flags(pid).items() if f.get("is_coordinator")}
    if oid in coords:
        return oid
    for ancestor in get_project_ancestors(pid, oid):
        if ancestor in coords:
            return ancestor
    return None


def get_project_role(project, organization) -> dict:
    """POH-derived programme role for ``organization`` in ``project``.

    Returns the stored membership ``role`` plus the *derived* coordinator /
    sub-grantee booleans (from the hierarchy, not the stored flags), so callers
    read one authoritative answer instead of the denormalised booleans.
    """
    from projects.derived_roles import derive_role_flags

    pid, oid = _id(project), _id(organization)
    flags = derive_role_flags(pid).get(
        oid, {"is_coordinator": False, "is_sub_grantee": False}
    )
    return {
        "role": _role(pid, oid),
        "is_coordinator": bool(flags["is_coordinator"]),
        "is_sub_grantee": bool(flags["is_sub_grantee"]),
    }
