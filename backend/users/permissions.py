"""Backend enforcement of per-user module permissions.

The frontend hides modules a user may not access (sidebar + route guard), but
hiding alone is not security: a user could call the API directly. ``HasModule
Permission`` enforces the *explicit denial* server-side so a hidden module cannot
be reached by direct URL/API call.

Safe-by-design: it blocks ONLY when an admin has explicitly denied a module for
the user (a ``UserModulePermission`` row that is disabled or has no actions).
Modules merely absent from a role's defaults are NOT blocked here — those
endpoints are often shared reference data consumed by other modules' pages
(e.g. the aggregates page reads /api/organizations/), and the existing role/
org/project-scope gates already restrict the *data*. This mirrors the frontend's
``module_permissions_enforced`` contract and cannot lock out a user the admin
has not deliberately restricted.
"""
from __future__ import annotations

from rest_framework.permissions import BasePermission

from organizations.access import is_organization_admin


def module_explicitly_denied(user, module: str | None) -> bool:
    """True iff the admin has explicitly denied ``module`` for this user."""
    if not module:
        return False
    if user is None or not getattr(user, "pk", None):
        return False
    if is_organization_admin(user):
        return False
    try:
        rows = user.module_permissions.all()
    except Exception:
        return False
    for row in rows:
        if row.module == module:
            # A disabled row, or an enabled row stripped of every action, is a
            # deliberate denial of the whole module.
            return (not row.is_enabled) or not (row.actions or [])
    return False  # no explicit row -> governed by role defaults + the frontend


class HasModulePermission(BasePermission):
    """Deny access to a viewset whose ``required_module`` the user is denied.

    Usage on a viewset/view::

        permission_classes = [IsAuthenticated, HasModulePermission]
        required_module = "users"
    """

    message = "You do not have access to this module."

    def has_permission(self, request, view):
        module = getattr(view, "required_module", None)
        return not module_explicitly_denied(getattr(request, "user", None), module)
