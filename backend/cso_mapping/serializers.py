"""Serializers for the CSO mapping questionnaire.

The public submission serializer is schema-driven: it validates the flat
``{field_name: value}`` payload against ``form_schema.json`` (relevance, required,
choices, constraints) rather than hard-coding ~100 fields. This keeps validation
in lock-step with the form definition and the frontend, which renders the same
schema.
"""
from __future__ import annotations

import json
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.validators import EmailValidator, ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from .location import validate_location
from .models import CsoMappingDraft, CsoMappingSubmission
from .schema import (
    CORE_BOOL_FIELDS,
    CORE_TEXT_FIELDS,
    MAX_ANSWER_LENGTH,
    MAX_DRAFT_BYTES,
    choice_names,
    comment_prefix,
    field_is_active,
    iter_answerable_fields,
    load_schema,
    strip_inactive_branch_answers,
)

# Max lengths for the CharField-backed core columns (must not exceed the model).
CORE_MAXLEN = {
    "responding_entity": 255,
    "respondent_name": 255,
    "respondent_position": 255,
    "primary_district": 255,
    "respondent_phone": 64,
    "respondent_email": 254,
}


class PublicSubmissionSerializer(serializers.Serializer):
    """Validate + persist a public questionnaire submission.

    Accepts a flat object keyed by XLSForm field name. Only fields whose section
    and own relevance conditions hold ("active") are validated and stored, so a
    respondent's branch (Annex 2/3/4) is the only annex retained.
    """

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError(
                {"detail": "Expected an object of questionnaire answers."}
            )

        schema = load_schema()
        # Multi-select answers are lists of choice names; every other answer is a
        # trimmed scalar string. Keep that distinction in the working context so
        # relevance/constraint evaluation and validation see the right shape.
        multi_fields = {
            field["name"]
            for _section, field in iter_answerable_fields(schema)
            if field["type"] == "select_multiple"
        }
        ctx: dict[str, object] = {}
        for key, value in data.items():
            if key in multi_fields:
                if isinstance(value, list):
                    ctx[key] = [str(v).strip() for v in value if str(v).strip() != ""]
                elif value in (None, ""):
                    ctx[key] = []
                else:
                    ctx[key] = [str(value).strip()]
            else:
                ctx[key] = ("" if value is None else str(value)).strip()

        # Consent gate: no submission is accepted without explicit consent.
        if ctx.get("consent", "").lower() != "yes":
            raise serializers.ValidationError(
                {"consent": "Consent is required to submit this questionnaire."}
            )

        # Idempotency key (optional). One per questionnaire attempt; a repeat is
        # de-duplicated in the view. Validate the shape early.
        parsed_client_id = None
        raw_client_id = ctx.get("client_submission_id", "")
        if raw_client_id:
            try:
                parsed_client_id = uuid.UUID(raw_client_id)
            except (ValueError, AttributeError, TypeError):
                raise serializers.ValidationError(
                    {"client_submission_id": "Invalid submission identifier."}
                )

        errors: dict[str, str] = {}
        core: dict[str, object] = {}
        answers: dict[str, str] = {}

        def capture_comment(field_name: str) -> None:
            """Store the optional free-text comment(s) on a select question's options."""
            prefix = comment_prefix(field_name)
            for key, raw in ctx.items():
                if not key.startswith(prefix):
                    continue
                text = raw.strip() if isinstance(raw, str) else ""
                if not text:
                    continue
                if len(text) > MAX_ANSWER_LENGTH:
                    errors[key] = "This comment is too long."
                else:
                    answers[key] = text

        for section, field in iter_answerable_fields(schema):
            name = field["name"]
            if not field_is_active(section, field, ctx):
                continue  # inactive branch — ignore any submitted value

            value = ctx.get(name, "")

            # Multi-select: a list of choice names, stored in the answers blob.
            if field["type"] == "select_multiple":
                values = value if isinstance(value, list) else ([value] if value else [])
                if sum(len(v) for v in values) > MAX_ANSWER_LENGTH:
                    errors[name] = "This answer is too long."
                    continue
                allowed = choice_names(schema, field.get("list", ""))
                if any(v not in allowed for v in values):
                    errors[name] = "Invalid selection."
                    continue
                if field.get("required") and not values:
                    errors[name] = "This field is required."
                    continue
                if values:
                    answers[name] = values
                capture_comment(name)
                continue

            if len(value) > MAX_ANSWER_LENGTH:
                errors[name] = "This answer is too long."
                continue
            if name in CORE_MAXLEN and len(value) > CORE_MAXLEN[name]:
                errors[name] = f"Must be at most {CORE_MAXLEN[name]} characters."
                continue

            if field["type"] == "select_one":
                allowed = choice_names(schema, field.get("list", ""))
                if value and value not in allowed:
                    errors[name] = "Invalid selection."
                    continue

            if field.get("required") and not value:
                errors[name] = "This field is required."
                continue

            constraint = field.get("constraint")
            if constraint and value:
                target = value if constraint.get("field") == "." else ctx.get(
                    constraint.get("field", ""), ""
                )
                if str(target) != constraint.get("value"):
                    errors[name] = "This value is not permitted."
                    continue

            if name == "respondent_email" and value:
                try:
                    EmailValidator()(value)
                except DjangoValidationError:
                    errors[name] = "Enter a valid email address."
                    continue

            # Store: core fields to columns, everything else to the answers blob.
            if name in CORE_BOOL_FIELDS:
                core[name] = value.lower() == "yes"
            elif name in CORE_TEXT_FIELDS:
                core[name] = value
            elif value:
                answers[name] = value

            if field["type"] == "select_one":
                capture_comment(name)

        # Office GPS location. Handled explicitly (not schema-driven) and required
        # for a submission — a questionnaire cannot be submitted without valid
        # coordinates. Server-side validation is authoritative: never trust the
        # client. Out-of-country-but-valid points are flagged, not rejected.
        location_values, location_errors = validate_location(ctx, required=True)
        errors.update(location_errors)

        if errors:
            raise serializers.ValidationError(errors)

        core.update(location_values)
        core["answers"] = answers
        core["form_version"] = schema.get("version", "")
        if parsed_client_id is not None:
            core["client_submission_id"] = parsed_client_id
        return core

    def create(self, validated_data):
        return CsoMappingSubmission.objects.create(**validated_data)


