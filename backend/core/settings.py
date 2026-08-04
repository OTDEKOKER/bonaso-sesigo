"""
Django settings for BONASO Data Portal project.
"""

from pathlib import Path
from datetime import timedelta
import os
import sys
from dotenv import load_dotenv
import dj_database_url

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Always load .env from project root, regardless of cwd.
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() == 'true'


def env_int(name: str, default: int = 0) -> int:
    value = os.getenv(name, str(default)).strip()
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY') or os.getenv('SECRET_KEY')
if not SECRET_KEY:
    from django.core.exceptions import ImproperlyConfigured
    raise ImproperlyConfigured(
        'DJANGO_SECRET_KEY (or SECRET_KEY) must be set in the environment.'
    )

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env_bool('DEBUG', False)

ALLOWED_HOSTS = [host.strip() for host in os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if host.strip()]

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third party apps
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'djoser',
    # Local apps
    'users',
    'organizations',
    'indicators',
    'projects',
    'respondents',
    'aggregates',
    'events',
    'social',
    'flags',
    'analysis',
    'profiles',
    'uploads',
    'messaging',
    'idempotency',
    'audit',
    'recovery',
    'system_status',
    'funder_reports',
    'support',
    'cso_mapping',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'core.middleware.ContentSecurityPolicyMiddleware',
    'core.middleware.ApiCacheControlMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'

# Database
# Priority: DATABASE_URL -> USE_POSTGRES -> SQLite
database_url = os.getenv('DATABASE_URL')
if database_url:
    DATABASES = {
        'default': dj_database_url.parse(
            database_url,
            conn_max_age=600,
            ssl_require=os.getenv('DB_SSL_REQUIRE', 'True').lower() == 'true',
        )
    }
elif os.getenv('USE_POSTGRES', 'False').lower() == 'true':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('DB_NAME', 'bonaso_db'),
            'USER': os.getenv('DB_USER', 'postgres'),
            'PASSWORD': os.getenv('DB_PASSWORD', 'postgres'),
            'HOST': os.getenv('DB_HOST', 'localhost'),
            'PORT': os.getenv('DB_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

db_test_name = os.getenv('DB_TEST_NAME', '').strip()
if db_test_name:
    DATABASES['default'].setdefault('TEST', {})['NAME'] = db_test_name

# Custom User Model
AUTH_USER_MODEL = 'users.User'

# ----------------------------------------------------------------------------
# Confidentiality acknowledgement
# ----------------------------------------------------------------------------
# The version of the mandatory confidentiality notice users must accept before
# reaching any protected page. The notice WORDING lives in the frontend modal
# (frontend/app/(dashboard)/layout.tsx); bump this string whenever that wording
# changes so every user is re-prompted and re-recorded. Users are considered
# acknowledged once they have a users.ConfidentialityAcknowledgement row for the
# current value (see users.views.current_user / confidentiality_acknowledgement).
CONFIDENTIALITY_ACK_VERSION = os.getenv('CONFIDENTIALITY_ACK_VERSION', '2026-07-23')

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Media files
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Reporting workbook: when True, a reporting/coordinator workbook download is
# refused (409) unless an active WorkbookLayout resolves for the organisation,
# instead of silently emitting the full assigned-indicator set (audit H3).
# Default False preserves the existing behaviour; enable once every coordinator
# that will report has built and activated a layout.
WORKBOOK_REQUIRE_LAYOUT = os.getenv('WORKBOOK_REQUIRE_LAYOUT', 'False').lower() == 'true'

# CORS settings
CORS_ALLOW_ALL_ORIGINS = os.getenv('CORS_ALLOW_ALL_ORIGINS', 'False').lower() == 'true'
CORS_ALLOWED_ORIGINS = os.getenv(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:3000,http://127.0.0.1:3000'
).split(',')
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.getenv('CSRF_TRUSTED_ORIGINS', '').split(',')
    if origin.strip()
]

