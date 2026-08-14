"""Backend enforcement of per-user module + action permissions.

The frontend hides modules/actions a user may not use (sidebar + route guard +
disabled buttons), but hiding alone is not security: a user could call the API
directly. ``HasModulePermission`` enforces both layers server-side:

  • module level — a module an admin explicitly denied cannot be reached at all;
  • action level — within an explicitly-granted module, only the granted actions
    (view/create/edit/delete/export/approve/…) are allowed; the HTTP method or
    DRF action name is mapped to a permission verb and must be in the row's set.

Safe-by-design: enforcement applies ONLY to modules an admin has explicitly
configured for the user (a ``UserModulePermission`` row). Modules with no row
fall through to role defaults + the existing org/project-scope gates, so a user
the admin never restricted is never locked out, and shared cross-module
reference loads (e.g. the aggregates page reading /api/organizations/) keep
working. Admins bypass entirely.
"""
from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS, BasePermission

from organizations.access import is_data_entry_user, is_organization_admin

# DRF viewset/action name -> permission verb (preferred when present).
_ACTION_NAME_TO_PERM = {
    "list": "view",
    "retrieve": "view",
    "create": "create",
    "update": "edit",
    "partial_update": "edit",
    "destroy": "delete",
    # common custom @action names across the codebase
    "export": "export",
    "download": "export",
    "approve": "approve",
    "reject": "reject",
    "review": "review",
    "submit": "submit",
    "generate": "generate",
    "import": "import",
    "import_": "import",
    "manage": "manage",
    "deactivate": "deactivate",
    "reset_password": "reset_password",
}

# Fallback when the action name is unknown/absent (e.g. function views, or
# read-only custom actions like 'stats'/'home'/'tree').
_METHOD_TO_PERM = {"POST": "create", "PUT": "edit", "PATCH": "edit", "DELETE": "delete"}


def required_action_for(request, view) -> str:
    """Map the current request to a permission verb (view/create/edit/...)."""
    name = getattr(view, "action", None)
    if name and name in _ACTION_NAME_TO_PERM:
        return _ACTION_NAME_TO_PERM[name]
    if request.method in SAFE_METHODS:
        return "view"
    return _METHOD_TO_PERM.get(request.method, "view")


def _explicit_row(user, module):
    """The user's explicit UserModulePermission row for ``module``, or None."""
    try:
        for row in user.module_permissions.all():
            if row.module == module:
                return row
    except Exception:
        return None
    return None


def module_explicitly_denied(user, module: str | None) -> bool:
    """True iff the admin has explicitly denied the whole ``module`` for a user."""
    if not module or user is None or not getattr(user, "pk", None):
        return False
    if is_organization_admin(user):
        return False
    row = _explicit_row(user, module)
    if row is None:
        return False
    return (not row.is_enabled) or not (row.actions or [])


def user_can_act(user, module: str | None, action: str) -> bool:
    """Whether ``user`` may perform ``action`` on ``module`` (admin bypass).

    Returns True when the module is not explicitly configured for the user
    (role defaults govern). When it is configured, the action must be granted.
    """
    if not module:
        return True
    if user is None or not getattr(user, "pk", None):
        return False
    if is_organization_admin(user):
        return True
    row = _explicit_row(user, module)
    if row is None:
        return True
    if not row.is_enabled:
        return False
    return action in (row.actions or [])


class IsDataEntryUser(BasePermission):
    """Restrict a viewset to admins + the data-handling roles.

    Individual respondent data (respondents, interactions, responses, profiles)
    is personal — and in the profile case special-category (health/disability)
    — data. The generic ``HasModulePermission`` is allow-when-no-explicit-row,
    so on its own it does NOT stop an external ``client`` (read-only funder) or
    an unknown/None role from reaching these endpoints within their org scope.
    Layer this class on top so scope alone can never authorise a non-data role
    to read or write personal data. Admins and Manager/Officer/Collector keep
    full access; any explicit module deny an admin set is still honoured by
    ``HasModulePermission`` alongside this gate.
    """

    message = "Your role does not permit access to respondent personal data."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        return is_data_entry_user(user)


class HasModulePermission(BasePermission):
    """Deny access to a viewset by ``required_module`` + per-action grants.

    Usage on a viewset/view::

        permission_classes = [IsAuthenticated, HasModulePermission]
        required_module = "users"
    """

    message = "You do not have permission for this action in this module."

    def has_permission(self, request, view):
        module = getattr(view, "required_module", None)
        if not module:
            return True
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        return user_can_act(user, module, required_action_for(request, view))
