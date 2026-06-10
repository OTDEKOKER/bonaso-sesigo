from rest_framework import viewsets, status, generics
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import IsAuthenticated, AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import PermissionDenied
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission, Group
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from organizations.access import get_user_organization_ids, is_organization_admin, filter_queryset_by_org_ids

from django.db import transaction

from .models import UserActivity, UserModulePermission
from .module_permissions import (
    MODULE_ACTIONS,
    MODULES,
    get_role_defaults,
    resolve_user_module_permissions,
)
from .serializers import (
    UserSerializer, UserCreateSerializer, UserUpdateSerializer,
    PasswordChangeSerializer, AdminResetPasswordSerializer, UserActivitySerializer,
    CurrentUserDashboardPreferencesSerializer,
)
from audit.recording import record_audit_event

User = get_user_model()


class IsPortalAdmin(BasePermission):
    """Allow users mapped to admin scope in portal roles."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and is_organization_admin(request.user))


# ---------------------------
# JWT Token Views
# ---------------------------
class TrainingAwareTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Stamp a tamper-proof training/live mode claim onto the token (H1).

    When the login request carries ``mode=training`` the issued token is bound to
    Sesigo Training Mode server-side. The claim is set on the refresh token so it
    survives access-token refresh, and propagates to the access token. Logins
    without ``mode=training`` are unchanged (no claim → query-param fallback).
    """

    def validate(self, attrs):
        data = super().validate(attrs)
        request = self.context.get("request")
        requested_mode = ""
        if request is not None:
            requested_mode = str(request.data.get("mode") or "").strip().lower()
        if requested_mode == "training":
            refresh = self.get_token(self.user)
            refresh["mode"] = "training"
            data["refresh"] = str(refresh)
            data["access"] = str(refresh.access_token)
        return data


class CookieTokenObtainPairView(TokenObtainPairView):
    """Custom login view that logs user activity.

    SEC-1: rate limited per client IP (``login`` scope) to blunt brute-force and
    credential-stuffing attacks. Successful logins are unaffected at normal use.
    """

    serializer_class = TrainingAwareTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            user = User.objects.filter(username=request.data.get('username')).first()
            if user:
                user.last_activity = timezone.now()
                user.save(update_fields=['last_activity'])
                UserActivity.objects.create(
                    user=user,
                    action='login',
                    ip_address=self.get_client_ip(request)
                )
        return response

    def get_client_ip(self, request):
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        return x_forwarded_for.split(',')[0] if x_forwarded_for else request.META.get('REMOTE_ADDR')


class CookieTokenRefreshView(TokenRefreshView):
    """Custom refresh token view.

    SEC-1: rate limited per client IP (``token_refresh`` scope) so a stolen or
    brute-forced refresh token cannot be replayed at high volume.
    """
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'token_refresh'


# ---------------------------
# Auth & User Endpoints
# ---------------------------
@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def current_user(request):
    """Return or update currently logged-in user details."""
    if request.method == 'PATCH':
        serializer = CurrentUserDashboardPreferencesSerializer(
            request.user,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

    from projects.scope import get_default_project_id
    from organizations.access import is_training_only_request

    from users.module_permissions import resolve_user_module_permissions

    response_serializer = UserSerializer(request.user)
    data = dict(response_serializer.data)
    # The dashboard always needs a selected project; expose the user's current /
    # default project so the frontend can preselect it on load.
    data['default_project_id'] = get_default_project_id(
        request.user,
        include_training=is_training_only_request(request),
    )
    # Effective module permissions so the frontend can gate the sidebar, routes
    # and in-module actions. Backend remains the source of truth — this payload
    # only mirrors what the server already enforces.
    data['module_permissions'] = resolve_user_module_permissions(request.user)
    # Whether an admin has explicitly configured this user. The frontend only
    # *restricts* the UI when this is true; un-configured users keep their full
    # role-based experience so existing users are never silently locked out.
    data['module_permissions_enforced'] = (
        not is_organization_admin(request.user)
        and request.user.module_permissions.exists()
    )
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """Logout by blacklisting refresh token."""
    refresh_token = request.data.get('refresh')
    if refresh_token:
        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except Exception as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    UserActivity.objects.create(
        user=request.user,
        action='logout',
        ip_address=request.META.get('REMOTE_ADDR')
    )
    return Response({'detail': 'Successfully logged out.'})


class TestConnectionView(APIView):
    """Test API - no authentication required."""
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'status': 'ok', 'message': 'BONASO API is running'})


