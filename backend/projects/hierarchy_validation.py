"""Structural validation for project-hierarchy writes.

A pure, read-only guard called by ``projects.views.set_hierarchy_links`` before
persisting the desired edge set, so the canonical hierarchy
(``ProjectOrganizationHierarchy``) can never be put into a structurally-invalid
state. It only ever REJECTS genuinely-invalid input (400) — it never rewrites or
"fixes" anything — so it adds no behaviour for already-valid hierarchies (the two
live projects audited clean: no cycles, no multi-parent).

Rules (returns the first violation as a message, else ``None``):
  1. self-loop            — an org cannot be its own parent
  2. multiple parents     — a child may not have >1 distinct parent (conflicting
                            coordinators); flagged unless explicitly allowed
  3. circular hierarchy   — no A→B→…→A
  4. inactive endpoint    — an inactive ProjectOrganization cannot sit in an
                            active hierarchy edge
  5. cross-project        — every endpoint must be a member of THIS project

Self-loop and cross-project are ALSO checked inline in the view today; they are
repeated here so the validator is complete and independently testable.
"""
from __future__ import annotations

from collections import defaultdict

from .models import ProjectOrganization


def validate_project_hierarchy_edges(
    project, desired_pairs, *, allow_multiple_parents: bool = False,
) -> str | None:
    """Return the first structural violation in ``desired_pairs`` (set of
    ``(parent_org_id, child_org_id)``) for ``project``, or ``None`` if valid."""
    if not desired_pairs:
        return None

    pairs = {(int(p), int(c)) for p, c in desired_pairs}

    # 1. self-loop
    for p, c in pairs:
        if p == c:
            return f"Organization {p} cannot be its own parent."

    # 5. cross-project — every endpoint must be a member (active OR inactive) of
    # the project. Inactive membership is caught separately below with a clearer
    # message; a genuine non-member is rejected here.
    member_ids = set(
        ProjectOrganization.objects.filter(project=project).values_list("organization_id", flat=True)
    )
    if member_ids:
        endpoints = {x for pair in pairs for x in pair}
        outside = sorted(endpoints - member_ids)
        if outside:
            return (
                f"Organization(s) {outside} are not members of this project and "
                f"cannot appear in its hierarchy."
            )

    # 2. multiple active parents
    if not allow_multiple_parents:
        parents_by_child: dict[int, set[int]] = defaultdict(set)
        for p, c in pairs:
            parents_by_child[c].add(p)
        multi = sorted(c for c, ps in parents_by_child.items() if len(ps) > 1)
        if multi:
            return (
                f"Organization(s) {multi} would have more than one parent "
                f"(conflicting coordinators)."
            )

    # 3. circular hierarchy (DFS with colours)
    children: dict[int, list[int]] = defaultdict(list)
    for p, c in pairs:
        children[p].append(c)
    WHITE, GRAY, BLACK = 0, 1, 2
    colour: dict[int, int] = defaultdict(int)

    def _has_cycle(start: int) -> bool:
        stack = [(start, iter(children.get(start, [])))]
        colour[start] = GRAY
        while stack:
            node, it = stack[-1]
            advanced = False
            for nxt in it:
                if colour[nxt] == GRAY:
                    return True
                if colour[nxt] == WHITE:
                    colour[nxt] = GRAY
                    stack.append((nxt, iter(children.get(nxt, []))))
                    advanced = True
                    break
            if not advanced:
                colour[node] = BLACK
                stack.pop()
        return False

    nodes = set(children) | {c for cs in children.values() for c in cs}
    for n in nodes:
        if colour[n] == WHITE and _has_cycle(n):
            return "Hierarchy contains a circular relationship."

    # 4. inactive endpoint cannot sit in an active edge
    endpoint_ids = {x for pair in pairs for x in pair}
    inactive = sorted(
        ProjectOrganization.objects.filter(
            project=project, organization_id__in=endpoint_ids, is_active=False
        ).values_list("organization_id", flat=True)
    )
    if inactive:
        return (
            f"Inactive project organization(s) {inactive} cannot participate in "
            f"the active hierarchy."
        )

    return None
