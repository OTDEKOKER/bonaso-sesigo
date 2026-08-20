"""Derive coordinator / sub-grantee status from the CANONICAL project hierarchy
(``ProjectOrganizationHierarchy``) instead of the independently-stored
``is_coordinator`` / ``is_sub_grantee`` booleans.

Status: ADDITIVE and behaviour-neutral. Nothing in the runtime read/write paths
calls this yet; it exists to (a) power the read-only parity/audit tooling and
(b) be the single definition consumers migrate to once the hierarchy
canonicalization is approved. It writes nothing and changes no existing field.

Rule (established from the live 2025/26 + 2026/27 audit):

    coordinator := the org is a PARENT of at least one ACTIVE
                   ProjectOrganizationHierarchy edge in this project
                   AND its ProjectOrganization.role is NOT an overseer role
                   (``lead`` / ``funder``).
                   The role exclusion is essential: BONASO participates as the
                   project ``lead`` sitting ABOVE the coordinators, so it is a
                   parent-edge but must NOT be treated as a coordinator.

    sub_grantee := the org is a CHILD of at least one active edge whose PARENT
                   is NOT an overseer role (``lead`` / ``funder``).
                   This mirrors the coordinator overseer-exclusion: an org
                   sitting DIRECTLY under the lead/funder (e.g. the NSC 2026/27
                   coordinators under BONASO) is a hierarchy child but is NOT a
                   sub-grantee of that overseer — it is a coordinator. A child is
                   only a sub-grantee when a real (non-overseer) parent grants
                   down to it.

An org may be BOTH (a coordinator that is itself under ANOTHER coordinator — a
legitimate middle tier, e.g. HPP/Mopipi in 2026/27: coordinator by its own
parent-edge, sub-grantee via a coordinator above it). Coordinator status is
independent of whether the org also implements/reports (that is assignment /
workbook driven, not hierarchy driven).
"""
from __future__ import annotations

from django.db import DatabaseError

from .models import ProjectOrganization, ProjectOrganizationHierarchy

# Roles that sit ABOVE coordinators and must never be counted as coordinators
# even though they are a parent in the hierarchy.
OVERSEER_ROLES = frozenset({"lead", "funder"})


def _active_edges(project):
    return list(
        ProjectOrganizationHierarchy.objects.filter(
            project=project, is_active=True
        ).values_list("parent_organization_id", "child_organization_id")
    )


def _roles_by_org(project):
    return dict(
        ProjectOrganization.objects.filter(project=project).values_list(
            "organization_id", "role"
        )
    )


def derive_role_flags(project) -> dict[int, dict]:
    """Return ``{org_id: {"is_coordinator": bool, "is_sub_grantee": bool}}`` for
    every org that participates in ``project``, derived purely from the active
    hierarchy edges + role. Read-only.
    """
    try:
        edges = _active_edges(project)
    except DatabaseError:
        edges = []
    roles = _roles_by_org(project)

    parents = {int(p) for p, _ in edges}
    children = {int(c) for _, c in edges}
    # A child is a sub-grantee ONLY when reached through a NON-overseer parent
    # edge (symmetry with the coordinator rule, which excludes overseer parents).
    # A child sitting directly under a lead/funder is therefore not a sub-grantee
    # of that overseer. An org reached through both an overseer and a real
    # coordinator still qualifies (it has at least one non-overseer parent edge).
    sub_grantee_children = {
        int(c) for p, c in edges if roles.get(int(p)) not in OVERSEER_ROLES
    }

    result: dict[int, dict] = {}
    for org_id in roles:  # every ProjectOrganization member
        oid = int(org_id)
        is_coord = oid in parents and roles.get(oid) not in OVERSEER_ROLES
        result[oid] = {
            "is_coordinator": is_coord,
            "is_sub_grantee": oid in sub_grantee_children,
        }
    # Include any org that appears only as an edge endpoint but has no PO row
    # (defensive; should not happen in clean data).
    for oid in parents | children:
        result.setdefault(int(oid), {
            "is_coordinator": int(oid) in parents and roles.get(int(oid)) not in OVERSEER_ROLES,
            "is_sub_grantee": int(oid) in sub_grantee_children,
        })
    return result


def is_derived_coordinator(project, organization_id: int) -> bool:
    return bool(derive_role_flags(project).get(int(organization_id), {}).get("is_coordinator"))


def is_derived_sub_grantee(project, organization_id: int) -> bool:
    return bool(derive_role_flags(project).get(int(organization_id), {}).get("is_sub_grantee"))


# ---------------------------------------------------------------------------
# Canonical, flag-gated read-through API (Rep 3b cutover).
#
# Runtime consumers that need "who are the coordinators / sub-grantees in this
# project?" call these instead of filtering the stored boolean directly. The
# HIERARCHY_SOURCE setting decides the answer:
#   'global'  (DEFAULT) -> the stored is_coordinator / is_sub_grantee booleans,
#             returning EXACTLY the same set the legacy
#             ``filter(is_coordinator=True[, is_active=True])`` produced.
#   'project' -> derived from the canonical ProjectOrganizationHierarchy edges
#             (derive_role_flags), intersected with active PO membership when
#             ``active_only`` (mirrors the legacy active filter).
#
# The stored booleans are left in place and keep being maintained by the
# project-setup write path — these helpers only change where *reads* resolve
# from, and only when the flag is flipped. ``project`` accepts a Project instance
# or a project id.
# ---------------------------------------------------------------------------

def hierarchy_source() -> str:
    """The active hierarchy source ('global' | 'project'); default 'global'."""
    from django.conf import settings

    value = str(getattr(settings, "HIERARCHY_SOURCE", "global") or "global").strip().lower()
    return value if value in ("global", "project") else "global"


def _active_org_ids(project) -> set[int]:
    return set(
        ProjectOrganization.objects.filter(
            project=project, is_active=True
        ).values_list("organization_id", flat=True)
    )


def _stored_role_org_ids(project, field: str, *, active_only: bool) -> set[int]:
    qs = ProjectOrganization.objects.filter(project=project, **{field: True})
    if active_only:
        qs = qs.filter(is_active=True)
    return set(qs.values_list("organization_id", flat=True))


def coordinator_org_ids(project, *, active_only: bool = True) -> set[int]:
    """Canonical set of coordinator org ids for ``project`` (flag-gated).

    'global' (default): orgs with the stored is_coordinator boolean (byte-for-byte
    the legacy filter). 'project': orgs that are a parent edge in the canonical
    ProjectOrganizationHierarchy and not an overseer role (derive_role_flags).
    ``active_only`` mirrors the legacy ``is_active=True`` filter.
    """
    if project is None:
        return set()
    if hierarchy_source() == "project":
        ids = {oid for oid, f in derive_role_flags(project).items() if f.get("is_coordinator")}
        return ids & _active_org_ids(project) if active_only else ids
    return _stored_role_org_ids(project, "is_coordinator", active_only=active_only)


def sub_grantee_org_ids(project, *, active_only: bool = True) -> set[int]:
    """Canonical set of sub-grantee org ids for ``project`` (flag-gated).

    Mirrors :func:`coordinator_org_ids` for the child side of the hierarchy.
    """
    if project is None:
        return set()
    if hierarchy_source() == "project":
        ids = {oid for oid, f in derive_role_flags(project).items() if f.get("is_sub_grantee")}
        return ids & _active_org_ids(project) if active_only else ids
    return _stored_role_org_ids(project, "is_sub_grantee", active_only=active_only)
