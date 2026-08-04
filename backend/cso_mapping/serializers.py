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

from .models import CsoMappingDraft, CsoMappingSubmission
from .schema import (
    CORE_BOOL_FIELDS,
    CORE_TEXT_FIELDS,
    MAX_ANSWER_LENGTH,
    MAX_DRAFT_BYTES,
    choice_names,
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
        # Working context of trimmed string values, used for relevance/constraint
        # evaluation and validation.
        ctx = {
            key: ("" if value is None else str(value)).strip()
            for key, value in data.items()
        }

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

        for section, field in iter_answerable_fields(schema):
            name = field["name"]
            if not field_is_active(section, field, ctx):
                continue  # inactive branch — ignore any submitted value

            value = ctx.get(name, "")

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

        if errors:
            raise serializers.ValidationError(errors)

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