class ApplyForNewUser(generics.CreateAPIView):
    """Create new user account (admin-only)."""
    serializer_class = UserCreateSerializer
    permission_classes = [IsPortalAdmin]


class AdminResetPasswordView(APIView):
    """Admin can reset a user's password.

    SEC-1: rate limited (``password_reset`` scope) as defence-in-depth against
    automated abuse of the password-reset surface.
    """
    permission_classes = [IsPortalAdmin]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_reset'

    def post(self, request):
        serializer = AdminResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            user = User.objects.get(id=serializer.validated_data['user_id'])
            user.set_password(serializer.validated_data['new_password'])
            user.save()
            UserActivity.objects.create(
                user=request.user,
                action='update',
                model_name='User',
                object_id=user.id,
                description=f'Admin reset password for {user.username}'
            )
            return Response({'detail': 'Password reset successfully.'})
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)


# ---------------------------
# User Management ViewSet
# ---------------------------
class UserViewSet(viewsets.ModelViewSet):
    """CRUD for users."""
    queryset = User.objects.all()
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['role', 'organization', 'is_active']
    search_fields = ['username', 'email', 'first_name', 'last_name']
    ordering_fields = ['username', 'created_at', 'last_activity']
    ordering = ['-created_at']

    permission_classes = [IsAuthenticated]

    SELF_EDITABLE_FIELDS = {
        'first_name',
        'last_name',
        'email',
        'phone',
        'avatar',
        'home_dashboard_preferences',
    }

    def _is_admin(self):
        return is_organization_admin(self.request.user)

    def get_permissions(self):
        if self.action in {
            'create', 'destroy', 'deactivate', 'activate', 'permissions',
            'module_permissions', 'module_permission_defaults', 'module_catalog',
        }:
            return [IsPortalAdmin()]
        return [permission() for permission in self.permission_classes]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return UserUpdateSerializer
        return UserSerializer

    def get_queryset(self):
        """Filter queryset based on user role."""
        queryset = User.objects.select_related('organization')
        user = self.request.user
        if is_organization_admin(user):
            return queryset
        if user.role == 'manager':
            org_ids = get_user_organization_ids(user)
            if org_ids:
                return filter_queryset_by_org_ids(queryset, 'organization_id', org_ids)
            return queryset.none()
        return queryset.filter(id=user.id)

    def perform_create(self, serializer):
        if not self._is_admin():
            raise PermissionDenied('Only admins can create users.')
        serializer.save()

    def perform_update(self, serializer):
        if not self._is_admin():
            if serializer.instance.id != self.request.user.id:
                raise PermissionDenied('You can only update your own user profile.')
            submitted_fields = set(serializer.validated_data.keys())
            disallowed_fields = submitted_fields - self.SELF_EDITABLE_FIELDS
            if disallowed_fields:
                raise PermissionDenied(
                    'You cannot modify restricted user fields: '
                    + ', '.join(sorted(disallowed_fields))
                )
        serializer.save()

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        """Deactivate a user."""
        user = self.get_object()
        user.is_active = False
        user.save()
        return Response({'detail': 'User deactivated.'})

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """Activate a user."""
        user = self.get_object()
        user.is_active = True
        user.save()
        return Response({'detail': 'User activated.'})

    @action(detail=True, methods=['get'])
    def activity(self, request, pk=None):
        """Return last 50 activities of a user."""
        user = self.get_object()
        activities = UserActivity.objects.filter(user=user).order_by('-timestamp')[:50]
        serializer = UserActivitySerializer(activities, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='module-catalog')
    def module_catalog(self, request):
        """The controlled module/action catalog used by the permission editor."""
        return Response({'modules': MODULE_ACTIONS})

    @action(detail=False, methods=['get'], url_path='module-permission-defaults')
    def module_permission_defaults(self, request):
        """Role default module permissions (?role=manager). Used to pre-load the
        permission editor when an admin picks a role."""
        role = (request.query_params.get('role') or '').strip()
        return Response({'role': role, 'defaults': get_role_defaults(role)})

    @action(detail=True, methods=['get', 'put'], url_path='module-permissions')
    def module_permissions(self, request, pk=None):
        """Get or replace a user's module permissions (admin only).

        GET  -> { effective, custom, role, modules }
        PUT  -> body { "permissions": [ {module, actions, scope?, is_enabled?}, ... ] }
                replaces all custom rows for the user.
        """
        user = self.get_object()

        if request.method == 'GET':
            custom = [
                {
                    'module': row.module,
                    'actions': row.actions,
                    'scope': row.scope,
                    'is_enabled': row.is_enabled,
                }
                for row in user.module_permissions.all()
            ]
            return Response({
                'user_id': user.id,
                'role': user.role,
                'modules': MODULE_ACTIONS,
                'role_defaults': get_role_defaults(user.role),
                'custom': custom,
                'effective': resolve_user_module_permissions(user),
            })

        # PUT — replace all custom rows.
        raw = request.data.get('permissions', [])
        if isinstance(raw, dict):
            raw = [{'module': module, 'actions': actions} for module, actions in raw.items()]
        if not isinstance(raw, list):
            return Response({'detail': 'permissions must be a list or object.'}, status=status.HTTP_400_BAD_REQUEST)

        cleaned = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            module = str(item.get('module') or '').strip()
            if module not in MODULES:
                return Response({'detail': f'Unknown module: {module}'}, status=status.HTTP_400_BAD_REQUEST)
            allowed = set(MODULE_ACTIONS.get(module, []))
            actions = [a for a in (item.get('actions') or []) if a in allowed]
            scope = item.get('scope') if isinstance(item.get('scope'), dict) else {}
            is_enabled = bool(item.get('is_enabled', True))
            cleaned.append({'module': module, 'actions': actions, 'scope': scope, 'is_enabled': is_enabled})

        with transaction.atomic():
            user.module_permissions.all().delete()
            UserModulePermission.objects.bulk_create([
                UserModulePermission(
                    user=user, module=row['module'], actions=row['actions'],
                    scope=row['scope'], is_enabled=row['is_enabled'],
                )
                for row in cleaned
            ])

        record_audit_event(
            action='manage',
            request=request,
            object_type='user_module_permissions',
            object_id=user.id,
            organization=getattr(user, 'organization', None),
            description=f'Module permissions updated for user {user.username} ({len(cleaned)} modules).',
            metadata={'modules': [row['module'] for row in cleaned]},
        )

        return Response({
            'user_id': user.id,
            'effective': resolve_user_module_permissions(user),
        })

    @action(detail=False, methods=['get', 'post', 'delete'])
    def group_catalog(self, request):
        """Manage the portal group catalog (auth.Group)."""
        if not self._is_admin():
            return Response({'detail': 'Only admins can manage groups.'}, status=status.HTTP_403_FORBIDDEN)

        if request.method == 'GET':
            names = list(Group.objects.order_by('name').values_list('name', flat=True))
            return Response(names)

        if request.method == 'POST':
            name = str(request.data.get('name', '')).strip()
            if not name:
                return Response({'detail': 'name is required.'}, status=status.HTTP_400_BAD_REQUEST)
            group, created = Group.objects.get_or_create(name=name)
            return Response({'name': group.name}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

        if request.method == 'DELETE':
            name = str(request.query_params.get('name', '')).strip()
            if not name:
                return Response({'detail': 'name query param is required.'}, status=status.HTTP_400_BAD_REQUEST)
            deleted, _ = Group.objects.filter(name=name).delete()
            if deleted:
                return Response(status=status.HTTP_204_NO_CONTENT)
            return Response({'detail': 'Group not found.'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['get'])
    def permissions(self, request):
        """Return assignable permissions for admins."""
        user = request.user
        if not (user.is_superuser or user.is_staff or user.role == 'admin'):
            return Response({'detail': 'You do not have permission to view permissions.'}, status=status.HTTP_403_FORBIDDEN)

        permissions = Permission.objects.select_related('content_type').order_by(
            'content_type__app_label', 'codename'
        )
        payload = [
            {
                'id': str(permission.id),
                'app_label': permission.content_type.app_label,
                'codename': permission.codename,
                'name': permission.name,
            }
            for permission in permissions
        ]
        return Response(payload)


# ---------------------------
# User Activity ViewSet
# ---------------------------
class UserActivityViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only view for user activities."""
    queryset = UserActivity.objects.select_related('user')
    serializer_class = UserActivitySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['user', 'action', 'model_name']
    ordering = ['-timestamp']

    def get_queryset(self):
        user = self.request.user
        queryset = UserActivity.objects.select_related('user')
        if is_organization_admin(user):
            return queryset
        if user.role == 'manager':
            org_ids = get_user_organization_ids(user)
            if org_ids:
                return filter_queryset_by_org_ids(queryset, 'user__organization_id', org_ids)
            return queryset.none()
        return queryset.filter(user=user)

