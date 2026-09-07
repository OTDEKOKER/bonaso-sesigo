from rest_framework.permissions import SAFE_METHODS, BasePermission

from organizations.access import training_view_mode

MODULE = "cso_mapping"


def _required_action(request, view) -> str:
    """Map the request to a CSO Mapping action: view / export / edit."""
    if getattr(view, "action", None) == "export":
        return "export"
    if request.method in SAFE_METHODS:
        return "view"
    return "edit"


class CanUseCsoMapping(BasePermission):
    """Deny-by-default access to the CSO Mapping module (holds personal data).

    Uses the same effective module map the frontend does
    (``resolve_user_module_permissions``): administrators are granted everything;
    every other user is denied unless an admin has explicitly assigned them the
    ``cso_mapping`` module with the relevant action (view / export / edit).
    ``cso_mapping`` is in no role default, so it is deny-by-default for non-admins.
    """

    message = "You do not have access to the CSO Mapping module."

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        # CSO Mapping holds real submissions (personal data) and has no training
        # mirror — there is no training CSO dataset. A Sesigo Training-Mode session
        # must therefore never reach these endpoints, or live data would leak into
        # training. Deny outright for training sessions (admins inspecting live via
        # include_training resolve to mode "all", not "training", and are unaffected).
        if training_view_mode(request) == "training":
            return False
        # "Admin" here means a Django superuser or the application's own `admin`
        # role ONLY. The Django `is_staff` flag can sit on non-admin accounts and
        # must NOT, on its own, unlock respondents' personal data (mirrors
        # IsAdminRole; audit Fix A). We deliberately do NOT go through
        # resolve_user_module_permissions here — its admin shortcut treats
        # is_staff as full access, which would leak the submissions list.
        if getattr(user, "is_superuser", False) or getattr(user, "role", None) == "admin":
            return True
        # Everyone else is deny-by-default and needs an EXPLICIT cso_mapping grant
        # for the requested action, read straight from their stored permission rows
        # (an admin assigning the module), never inferred from is_staff.
        action = _required_action(request, view)
        try:
            row = user.module_permissions.filter(module=MODULE, is_enabled=True).first()
        except Exception:
            return False
        return bool(row and action in (row.actions or []))


class IsAdminRole(BasePermission):
    """Allow only administrators to read raw CSO-mapping submissions.

    Submissions contain personal data (names, positions, phone numbers, emails,
    organisational information), so read access is deliberately narrow:

      * Django superuser, or
      * the application's own ``admin`` role.

    ``is_staff`` is intentionally NOT accepted — it is a Django-admin-site flag
    that can be set on non-administrator accounts and must not, on its own, grant
    access to respondents' personal data.
    """

    message = "You do not have permission to view CSO mapping submissions."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (
                getattr(user, "is_superuser", False)
                or getattr(user, "role", None) == "admin"
            )
        )
