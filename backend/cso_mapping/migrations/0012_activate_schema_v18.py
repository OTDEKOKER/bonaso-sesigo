"""Push questionnaire schema v18 live (idempotent; see 0006-0011).

v18 replaces the flat one-per-line current-funding text fields (…_3d/e/f/g) in
the CSO (Annex 2) and coordinating-body (Annex 3) resources domains with a single
structured, repeatable "Funding sources" field (type ``funding_sources``) — one
record per funder (funder name, project/grant name, scope, funding period).
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
        note="Structured 'Funding sources' field (funder/project/scope/period, add-multiple) replacing the flat funding text fields in the CSO + coordinating-body paths.",
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
        ("cso_mapping", "0011_activate_schema_v17"),
    ]

    operations = [
        migrations.RunPython(activate, deactivate),
    ]
