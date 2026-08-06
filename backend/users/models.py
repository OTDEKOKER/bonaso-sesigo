from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


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
    # When the password was last set/changed. Stamped automatically by
    # set_password() below, so every change (admin reset, self-service change,
    # user creation) refreshes it. Drives the DPA password-expiry policy
    # (settings.PASSWORD_EXPIRY_DAYS). Null = never stamped (treated as expired
    # once expiry is enabled, so legacy accounts are caught — the deploy
    # migration backfills existing users to "now" to avoid a day-one lockout).
    password_changed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip() or self.username

    # ------------------------------------------------------------------
    # Password expiry (DPA). set_password is the single choke point for every
    # password change in Django (admin, DRF, djoser, management commands), so
    # stamping here guarantees the clock resets whenever the hash changes.
    # ------------------------------------------------------------------
    def set_password(self, raw_password):
        super().set_password(raw_password)
        self.password_changed_at = timezone.now()

    def save(self, *args, **kwargs):
        # Robustness net for creation paths that bypass set_password (Django's
        # UserManager._create_user assigns user.password = make_password(...)
        # directly, e.g. createsuperuser). Stamp the clock the first time a usable
        # password is persisted so no real account is left with a null timestamp.
        # Never touches an already-stamped value, and skips update_fields saves
        # that don't include the column (e.g. the login view's last_activity save).
        if (
            self.password_changed_at is None
            and self.password
            and self.has_usable_password()
        ):
            update_fields = kwargs.get('update_fields')
            if update_fields is None or 'password_changed_at' in update_fields:
                self.password_changed_at = timezone.now()
        super().save(*args, **kwargs)

    @property
    def password_expires_at(self):
        """When this password expires, or None if expiry is disabled / unstamped."""
        days = getattr(settings, 'PASSWORD_EXPIRY_DAYS', 0)
        if not days or not self.password_changed_at:
            return None
        return self.password_changed_at + timedelta(days=days)

    @property
    def is_password_expired(self):
        days = getattr(settings, 'PASSWORD_EXPIRY_DAYS', 0)
        if not days:
            return False
        # Expiry enabled but never stamped -> treat as expired (legacy safety).
        if not self.password_changed_at:
            return True
        return timezone.now() >= self.password_expires_at

    def password_status(self):
        """Compact expiry status for the /me payload and the frontend gate."""
        days = getattr(settings, 'PASSWORD_EXPIRY_DAYS', 0)
        expires_at = self.password_expires_at
        remaining = None
        if expires_at is not None:
            remaining = (expires_at - timezone.now()).days
        return {
            'expiry_enabled': bool(days),
            'expired': self.is_password_expired,
            'expires_at': expires_at.isoformat() if expires_at else None,
            'days_remaining': remaining,
            'warn_days': getattr(settings, 'PASSWORD_EXPIRY_WARN_DAYS', 14),
        }


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


class PasswordResetRequest(models.Model):
    """A user's request for an admin to reset their password.

    Because outbound email is not configured (settings.EMAIL_HOST defaults to
    localhost), the self-service email reset does not deliver. This model backs
    an admin-approved workflow instead: a user who cannot sign in (forgotten or
    expired password) submits a request from the login page; an admin reviews the
    pending queue and either approves (sets a new password) or rejects it. The
    submit endpoint never reveals whether the account exists (anti-enumeration),
    so ``user`` may be null when no match was found.
    """

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    # What the requester typed (username or email); kept verbatim for the admin.
    identifier = models.CharField(max_length=254)
    # Resolved account, if the identifier matched one. Null when unmatched.
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='password_reset_requests',
    )
    note = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='pending')
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='resolved_password_reset_requests',
    )
    resolution_note = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['status', '-created_at'], name='pwreset_status_created_idx'),
        ]

    def __str__(self):
        return f"PasswordResetRequest({self.identifier}, {self.status})"
