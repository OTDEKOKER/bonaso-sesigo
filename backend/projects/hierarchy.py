from __future__ import annotations

from collections.abc import Iterable, Mapping

from django.db import DatabaseError

from organizations.models import Organization

from .models import Project
from .assignment_rules import get_project_organization_scope_ids


def _coerce_positive_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def normalize_project_hierarchy_overrides(
    raw_value,
    *,
    allowed_org_ids: Iterable[int] | None = None,
) -> dict[str, list[str]]:
    """
    Normalize and validate project-level hierarchy mappings.

    Shape:
      {
        "<coordinator_org_id>": ["<child_org_id>", ...],
        ...
      }
    """

    if raw_value in (None, "", []):
        return {}
    if not isinstance(raw_value, Mapping):
        raise ValueError("hierarchy_overrides must be an object mapping parent organization ids to child id arrays.")

    allowed_set = {int(org_id) for org_id in (allowed_org_ids or []) if _coerce_positive_int(org_id)}
    enforce_allowed = len(allowed_set) > 0

    normalized: dict[str, list[str]] = {}

    for raw_parent_id, raw_children in raw_value.items():
        parent_id = _coerce_positive_int(raw_parent_id)
        if parent_id is None:
            raise ValueError(f"Invalid hierarchy parent organization id: {raw_parent_id!r}.")
        if enforce_allowed and parent_id not in allowed_set:
            raise ValueError(
                f"Hierarchy parent organization {parent_id} is not in this project's organization scope."
            )

        if raw_children in (None, ""):
            children_iterable = []
        elif isinstance(raw_children, (list, tuple, set)):
            children_iterable = raw_children
        else:
            raise ValueError(
                f"Hierarchy children for parent {parent_id} must be an array of organization ids."
            )

        deduped_children: list[str] = []
        seen_children: set[int] = set()
        for raw_child_id in children_iterable:
            child_id = _coerce_positive_int(raw_child_id)
            if child_id is None:
                raise ValueError(
                    f"Invalid hierarchy child organization id {raw_child_id!r} under parent {parent_id}."
                )
            if enforce_allowed and child_id not in allowed_set:
                raise ValueError(
                    f"Hierarchy child organization {child_id} is not in this project's organization scope."
                )
            if child_id == parent_id or child_id in seen_children:
                continue
            seen_children.add(child_id)
            deduped_children.append(str(child_id))

        normalized[str(parent_id)] = deduped_children

    return normalized


def resolve_organization_scope_with_project_hierarchy(
    org_id: int,
    *,
    project: Project | None = None,
    project_id: int | None = None,
) -> set[int]:
    """
    Resolve organization scope using project-specific hierarchy when configured.
    Falls back to global organization tree when no override is available.
    """

    organization = Organization.objects.filter(id=org_id).first()
    if not organization:
        return set()

    resolved_project = project
    if resolved_project is None and project_id is not None:
        resolved_project = Project.objects.filter(id=project_id).only("id", "hierarchy_overrides").first()

    global_scope = {organization.id, *[child.id for child in organization.get_descendants()]}
    if resolved_project is None:
        return global_scope

    project_org_ids = get_project_organization_scope_ids(resolved_project)

    # Phase 6 path: prefer normalized project hierarchy table when available.
    try:
        hierarchy_rows = list(
            resolved_project.project_hierarchy_links.filter(is_active=True).values_list(
                "parent_organization_id",
                "child_organization_id",
            )
        )
    except DatabaseError:
        hierarchy_rows = []

    if hierarchy_rows:
        children_by_parent: dict[int, list[int]] = {}
        all_child_ids: set[int] = set()
        for parent_org_id, child_org_id in hierarchy_rows:
            if parent_org_id == child_org_id:
                continue
            children_by_parent.setdefault(int(parent_org_id), []).append(int(child_org_id))
            all_child_ids.add(int(child_org_id))

        has_override_reference = org_id in children_by_parent or org_id in all_child_ids
        if has_override_reference:
            resolved_scope: set[int] = {org_id}
            queue = list(children_by_parent.get(org_id, []))
            while queue:
                next_org_id = queue.pop(0)
                if next_org_id in resolved_scope:
                    continue
                resolved_scope.add(next_org_id)
                queue.extend(children_by_parent.get(next_org_id, []))

            if len(project_org_ids) > 0:
                resolved_scope = resolved_scope.intersection(project_org_ids)
            return resolved_scope

        if len(project_org_ids) == 0:
            return global_scope
        return global_scope.intersection(project_org_ids)

    try:
        normalized_overrides = normalize_project_hierarchy_overrides(
            getattr(resolved_project, "hierarchy_overrides", {}) or {},
            allowed_org_ids=project_org_ids,
        )
    except ValueError:
        normalized_overrides = {}

    if len(normalized_overrides) == 0:
        if len(project_org_ids) == 0:
            return global_scope
        return global_scope.intersection(project_org_ids)

    children_by_parent: dict[int, list[int]] = {
        int(parent_id): [int(child_id) for child_id in child_ids]
        for parent_id, child_ids in normalized_overrides.items()
    }
    all_child_ids = {child_id for child_ids in children_by_parent.values() for child_id in child_ids}
    has_override_reference = org_id in children_by_parent or org_id in all_child_ids

    if not has_override_reference:
        if len(project_org_ids) == 0:
            return global_scope
        return global_scope.intersection(project_org_ids)

    resolved_scope: set[int] = {org_id}
    queue = list(children_by_parent.get(org_id, []))

    while queue:
        next_org_id = queue.pop(0)
        if next_org_id in resolved_scope:
            continue
        resolved_scope.add(next_org_id)
        queue.extend(children_by_parent.get(next_org_id, []))

    if len(project_org_ids) > 0:
        resolved_scope = resolved_scope.intersection(project_org_ids)

    return resolved_scope
