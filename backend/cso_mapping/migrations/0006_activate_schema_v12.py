"""Push the updated questionnaire schema (v12) live.

The live form is served from the active ``CsoMappingSchemaVersion`` row, not the
bundled file, so bumping ``form_schema.json`` alone would not change what
respondents see on an already-seeded database. This data migration activates the
bundled v12 schema (MCQ choice lists + ``primary_district`` as a searchable
single-choice district) as a new active version.

Safety:
  * Idempotent — if the active version already carries the bundled version label
    (fresh DB seeded from v12, or re-run), it does nothing.
  * Non-destructive — the previous active version is kept in history (only
    ``is_active`` is cleared) so an admin can roll back from the form-editor UI.
"""
from __future__ import annotations

import json
from pathlib import Path

from django.db import migrations

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "form_schema.json"


def _bundled():
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def activate_v12(apps, schema_editor):
    Version = apps.get_model("cso_mapping", "CsoMappingSchemaVersion")
    bundled = _bundled()
    label = str(bundled.get("version", ""))[:64]

    active = Version.objects.filter(is_active=True).first()
    # Already on this (or a newer, same-labelled) version — nothing to do.
    if active is not None and active.version_label == label:
        return

    # Deactivate the current active row first to satisfy the one-active
    # constraint, then create the new active version.
    Version.objects.filter(is_active=True).update(is_active=False)
    Version.objects.create(
        schema=bundled,
        version_label=label,
        note="Added MCQ choice lists and made primary_district a searchable district selection.",
        is_active=True,
    )


def deactivate_v12(apps, schema_editor):
    """Reverse: drop the v12 row we created and re-activate the prior version."""
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
        ("cso_mapping", "0005_add_location_fields"),
    ]

    operations = [
        migrations.RunPython(activate_v12, deactivate_v12),
    ]
