"""Push the multi-select questionnaire schema (v13) live.

Follows the same pattern as 0006: the live form is the active
``CsoMappingSchemaVersion`` row, so this activates the bundled v13 schema
(structured multiple-choice questions across Annexes 2/3/4 with "Other — specify"
follow-ups). Idempotent and non-destructive — the previous version stays in
history for one-click rollback from the form editor.
"""
from __future__ import annotations

import json
from pathlib import Path

from django.db import migrations

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "form_schema.json"


def _bundled():
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def activate_v13(apps, schema_editor):
    Version = apps.get_model("cso_mapping", "CsoMappingSchemaVersion")
    bundled = _bundled()
    label = str(bundled.get("version", ""))[:64]

    active = Version.objects.filter(is_active=True).first()
    if active is not None and active.version_label == label:
        return
    Version.objects.filter(is_active=True).update(is_active=False)
    Version.objects.create(
        schema=bundled,
        version_label=label,
        note="Wired MCQ choice lists onto Annex 2/3/4 questions (multiple-choice + Other-specify).",
        is_active=True,
    )


def deactivate_v13(apps, schema_editor):
    Version = apps.get_model("cso_mapping", "CsoMappingSchemaVersion")
    bundled = _bundled()
    label = str(bundled.get("version", ""))[:64]
    created = Version.objects.filter(version_label=label, is_active=True).order_by("-id").first()
    if created is None:
        return
    created.is_active = False
    created.save(update_fields=["is_active"])
    previous = Version.objects.exclude(pk=created.pk).order_by("-id").first()
    if previous is not None:
        previous.is_active = True
        previous.save(update_fields=["is_active"])


class Migration(migrations.Migration):

    dependencies = [
        ("cso_mapping", "0006_activate_schema_v12"),
    ]

    operations = [
        migrations.RunPython(activate_v13, deactivate_v13),
    ]