USE_X_FORWARDED_PROTO = env_bool('USE_X_FORWARDED_PROTO', False)
if USE_X_FORWARDED_PROTO:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# During test runs the Django test client issues HTTP requests; an active
# SECURE_SSL_REDIRECT would 301-redirect them all. Disable it under tests only
# (production behaviour is unchanged).
TESTING = 'test' in sys.argv
SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', not DEBUG) and not TESTING
SESSION_COOKIE_SECURE = env_bool('SESSION_COOKIE_SECURE', not DEBUG)
CSRF_COOKIE_SECURE = env_bool('CSRF_COOKIE_SECURE', not DEBUG)
SECURE_HSTS_SECONDS = env_int('SECURE_HSTS_SECONDS', 0 if DEBUG else 31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool('SECURE_HSTS_INCLUDE_SUBDOMAINS', not DEBUG)
SECURE_HSTS_PRELOAD = env_bool('SECURE_HSTS_PRELOAD', not DEBUG)
SECURE_REFERRER_POLICY = os.getenv('SECURE_REFERRER_POLICY', 'strict-origin-when-cross-origin')
X_FRAME_OPTIONS = os.getenv('X_FRAME_OPTIONS', 'DENY')
# Explicit (Django defaults this True, but state it so it can't silently regress
# and as defence-in-depth alongside the upload extension allowlist): browsers
# must not MIME-sniff responses into an executable content-type.
SECURE_CONTENT_TYPE_NOSNIFF = env_bool('SECURE_CONTENT_TYPE_NOSNIFF', True)

# Content-Security-Policy (audit S1). DISABLED by default: the header is only
# emitted when CONTENT_SECURITY_POLICY is set to a non-empty policy string, so
# this changes nothing until an operator opts in with a tested policy. Covers
# Django-served surfaces (admin, error pages); the Next.js app pages set their
# own CSP in the frontend. Roll out with CONTENT_SECURITY_POLICY_REPORT_ONLY=True
# first (report, don't block), then switch to enforcing. Applied by
# core.middleware.ContentSecurityPolicyMiddleware. Example starter policy:
#   default-src 'self'; frame-ancestors 'none'; object-src 'none';
#   base-uri 'self'; form-action 'self'
CONTENT_SECURITY_POLICY = os.getenv('CONTENT_SECURITY_POLICY', '').strip()
CONTENT_SECURITY_POLICY_REPORT_ONLY = env_bool('CONTENT_SECURITY_POLICY_REPORT_ONLY', False)

# Production safety guards (audit findings L2, L4). When DEBUG is off we refuse
# to start with a wide-open CORS policy or on the SQLite dev database, so a
# misconfiguration can never silently weaken or mis-store production data.
# Skipped under the test runner.
if not DEBUG and not TESTING:
    from django.core.exceptions import ImproperlyConfigured
    if os.getenv('CORS_ALLOW_ALL_ORIGINS', 'False').lower() == 'true':
        raise ImproperlyConfigured(
            'CORS_ALLOW_ALL_ORIGINS must not be True in production. '
            'Set explicit CORS_ALLOWED_ORIGINS instead.'
        )
    if DATABASES['default']['ENGINE'].endswith('sqlite3'):
        raise ImproperlyConfigured(
            'Refusing to run in production on SQLite. Set DATABASE_URL or '
            'USE_POSTGRES=True so production data is stored in PostgreSQL.'
        )

# Upload size caps. Note: FILE_UPLOAD_MAX_MEMORY_SIZE is the in-memory threshold,
# not a hard cap — larger uploads stream to a temp file. Hard caps on file size
# must still be enforced in upload views/serializers for the workbook flow.
FILE_UPLOAD_MAX_MEMORY_SIZE = env_int('FILE_UPLOAD_MAX_MEMORY_SIZE', 5 * 1024 * 1024)
DATA_UPLOAD_MAX_MEMORY_SIZE = env_int('DATA_UPLOAD_MAX_MEMORY_SIZE', 50 * 1024 * 1024)

# CSO Mapping: how long an inactive questionnaire draft remains resumable before
# it expires (server time) and is swept. Drafts hold personal data, so keep it
# short. PRODUCTION MUST set CSO_MAPPING_DRAFT_TTL_DAYS explicitly — the
# cso_mapping.checks system check errors when it is missing/invalid and DEBUG is
# off. In DEBUG we fall back to 14 for convenience.
_cso_draft_ttl_raw = os.getenv('CSO_MAPPING_DRAFT_TTL_DAYS', '').strip()
CSO_MAPPING_DRAFT_TTL_DAYS = (
    int(_cso_draft_ttl_raw)
    if _cso_draft_ttl_raw.isdigit() and int(_cso_draft_ttl_raw) > 0
    else 14
)

# Cache
# ----------------------------------------------------------------------------
# Throttle state (SEC-1) and the analytics response cache must be SHARED across
# the gunicorn workers in the backend container; the default per-process
# LocMemCache would let each worker keep its own counters, multiplying every
# rate limit by the worker count. A filesystem cache lives on the container's
# shared filesystem, so all workers in the one backend container agree on the
# count without needing Redis or a DB cache table (no extra deploy step).
# Override with CACHE_BACKEND/CACHE_LOCATION for a Redis/memcached deployment.
CACHE_BACKEND = os.getenv('CACHE_BACKEND', 'django.core.cache.backends.filebased.FileBasedCache')
CACHE_LOCATION = os.getenv('CACHE_LOCATION', '/tmp/bonaso_cache')
CACHES = {
    'default': {
        'BACKEND': CACHE_BACKEND,
        'LOCATION': CACHE_LOCATION,
    }
}

# REST Framework settings
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.DefaultPageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_FILTER_BACKENDS': (
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        # StableOrderingFilter appends the primary key as a tie-breaker so
        # LIMIT/OFFSET pagination is deterministic (rows don't jump/duplicate
        # between pages when the sort column has ties).
        'core.filters.StableOrderingFilter',
    ),
    # Throttling. Scoped rates protect the public/unauthenticated surface
    # (event check-in) and the authentication endpoints (SEC-1: brute-force /
    # credential-stuffing protection) without rate-limiting normal
    # authenticated traffic.
    'DEFAULT_THROTTLE_CLASSES': (
        'rest_framework.throttling.ScopedRateThrottle',
    ),
    'DEFAULT_THROTTLE_RATES': {
        'event_checkin': os.getenv('THROTTLE_EVENT_CHECKIN', '30/minute'),
        # Public CSO-mapping questionnaire submit endpoint. Caps flooding of the
        # unauthenticated write path. Set generously because many CSOs may submit
        # from one shared/NAT IP at a workshop; raise THROTTLE_CSO_MAPPING if a
        # large in-person session needs more headroom.
        'cso_mapping': os.getenv('THROTTLE_CSO_MAPPING', '60/hour'),
        # Draft autosave/restore by resume token. Higher rate because a long form
        # autosaves repeatedly; these act on one existing row (token = capability),
        # so they are not a row-creation flood vector. Tune per shared-NAT needs.
        'cso_mapping_draft': os.getenv('THROTTLE_CSO_MAPPING_DRAFT', '1000/hour'),
        # SEC-1 auth hardening. Keyed by client IP for anonymous endpoints
        # (login/refresh) and by user for authenticated ones (password reset).
        'login': os.getenv('THROTTLE_LOGIN', '10/minute'),
        'token_refresh': os.getenv('THROTTLE_TOKEN_REFRESH', '30/minute'),
        'password_reset': os.getenv('THROTTLE_PASSWORD_RESET', '5/hour'),
        # Encrypted backup generation is expensive (pg dump + tar + AES); cap it
        # per admin so an accidental or malicious loop can't hammer the server.
        'backup': os.getenv('THROTTLE_BACKUP', '6/hour'),
    },
    # The backend runs behind exactly one reverse proxy (nginx) on loopback, so
    # REMOTE_ADDR is always 127.0.0.1. Tell DRF to read the real client IP from
    # the proxy-appended X-Forwarded-For entry; otherwise every client would
    # share a single throttle bucket (and a spoofed XFF could not bypass it).
    'NUM_PROXIES': env_int('NUM_PROXIES', 1),
}

