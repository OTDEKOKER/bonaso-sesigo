from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """Allow only admin-level staff to read raw CSO-mapping submissions.

    Mirrors the admin gate used elsewhere (users.views): Django superuser/staff
    or the app's own ``admin`` role. Submissions contain personal data, so read
    access is restricted to authorised project personnel (Data Protection Act).
    """

    message = "You do not have permission to view CSO mapping submissions."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (
                getattr(user, "is_superuser", False)
                or getattr(user, "is_staff", False)
                or getattr(user, "role", None) == "admin"
            )
        )
