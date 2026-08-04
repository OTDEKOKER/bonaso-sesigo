"""
URL configuration for BONASO Data Portal.
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from .status_views import SystemStatusView
from .health_views import HealthView
from .offline_views import OfflineBootstrapView
from .backup_views import BackupStatusView, BackupGenerateView, BackupDownloadView, EncryptedBackupDownloadView

urlpatterns = [
    # Admin site
    path('admin/', admin.site.urls),

    # Unauthenticated liveness/readiness probe (container healthcheck + edge).
    path('api/health/', HealthView.as_view(), name='health'),

    # Users: authentication, current user, and management
    path('api/users/', include('users.urls')),  # handles auth, JWT, UserViewSet, etc.

    # Core apps
    path('api/organizations/', include('organizations.urls')),
    path('api/indicators/', include('indicators.urls')),

    # Projects, tasks & deadlines
    path('api/manage/', include('projects.urls')),  # primary API for project management

    # Data collection apps
    path('api/record/', include('respondents.urls')),
    path('api/aggregates/', include('aggregates.urls')),
    path('api/activities/', include('events.urls')),
    path('api/social/', include('social.urls')),

    # Utility apps
    path('api/flags/', include('flags.urls')),
    path('api/analysis/', include('analysis.urls')),  # dashboard lives here
    path('api/reports/', include('funder_reports.urls')),  # funder report builder
    path('api/profiles/', include('profiles.urls')),
    path('api/uploads/', include('uploads.urls')),
    path('api/messages/', include('messaging.urls')),
    path('api/support/', include('support.urls')),
    path('api/cso-mapping/', include('cso_mapping.urls')),  # public questionnaire + staff read
    path('api/audit/', include('audit.urls')),
    path('api/system/status/', SystemStatusView.as_view(), name='system_status'),
    path('api/system/status/', include('system_status.urls')),
    path('api/system/backups/status/', BackupStatusView.as_view(), name='backup_status'),
    path('api/system/backups/generate/', BackupGenerateView.as_view(), name='backup_generate'),
    path('api/system/backups/download/', BackupDownloadView.as_view(), name='backup_download'),
    path('api/system/backups/encrypted-download/', EncryptedBackupDownloadView.as_view(), name='backup_encrypted_download'),
    path('api/system/restore/', include('recovery.urls')),

    # Offline sync-down package for field data capture
    path('api/offline/bootstrap/', OfflineBootstrapView.as_view(), name='offline_bootstrap'),
]

# Serve media files during development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