class StaffSubmissionSerializer(serializers.ModelSerializer):
    """Full read serializer for authorised staff (list/retrieve)."""

    respondent_type_display = serializers.CharField(
        source="get_respondent_type_display", read_only=True
    )

    class Meta:
        model = CsoMappingSubmission
        # (draft serializer defined after this class)
        fields = [
            "id",
            "public_reference",
            "submitted_at",
            "consent",
            "respondent_type",
            "respondent_type_display",
            "responding_entity",
            "respondent_name",
            "respondent_position",
            "respondent_phone",
            "respondent_email",
            "primary_district",
            "information_confirmed",
            "additional_comments",
            "answers",
            "form_version",
            # Office location (staff detail only; excluded from the public map).
            "latitude",
            "longitude",
            "location_accuracy",
            "location_captured_at",
            "location_capture_method",
            "location_flagged",
            "location_flag_reason",
        ]
        read_only_fields = fields


class DraftWriteSerializer(serializers.ModelSerializer):
    """Create/update a resumable draft.

    Draft saves are lenient about *required* fields (a draft is incomplete by
    design) but still reject invalid choices and oversized values, ignore unknown
    keys, and strip answers for the non-selected Annex branch. ``expires_at`` is
    refreshed on every save from the configured TTL (server time).
    """

    answers = serializers.JSONField(required=False, default=dict)

    class Meta:
        model = CsoMappingDraft
        fields = ["answers", "current_step", "form_version", "client_submission_id"]

    def validate_answers(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Answers must be an object.")
        if len(json.dumps(value)) > MAX_DRAFT_BYTES:
            raise serializers.ValidationError("This draft is too large to save.")
        schema = load_schema()
        fields_by_name = {f["name"]: f for _s, f in iter_answerable_fields(schema)}
        for name, raw in value.items():
            field = fields_by_name.get(name)
            if field is None:
                continue  # unknown key — ignored (stripped on save), not an error
            if field["type"] == "select_multiple":
                items = raw if isinstance(raw, list) else ([] if raw in (None, "") else [raw])
                if sum(len(str(i)) for i in items) > MAX_ANSWER_LENGTH:
                    raise serializers.ValidationError(f"'{name}' is too long.")
                allowed = choice_names(schema, field.get("list", ""))
                if any(str(i) not in allowed for i in items):
                    raise serializers.ValidationError(f"Invalid selection for '{name}'.")
                continue
            text = "" if raw is None else str(raw)
            if len(text) > MAX_ANSWER_LENGTH or (
                name in CORE_MAXLEN and len(text) > CORE_MAXLEN[name]
            ):
                raise serializers.ValidationError(f"'{name}' is too long.")
            if (
                field["type"] == "select_one"
                and text
                and text not in choice_names(schema, field.get("list", ""))
            ):
                raise serializers.ValidationError(f"Invalid selection for '{name}'.")
        return value

    def _apply(self, validated_data):
        if "answers" in validated_data:
            answers = strip_inactive_branch_answers(load_schema(), validated_data["answers"])
            validated_data["answers"] = answers
            validated_data["respondent_type"] = (answers.get("respondent_type") or "")[:32]
        validated_data["expires_at"] = timezone.now() + timedelta(
            days=settings.CSO_MAPPING_DRAFT_TTL_DAYS
        )
        return validated_data

    def create(self, validated_data):
        return CsoMappingDraft.objects.create(**self._apply(validated_data))

    def update(self, instance, validated_data):
        for key, value in self._apply(validated_data).items():
            setattr(instance, key, value)
        instance.save()
        return instance
