"""Push questionnaire schema v15 live.

Same idempotent pattern as 0006-0008. v15 replaces the district list with the
official Botswana Master Facility List health districts (27), so the CSO
questionnaire's district vocabulary matches the Ministry of Health.
"""
from __future__ import annotations

import json
from pathlib import Path

from django.db import migrations

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "form_schema.json"


def _bundled():
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def activate(apps, schema_editor):
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
        note="Adopted the official MFL health-district list for primary_district.",
        is_active=True,
    )


def deactivate(apps, schema_editor):
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
        ("cso_mapping", "0008_activate_schema_v14"),
    ]

    operations = [
        migrations.RunPython(activate, deactivate),
    ]