# Simple JWT settings
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
}

# Deployment environment label (LIVE / TRAINING). Used to stamp backups and to
# block cross-environment restores (training data must never overwrite live).
BONASO_ENVIRONMENT = os.getenv('BONASO_ENVIRONMENT', 'LIVE').strip().upper() or 'LIVE'

# Email (used by the weekly backup-download reminder and password reset). Left
# at the SMTP-localhost default so nothing sends silently to the wrong place;
# set EMAIL_* in the server .env to enable real delivery.
EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = os.getenv('EMAIL_HOST', 'localhost')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', '25'))
EMAIL_USE_TLS = os.getenv('EMAIL_USE_TLS', 'False') == 'True'
EMAIL_USE_SSL = os.getenv('EMAIL_USE_SSL', 'False') == 'True'
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', 'noreply@sesigo.org.bw')

# Djoser settings
DJOSER = {
    'LOGIN_FIELD': 'username',
    'USER_CREATE_PASSWORD_RETYPE': True,
    'PASSWORD_RESET_CONFIRM_URL': 'password/reset/confirm/{uid}/{token}',
    'ACTIVATION_URL': 'activate/{uid}/{token}',
    'SEND_ACTIVATION_EMAIL': False,
    'SERIALIZERS': {
        'user_create': 'users.serializers.UserCreateSerializer',
        'user': 'users.serializers.UserSerializer',
        'current_user': 'users.serializers.UserSerializer',
    },
}

