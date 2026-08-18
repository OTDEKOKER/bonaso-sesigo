"""Push questionnaire schema v20 live (idempotent; see 0006-0013).

v20 folds the admin's form-editor edits (made 2026-08-18, versions
edit_202608181042 / edit_202608181108) back into the bundled schema so they are
permanent and survive future deploys:
  * a new admin question "Is the organisational currently operational?" (Yes/No);
  * primary district relabelled "… (Headquarters)";
  * Annex 2 resources question relabelled "Which other resources are available …";
  * "Funding sources" moved to the top of the Annex 2 resources domain.
It keeps the v19 change (CSO reporting-frequency multi-select). The new select's
choices are embedded so it renders (the form editor stores list-only).
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
        note="Folded in admin form-editor edits (new operational question, Headquarters + 'other resources' relabels, funding moved to top) + kept reporting-frequency multi-select.",
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
        ("cso_mapping", "0013_activate_schema_v19"),
    ]

    operations = [
        migrations.RunPython(activate, deactivate),
    ]
