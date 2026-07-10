from __future__ import annotations

from typing import Iterable


def get_user_organization_ids(user, project=None, project_id=None) -> list[int]:
    """The org ids a user is scoped to: their own org + its descendants.

    ``project``/``project_id`` (optional) resolve the descendants through THAT
    project's hierarchy (``resolve_organization_scope_with_project_hierarchy``) —
    coordinator↔sub-grantee membership differs per project, so a project-scoped
    caller (e.g. the aggregate review queue) must scope by the project it is
    viewing, not the single global org tree. With neither argument the behaviour
    is unchanged (global tree), so project-agnostic callers are unaffected.
    """
    if not getattr(user, "organization_id", None):
        return []

    organization = user.organization
    if project is not None or project_id is not None:
        from projects.hierarchy import resolve_organization_scope_with_project_hierarchy
        scope = resolve_organization_scope_with_project_hierarchy(
            organization.id, project=project, project_id=project_id
        )
        return sorted(scope or {organization.id})

    descendants = organization.get_descendants()
    return [organization.id] + [child.id for child in descendants]


def is_organization_admin(user) -> bool:
    return bool(user and (user.is_superuser or user.is_staff or user.role == "admin"))


def can_review_aggregates(user) -> bool:
    """Who may review / flag / reject (and delete) aggregates — the first tier.

    Workflow: M&E Officers handle their own organization's submitted data —
    marking it ``reviewed``, ``flagged`` or ``rejected`` — and M&E Managers then
    give the final ``approved`` sign-off at BONASO level. So this tier admits
    Officers, Managers and admins; only ``approved`` is reserved for Managers/
    admins (see ``can_approve_aggregates``). Because the review actions run
    through the org-scoped queryset, an Officer is naturally limited to their own
    organization and its descendants — they cannot touch another org's data.

    Kept separate from ``is_organization_admin`` so that admitting Officers/
    Managers here does NOT grant them admin-only powers (cross-org read-all,
    training opt-in, etc.).
    """
    return bool(
        user
        and (
            is_organization_admin(user)
            or getattr(user, "role", None) in {"manager", "officer"}
        )
    )


def can_approve_aggregates(user) -> bool:
    """Who may approve / reject / flag aggregates (the final review tier).

    Final sign-off happens at BONASO level, so this admits M&E Managers and
    admins only — Officers can mark data ``reviewed`` but cannot approve it.
    Managers remain org-scoped via the aggregate queryset.
    """
    return bool(user and (is_organization_admin(user) or getattr(user, "role", None) == "manager"))


def can_submit_aggregates(user) -> bool:
    """Who may create / update aggregate data entries.

    Admins, M&E Managers, M&E Officers and Data Collectors submit data within
    their scope. **Clients are external/read stakeholders and may never write
    aggregates**, even if their organization happens to sit in a project's scope
    with an assigned indicator — scope alone must not authorize a write. Org +
    descendant + indicator-assignment scoping is enforced separately by the view;
    this is the role gate layered on top. Unknown/None roles are denied.
    """
    return bool(
        user
        and (
            is_organization_admin(user)
            or getattr(user, "role", None) in {"manager", "officer", "collector"}
        )
    )


def filter_queryset_by_org_ids(queryset, field_name: str, org_ids: Iterable[int]):
    org_ids = list(org_ids)
    if not org_ids:
        return queryset.none()
    return queryset.filter(**{f"{field_name}__in": org_ids})


# ---------------------------------------------------------------------------
# Sesigo Training Mode isolation helpers
# ---------------------------------------------------------------------------

def user_can_include_training(user) -> bool:
    """Only admin users may opt in to seeing training-project records."""
    return is_organization_admin(user)


def token_mode(request) -> str | None:
    """
    Read the authoritative training/live mode from the verified JWT, if present.

    Audit finding H1. When a user logs in through Sesigo Training Mode the access
    token is stamped with a signed ``mode='training'`` claim. Because the claim is
    part of the cryptographically-verified token it CANNOT be tampered with by the
    client, unlike the legacy ``training_only`` query parameter. A training-stamped
    token therefore binds the session to training mode server-side: the user can no
    longer reach live data simply by dropping the query parameter.

    Returns 'training', 'live', or None (no claim → fall back to the query param,
    preserving backward compatibility with already-issued tokens and clients that
    have not yet adopted the claim).
    """
    # Read the cached, already-validated token. We deliberately read the private
    # ``_auth`` attribute rather than ``request.auth``: the public property lazily
    # runs authentication if it has not happened yet, which has side effects on
    # requests built without credentials. In production DRF authenticates during
    # dispatch (before get_queryset), so ``_auth`` is already populated here.
    auth = getattr(request, "_auth", None)
    if auth is None:
        return None
    try:
        value = auth.get("mode")  # AccessToken supports dict-style .get()
    except (AttributeError, TypeError):
        return None
    value = str(value or "").strip().lower()
    return value if value in {"training", "live"} else None


def should_include_training(request) -> bool:
    """Return True if the caller explicitly requested training data AND is an admin."""
    # A training-bound token can never escalate to "see everything".
    if token_mode(request) == "training":
        return False
    param = str(request.query_params.get("include_training") or "").strip().lower()
    return param in {"1", "true", "yes", "y"} and user_can_include_training(request.user)


