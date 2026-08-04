"""CSO Mapping & Capacity Assessment submissions.

Responses to the public Botswana Health Service CSO Mapping questionnaire are
stored here, in Sesigo's own database — deliberately NOT sent to a third-party
form host — so the personal data stays on in-country infrastructure under BONASO
control (Data Protection Act, 2018: avoids a cross-border transfer of personal
data). Access to raw submissions is restricted to authorised staff (see
``permissions.IsAdminRole``).

Data minimisation: we store only what the respondent provides plus a server
timestamp — no IP address or device id is retained.
"""
from __future__ import annotations

from django.db import models


class CsoMappingSubmission(models.Model):
    """One completed CSO mapping questionnaire response."""

    RESPONDENT_TYPE_CHOICES = [
        ("cso", "Health Service Civil Society Organisation"),
        ("coordinating_body", "Coordinating body, umbrella body or network"),
        ("strategic_structure", "DAC, DHMT, Government or other strategic-level structure"),
    ]

    # Consent gate. A row only exists when consent was given, but we record it
    # explicitly as the lawful basis for processing.
    consent = models.BooleanField(default=False)

    # Administrative information (Annex 1).
    respondent_type = models.CharField(max_length=32, choices=RESPONDENT_TYPE_CHOICES)
    responding_entity = models.CharField(max_length=255)
    respondent_name = models.CharField(max_length=255)
    respondent_position = models.CharField(max_length=255, blank=True)
    respondent_phone = models.CharField(max_length=64, blank=True)
    respondent_email = models.EmailField(blank=True)
    primary_district = models.CharField(max_length=255, blank=True)

    # Final confirmation.
    information_confirmed = models.BooleanField(default=False)
    additional_comments = models.TextField(blank=True)

    # All annex-domain answers, keyed by XLSForm field name (e.g. annex2_a2_1a).
    answers = models.JSONField(default=dict, blank=True)

    # Provenance: which form version produced this row (for schema evolution).
    form_version = models.CharField(max_length=64, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-submitted_at", "-id"]
        verbose_name = "CSO mapping submission"
        verbose_name_plural = "CSO mapping submissions"
        indexes = [
            models.Index(fields=["respondent_type"]),
            models.Index(fields=["-submitted_at"]),
        ]

    def __str__(self) -> str:
        who = self.responding_entity or self.respondent_name or "(unnamed)"
        return f"{who} — {self.get_respondent_type_display()}"