# Logging
# ----------------------------------------------------------------------------
# Audit finding: production had no LOGGING config, so 500s and failed imports
# were only visible in ephemeral container stdout with no structure. We log to
# stdout (captured by Docker/journald) at LOG_LEVEL, always surface unhandled
# request errors via django.request, and optionally mirror to a rotating file
# when LOG_DIR is set. Skipped under the test runner to keep test output clean.
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO').upper()
LOG_DIR = os.getenv('LOG_DIR', '').strip()

_log_handlers = {
    'console': {
        'class': 'logging.StreamHandler',
        'formatter': 'verbose',
        'stream': sys.stdout,
    },
}
_default_handlers = ['console']

if LOG_DIR:
    os.makedirs(LOG_DIR, exist_ok=True)
    _log_handlers['file'] = {
        'class': 'logging.handlers.RotatingFileHandler',
        'formatter': 'verbose',
        'filename': os.path.join(LOG_DIR, 'app.log'),
        'maxBytes': env_int('LOG_FILE_MAX_BYTES', 10 * 1024 * 1024),
        'backupCount': env_int('LOG_FILE_BACKUP_COUNT', 5),
    }
    _default_handlers.append('file')

if not TESTING:
    LOGGING = {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {
            'verbose': {
                'format': '[{asctime}] {levelname} {name}: {message}',
                'style': '{',
            },
        },
        'handlers': _log_handlers,
        'root': {
            'handlers': _default_handlers,
            'level': LOG_LEVEL,
        },
        'loggers': {
            'django': {
                'handlers': _default_handlers,
                'level': LOG_LEVEL,
                'propagate': False,
            },
            # Unhandled 500s in views are logged here at ERROR with a traceback.
            'django.request': {
                'handlers': _default_handlers,
                'level': 'ERROR',
                'propagate': False,
            },
        },
    }

# Optional error tracking. Only activates when SENTRY_DSN is set AND the
# sentry-sdk package is installed, so it is a zero-cost no-op in environments
# (or test runs) that don't opt in. Install with: pip install sentry-sdk.
SENTRY_DSN = os.getenv('SENTRY_DSN', '').strip()
if SENTRY_DSN and not TESTING:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[DjangoIntegration()],
            environment=os.getenv('SENTRY_ENVIRONMENT', 'production'),
            traces_sample_rate=float(os.getenv('SENTRY_TRACES_SAMPLE_RATE', '0.0')),
            send_default_pii=False,
        )
    except ImportError:
        import logging
        logging.getLogger(__name__).warning(
            'SENTRY_DSN is set but sentry-sdk is not installed; error tracking disabled.'
        )