def is_training_only_request(request) -> bool:
    """
    Return True if the caller is operating inside Sesigo Training Mode and should
    see ONLY training-project data.

    The signed JWT ``mode`` claim is the SOLE source of truth (H1+). Because every
    token issued after the hardening carries a claim (``live`` or ``training``),
    a client query parameter can no longer flip the environment:

      • claim == "training"  → training-only view.
      • claim == "live"      → live view (a ``training_only`` query param is ignored).
      • no claim (legacy token, pre-hardening) → default to LIVE. This is the safe
        default: training records stay hidden, and the param can no longer force a
        training view. Entering Training Mode now requires a training login, which
        stamps the claim. Old sessions simply see live until their next login.
    """
    return token_mode(request) == "training"


def training_view_mode(request) -> str:
    """
    Resolve the data-isolation mode for the current request.

    Returns one of:
        "all"      → admin opt-in (include_training=true): no filtering.
        "training" → Sesigo Training Mode: training-project records only.
        "live"     → default: exclude training-project records.

    include_training (admin) takes precedence over training_only so an admin can
    deliberately inspect everything.
    """
    if should_include_training(request):
        return "all"
    if is_training_only_request(request):
        return "training"
    return "live"


def request_mode_value(request) -> str:
    """The environment a write/create belongs to: ``'training'`` or ``'live'``.

    Used to stamp models that carry a direct ``mode`` field (e.g. analysis
    Report / ScheduledReport / SavedQuery, which have no project FK to isolate
    through). Derived from the signed JWT claim, so it cannot be spoofed.
    """
    return "training" if is_training_only_request(request) else "live"


def apply_mode_field_filter(queryset, request, field: str = "mode"):
    """Isolate models that carry a direct ``mode`` CharField ('live'/'training').

    Mirrors apply_training_filter for models with no project relationship:
        live (default) → only ``mode='live'`` rows.
        training       → only ``mode='training'`` rows.
        admin include_training=true → no filtering.
    """
    mode = training_view_mode(request)
    if mode == "all":
        return queryset
    return queryset.filter(**{field: mode})


def apply_training_filter(queryset, request, project_lookup: str = "project"):
    """
    Isolate Sesigo Live System and Sesigo Training Mode data on a project-scoped
    queryset.

    Live (default):
        Exclude records whose project has is_training=True.
        Records with a NULL project FK are kept (they are not training-scoped).

    Training Mode (training_only=true / mode=training):
        Return ONLY records whose project has is_training=True.

    Admin opt-in (include_training=true):
        Skip the filter — return all records including training ones.

    project_lookup: ORM field path to the project FK, e.g.
        "project"                              → project__is_training
        "interaction__project"                 → interaction__project__is_training
    """
    mode = training_view_mode(request)
    if mode == "all":
        return queryset  # admin explicitly requested every record

    from django.db.models import Q

    is_training_field = f"{project_lookup}__is_training"
    null_field = f"{project_lookup}__isnull"

    if mode == "training":
        # Training Mode: only records that belong to a training project.
        return queryset.filter(**{is_training_field: True})

    # Live (default): exclude training-project records; keep project-less records.
    return queryset.filter(
        Q(**{is_training_field: False}) | Q(**{null_field: True})
    )


def apply_training_filter_to_projects(queryset, request, field: str = "is_training"):
    """
    Same isolation rules as apply_training_filter, but for a queryset over the
    Project model itself (where the flag is a direct field, not a relation).
    """
    mode = training_view_mode(request)
    if mode == "all":
        return queryset
    if mode == "training":
        return queryset.filter(**{field: True})
    return queryset.filter(**{field: False})


def apply_training_filter_via_projects(queryset, request, projects_lookup: str = "projects"):
    """
    Isolate shared models (Organization, Indicator) that are NOT directly
    is_training-scoped but link to projects through an M2M relation.

    Live (default):
        Keep records linked to at least one live project OR linked to no project
        at all (shared definitions). Exclude records linked ONLY to training
        projects (e.g. demo orgs/indicators) so they never clutter live views.

    Training Mode (training_only=true / mode=training):
        Return ONLY records linked to a training project.

    Admin opt-in (include_training=true):
        Skip the filter.

    .distinct() is applied because the M2M join can duplicate rows.
    """
    mode = training_view_mode(request)
    if mode == "all":
        return queryset

    from django.db.models import Q

    is_training_field = f"{projects_lookup}__is_training"
    null_field = f"{projects_lookup}__isnull"

    if mode == "training":
        return queryset.filter(**{is_training_field: True}).distinct()

    return queryset.filter(
        Q(**{is_training_field: False}) | Q(**{null_field: True})
    ).distinct()


def assert_project_write_allowed(request, project) -> None:
    """
    Enforce the Sesigo Training/Live boundary on write operations.

    Training Mode (training_only=true / mode=training):
        May only write to projects where is_training=True.
    Live System (default):
        May never write to a project where is_training=True.

    Writes are ALWAYS boundary-checked. Unlike read filtering, the admin
    include_training ("all") opt-in does NOT exempt writes: write intent is
    derived solely from the explicit training signal (training_only/mode), so a
    user-controlled query parameter can never cause a record to land on the
    wrong side of the live/training boundary — the target project's is_training
    is the authority and the request's intent must match it.

    Raises rest_framework.exceptions.PermissionDenied on a boundary crossing.
    A None project (project-less write) is left to other validation.
    """
    if project is None:
        return

    from rest_framework.exceptions import PermissionDenied

    training_request = is_training_only_request(request)
    is_training_target = bool(getattr(project, "is_training", False))
    if training_request and not is_training_target:
        raise PermissionDenied(
            "Sesigo Training Mode can only write to training projects."
        )
    if not training_request and is_training_target:
        raise PermissionDenied(
            "Sesigo Live System cannot write to a training project. "
            "Switch to Training Mode to enter training data."
        )
