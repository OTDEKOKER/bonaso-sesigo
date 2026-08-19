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

    sub_grantee := the org is a CHILD of at least one active edge.

An org may be BOTH (a coordinator that is itself under another coordinator — a
legitimate middle tier, e.g. HPP/Mopipi in 2026/27). Coordinator status is
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

    result: dict[int, dict] = {}
    for org_id in roles:  # every ProjectOrganization member
        oid = int(org_id)
        is_coord = oid in parents and roles.get(oid) not in OVERSEER_ROLES
        result[oid] = {
            "is_coordinator": is_coord,
            "is_sub_grantee": oid in children,
        }
    # Include any org that appears only as an edge endpoint but has no PO row
    # (defensive; should not happen in clean data).
    for oid in parents | children:
        result.setdefault(int(oid), {
            "is_coordinator": int(oid) in parents and roles.get(int(oid)) not in OVERSEER_ROLES,
            "is_sub_grantee": int(oid) in children,
        })
    return result


def is_derived_coordinator(project, organization_id: int) -> bool:
    return bool(derive_role_flags(project).get(int(organization_id), {}).get("is_coordinator"))


def is_derived_sub_grantee(project, organization_id: int) -> bool:
    return bool(derive_role_flags(project).get(int(organization_id), {}).get("is_sub_grantee"))
