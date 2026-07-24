from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Custom User model for BONASO Data Portal."""
    
    ROLE_CHOICES = [
        ('admin', 'Admin'),
        ('manager', 'M&E Manager'),
        ('officer', 'M&E Officer'),
        ('collector', 'Data Collector'),
        ('client', 'Client'),
    ]

    # Which Sesigo environment(s) a user may log into. 'both' (default) preserves
    # existing behaviour; 'live'/'training' restrict the login to one environment.
    # Enforced at token issuance (users.views.TrainingAwareTokenObtainPairSerializer).
    ENVIRONMENT_ACCESS_CHOICES = [
        ('both', 'Live and Training'),
        ('live', 'Live only'),
        ('training', 'Training only'),
    ]

    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='officer')
    environment_access = models.CharField(
        max_length=10, choices=ENVIRONMENT_ACCESS_CHOICES, default='both',
    )
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='users'
    )
    phone = models.CharField(max_length=20, blank=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    home_dashboard_preferences = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    last_activity = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-created_at', '-id']
    
    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"
    
    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip() or self.username


class UserModulePermission(models.Model):
    """Admin-assigned, per-user override of module/action access.

    Extends the role system: when a row exists for a (user, module) it overrides
    that module's role default (a disabled row denies the module entirely). When
    no row exists the user falls back to their role default. See
    ``users.module_permissions`` for the resolution logic and catalog.
    """

    user = models.ForeignKey(
        'users.User',
        on_delete=models.CASCADE,
        related_name='module_permissions',
    )
    module = models.CharField(max_length=100)
    actions = models.JSONField(default=list)
    scope = models.JSONField(default=dict, blank=True)
    is_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['user_id', 'module']
        constraints = [
            models.UniqueConstraint(fields=['user', 'module'], name='unique_user_module_permission'),
        ]

    def __str__(self):
        return f'{self.user_id}:{self.module}={self.actions}'


class UserActivity(models.Model):
    """Track user activity for audit purposes."""
    
    ACTION_CHOICES = [
        ('login', 'Login'),
        ('logout', 'Logout'),
        ('create', 'Create'),
        ('update', 'Update'),
        ('delete', 'Delete'),
        ('view', 'View'),
        ('export', 'Export'),
        ('import', 'Import'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='activities')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    model_name = models.CharField(max_length=100, blank=True)
    object_id = models.IntegerField(null=True, blank=True)
    description = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-timestamp', '-id']
        verbose_name_plural = 'User activities'
    
    def __str__(self):
        return f"{self.user.username} - {self.action} - {self.timestamp}"


class ConfidentialityAcknowledgement(models.Model):
    """Durable record that a user accepted the mandatory confidentiality notice.

    One row per (user, version): the acknowledgement gate (frontend layout +
    users.views.current_user) treats a user as acknowledged for the current
    settings.CONFIDENTIALITY_ACK_VERSION once such a row exists. ``environment``
    captures whether the acceptance happened in the LIVE or TRAINING session
    (from the authoritative JWT mode claim). This is the audit trail for who
    accepted which version, when, and in which environment.
    """

    ENVIRONMENT_CHOICES = [
        ('live', 'Live'),
        ('training', 'Training'),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='confidentiality_acknowledgements',
    )
    version = models.CharField(max_length=64)
    environment = models.CharField(max_length=10, choices=ENVIRONMENT_CHOICES)
    accepted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-accepted_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'version'],
                name='unique_user_confidentiality_version',
            ),
        ]
        indexes = [
            models.Index(fields=['user', 'version']),
        ]

    def __str__(self):
        return f"{self.user.username} accepted {self.version} ({self.environment})"
