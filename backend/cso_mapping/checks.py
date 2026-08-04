"""Deployment safety checks for the CSO Mapping app."""
import os

from django.conf import settings
from django.core.checks import Error, register


@register()
def draft_ttl_configured(app_configs, **kwargs):
    """Production must configure an explicit, positive draft retention (TTL).

    Drafts hold personal data; the retention period is a governance decision that
    must be set deliberately, not left to a code default. In DEBUG we allow the
    fallback; with DEBUG off, a missing/invalid CSO_MAPPING_DRAFT_TTL_DAYS is an
    error so the misconfiguration is caught before deployment.
    """
    # Skip under DEBUG and under the test runner (tests set their own TTL); this
    # gate is for real deployments (manage.py check with DEBUG off).
    if settings.DEBUG or getattr(settings, "TESTING", False):
        return []
    raw = os.getenv("CSO_MAPPING_DRAFT_TTL_DAYS", "").strip()
    if raw.isdigit() and int(raw) > 0:
        return []
    return [
        Error(
            "CSO_MAPPING_DRAFT_TTL_DAYS must be set to a positive integer (days) in "
            "production; questionnaire drafts hold personal data and their retention "
            "period is a required governance decision.",
            id="cso_mapping.E001",
        )
    ]
