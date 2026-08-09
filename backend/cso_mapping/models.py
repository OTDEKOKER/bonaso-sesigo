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

import hashlib
import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q
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

    # Physical GPS location of the organisation's office, captured on the device
    # via the browser Geolocation API (never typed by the respondent). All fields
    # are nullable so existing submissions — and any future one saved before the
    # required-location rollout — remain valid. Coordinates are validated on the
    # server (range + Botswana extent) before they reach these columns.
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_accuracy = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    location_captured_at = models.DateTimeField(null=True, blank=True)
    location_capture_method = models.CharField(max_length=30, blank=True, default="")
    # A valid coordinate that falls outside Botswana's geographic extent is still
    # stored (never silently altered) but flagged for administrative review rather
    # than guessed/replaced. Border-area points inside the extent are not flagged.
    location_flagged = models.BooleanField(default=False)
    location_flag_reason = models.CharField(max_length=120, blank=True, default="")

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


class CsoMappingDraft(models.Model):
    """A partial, resumable questionnaire draft, stored in Sesigo's own database.

    Access is via an opaque resume token issued once at creation; the database
    stores only a **SHA-256 hash** of that token, so a database reader never holds
    a usable token (threat model: DB-read exposure / token enumeration). Holds only
    in-progress answers + progress markers — deliberately NO IP address, device id
    or user-agent (data minimisation).

    Lifecycle: expires after ``settings.CSO_MAPPING_DRAFT_TTL_DAYS`` of inactivity
    (server time); on submission it is marked completed, linked to the submission,
    and its answers are cleared so personal data is not duplicated in the drafts
    table.
    """

    # SHA-256 hex of the raw token. The raw token (secrets.token_urlsafe(32),
    # ~256 bits) is returned to the client once and never stored.
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    # Ties a resumed draft to the same idempotent submission attempt.
    client_submission_id = models.UUIDField(null=True, blank=True)
    respondent_type = models.CharField(max_length=32, blank=True)
    answers = models.JSONField(default=dict, blank=True)
    current_step = models.PositiveIntegerField(default=0)
    form_version = models.CharField(max_length=64, blank=True)

    submission = models.ForeignKey(
        "CsoMappingSubmission",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="drafts",
    )
    completed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "CSO mapping draft"
        indexes = [models.Index(fields=["expires_at"])]

    @staticmethod
    def new_raw_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def hash_token(raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @property
    def is_completed(self) -> bool:
        return self.completed_at is not None

    def __str__(self) -> str:
        return f"draft {self.token_hash[:8]}… (step {self.current_step})"


class CsoMappingSchemaVersion(models.Model):
    """A saved version of the questionnaire schema, editable from the admin UI.

    The schema began life as a bundled JSON file (``form_schema.json``); it now
    lives here so authorised admins can change the questionnaire without a code
    deploy. Exactly one row is ``is_active`` at a time (the version served to
    respondents); superseded rows are kept as history for rollback. The bundled
    file remains the seed for a fresh database and the fallback if no row exists,
    so the live form can never be left blank.
    """

    schema = models.JSONField()
    version_label = models.CharField(max_length=64, blank=True)
    note = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        ordering = ["-id"]
        verbose_name = "CSO mapping schema version"
        constraints = [
            # At most one active version at any time.
            models.UniqueConstraint(
                fields=["is_active"],
                condition=Q(is_active=True),
                name="cso_mapping_one_active_schema",
            ),
        ]

    def __str__(self) -> str:
        state = "active" if self.is_active else "history"
        return f"CSO schema {self.version_label or self.pk} ({state})"
