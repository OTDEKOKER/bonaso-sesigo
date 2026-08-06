from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission, Group
from django.contrib.auth.password_validation import validate_password
from organizations.access import is_organization_admin
from projects.models import Project
from .models import UserActivity, PasswordResetRequest

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """Serializer for User model."""

    organization_name = serializers.CharField(source='organization.name', read_only=True)
    organization_dashboard_config = serializers.JSONField(
        source='organization.dashboard_config', read_only=True, default=dict
    )
    full_name = serializers.CharField(read_only=True)
    permissions = serializers.SerializerMethodField()
    groups = serializers.SerializerMethodField()
    assigned_projects = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'full_name',
            'role', 'environment_access', 'organization', 'organization_name',
            'organization_dashboard_config', 'phone', 'avatar',
            'is_active', 'last_activity', 'date_joined',
            'created_at', 'updated_at', 'permissions', 'groups',
            'assigned_projects',
            'home_dashboard_preferences',
        ]
        read_only_fields = ['id', 'date_joined', 'created_at', 'updated_at', 'last_activity']

    def get_permissions(self, obj):
        return [str(permission_id) for permission_id in obj.user_permissions.values_list('id', flat=True)]

    def get_groups(self, obj):
        return list(obj.groups.values_list('name', flat=True))


class UserCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating new users."""
    
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)
    permissions = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        write_only=True,
    )
    assigned_projects = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Project.objects.all(),
        required=False,
    )

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'environment_access', 'organization', 'phone', 'password', 'password_confirm',
            'permissions', 'assigned_projects',
        ]

    def validate(self, attrs):
        if attrs.get('password') != attrs.get('password_confirm'):
            raise serializers.ValidationError({'password_confirm': "Passwords don't match."})
        role = attrs.get('role')
        organization = attrs.get('organization')
        if role in {'manager', 'officer', 'collector', 'client'} and not organization:
            raise serializers.ValidationError({'organization': 'Organization is required for this role.'})
        return attrs

    def create(self, validated_data):
        permissions = validated_data.pop('permissions', [])
        assigned_projects = validated_data.pop('assigned_projects', None)
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')
        request = self.context.get('request')
        requester = getattr(request, 'user', None)
        if permissions and not is_organization_admin(requester):
            raise serializers.ValidationError({'permissions': 'Only admins can assign explicit permissions.'})
        if assigned_projects and not is_organization_admin(requester):
            raise serializers.ValidationError({'assigned_projects': 'Only admins can assign projects to users.'})
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        if permissions:
            user.user_permissions.set(Permission.objects.filter(id__in=permissions))
        if assigned_projects is not None:
            user.assigned_projects.set(assigned_projects)
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating users."""

    permissions = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        write_only=True,
    )
    groups = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        write_only=True,
    )
    assigned_projects = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Project.objects.all(),
        required=False,
    )

    class Meta:
        model = User
        fields = [
            'first_name', 'last_name', 'email', 'role', 'environment_access', 'organization',
            'phone', 'avatar', 'is_active', 'permissions', 'groups',
            'assigned_projects', 'home_dashboard_preferences',
        ]

    def validate(self, attrs):
        role = attrs.get('role', getattr(self.instance, 'role', None))
        organization = attrs.get('organization', getattr(self.instance, 'organization', None))
        if role in {'manager', 'officer', 'collector', 'client'} and not organization:
            raise serializers.ValidationError({'organization': 'Organization is required for this role.'})
        return attrs

    def update(self, instance, validated_data):
        permissions = validated_data.pop('permissions', None)
        group_names = validated_data.pop('groups', None)
        assigned_projects = validated_data.pop('assigned_projects', None)
        request = self.context.get('request')
        requester = getattr(request, 'user', None)
        if permissions is not None and not is_organization_admin(requester):
            raise serializers.ValidationError({'permissions': 'Only admins can assign explicit permissions.'})
        if assigned_projects is not None and not is_organization_admin(requester):
            raise serializers.ValidationError({'assigned_projects': 'Only admins can assign projects to users.'})
        user = super().update(instance, validated_data)
        if permissions is not None:
            user.user_permissions.set(Permission.objects.filter(id__in=permissions))
        if group_names is not None:
            groups = [Group.objects.get_or_create(name=name.strip())[0] for name in group_names if name.strip()]
            user.groups.set(groups)
        if assigned_projects is not None:
            user.assigned_projects.set(assigned_projects)
        return user


class PasswordChangeSerializer(serializers.Serializer):
    """Serializer for password change."""
    
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])
    confirm_password = serializers.CharField(write_only=True)
    
    def validate(self, attrs):
        if attrs['new_password'] != attrs['confirm_password']:
            raise serializers.ValidationError({'confirm_password': "Passwords don't match."})
        return attrs


class AdminResetPasswordSerializer(serializers.Serializer):
    """Serializer for admin password reset."""
    
    user_id = serializers.IntegerField()
    new_password = serializers.CharField(write_only=True, validators=[validate_password])


class UserActivitySerializer(serializers.ModelSerializer):
    """Serializer for user activity logs."""
    
    user_name = serializers.CharField(source='user.username', read_only=True)
    
    class Meta:
        model = UserActivity
        fields = ['id', 'user', 'user_name', 'action', 'model_name', 'object_id', 'description', 'ip_address', 'timestamp']
        read_only_fields = ['id', 'timestamp']


class CurrentUserDashboardPreferencesSerializer(serializers.ModelSerializer):
    """Serializer for current user's dashboard preferences."""

    home_dashboard_preferences = serializers.JSONField(required=False)

    class Meta:
        model = User
        fields = ['home_dashboard_preferences']


class PasswordResetRequestCreateSerializer(serializers.Serializer):
    """Public submit: a user asks an admin to reset their password."""

    identifier = serializers.CharField(max_length=254, trim_whitespace=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class PasswordResetRequestSerializer(serializers.ModelSerializer):
    """Admin-facing view of a pending/handled reset request."""

    username = serializers.CharField(source='user.username', read_only=True, default=None)
    user_email = serializers.CharField(source='user.email', read_only=True, default=None)
    resolved_by_username = serializers.CharField(
        source='resolved_by.username', read_only=True, default=None
    )
    matched = serializers.SerializerMethodField()

    class Meta:
        model = PasswordResetRequest
        fields = [
            'id', 'identifier', 'user', 'username', 'user_email', 'matched',
            'note', 'status', 'ip_address', 'created_at',
            'resolved_at', 'resolved_by', 'resolved_by_username', 'resolution_note',
        ]
        read_only_fields = fields

    def get_matched(self, obj):
        return obj.user_id is not None


class PasswordResetApproveSerializer(serializers.Serializer):
    """Admin approves a request by setting the account's new password."""

    new_password = serializers.CharField(write_only=True, validators=[validate_password])
    resolution_note = serializers.CharField(required=False, allow_blank=True, max_length=1000)
