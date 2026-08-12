"""Grants access control.

Money is more sensitive than programme data, so the ``grants`` module is
**deny-by-default** — unlike the generic module system (which allows an action
when a module is not explicitly configured), grants access requires an *explicit*
enabled ``grants`` UserModulePermission grant. This keeps the whole module DARK
until an admin turns it on for specific users, so it can ship (even deploy)
without exposing any financial data.

Tiers (once enabled by an admin):
  * admin/superuser/staff  → full read + write (bypass).
  * grants grant w/ ``edit`` → finance user: read + write.
  * grants grant w/ ``view`` → coordinator: read-only (get_queryset still
    narrows them to their own project subtree).
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from organizations.access import is_organization_admin
from users.permissions import _explicit_row


def _grant_row(user):
    if user is None or not getattr(user, "pk", None):
        return None
    return _explicit_row(user, "grants")


def can_access_grants(user) -> bool:
    """May the user READ grant data at all (deny-by-default)."""
    if is_organization_admin(user):
        return True
    row = _grant_row(user)
    return bool(row and row.is_enabled and (row.actions or []))


def can_manage_grants(user) -> bool:
    """May the user CREATE/EDIT/DELETE grant data (finance tier)."""
    if is_organization_admin(user):
        return True
    row = _grant_row(user)
    return bool(row and row.is_enabled and "edit" in (row.actions or []))


class GrantsPermission(BasePermission):
    """Deny-by-default read for grants; writes require the finance (edit) tier."""

    message = "You do not have access to the grants module."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        if request.method in SAFE_METHODS:
            return can_access_grants(user)
        return can_manage_grants(user)
