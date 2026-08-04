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

import secrets

from django.db import models
from django.utils import timezone


def generate_reference() -> str:
    """A public-safe, unguessable submission reference, e.g. CSO-2026-1A2B3C4D."""
    return f"CSO-{timezone.now():%Y}-{secrets.token_hex(4).upper()}"


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

    # Idempotency key supplied by the client — one per questionnaire attempt — so
    # a retried or double-clicked POST does not create a second row. Nullable and
    # unique: absent/legacy ids stay NULL (Postgres allows many NULLs under a
    # UNIQUE constraint); a repeated id is rejected at the database level.
    client_submission_id = models.UUIDField(null=True, blank=True, unique=True)

    # Public-safe reference shown on the receipt (e.g. CSO-2026-1A2B3C4D). Used
    # instead of the sequential PK so it can be quoted externally without leaking
    # row counts. Nullable+unique to keep the migration clean; always set on save.
    public_reference = models.CharField(max_length=32, null=True, blank=True, unique=True)

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

    def save(self, *args, **kwargs):
        if not self.public_reference:
            for _ in range(5):
                candidate = generate_reference()
                if not CsoMappingSubmission.objects.filter(public_reference=candidate).exists():
                    self.public_reference = candidate
                    break
            else:  # pragma: no cover - collision 5x is astronomically unlikely
                self.public_reference = generate_reference()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        who = self.responding_entity or self.respondent_name or "(unnamed)"
        return f"{who} — {self.get_respondent_type_display()}"
