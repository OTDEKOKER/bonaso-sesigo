from rest_framework.permissions import BasePermission


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
